/**
 * The training stack: tiers, coverage, and the scope gate.
 *
 * There is no catalogue in this package, so there is nothing here to check
 * against `docs/theory/modalities.md` — that check lives in
 * `apps/clinician/test/content.test.ts`, next to the module that holds the
 * data. What is checked here is the arithmetic, with modalities handed in.
 *
 * The tiers are still checked against `docs/theory/tools/training-stack.md`,
 * because the tiers are this module's own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CAPPED_TIERS,
  COVERAGE_LEVELS,
  MODALITY_SLUGS,
  STACK_DISCLAIMER,
  TIERS,
  TIER_IDS,
  coverage,
  coverageOf,
  isModalitySlug,
  isOutsideStack,
  levelFor,
  outsideStack,
  outsideStackLine,
  stackWarnings,
  tierRank,
  unknownModalitySlugs,
  type StackEntry,
  type StackModality,
} from '../src/stack/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// CR is a line terminator in JS regex; normalise once, at the read.
const DOC = fs
  .readFileSync(path.join(root, 'docs/theory/tools/training-stack.md'), 'utf8')
  .replace(/\r\n?/g, '\n');

/**
 * A stand-in for the modalities module, shaped the way it hands data in.
 * Deliberately not the real catalogue: these functions must work on whatever
 * they are given, and pinning them to real slugs here would recreate the fork.
 */
const M: StackModality[] = [
  { slug: 'alpha', name: 'Alpha', floors: [3, 5], dimmer: false },
  { slug: 'beta', name: 'Beta', floors: [5, 6, 7], dimmer: false },
  { slug: 'gamma', name: 'Gamma', floors: [], dimmer: true },
  { slug: 'delta', name: 'Delta', floors: [4], dimmer: true },
];

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

  it('carries both of the document’s names for the fourth tier', () => {
    expect(TIERS.find((t) => t.id === 'literacy')!.name).toBe('Working literacy / Conversant');
    expect(DOC).toContain('**Working literacy / Conversant**');
  });

  it('marks Master and Deep as the capped tiers, which the app warns about', () => {
    expect(CAPPED_TIERS).toEqual(['master', 'deep']);
  });
});

describe('the slug mirror', () => {
  it('recognises a slug and names the ones it does not', () => {
    expect(isModalitySlug('cbt')).toBe(true);
    expect(isModalitySlug('emdr-but-spelled-wrong')).toBe(false);
    expect(unknownModalitySlugs(['cbt', 'nope', 7])).toEqual(['nope', '7']);
  });

  it('holds slugs and nothing else — no names, no floors, no levers', () => {
    // The moment this list grows a second field it is a catalogue, and there is
    // already one. apps/clinician/test/content.test.ts pins it to the module.
    for (const s of MODALITY_SLUGS) expect(typeof s).toBe('string');
    expect(new Set(MODALITY_SLUGS).size).toBe(MODALITY_SLUGS.length);
  });
});

