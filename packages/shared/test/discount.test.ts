/**
 * "How much does this one count?" — the arithmetic.
 *
 * Proposal 06. The reinterpret move already exists in the ledger as text; this
 * is the amount of the discount as a number, and it is a number shown to a
 * client about themselves, so every case that could inflate it is pinned here.
 */
import { describe, expect, it } from 'vitest';
import {
  DISMISSED_AT_OR_BELOW,
  MIN_ANSWERS_FOR_SENTENCE,
  discountRate,
  discountSentence,
  isLoudMiss,
  predictionSchema,
  shouldRouteToClinician,
  summarizeLedger,
} from '../src/index.js';
import type { Prediction } from '../src/index.js';

const T = '2026-09-01T18:00:00.000Z';

const pred = (over: Partial<Prediction> = {}): Prediction =>
  ({
    id: `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`,
    situation: 'a situation',
    expectedOutcome: 'an expectation',
    confidence: 80,
    priorIds: [],
    resolvedAt: T,
    actualOutcome: 'what happened',
    outcomeVerdict: 'miss',
    outcomeSource: 'observed',
    surpriseRating: 5,
    presentForIt: true,
    createdAt: T,
    clientUpdatedAt: T,
    ...over,
  }) as Prediction;

describe('discountRate', () => {
  it('averages the discount, not the answer', () => {
    // 100 − 20 = 80 and 100 − 40 = 60 → 70.
    const d = discountRate([pred({ countsFor: 20 }), pred({ countsFor: 40 })]);
    expect(d.rate).toBe(70);
    expect(d.answered).toBe(2);
  });

  it('leaves an unanswered question out of the mean rather than calling it a hundred', () => {
    const d = discountRate([pred({ countsFor: 20 }), pred({ countsFor: null })]);
    expect(d.rate).toBe(80); // the one answer, not (80 + 0) / 2
    expect(d.answered).toBe(1);
    expect(d.askable).toBe(2);
  });

  it('is null with nothing answered, rather than zero', () => {
    // Zero would read as "discounted nothing", which is a claim. Null is not.
    const d = discountRate([pred({ countsFor: null })]);
    expect(d.rate).toBeNull();
    expect(d.answered).toBe(0);
    expect(d.askable).toBe(1);
  });

  it('counts misses and partials as askable, and nothing else', () => {
    const d = discountRate([
      pred({ outcomeVerdict: 'miss', countsFor: 0 }),
      pred({ outcomeVerdict: 'partial', countsFor: 50 }),
      pred({ outcomeVerdict: 'hit', countsFor: 100 }),
      pred({ outcomeVerdict: 'unclear' }),
      pred({ resolvedAt: null, outcomeVerdict: null }),
    ]);
    expect(d.askable).toBe(2);
    expect(d.answered).toBe(2);
    expect(d.rate).toBe(75); // (100 + 50) / 2
  });

  it('counts a miss at or below the threshold as dismissed, and a partial never', () => {
    const d = discountRate([
      pred({ outcomeVerdict: 'miss', countsFor: DISMISSED_AT_OR_BELOW }),
      pred({ outcomeVerdict: 'miss', countsFor: DISMISSED_AT_OR_BELOW + 10 }),
      pred({ outcomeVerdict: 'partial', countsFor: 0 }),
    ]);
    expect(d.dismissed).toBe(1);
  });

  it('ignores deleted rows', () => {
    const d = discountRate([pred({ countsFor: 0 }), pred({ countsFor: 0, deletedAt: T })]);
    expect(d.answered).toBe(1);
  });

  it('handles an empty ledger', () => {
    expect(discountRate([])).toEqual({ rate: null, dismissed: 0, answered: 0, askable: 0 });
  });
});

describe('the ledger sentence', () => {
  it('says nothing until there are enough answers to be a pattern', () => {
    const thin = discountRate([pred({ countsFor: 0 }), pred({ countsFor: 0 })]);
    expect(thin.answered).toBeLessThan(MIN_ANSWERS_FOR_SENTENCE);
    expect(discountSentence(thin)).toBeNull();
  });

  it('says nothing when nothing was dismissed', () => {
    const d = discountRate([pred({ countsFor: 100 }), pred({ countsFor: 90 }), pred({ countsFor: 100 })]);
    expect(d.answered).toBe(3);
    expect(discountSentence(d)).toBeNull();
  });

  it('reports the count and stops there', () => {
    const d = discountRate([pred({ countsFor: 0 }), pred({ countsFor: 10 }), pred({ countsFor: 100 })]);
    const s = discountSentence(d)!;
    expect(s).toBe('Of your 3 misses, you said 2 didn’t fully count.');
    // A record, not a verdict: no adjective, no advice, no theory word.
    expect(s).not.toMatch(/should|avoid|immuniz|reinterpret|furnace|prior/i);
  });
});

describe('routing a discounted loud miss', () => {
  const loud = () => pred({ confidence: 90, outcomeVerdict: 'miss', outcomeSource: 'observed', presentForIt: true });

  it('routes a loud miss the client wrote off', () => {
    const p = loud();
    expect(isLoudMiss(p)).toBe(true);
    expect(shouldRouteToClinician({ ...p, countsFor: DISMISSED_AT_OR_BELOW })).toBe(true);
  });

  it('does not route a loud miss the client let count', () => {
    expect(shouldRouteToClinician({ ...loud(), countsFor: 100 })).toBe(false);
  });

  it('does not route when the question went unanswered', () => {
    // Silence is not a discount. It is silence.
    expect(shouldRouteToClinician({ ...loud(), countsFor: null })).toBe(false);
  });

  it('does not route a quiet miss however hard it was discounted', () => {
    const quiet = pred({ confidence: 20, outcomeVerdict: 'miss', countsFor: 0 });
    expect(isLoudMiss(quiet)).toBe(false);
    expect(shouldRouteToClinician(quiet)).toBe(false);
  });

  it('still routes everything it routed before', () => {
    expect(shouldRouteToClinician(pred({ outcomeVerdict: 'unclear' }))).toBe(true);
    expect(shouldRouteToClinician(pred({ presentForIt: false }))).toBe(true);
    expect(shouldRouteToClinician(pred({ resolvedAt: null, outcomeVerdict: null }))).toBe(false);
  });
});

