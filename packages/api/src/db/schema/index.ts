/**
 * Drizzle schema — one source of truth for the Postgres tables.
 *
 * Conventions
 *   - Ids are UUIDs generated on the client (v7, time-ordered) so offline rows
 *     have stable identities before they sync. The server never mints ids for
 *     client-owned rows.
 *   - Every client-owned table has `user_id`, `created_at` (client clock — the
 *     "written before" timestamp), `client_updated_at` (device clock, used for
 *     last-write-wins), `updated_at` (server clock), `deleted_at` (soft delete).
 *   - Free text is stored encrypted in `*_enc` bytea columns. `key_version`
 *     names the root key. See src/crypto.
 *   - RLS policies live in src/db/rls and are applied by migration. Every
 *     table below has RLS enabled; the API role cannot bypass it.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  real,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  ABANDON_REASONS,
  BODY_CHANNELS,
  CREDITED_TO,
  EXIT_MOVES,
  KIT_ITEMS,
  LINK_STATUSES,
  OUTCOME_SOURCES,
  OUTCOME_VERDICTS,
  OWN_PART_OPTIONS,
  PRIOR_CATEGORIES,
  PRIOR_ORIGINS,
  USER_ROLES,
  VERDICT_ARRIVED,
} from '@ledger/shared';

// ---------------------------------------------------------------------------
// Custom types
// ---------------------------------------------------------------------------

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Shared sync columns for client-owned rows. */
const syncColumns = {
  createdAt: ts('created_at').notNull(),
  clientUpdatedAt: ts('client_updated_at').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
  /**
   * Provenance, from 0009. `created_at` and `client_updated_at` are the
   * client's clock; `received_at` is the server's, set once and immutable by
   * trigger. The pair is the evidence a prediction existed before its outcome.
   */
  appVersion: text('app_version'),
  receivedAt: ts('received_at').notNull().defaultNow(),
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum('user_role', USER_ROLES);
export const linkStatus = pgEnum('link_status', LINK_STATUSES);
export const outcomeVerdict = pgEnum('outcome_verdict', OUTCOME_VERDICTS);
export const outcomeSource = pgEnum('outcome_source', OUTCOME_SOURCES);
export const abandonReason = pgEnum('abandon_reason', ABANDON_REASONS);
export const ownPart = pgEnum('own_part', OWN_PART_OPTIONS);
export const priorCategory = pgEnum('prior_category', PRIOR_CATEGORIES);
export const priorOrigin = pgEnum('prior_origin', PRIOR_ORIGINS);
export const bodyPhase = pgEnum('body_phase', ['before', 'after']);
export const bodyChannel = pgEnum('body_channel', BODY_CHANNELS);
export const kitItem = pgEnum('kit_item', KIT_ITEMS);
export const verdictArrived = pgEnum('verdict_arrived', VERDICT_ARRIVED);
export const creditedTo = pgEnum('credited_to', CREDITED_TO);
export const exitMove = pgEnum('exit_move', EXIT_MOVES);
export const crisisSource = pgEnum('crisis_source', ['prediction', 'journal', 'body_state', 'checkin']);

// ---------------------------------------------------------------------------
// users — id = Supabase auth.users.id. No email, no name. Ever.
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  role: userRole('role').notNull().default('client'),
  timezone: text('timezone').notNull().default('America/Los_Angeles'),
  /** Which version of the clinician BAA was accepted, and when. Added in 0008. */
  baaAcceptedVersion: text('baa_accepted_version'),
  baaAcceptedAt: ts('baa_accepted_at'),
  /**
   * Research consent, from 0009. Separate from clinician sharing in every way.
   * Withdrawal sets the withdrawn timestamp and leaves the consent timestamp
   * as history — that someone consented on a date does not stop being true.
   */
  researchConsentAt: ts('research_consent_at'),
  researchConsentWithdrawnAt: ts('research_consent_withdrawn_at'),
  researchConsentVersion: text('research_consent_version'),
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
});

// ---------------------------------------------------------------------------
// clinician_client_links — consent lives here, layer by layer
// ---------------------------------------------------------------------------

