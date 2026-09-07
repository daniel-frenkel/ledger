/**
 * Vocabulary — the author's terms, as typed constants.
 *
 * Every screen, API field, and clinician view draws its words from here so
 * the three surfaces stay on the same language. Two rules from the source
 * material are enforced by what is and isn't in this file:
 *
 *   1. A *dial* is set; a *gauge* is read. There is no "turn the dial down on
 *      your rejection prediction" anywhere in the product, because there is
 *      no constant for it.
 *   2. Theory is surfaced only at the moment of mismatch. The floors are here
 *      for clinician-facing and documentation use; the client UI does not
 *      show them.
 *
 * Sources: A Unified Clinical Model of Psychotherapy (UCM); floor notes;
 * Protocol — Panic / PTSD / Social Anxiety; Waking the Driver (WtD);
 * Respected and Unwanted (R&U). See docs/theory-mapping.md.
 */

// ---------------------------------------------------------------------------
// Roles and statuses
// ---------------------------------------------------------------------------

export const USER_ROLES = ['client', 'clinician'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const LINK_STATUSES = ['pending', 'active', 'revoked'] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

// ---------------------------------------------------------------------------
// The loop: predict → check → notice the gap
// ---------------------------------------------------------------------------

/**
 * The only field calibration reads. Free text cannot be scored; this can.
 * `partial` exists because "half the time reality confirms the small annoyance
 * and still disconfirms the catastrophe" (WtD Ch10). `unclear` is never scored;
 * it is routed to the clinician.
 */
export const OUTCOME_VERDICTS = ['hit', 'partial', 'miss', 'unclear'] as const;
export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number];

/**
 * Was the outcome something the client observed (what they said and did) or
 * inferred (what they must have thought)? "Forecasts about other minds are
 * still forecasts, and they're the ones your machine checks least" (WtD Ch6).
 * Inferred outcomes are marked and can be excluded from the headline number.
 */
export const OUTCOME_SOURCES = ['observed', 'inferred'] as const;
export type OutcomeSource = (typeof OUTCOME_SOURCES)[number];

/**
 * Why a prediction was never run. "A prediction never tested never dies"
 * (UCM §2.3). The `avoided` and `left_early` reasons are the app's only
 * direct view of the *avoid* move; they are counted per prior for the
 * clinician and never shown to the client as a judgment.
 */
export const ABANDON_REASONS = [
  'situation_did_not_occur',
  'avoided',
  'left_early',
  'forgot',
  'other',
] as const;
export type AbandonReason = (typeof ABANDON_REASONS)[number];

/**
 * The client's own account of their part in the outcome. Self-report of the
 * *provoke* and *withdraw effort* moves is weak evidence in any single entry —
 * "as long as the heat is filed as the room's doing, every heated room remains
 * an independent fact about rooms" (UCM §2.3) — but the drift in answers over
 * months is the three configurations the paper describes, and that is worth
 * a dated record.
 */
export const OWN_PART_OPTIONS = ['none', 'made_it_likelier', 'held_back', 'unsure'] as const;
export type OwnPart = (typeof OWN_PART_OPTIONS)[number];

/**
 * The exit forecast: a second prediction, about the self. "When this gets
 * hard, my way out will be…" — the five furnace moves (UCM §2.3) in plain
 * behavior words, never theory words, on the client side. Forecasting the
 * move is what lets it be seen while it fires; a move you called in advance
 * cannot be filed as the room's doing. Graded like any other forecast.
 */
export const EXIT_MOVES = [
  'leave_early', // avoid
  'not_really_try', // withdraw effort
  'explain_it_away', // reinterpret
  'notice_only_the_bad', // filter
  'push_until_they_react', // provoke
  'none', // "I don't think I'll take one"
] as const;
export type ExitMove = (typeof EXIT_MOVES)[number];

export const EXIT_MOVE_LABELS: Record<ExitMove, string> = {
  leave_early: 'Leave before the hard part',
  not_really_try: 'Not really try',
  explain_it_away: 'Explain it away afterward',
  notice_only_the_bad: 'Only notice the bad part',
  push_until_they_react: 'Push until they react',
  none: 'No exit — I’ll stay in it',
};

// ---------------------------------------------------------------------------
// Priors
// ---------------------------------------------------------------------------

/**
 * Starter taxonomy, drawn from the source text. UCM §6.1 question five asks
 * "where the injury weights — toward being unwanted (the inclusion input) or
 * being low (the rank input)"; the first two categories are those two inputs.
 */
export const PRIOR_CATEGORIES = [
  'mattering', // belonging / the sociometer — "if I show weakness, they withdraw"
  'rank', // standing / the hierometer — "they'll see it and judge"
  'body', // floor 7 / threat — "this sensation = catastrophe now"
  'effort', // futility — "effort won't pay; reward won't arrive"
  'self_story', // "I am not enough, and it must not show"
  'other',
] as const;
export type PriorCategory = (typeof PRIOR_CATEGORIES)[number];

export const PRIOR_CATEGORY_LABELS: Record<PriorCategory, string> = {
  mattering: 'Being wanted',
  rank: 'Standing',
  body: 'The body',
  effort: 'Whether it pays to try',
  self_story: 'The story about me',
  other: 'Other',
};

/** Who put a prior on the list. */
export const PRIOR_ORIGINS = ['client', 'clustered', 'clinician'] as const;
export type PriorOrigin = (typeof PRIOR_ORIGINS)[number];

/**
 * Example prior sentences, in the author's words, offered as *examples* when a
 * client is naming their own — never assigned. "Nobody is a type. The map's
 * job is to help you find your own defaults, not to hand you a new verdict to
 * wear" (WtD Ch4).
 */
