/**
 * What `next build` actually emitted.
 *
 * Every page in this app is reference material with no client data, so all of
 * it prerenders. This checks the build output rather than the intent: a route
 * that quietly fell back to server rendering, or a document that stopped being
 * routed, shows up here.
 *
 * CI builds the clinician app before running its tests so that .next exists.
 * Run locally without a build and these skip, loudly, rather than passing on
 * nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { figureFiles, sources, sourcesIn } from '../lib/markdown/sources';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, '..', '.next', 'server', 'app');
const built = fs.existsSync(APP);

/** The routes every published document should have produced. */
const documentRoutes = (): string[] => [...new Set(sources().flatMap((d) => (d.href ? [d.href] : [])))].sort();

/** The rest of the Library, which is not one document each. */
const INDEX_ROUTES = [
  '/',
  '/formulate',
  '/library',
  '/library/floors',
  '/library/protocols',
  '/library/references',
  '/library/tools',
];

const htmlFor = (route: string): string =>
  path.join(APP, route === '/' ? 'index.html' : `${route.replace(/^\//, '')}.html`);

describe.skipIf(!built)('next build prerenders every route', () => {
  it('emits an HTML file for every published source document', () => {
    const missing = documentRoutes().filter((r) => !fs.existsSync(htmlFor(r)));
    expect(missing).toEqual([]);
  });

  it('emits an HTML file for every index route', () => {
    const missing = INDEX_ROUTES.filter((r) => !fs.existsSync(htmlFor(r)));
    expect(missing).toEqual([]);
  });

  it('prerenders all thirteen protocols, all eight floors and every tool', () => {
    const count = (dir: string) =>
      fs.existsSync(path.join(APP, dir)) ? fs.readdirSync(path.join(APP, dir)).filter((f) => f.endsWith('.html')).length : 0;
    expect(count('library/protocols')).toBe(13);
    expect(count('library/floors')).toBe(8);
    expect(count('library/tools')).toBe(sourcesIn('tools').length);
  });

  it('put the documents into the HTML, not a loading state', () => {
    const panic = fs.readFileSync(htmlFor('/library/protocols/panic'), 'utf8');
    expect(panic).toContain('Phase 0 — The gates');
    expect(panic).toContain('/theory/panic-loop.png');
    expect(panic).toContain('Salkovskis 1991');

    const floor4 = fs.readFileSync(htmlFor('/library/floors/4'), 'utf8');
    expect(floor4).toContain('The straddle');
    expect(floor4).toContain('Rank-reactive mood instability');

    const note = fs.readFileSync(htmlFor('/library/protocols/rank-reactive-mood-instability'), 'utf8');
    expect(note).toContain('Clinical note');
    expect(note).toContain('Verification block');
  });

  it('leaves no unrendered Obsidian syntax in any page', () => {
    // Next embeds its RSC flight payload in <script> tags, and that payload is
    // full of "[[" as ordinary JSON. Only the markup is checked.
    const markup = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad: string[] = [];
    for (const route of [...documentRoutes(), ...INDEX_ROUTES]) {
      const html = markup(fs.readFileSync(htmlFor(route), 'utf8'));
      if (/\[\[[^\]]+\]\]/.test(html)) bad.push(`${route}: wikilink`);
      if (/&gt;\s*\[!/.test(html)) bad.push(`${route}: callout`);
      if (/\[!(note|info|todo|warning|caution|danger|abstract)\]/.test(html)) bad.push(`${route}: callout marker`);
    }
    expect(bad).toEqual([]);
  });

  it('copied every figure into public/theory', () => {
    const pub = path.join(here, '..', 'public', 'theory');
    const served = fs.readdirSync(pub).filter((f) => f.endsWith('.png')).sort();
    // Every figure the sources have, and nothing invented.
    expect(served).toEqual(figureFiles());
  });
});

describe.skipIf(built)('build output', () => {
  it('is absent — run `pnpm --filter @ledger/clinician build` to check prerendering', () => {
    expect(built).toBe(false);
  });
});
