import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { summarize, type Prediction, type SyncPull } from '@ledger/shared';
import { closeDb } from '../src/db/client.js';
import { CLIENT_A, CLIENT_B, DEVICE_A, asUser, buildApp, truncateAll, uid } from './helpers.js';

let app: FastifyInstance;

const T1 = '2026-09-01T18:00:00.000Z';
const T2 = '2026-09-02T18:00:00.000Z';
const T3 = '2026-09-03T18:00:00.000Z';

function openPrediction(n: number, over: Partial<Prediction> = {}): Prediction {
  return {
    id: uid(100 + n),
    situation: `Situation ${n}: telling my brother I can’t make the trip.`,
    expectedOutcome: 'He goes quiet and doesn’t call for weeks.',
    confidence: 80,
    priorIds: [],
    createdAt: T1,
    clientUpdatedAt: T1,
    ...over,
  };
}

async function push(user: string, body: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: '/v1/sync', headers: asUser(user), payload: { deviceId: DEVICE_A, ...body } });
  return { status: res.statusCode, body: res.json() as SyncPull };
}

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await closeDb();
});
beforeEach(truncateAll);

describe('POST /v1/sync', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/sync', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('rejects clinicians', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/sync', headers: asUser(uid(3), 'clinician'), payload: { deviceId: DEVICE_A } });
    expect(res.statusCode).toBe(403);
  });

  it('returns field paths, not values, on a bad payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync',
      headers: asUser(CLIENT_A),
      payload: { deviceId: DEVICE_A, predictions: [openPrediction(1, { confidence: 150 })] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('predictions.0.confidence');
    expect(res.body).not.toContain('brother');
  });

  it('milestone: create → resolve → calibration sentence, round-tripped through the server', async () => {
    // 14 predictions at 80%; resolve 12 as miss, 2 as hit
    const preds = Array.from({ length: 14 }, (_, i) => openPrediction(i));
    const r1 = await push(CLIENT_A, { predictions: preds });
    expect(r1.status).toBe(200);
    expect(r1.body.predictions).toHaveLength(14);
    expect(r1.body.rejected).toEqual([]);

    const resolved = preds.map((p, i) => ({
      ...p,
      resolvedAt: T2,
      actualOutcome: 'He said okay and asked about next month.',
      outcomeVerdict: i < 2 ? 'hit' : 'miss',
      outcomeSource: 'observed',
      surpriseRating: 7,
      presentForIt: true,
      clientUpdatedAt: T2,
    }));
    const r2 = await push(CLIENT_A, { predictions: resolved, since: r1.body.serverTime });
    expect(r2.status).toBe(200);
    expect(r2.body.predictions).toHaveLength(14);

    const s = summarize(r2.body.predictions, 'rejection');
    expect(s.sentence).toBe('You predicted rejection 14 times at an average of 80% confidence. It happened 2 times.');
    // decrypted text made it back intact
    expect(r2.body.predictions[0]!.situation).toMatch(/brother/);
  });

  it('is scoped by user: B never sees A', async () => {
    await push(CLIENT_A, { predictions: [openPrediction(1)] });
    const rb = await push(CLIENT_B, {});
    expect(rb.body.predictions).toEqual([]);
    // B pushing A's id is written under B's own user_id, not A's — and A still sees only its own row
    const ra = await push(CLIENT_A, {});
    expect(ra.body.predictions.map((p) => p.id)).toEqual([uid(101)]);
  });

  it('last write wins by client_updated_at; a stale device cannot overwrite', async () => {
    const p = openPrediction(1);
    await push(CLIENT_A, { predictions: [{ ...p, confidence: 80, clientUpdatedAt: T3 }] });
    const stale = await push(CLIENT_A, { predictions: [{ ...p, confidence: 20, clientUpdatedAt: T2 }] });
    expect(stale.body.predictions[0]!.confidence).toBe(80);
  });

  it('pull with since returns only rows changed after the cursor', async () => {
    const r1 = await push(CLIENT_A, { predictions: [openPrediction(1)] });
    const r2 = await push(CLIENT_A, { since: r1.body.serverTime });
    expect(r2.body.predictions).toEqual([]);
    const r3 = await push(CLIENT_A, { predictions: [openPrediction(2)], since: r1.body.serverTime });
    expect(r3.body.predictions.map((p) => p.id)).toEqual([uid(102)]);
  });

  it('re-runs the crisis rules server-side and logs a crisis event with rule ids only', async () => {
    const p = openPrediction(1, { expectedOutcome: 'Honestly they would be better off without me.' });
    const r = await push(CLIENT_A, { predictions: [p] });
    expect(r.body.crisisEvents).toHaveLength(1);
    const ev = r.body.crisisEvents[0]!;
    expect(ev.source).toBe('prediction');
    expect(ev.sourceEntryId).toBe(p.id);
    expect(ev.ruleIds).toEqual(['R07_better_off_without']);
    expect(ev.resourcesShown).toEqual(['lifeline_988', 'vcl_call', 'vcl_text']);
    expect(ev.detectedOnDevice).toBe(false);
    expect(JSON.stringify(ev)).not.toMatch(/better off/);
  });

  it('dedupes a client-detected crisis event with the server re-check', async () => {
    const p = openPrediction(1, { expectedOutcome: 'I want to die.' });
    const r = await push(CLIENT_A, {
      predictions: [p],
      crisisEvents: [
        {
          id: uid(500),
          source: 'prediction',
          sourceEntryId: p.id,
          ruleIds: ['R03_want_to_die'],
          resourcesShown: ['lifeline_988', 'vcl_call', 'vcl_text'],
          detectedOnDevice: true,
          acknowledgedAt: T1,
          createdAt: T1,
        },
      ],
    });
    expect(r.body.crisisEvents).toHaveLength(1);
    expect(r.body.crisisEvents[0]!.id).toBe(uid(500));
    expect(r.body.crisisEvents[0]!.detectedOnDevice).toBe(true);
    expect(r.body.crisisEvents[0]!.acknowledgedAt).toBeTruthy();
  });

  it('stores reinterpretations append-only: an edit is ignored, a soft-delete is honored', async () => {
    const p = openPrediction(1);
    const re = { id: uid(300), predictionId: p.id, text: 'He was only being nice.', createdAt: T2, clientUpdatedAt: T2 };
    await push(CLIENT_A, { predictions: [p], reinterpretations: [re] });
    const edited = await push(CLIENT_A, { reinterpretations: [{ ...re, text: 'CHANGED', clientUpdatedAt: T3 }] });
    expect(edited.body.reinterpretations[0]!.text).toBe('He was only being nice.');
    const deleted = await push(CLIENT_A, { reinterpretations: [{ ...re, deletedAt: T3, clientUpdatedAt: T3 }] });
    expect(deleted.body.reinterpretations[0]!.deletedAt).toBeTruthy();
  });

  it('round-trips body states with encrypted prose and typed enums', async () => {
    const p = openPrediction(1);
    const before = {
      id: uid(400),
      predictionId: p.id,
      phase: 'before',
      before: { channels: ['heart', 'breath'], intensity: 7, words: ['tight', 'buzzing'], verdict: 'heart → dying', verdictConfidence: 85, room: 'the VA lobby', kitPresent: ['water'] },
      createdAt: T1,
      clientUpdatedAt: T1,
    };
    const after = {
      id: uid(401),
      predictionId: p.id,
      phase: 'after',
      after: { peakIntensity: 8, ranPastPeak: true, timeToCrestMin: 12, verdictArrived: 'no', creditedTo: 'body', kitUsed: [], wordNow: 'shaky' },
      createdAt: T2,
      clientUpdatedAt: T2,
    };
    const r = await push(CLIENT_A, { predictions: [p], bodyStates: [before, after] });
    expect(r.body.rejected).toEqual([]);
    const b = r.body.bodyStates.find((x) => x.phase === 'before')!;
    expect(b.before).toMatchObject({ channels: ['heart', 'breath'], intensity: 7, words: ['tight', 'buzzing'], verdict: 'heart → dying', room: 'the VA lobby' });
    const a = r.body.bodyStates.find((x) => x.phase === 'after')!;
    expect(a.after).toMatchObject({ verdictArrived: 'no', creditedTo: 'body', wordNow: 'shaky', timeToCrestMin: 12 });
  });

  it('reports a DB rejection for one row without failing the batch', async () => {
    const good = openPrediction(1);
    // body state referencing a prediction that does not exist → FK failure
    const orphan = {
      id: uid(402),
      predictionId: uid(999),
      phase: 'before',
      before: { intensity: 3 },
      createdAt: T1,
      clientUpdatedAt: T1,
    };
    const r = await push(CLIENT_A, { predictions: [good], bodyStates: [orphan] });
    expect(r.status).toBe(200);
    expect(r.body.predictions).toHaveLength(1);
    expect(r.body.rejected).toEqual([{ id: uid(402), table: 'body_states', code: expect.any(String) }]);
  });

  it('tags predictions with priors and returns them', async () => {
    const prior = { id: uid(200), label: 'If I show weakness, they withdraw.', category: 'mattering', origin: 'client', createdBy: 'client', createdAt: T1, clientUpdatedAt: T1 };
    const p = openPrediction(1, { priorIds: [prior.id] });
    const r = await push(CLIENT_A, { priors: [prior], predictions: [p] });
    expect(r.body.priors[0]!.label).toBe(prior.label);
    expect(r.body.predictions[0]!.priorIds).toEqual([prior.id]);
  });

  it('reports an edit to an existing reinterpretation as append_only and returns the server copy', async () => {
    const p = openPrediction(1);
    const re = { id: uid(300), predictionId: p.id, text: 'He was only being nice.', createdAt: T2, clientUpdatedAt: T2 };
    await push(CLIENT_A, { predictions: [p], reinterpretations: [re] });
    const edited = await push(CLIENT_A, { reinterpretations: [{ ...re, text: 'CHANGED', clientUpdatedAt: T3 }] });
    expect(edited.body.rejected).toEqual([{ id: re.id, table: 'reinterpretations', code: 'append_only' }]);
    expect(edited.body.reinterpretations[0]!.text).toBe('He was only being nice.');
  });

  it('ignores priorIds the caller does not own', async () => {
    // B owns a prior; A tries to tag their prediction with it
    const bPrior = { id: uid(250), label: 'B’s rule', category: 'rank', origin: 'client', createdBy: 'client', createdAt: T1, clientUpdatedAt: T1 };
    await push(CLIENT_B, { priors: [bPrior] });
    const r = await push(CLIENT_A, { predictions: [openPrediction(1, { priorIds: [bPrior.id] })] });
    expect(r.status).toBe(200);
    expect(r.body.predictions[0]!.priorIds).toEqual([]);
    expect(r.body.rejected).toEqual([]);
  });

  it('last-write-wins is enforced in the upsert, not in JS (stale row does not overwrite)', async () => {
    const p = openPrediction(1);
    await push(CLIENT_A, { predictions: [{ ...p, confidence: 90, clientUpdatedAt: T3 }] });
    const r = await push(CLIENT_A, { predictions: [{ ...p, confidence: 10, clientUpdatedAt: T1 }] });
    expect(r.body.predictions[0]!.confidence).toBe(90);
    expect(r.body.rejected).toEqual([]);
  });

  it('a body state referencing another user’s prediction is rejected, not written', async () => {
    const pA = openPrediction(1);
    await push(CLIENT_A, { predictions: [pA] });
    const r = await push(CLIENT_B, {
      bodyStates: [{ id: uid(410), predictionId: pA.id, phase: 'before', before: { intensity: 3 }, createdAt: T1, clientUpdatedAt: T1 }],
    });
    expect(r.status).toBe(200);
    expect(r.body.rejected).toHaveLength(1);
    expect(r.body.rejected[0]!.table).toBe('body_states');
    const a = await push(CLIENT_A, {});
    expect(a.body.bodyStates).toEqual([]);
  });

  it('two devices: the cursor never skips a row written by the other device', async () => {
    const d2 = uid(11);
    const r1 = await push(CLIENT_A, { predictions: [openPrediction(1)] });
    // device 2 pushes something; device 1 pulls with its cursor and must see it
    await app.inject({ method: 'POST', url: '/v1/sync', headers: asUser(CLIENT_A), payload: { deviceId: d2, predictions: [openPrediction(2)] } });
    const r2 = await push(CLIENT_A, { since: r1.body.serverTime });
    expect(r2.body.predictions.map((p) => p.id)).toEqual([uid(102)]);
    const r3 = await push(CLIENT_A, { since: r2.body.serverTime });
    expect(r3.body.predictions).toEqual([]);
  });
});
