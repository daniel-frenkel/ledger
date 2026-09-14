#!/usr/bin/env node
/**
 * Assert the skip count per package against test-skips.json.
 *
 * A skipped test is a test that is not running, and a summary line does not
 * make that obvious: "94 passed, 1 skipped" and "88 passed, 7 skipped" look
 * nearly identical to anyone scanning at speed. A suite can therefore stop
 * checking things while every run stays green — which has already happened
 * here once, when a stale `.next` silently removed six prerender assertions.
 *
 * Pass counts do not catch it either. Six tests disappearing into skips also
 * drops the pass count by six, and nobody knows what the pass count "should"
 * be. The skip count is the number with a known correct value.
 *
 * Both directions fail:
 *
 *   more skips than expected  — something stopped running
 *   fewer skips than expected — a guard changed, and nobody said so
 *
 * Neither is necessarily a bug. Both are necessarily a decision, and the
 * decision belongs in the inventory rather than in whoever happens to read
 * the summary line that week.
 *
 * Reads the JSON reporter output each package writes under CI; see each
 * package's vitest.config.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'test-skips.json'), 'utf8'));

/**
 * Each SUITE's report, not each package's.
 *
 * `@ledger/api` runs twice — the ordinary suite and `test:rls` — and they both
 * used to write `.vitest-results.json` in the same directory. The second run
 * overwrote the first, so this script was reading 66 rls tests and reporting
 * them as the api package, and the 290-test api suite had no skip assertion at
 * all. It passed the whole time, which is the same failure this script exists
 * to catch, one level up.
 *
 * So the unit here is the suite and its report path is explicit. A suite that
 * shares a path with another is the bug; naming the paths makes that visible.
 */
const REPORTS = {
  '@ledger/shared': 'packages/shared/.vitest-results.json',
  '@ledger/web': 'apps/web/.vitest-results.json',
  '@ledger/clinician': 'apps/clinician/.vitest-results.json',
  '@ledger/api': 'packages/api/.vitest-results.json',
  '@ledger/api (rls)': 'packages/api/.vitest-results-rls.json',
};

let failed = false;
const say = (s) => process.stdout.write(`${s}\n`);

for (const [pkg, spec] of Object.entries(inventory.packages)) {
  const rel = REPORTS[pkg];
  if (!rel) {
    say(`✗ ${pkg}: named in test-skips.json but not in this script's REPORTS map`);
    failed = true;
    continue;
  }

  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    // Not a soft skip: a missing report is indistinguishable from a suite that
    // never ran, which is the exact failure this script exists to catch.
    say(`✗ ${pkg}: no report at ${rel}. Did the suite run with the JSON reporter?`);
    failed = true;
    continue;
  }

  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tests = (report.testResults ?? []).flatMap((f) => f.assertionResults ?? []);
  const skipped = tests.filter((t) => t.status === 'pending' || t.status === 'skipped' || t.status === 'todo');

  const names = skipped
    .map((t) => (t.fullName ?? t.title ?? '').trim())
    .sort();

  if (skipped.length !== spec.expected) {
    say(`✗ ${pkg}: expected ${spec.expected} skipped, found ${skipped.length}`);
    for (const n of names) say(`    skipped: ${n}`);
    say(`    If this is right, update test-skips.json and say why in the "why" field.`);
    failed = true;
    continue;
  }

  // The count matching is not enough: one skip swapping for another keeps the
  // count and changes what is being checked.
  const allowed = new Set((spec.allowed ?? []).map((a) => a.name.trim()));
  const unexpected = names.filter((n) => !allowed.has(n));
  if (unexpected.length > 0) {
    say(`✗ ${pkg}: the skip count is right but the skips are not the inventoried ones`);
    for (const n of unexpected) say(`    unexpected: ${n}`);
    failed = true;
    continue;
  }

  say(`✓ ${pkg}: ${skipped.length} skipped, all inventoried (${tests.length} tests)`);
}

for (const suite of Object.keys(REPORTS)) {
  if (!inventory.packages[suite]) {
    say(`✗ ${suite}: has a report path but no entry in test-skips.json`);
    failed = true;
  }
}

if (failed) {
  say('');
  say('The skip inventory is test-skips.json. A skip appearing or disappearing');
  say('is a change to what this repository checks, so it fails until recorded.');
  process.exit(1);
}
