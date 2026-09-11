/**
 * Postgres pool + the per-request transaction that makes RLS work.
 *
 * `withUser` opens a transaction, sets `request.user_id` / `request.role`
 * (transaction-local: the `true` argument to set_config), runs the callback,
 * and commits. Nothing in the API touches the database outside `withUser`
 * except health checks and migrations.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { UserRole } from '@ledger/shared';
import { config } from '../config.js';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let pool: pg.Pool | undefined;
let db: Db | undefined;

/**
 * Whether this connection string reaches the database over a Unix socket.
 *
 * Cloud Run mounts the Cloud SQL connector at `/cloudsql/<instance>` and the
 * connection string names it as the host, which node-postgres accepts as
 * `postgresql://user:pw@/ledger?host=/cloudsql/project:region:instance`.
 * That path never leaves the container: the connector holds the TLS session to
 * the instance on the other side of it.
 */
export function isUnixSocket(url: string): boolean {
  // Not a URL parse: `postgresql://user:pw@/db?host=/cloudsql/…` has an empty
  // authority, which `new URL()` is entitled to treat as a parse failure.
  const host = /[?&]host=([^&]+)/.exec(url)?.[1];
  return !!host && decodeURIComponent(host).startsWith('/');
}

export function getPool(): pg.Pool {
  if (!pool) {
    const c = config();
    pool = new pg.Pool({
      connectionString: c.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      // TLS with certificate verification in production. Supabase presents a
      // publicly trusted certificate; for a private CA set DATABASE_CA_CERT
      // (PEM) and it is pinned here. Never disable verification: this
      // connection carries decryptable PHI.
      //
      // A Unix socket is the exception, and not a weakening of it. Over
      // `/cloudsql/…` there is no network to protect and no certificate to
      // verify — the Cloud SQL connector on the other side of the socket is
      // what holds the TLS session to the instance. Asking for TLS here fails
      // the connection outright rather than securing anything.
      ssl:
        c.NODE_ENV === 'production' && !isUnixSocket(c.DATABASE_URL)
          ? c.DATABASE_CA_CERT
            ? { rejectUnauthorized: true, ca: c.DATABASE_CA_CERT }
            : { rejectUnauthorized: true }
          : undefined,
    });
  }
  return pool;
}

export function getDb(): Db {
  if (!db) db = drizzle(getPool(), { schema });
  return db;
}

export interface RequestUser {
  id: string;
  role: UserRole;
}

/** Run `fn` inside a transaction scoped to `user` for RLS. */
export async function withUser<T>(user: RequestUser, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('request.user_id', ${user.id}, true), set_config('request.role', ${user.role}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Run `fn` in the system context: `request.role = 'system'`, no user id.
 *
 * The only thing this context can do that a user context cannot is hard-delete
 * rows already soft-deleted past the grace period — migration 0007 grants
 * DELETE and then scopes it to exactly that predicate. It is still the
 * `ledger_api` role, still under RLS, still without BYPASSRLS: a bug here
 * cannot read across users, because every SELECT policy keys on
 * `app_user_id()` and there is no user id set.
 *
 * Nothing reachable from an HTTP request calls this. The auth plugin writes
 * 'client' or 'clinician' from the verified token and `withUser` takes the
 * role from there, so 'system' is not a value a request can produce.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const graceDays = String(config().DELETION_GRACE_DAYS);
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('request.role', 'system', true),
                 set_config('request.user_id', '', true),
                 set_config('app.deletion_grace_days', ${graceDays}, true)`,
    );
    return fn(tx);
  });
}

export async function ping(): Promise<boolean> {
  const r = await getPool().query('SELECT 1 AS ok');
  return r.rows[0]?.ok === 1;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

export { schema };
