/**
 * The locator's signs and scoring, checked against the documents they came
 * from.
 *
 * This was in apps/clinician while the weights lived there. It moved with
 * them: the module is the shared one now, so its contract belongs beside it.
 * The prototype and the Decision Aid are re-read from disk on every run, so a
 * change to either shows up as a failing test rather than a silent divergence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AID_OBSERVATIONS,
  FLOORS,
  GATE_KEYS,
  LIT_THRESHOLD,
  LOCATOR_OBSERVATIONS,
  OBSERVATIONS,
  OBSERVATION_IDS,
  allGatesCleared,
  isObservationId,
  isOnTrial,
  locate,
  observation,
  reAimLabel,
  scoreFloors,
  unknownObservationIds,
} from '../src/floors/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(repo, p), 'utf8');

const LOCATOR = read('docs/design/floor-locator.html');
const AID = read('docs/theory/tools/decision-aid-locating-the-floor.md');

/** Curly quotes and dashes differ between our strings and the sources'. */
const normalise = (s: string) =>
  s
    .replace(/<\/?strong>/g, '')
    .replace(/\*+/g, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&mdash;/g, '\u2014')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Pull the OBS array out of the prototype and parse its weights. */
function locatorObservations(): { q: string; w: Record<string, number>; tag: string }[] {
  const block = LOCATOR.match(/var OBS = \[([\s\S]*?)\];/);
  if (!block) throw new Error('OBS not found in docs/design/floor-locator.html');
  // Each row is `{ q: "…", w: {…}, tag: "…" }`. The last has no trailing comma.
  const row = /\{\s*q:\s*"((?:[^"\\]|\\.)*)",\s*w:\s*\{([^}]*)\},\s*tag:\s*"([^"]*)"\s*\}/g;
  return [...block[1]!.matchAll(row)].map((m) => {
    const w: Record<string, number> = {};
    for (const p of (m[2] ?? '').matchAll(/(\d+)\s*:\s*(-?\d+)/g)) w[p[1]!] = Number(p[2]);
    return { q: m[1] ?? '', w, tag: m[3] ?? '' };
  });
}