export const clinicianClientLinks = pgTable(
  'clinician_client_links',
  {
    id: uuid('id').primaryKey(),
    clinicianId: uuid('clinician_id')
      .notNull()
      .references(() => users.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => users.id),
    status: linkStatus('status').notNull().default('pending'),
    requestedBy: userRole('requested_by').notNull(),
    // Layers the client has consented to share. Client-controlled. Journal
    // entries are never a layer — they are shared one at a time.
    shareCalibration: boolean('share_calibration').notNull().default(true),
    sharePredictions: boolean('share_predictions').notNull().default(false),
    sharePriors: boolean('share_priors').notNull().default(true),
    shareBodyStates: boolean('share_body_states').notNull().default(false),
    shareCrisisEvents: boolean('share_crisis_events').notNull().default(true),
    consentedAt: ts('consented_at'),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('links_pair_uq').on(t.clinicianId, t.clientId),
    index('links_client_idx').on(t.clientId, t.status),
    index('links_clinician_idx').on(t.clinicianId, t.status),
    check('links_not_self', sql`${t.clinicianId} <> ${t.clientId}`),
  ],
);

// ---------------------------------------------------------------------------
// predictions — the ledger
// ---------------------------------------------------------------------------

export const predictions = pgTable(
  'predictions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    // before
    situationEnc: bytea('situation_enc').notNull(),
    expectedOutcomeEnc: bytea('expected_outcome_enc').notNull(),
    confidence: smallint('confidence').notNull(),
    /** Step 6 pre-commit: "how many times would this have to happen before you'd revise the rule?" */
    reviseAfterN: smallint('revise_after_n'),
    scheduledFor: ts('scheduled_for'),
    /** "How will you probably get out of this?" — the exit forecast (UCM §2.3 moves, graded like any forecast). */
    exitForecast: exitMove('exit_forecast'),
    exitForecastNoteEnc: bytea('exit_forecast_note_enc'),

    // after
    resolvedAt: ts('resolved_at'),
    actualOutcomeEnc: bytea('actual_outcome_enc'),
    /** The only field calibration reads. */
    outcomeVerdict: outcomeVerdict('outcome_verdict'),
    /** observed (what they said and did) vs inferred (mind-read). */
    outcomeSource: outcomeSource('outcome_source'),
    surpriseRating: smallint('surprise_rating'),
    /** Could the client say what actually happened? false = "it was too big". */
    presentForIt: boolean('present_for_it'),
    /** Self-report of the client's part. Weak per entry; the drift is the data. */
    ownPart: ownPart('own_part'),
    /**
     * "How much does this one count?" — 0 to 100, asked only on a miss or a
     * partial. Nullable and skippable: unanswered is null, never 100. Added
     * in 0006.
     */
    countsFor: smallint('counts_for'),
    /** "Did you?" — the exit actually taken. */
    exitActual: exitMove('exit_actual'),
    exitActualNoteEnc: bytea('exit_actual_note_enc'),

    // never run — the avoid move, made countable
    abandonedAt: ts('abandoned_at'),
    abandonReason: abandonReason('abandon_reason'),

    keyVersion: smallint('key_version').notNull().default(1),
    ...syncColumns,
  },
  (t) => [
    // Composite target for child-table FKs: a child row can only point at a
    // prediction owned by the same user (see body_states, reinterpretations…).
    unique('predictions_id_user_uq').on(t.id, t.userId),
    index('predictions_user_created_idx').on(t.userId, t.createdAt),
    index('predictions_user_updated_idx').on(t.userId, t.updatedAt),
    index('predictions_user_open_idx')
      .on(t.userId)
      .where(sql`${t.resolvedAt} IS NULL AND ${t.abandonedAt} IS NULL AND ${t.deletedAt} IS NULL`),
    check('predictions_confidence_range', sql`${t.confidence} BETWEEN 0 AND 100`),
    check('predictions_surprise_range', sql`${t.surpriseRating} IS NULL OR ${t.surpriseRating} BETWEEN 0 AND 10`),
    check('predictions_counts_for_range', sql`${t.countsFor} IS NULL OR ${t.countsFor} BETWEEN 0 AND 100`),
    check('predictions_resolved_has_verdict', sql`${t.resolvedAt} IS NULL OR ${t.outcomeVerdict} IS NOT NULL`),
    check('predictions_resolved_xor_abandoned', sql`NOT (${t.resolvedAt} IS NOT NULL AND ${t.abandonedAt} IS NOT NULL)`),
    check('predictions_abandoned_has_reason', sql`${t.abandonedAt} IS NULL OR ${t.abandonReason} IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------------------
// body_states — Floor 7. Own table so prose can be encrypted.
// ---------------------------------------------------------------------------

export const bodyStates = pgTable(
  'body_states',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    predictionId: uuid('prediction_id').notNull(),
    phase: bodyPhase('phase').notNull(),

    // before
    channels: bodyChannel('channels').array(),
    intensity: smallint('intensity'),
    wordsEnc: bytea('words_enc'), // JSON array of short words, encrypted
    verdictEnc: bytea('verdict_enc'),
    verdictConfidence: smallint('verdict_confidence'),
    roomEnc: bytea('room_enc'),
    kitPresent: kitItem('kit_present').array(),
    substancesLast12h: boolean('substances_last_12h'),
    sleepHours: real('sleep_hours'),
    scanTriggered: boolean('scan_triggered'),

    // after
    peakIntensity: smallint('peak_intensity'),
    ranPastPeak: boolean('ran_past_peak'),
    timeToCrestMin: smallint('time_to_crest_min'),
    verdictArrived: verdictArrived('verdict_arrived'),
    creditedTo: creditedTo('credited_to'),
    kitUsed: kitItem('kit_used').array(),
    feltVsObservedEnc: bytea('felt_vs_observed_enc'),
    wordNowEnc: bytea('word_now_enc'),

    keyVersion: smallint('key_version').notNull().default(1),
    ...syncColumns,
  },
  (t) => [
    foreignKey({ columns: [t.predictionId, t.userId], foreignColumns: [predictions.id, predictions.userId], name: 'body_states_prediction_owner_fk' }),
    uniqueIndex('body_states_prediction_phase_uq').on(t.predictionId, t.phase),
    index('body_states_user_updated_idx').on(t.userId, t.updatedAt),
    check('body_states_intensity_range', sql`${t.intensity} IS NULL OR ${t.intensity} BETWEEN 0 AND 10`),
    check('body_states_peak_range', sql`${t.peakIntensity} IS NULL OR ${t.peakIntensity} BETWEEN 0 AND 10`),
  ],
);

// ---------------------------------------------------------------------------
// reinterpretations — append-only; cannot edit the outcome
// ---------------------------------------------------------------------------

export const reinterpretations = pgTable(
  'reinterpretations',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    predictionId: uuid('prediction_id').notNull(),
    textEnc: bytea('text_enc').notNull(),
    keyVersion: smallint('key_version').notNull().default(1),
    ...syncColumns,
  },
  (t) => [
    foreignKey({ columns: [t.predictionId, t.userId], foreignColumns: [predictions.id, predictions.userId], name: 'reinterpretations_prediction_owner_fk' }),
    index('reinterpretations_prediction_idx').on(t.predictionId),
    index('reinterpretations_user_updated_idx').on(t.userId, t.updatedAt),
  ],
);

// ---------------------------------------------------------------------------
// priors
// ---------------------------------------------------------------------------

export const priors = pgTable(
  'priors',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    labelEnc: bytea('label_enc').notNull(),
    category: priorCategory('category').notNull().default('other'),
    origin: priorOrigin('origin').notNull(),
    /** Clinician-owned gate. NULL = not reviewed. Invisible in solo mode. */
    safeToTest: boolean('safe_to_test'),
    retiredAt: ts('retired_at'),
    createdBy: userRole('created_by').notNull(),
    keyVersion: smallint('key_version').notNull().default(1),
    ...syncColumns,
  },
  (t) => [unique('priors_id_user_uq').on(t.id, t.userId), index('priors_user_updated_idx').on(t.userId, t.updatedAt)],
);

export const predictionPriors = pgTable(
  'prediction_priors',
  {
    predictionId: uuid('prediction_id').notNull(),
    priorId: uuid('prior_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    assignedBy: priorOrigin('assigned_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.predictionId, t.priorId] }),
    foreignKey({ columns: [t.predictionId, t.userId], foreignColumns: [predictions.id, predictions.userId], name: 'prediction_priors_prediction_owner_fk' }),
    foreignKey({ columns: [t.priorId, t.userId], foreignColumns: [priors.id, priors.userId], name: 'prediction_priors_prior_owner_fk' }),
    index('prediction_priors_prior_idx').on(t.priorId),
  ],
);

// ---------------------------------------------------------------------------
// journal_entries — private by default, shared one at a time
// ---------------------------------------------------------------------------

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    predictionId: uuid('prediction_id'),
    bodyEnc: bytea('body_enc').notNull(),
    sharedAt: ts('shared_at'),
    keyVersion: smallint('key_version').notNull().default(1),
    ...syncColumns,
  },
  (t) => [
    foreignKey({ columns: [t.predictionId, t.userId], foreignColumns: [predictions.id, predictions.userId], name: 'journal_prediction_owner_fk' }),
    index('journal_user_updated_idx').on(t.userId, t.updatedAt),
  ],
);

// ---------------------------------------------------------------------------
// crisis_events — rule ids only. Never text.
// ---------------------------------------------------------------------------

export const crisisEvents = pgTable(
  'crisis_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    source: crisisSource('source').notNull(),
    sourceEntryId: uuid('source_entry_id').notNull(),
    ruleIds: text('rule_ids').array().notNull(),
    resourcesShown: text('resources_shown').array().notNull(),
    detectedOnDevice: boolean('detected_on_device').notNull(),
    acknowledgedAt: ts('acknowledged_at'),
    clinicianNotifiedAt: ts('clinician_notified_at'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('crisis_dedupe_uq').on(t.userId, t.source, t.sourceEntryId),
    index('crisis_user_idx').on(t.userId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// devices — sync cursor + push token. Nothing else about the device.
// ---------------------------------------------------------------------------

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    expoPushToken: text('expo_push_token'),
    lastPullAt: ts('last_pull_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  // Composite key: a device id is per install, but a second account signing
  // in on the same phone must not collide with (or be able to probe) the first.
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

// ---------------------------------------------------------------------------
// link_invites — how a link comes into existence (migration 0003)
// ---------------------------------------------------------------------------

/**
 * The clinician originates; the client consents by redeeming.
 *
 * `tokenHash` is the SHA-256 of a 32-byte token. The token itself is never
 * stored and is returned exactly once, in the response that creates the
 * invite. It travels in a URL fragment so it never reaches a server log, a
 * referrer header, or a proxy.
 *
 * Clients have no RLS visibility here at all — redemption goes through the
 * SECURITY DEFINER function `redeem_invite`.
 */
export const linkInvites = pgTable(
  'link_invites',
  {
    id: uuid('id').primaryKey(),
    clinicianId: uuid('clinician_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    // created_at + 7 days, forced by the link_invites_guard trigger.
    expiresAt: ts('expires_at').notNull(),
    redeemedAt: ts('redeemed_at'),
    redeemedBy: uuid('redeemed_by').references(() => users.id, { onDelete: 'set null' }),
    linkId: uuid('link_id').references(() => clinicianClientLinks.id, { onDelete: 'set null' }),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    unique('link_invites_token_hash_unique').on(t.tokenHash),
    index('link_invites_clinician_open_idx').on(t.clinicianId),
    check('link_invites_token_hash_len', sql`octet_length(${t.tokenHash}) = 32`),
    check('link_invites_redeem_pair', sql`(${t.redeemedAt} IS NULL) = (${t.redeemedBy} IS NULL)`),
    check('link_invites_not_self', sql`${t.redeemedBy} IS NULL OR ${t.redeemedBy} <> ${t.clinicianId}`),
  ],
);

// ---------------------------------------------------------------------------
// assistant_runs — what the locating assistant was asked, never what it read
// ---------------------------------------------------------------------------

/**
 * A record that a run happened. The note is PHI and is not here: only its
 * SHA-256, so two runs on the same note can be recognised as the same note.
 * No evidence spans either — those are verbatim quotes from the note.
 */
export const assistantRuns = pgTable(
  'assistant_runs',
  {
    id: uuid('id').primaryKey(),
    clinicianId: uuid('clinician_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    noteSha256: bytea('note_sha256').notNull(),
    observationIds: jsonb('observation_ids').notNull().default(sql`'[]'::jsonb`),
    /** Gate keys the run asked about: 'risk' | 'dial' | 'calibrated'. Added in 0004. */
    gateQuestionIds: jsonb('gate_question_ids').notNull().default(sql`'[]'::jsonb`),
    model: text('model').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('assistant_runs_note_sha256_len', sql`octet_length(${t.noteSha256}) = 32`),
    check('assistant_runs_not_self', sql`${t.clinicianId} <> ${t.clientId}`),
    check('assistant_runs_observation_ids_array', sql`jsonb_typeof(${t.observationIds}) = 'array'`),
    check('assistant_runs_gate_question_ids_array', sql`jsonb_typeof(${t.gateQuestionIds}) = 'array'`),
  ],
);

// ---------------------------------------------------------------------------
// formulations — where the locator's output lives
// ---------------------------------------------------------------------------

/**
 * The clinician's working note about a client, the way a paper chart is.
 * Append-only: a re-aim is a new row at `version + 1`, never an edit, and the
 * API role holds no UPDATE or DELETE grant. The client does not read these in
 * this version — see docs/data-path.md.
 */
export const formulations = pgTable(
  'formulations',
  {
    id: uuid('id').primaryKey(),
    clinicianId: uuid('clinician_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    linkId: uuid('link_id')
      .notNull()
      .references(() => clinicianClientLinks.id, { onDelete: 'cascade' }),
    // 1 first, +1 per re-aim. "Re-aim N of 2" is rendered from this, and at 3
    // the formulation itself goes on trial.
    version: smallint('version').notNull(),
    noteEnc: bytea('note_enc').notNull(),
    // What the clinician says would show this placement wrong. Required.
    falsifyEnc: bytea('falsify_enc').notNull(),
    keyVersion: smallint('key_version').notNull().default(1),
    // Observation ids only, validated against @ledger/shared before insert.
    observations: jsonb('observations').notNull().default(sql`'[]'::jsonb`),
    // { risk, dial, calibrated } — the clinician's attestation, never the
    // assistant's.
    gates: jsonb('gates').notNull(),
    floor: smallint('floor').notNull(),
    protocolSlug: text('protocol_slug'),
    assistantRunId: uuid('assistant_run_id').references(() => assistantRuns.id, { onDelete: 'set null' }),
    /**
     * The scope gate annotates and never blocks. True means the clinician was
     * told, as they wrote this, that the floor is outside their stack at this
     * tier. Null for rows written before the gate existed. Added in 0005.
     */
    outsideStack: boolean('outside_stack'),
    appVersion: text('app_version'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    unique('formulations_version_unique').on(t.clinicianId, t.clientId, t.version),
    index('formulations_pair_idx').on(t.clinicianId, t.clientId, t.version),
    check('formulations_version_positive', sql`${t.version} >= 1`),
    check('formulations_floor_range', sql`${t.floor} BETWEEN 1 AND 8`),
    check('formulations_not_self', sql`${t.clinicianId} <> ${t.clientId}`),
    check('formulations_observations_array', sql`jsonb_typeof(${t.observations}) = 'array'`),
    check(
      'formulations_gates_shape',
      // coalesce is load-bearing: `-> 'key'` on a missing key is SQL NULL,
      // jsonb_typeof(NULL) is NULL, and a CHECK evaluating to NULL PASSES.
      sql`jsonb_typeof(${t.gates}) = 'object'
        AND coalesce(jsonb_typeof(${t.gates} -> 'risk'), '') = 'boolean'
        AND coalesce(jsonb_typeof(${t.gates} -> 'dial'), '') = 'boolean'
        AND coalesce(jsonb_typeof(${t.gates} -> 'calibrated'), '') = 'boolean'`,
    ),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type PredictionRow = typeof predictions.$inferSelect;
export type BodyStateRow = typeof bodyStates.$inferSelect;
export type ReinterpretationRow = typeof reinterpretations.$inferSelect;
export type PriorRow = typeof priors.$inferSelect;
export type JournalEntryRow = typeof journalEntries.$inferSelect;
export type CrisisEventRow = typeof crisisEvents.$inferSelect;
// ---------------------------------------------------------------------------
// clinician_stacks / stack_goals — the clinician's own training stack
//
// Not client data and not PHI: a clinician's training is their own, no client
// can read it, and there is no policy that would let one. The catalogue of
// slugs lives in apps/clinician/content/modalities.ts with the document it
// came from, which is why modality_slug is text and not a foreign key.
//
// No unique index caps Master or Deep. Those are reading rules about a career,
// the app warns rather than blocks, and a database that refused the write
// would teach people to describe something false instead.
// ---------------------------------------------------------------------------
export const clinicianStacks = pgTable(
  'clinician_stacks',
  {
    clinicianId: uuid('clinician_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    modalitySlug: text('modality_slug').notNull(),
    tier: text('tier').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'clinician_stacks_pk', columns: [t.clinicianId, t.modalitySlug] }),
    check('clinician_stacks_tier_known', sql`${t.tier} IN ('literacy','fluent','deep','master')`),
    check('clinician_stacks_slug_shape', sql`${t.modalitySlug} ~ '^[a-z0-9-]{1,64}$'`),
  ],
);

/** The roadmap: a modality, the tier aimed at, and when. No note column. */
export const stackGoals = pgTable(
  'stack_goals',
  {
    clinicianId: uuid('clinician_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    modalitySlug: text('modality_slug').notNull(),
    targetTier: text('target_tier').notNull(),
    targetBy: date('target_by'),
    doneAt: ts('done_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'stack_goals_pk', columns: [t.clinicianId, t.modalitySlug] }),
    check('stack_goals_tier_known', sql`${t.targetTier} IN ('literacy','fluent','deep','master')`),
    check('stack_goals_slug_shape', sql`${t.modalitySlug} ~ '^[a-z0-9-]{1,64}$'`),
  ],
);

// ---------------------------------------------------------------------------
// measures — totals and subscales from published instruments
//
// Item-level responses are deliberately absent. Some items are sensitive in a
// way a total is not (PHQ-9 item 9 in particular) and storing them would put
// the crisis rules in the position of needing to read them. Totals and
// subscales only; no instrument's item text appears anywhere in this repo.
// ---------------------------------------------------------------------------
export const measures = pgTable(
  'measures',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Null when the client administered it to themselves. */
    clinicianId: uuid('clinician_id').references(() => users.id, { onDelete: 'set null' }),
    instrument: text('instrument').notNull(),
    score: numeric('score').notNull(),
    /** Numeric values keyed by the instrument's published subscale names. No prose. */
    subscales: jsonb('subscales'),
    administeredAt: ts('administered_at').notNull(),
    administeredBy: text('administered_by').notNull(),
    /**
     * The link it was taken under, from 0009. With one, it is part of the care
     * record and survives the client's purge the way a formulation does;
     * without one, it is the client's own data and goes with the account.
     */
    linkId: uuid('link_id').references(() => clinicianClientLinks.id, { onDelete: 'cascade' }),
    appVersion: text('app_version'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('measures_client_instrument_idx').on(t.clientId, t.instrument, t.administeredAt),
    check(
      'measures_instrument_known',
      sql`${t.instrument} IN ('phq9','gad7','pcl5','pdss','isi','ocir','shai','pg13','ims','sus','umars')`,
    ),
    check('measures_administered_by_known', sql`${t.administeredBy} IN ('client','clinician')`),
    check('measures_subscales_object', sql`${t.subscales} IS NULL OR jsonb_typeof(${t.subscales}) = 'object'`),
    check(
      'measures_administered_by_matches',
      sql`(${t.administeredBy} = 'clinician' AND ${t.clinicianId} IS NOT NULL)
        OR (${t.administeredBy} = 'client' AND ${t.clinicianId} IS NULL)`,
    ),
    check('measures_not_self', sql`${t.clinicianId} IS NULL OR ${t.clinicianId} <> ${t.clientId}`),
    check('measures_clinician_has_link', sql`${t.administeredBy} = 'client' OR ${t.linkId} IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------------------
// access_log — who read whose rows, and when
//
// Go-live gate B1. No content column, ever: the value of this table is that it
// can be kept for six years without becoming a second copy of the ledger.
// test/audit.test.ts asserts the column list.
//
// No foreign keys to users. It outlives the accounts it names — six years of
// retention against thirty days to deletion — and an audit record that
// disappears with its subject is not an audit record.
// ---------------------------------------------------------------------------
export const accessLog = pgTable(
  'access_log',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id').notNull(),
    actorRole: text('actor_role').notNull(),
    /** Whose rows. Null when the read is not about one client, e.g. a cohort export. */
    clientId: uuid('client_id'),
    tableName: text('table_name').notNull(),
    action: text('action').notNull(),
    rowCount: integer('row_count').notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [
    index('access_log_client_at_idx').on(t.clientId, t.at),
    index('access_log_actor_at_idx').on(t.actorId, t.at),
    check('access_log_action_known', sql`${t.action} IN ('read','export')`),
    check('access_log_row_count_sane', sql`${t.rowCount} >= 0`),
    check('access_log_actor_role_known', sql`${t.actorRole} IN ('client','clinician','system')`),
  ],
);

export const phaseKind = pgEnum('phase_kind', ['started', 'completed', 'paused', 'abandoned']);
export const usageKind = pgEnum('usage_kind', [
  'app_open',
  'prediction_created',
  'prediction_resolved',
  'ledger_viewed',
  'sync_completed',
  'crisis_card_shown',
  'settings_opened',
]);

/**
 * The vertical line on a multiple-baseline graph. Append-only,
 * clinician-written, and no note column: this says when a phase started, not
 * how it went.
 */
export const phaseEvents = pgTable(
  'phase_events',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clinicianId: uuid('clinician_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    formulationId: uuid('formulation_id').references(() => formulations.id, { onDelete: 'set null' }),
    protocolSlug: text('protocol_slug').notNull(),
    phase: smallint('phase').notNull(),
    kind: phaseKind('kind').notNull(),
    /** The clinician's date, not the server's. Backdating is bounded by a CHECK. */
    at: ts('at').notNull(),
    appVersion: text('app_version'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('phase_events_client_at_idx').on(t.clientId, t.at),
    check('phase_events_phase_range', sql`${t.phase} BETWEEN 0 AND 20`),
    check('phase_events_slug_shape', sql`${t.protocolSlug} ~ '^[a-z0-9-]{1,64}$'`),
    check('phase_events_not_self', sql`${t.clinicianId} <> ${t.clientId}`),
  ],
);

/**
 * Five columns and no sixth. No payload, no entity id, no text of any kind:
 * this answers "did they open the app" and must never become able to answer
 * "and what did they write". test/research.test.ts asserts the column list.
 */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: usageKind('kind').notNull(),
    appVersion: text('app_version'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('usage_events_user_created_idx').on(t.userId, t.createdAt)],
);

/** What left, and when. Nothing about who: that would defeat the pseudonyms. */
export const exports_ = pgTable(
  'exports',
  {
    id: uuid('id').primaryKey(),
    at: ts('at').notNull().defaultNow(),
    participantCount: integer('participant_count').notNull(),
    allowlistSha256: bytea('allowlist_sha256').notNull(),
    dryRun: boolean('dry_run').notNull().default(false),
  },
  (t) => [
    check('exports_allowlist_sha256_len', sql`octet_length(${t.allowlistSha256}) = 32`),
    check('exports_participant_count_sane', sql`${t.participantCount} >= 0`),
  ],
);

export type LinkRow = typeof clinicianClientLinks.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type LinkInviteRow = typeof linkInvites.$inferSelect;
export type FormulationRow = typeof formulations.$inferSelect;
export type AssistantRunRow = typeof assistantRuns.$inferSelect;
export type ClinicianStackRow = typeof clinicianStacks.$inferSelect;
export type StackGoalRow = typeof stackGoals.$inferSelect;
export type MeasureRow = typeof measures.$inferSelect;
export type AccessLogRow = typeof accessLog.$inferSelect;
export type PhaseEventRow = typeof phaseEvents.$inferSelect;
export type UsageEventRow = typeof usageEvents.$inferSelect;