export const PRIOR_EXAMPLES: Record<PriorCategory, readonly string[]> = {
  mattering: [
    'If I show this, it will cost me.',
    'If I show weakness, they withdraw.',
    'People only want you when you’re useful.',
    'If I say no, something between us breaks and it won’t come back.',
    'If people really knew me, they’d leave.',
  ],
  rank: [
    'If I speak up in that meeting, they’ll think less of me.',
    'If I ask for help, I’ll look like I couldn’t handle it.',
    'Lose the point, lose the room.',
    'Not being calm and collected is a sign of incompetence.',
  ],
  body: [
    'This sensation means something is wrong right now.',
    'If I rest, everything falls apart.',
    'If I stop checking, that’s exactly when it falls apart.',
  ],
  effort: ['What’s the point. It won’t work anyway.', 'Being noticed is being harmed.'],
  self_story: ['I am not enough, and it must not show.', 'I’m the screwup of the family.'],
  other: [],
};

// ---------------------------------------------------------------------------
// Body / interoception (Floor 7)
// ---------------------------------------------------------------------------

/**
 * Channels from Protocol — Panic Phase 4 ("heart → dying; breath →
 * suffocating; head → stroke, madness, losing control; legs and vision →
 * collapsing"), plus `numb` for the alexithymic case in Floor 7: "the alarm is
 * ringing on a floor his awareness doesn't visit."
 */
export const BODY_CHANNELS = [
  'heart',
  'breath',
  'head',
  'unreality',
  'stomach',
  'muscle',
  'legs_vision',
  'numb',
] as const;
export type BodyChannel = (typeof BODY_CHANNELS)[number];

export const BODY_CHANNEL_LABELS: Record<BodyChannel, string> = {
  heart: 'Heart',
  breath: 'Breath',
  head: 'Head',
  unreality: 'Unreal / far away',
  stomach: 'Stomach',
  muscle: 'Muscles / jaw',
  legs_vision: 'Legs / vision',
  numb: 'Nothing — numb',
};

/** Seed words for the body vocabulary. Floor 7: "tight, heavy, buzzing". */
export const BODY_SEED_WORDS = [
  'tight',
  'heavy',
  'buzzing',
  'hot',
  'cold',
  'shaky',
  'hollow',
  'racing',
  'frozen',
  'far away',
] as const;

/**
 * "Armor" / the kit — things on the table that can take the credit for a
 * survival. Protocol — Panic Phase 5: "arrive without the kit … so the credit
 * for every survival lands on the body, not the bottle."
 */
export const KIT_ITEMS = [
  'water',
  'medication',
  'exit_seat',
  'phone',
  'safe_person',
  'breathing_technique',
  'alcohol',
  'other',
] as const;
export type KitItem = (typeof KIT_ITEMS)[number];

/** Did the body's forecast come due? */
export const VERDICT_ARRIVED = ['yes', 'partly', 'no'] as const;
export type VerdictArrived = (typeof VERDICT_ARRIVED)[number];

/**
 * What the survival was credited to. The accounting that converts *rescued*
 * into *false alarm* (Protocol — Panic Phase 4–5). `body` is the only value
 * that counts as a disconfirmation of a body-channel prior.
 */
export const CREDITED_TO = ['body', 'kit', 'person', 'technique', 'luck'] as const;
export type CreditedTo = (typeof CREDITED_TO)[number];

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 100;
/** A confidence at or above this is "high" for the loud-mismatch rule. */
export const HIGH_CONFIDENCE_THRESHOLD = 70;

export const INTENSITY_MIN = 0;
export const INTENSITY_MAX = 10;

export const SURPRISE_MIN = 0;
export const SURPRISE_MAX = 10;

// ---------------------------------------------------------------------------
// Crisis resources — shown by the hard-coded crisis module. Never by an LLM.
// ---------------------------------------------------------------------------

export const CRISIS_RESOURCES = {
  lifeline_988: {
    id: 'lifeline_988',
    name: '988 Suicide & Crisis Lifeline',
    action: 'Call or text 988',
    tel: '988',
    sms: '988',
    url: 'https://988lifeline.org',
  },
  vcl_call: {
    id: 'vcl_call',
    name: 'Veterans Crisis Line',
    action: 'Dial 988, then press 1',
    tel: '988',
    url: 'https://www.veteranscrisisline.net',
  },
  vcl_text: {
    id: 'vcl_text',
    name: 'Veterans Crisis Line (text)',
    action: 'Text 838255',
    sms: '838255',
    url: 'https://www.veteranscrisisline.net',
  },
  emergency_911: {
    id: 'emergency_911',
    name: 'Emergency services',
    action: 'Call 911',
    tel: '911',
  },
} as const;
export type CrisisResourceId = keyof typeof CRISIS_RESOURCES;

// ---------------------------------------------------------------------------
// Floors of the self — clinician/documentation use only. Not shown to clients.
// ---------------------------------------------------------------------------

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

/** Copy that appears on the "not a therapist" framing, verbatim across surfaces. */
export const FRAMING = {
  tagline: 'A prediction ledger for behavioral experiments. Not a therapist.',
  notATherapist:
    'Ledger is a notebook with arithmetic. It is not a therapist, not a treatment, and not a substitute for one. If you are in crisis, use the resources below.',
  frameworkCaveat:
    'The design draws on predictive processing, a framework for how brains use prediction. It is a lens, not a validated treatment. What you are actually doing here is a written behavioral experiment.',
  noStreaks: 'There are no streaks here.',
} as const;
