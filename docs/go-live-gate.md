# Go-live gate — what must be true before a real client's data enters the beta

**Status:** the beta will include real clients. This document is the list of conditions, in order, and each one is either done or it isn't. Nothing here is legal advice; items marked ⚖ need a lawyer or the counsel a professional-liability insurer provides. The author is the vendor in this arrangement, not the treating clinician: under HIPAA, Loadbearing is a **business associate** of every clinician who uses it with a client, and every one of the subprocessors below is a business associate of Loadbearing.

## Agreements in force

Two BAAs are accepted. Each names the file that evidences it, per the standing
rule that a gate closes on evidence and not on a sentence claiming the evidence
exists.

### Google Cloud — accepted 11 September 2026

By daniel@courageloop.com, scoped to `courageloop-prod`.
Evidence: [`compliance/courageloop-gcp-baa-accepted-2026-09-11.png`](compliance/courageloop-gcp-baa-accepted-2026-09-11.png)

Covers: **Identity Platform, Cloud SQL, Cloud Run, Secret Manager, Cloud Build,
Artifact Registry, Cloud NAT, VPC, Cloud Load Balancing, Cloud DNS, Cloud
Armor.**

That list settles two things that were open. **Cloud NAT and VPC are covered**,
which was the outstanding check on the A4 IP-allowlist option — it was flagged
as unresolved and is now resolved. **Cloud Load Balancing is covered**, which
is what the A10 load balancer runs on.

### Google Workspace / Cloud Identity — accepted 14 September 2026

By daniel@courageloop.com.
Evidence: [`compliance/courageloop-workspace-baa-accepted-2026-09-14.png`](compliance/courageloop-workspace-baa-accepted-2026-09-14.png)

Covers **Gmail**, which is what makes the A4 SMTP relay path available at all.

**An ongoing obligation, not a one-time step.** The Workspace BAA covers only
services on Google's HIPAA Included Functionality list, and **third-party
Marketplace add-ons are explicitly outside it**. So a Workspace-adjacent
integration gets the same covered-and-GA check as any Google Cloud service —
the fact that it installs into a covered product does not make it covered. It
is the same rule as Prompt 0's, applied to a place it is easy not to look.

---

## Hostnames of record

Settled with the rename to CourageLoop (Prompt 15). Every placeholder elsewhere resolves to one of these.

| Host | What it serves | PHI |
|---|---|---|
| `courageloop.com` | The public site and the clinician app. `www` redirects to the apex. | The clinician app reads client rows once signed in; the site itself carries none. |
| `app.courageloop.com` | The client PWA, and the `/join` target in an invitation link. | App shell only — see A6. The data is in IndexedDB and at the API, never on the static host. |
| `api.courageloop.com` | The API. | Yes. Every hop below that says "the API" is this host. |

The API's CORS allowlist is exactly these three origins, from `CORS_ORIGINS`, and never a wildcard: `*` and any entry with a trailing slash or path are rejected at boot rather than failing later as a silent refusal.

## A. Agreements — nothing else matters until these exist

