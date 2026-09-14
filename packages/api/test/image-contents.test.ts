/**
 * The image has to carry `docs/theory/` and `docs/legal/`.
 *
 * This is a guard against a bug that was live for several prompts and would
 * not have shown up in any other test. Both directories are read from disk at
 * runtime — the locating assistant's system prompt is assembled from the
 * corpus so it cannot drift from the document a clinician could be shown, and
 * the clinician BAA's frontmatter is the only source of the version anyone
 * accepts. Neither was in the image, and neither was findable once it was:
 * both readers walked up for `pnpm-workspace.yaml`, which exists in a checkout
 * and not in a container, so the walk reached `/` and gave up.
 *
 * Every test in this repository passes with that bug present, because every
 * test runs in a checkout. So the assertion has to be about the Dockerfile
 * itself. It is a coarse test and it is the right kind of coarse: it fails
 * when someone removes a line whose purpose is not obvious from where they are
 * standing.
 *
 * It also checks `.dockerignore` does not exclude `docs/`, which would break
 * the image just as completely and even more quietly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findWorkspaceRoot } from '../src/env.js';
import { CORPUS_FILES } from '../src/services/locate-prompt.js';
import { BAA_FILE } from '../src/baa.js';

const root = findWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
if (!root) throw new Error('no workspace root: this test needs a checkout');

const dockerfile = fs.readFileSync(path.join(root, 'packages', 'api', 'Dockerfile'), 'utf8');
const dockerignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');

describe('the runtime image', () => {
  it('copies docs/theory, which the assistant reads at boot', () => {
    expect(dockerfile).toMatch(/^COPY\s+docs\/theory\s+\/app\/docs\/theory\s*$/m);
  });

  it('copies docs/legal, which the BAA version is read from', () => {
    expect(dockerfile).toMatch(/^COPY\s+docs\/legal\s+\/app\/docs\/legal\s*$/m);
  });

  /**
   * Without this the two directories are present and unfindable, which is the
   * worse half of the original bug: the files are right there and the walk for
   * `pnpm-workspace.yaml` still fails.
   */
  it('sets DOCS_ROOT so they can be found without a workspace file', () => {
    expect(dockerfile).toMatch(/^ENV\s+DOCS_ROOT=\/app\s*$/m);
  });

  it('does not exclude docs from the build context', () => {
    const excluded = dockerignore
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    for (const line of excluded) {
      expect(line.replace(/^!/, '').startsWith('docs')).toBe(false);
    }
  });

  /**
   * The static apps are Cloud Run services too, and each has one omission that
   * fails the same way the docs bug did: quietly, and only once deployed.
   *
   * Next's standalone bundle does not trace `.next/static` or `public` into
   * itself. Leave either out and every page renders while every stylesheet,
   * font and image 404s — which looks like a CSS problem rather than a
   * packaging one, and nothing in a checkout reproduces it.
   */
  it('the clinician image carries the assets standalone does not trace', () => {
    const f = fs.readFileSync(path.join(root, 'apps', 'clinician', 'Dockerfile'), 'utf8');
    expect(f).toMatch(/\.next\/standalone/);
    expect(f).toMatch(/\.next\/static\s+\.\/apps\/clinician\/\.next\/static/);
    expect(f).toMatch(/apps\/clinician\/public\s+\.\/apps\/clinician\/public/);
  });

  it('the web image carries its nginx config and the built app', () => {
    const f = fs.readFileSync(path.join(root, 'apps', 'web', 'Dockerfile'), 'utf8');
    expect(f).toMatch(/apps\/web\/nginx\.conf\s+\/etc\/nginx\/conf\.d\/default\.conf/);
    expect(f).toMatch(/apps\/web\/dist\s+\/usr\/share\/nginx\/html/);
  });

  // The image copies directories, so a file added to either one travels
  // automatically — but only if it is under the directory that is copied.
  it('copies the directories the readers actually name', () => {
    for (const f of CORPUS_FILES) {
      expect(f.startsWith('..')).toBe(false);
      expect(fs.existsSync(path.join(root, 'docs', 'theory', f))).toBe(true);
    }
    expect(BAA_FILE.startsWith('docs/legal/')).toBe(true);
    expect(fs.existsSync(path.join(root, BAA_FILE))).toBe(true);
  });
});
