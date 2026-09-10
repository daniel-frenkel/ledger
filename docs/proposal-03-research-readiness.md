# Proposal 03 — Research readiness

**Status:** approved for build (Sept 2026). Additive migration `0004_research.sql`, meant to land in the same cycle as `0003`. Nothing here changes what any user sees except one new Settings screen on the client and one small form on the clinician side. Nothing here is a study; it is the set of columns and documents without which a study could not be run later.

**Principle.** The app should be able to answer "did it work" without anyone having to reconstruct what happened from memory. Every claim a paper would make — the prediction was written before the event; symptoms changed; the protocol started on this date; the participant agreed to this — has to be a row, written at the time, by the person entitled to write it.

---

## 1. Provenance on every row

- **`app_version text`** on `predictions`, `priors`, `body_states`, `reinterpretations`, `journal_entries`, `crisis_events`, `formulations`, `measures`, `phase_events`, `usage_events`. Nullable for rows that predate it; the client and clinician apps set it from the build. Results are reproducible against a build, and the calibration functions in `packages/shared` are versioned with it.
- **`received_at timestamptz`** on every synced client table: server clock on first insert, immutable by trigger. `created_at` and `client_updated_at` are the client's clock; `received_at` is the server's. The pair is the evidence that a prediction existed before its outcome, which is the study's central methodological claim.

## 2. `measures`

> **Built early, in migration 0006 with Prompt 14.** The table exists with all eleven instruments in the enum; only `ims` is wired, with its three published subscales. Prompt 8 wires the rest and adds `app_version` / `received_at`. **TODO for Prompt 8:** add `counts_for` to the research export allowlist — proposal 06 asks for it and the export module does not exist yet.


| column | type | notes |
|---|---|---|
| `id` | uuid | v7 |
| `client_id` | uuid → users | |
| `clinician_id` | uuid null → users | null when self-administered |
| `instrument` | enum | `phq9`, `gad7`, `pcl5`, `pdss`, `isi`, `ocir`, `shai`, `pg13`, `ims`, `sus`, `umars` — the instruments the protocols name, the Immunization Scale (Ewen, Rief & Wilhelm 2022 — subscales `negative_expectations`, `assimilation`, `cognitive_immunization`), and the two usability scales. No `custom`: a custom label is free text |
| `score` | numeric | total |
| `subscales` | jsonb null | numeric values keyed by the instrument's published subscale names; validated against a per-instrument schema in `packages/shared` |
| `administered_at` | timestamptz | |
| `administered_by` | enum | `client`, `clinician` |
| `app_version`, `received_at`, `created_at` | | |

Append-only. RLS: the client reads and writes their own; the clinician reads through an active link and writes only with `clinician_id = request.user_id`. Item-level responses are **not** stored in this version — totals and subscales only. If item-level data is ever wanted it is a new proposal, because some items are sensitive free-text-adjacent (PHQ-9 item 9 in particular) and the crisis rules would need to see them.

## 3. `phase_events`

| column | type | notes |
|---|---|---|
| `id` | uuid | |
| `client_id`, `clinician_id` | uuid | active link required (trigger) |
| `formulation_id` | uuid null → formulations | |
| `protocol_slug` | text | one of the thirteen |
| `phase` | smallint | the protocol's own phase number; `0` is the gates |
| `kind` | enum | `started`, `completed`, `paused`, `abandoned` |
| `at` | timestamptz | clinician-entered date, may be backdated within 14 days |
| `app_version`, `received_at`, `created_at` | | |

Append-only, clinician-written. No note column. This is the vertical line on a multiple-baseline graph. The clinician app's protocol page gets a small "Mark phase" control that writes here.

## 4. Research consent

On `users`: `research_consent_at timestamptz null`, `research_consent_withdrawn_at timestamptz null`, `research_consent_version text null`. Column-level grant like `timezone`: only the user writes their own; nothing else can. Separate from clinician sharing in every way — different screen, different flags, and withdrawing one does not touch the other.

