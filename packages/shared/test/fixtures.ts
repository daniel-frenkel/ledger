import type { BodyState, Prediction, Prior, Reinterpretation } from '../src/index.js';

const T0 = '2026-09-01T18:00:00.000Z';
let seq = 0;
export const id = (n?: number) => {
  const k = n ?? ++seq;
  return `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
};

export const prior = (over: Partial<Prior> = {}): Prior => ({
  id: id(),
  label: 'If I show weakness, they withdraw.',
  category: 'mattering',
  origin: 'client',
  createdBy: 'client',
  createdAt: T0,
  clientUpdatedAt: T0,
  ...over,
});

export const open = (over: Partial<Prediction> = {}): Prediction => ({
  id: id(),
  situation: 'Telling my brother I can’t make the trip.',
  expectedOutcome: 'He goes quiet and doesn’t call for weeks.',
  confidence: 80,
  priorIds: [],
  createdAt: T0,
  clientUpdatedAt: T0,
  ...over,
});

export const resolved = (
  verdict: 'hit' | 'partial' | 'miss' | 'unclear',
  over: Partial<Prediction> = {},
): Prediction =>
  open({
    resolvedAt: '2026-09-02T18:00:00.000Z',
    actualOutcome: 'He said okay and asked about next month.',
    outcomeVerdict: verdict,
    outcomeSource: 'observed',
    surpriseRating: verdict === 'miss' ? 7 : 2,
    presentForIt: true,
    ...over,
  });

export const abandoned = (over: Partial<Prediction> = {}): Prediction =>
  open({ abandonedAt: '2026-09-02T18:00:00.000Z', abandonReason: 'avoided', ...over });

export const reinterp = (predictionId: string, over: Partial<Reinterpretation> = {}): Reinterpretation => ({
  id: id(),
  predictionId,
  text: 'He was only being nice because Mom was there.',
  createdAt: '2026-09-02T18:05:00.000Z',
  clientUpdatedAt: '2026-09-02T18:05:00.000Z',
  ...over,
});

export const bodyAfter = (predictionId: string, over: Partial<NonNullable<BodyState['after']>> = {}): BodyState => ({
  id: id(),
  predictionId,
  phase: 'after',
  after: {
    peakIntensity: 8,
    ranPastPeak: true,
    verdictArrived: 'no',
    creditedTo: 'body',
    kitUsed: [],
    ...over,
  },
  createdAt: '2026-09-02T18:00:00.000Z',
  clientUpdatedAt: '2026-09-02T18:00:00.000Z',
});
