/**
 * Every work the corpus cites, and what the verification ledger says about it.
 *
 * Two sources, both structured, neither interpreted:
 *
 *   docs/theory/citation-verification-ledger.md   the signed Pass-1 table, 49
 *                                                 numbered rows with an evidence
 *                                                 tier, plus four later entries
 *                                                 the ledger marks pending or
 *                                                 unverified.
 *   docs/theory/protocols/*.md "Pin targets"      each protocol's own citation
 *                                                 table: lead, what it is for,
 *                                                 and whether it is pinned.
 *
 * Matching a cited work to a ledger row is deliberately conservative — see
 * ledgerMatch. Nothing here verifies a citation, adds a DOI, or repairs a
 * reference; a work the ledger does not cover is reported as not covered.
 *
 * The clinical note's "Verification block" is prose, not a table, and the
 * document itself says every lead in it is unverified. It is left as prose on
 * its page rather than parsed into rows here.
 */
import { sourceByName, sourcesIn } from './sources';

export type Tier = 'P1' | 'P2' | 'P3' | 'P1/P2';

export interface LedgerEntry {
  /** Row number in the ledger table, or null for the addenda. */
  row: number | null;
  reference: string;
  /** null where the ledger records the work but has not verified it. */
  tier: Tier | null;
  /** The ledger's own verdict wording. */
  verdict: string;
}

const TIERS = new Set(['P1', 'P2', 'P3', 'P1/P2']);

const cells = (line: string): string[] =>
  line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** Strip the markdown a table cell carries, leaving the text. */
const plain = (s: string): string =>
  s
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The ledger's own record of every reference it checked. */
export function ledgerEntries(): LedgerEntry[] {
  const doc = sourceByName('citation-verification-ledger');
  if (!doc) return [];
  const out: LedgerEntry[] = [];

  for (const line of doc.body.split('\n')) {
    if (!line.startsWith('|')) continue;
    const c = cells(line);
    if (c.length < 5) continue;
    const row = Number(c[0]);
    if (!Number.isInteger(row)) continue;
    const tier = plain(c[2] ?? '');
    out.push({
      row,
      reference: plain(c[1] ?? ''),
      tier: TIERS.has(tier) ? (tier as Tier) : null,
      verdict: plain(c[4] ?? ''),
    });
  }

  // The two addendum entries, recorded but explicitly not verified.
  // The reference is bold and contains a nested italic title, so the body is
  // lazy — but confined to one line, or it runs past the "three corrections"
  // headings above and swallows the entry it was aiming at.
  for (const m of doc.body.matchAll(/^\*\*(\d+)\.\s+([^\n]*?)\*\*\s*—\s*Status:\s*\*\*([^*\n]+)\*\*/gm)) {
    out.push({
      row: Number(m[1]),
      reference: plain(m[2] ?? ''),
      tier: null,
      verdict: plain(m[3] ?? ''),
    });
  }

  // The post-pass additions table: | Source | Status | Verified by |
  for (const line of doc.body.split('\n')) {
    if (!line.startsWith('| Rogers')) continue;
    const c = cells(line);
    out.push({ row: null, reference: plain(c[0] ?? ''), tier: null, verdict: plain(c[1] ?? '') });
  }

  return out;
}

export interface PinTarget {
  /** The protocol slug whose table this row is in. */
  protocol: string;
  /** The "Lead" column, verbatim of its markdown. */
  lead: string;
  /** The "For" column. */
  forWhat: string;
  /** The "Status" column: PINNED, unpinned, and the ledger notes. */
  status: string;
}

/** Every row of every protocol's "Pin targets" table. */
export function pinTargets(): PinTarget[] {
  const out: PinTarget[] = [];
  for (const doc of sourcesIn('protocols')) {
    const start = /^##\s+Pin targets\s*$/m.exec(doc.body);
    if (!start) continue;
    const after = doc.body.slice(start.index + start[0].length);
    const end = /^#{1,2}\s+/m.exec(after);
    const table = end ? after.slice(0, end.index) : after;
    for (const line of table.split('\n')) {
      if (!line.startsWith('|')) continue;
      const c = cells(line);
      if (c.length < 3) continue;
      const lead = plain(c[0] ?? '');
      if (lead === '' || lead === 'Lead' || /^[-: ]+$/.test(lead)) continue;
      out.push({ protocol: doc.name, lead, forWhat: plain(c[1] ?? ''), status: plain(c[2] ?? '') });
    }
  }
  return out;
}

/** Surnames in a citation string: capitalised words before a year or a comma. */
export function surnames(s: string): string[] {
  const head = s.split(/\d{4}/)[0] ?? s;
  return [...head.matchAll(/\b([A-Z][a-zà-ÿA-Z'’-]{2,})\b/g)]
    .map((m) => (m[1] ?? '').toLowerCase())
    .filter((w) => !['the', 'and', 'for', 'sleep', 'block', 'et', 'al'].includes(w));
}

export const years = (s: string): string[] => [...s.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => m[0]);

/**
 * The ledger row covering a cited work.
 *
 * Deliberately conservative, because deciding that two citations are the same
 * work is verification, and verification is the author's signature, not this
 * module's:
 *
 *   lead carries a year   a shared surname and a shared year. Both, because
 *                         "Clark 1986" in the panic protocol is not the
 *                         ledger's "Clark (2016)" — matching on surname alone
 *                         would claim a verification that was never done.
 *   no year, 2+ surnames  every surname in the lead must appear in the row.
 *                         "Klass, Silverman & Nickman" is unambiguous.
 *   no year, 1 surname    no match. A bare "Joiner" or "Barlow" does not say
 *                         which work, so the ledger cannot be said to cover it.
 */
export function ledgerMatch(lead: string, ledger: readonly LedgerEntry[]): LedgerEntry | null {
  const ls = surnames(lead);
  const ly = new Set(years(lead));
  if (ls.length === 0) return null;

  if (ly.size > 0) {
    for (const e of ledger) {
      const es = surnames(e.reference);
      if (es.some((s) => ls.includes(s)) && years(e.reference).some((y) => ly.has(y))) return e;
    }
    return null;
  }

  if (ls.length < 2) return null;
  for (const e of ledger) {
    const es = new Set(surnames(e.reference));
    if (ls.every((s) => es.has(s))) return e;
  }
  return null;
}
