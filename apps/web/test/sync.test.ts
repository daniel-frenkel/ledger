/**
 * The merge rules. Rejected rows stay queued; an append-only refusal reverts
 * to the server copy instead of diverging; and the pending set is read AFTER
 * the response, so a write made while the request was in flight survives the
 * pull that would otherwise overwrite it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import type { Prediction, Reinterpretation, SyncPull } from '@ledger/shared';

vi.mock('@/auth/client', () => ({
  API_URL: 'http://api.test',
  accessToken: async () => 'a-token',
}));

const {
  getPrediction,
  outboxCount,
  pendingKeys,
  putPrediction,
  putReinterpretation,
  readOutbox,
  closeDb,
  allReinterpretations,
} = await import('../src/db/index.js');
const { syncNow } = await import('../src/sync/index.js');

const PID = '00000000-0000-7000-8000-000000000001';
const RID = '00000000-0000-7000-8000-000000000002';

const prediction = (over: Partial<Prediction> = {}): Prediction => ({
  id: PID,
  situation: 'Telling my brother I cannot make the trip.',
  expectedOutcome: 'He goes quiet and does not call for weeks.',
  confidence: 80,
  priorIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  clientUpdatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const reinterp = (over: Partial<Reinterpretation> = {}): Reinterpretation => ({
  id: RID,
  predictionId: PID,
  text: 'He was only being nice because Mom was there.',
  createdAt: '2026-01-01T00:00:00.000Z',
  clientUpdatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const emptyPull = (over: Partial<SyncPull> = {}): SyncPull => ({
  serverTime: '2026-06-01T00:00:00.000Z',
  predictions: [],
  bodyStates: [],
  reinterpretations: [],
  priors: [],
  journalEntries: [],
  crisisEvents: [],
  rejected: [],
  ...over,
});

/** Answer the sync POST with `pull`, optionally running `duringRequest` first. */
function respondWith(pull: SyncPull, duringRequest?: () => Promise<void>) {
  return vi.fn(async () => {
    if (duringRequest) await duringRequest();
    return { ok: true, status: 200, json: async () => pull } as unknown as Response;
  });
}

beforeEach(async () => {
  await closeDb();
  await deleteDB('ledger');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('push results', () => {
  it('clears rows the server accepted', async () => {
    await putPrediction(prediction());
    vi.stubGlobal('fetch', respondWith(emptyPull()));
    await syncNow();
    expect(await outboxCount()).toBe(0);
  });

  it('leaves a rejected row queued', async () => {
    await putPrediction(prediction());
    vi.stubGlobal('fetch', respondWith(emptyPull({ rejected: [{ id: PID, table: 'predictions', code: '23503' }] })));
    await syncNow();
    expect(await outboxCount()).toBe(1);
  });

  it('leaves everything queued when the request fails', async () => {
    await putPrediction(prediction());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response));
    await syncNow();
    expect(await outboxCount()).toBe(1);
  });
});

describe('append_only', () => {
  it('reverts the local edit to the server copy and stops queuing it', async () => {
    // A reinterpretation already synced, then edited locally — which the
    // server refuses, because reinterpretations are append-only.
    await putReinterpretation(reinterp({ text: 'my edit', clientUpdatedAt: '2026-05-01T00:00:00.000Z' }));

    const serverCopy = reinterp({ text: 'the original, dated', clientUpdatedAt: '2026-01-01T00:00:00.000Z' });
    vi.stubGlobal(
      'fetch',
      respondWith(
        emptyPull({
          reinterpretations: [serverCopy],
          rejected: [{ id: RID, table: 'reinterpretations', code: 'append_only' }],
        }),
      ),
    );
    await syncNow();

    // Reverted, even though the server copy is older than the local edit.
    const stored = await allReinterpretations();
    expect(stored[0]!.text).toBe('the original, dated');
    // And dequeued, so it is not pushed again forever.
    expect(await outboxCount()).toBe(0);
  });

  it('a plain rejection is NOT reverted and stays queued', async () => {
    await putReinterpretation(reinterp({ text: 'my edit', clientUpdatedAt: '2026-05-01T00:00:00.000Z' }));
    vi.stubGlobal(
      'fetch',
      respondWith(
        emptyPull({
          reinterpretations: [reinterp({ text: 'the original, dated', clientUpdatedAt: '2026-01-01T00:00:00.000Z' })],
          rejected: [{ id: RID, table: 'reinterpretations', code: '23514' }],
        }),
      ),
    );
    await syncNow();

    expect((await allReinterpretations())[0]!.text).toBe('my edit');
    expect(await outboxCount()).toBe(1);
  });
});

describe('the pending set is read after the response', () => {
  it('does not overwrite a row edited while the request was in flight', async () => {
    await putPrediction(prediction({ confidence: 80 }));

    // The server answers with its copy; meanwhile the user edits the row.
    const serverCopy = prediction({ confidence: 30, clientUpdatedAt: '2026-04-01T00:00:00.000Z' });
    const fetchMock = respondWith(emptyPull({ predictions: [serverCopy] }), async () => {
      // queued_at is the version token and has millisecond resolution, so the
      // re-queue has to land in a later millisecond than the push for
      // clearOutbox to tell the two apart. A real edit is a human click; this
      // wait is what makes the test deterministic rather than timing-dependent.
      await new Promise((r) => setTimeout(r, 2));
      await putPrediction(prediction({ confidence: 55, clientUpdatedAt: '2026-09-01T00:00:00.000Z' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await syncNow();

    // The in-flight edit is still pending, so the pull left it alone …
    const stored = await getPrediction(PID);
    expect(stored?.confidence).toBe(55);
    // … and it is still queued, to be pushed on the next run.
    expect(await outboxCount()).toBe(1);
    expect(await pendingKeys()).toEqual(new Set([`predictions:${PID}`]));
    expect((await readOutbox()).predictions[0]!.confidence).toBe(55);
  });

  it('applies a pulled row that is not pending', async () => {
    const serverCopy = prediction({ confidence: 30, clientUpdatedAt: '2026-04-01T00:00:00.000Z' });
    vi.stubGlobal('fetch', respondWith(emptyPull({ predictions: [serverCopy] })));
    await syncNow();
    expect((await getPrediction(PID))?.confidence).toBe(30);
  });
});

describe('offline', () => {
  it('does not call the server at all', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true });
    await putPrediction(prediction());
    const fetchMock = respondWith(emptyPull());
    vi.stubGlobal('fetch', fetchMock);
    await syncNow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await outboxCount()).toBe(1);
  });
});
