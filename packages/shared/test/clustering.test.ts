import { describe, expect, it } from 'vitest';
import { jaccard, mergePriors, suggestGroups, suggestPriors, tokenize } from '../src/index.js';
import { id, open, prior } from './fixtures.js';

describe('tokenize', () => {
  it('lowercases, drops stopwords and punctuation, stems lightly', () => {
    expect([...tokenize('She will REJECT me, and I’ll fear rejection; feared, rejected.')].sort()).toEqual(['fear', 'reject']);
  });
});

describe('jaccard', () => {
  it('is 0 for disjoint, 1 for identical, 0 for two empties', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(1);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe('suggestPriors', () => {
  const p1 = prior({ label: 'If I show weakness, they withdraw.' });
  const p2 = prior({ label: 'They’ll see it and judge.', category: 'rank' });
  const retired = prior({ label: 'weakness withdraw', retiredAt: '2026-09-01T00:00:00.000Z' });

  it('ranks by token overlap and explains the shared tokens', () => {
    const s = suggestPriors(
      { situation: 'Admitting I need help', expectedOutcome: 'They see the weakness and withdraw' },
      [p1, p2, retired],
    );
    expect(s[0]!.priorId).toBe(p1.id);
    expect(s[0]!.shared).toEqual(['weakness', 'withdraw']);
    expect(s.map((x) => x.priorId)).not.toContain(retired.id);
  });

  it('returns nothing below the threshold', () => {
    expect(suggestPriors({ situation: 'Dentist', expectedOutcome: 'It will hurt' }, [p1, p2])).toEqual([]);
  });

  it('never assigns — it only returns suggestions', () => {
    const s = suggestPriors({ situation: 'x', expectedOutcome: 'weakness' }, [p1]);
    expect(s[0]).not.toHaveProperty('assigned');
  });
});

describe('suggestGroups', () => {
  it('groups untagged predictions with similar expected outcomes', () => {
    const a = open({ id: id(101), expectedOutcome: 'He goes quiet and pulls away' });
    const b = open({ id: id(102), expectedOutcome: 'She goes quiet and pulls away for days' });
    const c = open({ id: id(103), expectedOutcome: 'My heart will race and I will pass out' });
    const tagged = open({ id: id(104), expectedOutcome: 'He goes quiet and pulls away', priorIds: [id(999)] });
    const g = suggestGroups([c, b, a, tagged]);
    expect(g).toHaveLength(1);
    expect(g[0]!.predictionIds).toEqual([a.id, b.id]);
    expect(g[0]!.commonTokens).toEqual(['away', 'goes', 'pull', 'quiet']);
  });

  it('is deterministic regardless of input order', () => {
    const items = [
      open({ id: id(201), expectedOutcome: 'they laugh at me' }),
      open({ id: id(202), expectedOutcome: 'they all laugh at me' }),
      open({ id: id(203), expectedOutcome: 'everyone laughs at me' }),
    ];
    const g1 = suggestGroups(items);
    const g2 = suggestGroups([...items].reverse());
    expect(g1).toEqual(g2);
  });

  it('returns nothing when nothing is similar', () => {
    expect(
      suggestGroups([open({ expectedOutcome: 'rain' }), open({ expectedOutcome: 'sun' })]),
    ).toEqual([]);
  });
});

describe('mergePriors', () => {
  it('retires the merged prior and retags predictions without duplicates', () => {
    const keep = prior();
    const merge = prior({ label: 'weakness → withdraw' });
    const p = open({ priorIds: [merge.id, keep.id] });
    const q = open({ priorIds: [merge.id] });
    const now = '2026-09-05T00:00:00.000Z';
    const r = mergePriors([keep, merge], [p, q], keep.id, merge.id, now);
    expect(r.priors.find((x) => x.id === merge.id)!.retiredAt).toBe(now);
    expect(r.priors.find((x) => x.id === keep.id)!.retiredAt).toBeUndefined();
    expect(r.predictions[0]!.priorIds).toEqual([keep.id]);
    expect(r.predictions[1]!.priorIds).toEqual([keep.id]);
    expect(r.predictions[1]!.clientUpdatedAt).toBe(now);
  });
  it('throws on unknown ids and is a no-op on identical ids', () => {
    const keep = prior();
    expect(() => mergePriors([keep], [], keep.id, id(5), 'x')).toThrow();
    expect(mergePriors([keep], [], keep.id, keep.id, 'x').priors).toEqual([keep]);
  });
});
