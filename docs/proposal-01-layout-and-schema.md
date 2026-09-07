# Proposal 1 — Directory layout and Drizzle schema

Status: **approved 2026-09-07 with all recommended defaults, and implemented.** Kept for the reasoning. Deltas from this document in what was built: body-state prose lives in its own encrypted `body_states` table (question 4, option b); `predictions` gained `abandoned_at` / `abandon_reason` / `own_part`; `devices` is keyed on `(user_id, id)`; child tables use composite foreign keys `(prediction_id, user_id)` so a row can never attach to another user's prediction or prior; `crisis_events` dedupes per user; `users.role` is not client-updatable; `predictions_summary` is a `security_barrier` view; syncs are serialized per user with an advisory lock and stamp `updated_at` with `clock_timestamp()`. The authoritative schema is `packages/api/src/db/schema/index.ts` and `packages/api/src/db/migrations/0001_rls.sql`.

Everything below follows your stack and data model as given. Where I've added or changed something, it's marked **[addition]** or **[change]** with the reason, and the reasons come from your own material (the paper, the floor notes, the protocols, and the two books) — the full theory-to-loop mapping is in `docs/theory-mapping.md` alongside this file. The additions are all small; the one that matters most is `outcome_verdict`, without which the app cannot produce the "predicted 14×, occurred 2×" number at all.

---

## 1. Directory layout

```
pp-app/
├── package.json                  # workspace root; scripts: dev, build, test, lint, typecheck
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example                  # every variable documented, no values
├── .gitignore
├── README.md                     # the honest one (framework ≠ treatment; not a therapist)
├── docs/
│   ├── theory-mapping.md         # what the corpus says the loop must and must not do
│   ├── data-path.md              # HIPAA data path: where PHI lives, what's encrypted, what's logged
│   └── adr/                      # short architecture decision records (001-supabase-auth.md, …)
│
├── packages/
│   ├── shared/                   # @pp/shared — pure TS, zero runtime deps except zod
│   │   ├── src/
│   │   │   ├── schemas/          # zod: prediction, prior, journal, bodyState, crisisEvent, link, sync envelope
│   │   │   ├── calibration/      # predicted-vs-actual, confidence buckets, Brier-style score, summaries
│   │   │   ├── clustering/       # deterministic prior grouping (see §3, question 1)
│   │   │   ├── crisis/           # hard-coded risk patterns + resource constants (988, VCL). No LLM.
│   │   │   ├── vocabulary/       # his terms as constants: floors, channels, prior categories, seed words
│   │   │   └── index.ts
│   │   ├── test/                 # vitest; every pure function has a table-driven test
│   │   └── package.json
│   │
│   └── api/                      # @pp/api — Fastify, Node 20
│       ├── src/
│       │   ├── server.ts         # build(): Fastify instance (testable), listen() separately
│       │   ├── config.ts         # zod-validated env; the ONLY place process.env is read
│       │   ├── db/
│       │   │   ├── schema/       # Drizzle schema, one file per table (below)
│       │   │   ├── rls/          # SQL policies + the set_config helper; applied by migrations
│       │   │   ├── migrations/   # drizzle-kit output, committed
│       │   │   └── client.ts     # pg pool; per-request transaction that sets request.user_id/role
│       │   ├── auth/             # Supabase JWT verification (JWKS), role extraction, request context
│       │   ├── crypto/           # field-level encryption: AES-256-GCM, key version, envelope helpers
│       │   ├── plugins/          # fastify plugins: auth, sentry, request-id, rate-limit (built-in)
│       │   ├── routes/
│       │   │   ├── health.ts
│       │   │   ├── sync.ts       # POST /v1/sync — batched upsert/pull for offline-first client
│       │   │   ├── predictions.ts
│       │   │   ├── priors.ts
│       │   │   ├── journal.ts
│       │   │   ├── links.ts      # clinician↔client consent
│       │   │   └── ai.ts         # POST /v1/reflect, /v1/why — server-side Anthropic only
│       │   ├── services/
│       │   │   ├── crisis.ts     # re-runs @pp/shared crisis on every inbound entry, logs crisis_events
│       │   │   ├── calibration.ts
│       │   │   ├── ai.ts         # Anthropic SDK wrapper; strips identifiers; never returns numbers
│       │   │   └── push.ts       # Expo push (check-in prompts)
│       │   ├── jobs/             # node-cron: unresolved-prediction nudges, link expiry, key-rotation check
│       │   └── logging/          # pino with redact list; PHI fields can never reach a log line
│       ├── test/                 # vitest + fastify.inject; RLS tests run against a real Postgres
│       ├── Dockerfile            # multi-stage, distroless runtime, PORT from env (Render + Cloud Run)
│       ├── drizzle.config.ts
│       └── package.json
│
└── apps/
    ├── client/                   # Expo (EAS), React Native, TypeScript
    │   ├── app/                  # expo-router screens: (tabs)/today, predict, resolve, calibration, settings
    │   ├── src/
    │   │   ├── db/               # expo-sqlite: local mirror of predictions/priors/journal + outbox
    │   │   ├── sync/             # outbox → POST /v1/sync; pull cursor; conflict rule
    │   │   ├── crisis/           # calls @pp/shared crisis BEFORE anything else, offline; shows resources
    │   │   ├── auth/             # Supabase Auth (email/OTP), session storage in SecureStore
    │   │   ├── notifications/    # expo-notifications registration + check-in scheduling
    │   │   ├── features/         # prediction form, resolve form, calibration view, body-state pickers
    │   │   └── ui/
    │   ├── app.config.ts
    │   ├── eas.json
    │   └── package.json
    │
    └── clinician/                # Next.js + Recharts — PLACEHOLDER in milestone 1 (renders one page)
        ├── app/
        └── package.json
```

