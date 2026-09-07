/**
 * Applies src/db/migrations in order, as the migration role (DATABASE_MIGRATE_URL).
 * Never run this as ledger_api. Used locally, in CI, and as a Render/Cloud Run
 * pre-deploy step.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_MIGRATE_URL (or DATABASE_URL) is required');

const here = path.dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: path.join(here, 'migrations') });
  console.log('migrations applied');
} finally {
  await pool.end();
}