| # | Party | What | Status |
|---|---|---|---|
| A1 ⚖ | Loadbearing ↔ each clinician | **A BAA signed at clinician signup**, before any invite can be created. Template from counsel; click-through acceptance recorded with version and timestamp on the clinician's user row. The invite route refuses if `baa_accepted_version` is null. **Part of the first-invite cluster below.** | **mechanism done, document outstanding** — migration 0008 and the acceptance flow work; `docs/legal/clinician-baa.md` is a DRAFT placeholder. **Owner: Daniel. Completion condition: requires health care attorney review.** Not a Code item — no legal text is to be drafted here, and the placeholder says so at the top of itself. |
| A2 | Database and auth | **Supabase's HIPAA add-on (~$599/mo) is out of reach for the beta, so production moves off Supabase.** Database: **Cloud SQL for PostgreSQL** in the same Google project as Cloud Run — covered by Google's BAA, which is free and self-service in the console. The beta starts on a shared-core instance at ≈$12/mo and moves to ≈$52/mo before any real client's data — see A8. It is plain Postgres: the `ledger_api` role, RLS, and the migrations apply unchanged. Auth: **Google Cloud Identity Platform** (verify it is on Google's current HIPAA covered-services list before relying on it), free at beta scale, email sign-in plus TOTP for B2; the API already verifies JWTs by JWKS URL, so this is config plus the client sign-in screen. Supabase stays as the free dev/CI database only. | **code done, instance not created** — Prompt 11: both providers behind one seam, `AUTH_PROVIDER` picks one; BAA accepted 11 Sept 2026 for `courageloop-prod`; **Instance created 14 Sept 2026** (private IP only, `db-f1-micro`, PITR and deletion protection on). **Stays open**: the verification cannot run from outside the VPC — the Auth Proxy must be on a resource in the instance's VPC, and `constraints/sql.restrictPublicIp` is enforced org-wide and stays enforced — so it runs as a Cloud Run job in Prompt 2. CI already proves the schema on vanilla Postgres; this closes on Google's build. See `docs/gcp-setup.md` §6. |
| A3 | API hosting | A host that signs a BAA. Render's free and standard tiers do not; proposal 01 already required portability to **Google Cloud Run**, and Google's BAA covers Cloud Run. Prompt 2 changes target from Render to Cloud Run. | **procedure written 14 Sept 2026, not executed** — `docs/deploy.md`: image, service account, Secret Manager bindings, and the org-policy exception public ingress needs. Closes on a deployed service answering /health, not on this document. |
| A4 | Transactional email | The sign-in code email carries only a six-digit code, but the recipient list at the provider identifies people receiving mental-health care. Treat it as PHI: use a provider that signs a BAA (AWS SES under the AWS BAA, or Mailgun or Twilio SendGrid on their eligible plans — verify current terms). Gmail SMTP is test-only and must be gone. **Identity Platform is a covered service and its built-in sender is permitted under the BAA** — the requirement here is not a compliance one. It is that the sender must be an address on `courageloop.com`, that deliverability to real inboxes has to be someone's responsibility, and that the message body has to be ours to write: a sign-in email is the first thing a client ever sees from this, and it should say what it is. The send path is built (`docs/deploy.md` §11): the API mints the link and composes the message; Identity Platform never sends, and its Custom SMTP setting stays off permanently. See **the first-invite cluster** below, and **the open question** under it. | not started — still required after Prompt 11, for those reasons |
| A5 | Anthropic | BAA plus zero-data-retention. **Not required for the beta** — `ASSISTANT_ENABLED` stays false and the Library, locator, ledger, and formulations all work without it. Required before the assistant is turned on. | not started |
| A6 ⚖ | Static web host | Not a PHI hop: the browser loads the app shell from it and talks to the API directly; no client data transits the static host. Document this in data-path and confirm the SPA never proxies API calls through it. | **host changed 14 Sept 2026; confirmation outstanding** — **not Firebase Hosting**: it is not on Google's HIPAA covered-products list and both apps touch PHI. Each app is its own Cloud Run service, `docs/deploy.md` §8, with the network-panel check to run after the first deploy. |
| A7 ⚖ | Business entity and insurance | An LLC (or equivalent) as the contracting party on A1, and cyber-liability insurance that covers PHI. Insurers often supply the BAA template and a security questionnaire — the questionnaire is a useful checklist. | not started |
| A8 | Database tier | **The Cloud SQL instance must be on a dedicated-core tier with an SLA before the first invite link is sent to anyone outside the build.** See **the first-invite cluster** below — this is one of three, and none of them is independently skippable. The beta starts on a shared-core tier (`db-f1-micro`, ≈$12/month all-in) because no client data is in it and the SLA is not worth paying for yet; shared-core carries none. The move is an instance edit and a restart of a few minutes, to ≈$52/month for 1 vCPU and 3.75 GB. Do it with nothing at stake. Backups, point-in-time recovery, deletion protection and private IP are on from the first day at either tier — only CPU and the SLA are being economised. `docs/gcp-setup.md` §9. | not started |
| A9 | `FIELD_ENCRYPTION_KEY` backed up | **The key is backed up outside this project before the secret version is created.** It is the one value in the system that cannot be regenerated: it decrypts every journal entry, prediction, prior label and body-state note, and losing it leaves all of that present in the database and permanently unreadable. Backups do not help — they contain the same ciphertext. `docs/deploy.md` §2 makes the backup a numbered precondition rather than an afterthought. Closes on the backup existing and having been read back once, not on the key existing. | not started |
| A10 | Public hostnames | **The two apps are served from `courageloop.com` and `app.courageloop.com` behind the global external Application Load Balancer, with an SSL policy pinned to a TLS 1.2 minimum, before the first invite link is sent to anyone outside the build.** Until then they are on their generated `*.run.app` URLs, which are GA and free and which this project cannot put a TLS floor on — Google publishes no minimum version for them and no SSL policy can be attached. Cloud Run domain mappings are **not** the answer: they are a Pre-GA offering, and Google's HIPAA guidance says not to use Pre-GA offerings with PHI. The full procedure is written out in `docs/deploy.md` §8 to be executed at the gate. **Closes on the TLS 1.1 handshake being refused on both hostnames** — not on the policy being attached, which is a different claim. | not started |
| — | Sentry | Not enabled. Stays off in beta. If enabled later, Sentry signs BAAs on its business tier and the PII scrubbing already specified is required. | off |