describe('coverage', () => {
  const stack: StackEntry[] = [
    { slug: 'alpha', tier: 'master' },
    { slug: 'beta', tier: 'literacy' },
    { slug: 'gamma', tier: 'fluent' },
  ];

  it('reports all eight floors, deepest tier first, with the modalities reaching each', () => {
    const c = coverage(stack, M);
    expect(c.floors.map((f) => f.floor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(coverageOf(c, 5)).toMatchObject({ tier: 'master', level: 'specialist', modalities: ['alpha', 'beta'] });
    expect(coverageOf(c, 3)).toMatchObject({ tier: 'master', modalities: ['alpha'] });
    expect(coverageOf(c, 7)).toMatchObject({ tier: 'literacy', level: 'literacy', modalities: ['beta'] });
    expect(coverageOf(c, 1)).toMatchObject({ tier: null, level: 'gap', modalities: [] });
  });

  it('names the levels the way the prompt does', () => {
    expect(COVERAGE_LEVELS).toEqual(['specialist', 'in-stack', 'literacy', 'gap']);
    expect(levelFor('master')).toBe('specialist');
    expect(levelFor('deep')).toBe('specialist');
    expect(levelFor('fluent')).toBe('in-stack');
    expect(levelFor('literacy')).toBe('literacy');
    expect(levelFor(null)).toBe('gap');
  });

  it('puts a dimmer modality in the dimmer layer and on no floor', () => {
    const c = coverage([{ slug: 'gamma', tier: 'master' }], M);
    expect(c.dimmer).toEqual(['gamma']);
    expect(c.floors.every((f) => f.level === 'gap')).toBe(true);
  });

  it('lets a modality reach a floor and be a dimmer at the same time', () => {
    // Person-Centered is the real case: conditions, and floor 4 when the
    // regard is put at risk.
    const c = coverage([{ slug: 'delta', tier: 'fluent' }], M);
    expect(c.dimmer).toEqual(['delta']);
    expect(coverageOf(c, 4)).toMatchObject({ level: 'in-stack' });
  });

  it('ignores a slug the modalities do not define, rather than throwing', () => {
    const c = coverage([{ slug: 'not-a-modality', tier: 'master' }], M);
    expect(c.floors.every((f) => f.level === 'gap')).toBe(true);
    expect(c.dimmer).toEqual([]);
  });

  it('handles an empty stack and an empty catalogue', () => {
    expect(coverage([], M).floors).toHaveLength(8);
    expect(coverage([{ slug: 'alpha', tier: 'master' }], []).dimmer).toEqual([]);
  });
});

describe('the scope gate', () => {
  const stack: StackEntry[] = [
    { slug: 'alpha', tier: 'fluent' }, // 3, 5
    { slug: 'beta', tier: 'literacy' }, // 5, 6, 7
  ];

  it('is inside the stack at fluent or deeper', () => {
    expect(outsideStack(stack, M, 3)).toBe(false);
    expect(outsideStack(stack, M, 5)).toBe(false);
  });

  it('is outside it at working literacy, and where nothing reaches', () => {
    expect(outsideStack(stack, M, 7)).toBe(true);
    expect(outsideStack(stack, M, 1)).toBe(true);
  });

  it('says nothing to a clinician with no stack on file', () => {
    // You cannot be outside a stack you have not written down.
    expect(outsideStack([], M, 7)).toBe(false);
  });

  it('says nothing when the locator has placed nothing', () => {
    expect(outsideStack(stack, M, null)).toBe(false);
  });

  it('maps levels to the annotation the same way every time', () => {
    expect(isOutsideStack('specialist')).toBe(false);
    expect(isOutsideStack('in-stack')).toBe(false);
    expect(isOutsideStack('literacy')).toBe(true);
    expect(isOutsideStack('gap')).toBe(true);
  });

  it('uses the line the prompt specifies, verbatim', () => {
    expect(outsideStackLine(6)).toBe('Floor 6 is outside your stack at this tier — refer, co-treat, or supervise.');
  });

  it('never refuses: there is no function here that can return a failure', () => {
    // The gate annotates. If this module ever grows something that says "no",
    // the design has changed and this test should be the thing that notices.
    expect(typeof outsideStack(stack, M, 7)).toBe('boolean');
  });
});

describe('the reading rules, as warnings', () => {
  it('says nothing about a stack that follows them', () => {
    const full: StackEntry[] = [
      { slug: 'alpha', tier: 'master' },
      { slug: 'beta', tier: 'fluent' },
      { slug: 'gamma', tier: 'fluent' },
      { slug: 'delta', tier: 'fluent' },
    ];
    // alpha 3/5, beta 5/6/7, delta 4 — floors 1, 2, 8 are still gaps.
    const w = stackWarnings(full, full.length ? M : M);
    expect(w.join(' ')).toMatch(/No tool reaches floors 1, 2, 8/);
    expect(w.join(' ')).not.toMatch(/No Master|three Fluent|dimmer/);
  });

  it('warns about a second Master and a second Deep rather than refusing them', () => {
    const w = stackWarnings(
      [
        { slug: 'alpha', tier: 'master' },
        { slug: 'beta', tier: 'master' },
        { slug: 'gamma', tier: 'deep' },
        { slug: 'delta', tier: 'deep' },
      ],
      M,
    );
    expect(w.join(' ')).toMatch(/More than one Master/);
    expect(w.join(' ')).toMatch(/More than one Deep/);
  });

  it('names a missing Master, thin Fluents, gaps and a missing dimmer', () => {
    const w = stackWarnings([{ slug: 'alpha', tier: 'fluent' }], M);
    expect(w.join(' ')).toMatch(/No Master/);
    expect(w.join(' ')).toMatch(/three Fluent/);
    expect(w.join(' ')).toMatch(/floors 1, 2, 4, 6, 7, 8/);
    expect(w.join(' ')).toMatch(/dimmer/);
  });

  it('says "floor" for one and "floors" for several', () => {
    const nearly: StackEntry[] = [
      { slug: 'alpha', tier: 'master' },
      { slug: 'beta', tier: 'fluent' },
      { slug: 'gamma', tier: 'fluent' },
      { slug: 'delta', tier: 'fluent' },
    ];
    expect(stackWarnings(nearly, M).join(' ')).toMatch(/floors 1, 2, 8/);
    const one: StackModality[] = [{ slug: 'alpha', name: 'A', floors: [1, 2, 3, 4, 5, 6, 7], dimmer: true }];
    expect(stackWarnings([{ slug: 'alpha', tier: 'master' }], one).join(' ')).toMatch(/reaches floor 8/);
  });
});

describe('the disclaimer', () => {
  it('is verbatim', () => {
    expect(STACK_DISCLAIMER).toBe('Self-declared. Not a credential. Never shown to clients.');
  });
});
