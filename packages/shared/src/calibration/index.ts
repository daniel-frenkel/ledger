/**
 * Calibration — every number the app shows about predictions.
 *
 * Pure functions over plaintext domain objects. No I/O, no LLM. The client
 * runs these over its local SQLite mirror (so the summary works offline); the
 * API runs the same code for the clinician view. If the two ever disagree,
 * that is a bug in sync, not in arithmetic.
 *
 * Design rules carried in from the source material (docs/theory-mapping.md):
 *   - Only `outcome_verdict` is scored. Free text is never interpreted here.
 *   - `unclear` is not scored; it is counted and routed.
 *   - A miss is "loud" only when confidence was high, the outcome was
 *     observed (not inferred), the client was present for it, and — for a
 *     body-channel experiment — no kit took the credit.
 *   - There are no streaks. Nothing here rewards frequency of use.
 */

import { HIGH_CONFIDENCE_THRESHOLD } from '../vocabulary/index.js';
import type { BodyState, Prediction, Prior, Reinterpretation } from '../schemas/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfidenceBucket {
  /** Inclusive lower bound, exclusive upper bound (last bucket inclusive). */
  lo: number;
  hi: number;
  n: number;
  hits: number;
  partials: number;
  misses: number;
  /** Mean stated confidence in this bucket, 0–100. */
  meanConfidence: number;
  /** Observed rate the predicted outcome happened (hit = 1, partial = 0.5). */
  observedRate: number;
}

export interface CalibrationSummary {
  total: number;
  open: number;
  resolved: number;
  abandoned: number;
  hits: number;
  partials: number;
  misses: number;
  unclear: number;
  /** hits + partials + misses — the denominator for rates. */
  scored: number;
  /** Mean confidence across scored predictions, 0–100. null if none. */
  meanConfidence: number | null;
  /** Mean confidence on misses alone. null if none. */
  meanConfidenceOnMisses: number | null;
  /** hits / scored. null if none. */
  hitRate: number | null;
  /** Brier score in [0, 1]; lower is better calibrated. null if none. */
  brier: number | null;
  /** Misses that satisfy the loud-mismatch rule. */
  loudMisses: number;
  /** Share of scored outcomes the client marked as inferred (mind-read). */
  inferredShare: number | null;
  buckets: ConfidenceBucket[];
  /** One plain sentence for the client. */
  sentence: string;
}

export interface FurnaceProfile {
  /**
   * Scored ≥ 5, zero misses, mean confidence ≥ threshold. Either a calibrated
   * read of a hostile room or a furnace running the test; the arithmetic
   * cannot tell which, so this is a flag for the clinician, never a score.
   */
  neverMisses: boolean;
  /** abandoned / (abandoned + resolved). null if neither. */
  abandonmentRate: number | null;
  /** predictions with ≥1 reinterpretation / resolved. null if none resolved. */
  reinterpretationRate: number | null;
  /** inferred outcomes / scored. null if none. */
  inferredRate: number | null;
  /** Counts of the client's own-part answers, for the drift view. */
  ownPart: { none: number; made_it_likelier: number; held_back: number; unsure: number; unanswered: number };
  /**
   * Body-channel experiments where the forecast did not arrive, no kit was
   * used, and the credit went to the body. The only column that converts
   * "rescued" into "false alarm".
   */
  survivalsWithoutKit: number;
  /** Body-channel experiments where kit was used or credit went elsewhere. */
  survivalsWithKit: number;
}

export interface PriorSummary {
  prior: Prior;
  calibration: CalibrationSummary;
  furnace: FurnaceProfile;
}

