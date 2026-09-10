/**
 * Which clinician BAA this build asks people to accept.
 *
 * One source: the frontmatter of `docs/legal/clinician-baa.md`. The clinician
 * app renders that document and offers its version; the API accepts only the
 * version it reads from the same file. A constant here that could drift from
 * the document would mean recording consent to text nobody can produce.
 *
 * Read lazily and cached, not at boot. A deployment missing `docs/legal/`
 * should fail the two routes that need the agreement, loudly, rather than
 * refuse to start — the rest of the API has nothing to do with it. Packaging
 * the docs directories with the image is a Prompt 2 item; see docs/data-path.md.
 *
 * Parsed by hand rather than with a frontmatter library: the API has never
 * needed one, and "the line beginning `version:` inside the leading `---`
 * block" is not worth a dependency.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findWorkspaceRoot } from './env.js';

export const BAA_FILE = 'docs/legal/clinician-baa.md';

export class BaaUnavailableError extends Error {
  constructor(reason: string) {
    super(`the business associate agreement is unavailable (${reason})`);
    this.name = 'BaaUnavailableError';
  }
}

export interface BaaDoc {
  version: string;
  /** True while this is the placeholder rather than counsel's template. */
  draft: boolean;
}

/** The frontmatter of a markdown file: the block between the first two `---`. */
export function parseFrontmatter(raw: string): Record<string, string> {
  // CR is a line terminator in JS regex; normalise before anything parses.
  const text = raw.replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

let cached: BaaDoc | undefined;

export function baaDoc(): BaaDoc {
  if (cached) return cached;
  const root = findWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
  if (!root) throw new BaaUnavailableError('cannot find the workspace root');
  const file = path.join(root, BAA_FILE);
  if (!fs.existsSync(file)) throw new BaaUnavailableError(`missing ${BAA_FILE}`);

  const front = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const version = front['version'];
  if (!version) throw new BaaUnavailableError(`${BAA_FILE} has no version in its frontmatter`);

  cached = { version, draft: /^\s*DRAFT\b/i.test(front['status'] ?? '') };
  return cached;
}

/** The version string recorded on acceptance. */
export const baaVersion = (): string => baaDoc().version;
