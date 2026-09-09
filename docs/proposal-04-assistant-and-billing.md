# Proposal 04 — The reference assistant, metering, and billing

**Status:** approved for build (Sept 2026). Stripe approved as a third-party service on the condition below. Depends on proposal 02 (`assistant_runs`, `ASSISTANT_ENABLED`). Additive migration `0005_assistant_billing.sql`.

**What this is and is not.** A reference assistant for the Library — it answers questions about the corpus in `docs/theory/` and cites where the answer came from. It is not a chatbot, not supervision, and not a consultation. The locating assistant from proposal 02 is a separate, narrower tool with a stricter output; this one may write prose because its job is to explain documents, and every paragraph of that prose carries a citation that resolves to a real section.

---

## 1. The corpus

`docs/theory/` plus `docs/theory/paper.md` (the full paper, now in the repo). Built at deploy time into a single system-prompt prefix with a section index (`doc slug → heading → char range`), sent with Anthropic prompt caching so each question pays the cached-read rate on the corpus. No retrieval layer, no vector store, no new service: the corpus is small enough to be read whole, and reading it whole is more faithful than chunking it.

Budget rule: the prefix must stay under 170k tokens. Code measures and reports the count. If it ever exceeds the budget, the paper's appendices come out first, then the research notes; the protocols and floor notes never come out.

## 2. `POST /v1/assistant/ask`

Input: `{ threadId?, question, attachment? }` as the clinician. `attachment` is at most one of `{ formulationId }` or `{ clientId, kind: 'calibration' }` — the former sends the formulation's observation ids, floor, and protocol (never the note); the latter sends `summarizeLedger()` output (numbers, never prose). The attachment is shown in the transcript so it is always visible what the assistant was given.

Output, structured:

```
{
  inCorpus: boolean,
  answer: string,                       // paragraphs
  citations: [{ doc: slug, heading: string }],   // ≥1 per paragraph when inCorpus
  nearest?: { doc, heading }            // when !inCorpus
}
```

Validated in code before anything reaches the clinician: every citation resolves against the section index or the whole response is rejected and retried once; when `inCorpus` is false the answer is replaced by the fixed template ("This isn't covered in the corpus. The nearest section is …") regardless of what the model wrote. A paragraph without a citation is dropped.

Fixed refusals, tested with a fixture: requests for a diagnosis, medication guidance, or a risk plan get the corpus's own gate language and a pointer to the clinician's supervision and crisis protocol — the assistant does not produce a plan. Requests to "just give me your opinion" get the same treatment as out-of-corpus.

Rate limits: 60 asks per clinician per hour, and the plan allowance below.

## 3. Transcripts

`assistant_threads (id, clinician_id, title_enc, created_at, deleted_at)` and `assistant_messages (id, thread_id, role, content_enc, citations jsonb, attachment jsonb, run_id → assistant_runs, created_at)`. Encrypted like everything else; readable and deletable only by the owning clinician; soft-deleted rows hard-deleted by the existing 30-day job; excluded from the research export by the allowlist. The clinician app's assistant panel is persistent and context-aware — it opens with the current page's document preloaded as context, which is the one place the app supplies context without being asked.

Same PHI stance as the locator: clinicians will paste client details whether warned or not, so every ask is a PHI hop under `ASSISTANT_ENABLED` and the BAA. The panel's placeholder text says not to include identifying details; the system treats every message as if they did.

## 4. Metering

`assistant_runs` gains `kind ('locate' | 'ask')`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_micros`. Cost is computed from a price table in config (`AI_PRICE_TABLE_VERSION` plus per-model rates in env), never hard-coded, so a price change is a config change with a version stamp on every row from then on.

Caps, each returning a plain 503 or 402 with a sentence a clinician can act on: per-clinician daily runs (`ASSISTANT_DAILY_CAP`, default 200); global monthly spend (`ASSISTANT_GLOBAL_SPEND_CAP_USD`); and the kill switch (`ASSISTANT_ENABLED`). Client accounts never trigger a model call, so AI cost scales only with paying clinicians.

## 5. Billing — Stripe

**Condition of approval:** Stripe receives the clinician's email and payment details and nothing else. No client exists in Stripe's view of the world; no usage record names a client; product and price names contain no clinical language. `docs/data-path.md` records this as hop 9 with the explicit statement that Stripe holds no PHI and no BAA is needed for it.

- **Model:** one subscription per clinician. Plans carry a monthly allowance of assistant runs (locate and ask counted the same) in Stripe product metadata. Overage is opt-in: a clinician who turns it on is billed metered overage through Stripe usage records at the end of the period; one who doesn't hits a hard stop with a meter and a link to their portal. Default is off — predictable beats metered for this buyer.
- **Pricing rule:** allowance priced at no less than 3× measured cost per run from §4. Numbers live in Stripe, not the repo; the repo knows only allowance counts.
- **Table `subscriptions`:** `clinician_id, stripe_customer_id, stripe_subscription_id, status, plan, run_allowance, overage_enabled, period_start, period_end, updated_at`. Written only by the webhook handler. RLS: the clinician reads their own row; nothing else reads it.
- **Routes:** `POST /v1/billing/checkout` (Checkout Session), `POST /v1/billing/portal` (Customer Portal — card, plan change, cancel; nothing custom-built), `POST /v1/billing/webhook` (signature-verified, idempotent by event id, the only writer to `subscriptions`).
- **Entitlement check:** on every assistant call, in this order: kill switch → subscription status active or trialing → runs this period < allowance, or overage enabled → daily cap → global cap. Trial: 14 days with a fixed allowance, no card required, set in Stripe.
- **Clients are never affected by billing.** A lapsed clinician loses the assistant and, at `status = 'canceled'` past the period end, read access to the clinician app; their linked clients notice nothing. This restates proposal 02 §1 and is tested.

## 6. Tests that matter

Citation resolution rejects a fabricated heading; out-of-corpus questions get the template; the refusal fixture holds; a run with no active subscription returns 402 and writes no `assistant_runs` row; webhook replay is idempotent; the `subscriptions` table is invisible to clients; the research export allowlist still contains none of the new tables; the PHI-in-logs test covers `ask()` with a distinctive string.

## 7. Out of scope

Team or group practice plans; invoicing outside Stripe; any client-facing assistant; the assistant reading raw ledger prose; multi-currency.
