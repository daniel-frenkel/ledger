# Go-live gate — what must be true before a real client's data enters the beta

**Status:** the beta will include real clients. This document is the list of conditions, in order, and each one is either done or it isn't. Nothing here is legal advice; items marked ⚖ need a lawyer or the counsel a professional-liability insurer provides. The author is the vendor in this arrangement, not the treating clinician: under HIPAA, Loadbearing is a **business associate** of every clinician who uses it with a client, and every one of the subprocessors below is a business associate of Loadbearing.

## A. Agreements — nothing else matters until these exist

| # | Party | What | Status |
|---|---|---|---|
| A1 ⚖ | Loadbearing ↔ each clinician | **A BAA signed at clinician signup**, before any invite can be created. Template from counsel; click-through acceptance recorded with version and timestamp on the clinician's user row. The invite route refuses if `baa_accepted_version` is null. | not started |
| A2 | Database and auth | **Supabase's HIPAA add-on (~$599/mo) is out of reach for the beta, so production moves off Supabase.** Database: **Cloud SQL for PostgreSQL** in the same Google project as Cloud Run — covered by Google's BAA, which is free and self-service in the console. Smallest instance is on the order of $10–25/mo. It is plain Postgres: the `ledger_api` role, RLS, and the migrations apply unchanged. Auth: **Google Cloud Identity Platform** (verify it is on Google's current HIPAA covered-services list before relying on it), free at beta scale, email sign-in plus TOTP for B2; the API already verifies JWTs by JWKS URL, so this is config plus the client sign-in screen. Supabase stays as the free dev/CI database only. | not started |
| A3 | API hosting | A host that signs a BAA. Render's free and standard tiers do not; proposal 01 already required portability to **Google Cloud Run**, and Google's BAA covers Cloud Run. Prompt 2 changes target from Render to Cloud Run. | not started |
| A4 | Transactional email | The sign-in code email carries only a six-digit code, but the recipient list at the provider identifies people receiving mental-health care. Treat it as PHI: use a provider that signs a BAA (AWS SES under the AWS BAA, or Mailgun or Twilio SendGrid on their eligible plans — verify current terms). Gmail SMTP is test-only and must be gone. | not started |
| A5 | Anthropic | BAA plus zero-data-retention. **Not required for the beta** — `ASSISTANT_ENABLED` stays false and the Library, locator, ledger, and formulations all work without it. Required before the assistant is turned on. | not started |
| A6 ⚖ | Static web host | Not a PHI hop: the browser loads the app shell from it and talks to the API directly; no client data transits the static host. Document this in data-path and confirm the SPA never proxies API calls through it. | verify |
| A7 ⚖ | Business entity and insurance | An LLC (or equivalent) as the contracting party on A1, and cyber-liability insurance that covers PHI. Insurers often supply the BAA template and a security questionnaire — the questionnaire is a useful checklist. | not started |
| — | Sentry | Not enabled. Stays off in beta. If enabled later, Sentry signs BAAs on its business tier and the PII scrubbing already specified is required. | off |

## B. Controls the Security Rule expects — the ones the app does not yet have

| # | Control | Build |
|---|---|---|
| B1 | **Audit log of access to client data.** RLS enforces who *can* read; nothing records who *did*. `access_log (id, actor_id, actor_role, client_id, table, action, row_count, at)` written inside `withUser` for every clinician read of client rows and every export. Append-only, system-read-only, retained six years. Never stores content. | migration 0009 |
| B2 | **MFA for clinicians.** Email OTP is one factor. Supabase Auth supports TOTP; require enrollment before the first invite is created. Clients stay on email OTP. | clinician app + API check |
| B3 | **Account deletion, end to end.** Prompt 4 as written — soft-delete, revoke links, delete the auth user, 30-day hard delete. Required before any client exists. | **done** — migration 0007, PR for Prompt 4 |
| B4 | **Session and token hygiene.** Clinician sessions expire at 12 hours idle; client sessions at 30 days; refresh-token rotation on. Documented in data-path. | config |
| B5 | **Key management.** `FIELD_ENCRYPTION_KEY` moves from a `.env` file to the host's secret manager (Google Secret Manager under A3); rotation procedure written down and tested once with `key_version`. | Prompt 2 |
| B6 | **Backups and restore.** Supabase's under A2; one restore rehearsal into a scratch project, documented with the date. | procedure |
| B7 | **Risk analysis.** `docs/data-path.md` plus this document, reorganized into the shape a Security Rule risk analysis takes: assets, threats, existing controls, residual risk, owner, review date. Dated and re-reviewed annually. | document |
| B8 | **Breach procedure.** One page: who is notified, within what time, by whom, with the contact for each subprocessor. The clinician BAA (A1) has to reference it. | document ⚖ |
| B9 | **No PHI in logs — re-verified on the production host.** The test exists; run it against Cloud Run's logging once and keep the evidence. | Prompt 2 |

## C. Client-facing

| # | Item |
|---|---|
| C1 ⚖ | Privacy notice and terms for the client app, plain language, versioned, accepted at first sign-in and recorded. |
| C2 | The "not your therapist" and crisis framing already in the client app is reviewed once by a licensed clinician who is not the author. Name and date recorded in the repo. |
| C3 | The join screen states in plain words what the clinician can see and that the client can revoke it (proposal 02 §4) — already specified; confirm it shipped. |

## D. Beta agreement — the sentence that makes this work

The beta plan is free until pricing is announced, with 60 days' notice and founder pricing for beta members. It includes the clinician BAA (A1), a plain statement that the assistant is off until its data agreement exists, and a plain statement of what the beta does not yet have (Sentry-grade error reporting; no uptime commitment). Beta clinicians are asked to run at least one client on the ledger for six weeks and to answer a usability instrument at the end — that is the feasibility study in proposal 03, and it needs their research consent separately from the clinical agreement.

## Order

A7 → A1 template → A2 and A3 together (Prompt 11 moves auth and the database; Prompt 2 deploys) → A4 → B3 (Prompt 4, done) → B1, B2 (migration 0009) → B5, B9 with the deploy → B4, B6, B7, B8, C1, C2 → the first clinician signs A1 → the first invite.

Everything in proposals 02–04 continues in parallel; none of it is gated on this list except turning the assistant on, which is gated on A5.
