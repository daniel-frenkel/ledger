/**
 * The root .env has to be found from wherever a script was launched, because
 * pnpm sets the cwd to the package directory. A real environment variable
 * must still win, and a missing file must stay a no-op (CI has no .env).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findWorkspaceRoot } from '../src/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** A throwaway workspace: <tmp>/pnpm-workspace.yaml, <tmp>/pkg/. */
function fakeWorkspace(envBody?: string): { root: string; pkg: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-env-'));
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "pkg"\n');
  const pkg = path.join(root, 'pkg');
  fs.mkdirSync(pkg);
  if (envBody != null) fs.writeFileSync(path.join(root, '.env'), envBody);
  return { root, pkg };
}

/** A fresh module instance, so the load-once guard starts unset. */
const freshLoadEnv = async () => {
  vi.resetModules();
  return (await import('../src/env.js')).loadEnv;
};

const made: string[] = [];
const workspace = (envBody?: string) => {
  const w = fakeWorkspace(envBody);
  made.push(w.root);
  return w;
};

beforeEach(() => {
  delete process.env.LEDGER_ENV_PROBE;
});

afterEach(() => {
  delete process.env.LEDGER_ENV_PROBE;
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('findWorkspaceRoot', () => {
  it('walks up to the directory holding pnpm-workspace.yaml', () => {
    const { root, pkg } = workspace();
    const nested = path.join(pkg, 'src', 'db');
    fs.mkdirSync(nested, { recursive: true });
    expect(fs.realpathSync(findWorkspaceRoot(nested)!)).toBe(fs.realpathSync(root));
  });

  it('finds this repo from the api package', () => {
    const root = findWorkspaceRoot(path.join(here, '..', 'src'));
    expect(root).not.toBeNull();
    expect(fs.existsSync(path.join(root!, 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('returns null when there is no workspace above', () => {
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-orphan-'));
    made.push(orphan);
    // Only true if no ancestor of the temp dir is a pnpm workspace, which
    // holds for the OS temp directory.
    expect(findWorkspaceRoot(orphan)).toBeNull();
  });
});

describe('loadEnv', () => {
  it('loads the root .env from a package subdirectory', async () => {
    const { root, pkg } = workspace('LEDGER_ENV_PROBE=from-file\n');
    const loadEnv = await freshLoadEnv();
    const loaded = loadEnv(pkg);
    expect(loaded && fs.realpathSync(loaded)).toBe(fs.realpathSync(path.join(root, '.env')));
    expect(process.env.LEDGER_ENV_PROBE).toBe('from-file');
  });

  it('does not override a variable already in the environment', async () => {
    const { pkg } = workspace('LEDGER_ENV_PROBE=from-file\n');
    process.env.LEDGER_ENV_PROBE = 'from-shell';
    const loadEnv = await freshLoadEnv();
    loadEnv(pkg);
    expect(process.env.LEDGER_ENV_PROBE).toBe('from-shell');
  });

  it('is a no-op when the workspace has no .env (CI injects variables)', async () => {
    const { pkg } = workspace();
    const loadEnv = await freshLoadEnv();
    expect(loadEnv(pkg)).toBeNull();
    expect(process.env.LEDGER_ENV_PROBE).toBeUndefined();
  });

  it('is a no-op outside a workspace', async () => {
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-orphan-'));
    made.push(orphan);
    const loadEnv = await freshLoadEnv();
    expect(loadEnv(orphan)).toBeNull();
  });

  it('loads at most once', async () => {
    const { pkg } = workspace('LEDGER_ENV_PROBE=from-file\n');
    const loadEnv = await freshLoadEnv();
    expect(loadEnv(pkg)).not.toBeNull();
    expect(loadEnv(pkg)).toBeNull();
  });
});
