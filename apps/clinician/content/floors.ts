/**
 * The eight floors.
 *
 * `n` and `name` come from FLOORS in @ledger/shared — the canonical list, not a
 * copy. `definition` is the UCM §3.1 wording as quoted in docs/theory-mapping.md
 * §2. `lives`, `reach`, `proto` and `falsify` are ported from the FLOORS object
 * in docs/design/floor-locator.html, verbatim. `warning` is the contextual
 * warning that file shows for that floor.
 *
 * Nothing here is written by us. Where a floor's own note is elided in the
 * sources, it stays elided.
 */
import { FLOORS } from '@ledger/shared';
import { z } from 'zod';
import { referenceKeys } from './references';

export const floorSchema = z.object({
  n: z.number().int().min(1).max(8),
  name: z.string().min(1),
  /** UCM §3.1, as quoted in the memo. */
  definition: z.string().min(1),
  /** Locator: what lives here. */
  lives: z.string().min(1),
  /** Locator: what reaches it. */
  reach: z.string().min(1),
  /** Locator: protocol names routed here. Empty for floor 8, which routes none. */
  proto: z.array(z.string().min(1)),
  /** Locator: what would falsify the placement. */
  falsify: z.string().min(1),
  /** Locator: the contextual warning shown for this floor. */
  warning: z.string().min(1),
  /** True where the locator shows this warning only under a condition. */
  warningCondition: z.string().optional(),
  cites: z.array(z.enum(referenceKeys() as [string, ...string[]])).min(1),
});

export type Floor = z.infer<typeof floorSchema>;

/** docs/design/floor-locator.html, the default warning for floors 1, 2, 4, 5. */
const DEFAULT_WARNING =
  'Origin and maintenance are different addresses. Treat where it is maintained; acknowledge where it began.';

/** docs/design/floor-locator.html, shown when the located floor is 6 or 7. */
const HOT_FLOOR_WARNING =
  'It only updates while it’s firing — and it cannot update while it’s flooding. Past the window, nothing files.';

const name = (n: number): string => {
  const f = FLOORS.find((x) => x.n === n);
  if (!f) throw new Error(`No floor ${n} in @ledger/shared FLOORS`);
  return f.name;
};

export const FLOOR_CONTENT: readonly Floor[] = z.array(floorSchema).parse([
  {
    n: 1,
    name: name(1),
    definition: 'the binding story, the single “you” stretched across time',
    lives: 'The story told about who they are, and what it organises.',
    reach: 'Narrative and meaning work, existential therapies, re-authoring.',
    proto: ['The self-story'],
    falsify: 'The story changes in session and nothing downstream moves.',
    warning: DEFAULT_WARNING,
    cites: ['ucm', 'da'],
  },
  {
    n: 2,
    name: name(2),
    definition:
      'beliefs about your own mind: whether thoughts are facts, whether feelings are dangerous, whether change is possible',
    lives: 'The relationship to their own thinking, not its content.',
    reach: 'Defusion, mindfulness, metacognitive work on worry and rumination.',
    proto: ['Worry (GAD)', 'OCD'],
    falsify: 'They can already hold the thought loosely and it still runs them.',
    warning: DEFAULT_WARNING,
    cites: ['ucm', 'da'],
  },
  {
    n: 3,
    name: name(3),
    definition: 'the explicit convictions about self, others, world, future, and value',
    lives: 'What can be stated and argued with.',
    reach: 'Thought records, evidence work, behavioural experiments aimed at content.',
    proto: ['Health anxiety', 'Social anxiety'],
    falsify: '“I know it’s not true and I still feel it.” Accurate insight, no change.',
    warning:
      'Careful. Signs point at 6 or 7 as well. A floor-3 tool aimed at a floor-6/7 prior produces accurate insight that changes nothing.',
    warningCondition: 'The locator shows this when the ticked signs also weigh floors 6 or 7.',
    cites: ['ucm', 'da', 'mod'],
  },
  {
    n: 4,
    name: name(4),
    definition: 'the self-in-relation: what you expect from closeness, the template laid down by early attachment',
    lives: 'What other people are expected to do, especially under strain.',
    reach: 'The therapy relationship itself — rupture and repair, regard that was free to drop and didn’t.',
    proto: ['The self-story', 'Depression'],
    falsify: 'Warmth lands and generalises without the relationship being tested.',
    warning: DEFAULT_WARNING,
    cites: ['ucm', 'da', 'f4'],
  },
  {
    n: 5,
    name: name(5),
    definition: 'learned sequences that run a familiar situation to its known end before thought arrives',
    lives: 'What runs without deciding, noticed only afterward.',
    reach: 'Behavioural activation, interrupting the operant, blocking the safety behaviour.',
    proto: ['Depression', 'Addiction', 'OCD'],
    falsify: 'They can stop it on request and the prediction still fires.',
    warning: DEFAULT_WARNING,
    cites: ['ucm', 'da', 'f5'],
  },
  {
    n: 6,
    name: name(6),
    definition: 'stored action and sensory traces with built emotional responses fused to them',
    lives: 'The response that arrives before the thought, and only updates while it’s firing.',
    reach: 'Experiential work with affect live; exposure run past the peak, not to the first flinch.',
    proto: ['PTSD', 'Prolonged grief', 'Panic'],
    falsify: 'It updates from discussion alone, cold, outside the moment.',
    warning: HOT_FLOOR_WARNING,
    cites: ['ucm', 'da', 'f6'],
  },
  {
    n: 7,
    name: name(7),
    definition: 'the felt boundary of the self and the constant inner read of the body’s state',
    lives: 'The alarm, read as news about the world rather than a reading of the body.',
    reach: 'Interoceptive exposure, arousal work, pairing the signal with what actually followed.',
    proto: ['Panic', 'Chronic pain', 'PTSD', 'Insomnia'],
    falsify: 'The sensation is absent and the catastrophe forecast persists unchanged.',
    warning: HOT_FLOOR_WARNING,
    cites: ['ucm', 'da', 'f7'],
  },
  {
    n: 8,
    name: name(8),
    definition:
      'the language, categories, and norms absorbed before they could be weighed; not one belief among others but the medium the structure is built in',
    lives: 'What the water is doing now — ongoing threat, discrimination, a room that really is hostile.',
    reach: 'Advocacy, environment change, handoff. No upper-floor tool reaches it.',
    // The locator renders floor 8's protocol cell as an em dash: it routes none.
    proto: [],
    falsify: 'Remove the environment and the pattern persists.',
    warning:
      'Maintenance is in the substrate. No upper-floor tool reaches it, and reframing an accurate perception of a hostile world is recruitment into the injury, not therapy. The honest move is advocacy and handoff.',
    cites: ['ucm', 'da'],
  },
]);

export const floor = (n: number): Floor | undefined => FLOOR_CONTENT.find((f) => f.n === n);

/** The memo's two honesty notes about the model itself (theory-mapping §2). */
export const FLOOR_CAVEATS: readonly { text: string; cites: string[] }[] = [
  {
    text: 'Floor 4 “straddles the building,” with “a sayable component that lives near floor 3” and “a procedural-emotional component … that runs at floor-6 depth”.',
    cites: ['ucm', 'f4'],
  },
  {
    text: 'The floors are “a teaching device, not anatomy,” with the vertical ordering “this model’s own proposal, not a finding”.',
    cites: ['ucm'],
  },
  {
    text: 'Treat 1, 4-deep, 6, and 8 as out of scope and say so in the clinician view.',
    cites: ['ucm', 'f4', 'f6'],
  },
];
