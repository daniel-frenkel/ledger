/**
 * The training stack, against the document it came from.
 *
 * docs/theory/tools/training-stack.md is re-read on every run, so a modality
 * renamed or a floor reassigned there fails here rather than drifting quietly
 * into a scope verdict that no longer matches the author's own table.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CAPPED_TIERS,
  MODALITIES,
  MODALITY_SLUGS,
  TIERS,
  TIER_IDS,
  coverage,
  isModalitySlug,
  modality,
  scopeFor,
  scopeGate,
  scopeNeedsAck,
  stackWarnings,
  tierRank,
  unknownModalitySlugs,
  type StackEntry,
} from '../src/stack/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// CR is a line terminator in JS regex; normalise once, at the read.
const DOC = fs
  .readFileSync(path.join(root, 'docs/theory/tools/training-stack.md'), 'utf8')
  .replace(/\r\n?/g, '\n');

/** The modality column of the worked-example table, in the document's order. */
const docRows = DOC.split('\n')
  .filter((l) => /^\|\s*\*\*/.test(l))
  .map((l) => l.split('|')[1]!.replace(/\*\*/g, '').trim());

describe('the tiers', () => {
  it('is the four the document names', () => {
    expect(TIER_IDS).toEqual(['master', 'deep', 'fluent', 'literacy']);
    expect(DOC).toContain('## The four tiers');
  });

  it('ranks them so that a deeper tier always outranks a shallower one', () => {
    expect(tierRank('master')).toBeGreaterThan(tierRank('deep'));
    expect(tierRank('deep')).toBeGreaterThan(tierRank('fluent'));
    expect(tierRank('fluent')).toBeGreaterThan(tierRank('literacy'));
    expect(tierRank('not-a-tier')).toBe(0);
  });

  it('caps exactly the two tiers the reading rules cap', () => {
    expect(CAPPED_TIERS).toEqual(['master', 'deep']);
    expect(TIERS.filter((t) => t.limit === null).map((t) => t.id)).toEqual(['fluent', 'literacy']);
  });

  it('carries both of the document’s names for the fourth tier', () => {
    const literacy = TIERS.find((t) => t.id === 'literacy')!;
    expect(literacy.name).toBe('Working literacy / Conversant');
    expect(DOC).toContain('**Working literacy / Conversant**');
  });
});