Client Settings gains "Research" with the plain-language text from `docs/research/consent-text.md` (drafted here, to be replaced by the IRB-approved version; the version string is what gets stored), a single toggle, default off, and a line that withdrawal is immediate and removes them from future exports. The clinician app shows nothing about a client's research consent — it is not the clinician's business and must not become a pressure.

## 5. `usage_events`

`id, user_id, kind, app_version, created_at`. `kind` is an enum: `app_open`, `prediction_created`, `prediction_resolved`, `ledger_viewed`, `sync_completed`, `crisis_card_shown`, `settings_opened`. No payload column, no entity id, no text of any kind — a test asserts the table has exactly these columns. RLS: users write their own; only the system role reads. Feeds the feasibility paper (engagement, retention, time-to-resolution comes from `predictions` itself) and nothing else.

## 6. The de-identified export

`pnpm research:export --consented-only --dry-run|--write <dir>` runs as the `system` role in the pattern of the deletion job.

- **Who:** users with `research_consent_at` set and `research_consent_withdrawn_at` null at run time. No one else, ever, including the author's own account unless consented the same way.
- **Pseudonyms:** `HMAC-SHA256(user_id, export_secret)` truncated, where `export_secret` is generated per export run and printed once. Two exports cannot be joined without it; the mapping is never stored.
- **Date shifting:** each participant gets one random offset in [−180, +180] days applied to every timestamp of theirs. Intervals within a participant are preserved exactly; calendar dates are not.
- **Columns:** an explicit allowlist in `packages/api/src/research/allowlist.ts`. Structured fields only: confidence, verdict, source, surprise, presence, exit forecast and actual, abandon reason, body channels and intensity and kit and credited-to, prior category (not label), measure scores, phase events, usage events, app_version. **Never** any `_enc` column, any label, any free text, any device row, any crisis-event detail beyond `occurred: true` and the level. A test asserts that no column outside the allowlist can appear in the output and that no `_enc` column is on the allowlist.
- **Output:** one CSV per table plus `codebook.md` generated from the allowlist with each column's type and meaning, so the methods section can cite it.
- **Log:** an `exports` row — run id, timestamp, participant count, allowlist hash. Nothing about who.

## 7. Documents

- `docs/research/hypotheses.md` — the preregistration draft. Design: multiple-baseline single-case experimental series across clients; baseline = ledger use before `phase_events.kind = 'started'` for phase ≥ 1; intervention = protocol phases. Primary outcome: change on the protocol's named instrument. Process measures: calibration slope across experiments (from `summarize()`), loud-miss rate, reinterpretation rate, exit named-vs-taken, kit-present survivals. Hypotheses, each falsifiable: H1 calibration improves across experiments within participant; H2 calibration improvement precedes and predicts symptom change; H3 reinterpretation rate — measured directly by `counts_for` per miss (proposal 06) and by the IMS at intervals — moderates H2 negatively; H4 loud misses produce larger subsequent confidence revisions than quiet misses; H5 body survivals without kit predict larger interoceptive-prior revision than with kit. Explicitly *not* hypothesized: that accuracy of fear-intensity forecasts (the interoceptive track's "how strong?") mediates outcome — Hilleke et al. (2025) found no such relation in exposure for panic; a null there is expected. Analysis sketch, stopping rules, and what would count as the model being wrong. Marked **draft for faculty review**; the file is dated on commit.
- `docs/research/consent-text.md` — the research consent screen text, plain language, marked draft pending IRB.
- `docs/research/reliability-study.md` — one page: the locator's inter-rater reliability design (two or more clinicians, same de-identified notes, independent placement, Cohen's κ), using the `docs/theory/eval/locate-notes.md` fixture as the stimulus set. No code yet.
- `docs/data-path.md` gains: the research export as a hop, the consent flag, and the statement that the assistant is out of scope for the first study.

## 8. Out of scope

IRB submission, site approval, analysis code, any recruitment; the assistant in any study; item-level questionnaire responses; a clinician-facing view of research status.
