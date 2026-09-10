/**
 * The locator's page copy.
 *
 * The signs, their weights and the scoring moved to @ledger/shared — the
 * browser that draws this, the API that validates a formulation, and the tests
 * all need the same answer, and a weight that differs between them is a
 * formulation that means one thing when written and another when read. This
 * file is what is left: the gates as the clinician reads them, the warnings,
 * and the strings the page shows. All of it ported from
 * docs/design/floor-locator.html without alteration.
 *
 * test/content.test.ts checks the copy against that file and asserts this
 * module holds no second copy of the weights. The weights themselves are
 * checked in packages/shared/test/floors.test.ts, next to where they live.
 */
import { z } from 'zod';

export {
  AID_OBSERVATIONS,
  GATE_KEYS,
  LIT_THRESHOLD,
  LOCATOR_OBSERVATIONS,
  OBSERVATIONS,
  OBSERVATION_IDS,
  allGatesCleared,
  isLit,
  isObservationId,
  isOnTrial,
  locate,
  observation,
  reAimLabel,
  scoreFloors,
} from '@ledger/shared';
export type { FloorObservation, Gates, Located } from '@ledger/shared';

export const gateSchema = z.object({
  /** Matches the key in a formulation's `gates` attestation. */
  id: z.enum(['risk', 'dial', 'calibrated']),
  name: z.string().min(1),
  note: z.string().min(1),
});
export type Gate = z.infer<typeof gateSchema>;

export const GATES: readonly Gate[] = z.array(gateSchema).parse([
  {
    id: 'risk',
    name: 'Acute risk addressed',
    note: 'The mattering lens understands suicidal desire; it does not replace risk management.',
  },
  {
    id: 'dial',
    name: 'Dial not reversed',
    note: 'No psychosis or mania. Do not loosen priors or generate prediction error here.',
  },
  {
    id: 'calibrated',
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

export const OBSERVATIONS_HEADING = 'What are you seeing?';
export const OBSERVATIONS_SUB =
  'Tick what you have observed, not what the client reports about themselves. The floor is read from signs and patterns the client is usually the last to see.';

export const NO_FLOOR_TITLE = 'No floor indicated yet';
export const NO_FLOOR_WARNING =
  'Tick what you have observed. Nothing here is inferred from the client’s self-report.';

/** Warnings, in the locator's own order of precedence. `lead` is bolded there. */
export const WARNINGS = {
  default: {
    lead: '',
    rest: 'Origin and maintenance are different addresses. Treat where it is maintained; acknowledge where it began.',
  },
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

/** The falsify field. Required, and the label says why. */
export const FALSIFY_LABEL = 'What would show this placement is wrong?';
export const FALSIFY_HINT =
  'Required. A formulation that cannot be wrong is not a formulation — name the reading that would send you back to step 1.';

export const NOTE_LABEL = 'The note';
export const NOTE_HINT = 'What you observed, in your words. Encrypted at rest; the client does not read it.';

/** Shown on the panel once a formulation has been re-aimed twice. */
export const ON_TRIAL =
  'This formulation has been re-aimed twice. The next move is to test the formulation itself, not the client.';
