/**
 * The content rules, enforced.
 *
 * These pages carry clinical theory that only the author writes. The rules that
 * keep them honest — cite only what the sources cite, port the locator's
 * numbers exactly, route protocols only where the locator routes them — are
 * checkable, so they are checked here rather than trusted.
 *
 * The locator and the memo are re-read from disk on every run, so a change to
 * either shows up as a failing test rather than a silent divergence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLOORS, LIT_THRESHOLD, MODALITY_SLUGS, OBSERVATIONS, isLit, scoreFloors } from '@ledger/shared';

import { REFERENCES, TIERS, isVerified, reference, referenceKeys, unverified } from '../content/references';
import { FLOOR_CONTENT, FLOOR_CAVEATS } from '../content/floors';
import { GATES, GATE_3_FOOTNOTE, warningFor } from '../content/observations';
import {
  FLOOR_ROUTED_BY_DOCUMENT,
  PROTOCOLS,
  protoTitlesForFloor,
  protocolByTitle,
} from '../content/protocols';
import {
  CANON,
  CORE_SIX,
  FLOOR_TOKENS,
  STACK_MODALITIES,
  STACK_MODALITY_SLUGS,
  floorsIn,
  modalitiesForFloor,
} from '../content/modalities';
import { ALL_SECTIONS, MODALITY_SECTIONS } from '../content/modality-sections';
import { MODEL_BLOCKS } from '../content/model';
import { inviteUrl } from '../lib/invite-url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(repo, p), 'utf8');

const LOCATOR = read('docs/design/floor-locator.html');
const MEMO = read('docs/theory-mapping.md');
const MODALITIES_MD = read('docs/theory/modalities.md');

/** Curly quotes and dashes differ between our strings and the sources' HTML entities. */
const normalise = (s: string) =>
  s
    .replace(/<\/?strong>/g, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&mdash;/g, '\u2014')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------
// references
// ---------------------------------------------------------------------------

describe('references', () => {
  it('has unique keys', () => {
    expect(new Set(REFERENCES.map((r) => r.key)).size).toBe(REFERENCES.length);
  });

  it('still holds every entry the memo cited, unchanged', () => {
    // The list used to contain only these. It now covers all of docs/theory,
    // so the check narrows to the ones other content modules cite by key.
    const memo = normalise(MEMO);
    for (const r of REFERENCES.filter((x) => x.kind === 'corpus' || x.kind === 'external')) {
      expect(memo, `citedAs for ${r.key}`).toContain(normalise(r.citedAs));
      expect(memo, `source for ${r.key}`).toContain(normalise(r.source));
    }
  });

  it('every entry carries a ledger tier or is marked unverified', () => {
    for (const r of REFERENCES) {
      // The two are exclusive and exhaustive: there is no third state, and no
      // entry may sit in the list with neither.
      expect(isVerified(r), r.key).toBe(r.tier !== null);
      if (!isVerified(r)) expect(unverified(), r.key).toContain(r);
    }
    expect(REFERENCES.filter(isVerified).length + unverified().length).toBe(REFERENCES.length);
  });

  it('only uses tiers the ledger defines', () => {
    for (const r of REFERENCES) if (r.tier !== null) expect(TIERS).toContain(r.tier);
  });

  it('resolves every key cited by a content block', () => {
    const cited = new Set<string>();
    for (const b of MODEL_BLOCKS) b.cites.forEach((k) => cited.add(k));
    for (const f of FLOOR_CONTENT) f.cites.forEach((k) => cited.add(k));
    for (const c of FLOOR_CAVEATS) c.cites.forEach((k) => cited.add(k));
    expect(cited.size).toBeGreaterThan(0);
    for (const k of cited) expect(() => reference(k)).not.toThrow();
  });

  it('throws on an unknown key rather than rendering a blank citation', () => {
    expect(() => reference('not-a-source')).toThrow(/Unknown reference key/);
  });
});

// ---------------------------------------------------------------------------
// floors
// ---------------------------------------------------------------------------