Notes on the layout:

The crisis module lives in `packages/shared`, not only in the API. The client is offline-first, so the check has to run on the phone with no network; the API re-runs the same code on every synced entry so nothing slips through if the client build is stale. Same pure function, two call sites, one `crisis_events` row (the API dedupes by `client_entry_id`).

`packages/shared/src/vocabulary/` is where your terms live as typed constants (channels, prior categories, seed words like "tight, heavy, buzzing"). It's small but it's how the client, API, and clinician app stay on the same words — and it enforces the distinction you were most deliberate about: a *dial* is set, a *gauge* is read. No screen can say "turn the dial down on your rejection prediction" if the constant doesn't exist.

Render vs. Cloud Run: the Dockerfile reads `PORT` and `DATABASE_URL` from env and nothing else is platform-specific. Moving is a config change plus a Cloud SQL/Supabase connection string.

---

## 2. Drizzle schema

Conventions: all IDs are UUIDs **generated on the client** (uuid v7, time-ordered) so offline rows have stable identities before they ever sync; `user_id` on every client-owned table; soft deletes via `deleted_at`; `updated_at` (server) and `client_updated_at` (device) for last-write-wins sync. Encrypted columns are `bytea` with a `_enc` suffix and carry the key version in the envelope so rotation is possible without a migration.

```ts
// packages/api/src/db/schema/enums.ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole        = pgEnum('user_role', ['client', 'clinician']);
export const linkStatus      = pgEnum('link_status', ['pending', 'active', 'revoked']);
export const outcomeVerdict  = pgEnum('outcome_verdict', ['hit', 'partial', 'miss', 'unclear']);   // [addition]
export const outcomeSource   = pgEnum('outcome_source', ['observed', 'inferred']);                  // [addition]
export const priorCategory   = pgEnum('prior_category', ['mattering', 'rank', 'body', 'effort', 'self_story', 'other']); // [addition]
export const priorOrigin     = pgEnum('prior_origin', ['client', 'clustered', 'clinician']);
export const crisisSource    = pgEnum('crisis_source', ['prediction', 'journal', 'body_state', 'checkin']);
```

