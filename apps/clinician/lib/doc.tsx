/**
 * The two pieces every source-document page shares: the rendered body, and the
 * contents column built from its H2s.
 *
 * The HTML comes from lib/markdown, which runs at build time over files
 * committed in this repo. There is no user input anywhere in this path.
 */
import React from 'react';
import type { RenderResult } from './markdown/render';

export const DocBody = ({ html }: { html: string }) => (
  <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
);

/** The in-page table of contents. Renders nothing when a document has no H2s. */
export function Contents({ toc, label = 'In this document' }: { toc: RenderResult['toc']; label?: string }) {
  if (toc.length === 0) return null;
  return (
    <nav className="toc" aria-label={label}>
      <p className="eyebrow">{label}</p>
      <ol>
        {toc.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`}>{h.text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * A document page: body on the left, sticky contents on the right.
 * `head` is everything above the document — title, chips, locator block.
 */
export const DocLayout = ({ head, out }: { head: React.ReactNode; out: RenderResult }) => (
  <main>
    {head}
    <div className="doc">
      <DocBody html={out.html} />
      <Contents toc={out.toc} />
    </div>
  </main>
);
