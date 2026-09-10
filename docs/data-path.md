# Data path

Where protected health information (PHI) lives, how it moves, and what protects it at each hop. This document is the reference for the HIPAA conversation; keep it current when the schema or the deployment changes.

## What counts as PHI here

Everything a client types is treated as PHI: prediction situations and outcomes, reinterpretations, prior labels, journal entries, body-state prose, and the timestamps that pair them. Confidence numbers, verdict enums, intensity scales, and rule identifiers are *not* identifying on their own, but they are always stored with a `user_id`, so the whole row is handled as PHI.

Identity (email, display name, phone) is **never** stored in the application database. Supabase Auth holds it. The app database knows a user only as a UUID and a role.

## Hops

**1. On the phone.** Entries are written first to an SQLite database in the app's sandbox (`expo-sqlite`). The database file is inside the OS-protected app container; on iOS it is additionally covered by Data Protection when the device is locked. The Supabase session token lives in `expo-secure-store` (Keychain / Keystore), never in AsyncStorage. There is no analytics SDK in the client. Sentry, if enabled on the client, is configured with `sendDefaultPii: false` and a `beforeSend` that strips every field except the error type and stack.

**1a. In the browser (the web client).** `apps/web` is the milestone-1 client, and its local mirror lives in the browser's IndexedDB rather than an app sandbox. The difference matters: the store is protected by the browser profile and the operating-system account behind it, not by an app container, so anyone with the unlocked profile can read it, and a shared or unlocked computer is a real exposure that the phone's container was not. The Supabase session is held in memory and in the Supabase client's own storage; the app writes no tokens of its own. The service worker precaches the application shell only — the HTML, CSS, JavaScript, manifest and icons — so the app opens with no network; no response from `/v1/` is ever cached, and no runtime caching rule exists that could pick one up. Browser storage is not guaranteed: the app calls `navigator.storage.persist()` once and records the answer, but a browser may still evict IndexedDB under storage pressure, and clearing site data deletes it outright. **The server is the durable copy.** Entries that have not yet synced exist in exactly one place, which is why the Open screen says so when something has been waiting more than a week. There is no analytics SDK, no error-reporting SDK, no font or script from a CDN, and no third-party request of any kind.

**2. In transit.** TLS only. The API refuses plain HTTP outside `NODE_ENV=development`. The sync payload is the zod-validated envelope in `@ledger/shared/schemas/sync`; anything outside it is rejected before it reaches a handler.

**3. At the API.** The Supabase JWT is verified (JWKS or HS256 secret) on every request. The request context carries `userId` and `role`; nothing downstream reads the token again. Every database call runs inside a transaction that first executes `SELECT set_config('request.user_id', …), set_config('request.role', …)`, and the API's Postgres role (`ledger_api`) has RLS enforced with no `BYPASSRLS`. Application code scopes every query by `user_id` as well; RLS is the backstop, not the only guard. The Supabase service-role key is not present in the API's environment at all — it's used only by the migration step, from a developer machine or CI.

**4. Field-level encryption.** Free-text columns (`*_enc`, type `bytea`) are encrypted in `packages/api/src/crypto` with AES-256-GCM. The data key for each column is derived from `FIELD_ENCRYPTION_KEY` with HKDF, using `table.column` as the info string, so no two columns share a key. The envelope stored in the row is `version(1 byte) || iv(12) || ciphertext || tag(16)`. `key_version` on the row says which root key was used, so rotation is a background job, not a migration. The root key is in environment/secret storage (Render env now; Google Secret Manager on Cloud Run), never in the database and never in code.

**5. At rest.** Supabase Postgres is encrypted at rest by the provider. Field-level encryption is on top of that, so a database dump without the app key reveals structure and numbers but no prose.

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
| `devices` | own rows | none |
| `link_invites` | none — not even with the token in hand | own rows; may create and revoke, never read the token |
| `formulations` | **none in this version** | own rows, for a client they hold an active link to |
| `assistant_runs` | none | own rows, for a client they hold an active link to |
| `clinician_modalities` | none — not even their own clinician's | own rows only; not PHI, and deliberately not a directory |

