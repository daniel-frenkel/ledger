/**
 * The per-modality sections of docs/theory/modalities.md: core logic, the
 * technique tables, the inline callouts, and "What PP adds".
 *
 * Split out of modalities.ts only for readability — it is the same document and
 * the same rules. Every string is the source's, including its inline markdown
 * and [[wikilinks]]. The "when it fails" column is carried in full; nothing in
 * it is abbreviated.
 */
import { z } from 'zod';
import { calloutSchema, modalitySectionSchema, floorsIn, type Callout, type ModalitySection, type Technique } from './modalities';

const t = (technique: string, lever: string, floorText: string, whenItFails: string): Technique => ({
  technique,
  lever,
  floorText,
  floors: floorsIn(floorText),
  whenItFails,
});

const CBT_I: ModalitySection = {
  slug: 'cbt-i',
  heading: 'CBT-I — the worked case: one protocol, every lever',
  coreLogic: [
    '**Core logic in PP.** Chronic insomnia is the frame’s cleanest everyday demonstration, because the perpetuating machinery is almost never the beliefs. Conditioned arousal — the bed itself now a cue for wakefulness — is a floor-5/6 prior firing before thought. The catastrophic sleep beliefs run as *forecasts* that generate the arousal they predict (floor 3). Hypervigilant monitoring — clock-watching, body-scanning for sleep — is precision misallocated, amplifying exactly what it checks. And sleep effort is the master furnace move: naps, early bedtimes, hours awake in bed, all manufacturing the confirming evidence nightly. CBT-I unbundles into the levers almost without remainder — and sleep cannot be placed under full voluntary control, so that effort under load becomes counterproductive, which the frame reads as the same law the mattering gauge runs on: effort is the interference, not the instrument.',
  ],
  techniques: [
    t(
      'Sleep restriction',
      'Prediction error, *engineered* — compress time in bed until homeostatic pressure forces fast onset; "I cannot sleep" meets an undeniable miss the client’s own body produced',
      '5–6',
      'The first-week dip goes unnamed: worse-before-better reads as proof of failure and the client bails exactly as the mechanism engages. Predict the dip in writing — the extinction-burst rule. Also fails against unscreened biology (apnea, restless legs, circadian disorder): wrong organ.',
    ),
    t(
      'Stimulus control',
      'Furnace-interrupt + path-shaping — out of bed when awake, bed only for sleep; blocks the nightly manufacture of *bed = wakefulness*',
      '5–6',
      'Half-run: the client stays in bed “resting,” and pays the old association on an intermittent schedule — the most durable schedule there is.',
    ),
    t(
      'Cognitive restructuring of sleep beliefs',
      'Content + precision on the catastrophic forecast (“tomorrow is ruined”)',
      '3',
      'Accurate insight that changes nothing: the arousal is conditioned, not believed into being, and the bed keeps teaching the body while the words work the wrong floor.',
    ),
    t(
      'Paradoxical intention',
      'Precision — deflate the goal-prior itself; drop sleep effort, since trying produces the arousal that prevents the state',
      '2 / the goal',
      'Run as a trick: covert effort wearing surrender’s costume — the client tries to not-try and monitors whether it’s working, which is the monitoring again.',
    ),
    t(
      'Relaxation / mindfulness-based variants',
      'Precision down on the monitoring channel — body-scanning and clock-watching',
      '2 / 7',
      'Becomes another performance with a score.',
    ),
  ],
  whatPPAdds: [
    '**What PP adds.** A structure over the package’s own ingredients — the conditioned association and the furnace carry the disorder, at floors five and six, while the component literature refuses to rank the ingredients the way intuition expects: what reliably fails alone is sleep hygiene, not belief work, and the two largest component analyses disagree outright on the belief work’s weight. A name for its modern failure mode: orthosomnia, the tracked and optimized sleeper — the cure become the wall; if the client turns hygiene into a system, that is not diligence, it is the finding. And the gates, applied before any of it: screen the biology first, and check calibration — the newborn, the shift work, the unsafe housing are an environment being accurately read, not a prior to loosen. Fix the field, or name the season, before running experiments at a body that is answering its world correctly.',
  ],
  callouts: [],
  subsections: [],
};

