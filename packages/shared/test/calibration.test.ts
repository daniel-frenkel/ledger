import { describe, expect, it } from 'vitest';
import {
  furnaceProfile,
  isLoudMiss,
  outcomeValue,
  sentenceFor,
  shouldRouteToClinician,
  summarize,
  summarizeLedger,
} from '../src/index.js';
import { abandoned, bodyAfter, open, prior, reinterp, resolved } from './fixtures.js';

describe('summarize', () => {
  it('produces the milestone sentence: 14 predicted at avg 80%, happened 2', () => {
    const ps = [
      ...Array.from({ length: 12 }, () => resolved('miss', { confidence: 80 })),
      resolved('hit', { confidence: 80 }),
      resolved('hit', { confidence: 80 }),
    ];
    const s = summarize(ps, 'rejection');
    expect(s.scored).toBe(14);
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(12);
    expect(s.meanConfidence).toBe(80);
    expect(s.hitRate).toBeCloseTo(2 / 14, 3);
    expect(s.sentence).toBe(
      'You predicted rejection 14 times at an average of 80% confidence. It happened 2 times.',
    );
  });

  it('counts open, abandoned, and unclear separately and never scores unclear', () => {
    const s = summarize([open(), open(), abandoned(), resolved('unclear'), resolved('hit')]);
    expect(s.total).toBe(5);
    expect(s.open).toBe(2);
    expect(s.abandoned).toBe(1);
    expect(s.resolved).toBe(2);
    expect(s.unclear).toBe(1);
    expect(s.scored).toBe(1);
    expect(s.hitRate).toBe(1);
  });

  it('ignores soft-deleted rows', () => {
    const s = summarize([resolved('hit', { deletedAt: '2026-09-03T00:00:00.000Z' }), resolved('miss')]);
    expect(s.total).toBe(1);
    expect(s.misses).toBe(1);
  });

  it('returns nulls, not NaN, with nothing scored', () => {
    const s = summarize([open()]);
    expect(s.meanConfidence).toBeNull();
    expect(s.hitRate).toBeNull();
    expect(s.brier).toBeNull();
    expect(s.inferredShare).toBeNull();
    expect(s.sentence).toMatch(/Nothing has been checked yet/);
  });

  it('Brier score: perfect confidence on hits is 0; 100% on a miss is 1', () => {
    expect(summarize([resolved('hit', { confidence: 100 })]).brier).toBe(0);
    expect(summarize([resolved('miss', { confidence: 100 })]).brier).toBe(1);
    expect(summarize([resolved('partial', { confidence: 50 })]).brier).toBe(0);
  });

  it('buckets predictions by confidence and reports observed rate', () => {
    const s = summarize([
      resolved('hit', { confidence: 90 }),
      resolved('miss', { confidence: 85 }),
      resolved('partial', { confidence: 10 }),
    ]);
    const top = s.buckets.at(-1)!;
    expect(top.lo).toBe(80);
    expect(top.n).toBe(2);
    expect(top.observedRate).toBe(0.5);
    const bottom = s.buckets[0]!;
    expect(bottom.n).toBe(1);
    expect(bottom.observedRate).toBe(0.5);
    expect(s.buckets.reduce((a, b) => a + b.n, 0)).toBe(3);
  });

  it('sentence mentions partials and never-run predictions', () => {
    const s = summarize([resolved('hit'), resolved('partial'), abandoned()], 'it');
    expect(s.sentence).toContain('partly happened 1');
    expect(s.sentence).toContain('1 was never run.');
  });

  it('sentenceFor handles the no-hits case', () => {
    const s = summarize([resolved('miss'), resolved('miss')], 'the blowup');
    expect(s.sentence).toContain("It didn't happen.");
  });
});

describe('outcomeValue', () => {
  it.each([
    ['hit', 1],
    ['partial', 0.5],
    ['miss', 0],
  ] as const)('%s → %d', (v, n) => {
    expect(outcomeValue(resolved(v))).toBe(n);
  });
  it('is undefined for unclear and open', () => {
    expect(outcomeValue(resolved('unclear'))).toBeUndefined();
    expect(outcomeValue(open())).toBeUndefined();
  });
});