describe('summarizeLedger', () => {
  it('carries the discount alongside the calibration', () => {
    const out = summarizeLedger({
      predictions: [pred({ countsFor: 0 }), pred({ countsFor: 50 })],
      priors: [],
    });
    expect(out.discount.answered).toBe(2);
    expect(out.discount.rate).toBe(75);
  });
});

describe('the schema refuses an answer nobody was asked for', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    situation: 'a situation',
    expectedOutcome: 'an expectation',
    confidence: 80,
    priorIds: [],
    resolvedAt: T,
    actualOutcome: 'what happened',
    outcomeSource: 'observed',
    surpriseRating: 5,
    presentForIt: true,
    createdAt: T,
    clientUpdatedAt: T,
  };

  it('accepts a discount on a miss and on a partial', () => {
    expect(predictionSchema.safeParse({ ...base, outcomeVerdict: 'miss', countsFor: 20 }).success).toBe(true);
    expect(predictionSchema.safeParse({ ...base, outcomeVerdict: 'partial', countsFor: 20 }).success).toBe(true);
  });

  it('refuses one on a hit — sync validates with this schema, not the resolve input', () => {
    const out = predictionSchema.safeParse({ ...base, outcomeVerdict: 'hit', countsFor: 100 });
    expect(out.success).toBe(false);
    expect(out.success ? '' : out.error.issues[0]!.path.join('.')).toBe('countsFor');
  });

  it('refuses one on an unclear verdict, and on a prediction that is still open', () => {
    expect(predictionSchema.safeParse({ ...base, outcomeVerdict: 'unclear', countsFor: 0 }).success).toBe(false);
    expect(
      predictionSchema.safeParse({ ...base, resolvedAt: null, outcomeVerdict: null, countsFor: 0 }).success,
    ).toBe(false);
  });

  it('accepts a miss with no answer, because skipping is allowed', () => {
    expect(predictionSchema.safeParse({ ...base, outcomeVerdict: 'miss' }).success).toBe(true);
    expect(predictionSchema.safeParse({ ...base, outcomeVerdict: 'miss', countsFor: null }).success).toBe(true);
  });

  it('holds the range as well as the verdict rule', () => {
    expect(predictionSchema.safeParse({ ...base, outcomeVerdict: 'miss', countsFor: 140 }).success).toBe(false);
    expect(predictionSchema.safeParse({ ...base, outcomeVerdict: 'miss', countsFor: -1 }).success).toBe(false);
  });
});

describe('the proposal’s own fixture', () => {
  it('three misses at 100/50/0 give a rate of 50 and one dismissed', () => {
    const d = discountRate([pred({ countsFor: 100 }), pred({ countsFor: 50 }), pred({ countsFor: 0 })]);
    expect(d.rate).toBe(50);
    expect(d.dismissed).toBe(1);
    expect(d.answered).toBe(3);
  });

  it('null answers are excluded from the mean and from the count', () => {
    const d = discountRate([
      pred({ countsFor: 100 }),
      pred({ countsFor: 50 }),
      pred({ countsFor: 0 }),
      pred({ countsFor: null }),
      pred({ countsFor: null }),
    ]);
    expect(d.rate).toBe(50);
    expect(d.answered).toBe(3);
    expect(d.askable).toBe(5);
  });
});

describe('isLoudMiss is unchanged', () => {
  /**
   * Proposal 06 adds a routing case that *reads* isLoudMiss; it does not touch
   * it. These are the rule's four conditions, pinned so a change to the
   * discount work cannot quietly widen what counts as loud.
   */
  const loud = () =>
    pred({ confidence: 90, outcomeVerdict: 'miss', outcomeSource: 'observed', presentForIt: true });

  it('is true for a high-confidence, observed, present miss', () => {
    expect(isLoudMiss(loud())).toBe(true);
  });

  it('ignores counts_for entirely', () => {
    for (const countsFor of [0, 50, 100, null]) {
      expect(isLoudMiss({ ...loud(), countsFor }), String(countsFor)).toBe(true);
    }
  });

  it('is false below the confidence threshold, on an inferred outcome, and on a blur', () => {
    expect(isLoudMiss({ ...loud(), confidence: 20 })).toBe(false);
    expect(isLoudMiss({ ...loud(), outcomeSource: 'inferred' })).toBe(false);
    expect(isLoudMiss({ ...loud(), presentForIt: false })).toBe(false);
  });

  it('is false when the kit was present or the credit went elsewhere', () => {
    expect(isLoudMiss(loud(), { peakIntensity: 3, ranPastPeak: true, verdictArrived: 'yes', kitUsed: ['breathing_technique'], creditedTo: 'body' })).toBe(false);
    expect(isLoudMiss(loud(), { peakIntensity: 3, ranPastPeak: true, verdictArrived: 'yes', kitUsed: [], creditedTo: 'technique' })).toBe(false);
  });

  it('is false for anything that is not a scored miss', () => {
    expect(isLoudMiss({ ...loud(), outcomeVerdict: 'hit' })).toBe(false);
    expect(isLoudMiss({ ...loud(), outcomeVerdict: 'unclear' })).toBe(false);
    expect(isLoudMiss({ ...loud(), resolvedAt: null, outcomeVerdict: null })).toBe(false);
  });
});
