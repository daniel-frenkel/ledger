/**
 * Every work cited anywhere in the Library.
 *
 * The list is closed: it contains the sources named in the file key and body of
 * `docs/theory-mapping.md` and nothing else. `citedAs` is the token the memo
 * itself uses, and `source` is the path or citation exactly as the memo gives
 * it — including the memo's own elisions, which is why several entries read
 * "Floor N" or end in "….md". Those are not placeholders on our side; they are
 * how the memo names the file.
 *
 * test/references.test.ts checks both directions: every key a content block
 * cites exists here, and every string here appears in the memo.
 */
import { z } from 'zod';

export const referenceSchema = z.object({
  /** Stable key. Content blocks cite by this and only this. */
  key: z.string().min(1),
  /** The token the memo uses for this source, verbatim. */
  citedAs: z.string().min(1),
  /** The path or citation as the memo gives it, verbatim. */
  source: z.string().min(1),
  kind: z.enum(['corpus', 'external']),
});

export type Reference = z.infer<typeof referenceSchema>;

export const REFERENCES: readonly Reference[] = z.array(referenceSchema).parse([
  // --- the author's corpus, from the memo's file key -------------------------
  {
    key: 'ucm',
    citedAs: 'UCM',
    source: 'Unified Theory of Psychotherapy/A Unified Clinical Model of Psychotherapy.md',
    kind: 'corpus',
  },
  { key: 'cg', citedAs: 'CG', source: "The Clinician's Guide to Predictive Processing.md", kind: 'corpus' },
  { key: 'f4', citedAs: 'F4', source: 'floor-notes/Floor N — ….md', kind: 'corpus' },
  { key: 'f5', citedAs: 'F5', source: 'floor-notes/Floor N — ….md', kind: 'corpus' },
  { key: 'f6', citedAs: 'F6', source: 'floor-notes/Floor N — ….md', kind: 'corpus' },
  { key: 'f7', citedAs: 'F7', source: 'floor-notes/Floor N — ….md', kind: 'corpus' },
  { key: 'p-panic', citedAs: 'P-Panic', source: 'Clinical Tools/Protocol — ….md', kind: 'corpus' },
  { key: 'p-ptsd', citedAs: 'P-PTSD', source: 'Clinical Tools/Protocol — ….md', kind: 'corpus' },
  { key: 'p-sa', citedAs: 'P-SA', source: 'Clinical Tools/Protocol — ….md', kind: 'corpus' },
  { key: 'da', citedAs: 'DA', source: 'Decision Aid — Locating the Floor.md', kind: 'corpus' },
  { key: 'fr', citedAs: 'FR', source: 'Formulation Router — Door to Drawer.md', kind: 'corpus' },
  { key: 'mod', citedAs: 'MOD', source: 'How the Major Modalities Recalibrate Priors.md', kind: 'corpus' },
  { key: 'rn-surprise', citedAs: 'RN-Surprise', source: 'research-notes/2026-08-12 — ….md', kind: 'corpus' },
  { key: 'rn-guess', citedAs: 'RN-Guess', source: 'research-notes/2026-08-12 — ….md', kind: 'corpus' },
  { key: 'rn-elastic', citedAs: 'RN-Elastic', source: 'research-notes/2026-08-12 — ….md', kind: 'corpus' },
  { key: 'wtd', citedAs: 'WtD', source: 'Waking the Driver — full manuscript (build 2026-08-22).md', kind: 'corpus' },
  { key: 'rnu', citedAs: 'R&U', source: 'Respected and Unwanted — TRADE BOOK.md', kind: 'corpus' },
  { key: 'rnu-gauges', citedAs: 'R&U-Gauges', source: 'Respected and Unwanted/Concepts/', kind: 'corpus' },
  { key: 'rnu-bridge', citedAs: 'R&U-Bridge', source: 'Respected and Unwanted/Concepts/', kind: 'corpus' },
  { key: 'rnu-evidence', citedAs: 'R&U-Evidence', source: 'Respected and Unwanted/Concepts/', kind: 'corpus' },

  // --- works cited from outside the vault ------------------------------------
  { key: 'craske-2014', citedAs: 'Craske et al. (2014)', source: 'Craske et al. (2014)', kind: 'external' },
  {
    key: 'eubanks-2018',
    citedAs: 'Eubanks, Muran, & Safran, 2018',
    source: 'Eubanks, Muran, & Safran, 2018',
    kind: 'external',
  },
  { key: 'lambert-2010', citedAs: 'Lambert, 2010', source: 'Lambert, 2010', kind: 'external' },
  { key: 'salkovskis', citedAs: 'Salkovskis', source: 'Salkovskis', kind: 'external' },
  { key: 'barlow-craske', citedAs: 'Barlow/Craske', source: 'Barlow/Craske', kind: 'external' },
]);

const BY_KEY = new Map(REFERENCES.map((r) => [r.key, r]));

export const referenceKeys = (): string[] => REFERENCES.map((r) => r.key);

export function reference(key: string): Reference {
  const r = BY_KEY.get(key);
  if (!r) throw new Error(`Unknown reference key: ${key}`);
  return r;
}

/** A citation list rendered as the memo's own tokens, e.g. "UCM · WtD". */
export const citeLabel = (keys: readonly string[]): string => keys.map((k) => reference(k).citedAs).join(' · ');
