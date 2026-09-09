/**
 * docs/theory markdown → HTML, at build time.
 *
 * The rule for this module is that it renders and does not edit. Every
 * transform below either rewrites Obsidian-only syntax into its standard
 * markdown equivalent, or attaches structure the pages need (heading ids, a
 * table of contents). Nothing is dropped, reordered, or reworded.
 *
 *   [[Target]] / [[Target|label]]  → a link when the target resolves,
 *                                    plain text when it does not
 *   ![[figure.png]]                → <img src="/theory/figure.png">
 *   > [!note] Title                → <aside class="callout note">
 *
 * The one fenced code block in the corpus (the Decision Map's mermaid source)
 * is left as a code block: no renderer is loaded for it, and showing the
 * source keeps the content rather than losing it.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import { toString as mdToString } from 'mdast-util-to-string';
import type { Root as MdRoot } from 'mdast';
import type { Root as HRoot, Element } from 'hast';
import { WIKILINK, resolveTarget, slugify } from './links';
import { figureFiles, type SourceDoc } from './sources';

/** Obsidian callout types used in the corpus. */
const CALLOUT_TYPES = new Set(['note', 'info', 'todo', 'warning', 'caution', 'danger', 'abstract']);

/** Escape the characters that would otherwise re-parse as markdown syntax. */
const escapeLabel = (s: string): string => s.replace(/([[\]])/g, '\\$1');

/** Split a document into fenced-code and prose runs, so we never rewrite code. */
function outsideCode(body: string, fn: (chunk: string) => string): string {
  const parts = body.split(/(^```[\s\S]*?^```)/gm);
  return parts.map((part, i) => (i % 2 === 1 ? part : fn(part))).join('');
}

/** The heading nearest above a position, for figure alt text. */
function nearestHeading(body: string, index: number): string {
  const before = body.slice(0, index);
  const headings = [...before.matchAll(/^#{1,6}\s+(.+)$/gm)];
  return headings.at(-1)?.[1]?.trim() ?? '';
}

export interface RenderResult {
  html: string;
  /** H2s in source order, for the in-page table of contents. */
  toc: { id: string; text: string }[];
  /** Wikilink targets in this document that did not resolve. */
  unresolved: string[];
  /** Embed targets in this document with no file in docs/theory/figures. */
  missingFigures: string[];
}

/**
 * Rewrite the Obsidian syntax. Returns standard markdown plus what did not
 * resolve, so the caller and the tests see the same answer.
 */
function preprocess(doc: SourceDoc): { md: string; unresolved: string[]; missingFigures: string[] } {
  const figures = new Set(figureFiles());
  const unresolved: string[] = [];
  const missingFigures: string[] = [];
  const body = doc.body;

  const md = outsideCode(body, (chunk) =>
    chunk.replace(WIKILINK, (whole, bang: string, inner: string, offset: number) => {
      const flat = inner.replace(/\s+/g, ' ').trim();
      const cut = flat.search(/\\?\|/);
      const target = (cut === -1 ? flat : flat.slice(0, cut)).trim();
      const label = cut === -1 ? target : flat.slice(cut).replace(/^\\?\|/, '').trim();

      if (bang === '!') {
        if (!figures.has(target)) {
          missingFigures.push(target);
          return escapeLabel(label);
        }
        // `offset` is into the chunk, not the document; each embed is unique.
        void offset;
        const at = body.indexOf(whole);
        const alt = nearestHeading(body, at === -1 ? 0 : at);
        return `![${escapeLabel(alt || doc.title)}](/theory/${target})`;
      }

      const hit = resolveTarget(target, doc);
      if (!hit) {
        unresolved.push(target);
        return escapeLabel(label);
      }
      return `[${escapeLabel(label)}](${hit.href})`;
    }),
  );

  return { md, unresolved, missingFigures };
}

/** > [!note] Title → <aside class="callout note"><b class="c-title">Title</b>… */
function remarkCallouts() {
  return (tree: MdRoot) => {
    visit(tree, 'blockquote', (node) => {
      const first = node.children[0];
      if (!first || first.type !== 'paragraph') return;
      const lead = first.children[0];
      if (!lead || lead.type !== 'text') return;
      // Only the first line of the paragraph carries the marker; the callout's
      // body follows it in the same text node.
      const m = /^\[!([a-zA-Z]+)\][ \t]*([^\n]*)/.exec(lead.value);
      if (!m) return;
      const type = (m[1] ?? '').toLowerCase();
      if (!CALLOUT_TYPES.has(type)) return;

      const title = (m[2] ?? '').trim();
      // Drop the marker line; keep everything that followed it in that paragraph.
      const rest = lead.value.slice(m[0].length).replace(/^\n/, '');
      if (rest === '') first.children.shift();
      else lead.value = rest;
      if (first.children.length === 0) node.children.shift();

      node.data = {
        ...node.data,
        hName: 'aside',
        hProperties: { className: ['callout', type] },
      };
      if (title !== '') {
        node.children.unshift({
          type: 'paragraph',
          data: { hName: 'b', hProperties: { className: ['c-title'] } },
          children: [{ type: 'text', value: title }],
        });
      }
    });
  };
}

/**
 * Heading ids, using the same slugify the wikilink resolver uses, so a
 * [[#Heading]] anchor and the id it points at cannot drift apart.
 */
function rehypeHeadingIds() {
  return (tree: HRoot) => {
    const seen = new Map<string, number>();
    visit(tree, 'element', (node: Element) => {
      if (!/^h[1-6]$/.test(node.tagName)) return;
      const base = slugify(
        node.children.map((c) => ('value' in c ? String(c.value) : 'children' in c ? mdToString(c) : '')).join(''),
      );
      if (base === '') return;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      node.properties = { ...node.properties, id: n === 0 ? base : `${base}-${n}` };
    });
  };
}

/**
 * Wrap tables so a wide one scrolls inside its own box instead of stretching
 * the page. The Pin targets tables are three columns of prose.
 */
function rehypeWrapTables() {
  return (tree: HRoot) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'table' || !parent || index === undefined) return;
      if (parent.type === 'element' && parent.tagName === 'div') return;
      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['tablewrap'] },
        children: [node],
      };
    });
  };
}