Two structural guarantees sit under the policies. Child tables (`body_states`, `reinterpretations`, `journal_entries`, `prediction_priors`) reference their parent with a composite foreign key on `(prediction_id, user_id)` / `(prior_id, user_id)`, so a row cannot be attached to another user's prediction or prior even if a policy were wrong. And `users.role` is not updatable by the API role at all (column-level grant covers only `timezone` and `deleted_at`), so a client cannot promote themselves; a link's two parties are fixed at creation by trigger.

Revoking a link sets `status = 'revoked'`; every clinician policy joins through `status = 'active'`, so revocation is immediate and total.

Three decisions in that table are deliberate and worth stating plainly.

**Formulations are not visible to the client.** A formulation is the clinician's working note, the way a paper chart is, and there is no policy granting a client SELECT on it. That is a defensible clinical choice and an uncomfortable one — the client cannot see what has been written about them — so it is recorded here as a decision rather than left as an omission. If it changes, it changes by adding a policy in a new migration and by designing the screen that presents it, not by widening an existing one.

**There is no directory.** No table maps a clinician to a list of clients they might invite, and no endpoint searches for a person. `clinician_modalities` — the training stack that feeds the scope gate — is the nearest thing to one and is deliberately not it: a clinician reads only their own rows, no client can read any, and there is no policy that would let a search across clinicians be written without adding one. A link exists only because a clinician created an invite and a client redeemed it. This is why the clinician's client picker shows a truncated UUID: there is no name in the application database to show, by design — identity lives in Supabase Auth and nothing joins the two.

**The client outlives the clinician.** Every client-owned row is owned by the client, not by the link. Revoking a link, or deleting the clinician's account, removes the clinician's read access and leaves the client's ledger untouched and fully theirs. Formulations and assistant runs are the mirror case: they belong to the clinician who wrote them, cascade with the clinician, and are already invisible once the link is not active.

## Deletion (planned — not in milestone 1)

A client will be able to delete their account. That soft-deletes their `users` row and every child row (`deleted_at`), which RLS treats as gone, and a nightly job hard-deletes soft-deleted rows older than 30 days. The Supabase Auth user is deleted by the same request. Backups age out on the provider's schedule; document that window in the privacy notice.

## Open items

**The Anthropic BAA gates `ASSISTANT_ENABLED`.** Hop 8 is off and stays off until a BAA covering the locating assistant's traffic is signed and zero-data-retention is confirmed in writing. This is the one switch in the system that moves PHI to a new processor, so it is called out separately from the list below rather than folded into it.

Before any real client uses this: a signed BAA with Supabase (available on paid tiers) and with the hosting provider; the same for Sentry if it's kept in production; a written privacy notice; and a decision about whether the Anthropic call is inside or outside the covered-entity boundary (Anthropic offers a BAA for eligible customers; confirm before enabling the feature for anyone but yourself).

**A transactional email provider is required before any real client signs in.** Supabase's built-in email service is explicitly not for production: it is rate-limited, best-effort, and refuses to deliver to any address that is not a member of the project's team, so no client could receive a sign-in code from it. A real sender — Resend or Postmark — is therefore a prerequisite, not an optimisation. Note what that adds: the provider becomes a **data processor handling client email addresses**, alongside Supabase Auth, which is the other place identity lives. The messages themselves carry only a six-digit sign-in code and no PHI, but the association between an email address and this application is itself disclosure, so the provider belongs in the same BAA and privacy-notice conversation as Supabase and the hosting provider. Gmail SMTP with an app password is adequate for a developer testing against their own address and is **not** an answer for deployment: consumer deliverability is unreliable and the sending account is a personal one.

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
