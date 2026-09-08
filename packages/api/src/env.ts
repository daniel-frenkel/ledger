/**
 * Finds the one .env at the repo root and loads it.
 *
 * pnpm runs every script with the cwd set to the package directory, so
 * `dotenv/config` — which looks for `.env` in the cwd — never sees the root
 * file. This walks up until it finds the directory holding
 * `pnpm-workspace.yaml` and loads `.env` from there instead, so a single root
 * .env works from the repo root, from packages/api, or from anywhere else.
 *
 * `override: false`: a variable already in the real environment wins. CI sets
 * everything that way and has no .env at all; missing file is not an error.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/** Nearest ancestor of `from` that contains pnpm-workspace.yaml, or null. */
export function findWorkspaceRoot(from: string = process.cwd()): string | null {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

let loaded = false;

/** Load the root .env once. No-op if there is no workspace root or no .env. */
export function loadEnv(from: string = process.cwd()): string | null {
  if (loaded) return null;
  loaded = true;
  const root = findWorkspaceRoot(from);
  if (!root) return null;
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return null;
  dotenv.config({ path: file, override: false });
  return file;
}
