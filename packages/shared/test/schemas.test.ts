import { describe, expect, it } from 'vitest';
import { bodyStateSchema, predictionSchema, syncPushSchema } from '../src/index.js';
import { id, open, resolved } from './fixtures.js';

describe('predictionSchema', () => {
  it('accepts an open prediction', () => {
    expect(predictionSchema.safeParse(open()).success).toBe(true);
  });
  it('requires a verdict once resolved', () => {
    const r = predictionSchema.safeParse({ ...resolved('hit'), outcomeVerdict: undefined });
    expect(r.success).toBe(false);
  });
  it('rejects resolved + abandoned', () => {
    const r = predictionSchema.safeParse({ ...resolved('hit'), abandonedAt: '2026-09-02T00:00:00.000Z', abandonReason: 'avoided' });
    expect(r.success).toBe(false);
  });
  it('requires a reason when abandoned', () => {
    const r = predictionSchema.safeParse({ ...open(), abandonedAt: '2026-09-02T00:00:00.000Z' });
    expect(r.success).toBe(false);
  });
  it('bounds confidence to 0–100 integers', () => {
    expect(predictionSchema.safeParse(open({ confidence: 101 })).success).toBe(false);
    expect(predictionSchema.safeParse(open({ confidence: 50.5 })).success).toBe(false);
    expect(predictionSchema.safeParse(open({ confidence: 0 })).success).toBe(true);
  });
});

describe('bodyStateSchema', () => {
  it('requires exactly the payload for its phase', () => {
    const base = { id: id(), predictionId: id(), createdAt: '2026-09-01T00:00:00.000Z', clientUpdatedAt: '2026-09-01T00:00:00.000Z' };
    expect(bodyStateSchema.safeParse({ ...base, phase: 'before', before: { intensity: 5 } }).success).toBe(true);
    expect(bodyStateSchema.safeParse({ ...base, phase: 'before' }).success).toBe(false);
    expect(
      bodyStateSchema.safeParse({
        ...base,
        phase: 'after',
        after: { peakIntensity: 8, ranPastPeak: true, verdictArrived: 'no', creditedTo: 'body' },
      }).success,
    ).toBe(true);
  });
  it('caps prose fields so paragraphs cannot land in the body record', () => {
    const base = { id: id(), predictionId: id(), createdAt: '2026-09-01T00:00:00.000Z', clientUpdatedAt: '2026-09-01T00:00:00.000Z' };
    const r = bodyStateSchema.safeParse({ ...base, phase: 'before', before: { intensity: 5, verdict: 'x'.repeat(81) } });
    expect(r.success).toBe(false);
  });
});

describe('syncPushSchema', () => {
  it('defaults every collection to empty', () => {
    const r = syncPushSchema.parse({ deviceId: id() });
    expect(r.predictions).toEqual([]);
    expect(r.crisisEvents).toEqual([]);
  });
});
