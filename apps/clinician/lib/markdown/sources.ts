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
  /** The frontmatter `status` line, where the document has one. */
  status?: string;
  /**
   * The document says it is a draft. Drafts do not route and are not part of
   * the corpus — see isDraft.
   */
  draft: boolean;
}

/**
 * A document is a draft when its frontmatter `status` begins with "DRAFT".
 *
 * The author marks unfinished work that way, and unfinished work must not
 * reach a clinician: it gets no route, and corpus() leaves it out, so the
 * reference assistant cannot quote from it either. The check is on the
 * document's own declaration rather than on a list kept here, so marking a
 * file draft is a one-line edit to the file and nothing else.
 */
export const isDraft = (status: string | undefined): boolean => /^\s*DRAFT\b/i.test(status ?? '');

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
      const status = typeof data['status'] === 'string' ? data['status'] : undefined;
      const draft = isDraft(status);
      const placed = route(file, name, frontType);
      return {
        file,
        name,
        title,
        ...(subtitle ? { subtitle } : {}),
        ...(status ? { status } : {}),
        aliases: asStrings(data['aliases']),
        body: content,
        draft,
        ...placed,
        // A draft keeps its kind — it is still a tool, still a protocol — and
        // loses only its route.
        href: draft ? null : placed.href,
      };
    });
  return cache;
}

/**
 * The documents a reader — or the reference assistant — may be shown.
 *
 * Everything except drafts. Use this anywhere a document's *content* is about
 * to be surfaced; use sources() only where the full set matters, such as
 * resolving a wikilink or checking that a draft is correctly excluded.
 */
export const corpus = (): SourceDoc[] => sources().filter((d) => !d.draft);

export const drafts = (): SourceDoc[] => sources().filter((d) => d.draft);

/** Publishable documents under a directory. Drafts are not included. */
export const sourcesIn = (dir: string): SourceDoc[] =>
  corpus().filter((d) => d.file.startsWith(`${dir}/`));

/** Every document under a directory, drafts included. */
export const allSourcesIn = (dir: string): SourceDoc[] =>
  sources().filter((d) => d.file.startsWith(`${dir}/`));

export const sourceByFile = (file: string): SourceDoc | undefined => sources().find((d) => d.file === file);

export const sourceByName = (name: string): SourceDoc | undefined => sources().find((d) => d.name === name);

export const floorSource = (n: number): SourceDoc | undefined => sources().find((d) => d.floor === n);

/** The figure filenames actually on disk, for the embed resolver and its test. */
export const figureFiles = (): string[] =>
  fs
    .readdirSync(FIGURES_DIR)
    .filter((f) => f.endsWith('.png'))
    .sort();