```ts
// packages/api/src/db/schema/users.ts
export const users = pgTable('users', {
  id:        uuid('id').primaryKey(),                 // = Supabase auth.users.id; no email/name stored here
  role:      userRole('role').notNull().default('client'),
  timezone:  text('timezone').notNull().default('America/Los_Angeles'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
```

We store nothing identifying in `users`. Email and display name stay in Supabase Auth; the app DB only knows the UUID and the role. That is the single biggest PHI-surface reduction available and it costs nothing.

```ts
// packages/api/src/db/schema/links.ts
export const clinicianClientLinks = pgTable('clinician_client_links', {
  id:           uuid('id').primaryKey(),
  clinicianId:  uuid('clinician_id').notNull().references(() => users.id),
  clientId:     uuid('client_id').notNull().references(() => users.id),
  status:       linkStatus('status').notNull().default('pending'),
  requestedBy:  userRole('requested_by').notNull(),      // who initiated (client invites, or clinician invites)
  // What the client has consented to share. Client-controlled, always. Journal is NEVER a layer
  // here — journal entries are shared one at a time via journal_entries.shared_at.
  shareCalibration: boolean('share_calibration').notNull().default(true),
  sharePredictions: boolean('share_predictions').notNull().default(false),  // full text vs. summary only
  sharePriors:      boolean('share_priors').notNull().default(true),
  shareBodyStates:  boolean('share_body_states').notNull().default(false),
  shareCrisisEvents:boolean('share_crisis_events').notNull().default(true),
  consentedAt:  timestamp('consented_at', { withTimezone: true }),
  revokedAt:    timestamp('revoked_at', { withTimezone: true }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('links_pair_uq').on(t.clinicianId, t.clientId),
  check('links_not_self', sql`${t.clinicianId} <> ${t.clientId}`),
]);
```

**[change]** I made "what layers are shared" explicit boolean columns rather than a JSON blob. RLS policies have to reference them (a clinician can `SELECT` from `body_states` only where the link says `share_body_states`), and Postgres policies over typed columns are legible and indexable; policies over `jsonb->>'x'` are neither.

```ts
// packages/api/src/db/schema/predictions.ts
export const predictions = pgTable('predictions', {
  id:              uuid('id').primaryKey(),               // client-generated uuid v7
  userId:          uuid('user_id').notNull().references(() => users.id),

  // --- before ---
  situationEnc:        bytea('situation_enc').notNull(),        // encrypted free text
  expectedOutcomeEnc:  bytea('expected_outcome_enc').notNull(), // "the verdict, verbatim"
  confidence:          smallint('confidence').notNull(),         // 0–100
  reviseAfterN:        smallint('revise_after_n'),               // [addition] step 6 pre-commit: "how many
                                                                 //  times would this have to happen before
                                                                 //  you'd revise the rule?"
  scheduledFor:        timestamp('scheduled_for', { withTimezone: true }), // when the situation is expected
  bodyStateBefore:     jsonb('body_state_before').$type<BodyStateBefore>(),

  // --- after ---
  resolvedAt:          timestamp('resolved_at', { withTimezone: true }),
  actualOutcomeEnc:    bytea('actual_outcome_enc'),              // encrypted free text: what they said and did
  outcomeVerdict:      outcomeVerdict('outcome_verdict'),        // [addition] the ONLY field calibration reads
  outcomeSource:       outcomeSource('outcome_source'),          // [addition] observed vs. mind-read
  surpriseRating:      smallint('surprise_rating'),              // 0–10
  presentForIt:        boolean('present_for_it'),                // [addition] "could you say what actually happened?"
  bodyStateAfter:      jsonb('body_state_after').$type<BodyStateAfter>(),

  // --- sync / lifecycle ---
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull(),   // client clock, "written before"
  clientUpdatedAt:  timestamp('client_updated_at', { withTimezone: true }).notNull(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:        timestamp('deleted_at', { withTimezone: true }),
  keyVersion:       smallint('key_version').notNull().default(1),
}, (t) => [
  index('predictions_user_created_idx').on(t.userId, t.createdAt),
  index('predictions_user_unresolved_idx').on(t.userId).where(sql`${t.resolvedAt} IS NULL AND ${t.deletedAt} IS NULL`),
  check('confidence_range', sql`${t.confidence} BETWEEN 0 AND 100`),
  check('surprise_range',   sql`${t.surpriseRating} IS NULL OR ${t.surpriseRating} BETWEEN 0 AND 10`),
  check('resolved_has_verdict', sql`${t.resolvedAt} IS NULL OR ${t.outcomeVerdict} IS NOT NULL`),
]);
```

