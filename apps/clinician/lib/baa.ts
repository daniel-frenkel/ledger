/**
 * The clinician BAA document, read at build time.
 *
 * It lives in docs/legal/ rather than docs/theory/, so the Library's markdown
 * pipeline does not see it — deliberately: it is a contract, not reference
 * material, and it must never appear in the reference assistant's corpus.
 *
 * The version string in the frontmatter is what gets recorded on acceptance,
 * and the API refuses a version it does not serve. Changing it is what asks
 * every clinician to accept again.
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const FILE = 'docs/legal/clinician-baa.md';

function repoRoot(from = process.cwd()): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('cannot find the workspace root');
    dir = parent;
  }
}

export interface Baa {
  version: string;
  /** True while this is the placeholder rather than counsel's template. */
  draft: boolean;
  body: string;
}

export function baa(): Baa {
  // CR is a line terminator in JS regex; normalise once, at the read.
  const raw = fs.readFileSync(path.join(repoRoot(), FILE), 'utf8').replace(/\r\n?/g, '\n');
  const { data, content } = matter(raw);
  const version = typeof data['version'] === 'string' ? data['version'] : 'unversioned';
  const status = typeof data['status'] === 'string' ? data['status'] : '';
  return { version, draft: /^\s*DRAFT\b/i.test(status), body: content.trim() };
}
