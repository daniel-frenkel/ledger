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
 * So: refuse anything that is not obviously local unless someone says the
 * quiet part out loud with ALLOW_DESTRUCTIVE_TESTS=1.
 */
const LOOKS_LOCAL = /@(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|db)[:/]/;

export function assertDisposableDatabase(url: string = ADMIN_URL): void {
  if (LOOKS_LOCAL.test(url) || process.env.ALLOW_DESTRUCTIVE_TESTS === '1') return;
  throw new Error(
    [
      'Refusing to TRUNCATE a database that is not local.',
      'The API test suite wipes every table, and this connection points somewhere else.',
      'Run it against the local Postgres (docker compose up -d db), or set',
      'ALLOW_DESTRUCTIVE_TESTS=1 if you are certain the target is disposable.',
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