Why each addition to `predictions`:

**`outcome_verdict`** — your data model has `actual_outcome` as text, but calibration is arithmetic and arithmetic can't read encrypted prose. The client picks hit / partial / miss / unclear at resolve time and *that* is what "predicted rejection 14×, happened 2×" counts. `partial` exists because, as you put it in Waking the Driver, "half the time reality confirms the small annoyance and still disconfirms the catastrophe." `unclear` is not scored — it is routed to the clinician.

**`outcome_source`** — Floor 7 note and WtD Ch6: "forecasts about other minds are still forecasts, and they're the ones your machine checks least." The resolve form asks whether the outcome is something the person *observed* (what they said and did) or *inferred* (what they must have thought). Inferred outcomes are shown with a marker and can be excluded from the headline number. This is the cheapest defense against the outcome box becoming "they were only being nice."

**`present_for_it`** — WtD Ch10: if they can't say what actually happened, "it was too big"; the protocols say "outside the window, nothing files." A miss the client wasn't present for should not be counted as a disconfirmation. One boolean.

**`revise_after_n`** — this is step 6 of your own six-step behavioral experiment (UCM §6.3), the one the current loop lacks. It's what turns a single result into a standing experiment. Nullable; skipping it is fine.

```ts
// packages/api/src/db/schema/reinterpretations.ts   [addition — new table]
export const reinterpretations = pgTable('reinterpretations', {
  id:            uuid('id').primaryKey(),
  userId:        uuid('user_id').notNull().references(() => users.id),
  predictionId:  uuid('prediction_id').notNull().references(() => predictions.id),
  textEnc:       bytea('text_enc').notNull(),        // "what did you tell yourself about why it went that way"
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull(),
  clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }).notNull(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:     timestamp('deleted_at', { withTimezone: true }),
  keyVersion:    smallint('key_version').notNull().default(1),
});
```

This is the one table not on your list, and it's the one I'd argue hardest for. Your research note on surprise says the clinically interesting window is "the half-minute after the surprise," and the failure mode is that the explanation-away gets typed *into the outcome field*. Storing the explanation as a separate, dated record that **cannot edit the outcome or the verdict** is exactly what your social-anxiety protocol does on paper ("'they didn't notice this time' gets written down and dated, so its record can be checked"). It's append-only by design: no update route, only insert and soft-delete.

```ts
// packages/api/src/db/schema/priors.ts
export const priors = pgTable('priors', {
  id:          uuid('id').primaryKey(),
  userId:      uuid('user_id').notNull().references(() => users.id),
  labelEnc:    bytea('label_enc').notNull(),            // "if I show weakness, they withdraw" — in their words
  category:    priorCategory('category').notNull().default('other'),  // [addition] mattering / rank / body / effort / self_story
  origin:      priorOrigin('origin').notNull(),         // client-named, clustered, or clinician-added
  safeToTest:  boolean('safe_to_test'),                 // [addition] clinician-owned gate; NULL = not yet reviewed
  retiredAt:   timestamp('retired_at', { withTimezone: true }),
  createdBy:   userRole('created_by').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull(),
  clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }).notNull(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:   timestamp('deleted_at', { withTimezone: true }),
  keyVersion:  smallint('key_version').notNull().default(1),
}, (t) => [ index('priors_user_idx').on(t.userId) ]);

export const predictionPriors = pgTable('prediction_priors', {
  predictionId: uuid('prediction_id').notNull().references(() => predictions.id),
  priorId:      uuid('prior_id').notNull().references(() => priors.id),
  assignedBy:   priorOrigin('assigned_by').notNull(),   // client tagged it / clustering / clinician
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [ primaryKey({ columns: [t.predictionId, t.priorId] }) ]);
```

