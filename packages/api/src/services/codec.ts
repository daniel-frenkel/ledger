/**
 * Row ⇄ wire codecs. The wire shape is the plaintext domain object from
 * @ledger/shared; the row shape is the encrypted Drizzle row. Encryption
 * happens here and only here.
 */
import type {
  BodyState,
  BodyStateAfter,
  BodyStateBefore,
  CrisisEvent,
  JournalEntry,
  Prediction,
  Prior,
  Reinterpretation,
} from '@ledger/shared';
import { dec, decJson, enc, encJson } from '../crypto/fields.js';
import type { schema } from '../db/client.js';

type PredictionInsert = typeof schema.predictions.$inferInsert;
type PredictionRow = typeof schema.predictions.$inferSelect;
type BodyInsert = typeof schema.bodyStates.$inferInsert;
type BodyRow = typeof schema.bodyStates.$inferSelect;
type ReinterpInsert = typeof schema.reinterpretations.$inferInsert;
type ReinterpRow = typeof schema.reinterpretations.$inferSelect;
type PriorInsert = typeof schema.priors.$inferInsert;
type PriorRow = typeof schema.priors.$inferSelect;
type JournalInsert = typeof schema.journalEntries.$inferInsert;
type JournalRow = typeof schema.journalEntries.$inferSelect;
type CrisisInsert = typeof schema.crisisEvents.$inferInsert;
type CrisisRow = typeof schema.crisisEvents.$inferSelect;

const nn = <T>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);
const orNull = <T>(v: T | null | undefined): T | null => (v == null ? null : v);
/** ISO string → Date (or null). */
const d = (v: string | null | undefined): Date | null => (v == null ? null : new Date(v));
/** Date → ISO string (or null). */
const iso = (v: Date | null | undefined): string | null => (v == null ? null : v.toISOString());

// ---------------------------------------------------------------------------
// predictions
// ---------------------------------------------------------------------------

export function predictionToRow(p: Prediction, userId: string, keyVersion: number): PredictionInsert {
  return {
    id: p.id,
    userId,
    situationEnc: enc(p.situation, 'predictions.situation')!,
    expectedOutcomeEnc: enc(p.expectedOutcome, 'predictions.expected_outcome')!,
    confidence: p.confidence,
    reviseAfterN: orNull(p.reviseAfterN),
    scheduledFor: d(p.scheduledFor),
    exitForecast: orNull(p.exitForecast),
    exitForecastNoteEnc: enc(p.exitForecastNote, 'predictions.exit_forecast_note'),
    resolvedAt: d(p.resolvedAt),
    actualOutcomeEnc: enc(p.actualOutcome, 'predictions.actual_outcome'),
    outcomeVerdict: orNull(p.outcomeVerdict),
    outcomeSource: orNull(p.outcomeSource),
    surpriseRating: orNull(p.surpriseRating),
    presentForIt: orNull(p.presentForIt),
    ownPart: orNull(p.ownPart),
    exitActual: orNull(p.exitActual),
    exitActualNoteEnc: enc(p.exitActualNote, 'predictions.exit_actual_note'),
    abandonedAt: d(p.abandonedAt),
    abandonReason: orNull(p.abandonReason),
    keyVersion,
    createdAt: new Date(p.createdAt),
    clientUpdatedAt: new Date(p.clientUpdatedAt),
    deletedAt: d(p.deletedAt),
  };
}

export function rowToPrediction(r: PredictionRow, priorIds: string[]): Prediction {
  return {
    id: r.id,
    situation: dec(r.situationEnc, 'predictions.situation')!,
    expectedOutcome: dec(r.expectedOutcomeEnc, 'predictions.expected_outcome')!,
    confidence: r.confidence,
    reviseAfterN: r.reviseAfterN,
    scheduledFor: iso(r.scheduledFor),
    exitForecast: r.exitForecast,
    exitForecastNote: dec(r.exitForecastNoteEnc, 'predictions.exit_forecast_note'),
    resolvedAt: iso(r.resolvedAt),
    actualOutcome: dec(r.actualOutcomeEnc, 'predictions.actual_outcome'),
    outcomeVerdict: r.outcomeVerdict,
    outcomeSource: r.outcomeSource,
    surpriseRating: r.surpriseRating,
    presentForIt: r.presentForIt,
    ownPart: r.ownPart,
    exitActual: r.exitActual,
    exitActualNote: dec(r.exitActualNoteEnc, 'predictions.exit_actual_note'),
    abandonedAt: iso(r.abandonedAt),
    abandonReason: r.abandonReason,
    priorIds,
    createdAt: r.createdAt.toISOString(),
    clientUpdatedAt: r.clientUpdatedAt.toISOString(),
    deletedAt: iso(r.deletedAt),
  };
}

