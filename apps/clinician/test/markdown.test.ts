/**
 * The pipeline against the real documents in docs/theory.
 *
 * The load-bearing test is the wikilink one: every [[target]] in the corpus
 * either resolves to a page or is named in EXPECTED_UNRESOLVED. A new dangling
 * link fails the build, which is the only way to notice that a document was
 * renamed out from under a link.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_MISSING_FIGURES,
  EXPECTED_UNRESOLVED,
  findLinks,
  isExpectedUnresolved,
  resolveTarget,
  slugify,
} from '../lib/markdown/links';
import { figureFiles, floorSource, sources, sourcesIn } from '../lib/markdown/sources';
import { render, sectionOf } from '../lib/markdown/render';

const docs = sources();

describe('the source registry', () => {
  it('finds every document', () => {
    expect(sourcesIn('protocols')).toHaveLength(13);
    expect(sourcesIn('floors')).toHaveLength(8);
    expect(sourcesIn('tools')).toHaveLength(4);
    expect(figureFiles()).toHaveLength(26);
  });

  it('routes each kind to its page', () => {
    expect(docs.find((d) => d.name === 'panic')?.href).toBe('/library/protocols/panic');
    expect(docs.find((d) => d.name === 'clinicians-guide')?.href).toBe('/library/model');
    expect(docs.find((d) => d.name === 'decision-aid-locating-the-floor')?.href).toBe(
      '/library/tools/decision-aid-locating-the-floor',
    );
    expect(floorSource(4)?.href).toBe('/library/floors/4');
  });

  it('reads the clinical note as a clinical note, from its own frontmatter', () => {
    const note = docs.find((d) => d.name === 'rank-reactive-mood-instability');
    expect(note?.kind).toBe('clinical-note');
    expect(docs.find((d) => d.name === 'panic')?.kind).toBe('protocol');
  });

  it('every floor 1-8 has a note', () => {
    for (let n = 1; n <= 8; n++) expect(floorSource(n), `floor ${n}`).toBeDefined();
  });
});

describe('wikilinks', () => {
  it('every target in every document resolves or is a known vault document', () => {
    const dangling: string[] = [];
    for (const doc of docs) {
      for (const link of findLinks(doc.body)) {
        if (link.embed) continue;
        if (link.target.startsWith('#')) continue;
        if (resolveTarget(link.target, doc)) continue;
        if (isExpectedUnresolved(link.target)) continue;
        dangling.push(`${doc.file}: [[${link.target}]]`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it('resolves the forms the corpus actually uses', () => {
    const panic = docs.find((d) => d.name === 'panic')!;
    // Short title, with the ", derived from the model" suffix left off.
    expect(resolveTarget('Protocol — Health Anxiety', panic)?.href).toBe('/library/protocols/health-anxiety');
    // A vault folder we do not have.
    expect(resolveTarget('floor-notes/Floor 7 — Body and Interoception', panic)?.href).toBe('/library/floors/7');
    // Floor 4's link name disagrees with its own title; the number decides.
    expect(resolveTarget('floor-notes/Floor 4 — Relational Templates', panic)?.href).toBe('/library/floors/4');
    // A frontmatter alias.
    expect(resolveTarget('Floor Locator Procedure', panic)?.href).toBe(
      '/library/tools/decision-aid-locating-the-floor',
    );
    // A heading in the same document.
    expect(resolveTarget('#Pin targets', panic)?.href).toBe('#pin-targets');
  });

  it('reads the escaped pipe Obsidian uses inside table cells', () => {
    const [link] = findLinks('| [[Protocol — Panic\\|Panic]] | x |');
    expect(link?.target).toBe('Protocol — Panic');
    expect(link?.label).toBe('Panic');
  });

  it('reads a link wrapped across two lines', () => {
    const [link] = findLinks('see [[floor-notes/Floor 2 —\nMetacognition]] for more');
    expect(link?.target).toBe('floor-notes/Floor 2 — Metacognition');
  });

  it('every entry in EXPECTED_UNRESOLVED is actually still referenced', () => {
    // Otherwise the list rots into a record of links that no longer exist.
    const all = docs.flatMap((d) => findLinks(d.body).map((l) => l.target));
    for (const e of EXPECTED_UNRESOLVED) {
      expect(all.some((t) => isExpectedUnresolved(t) && slugify(t) === slugify(e)), e).toBe(true);
    }
  });
});

describe('figures', () => {
  const routed = docs.filter((d) => d.href !== null);

  it('every embed in a published document resolves to a file, or is a known gap', () => {
    const known = new Set(EXPECTED_MISSING_FIGURES);
    const missing: string[] = [];
    for (const doc of routed) {
      for (const f of render(doc).missingFigures) if (!known.has(f)) missing.push(`${doc.file}: ${f}`);
    }
    expect(missing).toEqual([]);
  });

  it('every known-missing figure is still embedded somewhere', () => {
    const embedded = new Set(docs.flatMap((d) => findLinks(d.body).filter((l) => l.embed).map((l) => l.target)));
    for (const f of EXPECTED_MISSING_FIGURES) expect(embedded.has(f), f).toBe(true);
  });

  it('all 26 figures are referenced by at least one document', () => {
    const embedded = new Set(docs.flatMap((d) => findLinks(d.body).filter((l) => l.embed).map((l) => l.target)));
    const orphans = figureFiles().filter((f) => !embedded.has(f));
    expect(orphans).toEqual([]);
  });

  it('serves them from public/theory', () => {
    const panic = render(docs.find((d) => d.name === 'panic')!);
    expect(panic.html).toContain('src="/theory/panic-loop.png"');
    // Alt text comes from the nearest heading above the embed.
    expect(panic.html).toMatch(/<img src="\/theory\/panic-loop\.png" alt="[^"]+"/);
  });
});

describe('rendering', () => {
  it('renders every published document without dropping its headings', () => {
    for (const doc of docs.filter((d) => d.href !== null)) {
      const out = render(doc, { dropTitle: true });
      const h2s = doc.body.split('\n').filter((l) => /^##\s+/.test(l)).length;
      expect(out.toc.length, doc.file).toBe(h2s);
      expect(out.html.length, doc.file).toBeGreaterThan(500);
    }
  });

  it('gives every H2 an id the table of contents can reach', () => {
    const ocd = render(docs.find((d) => d.name === 'ocd')!, { dropTitle: true });
    for (const item of ocd.toc) expect(ocd.html, item.id).toContain(`id="${item.id}"`);
    expect(ocd.toc[0]?.text).toBe('The formulation in one line');
  });

  it('renders tables, because the Pin targets sections are tables', () => {
    const panic = render(docs.find((d) => d.name === 'panic')!);
    expect(panic.html).toContain('<table>');
    expect(panic.html).toContain('Salkovskis');
  });

  it('renders Obsidian callouts as aside blocks', () => {
    const aid = render(docs.find((d) => d.name === 'decision-aid-locating-the-floor')!);
    expect(aid.html).toContain('<aside class="callout note">');
    expect(aid.html).toContain('When to leave the aid');
  });

  it('leaves the one fenced code block alone', () => {
    const map = render(docs.find((d) => d.name === 'decision-map-locating-the-floor')!);
    expect(map.html).toContain('language-mermaid');
    // The wikilink rewriter must not have touched anything inside the fence.
    expect(map.html).not.toContain('[[');
  });

  it('turns an unresolved target into its label, not a broken link', () => {
    const note = docs.find((d) => d.name === 'rank-reactive-mood-instability')!;
    const out = render(note);
    expect(out.html).not.toContain('[[');
    expect(out.html).not.toContain('](null)');
  });

  it('pulls a named section out for the protocols index', () => {
    const panic = docs.find((d) => d.name === 'panic')!;
    const one = sectionOf(panic, 'The formulation in one line');
    expect(one).toContain('Panic presents on floor 3');
    expect(one).not.toContain('##');
  });
});