**`category`** is the starter taxonomy from your own text: mattering/belonging (sociometer), rank (hierometer), body/threat (floor 7), effort/futility, and the self-story. The paper's formulation question five — "where the injury weights, toward being unwanted or being low" — is what this column answers. Categories are fixed constants in `@pp/shared/vocabulary`; labels are the client's own sentences.

**`safe_to_test`** — the gate the loop doesn't have and a veterans app cannot skip. UCM §6.3: "Running a disclosure experiment into an environment that will confirm the fear is not therapy; it hands the prior fresh evidence with the therapist's signature on it." R&U Ch16: some rooms are ones where the filter "is still doing the exact job it was built for — a cell block, a crew, in a unit." Without this flag the calibration counter will score correct reads of hostile rooms as failures to update. In solo mode it's NULL and the app says nothing; with a clinician linked, the clinician can set it, and predictions against a `safe_to_test = false` prior get a soft warning rather than a scoreboard.

```ts
// packages/api/src/db/schema/journal.ts
export const journalEntries = pgTable('journal_entries', {
  id:            uuid('id').primaryKey(),
  userId:        uuid('user_id').notNull().references(() => users.id),
  predictionId:  uuid('prediction_id').references(() => predictions.id),  // optional: attached to an experiment
  bodyEnc:       bytea('body_enc').notNull(),
  sharedAt:      timestamp('shared_at', { withTimezone: true }),          // NULL = private. Per-entry, revocable.
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull(),
  clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }).notNull(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:     timestamp('deleted_at', { withTimezone: true }),
  keyVersion:    smallint('key_version').notNull().default(1),
}, (t) => [ index('journal_user_created_idx').on(t.userId, t.createdAt) ]);
```

```ts
// packages/api/src/db/schema/crisis.ts
export const crisisEvents = pgTable('crisis_events', {
  id:             uuid('id').primaryKey(),
  userId:         uuid('user_id').notNull().references(() => users.id),
  source:         crisisSource('source').notNull(),
  sourceEntryId:  uuid('source_entry_id').notNull(),          // the prediction/journal id; dedupe key with source
  ruleIds:        text('rule_ids').array().notNull(),          // which hard-coded rules fired, e.g. ['R03_intent','R07_means']
  resourcesShown: text('resources_shown').array().notNull(),   // ['988','vcl_988_1','vcl_text_838255']
  detectedOnDevice: boolean('detected_on_device').notNull(),   // true = client caught it offline; false = API caught it on sync
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  clinicianNotifiedAt: timestamp('clinician_notified_at', { withTimezone: true }),  // only if link.share_crisis_events
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex('crisis_dedupe_uq').on(t.source, t.sourceEntryId),
  index('crisis_user_idx').on(t.userId, t.createdAt),
]);
```

`crisis_events` deliberately stores **no text** — not the matched phrase, not a snippet. It stores which rule IDs fired and which resources were shown. The rule table itself lives in code (`@pp/shared/crisis`) and is versioned in git, so an event is always reconstructible from `rule_ids` + the commit. This is how the table stays useful to you and useless to a log scraper.

