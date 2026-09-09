/**
 * content/references.ts is generated. This is what stops it drifting from the
 * sources it was generated out of.
 *
 * It exists because references.ts has to be free of `node:fs` — the locator on
 * /formulate is a client component and imports content/floors.ts, which imports
 * it — so the list cannot be derived at render time. It is derived here instead,
 * and compared.
 */
import { describe, expect, it } from 'vitest';
import { REFERENCES, UNVERIFIED_MARK, isVerified, unverified } from '../content/references';
import { derive } from '../lib/markdown/build-references';
import { ledgerEntries, ledgerMatch, pinTargets, surnames, years } from '../lib/markdown/citations';

describe('the generated list still matches the sources', () => {
  it('regenerates identically — run `pnpm build:references` if this fails', () => {
    expect(REFERENCES).toEqual(derive());
  });
});

describe('the ledger, as parsed', () => {
  const ledger = ledgerEntries();

  it('has the 49 rows of the signed pass, plus the four later entries', () => {
    expect(ledger.filter((e) => e.row !== null && e.row <= 49)).toHaveLength(49);
    expect(ledger).toHaveLength(53);
  });

  it('gives every row of the signed pass a tier', () => {
    for (const e of ledger.filter((x) => x.row !== null && x.row <= 49)) {
      expect(e.tier, e.reference).not.toBeNull();
    }
  });

  it('leaves exactly the four the ledger itself calls pending or unverified', () => {
    const untiered = ledger.filter((e) => e.tier === null).map((e) => e.reference);
    expect(untiered).toHaveLength(4);
    expect(untiered.join(' | ')).toMatch(/Ratts/);
    expect(untiered.join(' | ')).toMatch(/Spielman/);
    expect(untiered.filter((r) => r.startsWith('Rogers'))).toHaveLength(2);
  });
});

describe('every work cited across the corpus is in the list', () => {
  it('every Pin targets lead in every protocol, by its own name or its ledger row', () => {
    const ledger = ledgerEntries();
    const have = new Set(REFERENCES.map((r) => r.citedAs));
    const missing = [...new Set(pinTargets().map((p) => p.lead))].filter(
      (lead) => !have.has(lead) && !have.has(ledgerMatch(lead, ledger)?.reference ?? ''),
    );
    expect(missing).toEqual([]);
  });

  it('every ledger reference', () => {
    const have = new Set(REFERENCES.map((r) => r.citedAs));
    for (const e of ledgerEntries()) expect(have.has(e.reference), e.reference).toBe(true);
  });

  it('records which protocols cite each work, on the ledger row where there is one', () => {
    // The grief protocol's "Klass, Silverman & Nickman" is ledger row 29, so
    // the protocol is recorded there rather than as a second entry.
    const grief = REFERENCES.filter((r) => r.citedAs.startsWith('Klass, Silverman'));
    expect(grief).toHaveLength(1);
    expect(grief[0]?.kind).toBe('ledger');
    expect(grief[0]?.citedBy).toContain('prolonged-grief');

    const craske = REFERENCES.filter((r) => r.citedAs.startsWith('Craske, Treanor'));
    expect(craske).toHaveLength(1);
    expect(craske[0]?.citedBy.length).toBeGreaterThan(4);
  });
});

describe('tiers are read off the ledger, never invented', () => {
  const ledger = ledgerEntries();

  it('every tier on an entry is the tier the ledger gives that row', () => {
    for (const r of REFERENCES.filter((x) => x.tier !== null)) {
      const row = ledger.find((e) => e.row === r.ledgerRow);
      expect(row?.tier, r.key).toBe(r.tier);
    }
  });

  it('does not claim a match on surname alone', () => {
    // The panic protocol cites Clark 1986 on catastrophic misinterpretation.
    // The ledger's Clark is Surfing Uncertainty (2016). Different work.
    const clark = REFERENCES.find((r) => r.citedAs.startsWith('Clark 1986'));
    expect(clark).toBeDefined();
    expect(clark?.tier).toBeNull();
    expect(ledgerMatch('Clark 1986, Behaviour Research and Therapy', ledger)).toBeNull();
  });

  it('does not guess which work a bare surname means', () => {
    expect(surnames('Joiner')).toEqual(['joiner']);
    expect(years('Joiner')).toEqual([]);
    expect(ledgerMatch('Joiner', ledger)).toBeNull();
  });

  it('does match when every surname in the lead is in the row', () => {
    expect(ledgerMatch('Klass, Silverman & Nickman', ledger)?.tier).toBe('P1');
  });
});

describe('the unverified mark', () => {
  it('covers every entry without a tier, and only those', () => {
    expect(unverified()).toEqual(REFERENCES.filter((r) => r.tier === null));
    for (const r of unverified()) expect(isVerified(r)).toBe(false);
  });

  it('is the wording the pages render', () => {
    expect(UNVERIFIED_MARK).toBe('record not yet verified');
  });

  it('marks every protocol citation the ledger does not reach', () => {
    // Not a defect. Pass 1 verified the reference list of the paper; the
    // protocols cite a largely different set of works, and the ledger says so.
    // A pin entry exists precisely when no ledger row covers it, so all of
    // them carry the mark.
    const pins = REFERENCES.filter((r) => r.kind === 'pin');
    expect(pins.length).toBeGreaterThan(90);
    expect(pins.every((r) => r.tier === null)).toBe(true);
  });
});
