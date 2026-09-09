/**
 * Cases for locate(): these signs, therefore this floor.
 *
 * Created rather than extended — there was no eval scaffold in the repo, and
 * no locate() either; the page scored inline. It is here because a weighted
 * sign list is exactly the kind of thing that looks right in review and
 * behaves wrong in combination, and because one of the signs now carries a
 * weight nobody has clinically reviewed yet.
 *
 * Cases are indices into OBSERVATIONS. Add a row when a combination surprises
 * you, and the surprise stops being possible twice.
 */
import { describe, expect, it } from 'vitest';
import { AID_OBSERVATIONS, LOCATOR_OBSERVATIONS, OBSERVATIONS, locate } from '../content/observations';

/** Find a sign by the opening of its text, so cases read as prose. */
const sign = (starts: string): number => {
  const i = OBSERVATIONS.findIndex((o) => o.q.startsWith(starts));
  if (i === -1) throw new Error(`No observation starting "${starts}"`);
  return i;
};

const ACCURATE_INSIGHT = sign('They can state the belief');
const BEFORE_THOUGHT = sign('The reaction arrives before');
const BODY_AS_WORLD = sign('A body signal is being read');
const IN_THE_ROOM = sign('It shows up in the room');
const NO_DECISION = sign('It runs without a decision');
const ENVIRONMENT_NOW = sign('The environment is doing the damage');
const HOLDS_THINKING = sign('The trouble is how they hold');
const ONE_ACCOUNT = sign('One coherent account');
const NEVER_TESTED = sign('They have never actually tested it');
const EVERY_TIME = sign('The every-time pattern');
const TOO_BIG = sign('The reaction too big for the occasion');

interface Case {
  name: string;
  ticked: number[];
  floor: number | null;
  lit?: number[];
}

const CASES: Case[] = [
  { name: 'nothing ticked locates nothing', ticked: [], floor: null, lit: [] },
  { name: 'a single sign locates its own floor', ticked: [BODY_AS_WORLD], floor: 7, lit: [7] },
  { name: 'the substrate sign outweighs a single upper-floor sign', ticked: [ENVIRONMENT_NOW, ONE_ACCOUNT], floor: 8 },
  { name: 'metacognition alone', ticked: [HOLDS_THINKING], floor: 2, lit: [2] },
  { name: 'the room sign is floor 4', ticked: [IN_THE_ROOM], floor: 4, lit: [4] },
  { name: 'scripts alone', ticked: [NO_DECISION], floor: 5, lit: [5] },
  {
    name: 'accurate insight lights 6 and 7 together and pushes 3 down',
    ticked: [ACCURATE_INSIGHT],
    floor: 6,
    lit: [6, 7],
  },
  { name: 'the every-time pattern is floor 4, like the room sign', ticked: [EVERY_TIME], floor: 4, lit: [4] },
  {
    name: 'the two floor-4 signs agree rather than compete',
    ticked: [EVERY_TIME, IN_THE_ROOM],
    floor: 4,
    lit: [4],
  },
  { name: 'the flare sign alone points below the words', ticked: [TOO_BIG], floor: 6, lit: [6, 7] },
  {
    name: 'never-tested puts floor 5 ahead of the floor-3 belief it rests on',
    ticked: [NEVER_TESTED],
    floor: 5,
    lit: [5],
  },
  {
    // 6 scores 2 against a top of 4, and 0.6 × 4 is 2.4 — so the second body
    // sign does not merely tip 7 ahead, it puts 6 out of the lit set entirely.
    name: 'a second body sign pushes 7 far enough ahead that 6 goes dark',
    ticked: [BEFORE_THOUGHT, BODY_AS_WORLD],
    floor: 7,
    lit: [7],
  },
];

describe('locate', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const out = locate(c.ticked);
      expect(out.floor, 'floor').toBe(c.floor);
      if (c.lit) expect(out.lit, 'lit').toEqual(c.lit);
    });
  }

  it('locates nothing while a gate is open, whatever is ticked', () => {
    const out = locate([BODY_AS_WORLD, ENVIRONMENT_NOW], false);
    expect(out.floor).toBeNull();
    expect(out.lit).toEqual([]);
  });

  it('ignores an index that is not a sign', () => {
    expect(locate([999]).floor).toBeNull();
  });
});

describe('the flare sign does not double-count with accurate insight', () => {
  // Both say the same thing — the load is not where the words are — so a case
  // showing both must not read as twice the evidence.
  const insight = locate([ACCURATE_INSIGHT]);
  const both = locate([ACCURATE_INSIGHT, TOO_BIG]);

  it('agrees with accurate insight on the floor and on what is lit', () => {
    expect(both.floor).toBe(insight.floor);
    expect(both.lit).toEqual(insight.lit);
  });

  it('is half the weight of the sign it is derived from', () => {
    const from = LOCATOR_OBSERVATIONS[0]!;
    const flare = AID_OBSERVATIONS.find((o) => o.q.startsWith('The reaction too big'))!;
    for (const floor of Object.keys(flare.w)) {
      expect(flare.w[floor]! * 2, `floor ${floor}`).toBe(from.w[floor]);
    }
  });

  it('cannot out-vote a sign that names a floor outright', () => {
    // Adding the flare to a floor-8 case must not move it off the substrate.
    expect(locate([ENVIRONMENT_NOW, TOO_BIG]).floor).toBe(8);
  });
});
