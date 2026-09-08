/**
 * Sync — drain the outbox to POST /v1/sync, merge the pull by id.
 * Runs on load, on reconnect, when the tab becomes visible, and after every
 * write (debounced). Offline is the normal state; nothing here throws at the UI.
 *
 * Ported from apps/client/src/sync/index.ts. The merge rules are identical:
 * rejected rows stay queued, except append-only refusals which revert to the
 * server copy, and the pending set is re-read *after* the response so a write
 * made while the request was in flight is never clobbered by the pull.
 */
import { syncPullSchema, type SyncPush } from '@ledger/shared';
import { API_URL, accessToken } from '@/auth/supabase';
import {
  clearOutbox,
  forcePutReinterpretation,
  getMeta,
  pendingKeys,
  putBodyState,
  putCrisisEvent,
  putJournal,
  putPrediction,
  putPrior,
  putReinterpretation,
  readOutbox,
  setMeta,
} from '@/db';
import { newId } from '@/ids';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'unauthenticated';

const listeners = new Set<(s: SyncStatus) => void>();
let status: SyncStatus = 'idle';
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((l) => l(s));
}
export const getStatus = () => status;
export function onStatus(l: (s: SyncStatus) => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export async function deviceId(): Promise<string> {
  let id = await getMeta('deviceId');
  if (!id) {
    id = newId();
    await setMeta('deviceId', id);
  }
  return id;
}

/** Schedule a sync soon (coalesces bursts of writes). */
export function requestSync(delayMs = 1500): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delayMs);
}

export async function syncNow(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<void> {
  // navigator.onLine is the browser's stand-in for NetInfo. It only proves
  // there is no link at all; a captive portal still reaches the catch below.
  if (!navigator.onLine) {
    setStatus('offline');
    return;
  }
  const token = await accessToken();
  if (!token) {
    setStatus('unauthenticated');
    return;
  }
  setStatus('syncing');
  try {
    const outbox = await readOutbox();
    const push: SyncPush = {
      deviceId: await deviceId(),
      predictions: outbox.predictions,
      bodyStates: outbox.bodyStates,
      reinterpretations: outbox.reinterpretations,
      priors: outbox.priors,
      journalEntries: outbox.journalEntries,
      crisisEvents: outbox.crisisEvents,
      since: await getMeta('since'),
      expoPushToken: null,
    };
    const res = await fetch(`${API_URL}/v1/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(push),
      // Entries are PHI: never let a cache or a service worker answer this.
      cache: 'no-store',
    });
    if (res.status === 401) {
      setStatus('unauthenticated');
      return;
    }
    if (!res.ok) throw new Error(`sync ${res.status}`);
    const pull = syncPullSchema.parse(await res.json());

    // Clear exactly the versions we pushed (an edit made meanwhile stays
    // queued). Rejected rows stay queued too, except append-only refusals,
    // which are reverted to the server copy below.
    const rejected = new Set(pull.rejected.map((r) => `${r.table}:${r.id}`));
    const appendOnly = new Set(pull.rejected.filter((r) => r.code === 'append_only').map((r) => r.id));
    await clearOutbox(outbox.ids.filter((x) => !rejected.has(`${x.tbl}:${x.id}`) || appendOnly.has(x.id)));

    // Merge pulled rows. Anything still queued locally is newer than what the
    // server has (or is about to be re-pushed), so leave it alone; every
    // put* below also carries a last-write-wins guard on client_updated_at.
    const pending = await pendingKeys();
    for (const p of pull.predictions) if (!pending.has(`predictions:${p.id}`)) await putPrediction(p, { queue: false });
    for (const b of pull.bodyStates) if (!pending.has(`body_states:${b.id}`)) await putBodyState(b, { queue: false });
    for (const r of pull.reinterpretations) {
      if (appendOnly.has(r.id)) await forcePutReinterpretation(r);
      else if (!pending.has(`reinterpretations:${r.id}`)) await putReinterpretation(r, { queue: false });
    }
    for (const pr of pull.priors) if (!pending.has(`priors:${pr.id}`)) await putPrior(pr, { queue: false });
    for (const j of pull.journalEntries) if (!pending.has(`journal_entries:${j.id}`)) await putJournal(j, { queue: false });
    for (const c of pull.crisisEvents) if (!pending.has(`crisis_events:${c.id}`)) await putCrisisEvent(c, { queue: false });

    await setMeta('since', pull.serverTime);
    setStatus('idle');
  } catch {
    setStatus('error');
  }
}

/** Wire up reconnect and tab-visibility → sync. Call once at app start. */
export function startSyncListeners(): () => void {
  const onOnline = () => requestSync(500);
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', () => setStatus('offline'));
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
