/**
 * Measures — totals and subscales from published instruments.
 *
 * Proposal 03 §2. Item-level responses are deliberately not modelled here or
 * stored anywhere: some items are sensitive in a way a total is not (PHQ-9
 * item 9 in particular), and storing them would put the crisis rules in the
 * position of needing to read them. Totals and subscales only.
 *
 * **No item text from any instrument appears in this repository.** These are
 * copyrighted, validated instruments; the app records a score somebody else's
 * form produced. `counts_for` in `packages/shared/src/vocabulary/` is our own
 * question, asked in our own words, and measures the same construct as the
 * Immunization Scale at a different grain — one miss rather than an interval.
 *
 * Proposal 06 arrives with the IMS specifically because hypothesis H3 in
 * proposal 03 reads the two against each other: the per-miss discount and the
 * validated instrument should move together or the construct is not what we
 * think it is.
 */
import { z } from 'zod';

export const INSTRUMENTS = [
  'phq9',
  'gad7',
  'pcl5',
  'pdss',
  'isi',
  'ocir',
  'shai',
  'pg13',
  'ims',
  'sus',
  'umars',
] as const;

export type Instrument = (typeof INSTRUMENTS)[number];
export const instrumentSchema = z.enum(INSTRUMENTS);

export interface InstrumentSpec {
  id: Instrument;
  /** The instrument's name. Its items are not reproduced here or anywhere. */
  name: string;
  /** Inclusive bounds of the total. */
  min: number;
  max: number;
  /** Published subscale names, or empty for a single-score instrument. */
  subscales: readonly string[];
  /** Where the scoring came from, so a wrong range is traceable to a source. */
  source: string;
}

/**
 * The instruments the protocols name, plus the two usability scales.
 *
 * Ranges are the published totals. They are here to reject a typo — a PHQ-9 of
 * 47 is a slip, not a score — and not to interpret anything: nothing in this
 * module turns a number into a severity band, a label, or a recommendation.
 */
export const INSTRUMENT_SPECS: Readonly<Record<Instrument, InstrumentSpec>> = {
  phq9: { id: 'phq9', name: 'PHQ-9', min: 0, max: 27, subscales: [], source: 'Kroenke, Spitzer & Williams 2001' },
  gad7: { id: 'gad7', name: 'GAD-7', min: 0, max: 21, subscales: [], source: 'Spitzer et al. 2006' },
  pcl5: { id: 'pcl5', name: 'PCL-5', min: 0, max: 80, subscales: [], source: 'Weathers et al. 2013' },
  pdss: { id: 'pdss', name: 'PDSS', min: 0, max: 28, subscales: [], source: 'Shear et al. 1997' },
  isi: { id: 'isi', name: 'ISI', min: 0, max: 28, subscales: [], source: 'Bastien, Vallières & Morin 2001' },
  ocir: { id: 'ocir', name: 'OCI-R', min: 0, max: 72, subscales: [], source: 'Foa et al. 2002' },
  shai: { id: 'shai', name: 'SHAI', min: 0, max: 54, subscales: [], source: 'Salkovskis et al. 2002' },
  pg13: { id: 'pg13', name: 'PG-13', min: 11, max: 55, subscales: [], source: 'Prigerson et al. 2009' },
  ims: {
    id: 'ims',
    name: 'Immunization Scale',
    min: 0,
    max: 100,
    // The three subscales, by their published names. Values only; no items.
    subscales: ['negative_expectations', 'assimilation', 'cognitive_immunization'],
    source: 'Ewen, Rief & Wilhelm 2022',
  },
  sus: { id: 'sus', name: 'System Usability Scale', min: 0, max: 100, subscales: [], source: 'Brooke 1996' },
  umars: { id: 'umars', name: 'uMARS', min: 1, max: 5, subscales: [], source: 'Stoyanov et al. 2016' },
};

export const instrument = (id: string): InstrumentSpec | undefined =>
  INSTRUMENT_SPECS[id as Instrument] as InstrumentSpec | undefined;

export const isInstrument = (id: unknown): id is Instrument =>
  typeof id === 'string' && Object.hasOwn(INSTRUMENT_SPECS, id);

/**
 * The subscale names an instrument publishes, and nothing else.
 *
 * A subscale the instrument does not have is a rejection rather than an extra
 * key: `subscales` is jsonb, and jsonb is a tempting place to put a note.
 */
export function unknownSubscales(id: Instrument, subscales: Record<string, unknown>): string[] {
  const known = new Set(INSTRUMENT_SPECS[id].subscales);
  return Object.keys(subscales).filter((k) => !known.has(k));
}

export const ADMINISTERED_BY = ['client', 'clinician'] as const;
export type AdministeredBy = (typeof ADMINISTERED_BY)[number];

/** One measurement. Append-only: a re-administration is a new row at a new time. */
export const measureSchema = z
  .object({
    instrument: instrumentSchema,
    score: z.number().finite(),
    /** Numeric values keyed by the instrument's published subscale names. */
    subscales: z.record(z.string(), z.number().finite()).nullish(),
    administeredAt: z.string().datetime({ offset: true }),
    administeredBy: z.enum(ADMINISTERED_BY),
  })
  .superRefine((m, ctx) => {
    const spec = INSTRUMENT_SPECS[m.instrument];
    if (m.score < spec.min || m.score > spec.max) {
      ctx.addIssue({
        code: 'custom',
        path: ['score'],
        // The range, not the value: this message reaches a client.
        message: `${spec.name} totals run ${spec.min}–${spec.max}`,
      });
    }
    if (m.subscales) {
      const unknown = unknownSubscales(m.instrument, m.subscales);
      if (unknown.length > 0) {
        ctx.addIssue({ code: 'custom', path: ['subscales'], message: `not a ${spec.name} subscale` });
      }
    }
  });

export type Measure = z.infer<typeof measureSchema>;

/**
 * Two IMS administrations, as a direction of travel.
 *
 * Deliberately not a verdict: it returns the change and the days between, and
 * says nothing about whether the change is good, clinically meaningful, or
 * caused by anything. Interpretation is the clinician's.
 */
export interface MeasureChange {
  from: number;
  to: number;
  delta: number;
  days: number;
}

export function change(
  earlier: { score: number; administeredAt: string },
  later: { score: number; administeredAt: string },
): MeasureChange {
  const ms = Date.parse(later.administeredAt) - Date.parse(earlier.administeredAt);
  return {
    from: earlier.score,
    to: later.score,
    delta: later.score - earlier.score,
    days: Math.round(ms / 86_400_000),
  };
}