export interface LedgerSummary {
  overall: CalibrationSummary;
  byPrior: PriorSummary[];
  /** Predictions with no prior tagged. */
  untagged: CalibrationSummary;
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

export const isOpen = (p: Prediction): boolean => !p.resolvedAt && !p.abandonedAt && !p.deletedAt;
export const isResolved = (p: Prediction): boolean => !!p.resolvedAt && !p.deletedAt;
export const isAbandoned = (p: Prediction): boolean => !!p.abandonedAt && !p.deletedAt;
export const isScored = (p: Prediction): boolean =>
  isResolved(p) && p.outcomeVerdict !== 'unclear' && p.outcomeVerdict != null;

/** hit = 1, partial = 0.5, miss = 0. Undefined when not scored. */
export function outcomeValue(p: Prediction): number | undefined {
  if (!isScored(p)) return undefined;
  switch (p.outcomeVerdict) {
    case 'hit':
      return 1;
    case 'partial':
      return 0.5;
    case 'miss':
      return 0;
    default:
      return undefined;
  }
}

/**
 * The loud-mismatch rule. "Make the mismatch loud only when confidence was
 * high and the outcome missed the stated verdict … Do not make it loud when
 * the kit was present or the client could not say what happened; route those
 * to the clinician." (theory-mapping.md §4)
 */
export function isLoudMiss(p: Prediction, bodyAfter?: BodyState['after']): boolean {
  if (!isScored(p) || p.outcomeVerdict !== 'miss') return false;
  if (p.confidence < HIGH_CONFIDENCE_THRESHOLD) return false;
  if (p.outcomeSource === 'inferred') return false;
  if (p.presentForIt === false) return false;
  if (bodyAfter) {
    if (bodyAfter.kitUsed.length > 0) return false;
    if (bodyAfter.creditedTo !== 'body') return false;
  }
  return true;
}

/** Resolved but not scorable, or a miss the client wasn't present for: clinician's, not the chart's. */
export function shouldRouteToClinician(p: Prediction): boolean {
  if (!isResolved(p)) return false;
  if (p.outcomeVerdict === 'unclear') return true;
  if (p.presentForIt === false) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

const BUCKET_EDGES = [0, 20, 40, 60, 80, 101] as const;

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round(x: number | null, places = 3): number | null {
  if (x == null) return null;
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

function buildBuckets(scored: Prediction[]): ConfidenceBucket[] {
  const out: ConfidenceBucket[] = [];
  for (let i = 0; i < BUCKET_EDGES.length - 1; i++) {
    const lo = BUCKET_EDGES[i]!;
    const hi = BUCKET_EDGES[i + 1]!;
    const inBucket = scored.filter((p) => p.confidence >= lo && p.confidence < hi);
    const values = inBucket.map((p) => outcomeValue(p)!);
    out.push({
      lo,
      hi: Math.min(hi, 100),
      n: inBucket.length,
      hits: inBucket.filter((p) => p.outcomeVerdict === 'hit').length,
      partials: inBucket.filter((p) => p.outcomeVerdict === 'partial').length,
      misses: inBucket.filter((p) => p.outcomeVerdict === 'miss').length,
      meanConfidence: round(mean(inBucket.map((p) => p.confidence))) ?? 0,
      observedRate: round(mean(values)) ?? 0,
    });
  }
  return out;
}

function pct(x: number): string {
  return `${Math.round(x)}%`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * The sentence the client sees. Numbers only, in their own record, "never the
 * therapist's testimony" (Protocol — Social Anxiety Phase 7).
 */
export function sentenceFor(s: Omit<CalibrationSummary, 'sentence'>, subject = 'this'): string {
  if (s.scored === 0) {
    if (s.open > 0 && s.resolved === 0) {
      return `You've written ${s.open} ${plural(s.open, 'prediction', 'predictions')} about ${subject}. Nothing has been checked yet.`;
    }
    return `No checked predictions about ${subject} yet.`;
  }
  const happened = s.hits;
  const partly = s.partials;
  const parts: string[] = [];
  parts.push(
    `You predicted ${subject} ${s.scored} ${plural(s.scored, 'time', 'times')} at an average of ${pct(s.meanConfidence ?? 0)} confidence.`,
  );
  if (happened === 0 && partly === 0) parts.push(`It didn't happen.`);
  else if (partly === 0) parts.push(`It happened ${happened} ${plural(happened, 'time', 'times')}.`);
  else parts.push(`It happened ${happened} ${plural(happened, 'time', 'times')} and partly happened ${partly}.`);
  if (s.abandoned > 0) parts.push(`${s.abandoned} ${plural(s.abandoned, 'was', 'were')} never run.`);
  return parts.join(' ');
}

export function summarize(predictions: Prediction[], subject = 'this'): CalibrationSummary {
  const live = predictions.filter((p) => !p.deletedAt);
  const open = live.filter(isOpen);
  const resolved = live.filter(isResolved);
  const abandoned = live.filter(isAbandoned);
  const scored = resolved.filter(isScored);
  const hits = scored.filter((p) => p.outcomeVerdict === 'hit');
  const partials = scored.filter((p) => p.outcomeVerdict === 'partial');
  const misses = scored.filter((p) => p.outcomeVerdict === 'miss');
  const unclear = resolved.filter((p) => p.outcomeVerdict === 'unclear');

  const meanConfidence = round(mean(scored.map((p) => p.confidence)));
  const meanConfidenceOnMisses = round(mean(misses.map((p) => p.confidence)));
  const hitRate = scored.length ? round(hits.length / scored.length) : null;
  const brier = scored.length
    ? round(mean(scored.map((p) => (p.confidence / 100 - outcomeValue(p)!) ** 2)))
    : null;
  const inferred = scored.filter((p) => p.outcomeSource === 'inferred').length;
  const inferredShare = scored.length ? round(inferred / scored.length) : null;

  const base = {
    total: live.length,
    open: open.length,
    resolved: resolved.length,
    abandoned: abandoned.length,
    hits: hits.length,
    partials: partials.length,
    misses: misses.length,
    unclear: unclear.length,
    scored: scored.length,
    meanConfidence,
    meanConfidenceOnMisses,
    hitRate,
    brier,
    loudMisses: misses.filter((p) => isLoudMiss(p)).length,
    inferredShare,
    buckets: buildBuckets(scored),
  };
  return { ...base, sentence: sentenceFor(base, subject) };
}

export function furnaceProfile(
  predictions: Prediction[],
  reinterpretations: Reinterpretation[],
  bodyStates: BodyState[],
): FurnaceProfile {
  const live = predictions.filter((p) => !p.deletedAt);
  const resolved = live.filter(isResolved);
  const abandoned = live.filter(isAbandoned);
  const scored = resolved.filter(isScored);
  const misses = scored.filter((p) => p.outcomeVerdict === 'miss').length;
  const meanConf = mean(scored.map((p) => p.confidence));

  const withReinterp = new Set(reinterpretations.filter((r) => !r.deletedAt).map((r) => r.predictionId));
  const resolvedWithReinterp = resolved.filter((p) => withReinterp.has(p.id)).length;

  const ownPart = { none: 0, made_it_likelier: 0, held_back: 0, unsure: 0, unanswered: 0 };
  for (const p of resolved) {
    if (p.ownPart) ownPart[p.ownPart] += 1;
    else ownPart.unanswered += 1;
  }

  const ids = new Set(live.map((p) => p.id));
  let survivalsWithoutKit = 0;
  let survivalsWithKit = 0;
  for (const b of bodyStates) {
    if (b.deletedAt || b.phase !== 'after' || !b.after || !ids.has(b.predictionId)) continue;
    if (b.after.verdictArrived !== 'no') continue;
    if (b.after.kitUsed.length === 0 && b.after.creditedTo === 'body') survivalsWithoutKit += 1;
    else survivalsWithKit += 1;
  }

  const denom = abandoned.length + resolved.length;
  return {
    neverMisses: scored.length >= 5 && misses === 0 && (meanConf ?? 0) >= HIGH_CONFIDENCE_THRESHOLD,
    abandonmentRate: denom ? round(abandoned.length / denom) : null,
    reinterpretationRate: resolved.length ? round(resolvedWithReinterp / resolved.length) : null,
    inferredRate: scored.length
      ? round(scored.filter((p) => p.outcomeSource === 'inferred').length / scored.length)
      : null,
    ownPart,
    survivalsWithoutKit,
    survivalsWithKit,
  };
}

export interface LedgerInput {
  predictions: Prediction[];
  priors: Prior[];
  reinterpretations?: Reinterpretation[];
  bodyStates?: BodyState[];
}

/** Everything the calibration screen and the clinician view need, in one pass. */
export function summarizeLedger(input: LedgerInput): LedgerSummary {
  const reinterpretations = input.reinterpretations ?? [];
  const bodyStates = input.bodyStates ?? [];
  const live = input.predictions.filter((p) => !p.deletedAt);

  const byPrior: PriorSummary[] = input.priors
    .filter((pr) => !pr.deletedAt)
    .map((prior) => {
      const ps = live.filter((p) => p.priorIds.includes(prior.id));
      return {
        prior,
        calibration: summarize(ps, `“${prior.label}”`),
        furnace: furnaceProfile(ps, reinterpretations, bodyStates),
      };
    })
    .sort((a, b) => b.calibration.total - a.calibration.total);

  return {
    overall: summarize(live, 'what you feared'),
    byPrior,
    untagged: summarize(
      live.filter((p) => p.priorIds.length === 0),
      'untagged situations',
    ),
  };
}
