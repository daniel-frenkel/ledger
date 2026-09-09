/**
 * The locator's gates, observations, scoring and warnings.
 *
 * Ported from docs/design/floor-locator.html without alteration: the three
 * gates and their notes, the nine OBS entries with their exact weight maps and
 * tags (including the negative weight on the first one), the 0.6 lit threshold,
 * and the four warning strings with the conditions that select them.
 *
 * test/observations.test.ts re-reads that file and asserts these still match it.
 */
import { z } from 'zod';

export const gateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  note: z.string().min(1),
});
export type Gate = z.infer<typeof gateSchema>;

export const GATES: readonly Gate[] = z.array(gateSchema).parse([
  {
    id: 'g1',
    name: 'Acute risk addressed',
    note: 'The mattering lens understands suicidal desire; it does not replace risk management.',
  },
  {
    id: 'g2',
    name: 'Dial not reversed',
    note: 'No psychosis or mania. Do not loosen priors or generate prediction error here.',
  },
  {
    id: 'g3',
    name: 'Prior is not calibrated',
    note: 'The room won’t confirm the fear. Coercive control and IPV screened. Otherwise the task is sorting, not softening.',
  },
]);

export const GATES_EYEBROW = 'Gates — clear these before locating anything';

/**
 * Shown under gate 3. The environment is asked about twice on purpose, and
 * without saying so it reads as a duplicate: the Decision Aid's Step 0 checks
 * the field *before* the floor logic runs at all, and the floor-8 observation
 * is what routes a case to the substrate once it is running. Different jobs,
 * same question.
 */
export const GATE_3_FOOTNOTE =
  'Asked twice on purpose. Here it decides whether to enter the floor logic at all; the floor-8 sign below decides where a case that entered it belongs.';

/** Shown while any gate is open. The locator bolds the first sentence. */
export const GATE_BLOCKED = {
  lead: 'Locating is off until the gates clear.',
  rest: 'Running an experiment past an open gate hands the prior fresh evidence with your signature on it.',
} as const;

export const observationSchema = z.object({
  /** The sign, as the clinician reads it. */
  q: z.string().min(1),
  /** floor number → weight. Negative weights are intentional. */
  w: z.record(z.string(), z.number()),
  /** The floors this sign points at, as the locator labels it. */
  tag: z.string().min(1),
  /**
   * Which document this sign comes from. The prototype and the Decision Aid
   * do not carry the same list, and the difference is worth keeping visible:
   * test/content.test.ts checks each set against its own source.
   */
  source: z.enum(['locator', 'aid']),
  /** The rest of the source's sentence, where it has one. */
  note: z.string().optional(),
});
export type Observation = z.infer<typeof observationSchema>;

/** The nine in docs/design/floor-locator.html, verbatim and in its order. */
export const LOCATOR_OBSERVATIONS: readonly Observation[] = z.array(observationSchema).parse([
  {
    q: 'They can state the belief and argue against it themselves, accurately, and it doesn’t move.',
    w: { 6: 2, 7: 2, 3: -2 },
    tag: '6 · 7',
    source: 'locator',
  },
  { q: 'The reaction arrives before the thought does.', w: { 6: 2, 7: 1 }, tag: '6', source: 'locator' },
  { q: 'A body signal is being read as information about the world.', w: { 7: 3 }, tag: '7', source: 'locator' },
  { q: 'It shows up in the room, with you, on schedule.', w: { 4: 3 }, tag: '4', source: 'locator' },
  { q: 'It runs without a decision — they notice only afterward.', w: { 5: 3 }, tag: '5', source: 'locator' },
  { q: 'The environment is doing the damage right now, not only historically.', w: { 8: 4 }, tag: '8', source: 'locator' },
  { q: 'The trouble is how they hold their thinking, not what it says.', w: { 2: 3 }, tag: '2', source: 'locator' },
  { q: 'One coherent account of who they are organises everything else.', w: { 1: 3 }, tag: '1', source: 'locator' },
  { q: 'They have never actually tested it — the situation is avoided.', w: { 5: 2, 3: 1 }, tag: '5 · 3', source: 'locator' },
]);

/**
 * Signs the Decision Aid carries that the prototype does not.
 *
 * docs/theory/tools/decision-aid-locating-the-floor.md is the locator's source
 * document, and its Step 1 list and the prototype's OBS array had drifted
 * apart. This closes the half of that gap that can be closed without deciding
 * anything: the Aid names a floor here, so the weight goes where the Aid puts
 * it, at 3 — the same weight every other single-floor sign carries.
 *
 * The Aid's other missing sign, "The reaction too big for the occasion", is
 * deliberately absent. It routes *relatively* — "points straight at the floor
 * where a high-precision prior just got contradicted" — so there is no floor
 * to weight without choosing one, and choosing one is a clinical decision
 * rather than a porting decision. It is in the report as an open question.
 */