/** H2s, matching the ids rehypeHeadingIds assigns. */
function tableOfContents(md: string): { id: string; text: string }[] {
  const seen = new Map<string, number>();
  const out: { id: string; text: string }[] = [];
  for (const line of md.split('\n')) {
    const m = /^##\s+(.+)$/.exec(line);
    if (!m) continue;
    // Strip inline markdown so the id matches the rendered text.
    const text = (m[1] ?? '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`\\]/g, '')
      .trim();
    const base = slugify(text);
    if (base === '') continue;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ id: n === 0 ? base : `${base}-${n}`, text });
  }
  return out;
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCallouts)
  .use(remarkRehype)
  .use(rehypeHeadingIds)
  .use(rehypeWrapTables)
  .use(rehypeStringify);

/**
 * Render a document. `dropTitle` removes the leading H1, for pages that show
 * the title in their own header — the text still appears, once.
 */
export function render(doc: SourceDoc, opts: { dropTitle?: boolean } = {}): RenderResult {
  const { md, unresolved, missingFigures } = preprocess(doc);
  const body = opts.dropTitle ? md.replace(/^#\s+.+\n/, '') : md;
  const html = String(processor.processSync(body));
  return { html, toc: tableOfContents(body), unresolved, missingFigures };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The section of a document under a given H2, as markdown. Used for summaries. */
export function sectionOf(doc: SourceDoc, heading: string): string {
  const re = new RegExp(`^##\\s+${escapeRe(heading)}\\s*$`, 'm');
  const start = re.exec(doc.body);
  if (!start) return '';
  const after = doc.body.slice(start.index + start[0].length);
  const end = /^#{1,2}\s+/m.exec(after);
  return (end ? after.slice(0, end.index) : after).trim();
}
