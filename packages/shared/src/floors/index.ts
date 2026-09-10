/**
 * The floors, the locator's signs, and the scoring — one copy.
 *
 * This was in the clinician app. It is here because three things now need the
 * same answer: the browser that draws the locator, the API that validates what
 * a formulation claims and computes floor scores for the assistant, and the
 * tests. A weight that differs between them is a formulation that means one
 * thing when it is written and another when it is read.
 *
 * Provenance is kept, because the two sources disagree and will again:
 *
 *   source: 'locator'  the nine in docs/design/floor-locator.html, verbatim,
 *                      in its order and with its weights.
 *   source: 'aid'      signs docs/theory/tools/decision-aid-locating-the-floor.md
 *                      carries that the prototype does not.
 *
 * packages/shared/test/floors.test.ts re-reads the prototype on every run and
 * fails if the ported nine have drifted from it.
 *
 * The model never sees or emits a floor. It emits observation ids; scoreFloors
 * turns those into floors, here, in code.
 */
import { z } from 'zod';

export const FLOORS = [
  { n: 1, name: 'Narrative' },
  { n: 2, name: 'Metacognition' },
  { n: 3, name: 'Propositional beliefs' },
  { n: 4, name: 'Relational patterns' },
  { n: 5, name: 'Scripts and behavior' },
  { n: 6, name: 'Procedure and emotion' },
  { n: 7, name: 'Body and interoception' },
  { n: 8, name: 'The cultural substrate' },
] as const;

export type FloorNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const observationSchema = z.object({
  /**
   * Stable. A formulation stores these for the life of the record, so they are
   * names rather than positions: inserting a sign must not silently re-point
   * every formulation already written.
   */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** The sign, as the clinician reads it. */
  q: z.string().min(1),
  /** floor number → weight. Negative weights are intentional. */
  w: z.record(z.string(), z.number()),
  /** The floors this sign points at, as the source labels it. */
  tag: z.string().min(1),
  source: z.enum(['locator', 'aid']),
  /** The rest of the source's sentence, where it has one. */
  note: z.string().optional(),
});

export type FloorObservation = z.infer<typeof observationSchema>;

/** The nine in docs/design/floor-locator.html, verbatim and in its order. */
export const LOCATOR_OBSERVATIONS: readonly FloorObservation[] = z.array(observationSchema).parse([
  {
    id: 'insight-does-not-move',
    q: 'They can state the belief and argue against it themselves, accurately, and it doesn’t move.',
    w: { 6: 2, 7: 2, 3: -2 },
    tag: '6 · 7',
    source: 'locator',
  },
  {
    id: 'reaction-before-thought',
    q: 'The reaction arrives before the thought does.',
    w: { 6: 2, 7: 1 },
    tag: '6',
    source: 'locator',
  },
  {
    id: 'body-signal-as-world',
    q: 'A body signal is being read as information about the world.',
    w: { 7: 3 },
    tag: '7',
    source: 'locator',
  },
  {
    id: 'shows-up-in-the-room',
    q: 'It shows up in the room, with you, on schedule.',
    w: { 4: 3 },
    tag: '4',
    source: 'locator',
  },
  {
    id: 'runs-without-decision',
    q: 'It runs without a decision — they notice only afterward.',
    w: { 5: 3 },
    tag: '5',
    source: 'locator',
  },
  {
    id: 'environment-now',
    q: 'The environment is doing the damage right now, not only historically.',
    w: { 8: 4 },
    tag: '8',
    source: 'locator',
  },
  {
    id: 'how-they-hold-thinking',
    q: 'The trouble is how they hold their thinking, not what it says.',
    w: { 2: 3 },
    tag: '2',
    source: 'locator',
  },
  {
    id: 'one-coherent-account',
    q: 'One coherent account of who they are organises everything else.',
    w: { 1: 3 },
    tag: '1',
    source: 'locator',
  },
  {
    id: 'never-tested',
    q: 'They have never actually tested it — the situation is avoided.',
    w: { 5: 2, 3: 1 },
    tag: '5 · 3',
    source: 'locator',
  },
]);

/**
 * Signs the Decision Aid carries that the prototype does not.
 *
 * The first takes the floor the Aid names, at the weight every other
 * single-floor sign carries.
 *
 * The second is the one number in this file that no source document states.
 * The Aid routes it relatively — "points straight at the floor where a
 * high-precision prior just got contradicted" — because it makes the same
 * claim as the first locator sign: the load is not where the words are. So it
 * takes that sign's shape at half weight, since the two are one claim read
 * from different evidence and a case showing both would otherwise count it
 * twice and bury every other sign.
 *
 * THE WEIGHT IS THE DESIGNER'S, NOT THE AUTHOR'S. Derived from the
 * accurate-insight precedent and flagged for the author's review.
 */
export const AID_OBSERVATIONS: readonly FloorObservation[] = z.array(observationSchema).parse([
  {
    id: 'every-time-pattern',
    q: 'The every-time pattern — reproduces across partners, jobs, decades, indifferent to circumstance.',
    w: { 4: 3 },
    tag: '4',
    source: 'aid',
    note: 'A relational template, not a floor-3 belief about the current situation.',
  },
  {
    id: 'reaction-too-big',
    q: 'The reaction too big for the occasion.',
    w: { 6: 1, 7: 1, 3: -1 },
    tag: '6 · 7',
    source: 'aid',
    note: 'Follow the flare, not the topic.',
  },
]);

