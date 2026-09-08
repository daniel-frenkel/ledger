/**
 * Local store — IndexedDB, via `idb`. The browser profile is the source of
 * truth for the client's own rows; the server is a replica plus the
 * clinician's window.
 *
 * Ported from apps/client/src/db/index.ts (expo-sqlite). Every store mirrors
 * the wire shape from @ledger/shared as a `doc` object, with the few fields
 * we query on lifted alongside it, and the zod schema validates on read.
 *
 * SQLite enforced last-write-wins inside the statement itself:
 *
 *   ON CONFLICT(id) DO UPDATE SET … WHERE excluded.client_updated_at >= t.client_updated_at
 *
 * IndexedDB has no conditional put, so each put* re-checks the same condition
 * against the existing record inside one readwrite transaction — same guard,
 * still atomic. Timestamps are compared as strings, exactly as SQLite compared
 * the TEXT columns: ISO-8601 in a fixed format sorts lexicographically.
 *
 * An `outbox` store records rows that need pushing; sync drains it.
 */
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import {
  bodyStateSchema,
  crisisEventSchema,
  journalEntrySchema,
  predictionSchema,
  priorSchema,
  reinterpretationSchema,
  type BodyState,
  type CrisisEvent,
  type JournalEntry,
  type Prediction,
  type Prior,
  type Reinterpretation,
} from '@ledger/shared';

export type Table = 'predictions' | 'body_states' | 'reinterpretations' | 'priors' | 'journal_entries' | 'crisis_events';

const DB_NAME = 'ledger';
const DB_VERSION = 1;

interface DocRow<T> {
  id: string;
  doc: T;
  clientUpdatedAt: string;
}

interface LedgerDb extends DBSchema {
  predictions: {
    key: string;
    value: DocRow<Prediction> & {
      createdAt: string;
      resolvedAt: string | null;
      abandonedAt: string | null;
      deletedAt: string | null;
    };
    indexes: { created_at: string };
  };
  body_states: {
    key: string;
    value: DocRow<BodyState> & { predictionId: string; deletedAt: string | null };
    indexes: { prediction_id: string };
  };
  reinterpretations: {
    key: string;
    value: DocRow<Reinterpretation> & { predictionId: string; deletedAt: string | null };
    indexes: { prediction_id: string };
  };
  priors: { key: string; value: DocRow<Prior> & { retiredAt: string | null; deletedAt: string | null } };
  journal_entries: { key: string; value: DocRow<JournalEntry> & { createdAt: string; deletedAt: string | null } };
  crisis_events: { key: string; value: DocRow<CrisisEvent> & { createdAt: string } };
  outbox: { key: [string, string]; value: OutboxRef; indexes: { queued_at: string } };
  meta: { key: string; value: { key: string; value: string } };
}

let dbPromise: Promise<IDBPDatabase<LedgerDb>> | undefined;

export function db(): Promise<IDBPDatabase<LedgerDb>> {
  dbPromise ??= openDB<LedgerDb>(DB_NAME, DB_VERSION, {
    // Another tab is upgrading: let go so it can, rather than blocking it.
    blocking() {
      void closeDb();
    },
    upgrade(d) {
      d.createObjectStore('predictions', { keyPath: 'id' }).createIndex('created_at', 'createdAt');
      d.createObjectStore('body_states', { keyPath: 'id' }).createIndex('prediction_id', 'predictionId');
      d.createObjectStore('reinterpretations', { keyPath: 'id' }).createIndex('prediction_id', 'predictionId');
      d.createObjectStore('priors', { keyPath: 'id' });
      d.createObjectStore('journal_entries', { keyPath: 'id' });
      d.createObjectStore('crisis_events', { keyPath: 'id' });
      d.createObjectStore('outbox', { keyPath: ['tbl', 'id'] }).createIndex('queued_at', 'queuedAt');
      d.createObjectStore('meta', { keyPath: 'key' });
    },
  });
  return dbPromise;
}

