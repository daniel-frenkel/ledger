# Data path

Where protected health information (PHI) lives, how it moves, and what protects it at each hop. This document is the reference for the HIPAA conversation; keep it current when the schema or the deployment changes.

## What counts as PHI here

Everything a client types is treated as PHI: prediction situations and outcomes, reinterpretations, prior labels, journal entries, body-state prose, and the timestamps that pair them. Confidence numbers, verdict enums, intensity scales, and rule identifiers are *not* identifying on their own, but they are always stored with a `user_id`, so the whole row is handled as PHI.

Identity (email, display name, phone) is **never** stored in the application database. The identity provider holds it — **Google Cloud Identity Platform** in production, Supabase Auth in local development and CI (go-live gate A2, decided 11 September 2026). The app database knows a user only as a UUID and a role.

Google's own guidance for Identity Platform says the same thing from the other side, and it is a condition of using the service with PHI rather than a suggestion: store only the minimum auth attributes, and put **no PHI in the display name, the photo URL, or a custom claim**. Nothing here does — the only attribute the tenant holds is an email address. The guidance's second condition, no SDKs or client libraries on a path that handles PHI, is satisfied by construction: both clients speak REST through `packages/shared/src/auth/identity-platform.ts` and the API verifies tokens with `jose`. Both conditions are recorded in `docs/gcp-setup.md`, because they are the kind of thing that stops being true by accident.

Identity Platform, Cloud SQL, Cloud Run and Secret Manager are all named on Google's HIPAA covered-products list (verified 11 September 2026), so the BAA covers the whole PHI path — identity, database, compute and secrets.

## Hops

**0. The hostnames.** `courageloop.com` serves the public site and the clinician app (`www` redirects to the apex); `app.courageloop.com` serves the client PWA and is the `/join` target in an invitation link; `api.courageloop.com` is the API. The two apps are separate origins from the API, so the browser asks permission before either may call it: the allowlist is those exact three origins, read from `CORS_ORIGINS` at boot, and a wildcard is rejected rather than accepted — see `packages/api/src/config.ts` and `packages/api/test/cors.test.ts`. An origin that is not on the list gets no `Access-Control-Allow-Origin` header at all.


**1. On the phone.** Entries are written first to an SQLite database in the app's sandbox (`expo-sqlite`). The database file is inside the OS-protected app container; on iOS it is additionally covered by Data Protection when the device is locked. The Supabase session token lives in `expo-secure-store` (Keychain / Keystore), never in AsyncStorage. There is no analytics SDK in the client. Sentry, if enabled on the client, is configured with `sendDefaultPii: false` and a `beforeSend` that strips every field except the error type and stack.

**1a. In the browser (the web client).** `apps/web` is the milestone-1 client, and its local mirror lives in the browser's IndexedDB rather than an app sandbox. The difference matters: the store is protected by the browser profile and the operating-system account behind it, not by an app container, so anyone with the unlocked profile can read it, and a shared or unlocked computer is a real exposure that the phone's container was not. The Supabase session is held in memory and in the Supabase client's own storage; the app writes no tokens of its own. The service worker precaches the application shell only — the HTML, CSS, JavaScript, manifest and icons — so the app opens with no network; no response from `/v1/` is ever cached, and no runtime caching rule exists that could pick one up. Browser storage is not guaranteed: the app calls `navigator.storage.persist()` once and records the answer, but a browser may still evict IndexedDB under storage pressure, and clearing site data deletes it outright. **The server is the durable copy.** Entries that have not yet synced exist in exactly one place, which is why the Open screen says so when something has been waiting more than a week. There is no analytics SDK, no error-reporting SDK, no font or script from a CDN, and no third-party request of any kind.

**2. In transit.** TLS only. The API refuses plain HTTP outside `NODE_ENV=development`. The sync payload is the zod-validated envelope in `@ledger/shared/schemas/sync`; anything outside it is rejected before it reaches a handler.

