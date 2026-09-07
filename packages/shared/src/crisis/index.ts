/**
 * Crisis detection — hard-coded, deterministic, no language model.
 *
 * Runs on every client entry before anything else (on the phone, offline),
 * and again on the API when the entry syncs. A match shows the resource card
 * and logs a `crisis_events` row carrying rule ids only — never the text.
 *
 * Tuning philosophy: this is a pointer to help, not a classifier. It is
 * deliberately biased toward recall. A false positive costs the user a card
 * they can dismiss; the app never blocks entry, never locks, never phones
 * anyone. Negations ("I don't want to die") are matched on purpose: the
 * sentence still names the thing, and the card is not a judgment.
 *
 * Rule ids are stable identifiers (`R\d\d_snake`). Changing a rule's pattern
 * is a code change reviewed in git; removing a rule id is a breaking change
 * for stored events — retire by leaving the id in RETIRED_RULE_IDS instead.
 */

import { CRISIS_RESOURCES, type CrisisResourceId } from '../vocabulary/index.js';

export type RiskLevel = 'ideation' | 'plan_or_means' | 'self_harm';

export interface CrisisRule {
  id: string;
  level: RiskLevel;
  pattern: RegExp;
  /** Why this rule exists; shown to clinicians in docs, never to clients. */
  note: string;
}

const w = (s: string) => new RegExp(s, 'i');

