/**
 * One spelling of the product name: **CourageLoop**.
 *
 * Not Courageloop, not Courage Loop, not COURAGELOOP. Lowercase `courageloop`
 * is fine and deliberately allowed — it is the hostname, and hostnames are
 * lowercase.
 *
 * This lives in `packages/shared` rather than anywhere more obviously its own
 * because shared's suite needs no database and runs first in CI, so a bad
 * casing fails the build in seconds instead of after Postgres comes up.
 *
 * Two exclusions. `docs/theory/` is the theory corpus: it is about the model,
 * not the product, and nothing in it should be renamed to match a brand.
 * `docs/code-prompts.md` and this file itself are excluded because the prompt
 * that ordered this test spells out the wrong casings in order to forbid them,
 * and a test that fails on its own specification is a test nobody can keep.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

function workspaceRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('no pnpm-workspace.yaml above ' + from);
    dir = parent;
  }
}

const ROOT = workspaceRoot(here);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.expo',
  'dist',
  'build',
  'coverage',
  '.turbo',
]);

/**
 * Paths, relative to the repo root, that this rule does not govern — including
 * this file, which has to write the forbidden spellings down in order to
 * forbid them, exactly as the prompt file does.
 */
const SKIP_PATHS = [
  'docs/theory',
  'docs/code-prompts.md',
  path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/'),
];

const EXTENSIONS = new Set(['.md', '.ts', '.tsx']);

/** Any mention of the name, however it is spelled or spaced. */
const MENTION = /courage[\s_-]*loop/gi;

/** The only two spellings that may survive: the wordmark, and the hostname. */
const ALLOWED = new Set(['CourageLoop', 'courageloop']);

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (SKIP_PATHS.some((p) => rel === p || rel.startsWith(p + '/'))) continue;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

interface Wrong {
  where: string;
  spelled: string;
}

function misspellings(): Wrong[] {
  const found: Wrong[] = [];
  for (const file of walk(ROOT)) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(MENTION)) {
        if (ALLOWED.has(m[0])) continue;
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        found.push({ where: `${rel}:${i + 1}`, spelled: m[0] });
      }
    });
  }
  return found;
}

describe('the product name', () => {
  it('is spelled CourageLoop everywhere it appears', () => {
    const wrong = misspellings();
    // The message is the point: on a failure it names the file, the line and
    // the spelling, so the fix needs no second search.
    expect(wrong.map((w) => `${w.where}  "${w.spelled}"`)).toEqual([]);
  });

  // A grep for wrong spellings passes trivially on a repo that never mentions
  // the name at all, which is exactly what a botched or reverted rename looks
  // like. This is the other half of the assertion.
  it('appears in the README', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('CourageLoop');
  });
});