/** What the locator scores against: the prototype's nine, then the Aid's. */
export const OBSERVATIONS: readonly FloorObservation[] = [...LOCATOR_OBSERVATIONS, ...AID_OBSERVATIONS];

const BY_ID = new Map(OBSERVATIONS.map((o) => [o.id, o]));

export const OBSERVATION_IDS: readonly string[] = OBSERVATIONS.map((o) => o.id);

export const isObservationId = (id: unknown): id is string => typeof id === 'string' && BY_ID.has(id);

export const observation = (id: string): FloorObservation | undefined => BY_ID.get(id);

/** Ids in the input that name no sign. The API rejects on this being non-empty. */
export const unknownObservationIds = (ids: readonly unknown[]): string[] =>
  ids.filter((i) => !isObservationId(i)).map((i) => String(i));

/** A floor lights when its score is positive and within this fraction of the top. */
export const LIT_THRESHOLD = 0.6;

export interface FloorScores {
  /** floor number → summed weight, always all eight keys. */
  scores: Record<number, number>;
  /** How many signs were counted. Unknown ids are not counted. */
  checked: number;
  /** Highest-scoring floor, or null when nothing scores above zero. */
  top: number | null;
  max: number;
}

/**
 * The locator's scoring, unchanged: sum the weights of the ticked signs.
 *
 * Unknown ids are ignored rather than throwing — a stored formulation from a
 * future version must still render, and the API rejects unknown ids at the
 * door where it can say so usefully.
 */
export function scoreFloors(ids: readonly string[]): FloorScores {
  const scores: Record<number, number> = {};
  for (let f = 1; f <= 8; f++) scores[f] = 0;
  let checked = 0;
  for (const id of ids) {
    const obs = BY_ID.get(id);
    if (!obs) continue;
    checked++;
    for (const [f, w] of Object.entries(obs.w)) scores[Number(f)] = (scores[Number(f)] ?? 0) + w;
  }
  let top = 1;
  let max = -99;
  for (let f = 1; f <= 8; f++) {
    const v = scores[f] ?? 0;
    if (v > max) {
      max = v;
      top = f;
    }
  }
  return { scores, checked, top: max > 0 ? top : null, max };
}

/** Whether a floor is lit, given the scores and whether the gates are clear. */
export const isLit = (scores: Record<number, number>, max: number, f: number, gatesOk: boolean): boolean =>
  gatesOk && (scores[f] ?? 0) > 0 && (scores[f] ?? 0) >= max * LIT_THRESHOLD;

export interface Located extends FloorScores {
  /** The floor to show: the top scorer, or null when nothing scores. */
  floor: number | null;
  /** Every floor lit at this tick, ascending. Empty while a gate is open. */
  lit: number[];
}

/** Score, then read off the floor and everything lit beside it. */
export function locate(ids: readonly string[], gatesOk = true): Located {
  const scored = scoreFloors(ids);
  const lit: number[] = [];
  for (let f = 1; f <= 8; f++) if (isLit(scored.scores, scored.max, f, gatesOk)) lit.push(f);
  return { ...scored, floor: gatesOk ? scored.top : null, lit };
}

/**
 * The three gates, as the formulation records them. The clinician attests;
 * nothing else may. All three must be true before a formulation is written —
 * the database can only check that the keys are present and boolean, because
 * `{ risk: false }` is a well-formed refusal to attest.
 */
export const GATE_KEYS = ['risk', 'dial', 'calibrated'] as const;
export type GateKey = (typeof GATE_KEYS)[number];

export const gatesSchema = z.object({ risk: z.boolean(), dial: z.boolean(), calibrated: z.boolean() });
export type Gates = z.infer<typeof gatesSchema>;

export const allGatesCleared = (g: Gates): boolean => GATE_KEYS.every((k) => g[k] === true);

/**
 * The three gates phrased as questions, for the locating assistant.
 *
 * The assistant may ask; it may never answer. It returns gate *keys* — the
 * wording lives here, in code, so the model chooses from an enum of three and
 * has nowhere to put a sentence of its own. Only the clinician's attestation
 * clears a gate, and that is a separate field on a separate request.
 *
 * Wording follows Step 0 of docs/theory/tools/decision-aid-locating-the-floor.md.
 */
export const GATE_QUESTIONS: Readonly<Record<GateKey, string>> = {
  risk: 'Has acute risk been addressed — suicidality, danger to others, abuse, crisis?',
  dial: 'Could the dial be reversed — psychosis or mania, meaning running the opposite way?',
  calibrated:
    'Is the prior actually false, or is the environment the pathogen? Coercive control and intimate-partner violence screened?',
} as const;

/**
 * A formulation goes on trial after the second re-aim on the same case —
 * docs/theory-mapping.md §8. Version 1 is the formulation, 2 and 3 are the
 * re-aims, and at 3 the panel says so.
 */
export const RE_AIM_LIMIT = 2;
export const isOnTrial = (version: number): boolean => version >= RE_AIM_LIMIT + 1;
/** "Re-aim 1 of 2" for version 2. Null for the first formulation. */
export const reAimLabel = (version: number): string | null =>
  version <= 1 ? null : `Re-aim ${Math.min(version - 1, RE_AIM_LIMIT)} of ${RE_AIM_LIMIT}`;