### The first-invite cluster — A1, A4, A8, A10

These four share a trigger, and it is not "the first real client's data". It is
earlier and more precise: **the first invite link sent to anyone outside the
build.**

- **A1** — the BAA CourageLoop offers the clinician, reviewed by a health care
  attorney. The mechanism is built and the document is a placeholder; a
  clinician cannot meaningfully accept text nobody has reviewed. Owned by
  Daniel, not by Code.
- **A4** — a BAA-signing SMTP sender, so the invitation arrives from
  `courageloop.com` and not from a Google default.
- **A8** — a dedicated-core database with an SLA, so the thing on the other end
  of the link has one.
- **A10** — the real hostnames behind the load balancer with a TLS 1.2 floor,
  so the link is to `app.courageloop.com` and not to a generated `*.run.app`
  address.

A1 belongs here rather than in a gate of its own: it is the same trigger as the
other three, and it already existed as A1 before the cluster did. A second row
for the same obligation would be worse than none — two gates for one thing is
how one of them gets closed while the other quietly stays open.

The reason the trigger is the invite and not the data: a client receiving a
`run.app` URL from their therapist, and being asked to enter personal material
into whatever opens, is being taught to trust a link shape that the rest of
this product spends its time teaching them to distrust. The first time someone
outside the build is asked to trust this, all three have to be true.

**None of the four is independently skippable, and any one of them open holds
the other three.** Three out of four is not three-quarters of the way there; it
is a sound domain serving an app on an unsupported tier, or a hardened endpoint
whose invitation lands in spam, or a clinician clicking Accept on text no
lawyer has read.

### Accepted risk — a caller with the public key can cause a send

**Decided 14 September 2026. This is closed as an accepted risk, not left
open.** An open item nobody can close becomes noise that trains people to skim
the list.

**Why it cannot be designed away.** Email-link sign-in *requires* the email
provider enabled, and `accounts:sendOobCode` is unauthenticated by design —
that is how anyone signs in for the first time. "Disable what can fire" has a
floor, and the floor is the product. So the residual is real and the question
is what reduces it.

**Four steps, three of which are actions.**

