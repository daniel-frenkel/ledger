/**
 * The modality crosswalk, ported from docs/theory/modalities.md.
 *
 * Every string is that document's own text. Inline markdown (**bold**,
 * *italic*) and Obsidian [[wikilinks]] are carried across unchanged and
 * resolved at render time — internal #heading links become anchors, links to
 * vault documents that are not in this repo render as plain text.
 *
 * Home floors keep their qualifiers: "6–7", "4 (at system scale)",
 * "stakes (belonging)" are the source's own phrasing and are displayed as
 * written, with the floor numbers inside them linked.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// schemas
// ---------------------------------------------------------------------------

/** Non-numeric home-floor values the source uses. */
export const FLOOR_TOKENS = ['conditions', 'change process', 'stakes'] as const;
export type FloorToken = (typeof FLOOR_TOKENS)[number];

export const homeFloorSegmentSchema = z
  .object({
    /** Exactly as the source writes it, qualifier included. */
    text: z.string().min(1),
    /** Floor numbers inside `text`, for linking. */
    floors: z.array(z.number().int().min(1).max(8)),
    /** Set when the segment is one of the named non-numeric values. */
    token: z.enum(FLOOR_TOKENS).optional(),
  })
  .refine((s) => s.floors.length > 0 || s.token !== undefined, {
    message: 'a home-floor segment must name a floor in 1–8 or one of the named qualifiers',
  });
export type HomeFloorSegment = z.infer<typeof homeFloorSegmentSchema>;

export const techniqueSchema = z.object({
  technique: z.string().min(1),
  lever: z.string().min(1),
  /** The floor cell as written: "3", "3 / 5", "5–6", "6 → 3", "conditions". */
  floorText: z.string().min(1),
  /** Floor numbers inside floorText, for linking. */
  floors: z.array(z.number().int().min(1).max(8)),
  /** The load-bearing column. Never truncated. */
  whenItFails: z.string().min(1),
});
export type Technique = z.infer<typeof techniqueSchema>;

export const calloutSchema = z.object({
  kind: z.enum(['info', 'note', 'warning']),
  title: z.string().min(1),
  body: z.array(z.string().min(1)).min(1),
});
export type Callout = z.infer<typeof calloutSchema>;

/**
 * Declared as an interface first: the schema is recursive (a section may hold
 * subsections), and zod cannot infer a type that references itself.
 */
export interface ModalitySection {
  slug: string;
  /** The heading exactly as the source writes it, used for #anchor links. */
  heading: string;
  coreLogic: string[];
  techniques: Technique[];
  whatPPAdds: string[];
  callouts: Callout[];
  subsections: ModalitySection[];
}

export const modalitySectionSchema: z.ZodType<ModalitySection> = z.lazy(() =>
  z.object({
    slug: z.string().regex(/^[a-z0-9-]+$/),
    heading: z.string().min(1),
    coreLogic: z.array(z.string().min(1)).min(1),
    techniques: z.array(techniqueSchema),
    whatPPAdds: z.array(z.string().min(1)),
    callouts: z.array(calloutSchema),
    subsections: z.array(modalitySectionSchema),
  }),
);

