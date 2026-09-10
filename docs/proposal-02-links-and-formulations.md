# Proposal 02 — Invites, formulations, and the locating assistant

**Status:** approved for build (Sept 2026). Supersedes nothing; extends proposal 01. Migration `0003_links_formulations.sql` is additive. Nothing here changes what the client sees on the mismatch screen, the ledger sentence, or the crisis card.

**Status update, 10 Sept 2026 — what shipped differs from the text below in these ways (PRs #17, #18):**
- `redeem_invite()` takes a fourth argument, `p_link_id`: every id in the schema is an app-minted v7 UUID and a SECURITY DEFINER function has no v7 generator, so the link id is passed in rather than generated database-side.
- `formulations` is append-only by three mechanisms, not one: no UPDATE/DELETE grant, no UPDATE/DELETE policy, and a trigger. `deleted_at` exists for the future deletion job but the API role cannot write it.
- The 20-open-invite cap is a trigger (a CHECK cannot count rows) and is also enforced in the route.
- The `gates` CHECK requires all three keys present and boolean (a missing key made the original CHECK evaluate to NULL and pass); the route additionally requires all three TRUE and returns 422 naming the failing gate.
- Every invite failure — unknown, used, expired, revoked, self, malformed body — returns the same 404 and the same sentence; a 400 would confirm the token was well-formed.
- `GET /v1/clients/:id/formulations` through a revoked link returns `[]`, not 403.
- Rate limits key on the authenticated user id, not the client IP.
- `/join` renders the sign-in flow itself rather than redirecting (a redirect drops the fragment), reads the token into memory on mount, and clears it from the address bar with `replaceState`.

**Status update, 11 Sept 2026 — Parts 3 and 4 (PRs #19, #20):**
- Scoring lives in `packages/shared/src/floors/`, not the vocabulary module. Observation ids are stable names (e.g. `body-signal-as-world`), not integers; the API rejects unknown ids with 422. Gate ids are `risk`, `dial`, `calibrated`.
- The clinician app has its own session (email OTP) and assembles the invite URL client-side, shown once.
- The client picker shows a truncated UUID; no names by design until case labels (proposal 05).
- `assistant_runs` gained `gate_question_ids` beyond the column list in §5, so the "assistant never clears a gate" audit has something to check. Row shape is asserted column-by-column in `assistant.test.ts`.
- The assistant migration is `0004`, not part of `0003`. `ASSISTANT_ENABLED` defaults false; the route returns 503 with no model call. The system prompt is read from `docs/theory/` on disk, so the deployment image must carry it (Prompt 2).

**Why one proposal.** The three pieces share a migration and a trust model. The product is clinician-facing; the clinician invites the client; the clinician formulates; the assistant helps the clinician formulate. Every write path below is either the clinician acting on their own working notes, or the client acting on their own consent. There is still no path by which a clinician writes into a client's data beyond `safe_to_test` and clinician-origin priors.

---

## 1. Invites — how a link comes into existence

Today `clinician_client_links` records consent but nothing creates one. The clinician originates; the client consents at redemption.

### Table `link_invites`

| column | type | notes |
|---|---|---|
| `id` | uuid | v7 |
| `clinician_id` | uuid → users | must have role `clinician` (trigger) |
| `token_hash` | bytea | SHA-256 of the token; the token itself is never stored |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | `created_at + 7 days`, not editable |
| `redeemed_at` | timestamptz null | set once |
| `redeemed_by` | uuid null → users | the client |
| `link_id` | uuid null → clinician_client_links | set at redemption |
| `revoked_at` | timestamptz null | clinician can revoke an unredeemed invite |

Token: 32 random bytes, base64url. Shown to the clinician once, in the response that creates it, never again. Invite URL is `https://<web>/join#<token>` — in the fragment, so it never reaches a server log, a referrer header, or a proxy.

Limits, enforced in the route and mirrored by a check constraint where possible: 20 unredeemed invites per clinician; 10 creations per hour per clinician.

### Redemption

`POST /v1/invites/redeem` `{ token, sharePredictions, shareBodyStates }`, called as the signed-in client. The client has no RLS visibility into `link_invites`, so redemption runs through a `SECURITY DEFINER` function `redeem_invite(token_hash, share_predictions, share_body_states)` in the pattern of `app_link_allows()`:

1. `UPDATE link_invites SET redeemed_at = now(), redeemed_by = request.user_id WHERE token_hash = $1 AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING clinician_id` — the single-use guarantee is this one statement.
2. Insert the link: `status = 'active'`, `consented_at = now()`, share flags from the client's arguments, `client_id = request.user_id`.
3. Set `link_invites.link_id`.
4. Refuse if `request.user_id = clinician_id` (`links_not_self` already covers the insert; check early anyway).

Any failure — unknown, expired, used, revoked, self — returns the same 404 with the same body. Nothing distinguishes "no such token" from "already used."

### Consent stays the client's

`links_consent_guard` extends: `share_predictions` and `share_body_states` are writable only when `request.user_id = client_id`. The clinician can set `status = 'revoked'` on their own links and nothing else. The client can revoke too. Revocation never touches client rows — the client's ledger is theirs whether or not a clinician is attached, and whether or not the clinician's subscription exists. `docs/data-path.md` says this in the "who can read what" table.

### No directory

Clients never search for clinicians. There is no endpoint that lists clinicians, and no error that confirms a clinician exists. Note it in data-path as a deliberate absence.

---

## 2. Formulations — where the locator's output lives

### Table `formulations`

| column | type | notes |
|---|---|---|
| `id` | uuid | v7 |
| `clinician_id` | uuid → users | author |
| `client_id` | uuid → users | |
| `link_id` | uuid → clinician_client_links | must be active at write time (trigger via `app_link_allows`) |
| `version` | smallint | 1 on first formulation for the pair; +1 per re-aim; `UNIQUE (clinician_id, client_id, version)` |
| `note_enc` | bytea | the clinician's note, AES-256-GCM, `key_version` |
| `observations` | jsonb | array of observation ids from the locator's list — ids only, validated against `packages/shared` |
| `gates` | jsonb | `{ risk: bool, dial: bool, calibrated: bool }` — the clinician's attestation, never the assistant's |
| `floor` | smallint | 1–8 |
| `protocol_slug` | text null | one of the thirteen, or null |
| `falsify_enc` | bytea | what the clinician says would show this placement wrong; required |
| `assistant_run_id` | uuid null → assistant_runs | if the assistant contributed |
| `created_at` | timestamptz | |

Append-only, like `reinterpretations`: no UPDATE, no DELETE except by the deletion job. A re-aim is a new row with `version + 1`. The clinician app renders "Re-aim N of 2" from `version`, and at `version = 3` the result panel says the formulation is on trial — `docs/theory-mapping.md` §8, "after the second re-aim on the same case, the formulation itself goes on trial."

**RLS.** Read and insert: `clinician_id = request.user_id` and `app_link_allows(client_id)`. The client does not read formulations in this version — they are the clinician's working notes, the way a paper chart is. Revisit when the client-facing "why" is designed; say so in data-path.

**What the client app never sees.** The floor, the observations, the gates, the note. The client app's vocabulary rule is unchanged.

---

## 3. The locating assistant

`POST /v1/assistant/locate` `{ clientId, note }` as the clinician. Lives in `packages/api/src/services/ai.ts`, the only place the Anthropic SDK is called.

### What it is allowed to say

The model returns **only** this, as a strict structured output:

```
{
  observations: [{ id: <locator observation id>, evidence: [<verbatim span from note>, ...] }],
  gateQuestions: [<one of a fixed set of three strings, or omitted>],
  selfReportOnly: boolean
}
```

Every `evidence` span is validated in code as an exact substring of the note. An observation with no valid span is dropped before the response is built. There is no free-text field. The model therefore cannot produce a diagnosis, a label, a recommendation, or a sentence the clinician didn't write — the schema has nowhere to put one.

### What the API computes

- Floor scores: `scoreFloors(observationIds)` — the locator's weighting, **moved from the web app into `packages/shared`** so the browser, the API, and the tests run one function. The model never sees or emits a floor.
- Protocol routes and the falsify line: from the shared floor data.
- The gate questions are the three gates, phrased as questions, included when the note gives no evidence the gate was addressed. The assistant never clears a gate.

The response to the clinician app is the pre-filled locator: ticked observations with their quoted evidence, gate questions, floor candidates, protocols, and a `selfReportOnly` warning when the note contains statements the client made about themselves but nothing the clinician observed. The clinician ticks, unticks, attests the gates, and writes the formulation. The formulation row records `assistant_run_id` so it is always visible that the assistant contributed.

### What it is pinned to

The system prompt contains, verbatim from `docs/theory/`: the locator's nine observations and their definitions; the Decision Aid; the three gates; and the line "the floor is read from signs and patterns the client is the last to see, not asked for by self-report." Nothing else. It does not receive the ledger, the priors, or any prior formulation.

### PHI

The note is PHI and this is the first hop where a third party reads client information in prose.

- `ASSISTANT_ENABLED` env var, default false. The route returns 503 with a plain message ("The locating assistant is off until the data agreement is in place") when it is false or `ANTHROPIC_API_KEY` is absent. It ships off.
- Table `assistant_runs`: `id, clinician_id, client_id, note_sha256, observation_ids, gate_question_ids, model, latency_ms, created_at`. No note text, no evidence spans. The note is not logged anywhere; the PHI-in-logs test gets a case for this route.
- `docs/data-path.md` gets hop 8: clinician note → API → Anthropic (BAA, zero-data-retention), with the open item that the BAA must be signed before `ASSISTANT_ENABLED` is ever true.
- Rate limit: 30 runs per clinician per hour.

### Evaluation, not vibes

`docs/theory/eval/locate-notes.md` — a fixture of short clinical notes, each with the floor the author would place it on and the observations he'd tick. Code scaffolds the file with three placeholder rows marked as placeholders; the author fills it. `pnpm --filter @ledger/api eval:locate` (manual, not CI, needs the key) runs the notes and prints agreement on observations and on floor. Below 80% floor agreement on the author's own notes is a prompt problem, and the number goes in the report.

---

## 4. Web client — the join page

`apps/web`: `/join` reads the token from the fragment, holds it in memory only, sends the client through sign-in if needed, then shows one screen: who is inviting (no name exists in the system; it says "a clinician has invited you"), the two share toggles in plain language ("Your clinician can read what you wrote" / "Your clinician can see your body notes"), a line that they can change these or end the link at any time from Settings, and one button. On success: the Open screen. On failure: "This invitation isn't valid. Ask your clinician for a new one." Same message for every failure.

---

## 5. Out of scope here

Billing and caseload metering; the client reading formulations; the assistant seeing ledger entries; any client-facing assistant; Prompt 3's clinician ledger view (it is re-cut on top of this).
