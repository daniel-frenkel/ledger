/**
 * The document behind each protocol page.
 *
 * Split from content/protocols.ts because this half reads the filesystem and
 * the locator on /formulate is a client component. Server components only.
 */
import { ONE_LINE, PROTOCOLS, type Protocol } from './protocols';
import { render, sectionOf } from '@/lib/markdown/render';
import { sourcesIn, type SourceDoc } from '@/lib/markdown/sources';

export type ProtocolLabel = 'Protocol' | 'Clinical note';

export interface ProtocolDoc extends Protocol {
  doc: SourceDoc;
  /** The document's own title, shortened of its "derived from the model" tail. */
  heading: string;
  /** "Clinical note" where the document's frontmatter says it is one. */
  label: ProtocolLabel;
}

const shortTitle = (t: string): string => t.replace(/,\s*derived from the model\s*$/i, '');

function join(p: Protocol): ProtocolDoc {
  const doc = sourcesIn('protocols').find((d) => d.name === p.slug);
  if (!doc) throw new Error(`No document in docs/theory/protocols for "${p.title}" (expected ${p.slug}.md)`);
  return {
    ...p,
    doc,
    heading: shortTitle(doc.title),
    label: doc.kind === 'clinical-note' ? 'Clinical note' : 'Protocol',
  };
}

export const PROTOCOL_DOCS: readonly ProtocolDoc[] = PROTOCOLS.map(join);

export const protocolDoc = (slug: string): ProtocolDoc | undefined => PROTOCOL_DOCS.find((p) => p.slug === slug);

/**
 * A protocol's summary for the index: its own "The formulation in one line",
 * rendered, not paraphrased. The clinical note has no such section — its
 * document opens with an italic standfirst instead, which is what it gets.
 */
export function summaryHtml(p: ProtocolDoc): string {
  const md = sectionOf(p.doc, ONE_LINE);
  if (md !== '') return render({ ...p.doc, body: md }).html;
  const opening = p.doc.body.replace(/^#\s+.+\n+/, '').split(/\n\s*\n/)[0] ?? '';
  return render({ ...p.doc, body: opening }).html;
}
