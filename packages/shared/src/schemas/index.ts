import { z } from 'zod';
import {
  ABANDON_REASONS,
  BODY_CHANNELS,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  CREDITED_TO,
  EXIT_MOVES,
  INTENSITY_MAX,
  INTENSITY_MIN,
  KIT_ITEMS,
  LINK_STATUSES,
  OUTCOME_SOURCES,
  OUTCOME_VERDICTS,
  OWN_PART_OPTIONS,
  PRIOR_CATEGORIES,
  PRIOR_ORIGINS,
  COUNTS_FOR_MAX,
  COUNTS_FOR_MIN,
  SURPRISE_MAX,
  SURPRISE_MIN,
  USER_ROLES,
  VERDICT_ARRIVED,
} from '../vocabulary/index.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const uuid = z.string().uuid();
/** ISO-8601 timestamp with offset. Always a string on the wire. */
export const isoDate = z.string().datetime({ offset: true });
export const confidence = z.number().int().min(CONFIDENCE_MIN).max(CONFIDENCE_MAX);
export const intensity = z.number().int().min(INTENSITY_MIN).max(INTENSITY_MAX);
export const surprise = z.number().int().min(SURPRISE_MIN).max(SURPRISE_MAX);
/**
 * "How much does this one count?" — 0 to 100, in steps of ten on the screen,
 * but any integer in range is accepted on the wire so an older or a wider
 * control cannot be rejected by a slider's step size.
 */
export const countsFor = z.number().int().min(COUNTS_FOR_MIN).max(COUNTS_FOR_MAX);

/** Short free text: single words or phrases. Hard cap keeps prose out of jsonb. */
const shortText = z.string().trim().min(1).max(80);
const longText = z.string().trim().min(1).max(4000);

const syncMeta = {
  createdAt: isoDate,
  clientUpdatedAt: isoDate,
  deletedAt: isoDate.nullable().optional(),
};

// ---------------------------------------------------------------------------
// Body states (Floor 7). Separate table, prose fields encrypted server-side.
// ---------------------------------------------------------------------------

export const bodyStateBeforeSchema = z.object({
  channels: z.array(z.enum(BODY_CHANNELS)).max(8).default([]),
  intensity: intensity,
  words: z.array(shortText).max(10).default([]),
  /** What the body means right now, verbatim ("heart → dying"). */
  verdict: shortText.optional(),
  verdictConfidence: confidence.optional(),
  /** "Which room were you in" — a short label. */
  room: shortText.optional(),
  kitPresent: z.array(z.enum(KIT_ITEMS)).max(8).default([]),
  substancesLast12h: z.boolean().optional(),
  sleepHours: z.number().min(0).max(24).optional(),
  scanTriggered: z.boolean().optional(),
});
export type BodyStateBefore = z.infer<typeof bodyStateBeforeSchema>;

export const bodyStateAfterSchema = z.object({
  peakIntensity: intensity,
  ranPastPeak: z.boolean(),
  timeToCrestMin: z.number().int().min(0).max(720).optional(),
  verdictArrived: z.enum(VERDICT_ARRIVED),
  creditedTo: z.enum(CREDITED_TO),
  kitUsed: z.array(z.enum(KIT_ITEMS)).max(8).default([]),
  /** Optional external check: "what did your hands do". */
  feltVsObserved: shortText.optional(),
  /** The after-name, so the numb client's vocabulary accumulates. */
  wordNow: shortText.optional(),
});
export type BodyStateAfter = z.infer<typeof bodyStateAfterSchema>;

export const bodyStateSchema = z.object({
  id: uuid,
  predictionId: uuid,
  phase: z.enum(['before', 'after']),
  before: bodyStateBeforeSchema.optional(),
  after: bodyStateAfterSchema.optional(),
  ...syncMeta,
}).refine((b) => (b.phase === 'before' ? !!b.before && !b.after : !!b.after && !b.before), {
  message: 'body state must carry exactly the payload for its phase',
});
export type BodyState = z.infer<typeof bodyStateSchema>;

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