// ---------------------------------------------------------------------------
// body_states
// ---------------------------------------------------------------------------

export function bodyStateToRow(b: BodyState, userId: string, keyVersion: number): BodyInsert {
  const before = b.before;
  const after = b.after;
  return {
    id: b.id,
    userId,
    predictionId: b.predictionId,
    phase: b.phase,
    channels: before ? before.channels : null,
    intensity: before ? before.intensity : null,
    wordsEnc: before ? encJson(before.words, 'body_states.words') : null,
    verdictEnc: before ? enc(before.verdict, 'body_states.verdict') : null,
    verdictConfidence: before ? orNull(before.verdictConfidence) : null,
    roomEnc: before ? enc(before.room, 'body_states.room') : null,
    kitPresent: before ? before.kitPresent : null,
    substancesLast12h: before ? orNull(before.substancesLast12h) : null,
    sleepHours: before ? orNull(before.sleepHours) : null,
    scanTriggered: before ? orNull(before.scanTriggered) : null,
    peakIntensity: after ? after.peakIntensity : null,
    ranPastPeak: after ? after.ranPastPeak : null,
    timeToCrestMin: after ? orNull(after.timeToCrestMin) : null,
    verdictArrived: after ? after.verdictArrived : null,
    creditedTo: after ? after.creditedTo : null,
    kitUsed: after ? after.kitUsed : null,
    feltVsObservedEnc: after ? enc(after.feltVsObserved, 'body_states.felt_vs_observed') : null,
    wordNowEnc: after ? enc(after.wordNow, 'body_states.word_now') : null,
    keyVersion,
    createdAt: new Date(b.createdAt),
    clientUpdatedAt: new Date(b.clientUpdatedAt),
    deletedAt: d(b.deletedAt),
  };
}

export function rowToBodyState(r: BodyRow): BodyState {
  const base = {
    id: r.id,
    predictionId: r.predictionId,
    createdAt: r.createdAt.toISOString(),
    clientUpdatedAt: r.clientUpdatedAt.toISOString(),
    deletedAt: iso(r.deletedAt),
  };
  if (r.phase === 'before') {
    const before: BodyStateBefore = {
      channels: r.channels ?? [],
      intensity: r.intensity ?? 0,
      words: decJson<string[]>(r.wordsEnc, 'body_states.words') ?? [],
      kitPresent: r.kitPresent ?? [],
    };
    const verdict = dec(r.verdictEnc, 'body_states.verdict');
    if (verdict) before.verdict = verdict;
    if (r.verdictConfidence != null) before.verdictConfidence = r.verdictConfidence;
    const room = dec(r.roomEnc, 'body_states.room');
    if (room) before.room = room;
    if (r.substancesLast12h != null) before.substancesLast12h = r.substancesLast12h;
    if (r.sleepHours != null) before.sleepHours = r.sleepHours;
    if (r.scanTriggered != null) before.scanTriggered = r.scanTriggered;
    return { ...base, phase: 'before', before };
  }
  const after: BodyStateAfter = {
    peakIntensity: r.peakIntensity ?? 0,
    ranPastPeak: r.ranPastPeak ?? false,
    verdictArrived: r.verdictArrived ?? 'no',
    creditedTo: r.creditedTo ?? 'body',
    kitUsed: r.kitUsed ?? [],
  };
  if (r.timeToCrestMin != null) after.timeToCrestMin = r.timeToCrestMin;
  const fvo = dec(r.feltVsObservedEnc, 'body_states.felt_vs_observed');
  if (fvo) after.feltVsObserved = fvo;
  const wn = dec(r.wordNowEnc, 'body_states.word_now');
  if (wn) after.wordNow = wn;
  return { ...base, phase: 'after', after };
}