describe('the floors', () => {
  it('are 1–8, in order', () => {
    expect(FLOORS.map((f) => f.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('the nine ported from the prototype', () => {
  const fromFile = locatorObservations();

  it('the prototype still has nine, and all nine are still ported', () => {
    expect(fromFile).toHaveLength(9);
    expect(LOCATOR_OBSERVATIONS).toHaveLength(9);
  });

  it('match it exactly — text, weights and tags', () => {
    for (let i = 0; i < fromFile.length; i++) {
      expect(normalise(LOCATOR_OBSERVATIONS[i]!.q), `obs ${i} text`).toBe(normalise(fromFile[i]!.q));
      expect(LOCATOR_OBSERVATIONS[i]!.w, `obs ${i} weights`).toEqual(fromFile[i]!.w);
      expect(LOCATOR_OBSERVATIONS[i]!.tag, `obs ${i} tag`).toBe(fromFile[i]!.tag);
      expect(LOCATOR_OBSERVATIONS[i]!.source, `obs ${i} source`).toBe('locator');
    }
  });

  it('keep the negative weight that pulls floor 3 down', () => {
    expect(LOCATOR_OBSERVATIONS[0]!.w['3']).toBe(-2);
  });
});

describe('the signs added from the Decision Aid', () => {
  it('take their wording from the Aid, not from us', () => {
    const aid = normalise(AID);
    for (const o of AID_OBSERVATIONS) {
      expect(aid, o.id).toContain(normalise(o.q).replace(/\.$/, ''));
      if (o.note) expect(aid, `${o.id} note`).toContain(normalise(o.note).replace(/^A /, 'a ').replace(/\.$/, ''));
    }
  });

  it('give the every-time pattern the floor the Aid names', () => {
    expect(observation('every-time-pattern')?.w).toEqual({ 4: 3 });
  });

  it('halve the sign the flare is derived from, so the two cannot double-count', () => {
    const flare = observation('reaction-too-big')!;
    const from = observation('insight-does-not-move')!;
    expect(Object.keys(flare.w).sort()).toEqual(Object.keys(from.w).sort());
    for (const f of Object.keys(flare.w)) expect(flare.w[f]! * 2, `floor ${f}`).toBe(from.w[f]);
  });

  it('record in this file that the flare weight is not the author’s', () => {
    const src = read('packages/shared/src/floors/index.ts');
    expect(src).toMatch(/THE WEIGHT IS THE DESIGNER'S, NOT THE AUTHOR'S/);
    expect(src).toMatch(/flagged for the author's review/);
  });
});

describe('observation ids', () => {
  it('are unique, stable names rather than positions', () => {
    expect(new Set(OBSERVATION_IDS).size).toBe(OBSERVATIONS.length);
    for (const id of OBSERVATION_IDS) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('recognise their own and refuse anything else', () => {
    expect(isObservationId('body-signal-as-world')).toBe(true);
    expect(isObservationId('not-a-sign')).toBe(false);
    expect(isObservationId(3)).toBe(false);
    expect(isObservationId(null)).toBe(false);
  });

  it('report exactly which ids are unknown', () => {
    expect(unknownObservationIds(['body-signal-as-world', 'nope', 7])).toEqual(['nope', '7']);
    expect(unknownObservationIds(OBSERVATION_IDS)).toEqual([]);
  });
});

describe('scoreFloors', () => {
  it('locates nothing from nothing', () => {
    const s = scoreFloors([]);
    expect(s.top).toBeNull();
    expect(s.checked).toBe(0);
  });

  it('sums the weights of the ticked signs', () => {
    const s = scoreFloors(['body-signal-as-world', 'reaction-before-thought']);
    expect(s.scores[7]).toBe(4);
    expect(s.scores[6]).toBe(2);
    expect(s.top).toBe(7);
    expect(s.checked).toBe(2);
  });

  it('ignores an unknown id rather than throwing', () => {
    // A stored formulation from a future version still has to render.
    const s = scoreFloors(['body-signal-as-world', 'from-the-future']);
    expect(s.scores[7]).toBe(3);
    expect(s.checked).toBe(1);
  });

  it('always returns all eight floors', () => {
    expect(Object.keys(scoreFloors([]).scores)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });
});

describe('locate', () => {
  it('lights 6 and 7 together on accurate insight, and pushes 3 down', () => {
    const out = locate(['insight-does-not-move']);
    expect(out.floor).toBe(6);
    expect(out.lit).toEqual([6, 7]);
    expect(out.scores[3]).toBe(-2);
  });

  it('puts a floor out of the lit set once the top pulls far enough ahead', () => {
    // 6 scores 2 against a top of 4, and 0.6 × 4 is 2.4.
    const out = locate(['reaction-before-thought', 'body-signal-as-world']);
    expect(out.floor).toBe(7);
    expect(out.lit).toEqual([7]);
    expect(LIT_THRESHOLD).toBe(0.6);
  });

  it('the flare cannot change what accurate insight already decided', () => {
    const insight = locate(['insight-does-not-move']);
    const both = locate(['insight-does-not-move', 'reaction-too-big']);
    expect(both.floor).toBe(insight.floor);
    expect(both.lit).toEqual(insight.lit);
  });

  it('the flare cannot out-vote a sign that names a floor outright', () => {
    expect(locate(['environment-now', 'reaction-too-big']).floor).toBe(8);
  });

  it('the two floor-4 signs agree rather than compete', () => {
    expect(locate(['every-time-pattern', 'shows-up-in-the-room']).lit).toEqual([4]);
  });

  it('locates nothing while a gate is open, whatever is ticked', () => {
    const out = locate(['body-signal-as-world', 'environment-now'], false);
    expect(out.floor).toBeNull();
    expect(out.lit).toEqual([]);
  });
});

describe('gates', () => {
  it('are the three the locator attests', () => {
    expect(GATE_KEYS).toEqual(['risk', 'dial', 'calibrated']);
  });

  it('clear only when all three are true', () => {
    expect(allGatesCleared({ risk: true, dial: true, calibrated: true })).toBe(true);
    for (const k of GATE_KEYS) {
      expect(allGatesCleared({ risk: true, dial: true, calibrated: true, [k]: false }), k).toBe(false);
    }
  });
});

describe('re-aims', () => {
  it('names none on the first formulation', () => {
    expect(reAimLabel(1)).toBeNull();
    expect(isOnTrial(1)).toBe(false);
  });

  it('counts the re-aims, not the versions', () => {
    expect(reAimLabel(2)).toBe('Re-aim 1 of 2');
    expect(reAimLabel(3)).toBe('Re-aim 2 of 2');
    expect(isOnTrial(2)).toBe(false);
  });

  it('puts the formulation on trial after the second re-aim', () => {
    expect(isOnTrial(3)).toBe(true);
    expect(isOnTrial(9)).toBe(true);
    expect(reAimLabel(9)).toBe('Re-aim 2 of 2');
  });
});