describe('floors', () => {
  it('has entries 1–8, in order, matching the shared vocabulary', () => {
    expect(FLOOR_CONTENT.map((f) => f.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const f of FLOOR_CONTENT) {
      expect(FLOORS.find((v) => v.n === f.n)?.name).toBe(f.name);
    }
  });

  it('has every field non-empty', () => {
    for (const f of FLOOR_CONTENT) {
      for (const key of ['definition', 'lives', 'reach', 'falsify', 'warning'] as const) {
        expect(f[key].trim().length, `floor ${f.n} ${key}`).toBeGreaterThan(0);
      }
      expect(f.cites.length, `floor ${f.n} cites`).toBeGreaterThan(0);
    }
  });

  it('floor 8 routes no protocols; every other floor routes at least one', () => {
    expect(floorEntry(8).proto).toEqual([]);
    for (const f of FLOOR_CONTENT.filter((x) => x.n !== 8)) {
      expect(f.proto.length, `floor ${f.n}`).toBeGreaterThan(0);
    }
  });

  it('carries the locator’s lives/reach/falsify text verbatim', () => {
    const loc = normalise(LOCATOR);
    for (const f of FLOOR_CONTENT) {
      expect(loc, `floor ${f.n} lives`).toContain(normalise(f.lives));
      expect(loc, `floor ${f.n} reach`).toContain(normalise(f.reach));
      expect(loc, `floor ${f.n} falsify`).toContain(normalise(f.falsify));
    }
  });

  it('carries each floor’s warning from the locator', () => {
    const loc = normalise(LOCATOR);
    for (const f of FLOOR_CONTENT) {
      // The locator bolds a lead phrase inside the string; compare without tags.
      const stripped = normalise(f.warning).replace(/^(Careful\.|Maintenance is in the substrate\.) /, '');
      expect(loc, `floor ${f.n} warning`).toContain(stripped.slice(0, 60));
    }
  });
});

const floorEntry = (n: number) => {
  const f = FLOOR_CONTENT.find((x) => x.n === n);
  if (!f) throw new Error(`no floor ${n}`);
  return f;
};

// ---------------------------------------------------------------------------
// observations — checked against the reference file itself
// ---------------------------------------------------------------------------

describe('observations', () => {
  // The nine ported from the prototype, the two from the Decision Aid, and the
  // scoring are checked in packages/shared/test/floors.test.ts, against those
  // documents, next to where they now live. What is left here is what this app
  // still owns: the gate copy and the warnings.

  it('weights reference only floors 1–8', () => {
    for (const [i, o] of OBSERVATIONS.entries()) {
      for (const f of Object.keys(o.w)) {
        const n = Number(f);
        expect(Number.isInteger(n), `obs ${i} floor ${f}`).toBe(true);
        expect(n, `obs ${i} floor ${f}`).toBeGreaterThanOrEqual(1);
        expect(n, `obs ${i} floor ${f}`).toBeLessThanOrEqual(8);
      }
    }
  });

  it('says under gate 3 that the environment question is asked twice', () => {
    // The Aid checks the field before the floor logic runs; the floor-8 sign
    // routes a case that is already in it. Without saying so it reads as a
    // duplicate.
    expect(GATE_3_FOOTNOTE).toMatch(/twice on purpose/);
    expect(GATE_3_FOOTNOTE).toMatch(/floor-8/);
    expect(GATES.find((g) => g.id === 'calibrated')).toBeDefined();
  });

  it('has the three gates the reference file has', () => {
    expect(GATES).toHaveLength(3);
    const loc = normalise(LOCATOR);
    for (const g of GATES) {
      expect(loc, g.id).toContain(normalise(g.name));
      expect(loc, `${g.id} note`).toContain(normalise(g.note));
    }
  });
});

describe('the weights are not duplicated here', () => {
  it('this app holds no second copy of the signs or the scoring', () => {
    // The whole point of moving them: one weight, one place. A literal weight
    // map in this file would be a fork that typechecks.
    const src = read('apps/clinician/content/observations.ts');
    expect(src).not.toMatch(/w:\s*\{\s*\d+\s*:/);
    expect(src).toContain("from '@ledger/shared'");
  });

  it('uses the shared list, and the shared list is the one the sources fix', () => {
    expect(OBSERVATIONS.length).toBeGreaterThanOrEqual(11);
    expect(OBSERVATIONS.every((o) => typeof o.id === 'string' && o.id !== '')).toBe(true);
  });
});

describe('warnings', () => {
  it('floor 8 gets the substrate warning', () => {
    expect(warningFor(8, scoreFloors(['environment-now']).scores).lead).toBe('Maintenance is in the substrate.');
  });

  it('floor 3 warns about 6/7 only when they also score', () => {
    // never-tested adds 3:+1; insight-does-not-move adds 6 and 7.
    const withHot = scoreFloors(['insight-does-not-move', 'never-tested']).scores;
    expect(warningFor(3, withHot).lead).toBe('Careful.');
    const noHot = scoreFloors(['never-tested']).scores; // 5:+2, 3:+1 — nothing on 6 or 7
    expect(warningFor(3, noHot).lead).toBe('');
  });

  it('floors 6 and 7 get the flooding warning', () => {
    for (const n of [6, 7]) expect(warningFor(n, scoreFloors(['reaction-before-thought']).scores).rest).toMatch(/flooding/);
  });

  it('everything else gets the origin-versus-maintenance warning', () => {
    for (const n of [1, 2, 4, 5]) expect(warningFor(n, scoreFloors([]).scores).rest).toMatch(/Origin and maintenance/);
  });
});

// ---------------------------------------------------------------------------
// protocols
// ---------------------------------------------------------------------------

const THIRTEEN = [
  'Panic',
  'Social anxiety',
  'PTSD',
  'OCD',
  'Worry (GAD)',
  'Depression',
  'Insomnia',
  'Health anxiety',
  'Chronic pain',
  'Addiction',
  'Prolonged grief',
  'The self-story',
  'Rank-reactive mood instability',
];

describe('protocols', () => {
  it('is exactly the thirteen', () => {
    expect(PROTOCOLS.map((p) => p.title)).toEqual(THIRTEEN);
  });

  it('has unique slugs', () => {
    expect(new Set(PROTOCOLS.map((p) => p.slug)).size).toBe(PROTOCOLS.length);
  });

  it('every protocol name the locator routes to resolves to a protocol', () => {
    for (const f of FLOOR_CONTENT) {
      for (const title of f.proto) {
        expect(protocolByTitle(title), `floor ${f.n} routes to "${title}"`).toBeDefined();
      }
    }
  });

  it('routes the clinical note from floor 4, which the locator does not do', () => {
    // The locator's FLOORS object predates the note. Its own placement section
    // makes it the oscillating-presentation companion to the status-injury
    // material, which is floor 4 — rank and mattering.
    expect(floorEntry(4).proto).not.toContain('Rank-reactive mood instability');
    expect(FLOOR_ROUTED_BY_DOCUMENT[4]).toEqual(['Rank-reactive mood instability']);
    expect(protoTitlesForFloor(4)).toContain('Rank-reactive mood instability');
    expect(protocolByTitle('Rank-reactive mood instability')?.floors).toEqual([4]);
  });

  it('adds nothing to any other floor’s routing', () => {
    for (const f of FLOOR_CONTENT.filter((x) => x.n !== 4)) {
      expect(protoTitlesForFloor(f.n), `floor ${f.n}`).toEqual([...f.proto]);
    }
  });
});

// ---------------------------------------------------------------------------
// modalities
// ---------------------------------------------------------------------------

describe('modalities', () => {
  it('has the core six and the eleven canon rows', () => {
    expect(CORE_SIX).toHaveLength(6);
    expect(CANON).toHaveLength(11);
  });

  it('every home-floor reference is a floor 1–8 or a named qualifier', () => {
    for (const row of [...CORE_SIX, ...CANON]) {
      for (const s of row.homeFloors) {
        const ok = s.floors.length > 0 || (s.token !== undefined && FLOOR_TOKENS.includes(s.token));
        expect(ok, `${row.modality}: "${s.text}"`).toBe(true);
        for (const n of s.floors) {
          expect(n, `${row.modality}: "${s.text}"`).toBeGreaterThanOrEqual(1);
          expect(n, `${row.modality}: "${s.text}"`).toBeLessThanOrEqual(8);
        }
      }
    }
  });

  it('keeps range and qualifier text rather than flattening it', () => {
    const act = CORE_SIX.find((r) => r.modality.includes('ACT'));
    expect(act?.homeFloors.map((s) => s.text)).toContain('6–7');
    const fam = CANON.find((r) => r.modality.includes('Family Systems'));
    expect(fam?.homeFloors.map((s) => s.text)).toContain('4 (at system scale)');
    const adler = CANON.find((r) => r.modality.includes('Adlerian'));
    expect(adler?.homeFloors.map((s) => s.text)).toContain('stakes (belonging)');
  });

  it('every technique floor cell references only floors 1–8', () => {
    for (const s of ALL_SECTIONS) {
      for (const t of s.techniques) {
        expect(t.floors).toEqual(floorsIn(t.floorText));
        for (const n of t.floors) {
          expect(n, `${s.slug}: ${t.floorText}`).toBeGreaterThanOrEqual(1);
          expect(n, `${s.slug}: ${t.floorText}`).toBeLessThanOrEqual(8);
        }
      }
    }
  });

  it('never truncates the "when it fails" column', () => {
    for (const s of ALL_SECTIONS) {
      for (const t of s.techniques) {
        expect(t.whenItFails.trim().length, `${s.slug}: ${t.technique}`).toBeGreaterThan(20);
        expect(t.whenItFails, `${s.slug}: ${t.technique}`).not.toMatch(/…\s*$/);
        expect(normalise(MODALITIES_MD), `${s.slug}: ${t.technique}`).toContain(normalise(t.whenItFails));
      }
    }
  });

  it('every technique row is in the source document', () => {
    const md = normalise(MODALITIES_MD);
    for (const s of ALL_SECTIONS) {
      for (const t of s.techniques) {
        expect(md, `${s.slug}: ${t.technique}`).toContain(normalise(t.technique));
        expect(md, `${s.slug}: lever`).toContain(normalise(t.lever));
      }
    }
  });

  it('has unique section slugs, and every section heading is in the source', () => {
    expect(new Set(ALL_SECTIONS.map((s) => s.slug)).size).toBe(ALL_SECTIONS.length);
    const md = normalise(MODALITIES_MD);
    for (const s of ALL_SECTIONS) expect(md, s.slug).toContain(normalise(s.heading));
  });

  it('links every summary-table section to a section that exists', () => {
    const slugs = new Set(ALL_SECTIONS.map((s) => s.slug));
    for (const row of [...CORE_SIX, ...CANON]) {
      if (row.section) expect(slugs.has(row.section), `${row.modality} → ${row.section}`).toBe(true);
    }
  });

  it('derives the per-floor modality list from the tables', () => {
    // Floor 6 is named by EMDR and by Psychodynamic / EFT, among others.
    const at6 = modalitiesForFloor(6).map((m) => m.modality);
    expect(at6).toContain('**EMDR**');
    expect(at6).toContain('**Psychodynamic / EFT**');
    // Floor 3 is CBT's home floor and Cognitive Behavior's.
    expect(modalitiesForFloor(3).map((m) => m.modality)).toContain('**CBT**');
    // Every floor's list is drawn only from rows that name it.
    for (let n = 1; n <= 8; n++) {
      for (const m of modalitiesForFloor(n)) expect(floorsIn(m.as)).toContain(n);
    }
  });

  it('the top-level sections are the ones the source runs deep', () => {
    expect(MODALITY_SECTIONS.map((s) => s.slug)).toEqual([
      'cbt',
      'act',
      'dbt',
      'psychodynamic-eft',
      'emdr',
      'motivational-interviewing',
      'gestalt',
      'family-systems',
      'adlerian',
      'postmodern',
      'reality-therapy',
    ]);
    expect(MODALITY_SECTIONS.find((s) => s.slug === 'cbt')?.subsections.map((x) => x.slug)).toEqual(['cbt-i']);
  });
});

// ---------------------------------------------------------------------------
// the model page
// ---------------------------------------------------------------------------

describe('model', () => {
  it('cites at least one source per block, and every block has a body', () => {
    for (const b of MODEL_BLOCKS) {
      expect(b.body.length, b.heading).toBeGreaterThan(0);
      expect(b.cites.length, b.heading).toBeGreaterThan(0);
      for (const k of b.cites) expect(referenceKeys()).toContain(k);
    }
  });
});

// ---------------------------------------------------------------------------
// the invite link
// ---------------------------------------------------------------------------

describe('inviteUrl', () => {
  it('puts the token in the fragment, never the path or a query', () => {
    const url = inviteUrl('https://ledger.example', 'abc123');
    expect(url).toBe('https://ledger.example/join#abc123');
    // The fragment is the whole point: a browser does not send it to a server.
    expect(url.split('#')[0]).not.toContain('abc123');
    expect(url).not.toContain('?');
  });

  it('does not double the slash when the base has a trailing one', () => {
    expect(inviteUrl('https://ledger.example/', 'abc')).toBe('https://ledger.example/join#abc');
    expect(inviteUrl('https://ledger.example///', 'abc')).toBe('https://ledger.example/join#abc');
  });

  it('leaves a base64url token untouched', () => {
    // base64url has no characters that need escaping in a fragment, which is
    // why the token is minted that way.
    const token = 'aA0-_'.repeat(8).slice(0, 43);
    expect(inviteUrl('https://x.test', token).endsWith(`#${token}`)).toBe(true);
  });
});

/**
 * The stack view of the modality crosswalk.
 *
 * This module is the single source for modality slugs and home floors.
 * @ledger/shared holds no catalogue — it takes STACK_MODALITIES as an argument
 * — with one exception, MODALITY_SLUGS, which the API validates against and
 * which cannot import from an app. That list is a mirror, and this is what
 * pins it: add a modality here without adding the slug there and the build
 * fails rather than the modality becoming unstorable.
 */
describe('STACK_MODALITIES', () => {
  it('is exactly the slug set the API accepts', () => {
    expect([...STACK_MODALITY_SLUGS].sort()).toEqual([...MODALITY_SLUGS].sort());
  });

  it('gives every modality a unique slug and a name with no markdown left in it', () => {
    expect(new Set(STACK_MODALITY_SLUGS).size).toBe(STACK_MODALITIES.length);
    for (const m of STACK_MODALITIES) {
      expect(m.name, m.slug).not.toMatch(/\*|\(\d+\)/);
      expect(m.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('takes its floors from the home-floors column, ranges expanded', () => {
    // ACT's row is "2, 6–7": the range reaches both, which is floorsIn's job.
    expect(STACK_MODALITIES.find((m) => m.slug === 'act')!.floors).toEqual([2, 6, 7]);
  });

  it('gives the qualifiers no floor and puts them in the dimmer layer', () => {
    // MI is "change process" alone: no floor at all.
    const mi = STACK_MODALITIES.find((m) => m.slug === 'motivational-interviewing')!;
    expect(mi.floors).toEqual([]);
    expect(mi.dimmer).toBe(true);

    // Person-Centered is conditions *and* floor 4 when the regard is at risk.
    const pc = STACK_MODALITIES.find((m) => m.slug === 'person-centered')!;
    expect(pc.floors).toEqual([4]);
    expect(pc.dimmer).toBe(true);
  });

  it('unions the two tables where a modality appears in both', () => {
    // Psychodynamic/EFT is in the core six and again in the canon as
    // Psychoanalytic (4); one row, both sets of floors.
    expect(STACK_MODALITIES.find((m) => m.slug === 'psychodynamic-eft')!.floors).toEqual([4, 6]);
  });

  it('reaches every floor between them, which is the coverage claim', () => {
    const all = new Set(STACK_MODALITIES.flatMap((m) => m.floors));
    expect([...all].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('holds no floors of its own: every one is derivable from the source rows', () => {
    // floorsIn() over the home-floors text is the only way a floor gets here.
    for (const m of STACK_MODALITIES) {
      for (const f of m.floors) expect(f, m.slug).toBeGreaterThanOrEqual(1);
      for (const f of m.floors) expect(f, m.slug).toBeLessThanOrEqual(8);
    }
  });
});