```ts
// packages/api/src/db/schema/sync.ts   [addition — sync bookkeeping, not domain data]
export const devices = pgTable('devices', {
  id:            uuid('id').primaryKey(),               // generated on first launch, stored in SecureStore
  userId:        uuid('user_id').notNull().references(() => users.id),
  expoPushToken: text('expo_push_token'),               // for check-in prompts; nullable
  lastPullAt:    timestamp('last_pull_at', { withTimezone: true }),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Needed for two things on your list: push notifications (the token has to live somewhere) and offline sync (the pull cursor). No platform identifiers beyond the push token.

### The body-state JSON (typed in `@pp/shared`)

These are `jsonb` because they're written as a unit, read as a unit, and will evolve fastest. Every field is drawn from your Floor 7 note and the panic/PTSD/social-anxiety protocols; the reasoning is in `theory-mapping.md` §3.

```ts
type Channel = 'heart' | 'breath' | 'head' | 'unreality' | 'stomach' | 'muscle' | 'numb';
// 'numb' is the alexithymic case from Floor 7: "the alarm is ringing on a floor his awareness doesn't visit"

interface BodyStateBefore {
  channels: Channel[];
  intensity: number;               // 0–10
  words: string[];                 // free, seeded with "tight", "heavy", "buzzing"
  verdict?: string;                // what the body means right now, verbatim ("heart → dying")
  verdictConfidence?: number;      // 0–100
  room?: string;                   // "which room were you in" — short label, not free prose
  kitPresent: string[];            // armor items on the table: 'water', 'meds', 'exit_seat', 'phone', 'person', …
  substancesLast12h?: boolean;     // protocols: "experiments run sober or they don't count"
  sleepHours?: number;
  scanTriggered?: boolean;         // "checking the heart raises the heart"
}

