/**
 * Local store — expo-sqlite. The phone is the source of truth for the
 * client's own rows; the server is a replica plus the clinician's window.
 *
 * Every table mirrors the wire shape from @ledger/shared as JSON in a `doc`
 * column, with the few fields we query on lifted into real columns. That
 * keeps the local schema stable while the domain objects evolve (the zod
 * schema validates on read). An `outbox` table records ids that need
 * pushing; sync drains it.
 */
import * as SQLite from 'expo-sqlite';
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

const DDL = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL,
  created_at TEXT NOT NULL, client_updated_at TEXT NOT NULL,
  resolved_at TEXT, abandoned_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS predictions_open ON predictions (created_at) WHERE resolved_at IS NULL AND abandoned_at IS NULL AND deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS body_states (id TEXT PRIMARY KEY, prediction_id TEXT NOT NULL, doc TEXT NOT NULL, client_updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS reinterpretations (id TEXT PRIMARY KEY, prediction_id TEXT NOT NULL, doc TEXT NOT NULL, client_updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS priors (id TEXT PRIMARY KEY, doc TEXT NOT NULL, client_updated_at TEXT NOT NULL, retired_at TEXT, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS journal_entries (id TEXT PRIMARY KEY, doc TEXT NOT NULL, created_at TEXT NOT NULL, client_updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS crisis_events (id TEXT PRIMARY KEY, doc TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (tbl TEXT NOT NULL, id TEXT NOT NULL, queued_at TEXT NOT NULL, PRIMARY KEY (tbl, id));
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

let dbPromise: Promise<SQLite.SQLiteDatabase> | undefined;

export function db(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync('ledger.db');
    await d.execAsync(DDL);
    return d;
  })();
  return dbPromise;
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

export async function getMeta(key: string): Promise<string | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}
export async function setMeta(key: string, value: string | null): Promise<void> {
  const d = await db();
  if (value == null) await d.runAsync('DELETE FROM meta WHERE key = ?', key);
  else await d.runAsync('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

// ---------------------------------------------------------------------------
// generic upsert + outbox
// ---------------------------------------------------------------------------

async function enqueue(d: SQLite.SQLiteDatabase, tbl: Table, id: string) {
  await d.runAsync('INSERT OR REPLACE INTO outbox (tbl, id, queued_at) VALUES (?, ?, ?)', tbl, id, new Date().toISOString());
}

export async function putPrediction(p: Prediction, opts: { queue?: boolean } = { queue: true }): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT INTO predictions (id, doc, created_at, client_updated_at, resolved_at, abandoned_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, client_updated_at = excluded.client_updated_at,
       resolved_at = excluded.resolved_at, abandoned_at = excluded.abandoned_at, deleted_at = excluded.deleted_at
     WHERE excluded.client_updated_at >= predictions.client_updated_at`,
    p.id, JSON.stringify(p), p.createdAt, p.clientUpdatedAt, p.resolvedAt ?? null, p.abandonedAt ?? null, p.deletedAt ?? null,
  );
  if (opts.queue) await enqueue(d, 'predictions', p.id);
}

export async function putBodyState(b: BodyState, opts = { queue: true }): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT INTO body_states (id, prediction_id, doc, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, client_updated_at = excluded.client_updated_at, deleted_at = excluded.deleted_at
     WHERE excluded.client_updated_at >= body_states.client_updated_at`,
    b.id, b.predictionId, JSON.stringify(b), b.clientUpdatedAt, b.deletedAt ?? null,
  );
  if (opts.queue) await enqueue(d, 'body_states', b.id);
}

export async function putReinterpretation(r: Reinterpretation, opts = { queue: true }): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT INTO reinterpretations (id, prediction_id, doc, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, client_updated_at = excluded.client_updated_at, deleted_at = excluded.deleted_at
     WHERE excluded.client_updated_at >= reinterpretations.client_updated_at`,
    r.id, r.predictionId, JSON.stringify(r), r.clientUpdatedAt, r.deletedAt ?? null,
  );
  if (opts.queue) await enqueue(d, 'reinterpretations', r.id);
}

export async function putPrior(p: Prior, opts = { queue: true }): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT INTO priors (id, doc, client_updated_at, retired_at, deleted_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, client_updated_at = excluded.client_updated_at, retired_at = excluded.retired_at, deleted_at = excluded.deleted_at
     WHERE excluded.client_updated_at >= priors.client_updated_at`,
    p.id, JSON.stringify(p), p.clientUpdatedAt, p.retiredAt ?? null, p.deletedAt ?? null,
  );
  if (opts.queue) await enqueue(d, 'priors', p.id);
}

export async function putJournal(j: JournalEntry, opts = { queue: true }): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT INTO journal_entries (id, doc, created_at, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, client_updated_at = excluded.client_updated_at, deleted_at = excluded.deleted_at
     WHERE excluded.client_updated_at >= journal_entries.client_updated_at`,
    j.id, JSON.stringify(j), j.createdAt, j.clientUpdatedAt, j.deletedAt ?? null,
  );
  if (opts.queue) await enqueue(d, 'journal_entries', j.id);
}

export async function putCrisisEvent(c: CrisisEvent, opts = { queue: true }): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT INTO crisis_events (id, doc, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc`,
    c.id, JSON.stringify(c), c.createdAt,
  );
  if (opts.queue) await enqueue(d, 'crisis_events', c.id);
}

/** Server-authoritative overwrite, ignoring the LWW guard (used to revert a refused edit). */
export async function forcePutReinterpretation(r: Reinterpretation): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT INTO reinterpretations (id, prediction_id, doc, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, client_updated_at = excluded.client_updated_at, deleted_at = excluded.deleted_at`,
    r.id, r.predictionId, JSON.stringify(r), r.clientUpdatedAt, r.deletedAt ?? null,
  );
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

const parseAll = <T>(rows: { doc: string }[], schema: { parse: (x: unknown) => T }): T[] =>
  rows.map((r) => schema.parse(JSON.parse(r.doc)));

export async function allPredictions(): Promise<Prediction[]> {
  const d = await db();
  return parseAll(await d.getAllAsync<{ doc: string }>('SELECT doc FROM predictions WHERE deleted_at IS NULL ORDER BY created_at DESC'), predictionSchema);
}
export async function openPredictions(): Promise<Prediction[]> {
  const d = await db();
  return parseAll(
    await d.getAllAsync<{ doc: string }>('SELECT doc FROM predictions WHERE resolved_at IS NULL AND abandoned_at IS NULL AND deleted_at IS NULL ORDER BY created_at DESC'),
    predictionSchema,
  );
}
export async function getPrediction(id: string): Promise<Prediction | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ doc: string }>('SELECT doc FROM predictions WHERE id = ?', id);
  return row ? predictionSchema.parse(JSON.parse(row.doc)) : null;
}
export async function allBodyStates(): Promise<BodyState[]> {
  const d = await db();
  return parseAll(await d.getAllAsync<{ doc: string }>('SELECT doc FROM body_states WHERE deleted_at IS NULL'), bodyStateSchema);
}
export async function bodyStatesFor(predictionId: string): Promise<BodyState[]> {
  const d = await db();
  return parseAll(await d.getAllAsync<{ doc: string }>('SELECT doc FROM body_states WHERE prediction_id = ? AND deleted_at IS NULL', predictionId), bodyStateSchema);
}
export async function allReinterpretations(): Promise<Reinterpretation[]> {
  const d = await db();
  return parseAll(await d.getAllAsync<{ doc: string }>('SELECT doc FROM reinterpretations WHERE deleted_at IS NULL'), reinterpretationSchema);
}
export async function activePriors(): Promise<Prior[]> {
  const d = await db();
  return parseAll(await d.getAllAsync<{ doc: string }>('SELECT doc FROM priors WHERE retired_at IS NULL AND deleted_at IS NULL ORDER BY client_updated_at DESC'), priorSchema);
}
export async function allPriors(): Promise<Prior[]> {
  const d = await db();
  return parseAll(await d.getAllAsync<{ doc: string }>('SELECT doc FROM priors WHERE deleted_at IS NULL'), priorSchema);
}
export async function allJournal(): Promise<JournalEntry[]> {
  const d = await db();
  return parseAll(await d.getAllAsync<{ doc: string }>('SELECT doc FROM journal_entries WHERE deleted_at IS NULL ORDER BY created_at DESC'), journalEntrySchema);
}
export async function allCrisisEvents(): Promise<CrisisEvent[]> {
  const d = await db();
  return parseAll(await d.getAllAsync<{ doc: string }>('SELECT doc FROM crisis_events ORDER BY created_at DESC'), crisisEventSchema);
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
  const ids = await d.getAllAsync<OutboxRef>('SELECT tbl, id, queued_at AS queuedAt FROM outbox ORDER BY queued_at LIMIT ?', limit);
  const byTable = (t: Table) => ids.filter((x) => x.tbl === t).map((x) => x.id);
  const load = async <T>(t: Table, schema: { parse: (x: unknown) => T }): Promise<T[]> => {
    const list = byTable(t);
    if (list.length === 0) return [];
    const rows = await d.getAllAsync<{ doc: string }>(`SELECT doc FROM ${t} WHERE id IN (${list.map(() => '?').join(',')})`, ...list);
    return parseAll(rows, schema);
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
  await d.withTransactionAsync(async () => {
    for (const { tbl, id, queuedAt } of ids) await d.runAsync('DELETE FROM outbox WHERE tbl = ? AND id = ? AND queued_at = ?', tbl, id, queuedAt);
  });
}

export async function pendingKeys(): Promise<Set<string>> {
  const d = await db();
  const rows = await d.getAllAsync<{ tbl: string; id: string }>('SELECT tbl, id FROM outbox');
  return new Set(rows.map((r) => `${r.tbl}:${r.id}`));
}

export async function outboxCount(): Promise<number> {
  const d = await db();
  const r = await d.getFirstAsync<{ n: number }>('SELECT count(*) n FROM outbox');
  return r?.n ?? 0;
}

/** Sign-out: wipe everything local. */
export async function wipeAll(): Promise<void> {
  const d = await db();
  await d.execAsync('DELETE FROM predictions; DELETE FROM body_states; DELETE FROM reinterpretations; DELETE FROM priors; DELETE FROM journal_entries; DELETE FROM crisis_events; DELETE FROM outbox; DELETE FROM meta;');
}
