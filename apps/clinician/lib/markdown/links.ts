/**
 * Wikilink and embed resolution.
 *
 * Obsidian links target a document by *title*, not by path, and the corpus
 * uses several forms for the same document:
 *
 *   [[Protocol — Panic]]                    the title, shortened
 *   [[Protocol — Panic\|Panic]]             escaped pipe, because it is in a table cell
 *   [[floor-notes/Floor 2 — Metacognition]] a vault folder we do not have
 *   [[Floor Locator Procedure]]             a frontmatter alias
 *   [[#CBT — the clean case]]               a heading in the same document
 *
 * Links also wrap across lines, so the target can contain a newline.
 *
 * A target that resolves becomes an internal link. A target that does not —
 * documents that live in the author's vault and not in this repo — becomes
 * plain text, because a dead link is worse than none. Those are listed in
 * EXPECTED_UNRESOLVED, and test/markdown.test.ts fails on any target that is
 * neither resolvable nor listed there.
 */
import { sources, type SourceDoc } from './sources';

/** Heading → anchor id. Matches rehype-slug's output for these headings. */
export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Fold the variants that only differ typographically. */
const norm = (s: string): string =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[—–‒]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/\s*-\s*/g, ' - ')
    .replace(/[.,;:]+$/, '')
    .replace(/\s+/g, ' ');

/** Protocol titles carry a suffix the links leave off. */
const shortTitle = (t: string): string => t.replace(/,\s*derived from the model\s*$/i, '');

/** Every string that should resolve to this document. */
function keysFor(d: SourceDoc): string[] {
  const keys = [d.title, shortTitle(d.title), d.name, ...d.aliases];
  return [...new Set(keys.map(norm))];
}

export interface Resolved {
  href: string;
  /** The document the link landed on, for tests and for the TOC. */
  doc: SourceDoc;
}

/**
 * Targets that are documents in the author's vault, not in this repo. They
 * render as plain text. Adding to this list is a deliberate act: it is the
 * only way to make a dangling link pass the test.
 */
export const EXPECTED_UNRESOLVED: readonly string[] = [
  'Clinical Applications — Status, Mattering, and Rank',
  'The Two Gauges',
  'Bridge — the Masculinity Corpus',
  '_Concepts Index',
  '_draft — The Bill Arrives in Years',
  "2026-08-12 — the elastic self — Barrett's car, and floor seven",
];

/**
 * Figures the corpus embeds that are not in docs/theory/figures. All seven are
 * in paper.md, which arrived with 26 of its 33 figures. They render as their
 * alt text. Same contract as EXPECTED_UNRESOLVED: a new missing figure fails
 * the test, these do not.
 */
export const EXPECTED_MISSING_FIGURES: readonly string[] = [
  '1-precision-dial.png',
  '9-master-loop.png',
  '10-dominance-prestige.png',
  '11-one-building-ten-risers.png',
  'floors-of-the-self-elephant-rider.png',
  'floors-of-the-self-reef-of-selves.png',
  'floors-of-the-self-tower.png',
];

const EXPECTED = new Set(EXPECTED_UNRESOLVED.map(norm));

export const isExpectedUnresolved = (target: string): boolean => EXPECTED.has(norm(stripFolder(target)));

/** "floor-notes/Floor 2 — Metacognition" → "Floor 2 — Metacognition". */
function stripFolder(target: string): string {
  const i = target.lastIndexOf('/');
  return i === -1 ? target : target.slice(i + 1);
}

/**
 * Resolve a wikilink target to a published route.
 *
 * `from` is the document the link appears in, so that a [[#Heading]] target
 * can become an anchor on the page being rendered.
 */
export function resolveTarget(target: string, from: SourceDoc): Resolved | null {
  const clean = target.replace(/\s+/g, ' ').trim();
  if (clean === '') return null;

  // A heading in the same document.
  if (clean.startsWith('#')) {
    const heading = clean.slice(1).trim();
    return from.href ? { href: `#${slugify(heading)}`, doc: from } : null;
  }

  const bare = stripFolder(clean);
  const key = norm(bare);

  // Floor notes: the corpus calls floor 4 "Relational Templates" in some links
  // and "Relational Patterns" in others. The number is the reliable part.
  const floorNo = /^floor\s+(\d)\b/.exec(key)?.[1];
  if (floorNo) {
    const d = sources().find((s) => s.floor === Number(floorNo));
    return d?.href ? { href: d.href, doc: d } : null;
  }

  for (const d of sources()) {
    if (keysFor(d).includes(key)) return d.href ? { href: d.href, doc: d } : null;
  }
  return null;
}

/** Every wikilink target in a body, with its label, in source order. */
export interface FoundLink {
  target: string;
  label: string;
  embed: boolean;
}

/**
 * The one regex the pipeline and the tests share. `[^\]]` spans newlines, so a
 * link wrapped across two lines is still one match.
 */
export const WIKILINK = /(!?)\[\[([^\]]+)\]\]/g;

export function findLinks(body: string): FoundLink[] {
  const out: FoundLink[] = [];
  for (const m of body.matchAll(WIKILINK)) {
    const inner = (m[2] ?? '').replace(/\s+/g, ' ').trim();
    // Obsidian escapes the label pipe as \| inside table cells.
    const cut = inner.search(/\\?\|/);
    const target = (cut === -1 ? inner : inner.slice(0, cut)).trim();
    const label = cut === -1 ? target : inner.slice(cut).replace(/^\\?\|/, '').trim();
    out.push({ target, label, embed: m[1] === '!' });
  }
  return out;
}