interface BodyStateAfter {
  peakIntensity: number;           // 0–10
  ranPastPeak: boolean;            // "run past the peak rather than to the first flinch"
  timeToCrestMin?: number;
  verdictArrived: 'yes' | 'partly' | 'no';   // did the body's forecast come due
  creditedTo: 'body' | 'kit' | 'person' | 'technique' | 'luck';  // the accounting that converts "rescued" into "false alarm"
  kitUsed: string[];               // includes breathing-during-episode
  feltVsObserved?: string;         // optional external check: "what did your hands do"
  wordNow?: string;                // the after-name, so the numb client's vocabulary accumulates
}
```

The one clinician-facing number that falls out of this: **survivals without kit**. Your panic protocol says that is the only column that converts *rescued* into *false alarm*. The calibration module computes it separately from the headline hit/miss count.

---

## 3. Row-level security (written now, as you asked)

The API connects as a dedicated Postgres role (`pp_api`) that **does not bypass RLS**. Every request runs inside a transaction that first executes `SELECT set_config('request.user_id', $1, true), set_config('request.role', $2, true)` from the verified JWT. Policies read those settings. So the API layer scopes by `user_id`/role in application code *and* Postgres refuses anything that slips past — two layers, as you specified. The Supabase service-role key is never used by the API; it's only for migrations.

Policy shape, in prose (the SQL lives in `db/rls/`):

Clients: full CRUD on their own rows in `predictions`, `reinterpretations`, `priors`, `prediction_priors`, `journal_entries`, `devices`; `SELECT` only on their own `crisis_events`; `SELECT`/`UPDATE` on `clinician_client_links` where they are the client (they own consent).

Clinicians: `SELECT` on `predictions` where an `active` link exists to that client **and** `share_predictions` (full rows) or `share_calibration` (verdict/confidence/timestamps only, via a view that omits the `_enc` columns); `SELECT` on `priors` where `share_priors`; `UPDATE` on `priors.safe_to_test` and `INSERT` on clinician-origin priors where `share_priors`; `SELECT` on `journal_entries` only where `shared_at IS NOT NULL` and a link is active; `SELECT` on `crisis_events` where `share_crisis_events`; never any access to `reinterpretations` text unless `share_predictions` (they're part of the record); nothing on `devices`. Revoking a link (`status = 'revoked'`) cuts every one of these instantly because every policy joins through `status = 'active'`.

Drizzle ≥0.36 has `pgPolicy()` so the policies can live next to the tables in TypeScript and go out with `drizzle-kit generate`. I'd still keep the RLS test suite running against a real Postgres (Supabase local or a docker Postgres — see question 5).

---

## 4. Encryption

Field-level: AES-256-GCM per value, envelope = `key_version || iv || ciphertext || tag`, stored in `bytea`. The data-encryption key is derived from `FIELD_ENCRYPTION_KEY` (32 bytes, base64, in env) via HKDF with the table+column name as context, so a leak of one column's plaintext key doesn't unlock others. `key_version` per row makes rotation a background job (`jobs/rotate-keys.ts`), not a migration. Encrypted columns: `situation`, `expected_outcome`, `actual_outcome`, `reinterpretations.text`, `priors.label`, `journal_entries.body`. Not encrypted: numbers, enums, timestamps, the body-state JSON (channels/intensities/booleans — no free prose except `words`, `verdict`, `room`, `wordNow`; see question 4).

The key is app-managed as you specified. It's stored in env on Render now and would move to Secret Manager on Cloud Run — config, not code.

---

## 5. Questions before I write code

Answer as many or as few as you like; I'll assume the recommended default for anything you don't address.

**1. Clustering without an LLM — what does it actually cluster?** "Pure functions, no LLM calls" can't cluster encrypted free text semantically. My proposed design: the client tags each prediction with a prior at creation (pick from their list, or type a new label + choose a category), and `clustering/` is deterministic over *tags and categories* — it groups predictions by prior, ranks priors by count and average confidence, merges priors the client marks as "same thing," and surfaces "you've made 6 predictions with no prior — do these belong together?" The Anthropic call, server-side and opt-in, can *suggest* a label or a merge, but never assigns one. This is also the faithful reading of the paper: the sideways miss is "a floor reading," not something an algorithm should paper over. **Recommended: yes, tag-based.** Alternative: the API computes text embeddings — but that's a new third-party dependency, so I'm not assuming it.

**2. `outcome_verdict` as a required field at resolve time.** Recommended yes — it's the only path to the calibration number. The alternative is a free-text-only resolve and a number the app can't produce.

**3. The `reinterpretations` table.** Recommended yes, as an append-only, one-question prompt after the surprise rating ("what did you tell yourself about why it went that way?"), skippable. Alternative: fold it into a column on `predictions`, which loses the "cannot edit the outcome" property.

**4. Body-state prose fields inside jsonb.** `words`, `verdict`, `room`, `wordNow` are short free text and would be unencrypted in jsonb. Options: (a) accept it — they're single words or short phrases, low identification risk; (b) split body states into their own table with `_enc` columns — cleaner encryption story, more sync complexity. **Recommended (b) if you want the interoceptive track to survive a HIPAA review without a caveat; (a) for milestone 1 with a migration later.** Your call.

**5. Local Postgres for tests.** Supabase free tier for dev as you said. For the RLS test suite I'd like a throwaway Postgres in Docker (`docker-compose.yml`, no third-party service — just the `postgres:16` image) so tests can create and drop databases without touching the shared dev instance. Confirm this is acceptable under "ask before adding."

**6. Expo push.** Push notifications on Expo/EAS go through Expo's push service (their servers relay to APNs/FCM). It's part of EAS as you listed it, but it *is* a third party touching device tokens, so I'm flagging it rather than assuming. Token only, no content beyond "time for a check-in."

**7. `safe_to_test` semantics in solo mode.** Recommended: NULL, invisible, no warnings. The app never tells a solo user that a room is hostile; only a linked clinician can set that.

**8. `users.timezone`.** Needed for scheduling check-ins at sane hours. Not PHI, but it is a location-ish field; say the word and I'll drop it and use device-local scheduling only.

Reply with approvals or edits and I'll scaffold the workspace, `packages/shared` (schemas, calibration, crisis, vocabulary, with tests), the API (schema, migrations, RLS, sync route), and the Expo client for milestone 1. Nothing goes in the repo that isn't on your list without your answer above.