// ---------------------------------------------------------------------------
// reinterpretations
// ---------------------------------------------------------------------------

export function reinterpToRow(x: Reinterpretation, userId: string, keyVersion: number): ReinterpInsert {
  return {
    id: x.id,
    userId,
    predictionId: x.predictionId,
    textEnc: enc(x.text, 'reinterpretations.text')!,
    keyVersion,
    createdAt: new Date(x.createdAt),
    clientUpdatedAt: new Date(x.clientUpdatedAt),
    deletedAt: d(x.deletedAt),
  };
}

export function rowToReinterp(r: ReinterpRow): Reinterpretation {
  return {
    id: r.id,
    predictionId: r.predictionId,
    text: dec(r.textEnc, 'reinterpretations.text')!,
    createdAt: r.createdAt.toISOString(),
    clientUpdatedAt: r.clientUpdatedAt.toISOString(),
    deletedAt: iso(r.deletedAt),
  };
}

// ---------------------------------------------------------------------------
// priors
// ---------------------------------------------------------------------------

export function priorToRow(p: Prior, userId: string, keyVersion: number): PriorInsert {
  return {
    id: p.id,
    userId,
    labelEnc: enc(p.label, 'priors.label')!,
    category: p.category,
    origin: p.origin,
    safeToTest: orNull(p.safeToTest),
    retiredAt: d(p.retiredAt),
    createdBy: p.createdBy,
    keyVersion,
    createdAt: new Date(p.createdAt),
    clientUpdatedAt: new Date(p.clientUpdatedAt),
    deletedAt: d(p.deletedAt),
  };
}

export function rowToPrior(r: PriorRow): Prior {
  return {
    id: r.id,
    label: dec(r.labelEnc, 'priors.label')!,
    category: r.category,
    origin: r.origin,
    safeToTest: r.safeToTest,
    retiredAt: iso(r.retiredAt),
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    clientUpdatedAt: r.clientUpdatedAt.toISOString(),
    deletedAt: iso(r.deletedAt),
  };
}

// ---------------------------------------------------------------------------
// journal
// ---------------------------------------------------------------------------

export function journalToRow(j: JournalEntry, userId: string, keyVersion: number): JournalInsert {
  return {
    id: j.id,
    userId,
    predictionId: orNull(j.predictionId),
    bodyEnc: enc(j.body, 'journal_entries.body')!,
    sharedAt: d(j.sharedAt),
    keyVersion,
    createdAt: new Date(j.createdAt),
    clientUpdatedAt: new Date(j.clientUpdatedAt),
    deletedAt: d(j.deletedAt),
  };
}

export function rowToJournal(r: JournalRow): JournalEntry {
  return {
    id: r.id,
    predictionId: r.predictionId,
    body: dec(r.bodyEnc, 'journal_entries.body')!,
    sharedAt: iso(r.sharedAt),
    createdAt: r.createdAt.toISOString(),
    clientUpdatedAt: r.clientUpdatedAt.toISOString(),
    deletedAt: iso(r.deletedAt),
  };
}

// ---------------------------------------------------------------------------
// crisis events — no encryption needed: there is no text
// ---------------------------------------------------------------------------

export function crisisToRow(c: CrisisEvent, userId: string): CrisisInsert {
  return {
    id: c.id,
    userId,
    source: c.source,
    sourceEntryId: c.sourceEntryId,
    ruleIds: c.ruleIds,
    resourcesShown: c.resourcesShown,
    detectedOnDevice: c.detectedOnDevice,
    acknowledgedAt: d(c.acknowledgedAt),
    createdAt: new Date(c.createdAt),
  };
}

export function rowToCrisis(r: CrisisRow): CrisisEvent {
  return {
    id: r.id,
    source: r.source,
    sourceEntryId: r.sourceEntryId,
    ruleIds: r.ruleIds,
    resourcesShown: r.resourcesShown,
    detectedOnDevice: r.detectedOnDevice,
    acknowledgedAt: iso(r.acknowledgedAt),
    createdAt: r.createdAt.toISOString(),
  };
}

export { nn };
