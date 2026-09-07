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
  foreignKey,
  index,
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
export const crisisSource = pgEnum('crisis_source', ['prediction', 'journal', 'body_state', 'checkin']);

// ---------------------------------------------------------------------------
// users — id = Supabase auth.users.id. No email, no name. Ever.
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  role: userRole('role').notNull().default('client'),
  timezone: text('timezone').notNull().default('America/Los_Angeles'),
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

export type UserRow = typeof users.$inferSelect;
export type PredictionRow = typeof predictions.$inferSelect;
export type BodyStateRow = typeof bodyStates.$inferSelect;
export type ReinterpretationRow = typeof reinterpretations.$inferSelect;
export type PriorRow = typeof priors.$inferSelect;
export type JournalEntryRow = typeof journalEntries.$inferSelect;
export type CrisisEventRow = typeof crisisEvents.$inferSelect;
export type LinkRow = typeof clinicianClientLinks.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