describe('the catalogue', () => {
  it('has one entry per row of the worked example, in the same order', () => {
    expect(MODALITIES).toHaveLength(docRows.length);
    expect(MODALITIES.map((m) => m.name)).toEqual(docRows);
  });

  it('gives every modality a unique slug', () => {
    expect(new Set(MODALITY_SLUGS).size).toBe(MODALITIES.length);
  });

  it('marks exactly the two dimmer modalities, and gives them no floor', () => {
    const dimmers = MODALITIES.filter((m) => m.dimmer);
    expect(dimmers.map((m) => m.slug)).toEqual(['person-centered', 'motivational-interviewing']);
    for (const d of dimmers) expect(d.floors, d.slug).toEqual([]);
  });

  it('gives every non-dimmer modality at least one floor in range', () => {
    for (const m of MODALITIES.filter((x) => !x.dimmer)) {
      expect(m.floors.length, m.slug).toBeGreaterThan(0);
      for (const f of m.floors) expect(f, m.slug).toBeGreaterThanOrEqual(1);
      for (const f of m.floors) expect(f, m.slug).toBeLessThanOrEqual(8);
    }
  });

  it('covers all eight floors between them, which is the document’s claim', () => {
    const all = new Set(MODALITIES.flatMap((m) => m.floors));
    expect([...all].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('recognises a slug, and names the ones it does not', () => {
    expect(isModalitySlug('act')).toBe(true);
    expect(isModalitySlug('emdr-but-spelled-wrong')).toBe(false);
    expect(unknownModalitySlugs(['act', 'nope', 7])).toEqual(['nope', '7']);
    expect(modality('act')?.floors).toContain(5);
  });
});

describe('coverage', () => {
  const stack: StackEntry[] = [
    { slug: 'act', tier: 'master' },
    { slug: 'cbt', tier: 'fluent' },
    { slug: 'dbt', tier: 'literacy' },
  ];

  it('reports the best tier reaching each floor', () => {
    const c = coverage(stack);
    expect(c[5]).toBe('master'); // ACT and CBT and DBT all reach 5; ACT is deepest
    expect(c[3]).toBe('fluent'); // CBT only
    expect(c[7]).toBe('literacy'); // DBT only
    expect(c[4]).toBeNull();
  });

  it('always reports all eight floors, so a missing one is null and not absent', () => {
    expect(Object.keys(coverage([]))).toHaveLength(8);
    expect(Object.values(coverage([])).every((v) => v === null)).toBe(true);
  });

  it('gives a dimmer modality no coverage however deeply it is held', () => {
    expect(Object.values(coverage([{ slug: 'person-centered', tier: 'master' }])).every((v) => v === null)).toBe(
      true,
    );
  });

  it('ignores a slug that names no modality rather than throwing', () => {
    expect(coverage([{ slug: 'not-a-modality', tier: 'master' } as StackEntry])[1]).toBeNull();
  });
});

describe('the scope gate', () => {
  const stack: StackEntry[] = [
    { slug: 'act', tier: 'master' },
    { slug: 'cbt', tier: 'fluent' },
    { slug: 'dbt', tier: 'literacy' },
  ];

  it('is covered at fluent or better', () => {
    expect(scopeFor(stack, 3)).toBe('covered');
    expect(scopeFor(stack, 5)).toBe('covered');
  });

  it('is a stretch when the floor is reached only at working literacy', () => {
    expect(scopeFor(stack, 7)).toBe('stretch');
  });

  it('is uncovered when nothing reaches the floor', () => {
    expect(scopeFor(stack, 4)).toBe('uncovered');
    expect(scopeFor([], 1)).toBe('uncovered');
  });

  it('treats an unplaced formulation as uncovered rather than covered', () => {
    // Null floor means the locator has not placed it. Defaulting that to
    // "covered" would let the one case with no reading skip the gate.
    expect(scopeFor(stack, null)).toBe('uncovered');
  });

  it('asks for an acknowledgement for everything but covered', () => {
    expect(scopeNeedsAck('covered')).toBe(false);
    expect(scopeNeedsAck('stretch')).toBe(true);
    expect(scopeNeedsAck('uncovered')).toBe(true);
  });

  /**
   * The arithmetic and the gate are different questions. scopeFor says what a
   * stack covers; scopeGate says whether the gate applies at all.
   */
  it('does not apply to a clinician with no stack on file', () => {
    expect(scopeGate([], 3)).toBeNull();
    expect(scopeNeedsAck(scopeGate([], 3))).toBe(false);
    // The arithmetic still says what it says.
    expect(scopeFor([], 3)).toBe('uncovered');
  });

  it('applies as soon as there is one row', () => {
    expect(scopeGate([{ slug: 'cbt', tier: 'fluent' }], 3)).toBe('covered');
    expect(scopeGate([{ slug: 'cbt', tier: 'fluent' }], 7)).toBe('uncovered');
  });
});

describe('the reading rules, as warnings', () => {
  it('says nothing about a stack that follows them', () => {
    const full: StackEntry[] = [
      { slug: 'act', tier: 'master' },
      { slug: 'cbt', tier: 'fluent' },
      { slug: 'person-centered', tier: 'fluent' },
      { slug: 'motivational-interviewing', tier: 'fluent' },
      { slug: 'psychodynamic', tier: 'literacy' },
      { slug: 'experiential', tier: 'deep' },
      { slug: 'existential', tier: 'literacy' },
      { slug: 'multicultural', tier: 'literacy' },
      { slug: 'dbt', tier: 'literacy' },
    ];
    expect(stackWarnings(full)).toEqual([]);
  });

  it('names a missing Master, thin Fluents, uncovered floors and a missing dimmer', () => {
    const w = stackWarnings([{ slug: 'cbt', tier: 'fluent' }]);
    expect(w.join(' ')).toMatch(/No Master/);
    expect(w.join(' ')).toMatch(/three Fluent/);
    expect(w.join(' ')).toMatch(/floors 1, 2, 4, 6, 7, 8/);
    expect(w.join(' ')).toMatch(/dimmer/);
  });

  it('says "floor" for one and "floors" for several', () => {
    const nearly: StackEntry[] = [
      { slug: 'act', tier: 'master' },
      { slug: 'cbt', tier: 'fluent' },
      { slug: 'person-centered', tier: 'fluent' },
      { slug: 'psychodynamic', tier: 'fluent' },
      { slug: 'dbt', tier: 'fluent' },
    ];
    // ACT 1/2/5, CBT 3/5, psychodynamic 4/6, DBT 5/7 — everything but the
    // substrate, which only the multicultural row reaches.
    expect(stackWarnings(nearly).join(' ')).toMatch(/reaches floor 8\b/);
  });
});