**3. At the API.** The bearer token is verified against the provider's published keys on every request, and **its issuer and audience are checked as well as its signature**. That second part is load-bearing on Identity Platform: Google signs every project's tokens with one shared key set, so a signature alone proves only that Google minted the token, not that it was minted for this project. Without the issuer and audience checks, anyone with a free Google Cloud project could mint a token this API would accept as any user. `packages/api/test/identity-platform.test.ts` mints exactly that token and asserts it is refused. The request context carries `userId` and `role`; nothing downstream reads the token again. Every database call runs inside a transaction that first executes `SELECT set_config('request.user_id', …), set_config('request.role', …)`, and the API's Postgres role (`ledger_api`) has RLS enforced with no `BYPASSRLS`. Application code scopes every query by `user_id` as well; RLS is the backstop, not the only guard. The Supabase service-role key is not present in the API's environment at all — it's used only by the migration step, from a developer machine or CI.

**4. Field-level encryption.** Free-text columns (`*_enc`, type `bytea`) are encrypted in `packages/api/src/crypto` with AES-256-GCM. The data key for each column is derived from `FIELD_ENCRYPTION_KEY` with HKDF, using `table.column` as the info string, so no two columns share a key. The envelope stored in the row is `version(1 byte) || iv(12) || ciphertext || tag(16)`. `key_version` on the row says which root key was used, so rotation is a background job, not a migration. The root key is in environment/secret storage (Render env now; Google Secret Manager on Cloud Run), never in the database and never in code.

**5. At rest.** Postgres is encrypted at rest by the provider — **Cloud SQL for PostgreSQL** in production, under Google's BAA; Supabase in development and CI. Field-level encryption is on top of that, so a database dump without the app key reveals structure and numbers but no prose.

The connection from Cloud Run is a **Unix socket** at `/cloudsql/<instance>`, which carries no TLS settings of its own: that path never leaves the container, and the Cloud SQL connector on the other side of it holds the session to the instance. Over TCP, TLS with certificate verification is still required and `packages/api/src/db/client.ts` enforces it. Nothing about the schema, the policies or the migrations is provider-specific, and `packages/api/scripts/verify-cloudsql.sh` is what proves it on the real instance.

**6. Logs.** Pino with a redaction list that removes every free-text field, every `*_enc` field, `user_id`, and the `Authorization` header before serialization. Request logs carry a request id and a route, not a user id. Crisis events store rule identifiers (`R03_intent`), never the matched text. Sentry's `beforeSend` drops request bodies and user context. The test suite includes a check that greps the logger's output during a full sync for any of the seeded PHI strings; it fails the build if one appears.

