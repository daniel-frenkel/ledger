/**
 * The documents in docs/theory, and where each one is published.
 *
 * These files are the author's. Nothing here edits them: this module locates
 * them, splits the YAML frontmatter off, and records the title, aliases and
 * route each one gets. Everything else in lib/markdown works from this
 * registry — wikilink resolution in particular, which needs to know every
 * title and alias in the corpus before it can decide whether [[Target]] points
 * at a document we publish.
 *
 * Read at build time. Next prerenders every route, so the filesystem is only
 * touched during `next build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

/** The directory holding pnpm-workspace.yaml — the repo root. */
function workspaceRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No pnpm-workspace.yaml above ${from}`);
    dir = parent;
  }
}

export const THEORY_DIR = path.join(workspaceRoot(process.cwd()), 'docs', 'theory');
export const FIGURES_DIR = path.join(THEORY_DIR, 'figures');

/** Where a document is published, and what the Library calls that kind of page. */
export type DocKind =
  | 'protocol'
  | 'clinical-note'
  | 'floor'
  | 'tool'
  | 'guide'
  | 'modalities'
  | 'paper'
  | 'unrouted';

export interface SourceDoc {
  /** Path relative to docs/theory, e.g. "protocols/panic.md". */
  file: string;
  /** Filename without extension — the slug for protocols and tools. */
  name: string;
  kind: DocKind;
  /** Frontmatter title, else the H1. */
  title: string;
  subtitle?: string;
  /** Frontmatter aliases. Wikilinks may target any of these. */
  aliases: string[];
  /** The markdown body, frontmatter removed, otherwise untouched. */
  body: string;
  /** The route this document renders at, or null when it is not published. */
  href: string | null;
  /** Floors 1–8 only. */
  floor?: number;
}

const readTitle = (body: string, fallback: string): string => {
  const m = /^#\s+(.+)$/m.exec(body);
  return m?.[1]?.trim() ?? fallback;
};

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [];

/**
 * The routing table. Documents not named here are still parsed and still
 * resolve as wikilink targets — they simply have no page, so links to them
 * render as plain text.
 */
function route(file: string, name: string, frontType: string | undefined): Pick<SourceDoc, 'kind' | 'href' | 'floor'> {
  if (file.startsWith('protocols/')) {
    // Rank-reactive mood instability is a clinical note, and says so in its own
    // frontmatter. It gets a protocol route but not the protocol label.
    const kind: DocKind = frontType === 'clinical-note' ? 'clinical-note' : 'protocol';
    return { kind, href: `/library/protocols/${name}` };
  }
  if (file.startsWith('floors/')) {
    const n = Number(/^floor-(\d)-/.exec(name)?.[1]);
    return { kind: 'floor', href: `/library/floors/${n}`, floor: n };
  }
  if (file.startsWith('tools/')) return { kind: 'tool', href: `/library/tools/${name}` };
  if (file === 'clinicians-guide.md') return { kind: 'guide', href: '/library/model' };
  if (file === 'modalities.md') return { kind: 'modalities', href: '/library/modalities' };
  // The paper is the most-linked document in the corpus — twelve wikilinks from
  // six others, including the Decision Aid. Unpublished it would render as dead
  // plain text everywhere those links appear.
  if (file === 'paper.md') return { kind: 'paper', href: '/library/paper' };
  return { kind: 'unrouted', href: null };
}

function walk(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

let cache: SourceDoc[] | null = null;

/** Every markdown document under docs/theory, sorted by path. */
export function sources(): SourceDoc[] {
  if (cache) return cache;
  cache = walk(THEORY_DIR)
    .sort()
    .map((file) => {
      // Normalise line endings before anything parses them: CR is a line
      // terminator in JS regex, so /(.+)$/ silently fails on a CRLF file.
      const raw = fs.readFileSync(path.join(THEORY_DIR, file), 'utf8').replace(/\r\n?/g, '\n');
      const { data, content } = matter(raw);
      const name = path.basename(file, '.md');
      const title = typeof data['title'] === 'string' ? data['title'] : readTitle(content, name);
      const subtitle = typeof data['subtitle'] === 'string' ? data['subtitle'] : undefined;
      const frontType = typeof data['type'] === 'string' ? data['type'] : undefined;
      return {
        file,
        name,
        title,
        ...(subtitle ? { subtitle } : {}),
        aliases: asStrings(data['aliases']),
        body: content,
        ...route(file, name, frontType),
      };
    });
  return cache;
}

export const sourcesIn = (dir: string): SourceDoc[] => sources().filter((d) => d.file.startsWith(`${dir}/`));

export const sourceByFile = (file: string): SourceDoc | undefined => sources().find((d) => d.file === file);

export const sourceByName = (name: string): SourceDoc | undefined => sources().find((d) => d.name === name);

export const floorSource = (n: number): SourceDoc | undefined => sources().find((d) => d.floor === n);

/** The figure filenames actually on disk, for the embed resolver and its test. */
export const figureFiles = (): string[] =>
  fs
    .readdirSync(FIGURES_DIR)
    .filter((f) => f.endsWith('.png'))
    .sort();