export const CRISIS_RULES: readonly CrisisRule[] = [
  // --- explicit ideation ------------------------------------------------
  // Each pattern names the self as the object. "killing me" (a headache),
  // "off me" (a wrestling partner), "killed it" are deliberately excluded.
  { id: 'R01_kill_self', level: 'ideation', pattern: w(String.raw`\b(kill|killing|end|ending|off|offing|unalive|unaliving)\s+my\s*self\b|\bkms\b`), note: 'kill / end / off myself; kms' },
  { id: 'R02_suicid', level: 'ideation', pattern: w(String.raw`\bsuicid(e|al|ally)\b`), note: 'the word itself' },
  { id: 'R03_want_to_die', level: 'ideation', pattern: w(String.raw`\b(want|wanted|wanting|wish|wished|wishing|hope|hoping|ready)\s+(to\s+)?(i\s+)?(be\s+|was\s+|were\s+|am\s+|i'?d\s+)?(die(?!\s+on\s+(this|that)\s+hill)|dead|not\s+(be\s+)?alive)\b|\brather\s+(be\s+)?dead\b|\bbetter\s+off\s+dead\b|\bwish(ed)?\s+i('?d|\s+had)?\s+never\s+been\s+born\b`), note: 'want / wish to die; rather be dead; better off dead; never been born' },
  { id: 'R04_not_wake_up', level: 'ideation', pattern: w(String.raw`\b(don'?t|do\s+not|never)\s+(want\s+to\s+)?wake\s+up\b(?!\s+(on\s+time|early|late|before|in\s+time|for))|\bnot\s+wak(e|ing)\s+up\s+(tomorrow|again|at\s+all|ever)\b`), note: 'not wake up (excluding "on time / early / for")' },
  { id: 'R05_end_it_all', level: 'ideation', pattern: w(String.raw`\bend(ing)?\s+it\s+all\b|\bend(ing)?\s+(my\s+life|things\s+for\s+good)\b|\bthinking\s+(about|of)\s+ending\s+(things|it)\b|\bwant\s+(it\s+all\s+)?to\s+be\s+over\b`), note: 'end it all / end my life / ending things / want it to be over' },
  { id: 'R06_no_reason_to_live', level: 'ideation', pattern: w(String.raw`\b(no|nothing)\s+(reason|point)\s+(to\s+|in\s+|of\s+)?(live|living|go(ing)?\s+on|keep\s+going|being\s+here|being\s+alive)\b|\bno\s+point\s+anymore\b|\bcan'?t\s+(go|keep)\s+on\s+(like\s+this|anymore|any\s+longer)\b|\bcan'?t\s+do\s+this\s+anymore\b|\bdon'?t\s+want\s+to\s+(live|be\s+alive|be\s+here|exist)\b(\s+anymore)?`), note: 'no reason to live; can’t go on / do this anymore; don’t want to live / be here' },
  { id: 'R07_better_off_without', level: 'ideation', pattern: w(String.raw`\bbetter\s+(off\s+)?without\s+me\b|\beveryone\s+would\s+be\s+better\s+off\b|\bburden\s+(to|on)\s+(everyone|them|my|the)\b|\bworld\s+would\s+be\s+better\s+without\s+me\b`), note: '"They’d be better off without me" — UCM §4.2, a sociometer reading gone negative; perceived burdensomeness (Van Orden 2010)' },
  { id: 'R08_take_my_life', level: 'ideation', pattern: w(String.raw`\btak(e|ing)\s+my\s+(own\s+)?life\b`), note: 'take my life' },
  { id: 'R09_disappear', level: 'ideation', pattern: w(String.raw`\b(want|wanted|wish|wished|wishing|could)\s+(to\s+)?(just\s+)?(disappear|vanish|not\s+exist|stop\s+existing)\b|\bwish\s+i\s+(wasn'?t|weren'?t)\s+here\b|\bnot\s+(be\s+)?here\s+anymore\b`), note: 'want to disappear / not exist; wish I wasn’t here' },

  // --- plan or means ------------------------------------------------------
  // Means words require self-directed context. "gun range", "cleaned my
  // rifle", "bullet points", "OD green" do not fire.
  { id: 'R10_means_firearm', level: 'plan_or_means', pattern: w(String.raw`\bshoot(ing)?\s+my\s*self\b|\bgun\s+(to|in|against)\s+my\s+(head|mouth|temple|chest)\b|\b(put|use|used|using|load(ed)?|with)\s+(a|the|my)\s+(gun|pistol|rifle|firearm|shotgun)\s+(to|on|against)\s+my\s*self\b|\bbullet\s+(in|through)\s+my\s+(head|brain|skull)\b|\b(eat|eating|ate)\s+(a|my|the)\s+(gun|bullet|barrel)\b|\b(sit|sitting|sat)\s+((here|there)\s+)?with\s+(my|the|a)\s+(gun|pistol|rifle)\b`), note: 'firearm, self-directed' },
  { id: 'R11_means_overdose', level: 'plan_or_means', pattern: w(String.raw`\boverdos(e|ing|ed)\b|\b(take|took|taking|swallow(ed|ing)?)\s+(all|the\s+whole|every|a\s+bottle\s+of|the\s+bottle\s+of|too\s+many)\s+(the\s+|my\s+|of\s+my\s+)?(pills|meds|medication|bottle)\b|\b(the\s+)?whole\s+bottle\s+(of\s+\w+\s+)?(tonight|today|at\s+once)\b`), note: 'overdose / all the pills / whole bottle' },
  { id: 'R12_means_hanging', level: 'plan_or_means', pattern: w(String.raw`\bhang(ing)?\s+my\s*self\b|\bnoose\b|\brope\s+around\s+my\s+neck\b`), note: 'hanging' },
  { id: 'R13_means_jump', level: 'plan_or_means', pattern: w(String.raw`\bjump(ing)?\s+(off|from)\s+(a|the|my)\s+(bridge|building|roof|overpass|balcony|window|cliff)\b|\bjump(ing)?\s+in\s+front\s+of\s+(a|the)\s+(train|bus|truck|car)\b|\bdriv(e|ing)\s+(off|into)\s+(a|the)\s+(bridge|tree|wall|overpass|oncoming)\b|\b(slit|cut|cutting|slash(ing)?)\s+my\s+wrists?\b`), note: 'jumping / vehicle / wrists' },
  { id: 'R14_plan_words', level: 'plan_or_means', pattern: w(String.raw`\bplan\s+to\s+(end|kill|die|do\s+it|take\s+my)\b|\b(have|got|made)\s+a\s+plan\s+to\s+(end|kill|die|do\s+it)\b|\b(suicide|goodbye)\s+(note|letter)\b|\bwrote\s+(a\s+)?(note|letter)s?\s+to\s+(everyone|my\s+(family|kids|wife|husband|daughter|son))\s+(saying\s+goodbye|to\s+say\s+goodbye|for\s+after)\b|\bgiving\s+(away\s+)?my\s+(stuff|things)\s+away\b`), note: 'plan + intent; suicide/goodbye note' },
  { id: 'R15_tonight_today', level: 'plan_or_means', pattern: w(String.raw`\b(tonight|today|this\s+weekend)\s+(is|will\s+be)\s+(the\s+)?(last\s+(night|day|time)|the\s+night\s+i|the\s+day\s+i)\b.*\b(die|end|do\s+it|kill|go)\b|\bmy\s+last\s+(night|day)\s+(alive|on\s+earth|here)\b`), note: 'timeline + intent' },

  // --- self-harm ----------------------------------------------------------
  // "hurt myself lifting" and "cut myself shaving" do not fire.
  { id: 'R16_self_harm', level: 'self_harm', pattern: w(String.raw`\bself[-\s]?harm(ing|ed)?\b|\b(cut|cutting|burn|burning)\s+my\s*self\b(?!\s+(shaving|on|with\s+(the|a)\s+(knife|stove|pan|glass|paper)|while|at\s+work|cooking))|\b(hurt|hurting)\s+my\s*self\s+(on\s+purpose|again|to\s+feel|deliberately)\b|\burge\s+to\s+(cut|hurt\s+my\s*self|burn)\b|\bwant\s+to\s+(cut|hurt\s+my\s*self)\b`), note: 'self-harm with intent context' },
] as const;

