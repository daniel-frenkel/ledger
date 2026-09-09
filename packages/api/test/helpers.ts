import pg from 'pg';
import { Writable } from 'node:stream';
import { build } from '../src/server.js';
import { loggerTo } from '../src/logging/logger.js';

export const ADMIN_URL = process.env.DATABASE_MIGRATE_URL ?? 'postgresql://postgres:password@localhost:5432/ledger';
export const API_URL = process.env.DATABASE_URL ?? 'postgresql://ledger_api:ledger_api@localhost:5432/ledger';

/**
 * These tests TRUNCATE every table. That is fine against a throwaway local
 * Postgres and catastrophic against a real one — and once a developer fills in
 * a root .env pointing at Supabase, `pnpm -r test` aims them straight at it.
 *
 * The override is deliberately not a boolean. `ALLOW_DESTRUCTIVE_TESTS=1` in a
 * shell profile, a CI secret, or yesterday's terminal would silently authorise
 * whatever database .env happens to name today. Naming the host instead makes
 * the permission specific to one database: it cannot be set once and forgotten,
 * and it does not follow a changed .env to a new target.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'host.docker.internal', 'db']);

/** The host a Postgres URL points at, or '' if it cannot be parsed. */
export function databaseHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function assertDisposableDatabase(url: string = ADMIN_URL): void {
  const host = databaseHost(url);
  if (LOCAL_HOSTS.has(host)) return;
  if (host !== '' && process.env.ALLOW_DESTRUCTIVE_TESTS === host) return;
  throw new Error(
    [
      `Refusing to TRUNCATE the database at ${host || '(unparseable connection string)'}.`,
      'This suite wipes every table, and that host is not local.',
      'Run it against the local Postgres (docker compose up -d db), or, if that',
      'database really is disposable, name it explicitly:',
      '',
      `    ALLOW_DESTRUCTIVE_TESTS=${host || '<host>'}`,
      '',
      'A bare "1" is not accepted: the permission has to name the database it grants.',
    ].join('\n'),
  );
}

export async function truncateAll(): Promise<void> {
  assertDisposableDatabase();
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  await c.query(
    'TRUNCATE prediction_priors, crisis_events, journal_entries, reinterpretations, body_states, predictions, priors, clinician_client_links, devices, users CASCADE',
  );
  await c.end();
}

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const CLIENT_A = uid(1);
export const CLIENT_B = uid(2);
export const CLINICIAN = uid(3);
export const DEVICE_A = uid(10);

export class LogSink extends Writable {
  lines: string[] = [];
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.lines.push(chunk.toString('utf8'));
    cb();
  }
  text() {
    return this.lines.join('');
  }
}

export async function buildApp(sink?: LogSink) {
  return build(sink ? { logger: loggerTo(sink, 'trace') } : {});
}

export const asUser = (id: string, role: 'client' | 'clinician' = 'client') => ({ 'x-test-user': `${id}:${role}` });