**7. Language model.** The Anthropic API is called only from `packages/api/src/services/ai.ts`. The prompt receives the *minimum* text needed for the task (one prediction's situation and outcome, or one journal entry the client chose to reflect on), no identifiers, no history, and the response is text only. The endpoints exist (`/v1/ai/why`, `/v1/ai/reflect`) but the client does not call them in milestone 1; when it does, they are opt-in per user and logged as a count, not content.

**8. The locating assistant (disabled until BAA).** `POST /v1/assistant/locate` sends one clinician's note about one client to the Anthropic API, from `packages/api/src/services/ai.ts`. This is the first and only hop where a third party reads client information in prose, and it **ships off**: `ASSISTANT_ENABLED` defaults to false, the route returns 503 with `ASSISTANT_DISABLED` when it is false or `ANTHROPIC_API_KEY` is absent, and no model call is made. It must not be switched on until a BAA with Anthropic covering this traffic is signed, with zero-data-retention confirmed. What the model may return is a fixed structure — sign ids, spans copied out of the note, and gate keys — with no free-text field, so it cannot emit a diagnosis, a label, a floor or a number; every span is checked in code as an exact substring of the note, and a sign with no surviving span is dropped. Floors are computed afterwards, in code, by the same function the browser runs. What is stored is `assistant_runs`: the note's SHA-256, the sign ids, the gate keys, the model id and a duration. The note itself is not stored, not logged, not echoed in an error body, and not written to Sentry — `test/phi-logs.test.ts` and `test/sentry-scrubber.test.ts` seed a note and grep both sinks. Rate limit: 30 runs per clinician per hour.

**TODO (Prompt 2, the Cloud Run image).** The system prompt is read from `docs/theory/` at runtime rather than copied into `src/`, so an image built without that directory cannot serve this route. `assertCorpusAvailable()` fails the boot instead of sending a truncated prompt, so the failure is loud rather than silent, but the packaging belongs with the image and is deferred to Prompt 2.

## Who can read what

| Table | Client | Clinician (active link) |
| --- | --- | --- |
| `predictions` | own rows, full | full rows if `share_predictions`; verdict/confidence/timestamps only (via `predictions_summary` view) if `share_calibration` |
| `reinterpretations` | own rows, full | only if `share_predictions` |
| `body_states` | own rows, full | only if `share_body_states` |
| `priors` | own rows, full | read if `share_priors`; may set `safe_to_test`; may insert clinician-origin priors |
| `journal_entries` | own rows, full | only rows with `shared_at IS NOT NULL` |
| `crisis_events` | own rows, read | read if `share_crisis_events` |
| `clinician_client_links` | rows where they are the client; may update consent | rows where they are the clinician; read only |
| `devices` | own rows; deleted outright when the account is deleted | none |
| `link_invites` | none — not even with the token in hand | own rows; may create and revoke, never read the token |
| `formulations` | **none in this version** | own rows, for a client they hold an active link to |
| `assistant_runs` | none | own rows, for a client they hold an active link to |
| `clinician_stacks`, `stack_goals` | none — not even their own clinician's | own rows only; not PHI, and deliberately not a directory |
| `access_log` | none | none — the system role only |
| `phase_events` | own rows, read | own rows, through an active link; append-only |
| `usage_events` | none — write-only from their own device | none — the system role only |
| `exports` | none | none — the system role only |
| `measures` | own rows, full — including ones a clinician administered | rows for a client they hold an active link to; writes only as themselves |

`predictions.counts_for` is a structured number — an integer 0–100 answering "How much does this one count?" — and carries no prose, so it is included in `predictions_summary`, the view a clinician with `share_predictions = false` can read. Same reasoning as confidence and the verdict: a number scoped to a `user_id` is handled as PHI, and it is still not something a person typed.

Two structural guarantees sit under the policies. Child tables (`body_states`, `reinterpretations`, `journal_entries`, `prediction_priors`) reference their parent with a composite foreign key on `(prediction_id, user_id)` / `(prior_id, user_id)`, so a row cannot be attached to another user's prediction or prior even if a policy were wrong. And `users.role` is not updatable by the API role at all (column-level grant covers only `timezone` and `deleted_at`), so a client cannot promote themselves; a link's two parties are fixed at creation by trigger.

Revoking a link sets `status = 'revoked'`; every clinician policy joins through `status = 'active'`, so revocation is immediate and total.

Three decisions in that table are deliberate and worth stating plainly.

**Measures are visible to the client and formulations are not.** The two decisions look inconsistent and are not. A score on a published instrument is a measurement taken about a person, and a person should be able to see a number recorded about them; a formulation is the clinician's working note. Neither table stores item-level responses or item text — `measures` holds a total and the instrument's published subscales, because some items are sensitive in a way a total is not (PHQ-9 item 9 in particular) and storing them would put the crisis rules in the position of needing to read them.

**Formulations are not visible to the client.** A formulation is the clinician's working note, the way a paper chart is, and there is no policy granting a client SELECT on it. That is a defensible clinical choice and an uncomfortable one — the client cannot see what has been written about them — so it is recorded here as a decision rather than left as an omission. If it changes, it changes by adding a policy in a new migration and by designing the screen that presents it, not by widening an existing one.

**There is no directory.** No table maps a clinician to a list of clients they might invite, and no endpoint searches for a person. `clinician_stacks` — the training stack that feeds the scope gate — is the nearest thing to one and is deliberately not it: a clinician reads only their own rows, no client can read any, and there is no policy that would let a search across clinicians be written without adding one. A link exists only because a clinician created an invite and a client redeemed it. This is why the clinician's client picker shows a truncated UUID: there is no name in the application database to show, by design — identity lives with the auth provider and nothing joins the two.

**The client outlives the clinician.** Every client-owned row is owned by the client, not by the link. Revoking a link, or deleting the clinician's account, removes the clinician's read access and leaves the client's ledger untouched and fully theirs. Formulations and assistant runs are the mirror case: they belong to the clinician who wrote them, cascade with the clinician, and are already invisible once the link is not active.

## Who did read — the access log

RLS decides who *can* read a client's rows; `access_log` records who *did*. Go-live gate B1. A line is written inside `withUser`, on the same transaction as the read it describes, so a read that rolls back leaves no claim that it happened and a read that commits cannot commit without its line. Zero-row reads are logged too: "I looked and there was nothing" is a fact about who went looking, and dropping it would make an empty result the one way to read unobserved.

The columns are `id, actor_id, actor_role, client_id, table_name, action, row_count, at` and **there is no content column and will not be one** — the value of this table is that it can be kept for six years without becoming a second copy of the ledger. A test asserts the column list, so a column that could hold prose fails there rather than in review. `table_name` rather than the gate's `table`, which is reserved in SQL.

It is append-only with no `UPDATE` or `DELETE` grant and a trigger behind that, and it has **no foreign keys to `users`**: retention is six years against thirty days to deletion, and an audit record that disappears with its subject is not an audit record. Only the system role reads it — not the clinician who wrote the lines, and not yet the client the lines are about. A client asking "who has looked at my record" is a right worth building and is a request with a person on the other end, not a `SELECT`.

Wired today to the two clinician reads that exist: `GET /v1/clients/:id/formulations` and `GET /v1/clients/:id/measures`. The gate also names `predictions`, `predictions_summary`, `priors`, `body_states`, `reinterpretations`, `phase_events` and the research export — those routes are Prompt 3 and Prompt 8 and do not exist yet. `logAccess()` is the one place a read is recorded, so adding them is a line at each call site, not a mechanism.

## Two things a clinician must have first

**A second factor (gate B2).** Email OTP is one, and one is not enough for an account that can read other people's clinical records. The API refuses `POST /v1/invites`, every clinician read of client data, and writing a formulation unless the token proves `aal2`. Clients stay on one factor by design — the asymmetry is deliberate: a clinician holds many people's records, a client holds their own.

The level is read through the auth seam, `AuthAdmin.assuranceLevel()`, not from a provider claim in the route. The claim's name and shape belong to the provider; go-live gate A2 moves production to Identity Platform, and the requirement should survive that without the check that enforces it being rewritten. Enrollment goes through the same seam in the clients (`apps/clinician/lib/auth.ts`), so no screen names a provider. One difference is visible to a clinician and is not a bug: Supabase steps the current session up to two factors in place, while Identity Platform mints the claim at the *next* sign-in, so the setup screen says to sign in once more.

**An accepted BAA (gate A1).** Under HIPAA the vendor is a business associate of every clinician who uses this with a client, and the agreement has to exist before the first invite rather than after the first incident. Acceptance is recorded on the clinician's own row as `baa_accepted_version` and `baa_accepted_at`, writable by that user for that row and by nothing else — 0008 grants `UPDATE` on exactly those two columns and 0001's `users_self_update` scopes it. `POST /v1/invites` refuses while the version is null. The document is `docs/legal/clinician-baa.md`, currently a placeholder marked DRAFT with a header saying nobody should accept it; it is in `docs/legal/` rather than `docs/theory/` so the Library pipeline never sees it and the reference assistant can never quote it. **Its frontmatter is the only source of the version string** — the clinician app renders the document and offers its version, the API reads the same file and accepts nothing else, and a test asserts they agree. A constant that could drift from the document would mean recording consent to text nobody can produce. The API reads it lazily and fails those two routes with a 503 if the file is absent, rather than refusing to start; packaging `docs/legal/` and `docs/theory/` with the image is the Prompt 2 item already noted at hop 8.

Both failures return a code — `MFA_REQUIRED`, `BAA_REQUIRED` — and a sentence the clinician can act on. The failure here is almost always "you have not done this yet", not "you are not allowed".

## The research export

Hop 9, and the only place data leaves this system as a file. `pnpm --filter @ledger/api research:export --dry-run | --write <dir>`, run by hand as the system role. Proposal 03 §6.

**Consented only.** Participants with `research_consent_at` set and `research_consent_withdrawn_at` null, read at the moment the run starts. Enforced by RLS — `app_research_consented()` in 0009 — so a wrong `WHERE` in the exporter cannot widen it, and a withdrawal takes effect immediately with nothing to re-run. Research consent is separate from clinician sharing in every way: a different screen, a different flag, and withdrawing one does not touch the other. **The clinician app shows nothing about it and no clinician route returns it** — a clinician who could see it could ask about it, and a request from the person holding the notes is not a free choice.

**Pseudonymous.** `HMAC-SHA256(user_id, secret)` truncated to 16 hex characters, with a secret generated per run and printed once. Two exports cannot be joined without it and the mapping is never stored — which also means a re-identification request cannot be answered, and that is the trade.

**Date-shifted.** One random offset per participant in [−180, +180] days on every timestamp of theirs. Intervals within a participant survive exactly, which is what a single-case design needs; calendar dates do not, which is what re-identification needs.

**Allowlisted.** `packages/api/src/research/allowlist.ts` names every column, and the exporter selects that list rather than the table — so a column added to a table cannot reach a CSV by being added. No `_enc` column, no label, no free text of any kind is on it, and tests assert both that and that nothing outside it appears in the output. Crisis events get the narrowest treatment: that one occurred and which deterministic rules fired, never the matched text, which was never stored.

Each run writes an `exports` row — run id, time, participant count, allowlist hash — and **nothing about who**, which would defeat the pseudonyms. It also writes one `access_log` line per table with action `export`.

**The assistant is out of scope for the first study.** `ASSISTANT_ENABLED` is false, no `assistant_runs` column is on the allowlist, and nothing generated by a model is in the export.

## Deletion

`DELETE /v1/me`, from Settings in the client app behind a typed confirmation. It does four things, in this order:

1. **Soft-deletes every row the user owns** — `predictions`, `priors`, `body_states`, `reinterpretations`, `journal_entries` — by stamping `deleted_at`, which every RLS policy and every query in the codebase already treats as gone. The `users` row is stamped last.
2. **Revokes every link in both directions.** A client's deletion revokes the links to them; a clinician's revokes the links they hold. Every clinician policy joins through `status = 'active'`, so this is immediate and total.
3. **Deletes push tokens outright.** `devices` has no `deleted_at` and does not wait for the purge: a token that outlives the account is a notification sent to someone who left.
4. **Deletes the identity at the auth provider.** Identity lives there, not here, so the account is only gone when both halves are.

The order is rows-then-identity, because the reverse cannot be finished: with the auth user deleted first, a failure partway through leaves rows nobody can sign in to reach. The route checks the provider is configured **before the first write** and returns `503 DELETION_UNAVAILABLE` having changed nothing — half a deletion, with the ledger gone from the user's view and the account still able to sign in, is worse than none. If the identity call fails after the rows are stamped, the response is a 502 saying so; the retry is the same request and it is idempotent.

**The auth provider sits behind one interface**, `packages/api/src/auth-admin.ts`, with a single method `deleteUser(userId)`, selected by `AUTH_PROVIDER`. The Supabase implementation is one REST call with the service-role key. This is **the only runtime use of a service-role key in the system**, it is read in that one file and nowhere else, and it never touches the application database — that connection is `ledger_api`, which has RLS enforced and no `BYPASSRLS`. The Identity Platform implementation holds **no credential at all**: the organisation enforces `constraints/iam.disableServiceAccountKeyCreation`, so there is no key to download, and the access token is fetched from the metadata server of the running Cloud Run revision. The acting identity is that revision's service account — visible in the console, revocable in one click, and impossible to copy out. That is strictly better than the long-lived Supabase service-role key it replaces.

**Thirty days later the rows are destroyed.** A nightly job (`packages/api/src/jobs/purge.ts`) runs in a *system context* — still the `ledger_api` role, still under RLS, with `request.role = 'system'` and no user id. Migration `0007_deletion_system_role.sql` grants `DELETE` for the first time and then narrows it to one predicate, `app_purgeable_user()`: the row belongs to an account whose own row is soft-deleted, the grace period has passed, and the caller is the system role. Rows of a live account are unreachable by the verb even in that context, and the grace period is computed in SQL rather than trusted from the job, so a job with the interval wrong still cannot destroy an account deleted yesterday. Nothing an HTTP request can do produces `request.role = 'system'`: the auth plugin writes `client` or `clinician` from the verified token.

**Granting `DELETE` at all is the risk this migration had to manage.** 0001 gives a client `FOR ALL` on their own rows, and `FOR ALL` includes `DELETE` — harmless only while no `DELETE` grant existed. The moment one does, those policies would let any client hard-delete their own ledger and skip the grace period entirely. 0007 therefore adds a **restrictive** `DELETE` policy to each of those tables first (`app_role() = 'system'`), which is ANDed with the permissive policies rather than ORed, so the system role is a necessary condition no matter what any present or future permissive policy says. `devices` is the deliberate exception: `DELETE /v1/me` removes push tokens under the user's own context, because a token outliving its account is the worse failure.

**Nothing cascades, and that is deliberate.** Every foreign key to `users` in the milestone-1 schema is `ON DELETE NO ACTION`, so no single delete can quietly take a ledger with it. The purge therefore names every table and deletes in dependency order — `prediction_priors` first, `users` last — and the test asserts the ledger is empty afterwards by counting every table, so a table added later and not added to the job fails loudly rather than leaving rows behind.

**The `users` row is never hard-deleted. It becomes a tombstone.** Two things pointing at a client's user row are not the client's data: `formulations` and `assistant_runs` are the clinician's record of their own clinical reasoning, and both foreign-key to `users` with `ON DELETE CASCADE` — a hard delete would take them *silently*, not fail on a constraint. So the row survives with its `id` and its `deleted_at`, `timezone` neutralised to `UTC` (it is `NOT NULL`, and a real zone is a coarse location), and nothing else on it that says anything about the person. There is no `DELETE` grant on `users` and no `DELETE` policy, which is the strongest form of "never": the verb is absent rather than restricted. The test asserts the full column list of `users`, so a column added later fails until someone decides whether it belongs on a tombstone.

`clinician_client_links` is exempt for the same reason at one remove: `formulations.link_id` is `NOT NULL` and cascades from it, so deleting a link deletes the formulations written against it. The link stays, revoked — which is what makes it inert.

**A clinician does not delete their account from here.** `DELETE /v1/me` refuses one with 403 `CLINICIAN_DELETION_UNSUPPORTED`. Their formulations and assistant runs are a record of their own clinical reasoning, referenced by clients who did not write them and cannot consent to their removal; winding down a practice is a conversation about retention, supervision and where the charts go, not a button.

**Measures split by whether a link existed** — decided, not built. A measure taken under an active clinician link is part of the care record and survives a client purge the way a formulation does; one with no link is the client's own data and purges with the account. The line gets drawn in Prompt 8, when measures get their full write path; today `measures.client_id` cascades from `users`, and since the users row is never deleted, nothing is destroyed either way.

**The unit is the account, not the row.** A single entry a client deleted on their own is not purged by this job yet. **Decided, not built:** those follow the same rule — the same 30-day grace, the same nightly job, children before parents — and are queued as their own change rather than folded in here, because doing it row by row means a parent can be purgeable while its children are still live and the order has to be worked out rather than assumed.

The system context can read **only what it may destroy** — a `DELETE` whose `WHERE` touches a column has `SELECT` policies applied to it too, so the same predicate grants the read. A live row is invisible to it, as is a soft-deleted row still inside the grace period, so a bug in the purge job cannot become a cross-user read. `test/rls.test.ts` cases #44–#48 are these guarantees, including that a client cannot hard-delete their own rows, live or soft-deleted.

**The window is told to the client in their own words**, on the Settings screen: entries are held for 30 days in case the deletion was a mistake, after which nobody can recover them, and the sign-in goes immediately. It is set by `DELETION_GRACE_DAYS`.

Backups age out on the provider's schedule and are the one copy the grace period does not govern; that window belongs in the privacy notice (go-live gate C1).

## Open items

**The Anthropic BAA gates `ASSISTANT_ENABLED`.** Hop 8 is off and stays off until a BAA covering the locating assistant's traffic is signed and zero-data-retention is confirmed in writing. This is the one switch in the system that moves PHI to a new processor, so it is called out separately from the list below rather than folded into it.

Before any real client uses this: a signed BAA with Supabase (available on paid tiers) and with the hosting provider; the same for Sentry if it's kept in production; a written privacy notice; and a decision about whether the Anthropic call is inside or outside the covered-entity boundary (Anthropic offers a BAA for eligible customers; confirm before enabling the feature for anyone but yourself).

**A custom email sender is still required, and the reason is not compliance.** Identity Platform is named on Google's HIPAA covered-products list and its built-in sender is permitted under the BAA, so nothing here is blocked on an agreement. What is missing is everything else a sign-in email needs: a **sender identity on `courageloop.com`** rather than a Google default, **deliverability** to real inboxes as somebody's actual responsibility, and **control of the message body** — a sign-in email is the first thing a client ever sees from this application, and it should say what it is and what it is not. Identity Platform supports a custom SMTP sender; go-live gate A4 is where that is tracked.

The older reasoning about the recipient list still holds and is the reason the *provider* matters: an address on a mental-health application's sending list is a disclosure even when the message carries only a link, so whoever sends it belongs in the same BAA and privacy-notice conversation as the database and the host.

The paragraph below is the Supabase-era statement of the same requirement, kept because the reasoning is identical and because Supabase is still the development provider.

**Supabase's built-in email service is explicitly not for production**: it is rate-limited, best-effort, and refuses to deliver to any address that is not a member of the project's team, so no client could receive a sign-in code from it. A real sender — Resend or Postmark — is therefore a prerequisite, not an optimisation. Note what that adds: the provider becomes a **data processor handling client email addresses**, alongside Supabase Auth, which is the other place identity lives. The messages themselves carry only a six-digit sign-in code and no PHI, but the association between an email address and this application is itself disclosure, so the provider belongs in the same BAA and privacy-notice conversation as Supabase and the hosting provider. Gmail SMTP with an app password is adequate for a developer testing against their own address and is **not** an answer for deployment: consumer deliverability is unreliable and the sending account is a personal one.

## Known advisories — accepted, 9 September 2026

Dependabot reports 43 open advisories against this repository. The ones that
could be fixed cleanly were fixed on 9 September 2026. The rest are recorded
here as decisions rather than left to be re-reported every time someone looks,
because none of them is going to move on its own.

**The Expo tree in `apps/client` — roughly 29 of the 43. Accepted risk while
that package is parked.** `tar`, `@xmldom/xmldom`, `uuid`, `decode-uri-component`
and one of the `esbuild` findings are reachable only through `@expo/cli` and
`@expo/metro-config` — the Expo command-line tooling, which runs on a developer's
machine and is not part of any deployed artefact. `apps/client` is parked, not
shipped: it is not built, not deployed, and not the milestone-1 client
(`apps/web` is). Clearing them requires an Expo major, which is a migration, not
a bump. **If `apps/client` is ever unparked, this paragraph expires and the Expo
upgrade becomes a prerequisite, not an option.**

**`image-size` — two high findings, no fix exists.** Both are denial of service
through infinite loops in the ICNS and JXL/HEIF parsers. There is no patched
version at any release; the advisories name none. It arrives through Expo and
metro, so it shares the paragraph above.

**`postcss` — four findings, pinned upstream by Next.** Next.js depends on
`postcss` at an exact version, `8.4.31`, and still does as of 16.3.4, so no Next
release fixes this and there is nothing to upgrade to. The findings concern
`sourceMappingURL` handling reading arbitrary `.map` files, which requires
attacker-controlled CSS; the CSS processed here is written in this repository.
Build-time only.

**`esbuild` — one low finding, pinned upstream by tsup.** `tsup` 8.5.1 is the
latest release and depends on `esbuild ^0.27.0`; the fix is 0.28.1, outside that
range. The advisory affects `esbuild --serve` on Windows, which `tsup` never
invokes.

**Still open, and not accepted:** `@opentelemetry/core` reaches the API at
runtime through `@sentry/node`. See the Sentry notes in that package.
