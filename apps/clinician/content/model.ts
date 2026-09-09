/**
 * The model page.
 *
 * Every `body` here is quoted from docs/theory-mapping.md. The only text we
 * supply is the section headings and the short lead-ins naming which source is
 * speaking — never a claim. Where the memo qualifies itself, the qualification
 * is carried across rather than smoothed out; §8 is on the page for that reason.
 */
import { FRAMING } from '@ledger/shared';
import { z } from 'zod';
import { referenceKeys } from './references';

export const blockSchema = z.object({
  heading: z.string().min(1),
  /** Paragraphs, each quoted from the memo. */
  body: z.array(z.string().min(1)).min(1),
  cites: z.array(z.enum(referenceKeys() as [string, ...string[]])).min(1),
});
export type Block = z.infer<typeof blockSchema>;

export const MODEL_TITLE = 'The model';
export const MODEL_STANDFIRST =
  'The vocabulary the app uses verbatim, and the discipline that comes with it. Every line on this page is quoted from the theory-mapping memo.';

/**
 * Verbatim from FRAMING in @ledger/shared. The task requires this exact
 * sentence on the model page and the protocols index, unsoftened.
 */
export const FRAMEWORK_CAVEAT = FRAMING.frameworkCaveat;
export const NOT_A_THERAPIST = FRAMING.notATherapist;

export const MODEL_BLOCKS: readonly Block[] = z.array(blockSchema).parse([
  {
    heading: 'A prediction is not a guess',
    body: [
      '“A prediction here is not a guess. A guess is conscious, held loosely, and checked against experience. A prediction is none of these: it is built below awareness, delivered as fact, and *is* the experience.”',
      'The trade-book synonym is forecast: “Stress is a prediction your machine makes about what the world is about to do to you.”',
    ],
    cites: ['ucm', 'cg', 'wtd'],
  },
  {
    heading: 'Prior',
    body: [
      '“A prior is a standing prediction … learned where the person actually lived, usually early, usually without words.”',
      'With the discipline the app must keep: “first ask whether the prior is actually miscalibrated.” A calibrated prior is “an accurate read of a punishing present.”',
    ],
    cites: ['cg', 'ucm'],
  },
  {
    heading: 'Prediction error, and surprise as its readout',
    body: [
      'Prediction error “is the only genuinely new information in the system.”',
      '“Surprise is prediction error arriving in consciousness.” And: “if nothing surprised the client, nothing changed.”',
      '“Surprise marks registration, not update. A client can be visibly surprised and have it excused within thirty seconds — *huh, weird, anyway* … The clinically interesting window is the half-minute after the surprise.”',
    ],
    cites: ['ucm', 'rn-surprise'],
  },
  {
    heading: 'Precision, the dimmer',
    body: [
      'The brain “weights each signal by its estimated reliability — its precision — and updates more in response to signals it trusts”; “precision is the dimmer on every incoming signal”.',
      'And the consequence: “The corrective signal is usually not missing — it is arriving and being weighted at zero.”',
    ],
    cites: ['ucm', 'mod'],
  },
  {
    heading: 'Dial versus gauge',
    body: [
      '“a dial is set; a gauge is read.” “The gauges are read, never turned.”',
      'Reserve “dial” for precision and keep the domain-dials clinician-side. A screen that says “turn the dial down on your rejection prediction” breaks the distinction he was most deliberate about.',
    ],
    cites: ['ucm', 'rnu-gauges'],
  },
  {
    heading: 'The two gauges',
    body: [
      'The status gauge “reads rank, not welcome. It asks one question. *Am I above or below?*”; the belonging gauge “tracks being wanted — being liked, being chosen, being someone people are glad to have around. It asks a completely different question: *do they want me here?*”',
      'The research names are mattering “tracked by the *sociometer*” and rank “tracked by a *hierometer* function”.',
    ],
    cites: ['rnu', 'ucm', 'rnu-bridge'],
  },
  {
    heading: 'The furnace and its five moves',
    body: [
      '“There are only two ways to kill a prediction error: update the belief, or create a world in which it is true.”',
      'The moves are Provoke, Avoid, Filter, Reinterpret, Withdraw effort; provoke and withdraw effort “manufacture a real confirming consequence,” avoid “*prevents the test*,” and filter and reinterpret are “the Part 2.2 dimmer working defensively.”',
      'Prepayment is explicitly not a furnace move: “he pays the predicted harm in advance,” having learned “that calm is not evidence”.',
    ],
    cites: ['ucm', 'wtd', 'p-panic'],
  },
  {
    heading: 'The press secretary',
    body: [
      'The explaining voice “has no sightline into its own causes.”',
      'Rule four is the app’s most usable sentence: “the size of the error is proportional to the confidence of the belief it just contradicted.”',
    ],
    cites: ['ucm'],
  },
  {
    heading: 'What the loop reaches',
    body: [
      'The crosswalk lands behavioral experiments on floors 3 and 5 and exposure-as-expectancy-violation on floors 5–6. The interoceptive track reaches floor 7. Floor 2 is reachable indirectly.',
      'Floor 4’s deep copy updates only through “the relationship itself behaving off-template while the template is live”. Floor 6 reconsolidation needs the trace “live, felt in the room” and inside the window of tolerance. Floor 8 is “assessed, never assumed”.',
      'Treat 1, 4-deep, 6, and 8 as out of scope and say so in the clinician view.',
    ],
    cites: ['ucm', 'mod', 'f4', 'f5', 'f6', 'f7'],
  },
  {
    heading: 'What a skeptical reviewer will say',
    body: [
      'The mechanism is “a testable proposal rather than an established finding”; “the precision mathematics is far better grounded for low-level perception than for the upper floors this model leans on”; the floors are “a teaching device, not anatomy”; the risers “were made, not found; the green cells are a composite; no reliability data exist for any of it”; every protocol is “made, not found” with “no outcome data of its own”; the appendices “are not instruments.”',
      'He names the unfalsifiability charge against himself: “if you nod, the book is right; if you tighten, the book is more right. An argument built that way cannot lose, and an argument that cannot lose has stopped being an argument.”',
      'The answer is implemented literally: “after the second re-aim on the same case, the formulation itself goes on trial” and “a genuine negative result re-opens the formulation, it does not confirm the prior.”',
      'The positioning the memo supplies is the one the app should print: the delivered treatment is behavioral experiments and exposure under Craske’s rules; predictive processing is “a lens, not a proof”; and the author writes “as a counseling student rather than a licensed practitioner.”',
    ],
    cites: ['ucm', 'rnu', 'craske-2014'],
  },
]);
