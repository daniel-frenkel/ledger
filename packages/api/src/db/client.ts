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

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      // TLS with certificate verification in production. Supabase presents a
      // publicly trusted certificate; for a private CA set DATABASE_CA_CERT
      // (PEM) and it is pinned here. Never disable verification: this
      // connection carries decryptable PHI.
      ssl:
        config().NODE_ENV === 'production'
          ? config().DATABASE_CA_CERT
            ? { rejectUnauthorized: true, ca: config().DATABASE_CA_CERT }
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
