/**
 * The eval harness, without the model.
 *
 * The fixture is the answer key for the locating assistant, so the things worth
 * asserting are that it parses, that every sign it names is a real sign, and
 * that it is still honestly marked as placeholder material. The run itself is
 * manual — it costs money and needs a key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OBSERVATION_IDS } from '@ledger/shared';
import { findWorkspaceRoot } from '../src/env.js';
import { jaccard, parseCases } from '../scripts/eval-locate.js';

const root = findWorkspaceRoot(process.cwd());
const fixture = fs.readFileSync(path.join(root!, 'docs/theory/eval/locate-notes.md'), 'utf8');
const cases = parseCases(fixture);

describe('the eval fixture', () => {
  it('parses the three scaffolded cases', () => {
    expect(cases).toHaveLength(3);
    expect(cases.map((c) => c.id)).toEqual(['case-01', 'case-02', 'case-03']);
  });

  it('gives every case a floor, a note, and at least one sign', () => {
    for (const c of cases) {
      expect(c.floor, c.id).toBeGreaterThanOrEqual(1);
      expect(c.floor, c.id).toBeLessThanOrEqual(8);
      expect(c.note.length, c.id).toBeGreaterThan(20);
      expect(c.observations.length, c.id).toBeGreaterThan(0);
    }
  });

  it('names only signs that exist, so a renamed sign fails here rather than scoring zero', () => {
    for (const c of cases) for (const o of c.observations) expect(OBSERVATION_IDS, c.id).toContain(o);
  });

  it('is still marked placeholder, in the heading and in the frontmatter', () => {
    expect(cases.every((c) => c.placeholder)).toBe(true);
    expect(fixture).toMatch(/^status: DRAFT/m);
  });

  it('rejects a sign id that is not a sign', () => {
    const bad = '### case-99 · PLACEHOLDER\n\n- **floor:** 3\n- **observations:** not-a-real-sign\n\n> A note long enough to count.\n';
    expect(() => parseCases(bad)).toThrow(/not a sign/);
  });
});

describe('jaccard', () => {
  it('is 1 for the same set and 0 for disjoint sets', () => {
    expect(jaccard(['a', 'b'], ['b', 'a'])).toBe(1);
    expect(jaccard(['a'], ['b'])).toBe(0);
  });

  it('counts both misses and false positives', () => {
    // one shared, one missed, one invented → 1/3
    expect(jaccard(['a', 'b'], ['a', 'c'])).toBeCloseTo(1 / 3, 10);
  });

  it('treats two empty answers as agreement, because an empty answer is a correct answer', () => {
    expect(jaccard([], [])).toBe(1);
  });
});
