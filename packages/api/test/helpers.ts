import pg from 'pg';
import { Writable } from 'node:stream';
import { build } from '../src/server.js';
import { loggerTo } from '../src/logging/logger.js';

export const ADMIN_URL = process.env.DATABASE_MIGRATE_URL ?? 'postgresql://postgres:password@localhost:5432/ledger';
export const API_URL = process.env.DATABASE_URL ?? 'postgresql://ledger_api:ledger_api@localhost:5432/ledger';

export async function truncateAll(): Promise<void> {
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