export const predictionSchema = z
  .object({
    id: uuid,
    // before
    situation: longText,
    expectedOutcome: longText,
    confidence: confidence,
    reviseAfterN: z.number().int().min(1).max(100).nullable().optional(),
    scheduledFor: isoDate.nullable().optional(),
    /** "How will you probably get out of this?" — the exit forecast. */
    exitForecast: z.enum(EXIT_MOVES).nullable().optional(),
    exitForecastNote: shortText.nullable().optional(),
    // after
    resolvedAt: isoDate.nullable().optional(),
    actualOutcome: longText.nullable().optional(),
    outcomeVerdict: z.enum(OUTCOME_VERDICTS).nullable().optional(),
    outcomeSource: z.enum(OUTCOME_SOURCES).nullable().optional(),
    surpriseRating: surprise.nullable().optional(),
    presentForIt: z.boolean().nullable().optional(),
    ownPart: z.enum(OWN_PART_OPTIONS).nullable().optional(),
    /**
     * "How much does this one count?" — 0 to 100, asked only on a miss or a
     * partial. Nullable and skippable: an unanswered question is null and
     * never 100, because "they did not say" and "it counted completely" are
     * different facts and the discount rate must not read the first as the
     * second.
     */
    countsFor: countsFor.nullable().optional(),
    /** "Did you?" — the exit actually taken. */
    exitActual: z.enum(EXIT_MOVES).nullable().optional(),
    exitActualNote: shortText.nullable().optional(),
    // never run
    abandonedAt: isoDate.nullable().optional(),
    abandonReason: z.enum(ABANDON_REASONS).nullable().optional(),
    // tags
    priorIds: z.array(uuid).max(10).default([]),
    ...syncMeta,
  })
  .superRefine((p, ctx) => {
    if (p.resolvedAt && !p.outcomeVerdict) {
      ctx.addIssue({ code: 'custom', path: ['outcomeVerdict'], message: 'resolved predictions need a verdict' });
    }
    if (p.resolvedAt && p.abandonedAt) {
      ctx.addIssue({ code: 'custom', path: ['abandonedAt'], message: 'a prediction is resolved or abandoned, not both' });
    }
    if (p.abandonedAt && !p.abandonReason) {
      ctx.addIssue({ code: 'custom', path: ['abandonReason'], message: 'abandoned predictions need a reason' });
    }
  });
export type Prediction = z.infer<typeof predictionSchema>;

/** Input for creating a prediction on the phone. Everything else is derived. */
export const newPredictionInput = z.object({
  situation: longText,
  expectedOutcome: longText,
  confidence: confidence,
  reviseAfterN: z.number().int().min(1).max(100).optional(),
  scheduledFor: isoDate.optional(),
  exitForecast: z.enum(EXIT_MOVES).optional(),
  exitForecastNote: shortText.optional(),
  priorIds: z.array(uuid).max(10).default([]),
  bodyBefore: bodyStateBeforeSchema.optional(),
});
export type NewPredictionInput = z.infer<typeof newPredictionInput>;

export const resolvePredictionInput = z.object({
  actualOutcome: longText,
  outcomeVerdict: z.enum(OUTCOME_VERDICTS),
  outcomeSource: z.enum(OUTCOME_SOURCES),
  surpriseRating: surprise,
  presentForIt: z.boolean(),
  ownPart: z.enum(OWN_PART_OPTIONS).optional(),
  /** Only asked on a miss or a partial; see resolvePredictionInput's refinement. */
  countsFor: countsFor.optional(),
  exitActual: z.enum(EXIT_MOVES).optional(),
  exitActualNote: shortText.optional(),
  reinterpretation: longText.optional(),
  bodyAfter: bodyStateAfterSchema.optional(),
})
  .superRefine((r, ctx) => {
    // A hit is not discounted, and the question is not asked. Accepting an
    // answer on a hit would put a number in the discount rate that nobody was
    // asked for.
    if (r.countsFor != null && r.outcomeVerdict !== 'miss' && r.outcomeVerdict !== 'partial') {
      ctx.addIssue({ code: 'custom', path: ['countsFor'], message: 'only asked on a miss or a partial' });
    }
  });
export type ResolvePredictionInput = z.infer<typeof resolvePredictionInput>;

export const abandonPredictionInput = z.object({
  abandonReason: z.enum(ABANDON_REASONS),
});

// ---------------------------------------------------------------------------
// Reinterpretations — append-only; cannot edit the outcome
// ---------------------------------------------------------------------------