const ACT_CALLOUT: Callout = calloutSchema.parse({
  kind: 'warning',
  title: 'Where ACT resists the frame — and why that makes it the strongest case',
  body: [
    'ACT does not rest on neuroscience; it rests on *functional contextualism*, a philosophy of science that asks of a thought not “is it true?” but “what is it doing?” — and treats the first question as the trap. On that view a thought is a *behavior* to be understood by its context and history, never an inner representation to be graded for accuracy. So ACT’s own philosophy **rejects the representational framing predictive processing assumes**: it will not grant that a prior is a claim *about* the world carrying a precision weight, and it holds that chasing a thought’s content is precisely what keeps clients stuck. The remarkable thing is that the two still prescribe the identical move in the room — change your *relationship* to the thought, not its truth value (PP: precision-down; ACT: defusion). When even a framework built to refuse your metaphysics performs your moves, that isn’t relabeling; it’s two independent excavations striking the same structure — the strongest corroboration in this note, precisely *because* the theoretical agreement is absent. *(Honest complication for a sharp room: this describes* orthodox *PP. An enactivist wing — Hutto, Bruineberg, Kiverstein — reads active inference without robust representations, and on that reading the gap to functional contextualism nearly closes.)*',
  ],
});

const EMDR_CALLOUT: Callout = calloutSchema.parse({
  kind: 'note',
  title: 'Honest about mechanism',
  body: [
    'EMDR’s *outcomes* are well supported; its *mechanism* is genuinely contested — working-memory taxation, a REM-like reconsolidation process, and plain exposure are all live candidates, and several dismantling studies find the eye-movement component adds little over exposure alone. Predictive processing offers the reconsolidation reading as a *candidate* that places EMDR in the same family as EFT; it does not settle whether the bilateral stimulation is doing the lifting.',
  ],
});

