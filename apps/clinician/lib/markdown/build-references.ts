/**
 * Derives the reference list from the sources, so content/references.ts is a
 * committed, reviewable artefact rather than a transcription.
 *
 * content/references.ts has to stay free of `node:fs`: the locator on
 * /formulate is a client component and imports content/floors.ts, which
 * imports it. So the list is generated here, committed as data, and
 * test/references.test.ts re-derives it and fails if the two ever diverge.
 *
 *   pnpm --filter @ledger/clinician build:references
 */
import { ledgerEntries, ledgerMatch, pinTargets, type LedgerEntry, type Tier } from './citations';

export interface DerivedReference {
  key: string;
  /** The token the sources use for this work. */
  citedAs: string;
  /** The path or citation as the source gives it. */
  source: string;
  kind: 'corpus' | 'external' | 'pin' | 'ledger';
  /** The verification ledger's evidence tier, or null where it does not cover it. */
  tier: Tier | null;
  /** Row number in the ledger's table, where there is one. */
  ledgerRow: number | null;
  /** Protocol slugs whose Pin targets table names this work. */
  citedBy: string[];
}

/**
 * The entries carried over from the first pass of the Library, keyed by hand
 * because other content modules cite them by key. They are the author's own
 * documents and the works named in docs/theory-mapping.md's file key.
 */
export const KEYED: readonly Omit<DerivedReference, 'tier' | 'ledgerRow' | 'citedBy'>[] = [
  { key: 'ucm', citedAs: 'UCM', source: 'Unified Theory of Psychotherapy/A Unified Clinical Model of Psychotherapy.md', kind: 'corpus' },
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
  { key: 'craske-2014', citedAs: 'Craske et al. (2014)', source: 'Craske et al. (2014)', kind: 'external' },
  { key: 'eubanks-2018', citedAs: 'Eubanks, Muran, & Safran, 2018', source: 'Eubanks, Muran, & Safran, 2018', kind: 'external' },
  { key: 'lambert-2010', citedAs: 'Lambert, 2010', source: 'Lambert, 2010', kind: 'external' },
  { key: 'salkovskis', citedAs: 'Salkovskis', source: 'Salkovskis', kind: 'external' },
  { key: 'barlow-craske', citedAs: 'Barlow/Craske', source: 'Barlow/Craske', kind: 'external' },
];

export const keyOf = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');

/** Every work cited in the corpus, with whatever the ledger says about it. */
export function derive(): DerivedReference[] {
  const ledger = ledgerEntries();
  const pins = pinTargets();
  const out: DerivedReference[] = [];
  const used = new Set<string>();

  const push = (r: DerivedReference) => {
    let key = r.key;
    for (let i = 2; used.has(key); i++) key = `${r.key}-${i}`;
    used.add(key);
    out.push({ ...r, key });
  };

  for (const k of KEYED) {
    const hit = ledgerMatch(k.source, ledger);
    push({ ...k, tier: hit?.tier ?? null, ledgerRow: hit?.row ?? null, citedBy: [] });
  }

  // The ledger's own rows: the paper's reference list.
  for (const e of ledger) {
    push({
      key: keyOf(e.reference),
      citedAs: e.reference,
      source: e.reference,
      kind: 'ledger',
      tier: e.tier,
      ledgerRow: e.row,
      citedBy: [],
    });
  }

  // The protocols' Pin targets, deduplicated on the lead. Where a lead matches
  // a ledger row, it is the same work: record the protocol against that row
  // rather than listing the work twice under two spellings.
  const byLead = new Map<string, string[]>();
  for (const p of pins) byLead.set(p.lead, [...(byLead.get(p.lead) ?? []), p.protocol]);

  for (const [lead, cited] of byLead) {
    const citedBy = [...new Set(cited)].sort();
    const hit = ledgerMatch(lead, ledger);
    if (hit) {
      const row = out.find((r) => r.kind === 'ledger' && r.source === hit.reference);
      if (row) {
        row.citedBy = [...new Set([...row.citedBy, ...citedBy])].sort();
        continue;
      }
    }
    push({ key: keyOf(lead), citedAs: lead, source: lead, kind: 'pin', tier: null, ledgerRow: null, citedBy });
  }

  return out;
}

const HEADER = `/**
 * Every work cited across docs/theory, and what the verification ledger says.
 *
 * GENERATED — do not edit by hand. Regenerate with:
 *   pnpm --filter @ledger/clinician build:references
 * test/references.test.ts re-derives this from the sources and fails on drift.
 *
 * Three origins, none of them interpreted here:
 *
 *   corpus / external  the keyed entries the Library already cited by key, from
 *                      the file key of docs/theory-mapping.md.
 *   ledger             the 49 numbered rows of the signed Pass-1 table in
 *                      docs/theory/citation-verification-ledger.md, plus the
 *                      four later entries it marks pending or unverified.
 *   pin                the "Pin targets" table of each protocol.
 *
 * \`tier\` is the ledger's evidence tier. null means the ledger does not cover
 * the work, and the page marks it "record not yet verified". That is a
 * statement about the ledger's coverage, not a judgement about the source:
 * the ledger verified the paper's reference list, and the protocols cite a
 * largely different set of works. Nothing here verifies a citation, and no DOI
 * or URL appears that the sources do not contain.
 */
import { z } from 'zod';

export const TIERS = ['P1', 'P2', 'P3', 'P1/P2'] as const;
export type Tier = (typeof TIERS)[number];

export const referenceSchema = z.object({
  /** Stable key. Content modules cite by this and only this. */
  key: z.string().min(1),
  /** The token the sources use for this work. */
  citedAs: z.string().min(1),
  /** The path or citation as the source gives it. */
  source: z.string().min(1),
  kind: z.enum(['corpus', 'external', 'pin', 'ledger']),
  /** The ledger's evidence tier, or null where the ledger does not cover it. */
  tier: z.enum(TIERS).nullable(),
  ledgerRow: z.number().int().nullable(),
  /** Protocol slugs whose Pin targets table names this work. */
  citedBy: z.array(z.string()),
});

export type Reference = z.infer<typeof referenceSchema>;

export const REFERENCES: readonly Reference[] = z.array(referenceSchema).parse(`;

const FOOTER = `);

const BY_KEY = new Map(REFERENCES.map((r) => [r.key, r]));

export const referenceKeys = (): string[] => REFERENCES.map((r) => r.key);

export function reference(key: string): Reference {
  const r = BY_KEY.get(key);
  if (!r) throw new Error(\`Unknown reference key: \${key}\`);
  return r;
}

/** A citation list rendered as the sources' own tokens, e.g. "UCM · WtD". */
export const citeLabel = (keys: readonly string[]): string => keys.map((k) => reference(k).citedAs).join(' · ');

/** The mark a work carries when the ledger does not cover its record. */
export const UNVERIFIED_MARK = 'record not yet verified';

export const isVerified = (r: Reference): boolean => r.tier !== null;

export const unverified = (): Reference[] => REFERENCES.filter((r) => !isVerified(r));
`;

/** The text of content/references.ts. */
export function fileText(): string {
  return `${HEADER}${JSON.stringify(derive(), null, 2)}${FOOTER}`;
}