export const AID_OBSERVATIONS: readonly Observation[] = z.array(observationSchema).parse([
  {
    q: 'The every-time pattern — reproduces across partners, jobs, decades, indifferent to circumstance.',
    w: { 4: 3 },
    tag: '4',
    source: 'aid',
    note: 'A relational template, not a floor-3 belief about the current situation.',
  },
  {
    /*
     * The Aid routes this one relatively — "points straight at the floor where
     * a high-precision prior just got contradicted" — because it means what
     * the first sign in the prototype means: the load is not where the words
     * are.
     *
     * So it takes that sign's shape, { 6: 2, 7: 2, 3: -2 }, at half weight.
     * Half because the two signs are the same claim read from different
     * evidence, and a case that shows both would otherwise count it twice and
     * bury every other sign.
     *
     * THE WEIGHT IS THE DESIGNER'S, NOT THE AUTHOR'S. Derived from the
     * accurate-insight precedent, not stated anywhere in the Decision Aid, and
     * flagged for the author's review. Everything else in this file comes from
     * a source document.
     */
    q: 'The reaction too big for the occasion.',
    w: { 6: 1, 7: 1, 3: -1 },
    tag: '6 · 7',
    source: 'aid',
    note: 'Follow the flare, not the topic.',
  },
]);

/** What the locator scores against: the prototype's nine, then the Aid's. */
export const OBSERVATIONS: readonly Observation[] = [...LOCATOR_OBSERVATIONS, ...AID_OBSERVATIONS];

export const OBSERVATIONS_HEADING = 'What are you seeing?';
export const OBSERVATIONS_SUB =
  'Tick what you have observed, not what the client reports about themselves. The floor is read from signs and patterns the client is usually the last to see.';

/** A floor lights when its score is positive and within this fraction of the top score. */
export const LIT_THRESHOLD = 0.6;

export interface Scored {
  scores: Record<number, number>;
  checked: number;
  /** Highest-scoring floor, or null when nothing scores above zero. */
  top: number | null;
  max: number;
}

/** The locator's scoring, unchanged: sum the weights of the ticked signs. */
export function score(ticked: readonly number[]): Scored {
  const scores: Record<number, number> = {};
  for (let f = 1; f <= 8; f++) scores[f] = 0;
  for (const i of ticked) {
    const obs = OBSERVATIONS[i];
    if (!obs) continue;
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
  return { scores, checked: ticked.length, top: max > 0 ? top : null, max };
}

/** Whether a floor is lit, given the scores and whether the gates are clear. */
export const isLit = (scores: Record<number, number>, max: number, f: number, gatesOk: boolean): boolean =>
  gatesOk && (scores[f] ?? 0) > 0 && (scores[f] ?? 0) >= max * LIT_THRESHOLD;

export interface Located extends Scored {
  /** The floor to show: the top scorer, or null when nothing scores. */
  floor: number | null;
  /** Every floor lit at this tick, ascending. Empty while a gate is open. */
  lit: number[];
}

/**
 * The whole locate step in one call: score the ticked signs, then read off the
 * floor and everything else lit beside it.
 *
 * The page did this inline. It is here so that a case can be stated as
 * "these signs, this floor" and checked — see test/locate-eval.test.ts.
 */
export function locate(ticked: readonly number[], gatesOk = true): Located {
  const scored = score(ticked);
  const lit: number[] = [];
  for (let f = 1; f <= 8; f++) if (isLit(scored.scores, scored.max, f, gatesOk)) lit.push(f);
  return { ...scored, floor: gatesOk ? scored.top : null, lit };
}

export const NO_FLOOR_TITLE = 'No floor indicated yet';
export const NO_FLOOR_WARNING =
  'Tick what you have observed. Nothing here is inferred from the client’s self-report.';

/** Warnings, in the locator's own order of precedence. `lead` is bolded there. */
export const WARNINGS = {
  default: { lead: '', rest: 'Origin and maintenance are different addresses. Treat where it is maintained; acknowledge where it began.' },
  substrate: {
    lead: 'Maintenance is in the substrate.',
    rest: 'No upper-floor tool reaches it, and reframing an accurate perception of a hostile world is recruitment into the injury, not therapy. The honest move is advocacy and handoff.',
  },
  glassOverConcrete: {
    lead: 'Careful.',
    rest: 'Signs point at 6 or 7 as well. A floor-3 tool aimed at a floor-6/7 prior produces accurate insight that changes nothing.',
  },
  hot: {
    lead: 'It only updates while it’s firing',
    rest: '— and it cannot update while it’s flooding. Past the window, nothing files.',
  },
} as const;

/** Exactly the locator's branch order: 8, then 3-with-6/7, then 6 or 7, else default. */
export function warningFor(shown: number, scores: Record<number, number>): { lead: string; rest: string } {
  if (shown === 8) return WARNINGS.substrate;
  if (shown === 3 && (scores[6] ?? 0) + (scores[7] ?? 0) > 0) return WARNINGS.glassOverConcrete;
  if (shown === 6 || shown === 7) return WARNINGS.hot;
  return WARNINGS.default;
}

export const BUILDING_CAPTION =
  'A teaching device, not anatomy. Floor 8 is drawn as ground because no upper-floor tool reaches it.';

/** The footer, verbatim. */
export const LOCATOR_DISCLAIMER =
  'The locator weights signs; it does not score a client and it is not an assessment instrument. It has no outcome data of its own. You decide, and the formulation you write is the one that gets tested — and, after a second re-aim on the same case, itself goes on trial.';

export const RESULT_ACTIONS = ['Write this formulation', 'Open protocol', 'Assign an experiment'] as const;