export const reinterpretationSchema = z.object({
  id: uuid,
  predictionId: uuid,
  text: longText,
  ...syncMeta,
});
export type Reinterpretation = z.infer<typeof reinterpretationSchema>;

// ---------------------------------------------------------------------------
// Priors
// ---------------------------------------------------------------------------

export const priorSchema = z.object({
  id: uuid,
  label: z.string().trim().min(1).max(200),
  category: z.enum(PRIOR_CATEGORIES).default('other'),
  origin: z.enum(PRIOR_ORIGINS),
  /** Clinician-owned. null = not reviewed. Invisible in solo mode. */
  safeToTest: z.boolean().nullable().optional(),
  retiredAt: isoDate.nullable().optional(),
  createdBy: z.enum(USER_ROLES),
  ...syncMeta,
});
export type Prior = z.infer<typeof priorSchema>;

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export const journalEntrySchema = z.object({
  id: uuid,
  predictionId: uuid.nullable().optional(),
  body: z.string().trim().min(1).max(20000),
  sharedAt: isoDate.nullable().optional(),
  ...syncMeta,
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;

// ---------------------------------------------------------------------------
// Crisis events — rule ids only, never text
// ---------------------------------------------------------------------------

export const crisisSourceSchema = z.enum(['prediction', 'journal', 'body_state', 'checkin']);
export const crisisEventSchema = z.object({
  id: uuid,
  source: crisisSourceSchema,
  sourceEntryId: uuid,
  ruleIds: z.array(z.string().regex(/^R\d{2}_[a-z_]+$/)).min(1),
  resourcesShown: z.array(z.string()).min(1),
  detectedOnDevice: z.boolean(),
  acknowledgedAt: isoDate.nullable().optional(),
  createdAt: isoDate,
});
export type CrisisEvent = z.infer<typeof crisisEventSchema>;

// ---------------------------------------------------------------------------
// Links (clinician ↔ client)
// ---------------------------------------------------------------------------

export const shareLayersSchema = z.object({
  shareCalibration: z.boolean().default(true),
  sharePredictions: z.boolean().default(false),
  sharePriors: z.boolean().default(true),
  shareBodyStates: z.boolean().default(false),
  shareCrisisEvents: z.boolean().default(true),
});
export type ShareLayers = z.infer<typeof shareLayersSchema>;

export const linkSchema = z.object({
  id: uuid,
  clinicianId: uuid,
  clientId: uuid,
  status: z.enum(LINK_STATUSES),
  requestedBy: z.enum(USER_ROLES),
  ...shareLayersSchema.shape,
  consentedAt: isoDate.nullable().optional(),
  revokedAt: isoDate.nullable().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ClinicianClientLink = z.infer<typeof linkSchema>;

// ---------------------------------------------------------------------------
// Sync envelope — what the phone sends and receives
// ---------------------------------------------------------------------------

export const syncPushSchema = z.object({
  deviceId: uuid,
  predictions: z.array(predictionSchema).max(500).default([]),
  bodyStates: z.array(bodyStateSchema).max(1000).default([]),
  reinterpretations: z.array(reinterpretationSchema).max(500).default([]),
  priors: z.array(priorSchema).max(200).default([]),
  journalEntries: z.array(journalEntrySchema).max(200).default([]),
  crisisEvents: z.array(crisisEventSchema).max(100).default([]),
  /** Cursor from the last pull; server returns rows changed after it. */
  since: isoDate.nullable().optional(),
  expoPushToken: z.string().max(200).nullable().optional(),
});
export type SyncPush = z.infer<typeof syncPushSchema>;

export const syncPullSchema = z.object({
  serverTime: isoDate,
  predictions: z.array(predictionSchema),
  bodyStates: z.array(bodyStateSchema),
  reinterpretations: z.array(reinterpretationSchema),
  priors: z.array(priorSchema),
  journalEntries: z.array(journalEntrySchema),
  crisisEvents: z.array(crisisEventSchema),
  /** Ids the server rejected, with a reason code. Client keeps them queued. */
  rejected: z.array(z.object({ id: uuid, table: z.string(), code: z.string() })),
});
export type SyncPull = z.infer<typeof syncPullSchema>;