1. **Verify `emailPrivacyConfig.enableImprovedEmailPrivacy`.** Enumeration
   protection removes the distinguishing error responses from `PASSWORD_RESET`
   and `VERIFY_AND_CHANGE_EMAIL`, which is exactly what turns a send endpoint
   into an *existence oracle* — and an existence oracle on a mental health
   product is a disclosure question, not a spam one. Google enables it by
   default for projects created on or after 15 September 2023, and
   `courageloop-prod` was created 11 September 2026, so it is very likely
   already on. **Likely is not evidence.** Read it:

   ```powershell
   $project = 'courageloop-prod'
   $headers = @{ Authorization = "Bearer $(gcloud auth print-access-token)"; 'X-Goog-User-Project' = $project }
   Invoke-RestMethod -Method Get -Headers $headers `
     -Uri "https://identitytoolkit.googleapis.com/admin/v2/projects/$project/config" |
     ConvertTo-Json -Depth 10
   ```

   If it is on, record it here as verified with the date and the output. If it
   is off, turn it on — that one is not a judgment call.

2. **Set the project's public-facing name to CourageLoop**, so the default
   template stops naming `courageloop-prod`. Identity Platform → Settings.

3. **Add HTTP referrer restrictions to the browser API key**, limited to
   `courageloop.com` and `app.courageloop.com`. **Partial, and labelled that
   way deliberately:** referrers are set by the client and are trivially
   spoofed. This raises the cost of casual abuse and does **nothing** against a
   determined caller. It is not a control and should not be written up as one.

4. **Then accept the residual.** Someone holding the public key can cause a
   sign-in or reset message to be sent to an address they already know. They
   cannot learn whether that address is registered, once step 1 is confirmed.

**The mitigating fact, recorded in the same place as the risk** so the two are
read together: those messages go out **from Google's built-in sender, not from
`courageloop.com`**. Abuse costs the project's sending reputation rather than
our domain's — the A4 relay path covers sign-in and only sign-in, and that
turns out to be a boundary worth having rather than a gap to close.

**What would change this.** A report of someone actually being mailed
repeatedly, or a change that routes these messages through our own sender —
the second would move the reputational cost onto `courageloop.com` and this
entry would need reopening.

## B. Controls the Security Rule expects — the ones the app does not yet have

| # | Control | Build |
|---|---|---|
| B1 | **Audit log of access to client data.** RLS enforces who *can* read; nothing records who *did*. `access_log (id, actor_id, actor_role, client_id, table, action, row_count, at)` written inside `withUser` for every clinician read of client rows and every export. Append-only, system-read-only, retained six years. Never stores content. | **done** — migration 0008; wired to the two clinician reads that exist, the rest at Prompts 3 and 8 |
| B2 | **MFA for clinicians.** Email sign-in is one factor. Require TOTP enrollment before the first invite is created. Clients stay on email sign-in. | **done** — migration 0008; the level is read through `AuthAdmin.assuranceLevel()`, and Prompt 11 swapped the implementation without touching the check, exactly as intended. Identity Platform mints the claim at sign-in rather than at enrollment, so the setup screen asks for one more sign-in. |
| B3 | **Account deletion, end to end.** Prompt 4 as written — soft-delete, revoke links, delete the auth user, 30-day hard delete. Required before any client exists. | **done** — migration 0007, PR for Prompt 4 |
| B4 | **Session and token hygiene.** Clinician sessions expire at 12 hours idle; client sessions at 30 days; refresh-token rotation on. Documented in data-path. | config |
| B5 | **Key management.** `FIELD_ENCRYPTION_KEY` moves from a `.env` file to the host's secret manager (Google Secret Manager under A3); rotation procedure written down and tested once with `key_version`. | **procedure written 14 Sept 2026, not executed** — `docs/deploy.md` §2 puts it in Secret Manager and never in a plain env var. The rotation rehearsal is outstanding, and a rehearsal is the evidence this closes on. |
| B6 | **Backups and restore.** Supabase's under A2; one restore rehearsal into a scratch project, documented with the date. | procedure |
| B7 | **Risk analysis.** `docs/data-path.md` plus this document, reorganized into the shape a Security Rule risk analysis takes: assets, threats, existing controls, residual risk, owner, review date. Dated and re-reviewed annually. | document |
| B8 | **Breach procedure.** One page: who is notified, within what time, by whom, with the contact for each subprocessor. The clinician BAA (A1) has to reference it. | document ⚖ |
| B9 | **No PHI in logs — re-verified on the production host.** The test exists; run it against Cloud Run's logging once and keep the evidence. | **procedure written 14 Sept 2026, not executed** — `docs/deploy.md` §9: a distinctive string through a real request, then a Cloud Logging query whose expected result is no entries. The query and its empty output are the evidence. |

## C. Client-facing

| # | Item |
|---|---|
| C1 ⚖ | Privacy notice and terms for the client app, plain language, versioned, accepted at first sign-in and recorded. |
| C2 | The "not your therapist" and crisis framing already in the client app is reviewed once by a licensed clinician who is not the author. Name and date recorded in the repo. |
| C3 | The join screen states in plain words what the clinician can see and that the client can revoke it (proposal 02 §4) — already specified; confirm it shipped. |

## D. Beta agreement — the sentence that makes this work

The beta plan is free until pricing is announced, with 60 days' notice and founder pricing for beta members. It includes the clinician BAA (A1), a plain statement that the assistant is off until its data agreement exists, and a plain statement of what the beta does not yet have (Sentry-grade error reporting; no uptime commitment). Beta clinicians are asked to run at least one client on the ledger for six weeks and to answer a usability instrument at the end — that is the feasibility study in proposal 03, and it needs their research consent separately from the clinical agreement.

## Order

A7 → A1 template → A2 and A3 together (Prompt 11 moves auth and the database; Prompt 2 deploys) → A4 → B3 (Prompt 4, done) → B1, B2 (migration 0008, done) → B5, B9 with the deploy → B4, B6, B7, B8, C1, C2 → the first clinician signs A1 → **A8, the tier upgrade** → the first invite.

A9 is not in that sequence because it is not a step in it: the key is backed up before the secret version is created, which is before anything else on this list can run.

A1, A4, A8 and A10 are the cluster above and fire together at the first invite.

A8 sits where it does deliberately: it is the last thing before a real client's data exists, and it is the only item on this list that gets cheaper to do the earlier it is done.

Everything in proposals 02–04 continues in parallel; none of it is gated on this list except turning the assistant on, which is gated on A5.