describe('isLoudMiss — the loud-mismatch rule', () => {
  it('is loud for a high-confidence observed miss the client was present for', () => {
    expect(isLoudMiss(resolved('miss', { confidence: 85 }))).toBe(true);
  });
  it('is quiet below the confidence threshold', () => {
    expect(isLoudMiss(resolved('miss', { confidence: 60 }))).toBe(false);
  });
  it('is quiet when the outcome was inferred (mind-read)', () => {
    expect(isLoudMiss(resolved('miss', { confidence: 90, outcomeSource: 'inferred' }))).toBe(false);
  });
  it('is quiet when the client was not present for it', () => {
    expect(isLoudMiss(resolved('miss', { confidence: 90, presentForIt: false }))).toBe(false);
  });
  it('is quiet when kit took the credit on a body experiment', () => {
    const p = resolved('miss', { confidence: 90 });
    expect(isLoudMiss(p, bodyAfter(p.id, { kitUsed: ['water'] }).after)).toBe(false);
    expect(isLoudMiss(p, bodyAfter(p.id, { creditedTo: 'technique' }).after)).toBe(false);
    expect(isLoudMiss(p, bodyAfter(p.id).after)).toBe(true);
  });
  it('is never loud for hits or partials', () => {
    expect(isLoudMiss(resolved('hit', { confidence: 95 }))).toBe(false);
    expect(isLoudMiss(resolved('partial', { confidence: 95 }))).toBe(false);
  });
});

describe('shouldRouteToClinician', () => {
  it('routes unclear and not-present outcomes; leaves the rest to the chart', () => {
    expect(shouldRouteToClinician(resolved('unclear'))).toBe(true);
    expect(shouldRouteToClinician(resolved('miss', { presentForIt: false }))).toBe(true);
    expect(shouldRouteToClinician(resolved('miss'))).toBe(false);
    expect(shouldRouteToClinician(open())).toBe(false);
  });
});

describe('furnaceProfile', () => {
  it('flags a prior that never misses at high confidence, once there are 5 scored', () => {
    const ps = Array.from({ length: 5 }, () => resolved('hit', { confidence: 85 }));
    expect(furnaceProfile(ps, [], []).neverMisses).toBe(true);
    expect(furnaceProfile(ps.slice(0, 4), [], []).neverMisses).toBe(false);
    expect(furnaceProfile([...ps, resolved('miss')], [], []).neverMisses).toBe(false);
    expect(furnaceProfile(ps.map((p) => ({ ...p, confidence: 50 })), [], []).neverMisses).toBe(false);
  });

  it('computes abandonment and reinterpretation rates', () => {
    const a = resolved('miss');
    const b = resolved('miss');
    const f = furnaceProfile([a, b, abandoned(), abandoned()], [reinterp(a.id)], []);
    expect(f.abandonmentRate).toBe(0.5);
    expect(f.reinterpretationRate).toBe(0.5);
  });

  it('counts own-part answers including unanswered', () => {
    const f = furnaceProfile(
      [resolved('miss', { ownPart: 'none' }), resolved('miss', { ownPart: 'made_it_likelier' }), resolved('miss')],
      [],
      [],
    );
    expect(f.ownPart).toEqual({ none: 1, made_it_likelier: 1, held_back: 0, unsure: 0, unanswered: 1 });
  });

  it('separates survivals without kit from survivals with kit', () => {
    const a = resolved('miss');
    const b = resolved('miss');
    const c = resolved('miss');
    const f = furnaceProfile(
      [a, b, c],
      [],
      [
        bodyAfter(a.id),
        bodyAfter(b.id, { kitUsed: ['breathing_technique'] }),
        bodyAfter(c.id, { creditedTo: 'person' }),
      ],
    );
    expect(f.survivalsWithoutKit).toBe(1);
    expect(f.survivalsWithKit).toBe(2);
  });

  it('returns nulls with no data', () => {
    const f = furnaceProfile([], [], []);
    expect(f.abandonmentRate).toBeNull();
    expect(f.reinterpretationRate).toBeNull();
    expect(f.neverMisses).toBe(false);
  });
});

describe('summarizeLedger', () => {
  it('groups by prior, sorts by volume, and reports untagged', () => {
    const p1 = prior({ label: 'If I show weakness, they withdraw.' });
    const p2 = prior({ label: 'They’ll see it and judge.', category: 'rank' });
    const preds = [
      resolved('miss', { priorIds: [p1.id] }),
      resolved('hit', { priorIds: [p1.id] }),
      resolved('miss', { priorIds: [p2.id] }),
      open(),
    ];
    const L = summarizeLedger({ predictions: preds, priors: [p1, p2] });
    expect(L.overall.total).toBe(4);
    expect(L.byPrior[0]!.prior.id).toBe(p1.id);
    expect(L.byPrior[0]!.calibration.scored).toBe(2);
    expect(L.byPrior[1]!.calibration.scored).toBe(1);
    expect(L.untagged.total).toBe(1);
    expect(L.byPrior[0]!.calibration.sentence).toContain('“If I show weakness, they withdraw.”');
  });
});