export const MODALITY_SECTIONS: readonly ModalitySection[] = z.array(modalitySectionSchema).parse([
  {
    slug: 'cbt',
    heading: 'CBT — the clean case',
    coreLogic: [
      '**Core logic in PP.** CBT is the modality predictive processing describes most transparently, because it does openly what the frame says every therapy does covertly: it revises the *content* of a prior (floor 3) and engineers a real *prediction error* (floors 3 and 5). Restructuring goes at the claim; behavioral experiments and exposure go at the evidence.',
    ],
    techniques: [
      t(
        'Thought record / cognitive restructuring',
        'Content + precision — surface the claim, widen the evidence base, loosen confidence',
        '3',
        'The belief is held *below* the words — “I know it’s not true and I still feel it.” Accurate insight that changes nothing means a floor-3 tool aimed at a floor-6/7 prior. Also fails when the prior is **calibrated** — the evidence really does support the fear.',
      ),
      t(
        'Behavioral experiment',
        'Prediction error — turn the belief into a falsifiable prediction, run it, compare',
        '3 / 5',
        'The **furnace** manufactures the outcome: the client runs the test but provokes, filters, or withdraws effort so it confirms the fear. Or the worst case isn’t survivable, so they (rightly) won’t run it.',
      ),
      t(
        'Graded exposure',
        'Prediction error + furnace-interrupt (blocks avoidance)',
        '5',
        '**Safety behaviors left in place.** The disconfirmation gets credited to the safety behavior — “I only got through it because I gripped the rail” — so the prior never takes the hit.',
      ),
      t(
        'Behavioral activation',
        'Prediction error against “nothing helps / I can’t feel good” + feeds the mattering input stream',
        '3 / 5',
        'In status-injury depression it can be metabolized as *more failed striving* — one more climb the world doesn’t reward. Privatizes a structural loss; pair with the mattering moves in [[Clinical Applications — Status, Mattering, and Rank]].',
      ),
    ],
    whatPPAdds: [
      '**What PP adds.** A diagnosis for the bounce. When a clean, correct thought record changes nothing, CBT’s own manual tends to say *do it again, better*; the frame says *you have the wrong floor* — stop feeding evidence to a level that isn’t listening and change channels. It also reframes exposure’s mechanism from habituation to expectancy-violation (a move CBT’s own science made independently), which tells you the load-bearing steps are the *written* prediction and the *blocked* safety behavior — not the dwell time.',
    ],
    callouts: [],
    subsections: [CBT_I],
  },
  {
    slug: 'act',
    heading: 'ACT — the hard case',
    coreLogic: [
      '**Core logic in PP.** ACT is the sharp case because it does *not* revise prior content at all. It works two other levers. Defusion drops the **precision** on a thought-as-literal-fact (floor 2). Acceptance interrupts the **furnace’s** avoid-move — the struggle *against* an internal experience — and in doing so updates a second-order prior, *I can’t survive this feeling*. Values and committed action install a high-level prior (a chosen direction) that gives the predictions below it something to reorganize around. It is the whole engine run *without ever touching the belief’s content* — which is exactly why it reaches priors CBT can’t.',
    ],
    techniques: [
      t(
        'Cognitive defusion (“I’m having the thought that…”, naming the mind)',
        'Precision — strip the weight off the thought as literal truth',
        '2',
        'Used on a thought whose *content* is false and the situation fixable — defusing from a true, actionable signal becomes spiritualized avoidance. The dividing line: defusion for the *calibrated* prior, restructuring for the *false* one.',
      ),
      t(
        'Acceptance / willingness',
        'Furnace-interrupt (ends experiential avoidance) + updates the meta-prior “I can’t survive this feeling”',
        '6–7 + meta',
        'Misapplied to the *situation* instead of the *internal experience* — a client “accepting” a harmful environment that should be changed. Acceptance is of the feeling, never of the abuse.',
      ),
      t(
        'Values clarification',
        'Installs a high-level prior (a chosen direction) that reorganizes what sits below it',
        '1 / top-down',
        'Floated over an unregulated body or acute risk — you cannot values-clarify through a flashback. Regulate floor 7 first.',
      ),
      t(
        'Committed action',
        'Prediction error — act *while* predicting you can’t function with the feeling present; the prediction gets violated',
        '5',
        'Same boundary as exposure: if the feeling is a true signal of real threat, overriding it is miscalibration, not courage.',
      ),
    ],
    whatPPAdds: [
      '**What PP adds.** For the clinician it explains *why* defusion works with no argument about the thought’s truth — it moves precision, not content — and *why* acceptance is curative rather than merely soothing: it interrupts the avoid-move and updates the meta-prior that the feeling is unsurvivable. That yields a placement rule ACT states as philosophy and PP states as mechanics: **ACT is the tool for the true or calibrated prior; CBT for the false one.** The calibration gate in [[A Unified Clinical Model of Psychotherapy]] Part 2.2 is where you decide which you’re facing.',
    ],
    callouts: [ACT_CALLOUT],
    subsections: [],
  },
  {
    slug: 'dbt',
    heading: 'DBT — precision management for a hot valve',
    coreLogic: [
      '**Core logic in PP.** Emotion dysregulation is, in these terms, a system whose *precision estimation itself* runs hot — affective and threat signals arrive over-weighted and swamp everything else. DBT is built to get precision back under control long enough for anything else to land. Distress tolerance turns runaway precision *down*; the skills install new **scripts** (floor 5); and the central dialectic — radical acceptance *and* change — is the **valve** and the **error** held in the same hand.',
    ],
    techniques: [
      t(
        'Distress tolerance (TIP skills, crisis-survival, self-soothe, distraction)',
        'Precision — rapidly down-regulate an over-weighted affective signal so it stops dominating',
        '7',
        'Turned into a life strategy rather than a crisis tool, it *becomes* the furnace’s avoid-move — the client never stays with a state long enough for a prior to update. DBT knows this: distress tolerance buys time, it doesn’t treat.',
      ),
      t(
        'Check the facts',
        'Content + the calibration gate — is the emotion justified by the facts?',
        '3',
        '*(The failure-catcher, not a failure site.)* DBT’s own version of the calibration check — the discipline the whole model puts first.',
      ),
      t(
        'Opposite action',
        'Prediction error + furnace-interrupt — act opposite to an *unjustified* emotion’s urge',
        '3 / 5',
        'Applied to a *justified* emotion. DBT builds the guard in: check the facts *first*; opposite action is only for emotions that don’t fit them.',
      ),
      t(
        'Interpersonal effectiveness (DEAR MAN, etc.)',
        'New script + tests the relational prior “if I ask, I’ll be rejected”',
        '5 / 4',
        'The real driver is the floor-4 template, not the missing skill. A script laid over an unexamined attachment prior gets deployed, the furnace re-provokes the feared response, and the skill “doesn’t work.”',
      ),
      t(
        'Dialectics (acceptance + change)',
        'Valve + error together — validation opens the valve, skills deliver the change',
        'conditions',
        'Either half alone. Validation without change is comfort that doesn’t move; change without validation slams the valve shut. The dialectic *is* the rule PP states as “no error lands through a closed valve.”',
      ),
    ],
    whatPPAdds: [
      '**What PP adds.** It says why the two wings of DBT are not a stylistic balance but a mechanical necessity: validation lowers precision on threat so the room is safe enough for a signal to count, and only then can a skill deliver the error or install the script. And it locates distress tolerance precisely — precision management, not cure — which predicts its exact failure mode when overused.',
    ],
    callouts: [],
    subsections: [],
  },
  {
    slug: 'psychodynamic-eft',
    heading: 'Psychodynamic & EFT — the relational and emotional floors',
    coreLogic: [
      '**Core logic in PP.** These traditions work the floors words can’t reach on their own: the **relational template** (floor 4, the internal working model) and the **consolidated emotional prior** (floor 6). Their shared active ingredient is the *corrective emotional experience* — a real, unmanufactured relational prediction error delivered live inside the alliance — and, in EFT, **reconsolidation**: making an old emotional prior briefly labile and updating it in the presence of a new attachment response.',
    ],
    techniques: [
      t(
        'Transference / here-and-now work',
        'Prediction error at floor 4 — the template predicts the therapist will judge, control, or leave; the therapist doesn’t, and the error lands *live*',
        '4',
        'Intellectualized. Insight *about* the transference is floor-1 words about a floor-4 prior — accurate and inert. The mutative version is emotional, not intellectual, insight.',
      ),
      t(
        'Genetic interpretation (linking past to present)',
        'Content / narrative — reorganize the origin story',
        '1–3',
        'The textbook “accurate insight that changes nothing” when delivered as explanation without the live relational error. PP’s clearest correction to classical technique.',
      ),
      t(
        'EFT: evoking and deepening primary emotion',
        'Reconsolidation — reactivate the floor-6 prior (the grief or fear under the reactive anger) so it goes labile',
        '6 / 4',
        'Evoked *without* a genuinely new response present — it just re-runs the old emotion and can re-traumatize. The disconfirming outcome has to be there at the moment of lability.',
      ),
      t(
        'EFT: restructuring the negative cycle (couples)',
        'Furnace-interrupt at the dyadic level + new prediction error — the pursue–withdraw cycle *is* each partner manufacturing the other’s feared response',
        '4 / 5',
        'One partner’s prior too high-precision to register the new bid; or safety not yet built (valve shut). De-escalate before restructuring.',
      ),
    ],
    whatPPAdds: [
      '**What PP adds.** It explains the field’s oldest hard-won lesson in one sentence: *emotional* insight heals and *intellectual* insight doesn’t, because intellectual insight edits floor-1 words while the prior sits at floor 4 or 6 — and a floor-4/6 prior updates only when a real, unmanufactured relational error reaches its own level, which requires the emotion to be *live* at the moment the new outcome arrives. That is the reconsolidation timing rule EFT found empirically and PP states mechanically.',
    ],
    callouts: [],
    subsections: [],
  },
  {
    slug: 'emdr',
    heading: 'EMDR — reopening a consolidated prior',
    coreLogic: [
      '**Core logic in PP.** EMDR targets a floor-6 prior held at maximum precision — the traumatic memory network — and appears to work by *destabilizing* it (reactivation plus a dual-attention task that taxes working memory) so it re-stores with less charge: a **reconsolidation** account.',
    ],
    techniques: [
      t(
        'Reactivate target + dual-attention (bilateral) stimulation',
        'Reconsolidation — reactivation makes the floor-6 prior labile; the dual task degrades its vividness and affective charge so it re-stores at lower precision',
        '6',
        'Run outside a stable-enough window — without dual awareness it’s reliving, not updating, and can re-traumatize. Dissociation and ongoing (calibrated) danger are contraindications.',
      ),
      t(
        'Installation of the positive cognition',
        'Content — pair the desensitized memory with an adaptive belief',
        '6 → 3',
        'Attempted *before* desensitization. Installing a positive cognition over a still-high-precision trauma prior is the “telling them they’re safe” failure — words weighted at zero. Sequence is non-negotiable: precision down first, content second.',
      ),
    ],
    whatPPAdds: [
      '**What PP adds.** It puts EMDR and EFT in one family — reactivate, destabilize, update — and explains why exposure sometimes needs a destabilizer to move a maximally consolidated prior. And it names the boundary the mechanism implies: dual awareness required, ongoing or calibrated danger a stop.',
    ],
    callouts: [EMDR_CALLOUT],
    subsections: [],
  },
  {
    slug: 'motivational-interviewing',
    heading: 'Motivational Interviewing — precision at the level of change itself',
    coreLogic: [
      '**Core logic in PP.** MI is the odd one out: its target isn’t a specific prior but the *process of changing one at all*. Ambivalence is two priors — status quo and change — held at similar precision. MI shifts the weight toward change without supplying any content, and it does so while protecting the **valve**, because the moment the therapist supplies the argument, the client’s **furnace** provokes the counter-argument and they talk themselves *out* of it (the “righting reflex”).',
    ],
    techniques: [
      t(
        'Evoking change talk',
        'Precision — raise the weight on the client’s *own* change-prior by having them voice it; self-generated evidence outweighs the therapist’s identical point',
        '1–3',
        'No real ambivalence — pure precontemplation, or a calibrated reason not to change. MI can’t manufacture a value that isn’t there.',
      ),
      t(
        'Rolling with resistance / dropping the righting reflex',
        'Furnace-interrupt + valve-protection — don’t hand the client the argument their furnace can push against',
        'conditions',
        'When real information or harm-reduction is genuinely needed and pure reflection withholds it. MI is a stance, not a gag order.',
      ),
      t(
        'Developing discrepancy',
        'Prediction error at the narrative floor — the client’s own “I’m a good father” meets “and I’m doing this,” a self-generated mismatch',
        '1',
        'When it lands as shame rather than motivation: the valve slams shut and the furnace defends. Amplify the client’s values, don’t prosecute them.',
      ),
    ],
    whatPPAdds: [
      '**What PP adds.** MI is the cleanest demonstration that *who supplies the evidence* is itself a precision variable — the client’s own change-talk is weighted higher than the therapist’s word-for-word identical argument — and that the righting reflex fails for a mechanical reason: argue for X and you fire the furnace that provokes not-X. It shows the valve operating over the whole arc of change, not just a single belief.',
    ],
    callouts: [],
    subsections: [],
  },
  {
    slug: 'gestalt',
    heading: 'Gestalt — error delivered to the body',
    coreLogic: [
      '**Core logic in PP.** Gestalt reaches the concrete floors (6–7) and present-moment awareness (2) that talk can’t, by *enacting* the frozen material instead of discussing it. “Unfinished business” is an emotional prior (floor 6) whose update was interrupted and never completed — a prediction error frozen mid-flight. The contact-boundary disturbances (introjection, projection, retroflection, deflection, confluence) are the furnace’s avoid-move working in real time at the boundary between self and world. The method brings the frozen material *live* into the room, makes it labile, and lets a new completion land as an unmanufactured error — in the body, now.',
    ],
    techniques: [
      t(
        'Empty-chair (unfinished business with an absent figure)',
        'Reconsolidation — reactivate the frozen floor-6 emotion live and let a new completion land as real error',
        '6 / 4',
        'Run as role-play performance without genuine affective arousal — the prior never goes labile, so nothing updates. The emotion has to be *present*, not described.',
      ),
      t(
        'Two-chair (a self-conflict or polarity; top-dog / under-dog)',
        'Furnace-interrupt + precision — externalize an internal split so the suppressed side is contacted instead of avoided',
        '2 / 6',
        'With a fragile or dysregulated client it floods (floor 7 overwhelmed); titrate and build safety first, or it re-traumatizes.',
      ),
      t(
        'Staying-with / “the safe emergency” (block the escape from a feeling)',
        'Furnace-interrupt (blocks the avoid-move) — hold contact with the aversive experience until the interoceptive error lands',
        '6–7',
        'Held past the window of tolerance it becomes exposure without safety — precision on threat spikes and the valve slams.',
      ),
      t(
        'Present-moment awareness (“what are you aware of now?”)',
        'Precision — shift weight off the narrated story onto live bottom-up experience',
        '2 / 7',
        'Becomes an intellectual report *about* awareness (floor 1) rather than contact; the client narrates instead of feeling. Redirect to the body.',
      ),
      t(
        'Exaggeration / repetition of a gesture or phrase',
        'Precision — amplify a faint bottom-up signal until it crosses into awareness and becomes figure',
        '7 → 2',
        'Amplifies a signal the client can’t yet hold, or turns theatrical and disconnects from real affect.',
      ),
    ],
    whatPPAdds: [
      '**What PP adds.** Gestalt’s founding intuition — the *paradoxical theory of change*, that you change by fully contacting what you are, not by forcing what you’re not — is precision language without the math. “Trying to change” is usually the furnace: a top-down wanted-prior dominating and manufacturing its own resistance. Dropping into full contact turns that precision *down* and lets the bottom-up present signal — the frozen emotion, the felt sense — finally carry weight and complete its interrupted update. That is why Gestalt reaches what talk can’t: it delivers error to floors 6–7 directly, in the body, by enactment. And it is why the power is also the hazard — a live floor-6 reactivation with the valve shut is re-traumatization, which is why titration and safety are not optional here.',
    ],
    callouts: [],
    subsections: [],
  },
  {
    slug: 'family-systems',
    heading: 'Family Systems — the furnace in more than one head',
    coreLogic: [
      '**Core logic in PP.** The unit of prediction is the *system*, not the person. The symptom is held in place by a multi-person feedback loop (homeostasis): each member’s prior predicts the others’ behavior and acts to confirm it, so the family is a network of interlocking furnaces manufacturing each other’s evidence. The “identified patient” carries a symptom that is functional for the system’s equilibrium — which is exactly why individual insight so often can’t move it: the confirming evidence is supplied by *other people*, continuously, in real time. You have to change the loop.',
    ],
    techniques: [
      t(
        'Genogram (Bowen)',
        'Read the multigenerational floor-4 priors — the templates transmitted across generations',
        '4 (across generations)',
        'Stays diagnostic: a map with no change move, insight the system’s live furnace keeps overriding.',
      ),
      t(
        'Enactment (structural, Minuchin)',
        'Prediction error at system level — run the problem sequence live, interrupt it, introduce a new outcome in the room',
        '4 / 5',
        'The dominant member’s prior too high-precision to register the new sequence; or the therapist doesn’t actually block the old move, and the furnace completes.',
      ),
      t(
        'Boundary restructuring (structural)',
        'Precision — re-set the weighting across a boundary (enmeshment = precision too high, disengagement = too low)',
        '4',
        'Attempted without *joining* first — the homeostatic furnace expels the therapist before the new structure holds.',
      ),
      t(
        'Detriangulation (Bowen)',
        'Furnace-interrupt — remove the third party absorbing a dyad’s error so the dyad finally has to metabolize it',
        '4',
        'Pulling the triangle too fast floods the dyad (no containment); differentiation and safety come first.',
      ),
      t(
        'Reframing / relabeling (strategic, Satir)',
        'Precision + narrative — change the meaning the loop depends on so it loses its grip',
        '1 / 4',
        'A clever reframe the family doesn’t *feel* is just words; it has to fit their experience or the old meaning snaps back.',
      ),
      t(
        'Prescribing the symptom / paradox (strategic, MRI)',
        'Furnace-interrupt — make the symptom deliberate so it can no longer serve its involuntary system-confirming function',
        '5',
        'Used as a trick rather than from a real systemic formulation; it misfires and costs trust. Not for high-risk symptoms.',
      ),
    ],
    whatPPAdds: [
      '**What PP adds.** It says precisely why individual work so often can’t move a family-maintained symptom: the confirming evidence is manufactured by *other people in the system*, continuously, so the client’s own furnace was never the whole engine — the network is. Family systems is the furnace scaled from one head to a relational web, and its interventions are furnace-interrupts and prediction errors delivered at the level of the loop — enactment, detriangulation, boundary-making, prescribing the symptom. It also reframes Bowen’s *differentiation of self* in a single line: the capacity to hold your own prior’s precision under the pressure of a high-precision shared emotional field — which is why the differentiated member can change the whole system simply by refusing to supply their scripted move.',
    ],
    callouts: [],
    subsections: [],
  },
  {
    slug: 'adlerian',
    heading: 'Adlerian — testing the style of life',
    coreLogic: [
      '**Core logic in PP.** The “style of life” is a high-level generative model laid down in childhood — a single, self-authored strategy for how to belong and matter, organized around an imagined final goal (“fictional finalism”). “Private logic” is the set of rules that model runs on. Symptoms are *safeguarding* moves — the furnace protecting the style of life and the self-image it defends. The engine is teleological: a felt gap between where you are and the imagined goal (Adler’s “inferiority feeling” driving the “striving for significance”) pulls compensating action — which is active inference, behavior working to close the distance between a wanted-prior and the perceived present. Health, for Adler, is *social interest*: feeling connected to and useful to others — the sociometer reading well.',
    ],
    techniques: [
      t(
        'Early recollections (lifestyle assessment)',
        'Read the narrative prior — early memories are *selected* to fit the present style of life, so they reveal the generative model and its private logic',
        '1',
        'Treated as literal history rather than a present-day projection; or gathered thoroughly and never converted into a change (assessment with no reorientation).',
      ),
      t(
        '“The Question” (“what would be different if you were well?”)',
        'Functional analysis — surfaces the symptom’s purpose, the furnace move it’s quietly running',
        '1 / stakes',
        'Read as a gotcha, it shames; and a truly organic problem can answer “nothing” — don’t over-interpret it.',
      ),
      t(
        'Encouragement',
        'Precision / valve — raise a discouraged prior’s confidence just enough to risk a real test',
        'conditions / 1',
        'Cheerleading untied to an achievable action becomes empty praise; encouragement is courage to *act*, not compliments.',
      ),
      t(
        '“Acting as if”',
        'Prediction error — act as the person you’d be if the belief were false, and let the disconfirming evidence land',
        '5 / 1',
        'Framed as pretending rather than an experiment with a written prediction; or pitched above the client’s courage, guaranteeing the failure. Start small.',
      ),
      t(
        '“Spitting in the soup”',
        'Furnace-interrupt — name the hidden payoff so the move can no longer run unseen',
        '1 / stakes',
        'Delivered before the alliance can hold it, it’s an accusation; offer the payoff as a guess, not a verdict.',
      ),
      t(
        '“Catching oneself”',
        'Metacognition — the client learns to spot the furnace move as it begins',
        '2',
        'Stays intellectual — noticing with no replacement action; pair it with “acting as if.”',
      ),
    ],
    whatPPAdds: [
      '**What PP adds.** Adler drew the engine before the vocabulary existed: his “style of life” is a generative model, his “fictional finalism” a high-level prior that organizes everything beneath it, his “safeguarding tendencies” are furnace moves, and his “social interest” is the sociometer. What the frame adds is the *why* under his best technique. “Acting as if” works not because pretending is powerful but because it is a prediction-error experiment — it puts the client in the one spot the style of life can be disconfirmed, doing the thing the private logic says they can’t, and lets the outcome count. And it explains “spitting in the soup” in a line: a furnace move survives only while it runs unseen, so naming the payoff out loud is what disables it — the same logic as Family Systems’ “prescribing the symptom,” scaled down to one person.',
    ],
    callouts: [],
    subsections: [],
  },
  {
    slug: 'postmodern',
    heading: 'Postmodern (SFBT & Narrative) — reversing the filter',
    coreLogic: [
      '**Core logic in PP.** The postmodern approaches start from a different place: there is no single objective prior to correct, because the “problem” is itself a construction — a dominant story about a life — and change comes from building a different one. In these terms both Solution-Focused Brief Therapy and Narrative Therapy work floors 1 (the story) and 2 (your relation to it), and their signature move is a precision maneuver aimed at one furnace move in particular — the *filter*. A problem-saturated story throws away every moment that doesn’t fit; these approaches go hunting for exactly that discarded evidence and make it count.',
    ],
    techniques: [
      t(
        'Miracle question (SFBT)',
        'Installs a vivid, high-precision future-prior (a goal-state) that reorganizes attention and action — and surfaces exceptions already present',
        '1',
        'A vivid future with no small first step built toward it is a wish, not a plan; anchor it to the next concrete sign.',
      ),
      t(
        'Exception & coping questions (SFBT)',
        'Precision — hunt the disconfirming evidence the “it’s always like this” filter discards',
        '1 / 2',
        'Mining for exceptions past a client in real crisis reads as dismissive; validate the suffering before hunting exceptions.',
      ),
      t(
        'Scaling questions (SFBT)',
        'Precision calibration + a small, achievable next-error (“what moves you one point?”)',
        '1',
        'Becomes a number game with no behavior attached; the point is the next testable step, not the score.',
      ),
      t(
        'Externalizing (Narrative)',
        'Defusion at the level of identity — drop precision on “I *am* the problem,” making it a thing outside the self',
        '1 / 2',
        'Externalizing a problem that needs ownership (behavior harming others) can dodge responsibility; separate the person from the problem, not from accountability.',
      ),
      t(
        'Unique outcomes → re-authoring (Narrative)',
        'Precision + narrative content — surface the moments the problem-story filtered out, then build the counter-story from them',
        '1',
        'A counter-story pasted over an unregulated concrete floor (6–7) stays words; thin re-authoring without felt evidence doesn’t hold.',
      ),
      t(
        'Deconstruction / outsider-witness practices (Narrative)',
        'Name the floor-8 discourse feeding the story; raise precision on the new story through social witnessing',
        '8 / 1',
        'Intellectual deconstruction that never reaches the felt sense; and witnessing needs a genuinely safe audience or it backfires.',
      ),
    ],
    whatPPAdds: [
      '**What PP adds.** It names what these approaches are doing under the constructionist language: systematically reversing the *filter*. Where CBT argues with the belief’s content, SFBT and Narrative don’t argue at all — they redirect attention to the disconfirming evidence the story has been throwing away, which is a precision move, not a content one. And Narrative’s externalizing turns out to be ACT’s defusion performed at the level of identity: “the problem is the problem; the person is not the problem” is exactly “you are not your thought,” raised from a single cognition to the whole self-story. The caution the frame adds is the one it adds everywhere — a re-authored story that never reaches the concrete floors stays words; the new narrative has to be backed by felt, un-rigged evidence, or the old story snaps back.',
    ],
    callouts: [],
    subsections: [],
  },
  {
    slug: 'reality-therapy',
    heading: 'Reality Therapy — active inference in plain language',
    coreLogic: [
      '**Core logic in PP.** Choice Theory holds that all behavior is chosen to meet five basic needs, and that each of us builds a “quality world” — an internal album of the specific people, things, and beliefs that would satisfy those needs. All behavior is an attempt to close the gap between that wanted-world and what we perceive we are getting. That is active inference stated without the math: the quality world is a set of high-precision goal-priors, and behavior is the action arm trying to make perception match them. Reality Therapy works the present, choice, and responsibility, and its whole engine is self-evaluation — the client judging whether what they are doing is actually getting them what they want.',
    ],
    techniques: [
      t(
        'Exploring wants / the quality world (W)',
        'Read the goal-priors — the specific images of what would meet the need',
        '1',
        'Wants-talk that never reaches evaluation or a plan; exploration with no conversion.',
      ),
      t(
        'Evaluating current doing (D → E: “is what you’re doing getting you what you want?”)',
        'Self-generated prediction error — the client, not the therapist, names the gap between wanted and achieved',
        '1 / 5',
        'If the therapist supplies the verdict, it fires the furnace and the client defends the behavior; the evaluation has to be *theirs*, like MI’s develop-discrepancy.',
      ),
      t(
        'Making a plan (P: simple, achievable, measurable, immediate, committed)',
        'Install a new action-script and a concrete next-error to run',
        '5',
        'A plan too big or vague guarantees failure and reconfirms “I can’t change”; keep it small and immediate.',
      ),
      t(
        'Present focus + responsibility (“no excuses”)',
        'Precision on agency — weight the controllable (acting, thinking) over the felt-helpless (feeling, physiology)',
        '2 / 5',
        'Slides into blame when the environment is genuinely the pathogen; “your choice” is the wrong sentence for a structural injury (the calibration gate governs which you’re facing).',
      ),
    ],
    whatPPAdds: [
      '**What PP adds.** Glasser described the action half of the loop — behavior as the attempt to make perception match a wanted-model — decades before “active inference” had a name, and his central move is the sharpest example of a principle the frame states elsewhere: change lands harder when the person generates the discrepancy themselves. WDEP’s evaluation question is MI’s develop-discrepancy without the Rogerian wrapper — a self-generated prediction error, weighted higher because the client produced it. The one hazard the frame flags is the “responsibility / no excuses” stance: it is precision on agency, exactly right for a stuck-but-workable prior and exactly wrong when the pathogen is the environment — which is precisely what the calibration gate is there to sort.',
    ],
    callouts: [],
    subsections: [],
  },
]);

/** Every section and subsection, flattened — for anchor resolution and tests. */
export const ALL_SECTIONS: readonly ModalitySection[] = MODALITY_SECTIONS.flatMap((s) => [s, ...s.subsections]);

/** Modalities whose home floors include a given floor, from both summary tables. */
export type ModalityRef = { modality: string; table: 'core six' | 'canon'; section?: string | undefined };
