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
import { FLOORS } from '@ledger/shared';

import { REFERENCES, reference, referenceKeys } from '../content/references';
import { FLOOR_CONTENT, FLOOR_CAVEATS } from '../content/floors';
import { GATES, OBSERVATIONS, LIT_THRESHOLD, score, warningFor, isLit } from '../content/observations';
import { PROTOCOLS, protocolByTitle } from '../content/protocols';
import { CANON, CORE_SIX, FLOOR_TOKENS, floorsIn, modalitiesForFloor } from '../content/modalities';
import { ALL_SECTIONS, MODALITY_SECTIONS } from '../content/modality-sections';
import { MODEL_BLOCKS } from '../content/model';

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

  it('contains nothing that is not cited in theory-mapping.md', () => {
    const memo = normalise(MEMO);
    for (const r of REFERENCES) {
      expect(memo, `citedAs for ${r.key}`).toContain(normalise(r.citedAs));
      expect(memo, `source for ${r.key}`).toContain(normalise(r.source));
    }
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

/** Pull the OBS array out of the prototype and parse its weights. */
function locatorObservations(): { q: string; w: Record<string, number>; tag: string }[] {
  const block = LOCATOR.match(/var OBS = \[([\s\S]*?)\];/);
  if (!block) throw new Error('OBS not found in docs/design/floor-locator.html');
  // Each row is `{ q: "…", w: {…}, tag: "…" }`. The last has no trailing comma.
  const row = /\{\s*q:\s*"((?:[^"\\]|\\.)*)",\s*w:\s*\{([^}]*)\},\s*tag:\s*"([^"]*)"\s*\}/g;
  return [...block[1]!.matchAll(row)].map((m) => {
    const w: Record<string, number> = {};
    for (const p of (m[2] ?? '').matchAll(/(\d+)\s*:\s*(-?\d+)/g)) w[p[1]!] = Number(p[2]);
    return { q: m[1] ?? '', w, tag: m[3] ?? '' };
  });
}

describe('observations', () => {
  const fromFile = locatorObservations();

  it('the reference file still has nine of them', () => {
    expect(fromFile).toHaveLength(9);
    expect(OBSERVATIONS).toHaveLength(9);
  });

  it('matches the reference file exactly — text, weights and tags', () => {
    for (let i = 0; i < fromFile.length; i++) {
      expect(normalise(OBSERVATIONS[i]!.q), `obs ${i} text`).toBe(normalise(fromFile[i]!.q));
      expect(OBSERVATIONS[i]!.w, `obs ${i} weights`).toEqual(fromFile[i]!.w);
      expect(OBSERVATIONS[i]!.tag, `obs ${i} tag`).toBe(fromFile[i]!.tag);
    }
  });

  it('keeps the negative weight that pulls floor 3 down', () => {
    expect(OBSERVATIONS[0]!.w['3']).toBe(-2);
  });

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

  it('has the three gates the reference file has', () => {
    expect(GATES).toHaveLength(3);
    const loc = normalise(LOCATOR);
    for (const g of GATES) {
      expect(loc, g.id).toContain(normalise(g.name));
      expect(loc, `${g.id} note`).toContain(normalise(g.note));
    }
  });
});

describe('scoring', () => {
  it('lights the top floor and anything within 60% of it', () => {
    expect(LIT_THRESHOLD).toBe(0.6);
    // Sign 0 weighs 6:+2, 7:+2, 3:-2. Both 6 and 7 tie for top and light.
    const { scores, max, top } = score([0]);
    expect(max).toBe(2);
    expect(top).toBe(6);
    expect(isLit(scores, max, 6, true)).toBe(true);
    expect(isLit(scores, max, 7, true)).toBe(true);
    expect(isLit(scores, max, 3, true)).toBe(false);
  });

  it('lights nothing while a gate is open', () => {
    const { scores, max } = score([2]);
    expect(isLit(scores, max, 7, false)).toBe(false);
    expect(isLit(scores, max, 7, true)).toBe(true);
  });

  it('indicates no floor when nothing scores above zero', () => {
    expect(score([]).top).toBeNull();
  });
});

describe('warnings', () => {
  it('floor 8 gets the substrate warning', () => {
    expect(warningFor(8, score([5]).scores).lead).toBe('Maintenance is in the substrate.');
  });

  it('floor 3 warns about 6/7 only when they also score', () => {
    const withHot = score([0, 8]).scores; // sign 8 adds 3:+1, sign 0 adds 6/7
    expect(warningFor(3, withHot).lead).toBe('Careful.');
    const noHot = score([8]).scores; // 5:+2, 3:+1 — nothing on 6 or 7
    expect(warningFor(3, noHot).lead).toBe('');
  });

  it('floors 6 and 7 get the flooding warning', () => {
    for (const n of [6, 7]) expect(warningFor(n, score([1]).scores).rest).toMatch(/flooding/);
  });

  it('everything else gets the origin-versus-maintenance warning', () => {
    for (const n of [1, 2, 4, 5]) expect(warningFor(n, score([]).scores).rest).toMatch(/Origin and maintenance/);
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

  it('renders every section as awaiting the author', () => {
    for (const p of PROTOCOLS) {
      for (const body of Object.values(p.sections)) expect(body).toBe('');
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
