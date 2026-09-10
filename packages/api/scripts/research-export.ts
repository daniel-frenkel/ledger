/**
 * pnpm --filter @ledger/api research:export --dry-run
 * pnpm --filter @ledger/api research:export --write <dir>
 *
 * Manual, deliberate, and loud. It prints the run secret exactly once: without
 * it two exports cannot be joined, and it is not stored anywhere, so losing it
 * means the export cannot be linked to a later one — which is the property,
 * not a bug.
 */
import fs from 'node:fs';
import { runExport } from '../src/research/export.js';
import { ALLOWLIST } from '../src/research/allowlist.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const outDir = args[args.indexOf('--write') + 1];

if (!dryRun && !args.includes('--write')) {
  console.error('Usage: research:export --dry-run | --write <dir>');
  process.exit(2);
}
if (!dryRun) {
  if (!outDir || outDir.startsWith('--')) {
    console.error('--write needs a directory');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
}

const result = await runExport(dryRun ? { dryRun: true } : { dryRun: false, outDir: outDir! });

console.log(`run ${result.runId}`);
console.log(`participants ${result.participants}`);
for (const t of ALLOWLIST) {
  console.log(`  ${t.table}: ${result.rows[t.table] ?? 0} rows, ${t.columns.length + 1} columns`);
}
if (dryRun) {
  console.log('\ndry run — nothing was written.');
} else {
  for (const f of result.files) console.log(`wrote ${f}`);
  console.log('\nRun secret, shown once and stored nowhere:');
  console.log(result.secret);
  console.log('Without it these pseudonyms cannot be linked to any other export.');
}
process.exit(0);
