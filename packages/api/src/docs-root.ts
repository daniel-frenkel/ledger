/**
 * Where `docs/` is, at runtime.
 *
 * Two things the API reads from disk rather than from the database: the
 * locating assistant's system prompt (`docs/theory/`) and the clinician BAA
 * (`docs/legal/`). Both are deliberate — the prompt is read from the corpus so
 * that it cannot drift from the document a clinician could be shown, and the
 * BAA's frontmatter is the only source of the version anyone accepts.
 *
 * Both used to find the directory by walking up for `pnpm-workspace.yaml`,
 * which works from a checkout and **fails in the container**: the deployed
 * image has no workspace file, so the walk reaches the filesystem root and
 * returns null. That is the whole of the packaging gap that has been carried
 * since the assistant was built.
 *
 * So: one resolution point, and an explicit override. The image sets
 * `DOCS_ROOT=/app` and copies the two directories there, which makes the
 * container's layout a stated fact rather than something inferred from a file
 * that happens to be lying around. A checkout sets nothing and the walk still
 * works.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { findWorkspaceRoot } from './env.js';

/** The directory containing `docs/`, or null if neither route finds one. */
export function docsRoot(): string | null {
  const configured = config().DOCS_ROOT;
  if (configured) return configured;
  return findWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
}

/**
 * A path under `docs/`, or null when the root is unknown or the file is absent.
 *
 * Returning null rather than throwing keeps the decision with the caller: the
 * assistant refuses to boot without its corpus, and the BAA routes fail with a
 * 503 while the rest of the API carries on. Those are different answers to the
 * same missing directory and both are right.
 */
export function docsFile(...parts: string[]): string | null {
  const root = docsRoot();
  if (!root) return null;
  const file = path.join(root, 'docs', ...parts);
  return fs.existsSync(file) ? file : null;
}
