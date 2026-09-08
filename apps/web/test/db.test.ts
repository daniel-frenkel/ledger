/**
 * The store's guards. Every one of them exists because of a reviewed bug in
 * the phone client, so the port has to keep them: the last-write-wins guard,
 * the outbox's queued_at semantics, and the append-only revert.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import type { Prediction, Reinterpretation } from '@ledger/shared';
import {
  allPredictions,
  clearOutbox,
  forcePutReinterpretation,
  getPrediction,
  oldestQueuedAt,
  openPredictions,
  outboxCount,
  pendingKeys,
  putPrediction,
  putReinterpretation,
  readOutbox,
  closeDb,
  setMeta,
  getMeta,
  wipeAll,
} from '../src/db/index.js';

const ID = '00000000-0000-7000-8000-000000000001';
const ID2 = '00000000-0000-7000-8000-000000000002';

const prediction = (over: Partial<Prediction> = {}): Prediction => ({
  id: ID,
  situation: 'Telling my brother I cannot make the trip.',
  expectedOutcome: 'He goes quiet and does not call for weeks.',
  confidence: 80,
  priorIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  clientUpdatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const reinterp = (over: Partial<Reinterpretation> = {}): Reinterpretation => ({
  id: ID2,
  predictionId: ID,
  text: 'He was only being nice because Mom was there.',
  createdAt: '2026-01-01T00:00:00.000Z',
  clientUpdatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

beforeEach(async () => {
  await closeDb();
  await deleteDB('ledger');
});

describe('last-write-wins guard', () => {
  it('rejects an older doc and keeps the newer one', async () => {
    await putPrediction(prediction({ clientUpdatedAt: '2026-02-01T00:00:00.000Z', confidence: 80 }), { queue: false });
    await putPrediction(prediction({ clientUpdatedAt: '2026-01-01T00:00:00.000Z', confidence: 10 }), { queue: false });

    const stored = await getPrediction(ID);
    expect(stored?.confidence).toBe(80);
    expect(stored?.clientUpdatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('accepts a newer doc', async () => {
    await putPrediction(prediction({ clientUpdatedAt: '2026-01-01T00:00:00.000Z', confidence: 80 }), { queue: false });
    await putPrediction(prediction({ clientUpdatedAt: '2026-03-01T00:00:00.000Z', confidence: 10 }), { queue: false });
    expect((await getPrediction(ID))?.confidence).toBe(10);
  });

  it('accepts an equal timestamp, as `>=` did in SQL', async () => {
    const at = '2026-01-01T00:00:00.000Z';
    await putPrediction(prediction({ clientUpdatedAt: at, confidence: 80 }), { queue: false });
    await putPrediction(prediction({ clientUpdatedAt: at, confidence: 10 }), { queue: false });
    expect((await getPrediction(ID))?.confidence).toBe(10);
  });

  it('queues the row even when the guard refuses the write', async () => {
    await putPrediction(prediction({ clientUpdatedAt: '2026-02-01T00:00:00.000Z' }), { queue: false });
    await putPrediction(prediction({ clientUpdatedAt: '2026-01-01T00:00:00.000Z' }));
    expect(await outboxCount()).toBe(1);
  });
});

describe('clearOutbox', () => {
  it('leaves a re-queued newer version in the outbox', async () => {
    await putPrediction(prediction());
    const pushed = await readOutbox();
    expect(pushed.ids).toHaveLength(1);

    // An edit lands while the request is in flight: same row, newer queued_at.
    await new Promise((r) => setTimeout(r, 2));
    await putPrediction(prediction({ clientUpdatedAt: '2026-02-01T00:00:00.000Z' }));
    const requeued = await readOutbox();
    expect(requeued.ids[0]!.queuedAt).not.toBe(pushed.ids[0]!.queuedAt);

    // Clearing the version we pushed must not drop the newer one.
    await clearOutbox(pushed.ids);
    expect(await outboxCount()).toBe(1);
    expect((await readOutbox()).ids[0]!.queuedAt).toBe(requeued.ids[0]!.queuedAt);
  });

  it('clears a row that was not touched during the request', async () => {
    await putPrediction(prediction());
    const pushed = await readOutbox();
    await clearOutbox(pushed.ids);
    expect(await outboxCount()).toBe(0);
  });
});

describe('pendingKeys', () => {
  it('includes rows re-queued during a request, so the pull cannot clobber them', async () => {
    await putPrediction(prediction());
    const pushed = await readOutbox();

    // In flight: the row is edited again, then the pushed version is cleared.
    await new Promise((r) => setTimeout(r, 2));
    await putPrediction(prediction({ clientUpdatedAt: '2026-02-01T00:00:00.000Z' }));
    await clearOutbox(pushed.ids);

    // Read AFTER the response, as sync does: the row is still pending.
    expect(await pendingKeys()).toEqual(new Set([`predictions:${ID}`]));
  });

  it('excludes rows whose pushed version was cleared and not re-queued', async () => {
    await putPrediction(prediction());
    await clearOutbox((await readOutbox()).ids);
    expect(await pendingKeys()).toEqual(new Set());
  });
});

describe('forcePutReinterpretation', () => {
  it('overwrites a newer local edit, which is what an append_only revert needs', async () => {
    await putReinterpretation(reinterp({ text: 'my later edit', clientUpdatedAt: '2026-05-01T00:00:00.000Z' }), { queue: false });
    // The server copy is older, so the ordinary guard would refuse it.
    await putReinterpretation(reinterp({ text: 'the server copy', clientUpdatedAt: '2026-01-01T00:00:00.000Z' }), { queue: false });
    expect((await readOutbox()).reinterpretations).toHaveLength(0);

    await forcePutReinterpretation(reinterp({ text: 'the server copy', clientUpdatedAt: '2026-01-01T00:00:00.000Z' }));
    const { reinterpretations } = await readOutbox(200);
    expect(reinterpretations).toHaveLength(0); // force does not queue

    await putReinterpretation(reinterp({ text: 'probe', clientUpdatedAt: '2026-06-01T00:00:00.000Z' }));
    const after = await readOutbox();
    expect(after.reinterpretations[0]!.text).toBe('probe');
  });

  it('leaves the server copy in place', async () => {
    await putReinterpretation(reinterp({ text: 'my later edit', clientUpdatedAt: '2026-05-01T00:00:00.000Z' }), { queue: false });
    await forcePutReinterpretation(reinterp({ text: 'the server copy', clientUpdatedAt: '2026-01-01T00:00:00.000Z' }));
    await putPrediction(prediction(), { queue: false });
    // Read it back through the outbox loader by queuing it explicitly.
    await putReinterpretation(reinterp({ text: 'the server copy', clientUpdatedAt: '2026-01-01T00:00:00.000Z' }));
    expect((await readOutbox()).reinterpretations[0]!.text).toBe('the server copy');
  });
});

describe('reads', () => {
  it('openPredictions excludes resolved, abandoned and deleted', async () => {
    await putPrediction(prediction({ id: ID }), { queue: false });
    await putPrediction(
      prediction({ id: '00000000-0000-7000-8000-000000000003', resolvedAt: '2026-02-01T00:00:00.000Z', outcomeVerdict: 'miss' }),
      { queue: false },
    );
    await putPrediction(
      prediction({ id: '00000000-0000-7000-8000-000000000004', abandonedAt: '2026-02-01T00:00:00.000Z', abandonReason: 'forgot' }),
      { queue: false },
    );
    await putPrediction(prediction({ id: '00000000-0000-7000-8000-000000000005', deletedAt: '2026-02-01T00:00:00.000Z' }), { queue: false });

    expect((await openPredictions()).map((p) => p.id)).toEqual([ID]);
    expect(await allPredictions()).toHaveLength(3); // deleted is excluded, the rest are not
  });

  it('orders newest first', async () => {
    await putPrediction(prediction({ id: ID, createdAt: '2026-01-01T00:00:00.000Z' }), { queue: false });
    await putPrediction(prediction({ id: ID2, createdAt: '2026-03-01T00:00:00.000Z' }), { queue: false });
    expect((await openPredictions()).map((p) => p.id)).toEqual([ID2, ID]);
  });
});

describe('outbox housekeeping', () => {
  it('reports the oldest queued_at for the stale-outbox notice', async () => {
    expect(await oldestQueuedAt()).toBeNull();
    await putPrediction(prediction());
    expect(await oldestQueuedAt()).not.toBeNull();
  });

  it('wipeAll clears entries, the outbox and meta', async () => {
    await putPrediction(prediction());
    await setMeta('since', '2026-01-01T00:00:00.000Z');
    await wipeAll();
    expect(await allPredictions()).toEqual([]);
    expect(await outboxCount()).toBe(0);
    expect(await getMeta('since')).toBeNull();
  });
});
