/**
 * Migrating production, deliberately.
 *
 * `db:migrate` is the everyday command and points at whatever `.env` says,
 * which is right for a laptop and wrong for the database holding client
 * records. This one refuses to run unless the caller names the host they mean:
 *
 *     CONFIRM_MIGRATE_HOST=10.83.0.3 pnpm db:migrate:prod
 *
 * A host and not a boolean, for the reason `ALLOW_DESTRUCTIVE_TESTS` is a host
 * and not a boolean: a `1` left in a shell profile or a CI secret goes on
 * authorising whatever the connection string points at next, while a hostname
 * stops being true the moment the target changes.
 *
 * It prints the host and never the connection string, which contains a
 * password.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/env.js';

loadEnv();

function hostOf(url: string): string {
  try {
    // A Cloud SQL socket URL has an empty authority and names the directory in
    // a query parameter, which `new URL()` will not give us a hostname for.
    const socket = /[?&]host=([^&]+)/.exec(url)?.[1];
    if (socket) return decodeURIComponent(socket);
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const url = process.env['DATABASE_MIGRATE_URL'] ?? process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_MIGRATE_URL (or DATABASE_URL) is required.');
  process.exit(1);
}

const host = hostOf(url);
const confirmed = process.env['CONFIRM_MIGRATE_HOST'];

if (!confirmed || confirmed !== host) {
  console.error(
    [
      '',
      `  Refusing to migrate ${host || '(unparseable connection string)'}.`,
      '',
      '  This applies schema changes to whatever DATABASE_MIGRATE_URL points at.',
      '  Name the host you mean:',
      '',
      `      CONFIRM_MIGRATE_HOST=${host || '<host>'} pnpm db:migrate:prod`,
      '',
      '  A bare "1" is not accepted: the permission has to name the database it',
      '  grants, so that it stops being true when the target changes.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`migrating ${host}`);

// Run the ordinary migrator as a child rather than importing it: it is a
// top-level-await module that runs on import, and the guard above should be
// the only thing between the operator and that.
const here = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', path.join(here, '..', 'src', 'db', 'migrate.ts')],
  { stdio: 'inherit', env: process.env },
);
process.exit(result.status ?? 1);