/** Digits 1–8 appearing in a floor cell, in order, de-duplicated. */
export const floorsIn = (text: string): number[] => {
  const out: number[] = [];
  for (const m of text.matchAll(/\b([1-8])\b/g)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
};

/** Build a technique row, deriving the floor links from the cell text. */
const t = (technique: string, lever: string, floorText: string, whenItFails: string): Technique =>
  techniqueSchema.parse({ technique, lever, floorText, floors: floorsIn(floorText), whenItFails });

/** Build a home-floor segment, deriving floor links from the text. */
const seg = (text: string, token?: FloorToken): HomeFloorSegment =>
  homeFloorSegmentSchema.parse({ text, floors: floorsIn(text), ...(token ? { token } : {}) });

// ---------------------------------------------------------------------------
// the framing callouts
// ---------------------------------------------------------------------------

export const CROSSWALK_TITLE = 'How the Major Modalities Recalibrate Priors';
export const CROSSWALK_SUBTITLE =
  'A predictive-processing crosswalk — technique, lever, floor, and when it fails — across CBT, ACT, DBT, psychodynamic/EFT, EMDR, and MI';

export const CROSSWALK_STANDFIRST =
  'Companion to [[A Unified Clinical Model of Psychotherapy]]. The paper argues that the hundred-odd therapies work by reaching the same machinery through different doors. This note walks through the doors. For each major modality it names the core logic in predictive-processing terms, lays the signature techniques out as a table of **technique → lever pulled → floor reached → when it fails**, and closes with the one thing the frame adds that the modality’s own manual doesn’t. Read it as a map for cross-training and for troubleshooting a stall — not as a claim that any tradition reduces to this vocabulary. Held by the therapist; matched to the client’s floor via the [[Decision Aid — Locating the Floor]]. The six modalities below get a full section each; the complete counseling-theories canon — Corey’s eleven — is mapped in a single table near the end.';

export const FRAMING_CALLOUTS: readonly Callout[] = z.array(calloutSchema).parse([
  {
    kind: 'info',
    title: 'The six levers — and why the last column matters most',
    body: [
      'Every technique below pulls one or more of the same small set of levers the engine runs on:',
      '**Content** — revise what the prior *claims* (change the belief itself).',
      '**Precision** — re-weight confidence: turn the stuck prior *down*, the disconfirming evidence *up*. The valve.',
      '**Prediction error** — engineer one real, *unmanufactured* mismatch between prediction and outcome.',
      '**Furnace** — interrupt the behavior quietly manufacturing the confirming evidence (provoke · avoid · filter · reinterpret · withdraw effort).',
      '**Reconsolidation** — reactivate a consolidated emotional prior so it goes briefly labile, then update it in the presence of a new outcome (the floor 6–7 special case).',
      '**Valve / relationship** — the safety, belonging, and standing that let *any* error count at all.',
      'The **when it fails** column is the point of the whole exercise. A crosswalk that only renamed techniques in new words would be a thesaurus. The frame earns its keep only where it predicts *why a sound technique bounces off a particular client* — and that is almost always a lever–floor mismatch, an uninterrupted furnace, or a shut valve. If a row’s failure mode is just “when you do it badly,” it isn’t pulling its weight.',
    ],
  },
  {
    kind: 'note',
    title: 'Floors, in one line',
    body: [
      '1 narrative · 2 metacognition · 3 beliefs · 4 relational template · 5 scripts/sequences · 6 procedure–emotion · 7 body · 8 cultural substrate. Glass (verbal, 1–3) vs concrete (embodied, 5–7). Full map in [[A Unified Clinical Model of Psychotherapy]] Part 3 and the [[Decision Map — Locating the Floor]].',
    ],
  },
]);

// ---------------------------------------------------------------------------
// table 1 — the core six
// ---------------------------------------------------------------------------

export const coreSixRowSchema = z.object({
  modality: z.string().min(1),
  primaryLever: z.string().min(1),
  homeFloors: z.array(homeFloorSegmentSchema).min(1),
  homeFloorsSeparator: z.string().default(', '),
  distinctiveReach: z.string().min(1),
  /** Slug of the deep section on this page, when there is one. */
  section: z.string().optional(),
});
export type CoreSixRow = z.infer<typeof coreSixRowSchema>;

export const CORE_SIX_HEADING = 'The core six, side by side';

export const CORE_SIX: readonly CoreSixRow[] = z.array(coreSixRowSchema).parse([
  {
    modality: '**CBT**',
    primaryLever: 'Content + prediction error',
    homeFloors: [seg('3'), seg('5')],
    distinctiveReach: 'Falsifying a *false* belief with engineered evidence',
    section: 'cbt',
  },
  {
    modality: '**ACT**',
    primaryLever: 'Precision + furnace',
    homeFloors: [seg('2'), seg('6–7')],
    distinctiveReach: 'Recalibrating a *true* prior without touching its content',
    section: 'act',
  },
  {
    modality: '**DBT**',
    primaryLever: 'Precision management + valve',
    homeFloors: [seg('7'), seg('conditions', 'conditions')],
    distinctiveReach: 'Cooling a hot precision system enough to work at all',
    section: 'dbt',
  },
  {
    modality: '**Psychodynamic / EFT**',
    primaryLever: 'Relational prediction error + reconsolidation',
    homeFloors: [seg('4'), seg('6')],
    distinctiveReach: 'The live corrective *emotional* experience',
    section: 'psychodynamic-eft',
  },
  {
    modality: '**EMDR**',
    primaryLever: 'Reconsolidation',
    homeFloors: [seg('6')],
    distinctiveReach: 'Destabilizing a maximally consolidated memory prior',
    section: 'emdr',
  },
  {
    modality: '**MI**',
    primaryLever: 'Precision (source of evidence) + valve',
    homeFloors: [seg('change process', 'change process')],
    distinctiveReach: 'Moving ambivalence without firing the furnace',
    section: 'motivational-interviewing',
  },
]);

export const CORE_SIX_AFTER: readonly string[] = [
  'Two things fall out of the table. First, **no modality owns all the levers, and none is complete** — which is the map’s practical payoff. Pick the tradition whose lever fits the floor the client’s problem sits on; when your current approach stalls, read across the *when it fails* columns to find the lever you’re *not* pulling. A CBT that won’t move is often an EFT-shaped problem — a floor-6 prior that needs reactivation, not evidence. An MI that stalls may be a genuine floor-7 dysregulation that needs DBT’s precision-down before any change-talk can be weighted at all.',
  'Second, **the convergence runs deepest exactly where the theories fight hardest.** The easy agreements — *exposure is prediction error* — a skeptic can wave off as relabeling. The hard one — ACT, whose philosophy of science forbids the representational vocabulary the frame is built on, converging anyway on *change the relationship to the thought, not its content* — is the one that can’t be dismissed. That is the argument the crosswalk exists to make.',
  'The six above are the modalities you actively *run* — each deep enough to execute straight from the table. But the lens is meant to cover the whole field, so here is the other cut: every named approach in the standard counseling-theories curriculum, mapped one row each.',
];

// ---------------------------------------------------------------------------
// table 2 — the counseling-theories canon
// ---------------------------------------------------------------------------

export const canonRowSchema = z.object({
  modality: z.string().min(1),
  whatItIs: z.string().min(1),
  primaryLever: z.string().min(1),
  homeFloors: z.array(homeFloorSegmentSchema).min(1),
  homeFloorsSeparator: z.string().default(', '),
  whereItStalls: z.string().min(1),
  section: z.string().optional(),
});
export type CanonRow = z.infer<typeof canonRowSchema>;

export const CANON_HEADING = 'The counseling-theories canon (Corey, ch. 4–14)';

export const CANON_INTRO =
  'These are the eleven approaches a counseling student meets in the survey course; the chapter numbers track Corey’s *Theory and Practice of Counseling and Psychotherapy*. The paper’s claim is that one lens accounts for all of them — not by flattening them, but by showing which lever each one pulls and which floor it reaches. Read one thing first: two of these barely fit the phrase “recalibrate a prior,” and that is the point, not a gap — some approaches refuse to treat a *calibrated* prior at all. The framework is honest about where the work is not error-correction.';

export const CANON: readonly CanonRow[] = z.array(canonRowSchema).parse([
  {
    modality: '**Psychoanalytic (4)**',
    whatItIs:
      'Transference and interpretation surface a defended floor-4 relational template; resistance *is* the furnace protecting it',
    primaryLever: 'Relational prediction error; making priors legible',
    homeFloors: [seg('4'), seg('6')],
    whereItStalls:
      'Intellectual insight without the live relational error is inert (run deep in the Psychodynamic & EFT section above)',
    section: 'psychodynamic-eft',
  },
  {
    modality: '**Adlerian (5)**',
    whatItIs:
      'The “style of life” is a narrative goal-prior (private logic, fictional finalism); “acting as if” is a behavioral experiment; “spitting in the soup” names the hidden payoff so the furnace move stops working',
    primaryLever: 'Narrative content + prediction error + furnace-interrupt',
    homeFloors: [seg('1'), seg('stakes (belonging)', 'stakes')],
    whereItStalls:
      'Encouragement with no real test stays inspirational; the belonging need (sociometer) must be named, not assumed *(full section below)*',
    section: 'adlerian',
  },
  {
    modality: '**Existential (6)**',
    whatItIs:
      'The “givens” — death, freedom, isolation, meaning — are *calibrated* priors with nothing to falsify; you work the stance and the meaning-frame',
    primaryLever: 'Narrative / meaning + valve (authentic presence)',
    homeFloors: [seg('1'), seg('conditions', 'conditions')],
    whereItStalls:
      'Treating a true existential prior as a distortion to fix — the calibration gate at the scale of a life',
  },
  {
    modality: '**Person-Centered (7)**',
    whatItIs:
      'Rogers’ core conditions (empathy, UPR, congruence) *are* the valve; and when the prior is relational, the regard that survives contact *is* the disconfirming evidence',
    primaryLever: 'Valve + relational prediction error',
    homeFloors: [seg('conditions', 'conditions'), seg('4 (when the regard is put at risk)')],
    homeFloorsSeparator: '; ',
    whereItStalls:
      'When it is only comfortable — a regard never at risk teaches a floor-4 prior nothing, and the therapy stays on the glass floors',
  },
  {
    modality: '**Gestalt (8)**',
    whatItIs:
      '“Unfinished business” is an un-updated floor-6 emotion held out of awareness; the empty chair reactivates it live',
    primaryLever: 'Reconsolidation + furnace-interrupt + precision on the body',
    homeFloors: [seg('6'), seg('7'), seg('2')],
    whereItStalls: 'Enactment without safety re-runs the wound; the concrete-floor cousin of EFT *(full section below)*',
    section: 'gestalt',
  },
  {
    modality: '**Behavior (9)**',
    whatItIs: 'Conditioned fears and contingencies are floor-5/6 action-priors; exposure is the pure prediction-error engine',
    primaryLever: 'Prediction error + furnace-interrupt; contingency = script revision',
    homeFloors: [seg('5'), seg('6')],
    whereItStalls:
      'Safety behaviors leave the furnace running — it’s the error engine inside CBT, without the content layer',
    section: 'cbt',
  },
  {
    modality: '**Cognitive Behavior (10)**',
    whatItIs: 'Revises the *content* of a floor-3 belief and engineers a real error to test it',
    primaryLever: 'Content + prediction error',
    homeFloors: [seg('3'), seg('5')],
    whereItStalls: 'Words aimed at a concrete prior (run deep in the CBT section above)',
    section: 'cbt',
  },
  {
    modality: '**Choice Theory / Reality (11)**',
    whatItIs:
      'Active inference in plain language — you act to make the world match your “quality world” of wanted-priors; WDEP’s self-evaluation is a self-generated discrepancy',
    primaryLever: 'Self-generated prediction error + new script (planning)',
    homeFloors: [seg('1 (wants)'), seg('5 (doing)')],
    whereItStalls:
      'Self-evaluation that shames instead of revealing the gap; it needs the valve MI supplies *(full section below)*',
    section: 'reality-therapy',
  },
  {
    modality: '**Feminist (12)**',
    whatItIs:
      'Symptoms are often *calibrated* reads of real power and oppression; the pathogen is frequently the floor-8 substrate, not the individual prior',
    primaryLever: 'Name the substrate; calibration gate; egalitarian valve',
    homeFloors: [seg('8'), seg('conditions', 'conditions')],
    whereItStalls:
      'Privatizing a structural injury as a personal distortion — the institutional reason the calibration gate exists',
  },
  {
    modality: '**Postmodern — SFBT & Narrative (13)**',
    whatItIs:
      'No single objective prior to correct; hunt the disconfirming evidence the problem-story filters out (exceptions, unique outcomes) and re-author; externalizing is defusion at the level of identity',
    primaryLever: 'Narrative content + precision (attention to exceptions) + defusion',
    homeFloors: [seg('1'), seg('2')],
    whereItStalls:
      'A future-prior (the miracle question) with no path built to it; re-authoring over an unregulated concrete floor *(full section below)*',
    section: 'postmodern',
  },
  {
    modality: '**Family Systems (14)**',
    whatItIs:
      'The furnace scaled to a whole network — each member manufactures the others’ predicted response, so the loop maintains the symptom, not the person',
    primaryLever: 'Systemic furnace-interrupt + new error via enactment; reframing = precision / narrative',
    homeFloors: [seg('4 (at system scale)'), seg('5')],
    whereItStalls:
      'Working the identified patient alone can’t reach a system-maintained prior; you have to change the loop *(full section below)*',
    section: 'family-systems',
  },
]);

export const CANON_CLUSTERS: readonly { heading: string; body: string }[] = [
  {
    heading: '**The canon sorts into four ways in — plus the three already run deep above.**',
    body: '',
  },
  {
    heading: '*The calibration gate — Existential, Feminist.*',
    body: 'These two barely fit “recalibrate a false prior,” which is exactly why they matter. Existential insists many priors are *true* — you don’t falsify death, you re-author the meaning around it. Feminist insists the pathogen is often the floor-8 substrate, not the person — the institutional form of *check the field before treating the prior*. Together they are the framework’s conscience: not every prior is a distortion, and the world does much of the work.',
  },
  {
    heading: '*The valve that is also the evidence — Person-Centered.*',
    body: 'Rogers’ conditions are the common-factors spine the whole paper leans on: the safety that lets errors already arriving finally count. But the account stops short if it stops there. When the stuck prior is itself relational — what closeness costs, what happens when you need something — the therapist’s regard is not only the channel. A person over time is the only evidence that bears on such a prior, and regard that was free to drop and did not is the error itself. One object fills both roles, which is what Rogers was reporting when he called the conditions necessary *and sufficient*: sufficient for the priors his caseload was full of, and not for a contamination prior or a bodily one. That also relocates where it fails. Not “no aimed error” — *only comfortable*. A regard never at risk teaches a floor-4 prior nothing.',
  },
  {
    heading: '*Active inference, said in plain language — Adlerian, Reality Therapy.*',
    body: 'Both picture a person acting to make the world match a wanted-model, and both locate change in self-evaluating the gap. Adler’s “style of life” is a generative model and his “social interest” is the sociometer; Glasser’s “quality world” is a bundle of goal-priors and his self-evaluation question is MI’s develop-discrepancy without the Rogerian wrapper. They described the engine decades before the vocabulary existed.',
  },
  {
    heading: '*Reaching the concrete floors by enactment — Gestalt, Family Systems.*',
    body: 'Neither works by talking about the problem. Gestalt’s empty chair reactivates a floor-6 emotion live — the direct ancestor of EFT’s reconsolidation move — and Family Systems is the furnace scaled to a network, where the confirming evidence is manufactured by *other people*, which is precisely why individual insight can’t reach it and you have to change the loop.',
  },
  {
    heading: '*Working the story — Postmodern (SFBT & Narrative).*',
    body: 'These formalize the fight against one specific furnace move, the *filter*. A problem-saturated story throws away every exception; SFBT and Narrative systematically hunt that discarded disconfirming evidence — exceptions, unique outcomes — and re-weight it. Narrative’s externalizing (“the problem is the problem; the person is not the problem”) is ACT defusion performed at the level of identity.',
  },
  {
    heading: '*Already run deep above — Psychoanalytic, Behavior, CBT.*',
    body: 'Corey’s Chapter 4 is the [[#Psychodynamic & EFT — the relational and emotional floors|Psychodynamic & EFT]] section; Chapter 9 Behavior is the pure prediction-error engine sitting inside [[#CBT — the clean case|CBT]] (exposure without the content layer); Chapter 10 CBT is that same [[#CBT — the clean case|CBT]] section. They pin the historical canon to the six workhorses — same machinery, older names.',
  },
  {
    heading: '',
    body: 'Beyond both lists, the modern process modalities — IFS, MBCT, somatic and sensorimotor work — map the same way through the floor→family column of the [[Decision Aid — Locating the Floor]].',
  },
];

export const CANON_UP_CLOSE_HEADING = 'The canon approaches, up close';
export const CANON_UP_CLOSE_INTRO =
  'Five of the eleven earn the full treatment the core six get, because they are genuinely technique-rich *and* their techniques map cleanly onto the levers. Gestalt and Family Systems reach floors talk can’t, by enactment. Adlerian, the two Postmodern approaches, and Reality Therapy each formalize one lever — a prediction-error experiment, a reversal of the filter, a self-generated discrepancy. (The remaining entries are either already deep above — Psychoanalytic, Behavior, CBT — or, like Person-Centered and Existential, deliberately *not* technique-driven, where a technique table would misrepresent the method — for those two the relationship and the stance *are* the method, which is precisely why the table fails them; both are mapped in the clusters above.)';

// ---------------------------------------------------------------------------
// closing caveats — rendered verbatim
// ---------------------------------------------------------------------------

export const CLOSING_CALLOUTS: readonly Callout[] = z.array(calloutSchema).parse([
  {
    kind: 'warning',
    title: 'The thesaurus trap — how to use this without falling in',
    body: [
      'This note re-describes what the modalities do; it does **not** claim their own theories are wrong, or that they reduce to this vocabulary. Convergence is at the level of *practice*, not theory — the point is corroboration, not takeover. Use the columns to cross-train and to troubleshoot a stall, never to argue a colleague out of their model. And hold the discipline the paper insists on: **families, not brands.** The rows name where each tradition’s *signature move* lands, not the boundary of the therapy — cross floors freely, and norm every move to the client’s culture (floor 8).',
    ],
  },
  {
    kind: 'note',
    title: 'Limits',
    body: [
      'A conceptual and troubleshooting aid, not a treatment manual or an evidence review. Every mechanism claim here is a *candidate* re-description; some — EMDR especially — sit on open scientific debates. It presumes the gates in the [[Decision Aid — Locating the Floor]] have been cleared — acute risk, the reversed dial (psychosis/mania), and the calibration check — before any of it is used. Diagnosis, risk judgment, and standard of care are unchanged. See boundaries in [[A Unified Clinical Model of Psychotherapy]] Part 7.',
    ],
  },
]);

/** A modality's home floors rendered back as the source's own string. */
export const homeFloorsText = (row: { homeFloors: HomeFloorSegment[]; homeFloorsSeparator: string }): string =>
  row.homeFloors.map((s) => s.text).join(row.homeFloorsSeparator);

export interface ModalityAtFloor {
  modality: string;
  table: 'The core six' | 'The counseling-theories canon';
  /** The segment's own text, so "4 (at system scale)" keeps its qualifier. */
  as: string;
  section?: string;
}

/**
 * Which modalities name this floor among their home floors. Derived from the
 * two summary tables — never listed by hand, so it cannot drift from them.
 */
export function modalitiesForFloor(n: number): ModalityAtFloor[] {
  const out: ModalityAtFloor[] = [];
  for (const r of CORE_SIX) {
    for (const s of r.homeFloors) {
      if (s.floors.includes(n)) {
        out.push({ modality: r.modality, table: 'The core six', as: s.text, ...(r.section ? { section: r.section } : {}) });
      }
    }
  }
  for (const r of CANON) {
    for (const s of r.homeFloors) {
      if (s.floors.includes(n)) {
        out.push({
          modality: r.modality,
          table: 'The counseling-theories canon',
          as: s.text,
          ...(r.section ? { section: r.section } : {}),
        });
      }
    }
  }
  return out;
}

export const SEE_ALSO =
  '*See also: [[A Unified Clinical Model of Psychotherapy]] · [[Case Formulation — One Page]] · [[Decision Aid — Locating the Floor]] · [[Decision Map — Locating the Floor]] · [[Clinical Applications — Status, Mattering, and Rank]].*';

// ---------------------------------------------------------------------------
// The stack view of this module
//
// The training stack (docs/theory/tools/training-stack.md) needs one row per
// modality with the floors it reaches. That is exactly the home-floors column
// above, so it is derived here rather than retyped: this module is the single
// source for modality slugs and home floors, and @ledger/shared takes the
// result as an argument so it never has to hold a second copy.
//
// Ranges and qualifiers are preserved as floorsIn() reads them: "6–7" reaches
// both, and "conditions" / "change process" reach no floor at all — those are
// the dimmer layer, shown under the building rather than on it.
// ---------------------------------------------------------------------------

/** Qualifiers that reach no floor. `stakes` names a payoff, not a layer. */
const DIMMER_TOKENS: readonly FloorToken[] = ['conditions', 'change process'];

/** "**Choice Theory / Reality (11)**" → "Choice Theory / Reality". */
const plainName = (label: string): string =>
  label
    .replace(/\*\*/g, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .trim();

/** A stable id. The section anchor where the module has one, else the name. */
const slugFor = (label: string, section?: string): string =>
  section ??
  plainName(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export interface StackModalityRow {
  slug: string;
  name: string;
  floors: number[];
  dimmer: boolean;
  /** What it pulls, from the source's own column. */
  lever: string;
}

function fold(
  rows: readonly { modality: string; primaryLever: string; homeFloors: readonly HomeFloorSegment[]; section?: string }[],
  into: Map<string, StackModalityRow>,
): void {
  for (const r of rows) {
    const slug = slugFor(r.modality, r.section);
    const floors = r.homeFloors.flatMap((h) => h.floors);
    const dimmer = r.homeFloors.some((h) => h.token !== undefined && DIMMER_TOKENS.includes(h.token));
    const seen = into.get(slug);
    if (seen) {
      // Two rows, one modality — the core-six table and the canon table both
      // carry Psychodynamic/EFT. Union the floors rather than picking a table.
      for (const f of floors) if (!seen.floors.includes(f)) seen.floors.push(f);
      seen.floors.sort((a, b) => a - b);
      seen.dimmer ||= dimmer;
      continue;
    }
    into.set(slug, {
      slug,
      name: plainName(r.modality),
      floors: [...new Set(floors)].sort((a, b) => a - b),
      dimmer,
      lever: r.primaryLever,
    });
  }
}

/** Every modality in this module, as the stack sees it. Order: core six, then the canon. */
export const STACK_MODALITIES: readonly StackModalityRow[] = (() => {
  const out = new Map<string, StackModalityRow>();
  fold(CORE_SIX, out);
  fold(CANON, out);
  return [...out.values()];
})();

export const STACK_MODALITY_SLUGS: readonly string[] = STACK_MODALITIES.map((m) => m.slug);