/**
 * Close the connection and forget the handle. An open connection blocks
 * `deleteDatabase` and blocks another tab's version upgrade, so this has to
 * actually close it, not just drop the promise.
 */
export async function closeDb(): Promise<void> {
  const open = dbPromise;
  dbPromise = undefined;
  if (open) (await open).close();
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

export async function getMeta(key: string): Promise<string | null> {
  const row = await (await db()).get('meta', key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string | null): Promise<void> {
  const d = await db();
  if (value == null) await d.delete('meta', key);
  else await d.put('meta', { key, value });
}

// ---------------------------------------------------------------------------
// generic upsert + outbox
// ---------------------------------------------------------------------------

type WriteTx = IDBPTransaction<LedgerDb, StoreNames<LedgerDb>[], 'readwrite'>;

function enqueue(tx: WriteTx, tbl: Table, id: string): void {
  // INSERT OR REPLACE: a second edit before a sync overwrites queued_at.
  void tx.objectStore('outbox').put({ tbl, id, queuedAt: new Date().toISOString() });
}

/**
 * The last-write-wins guard, applied to a record already read in this
 * transaction. `>=` matches the SQL: an identical timestamp still overwrites.
 */
const wins = (incoming: string, existing: { clientUpdatedAt: string } | undefined): boolean =>
  !existing || incoming >= existing.clientUpdatedAt;

export async function putPrediction(p: Prediction, opts: { queue?: boolean } = { queue: true }): Promise<void> {
  const d = await db();
  const tx = d.transaction(['predictions', 'outbox'], 'readwrite');
  const store = tx.objectStore('predictions');
  const existing = await store.get(p.id);
  if (wins(p.clientUpdatedAt, existing)) {
    await store.put({
      id: p.id,
      doc: p,
      createdAt: p.createdAt,
      clientUpdatedAt: p.clientUpdatedAt,
      resolvedAt: p.resolvedAt ?? null,
      abandonedAt: p.abandonedAt ?? null,
      deletedAt: p.deletedAt ?? null,
    });
  }
  // Queued even when the guard refused the write — the SQLite version queued
  // unconditionally after the upsert, and sync is what resolves the conflict.
  if (opts.queue) enqueue(tx, 'predictions', p.id);
  await tx.done;
}

export async function putBodyState(b: BodyState, opts = { queue: true }): Promise<void> {
  const d = await db();
  const tx = d.transaction(['body_states', 'outbox'], 'readwrite');
  const store = tx.objectStore('body_states');
  const existing = await store.get(b.id);
  if (wins(b.clientUpdatedAt, existing)) {
    await store.put({
      id: b.id,
      predictionId: b.predictionId,
      doc: b,
      clientUpdatedAt: b.clientUpdatedAt,
      deletedAt: b.deletedAt ?? null,
    });
  }
  if (opts.queue) enqueue(tx, 'body_states', b.id);
  await tx.done;
}

export async function putReinterpretation(r: Reinterpretation, opts = { queue: true }): Promise<void> {
  const d = await db();
  const tx = d.transaction(['reinterpretations', 'outbox'], 'readwrite');
  const store = tx.objectStore('reinterpretations');
  const existing = await store.get(r.id);
  if (wins(r.clientUpdatedAt, existing)) {
    await store.put({
      id: r.id,
      predictionId: r.predictionId,
      doc: r,
      clientUpdatedAt: r.clientUpdatedAt,
      deletedAt: r.deletedAt ?? null,
    });
  }
  if (opts.queue) enqueue(tx, 'reinterpretations', r.id);
  await tx.done;
}

export async function putPrior(p: Prior, opts = { queue: true }): Promise<void> {
  const d = await db();
  const tx = d.transaction(['priors', 'outbox'], 'readwrite');
  const store = tx.objectStore('priors');
  const existing = await store.get(p.id);
  if (wins(p.clientUpdatedAt, existing)) {
    await store.put({
      id: p.id,
      doc: p,
      clientUpdatedAt: p.clientUpdatedAt,
      retiredAt: p.retiredAt ?? null,
      deletedAt: p.deletedAt ?? null,
    });
  }
  if (opts.queue) enqueue(tx, 'priors', p.id);
  await tx.done;
}

export async function putJournal(j: JournalEntry, opts = { queue: true }): Promise<void> {
  const d = await db();
  const tx = d.transaction(['journal_entries', 'outbox'], 'readwrite');
  const store = tx.objectStore('journal_entries');
  const existing = await store.get(j.id);
  if (wins(j.clientUpdatedAt, existing)) {
    await store.put({
      id: j.id,
      doc: j,
      createdAt: j.createdAt,
      clientUpdatedAt: j.clientUpdatedAt,
      deletedAt: j.deletedAt ?? null,
    });
  }
  if (opts.queue) enqueue(tx, 'journal_entries', j.id);
  await tx.done;
}

export async function putCrisisEvent(c: CrisisEvent, opts = { queue: true }): Promise<void> {
  const d = await db();
  const tx = d.transaction(['crisis_events', 'outbox'], 'readwrite');
  // No LWW guard: crisis_events carries no client_updated_at, and the SQLite
  // version overwrote the doc on conflict unconditionally.
  await tx.objectStore('crisis_events').put({ id: c.id, doc: c, createdAt: c.createdAt, clientUpdatedAt: c.createdAt });
  if (opts.queue) enqueue(tx, 'crisis_events', c.id);
  await tx.done;
}

/** Server-authoritative overwrite, ignoring the LWW guard (used to revert a refused edit). */
export async function forcePutReinterpretation(r: Reinterpretation): Promise<void> {
  const d = await db();
  await d.put('reinterpretations', {
    id: r.id,
    predictionId: r.predictionId,
    doc: r,
    clientUpdatedAt: r.clientUpdatedAt,
    deletedAt: r.deletedAt ?? null,
  });
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

const parseAll = <T>(rows: { doc: unknown }[], schema: { parse: (x: unknown) => T }): T[] =>
  rows.map((r) => schema.parse(r.doc));

/** SQLite ordered with ORDER BY created_at DESC; IndexedDB sorts ascending. */
const byCreatedAtDesc = <T extends { createdAt: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

export async function allPredictions(): Promise<Prediction[]> {
  const rows = (await (await db()).getAll('predictions')).filter((r) => r.deletedAt === null);
  return parseAll(byCreatedAtDesc(rows), predictionSchema);
}

export async function openPredictions(): Promise<Prediction[]> {
  const rows = (await (await db()).getAll('predictions')).filter(
    (r) => r.resolvedAt === null && r.abandonedAt === null && r.deletedAt === null,
  );
  return parseAll(byCreatedAtDesc(rows), predictionSchema);
}

export async function getPrediction(id: string): Promise<Prediction | null> {
  const row = await (await db()).get('predictions', id);
  return row ? predictionSchema.parse(row.doc) : null;
}

export async function allBodyStates(): Promise<BodyState[]> {
  const rows = (await (await db()).getAll('body_states')).filter((r) => r.deletedAt === null);
  return parseAll(rows, bodyStateSchema);
}

export async function bodyStatesFor(predictionId: string): Promise<BodyState[]> {
  const rows = await (await db()).getAllFromIndex('body_states', 'prediction_id', predictionId);
  return parseAll(rows.filter((r) => r.deletedAt === null), bodyStateSchema);
}

export async function allReinterpretations(): Promise<Reinterpretation[]> {
  const rows = (await (await db()).getAll('reinterpretations')).filter((r) => r.deletedAt === null);
  return parseAll(rows, reinterpretationSchema);
}

export async function activePriors(): Promise<Prior[]> {
  const rows = (await (await db()).getAll('priors')).filter((r) => r.retiredAt === null && r.deletedAt === null);
  rows.sort((a, b) => (a.clientUpdatedAt < b.clientUpdatedAt ? 1 : a.clientUpdatedAt > b.clientUpdatedAt ? -1 : 0));
  return parseAll(rows, priorSchema);
}

export async function allPriors(): Promise<Prior[]> {
  const rows = (await (await db()).getAll('priors')).filter((r) => r.deletedAt === null);
  return parseAll(rows, priorSchema);
}

export async function allJournal(): Promise<JournalEntry[]> {
  const rows = (await (await db()).getAll('journal_entries')).filter((r) => r.deletedAt === null);
  return parseAll(byCreatedAtDesc(rows), journalEntrySchema);
}

export async function allCrisisEvents(): Promise<CrisisEvent[]> {
  return parseAll(byCreatedAtDesc(await (await db()).getAll('crisis_events')), crisisEventSchema);
}

// ---------------------------------------------------------------------------
// outbox
// ---------------------------------------------------------------------------

export interface OutboxBatch {
  predictions: Prediction[];
  bodyStates: BodyState[];
  reinterpretations: Reinterpretation[];
  priors: Prior[];
  journalEntries: JournalEntry[];
  crisisEvents: CrisisEvent[];
}

export interface OutboxRef {
  tbl: Table;
  id: string;
  queuedAt: string;
}

export async function readOutbox(limit = 200): Promise<OutboxBatch & { ids: OutboxRef[] }> {
  const d = await db();
  // ORDER BY queued_at LIMIT ?
  const ids = (await d.getAllFromIndex('outbox', 'queued_at')).slice(0, limit);
  const byTable = (t: Table) => ids.filter((x) => x.tbl === t).map((x) => x.id);
  const load = async <T>(t: Table, schema: { parse: (x: unknown) => T }): Promise<T[]> => {
    const list = byTable(t);
    if (list.length === 0) return [];
    const rows = await Promise.all(list.map((id) => d.get(t, id)));
    // A queued id whose row is gone is simply absent, as with `WHERE id IN (…)`.
    return parseAll(
      rows.filter((r): r is NonNullable<typeof r> => !!r),
      schema,
    );
  };
  return {
    ids,
    predictions: await load('predictions', predictionSchema),
    bodyStates: await load('body_states', bodyStateSchema),
    reinterpretations: await load('reinterpretations', reinterpretationSchema),
    priors: await load('priors', priorSchema),
    journalEntries: await load('journal_entries', journalEntrySchema),
    crisisEvents: await load('crisis_events', crisisEventSchema),
  };
}

/**
 * Clear exactly the queued versions we pushed. An edit made while the request
 * was in flight re-queued the row with a newer queued_at, and that stays.
 */
export async function clearOutbox(ids: OutboxRef[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  const store = tx.objectStore('outbox');
  for (const { tbl, id, queuedAt } of ids) {
    const row = await store.get([tbl, id]);
    if (row && row.queuedAt === queuedAt) await store.delete([tbl, id]);
  }
  await tx.done;
}

export async function pendingKeys(): Promise<Set<string>> {
  const rows = await (await db()).getAll('outbox');
  return new Set(rows.map((r) => `${r.tbl}:${r.id}`));
}

export async function outboxCount(): Promise<number> {
  return (await db()).count('outbox');
}

/** Oldest queued_at still waiting, for the "hasn't synced in a week" notice. */
export async function oldestQueuedAt(): Promise<string | null> {
  const rows = await (await db()).getAllFromIndex('outbox', 'queued_at');
  return rows[0]?.queuedAt ?? null;
}

/** Sign-out: wipe everything local. */
export async function wipeAll(): Promise<void> {
  const d = await db();
  const stores = [
    'predictions',
    'body_states',
    'reinterpretations',
    'priors',
    'journal_entries',
    'crisis_events',
    'outbox',
    'meta',
  ] as const;
  const tx = d.transaction(stores, 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}
