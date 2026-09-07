import { describe, expect, it } from 'vitest';
import { CRISIS_RULES, detectRisk, detectRiskInEntry, isKnownRuleId, resourceCards } from '../src/index.js';

describe('detectRisk', () => {
  it.each([
    // ideation
    ['I want to kill myself', 'R01_kill_self', 'ideation'],
    ['kms honestly', 'R01_kill_self', 'ideation'],
    ['thinking about suicide again', 'R02_suicid', 'ideation'],
    ['honestly I just want to die', 'R03_want_to_die', 'ideation'],
    ['I wish I was dead', 'R03_want_to_die', 'ideation'],
    ['I’d rather be dead', 'R03_want_to_die', 'ideation'],
    ['I’d be better off dead', 'R03_want_to_die', 'ideation'],
    ['I wish I’d never been born', 'R03_want_to_die', 'ideation'],
    ['I hope I don’t wake up tomorrow', 'R04_not_wake_up', 'ideation'],
    ['I could end it all tonight', 'R05_end_it_all', 'ideation'],
    ['thinking about ending things', 'R05_end_it_all', 'ideation'],
    ['I keep thinking about ending my life', 'R05_end_it_all', 'ideation'],
    ['I want it all to be over', 'R05_end_it_all', 'ideation'],
    ['there is no point in living', 'R06_no_reason_to_live', 'ideation'],
    ["I can't go on like this", 'R06_no_reason_to_live', 'ideation'],
    ["I can't do this anymore", 'R06_no_reason_to_live', 'ideation'],
    ["I don't want to be alive", 'R06_no_reason_to_live', 'ideation'],
    ["I don't want to live anymore", 'R06_no_reason_to_live', 'ideation'],
    ["I don't want to be here anymore", 'R06_no_reason_to_live', 'ideation'],
    ['no point anymore', 'R06_no_reason_to_live', 'ideation'],
    ['they would be better off without me', 'R07_better_off_without', 'ideation'],
    ['the world would be better without me', 'R07_better_off_without', 'ideation'],
    ['I am a burden to everyone', 'R07_better_off_without', 'ideation'],
    ['thought about taking my own life', 'R08_take_my_life', 'ideation'],
    ['I just want to disappear', 'R09_disappear', 'ideation'],
    ['I wish I wasn’t here', 'R09_disappear', 'ideation'],
    // plan or means
    ['I keep thinking about shooting myself', 'R10_means_firearm', 'plan_or_means'],
    ['sat there with my pistol last night', 'R10_means_firearm', 'plan_or_means'],
    ['put the gun to my head', 'R10_means_firearm', 'plan_or_means'],
    ['I could take all the pills', 'R11_means_overdose', 'plan_or_means'],
    ['take the whole bottle tonight', 'R11_means_overdose', 'plan_or_means'],
    ['thinking about overdosing', 'R11_means_overdose', 'plan_or_means'],
    ['I keep thinking about hanging myself', 'R12_means_hanging', 'plan_or_means'],
    ['jump off the bridge on the way home', 'R13_means_jump', 'plan_or_means'],
    ['jump in front of a train', 'R13_means_jump', 'plan_or_means'],
    ['slit my wrists', 'R13_means_jump', 'plan_or_means'],
    ['I have a plan to end it', 'R14_plan_words', 'plan_or_means'],
    ['wrote a goodbye note', 'R14_plan_words', 'plan_or_means'],
    ['tonight is the last night, I’m going to do it', 'R15_tonight_today', 'plan_or_means'],
    ['my last night alive', 'R15_tonight_today', 'plan_or_means'],
    // self-harm
    ['I cut myself again last night', 'R16_self_harm', 'self_harm'],
    ['self-harm urges are back', 'R16_self_harm', 'self_harm'],
    ['I hurt myself on purpose', 'R16_self_harm', 'self_harm'],
    ['urge to cut', 'R16_self_harm', 'self_harm'],
  ])('matches %j → %s (%s)', (text, ruleId, level) => {
    const d = detectRisk(text);
    expect(d.matched).toBe(true);
    expect(d.ruleIds).toContain(ruleId);
    expect(d.level).toBe(level);
  });

  it('is case-insensitive', () => {
    expect(detectRisk('KILL MYSELF').matched).toBe(true);
  });

  it('matches negated phrasing on purpose (the card is not a judgment)', () => {
    expect(detectRisk("I don't want to die, I just want it to stop").matched).toBe(true);
  });

  it.each([
    // ordinary ledger entries
    'I predicted she would go quiet and she did.',
    'Killed it at the presentation.',
    'The deadline is tonight.',
    'My heart was racing before the call.',
    'I told him no and the room did not end.',
    'Dead tired after the drive.',
    'gunning for the promotion',
    'the pill I take for blood pressure',
    // veteran-ordinary sentences that must NOT fire
    'Going to the gun range with Mike on Saturday.',
    'Cleaned my rifle before the reunion.',
    'Three bullet points for the briefing.',
    'Dodged a bullet when the meeting got cancelled.',
    'Wore my OD green jacket to the parade.',
    'I have a plan for the interview.',
    'My therapist and I made a plan for the wedding.',
    'Today is the day I ask for the raise.',
    'Tonight is the night we finally talk.',
    'This headache is killing me.',
    'The waiting is killing me.',
    'He finally got off me at BJJ.',
    'Took a lot of pressure off me.',
    'I hurt myself lifting at the gym.',
    'Cut myself shaving.',
    'Ready to die on this hill about the schedule.',
    'The headache will disappear by noon.',
    'That restaurant does not exist anymore.',
    "If I don't wake up on time I'll miss the flight.",
    "I can't go on Facebook without getting angry.",
    'I want to end things with her.',
    'Shot a 92 on the range.',
    '',
  ])('does not match ordinary entry %j', (text) => {
    expect(detectRisk(text).matched).toBe(false);
  });

  it('returns no resources when nothing matched', () => {
    expect(detectRisk('fine day').resources).toEqual([]);
  });

  it('always includes 988 and both Veterans Crisis Line entries on any match', () => {
    const d = detectRisk('I want to die');
    expect(d.resources).toEqual(['lifeline_988', 'vcl_call', 'vcl_text']);
  });

  it('adds 911 first when plan or means is present', () => {
    const d = detectRisk('I have a plan to end it and I put the gun to my head');
    expect(d.resources[0]).toBe('emergency_911');
    expect(d.resources).toContain('vcl_text');
  });

  it('handles null and undefined', () => {
    expect(detectRisk(null).matched).toBe(false);
    expect(detectRisk(undefined).matched).toBe(false);
  });
});

describe('detectRiskInEntry', () => {
  it('unions rule ids across fields and takes the highest level', () => {
    const d = detectRiskInEntry(['I want to die', null, 'put the gun to my head']);
    expect(d.ruleIds).toEqual(['R03_want_to_die', 'R10_means_firearm']);
    expect(d.level).toBe('plan_or_means');
  });
});

describe('resourceCards', () => {
  it('resolves ids to card content with the right numbers', () => {
    const cards = resourceCards(['lifeline_988', 'vcl_call', 'vcl_text']);
    expect(cards.map((c) => c.action)).toEqual(['Call or text 988', 'Dial 988, then press 1', 'Text 838255']);
  });
});

describe('rule registry', () => {
  it('rule ids are unique and well-formed', () => {
    const ids = CRISIS_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^R\d{2}_[a-z_]+$/);
  });
  it('isKnownRuleId', () => {
    expect(isKnownRuleId('R01_kill_self')).toBe(true);
    expect(isKnownRuleId('R99_nope')).toBe(false);
  });
});