/** Rule ids that once existed and must stay resolvable for stored events. */
export const RETIRED_RULE_IDS: readonly string[] = [];

export interface RiskDetection {
  matched: boolean;
  ruleIds: string[];
  /** Highest level among matches; undefined when no match. */
  level?: RiskLevel;
  /** Resource ids to show, in display order. Empty when no match. */
  resources: CrisisResourceId[];
}

const LEVEL_RANK: Record<RiskLevel, number> = { ideation: 1, self_harm: 2, plan_or_means: 3 };

/** Resources shown for each level. Veterans Crisis Line is always included. */
function resourcesFor(level: RiskLevel): CrisisResourceId[] {
  const base: CrisisResourceId[] = ['lifeline_988', 'vcl_call', 'vcl_text'];
  return level === 'plan_or_means' ? ['emergency_911', ...base] : base;
}

/** Run every rule against one string. */
export function detectRisk(text: string | null | undefined): RiskDetection {
  if (!text) return { matched: false, ruleIds: [], resources: [] };
  const normalized = text.replace(/[\u2018\u2019\u02bc]/g, "'");
  const ruleIds: string[] = [];
  let top: RiskLevel | undefined;
  for (const rule of CRISIS_RULES) {
    if (rule.pattern.test(normalized)) {
      ruleIds.push(rule.id);
      if (!top || LEVEL_RANK[rule.level] > LEVEL_RANK[top]) top = rule.level;
    }
  }
  if (ruleIds.length === 0 || !top) return { matched: false, ruleIds: [], resources: [] };
  return { matched: true, ruleIds, level: top, resources: resourcesFor(top) };
}

/** Run every rule against several fields of one entry (situation, outcome, journal…). */
export function detectRiskInEntry(fields: Array<string | null | undefined>): RiskDetection {
  const ids = new Set<string>();
  let top: RiskLevel | undefined;
  for (const f of fields) {
    const d = detectRisk(f);
    for (const id of d.ruleIds) ids.add(id);
    if (d.level && (!top || LEVEL_RANK[d.level] > LEVEL_RANK[top])) top = d.level;
  }
  if (ids.size === 0 || !top) return { matched: false, ruleIds: [], resources: [] };
  return { matched: true, ruleIds: [...ids].sort(), level: top, resources: resourcesFor(top) };
}

/** Everything the resource card needs, resolved from ids. */
export function resourceCards(ids: CrisisResourceId[]) {
  return ids.map((id) => CRISIS_RESOURCES[id]);
}

export function isKnownRuleId(id: string): boolean {
  return CRISIS_RULES.some((r) => r.id === id) || RETIRED_RULE_IDS.includes(id);
}
