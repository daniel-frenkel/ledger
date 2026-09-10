/**
 * Measures — totals and subscales, and the things that must never be here.
 *
 * The first test in this file is the important one: no instrument's item text
 * appears in this repository. These are copyrighted, validated instruments and
 * the app records a score somebody else's form produced.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ADMINISTERED_BY,
  COUNTS_FOR,
  INSTRUMENTS,
  INSTRUMENT_SPECS,
  change,
  instrument,
  isInstrument,
  measureSchema,
  unknownSubscales,
} from '../src/index.js';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

describe('the boundary around published instruments', () => {
  it('stores no item text and no item-level field, anywhere in the module', () => {
    const text = fs.readFileSync(path.join(src, 'measures/index.ts'), 'utf8');
    // The shape of an item bank: a numbered list, an `items` array, a response
    // scale. None of it belongs in this repository.
    expect(text).not.toMatch(/\bitems\s*:/);
    expect(text).not.toMatch(/\bresponses\s*:/);
    expect(text).not.toMatch(/Over the last two weeks/i);
    expect(text).not.toMatch(/Little interest or pleasure/i);
  });

  it('interprets nothing: no severity bands, no cut-offs, no labels', () => {
    const text = fs.readFileSync(path.join(src, 'measures/index.ts'), 'utf8');
    expect(text).not.toMatch(/severe|moderate|cutoff|cut-off|clinically significant/i);
  });

  it('keeps our own question ours', () => {
    // counts_for measures the same construct as the IMS at a different grain.
    // It is written in our words on purpose, and is not an IMS item.
    expect(COUNTS_FOR.label).toBe('How much does this one count?');
    expect(COUNTS_FOR.hint).not.toMatch(/immuniz/i);
  });
});

describe('the catalogue', () => {
  it('has a spec for every instrument and no orphans', () => {
    expect(Object.keys(INSTRUMENT_SPECS).sort()).toEqual([...INSTRUMENTS].sort());
    for (const id of INSTRUMENTS) expect(INSTRUMENT_SPECS[id].id, id).toBe(id);
  });

  it('gives every instrument a sane range and a source', () => {
    for (const id of INSTRUMENTS) {
      const s = INSTRUMENT_SPECS[id];
      expect(s.max, id).toBeGreaterThan(s.min);
      expect(s.source, id).toMatch(/\d{4}/);
    }
  });

  it('gives the IMS its three published subscales and nothing else', () => {
    expect(INSTRUMENT_SPECS.ims.subscales).toEqual([
      'negative_expectations',
      'assimilation',
      'cognitive_immunization',
    ]);
    expect(INSTRUMENT_SPECS.ims.source).toMatch(/Ewen, Rief & Wilhelm 2022/);
  });

  it('recognises an instrument id', () => {
    expect(isInstrument('ims')).toBe(true);
    expect(isInstrument('custom')).toBe(false);
    expect(isInstrument('toString')).toBe(false);
    expect(instrument('phq9')?.max).toBe(27);
  });

  it('names a subscale the instrument does not publish', () => {
    expect(unknownSubscales('ims', { assimilation: 3, mood: 7 })).toEqual(['mood']);
    // A single-score instrument publishes none, so every key is unknown.
    expect(unknownSubscales('phq9', { somatic: 4 })).toEqual(['somatic']);
  });
});

describe('measureSchema', () => {
  const base = {
    instrument: 'ims' as const,
    score: 42,
    administeredAt: '2026-09-01T18:00:00.000Z',
    administeredBy: 'clinician' as const,
  };

  it('accepts a total in range with published subscales', () => {
    const out = measureSchema.safeParse({
      ...base,
      subscales: { negative_expectations: 12, assimilation: 15, cognitive_immunization: 15 },
    });
    expect(out.success).toBe(true);
  });

  it('rejects a total outside the published range, and says the range not the value', () => {
    const out = measureSchema.safeParse({ ...base, instrument: 'phq9', score: 47 });
    expect(out.success).toBe(false);
    const message = out.success ? '' : out.error.issues[0]!.message;
    expect(message).toBe('PHQ-9 totals run 0–27');
    expect(message).not.toContain('47');
  });

  it('rejects a subscale the instrument does not publish', () => {
    const out = measureSchema.safeParse({ ...base, subscales: { rumination: 9 } });
    expect(out.success).toBe(false);
  });

  it('rejects prose in a subscale value', () => {
    const out = measureSchema.safeParse({ ...base, subscales: { assimilation: 'high' } });
    expect(out.success).toBe(false);
  });

  it('accepts both ways a measure is administered and nothing else', () => {
    expect(ADMINISTERED_BY).toEqual(['client', 'clinician']);
    expect(measureSchema.safeParse({ ...base, administeredBy: 'assistant' }).success).toBe(false);
  });
});

describe('change', () => {
  it('reports the direction and the interval and no verdict', () => {
    const c = change(
      { score: 60, administeredAt: '2026-09-01T00:00:00.000Z' },
      { score: 45, administeredAt: '2026-10-01T00:00:00.000Z' },
    );
    expect(c).toEqual({ from: 60, to: 45, delta: -15, days: 30 });
    // No "improved", no "better": on the IMS a fall is a fall, and what it
    // means is the clinician's to say.
    expect(Object.keys(c).sort()).toEqual(['days', 'delta', 'from', 'to']);
  });
});
