/**
 * Renders the source documents' inline syntax without altering their text.
 *
 * Content modules hold the sources' own strings, markdown and all, so that what
 * is stored is checkably identical to the document. Three things get resolved
 * here and nowhere else:
 *
 *   **bold** and *italic*   — as written
 *   [[#Heading|label]]      — an anchor to that section on the same page
 *   [[Vault Document]]      — plain text, because those documents are not in
 *                             this repo and a dead link is worse than none
 */
import React from 'react';

/** The anchor id for a section heading, matching the slugs in content. */
export const headingAnchor = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

type Node = React.ReactNode;

/** Split on **bold** and *italic*, innermost-last. */
function emphasise(text: string, keyPrefix: string): Node[] {
  const out: Node[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${keyPrefix}-b${i}`}>{m[1]}</strong>);
    else out.push(<em key={`${keyPrefix}-i${i}`}>{m[2]}</em>);
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * `resolveHeading` maps a [[#Heading]] target to an anchor. Pages that have no
 * sections to link to pass nothing, and those links render as plain text too.
 */
export function Inline({
  text,
  resolveHeading,
}: {
  text: string;
  resolveHeading?: (heading: string) => string | undefined;
}): React.ReactElement {
  const out: Node[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(...emphasise(text.slice(last, m.index), `t${i}`));
    const raw = m[1] ?? '';
    const [targetRaw, labelRaw] = raw.split('|');
    const target = (targetRaw ?? '').trim();
    const label = (labelRaw ?? target).trim();
    if (target.startsWith('#')) {
      const anchor = resolveHeading?.(target.slice(1));
      if (anchor) {
        out.push(
          <a key={`l${i}`} href={`#${anchor}`}>
            {emphasise(label, `l${i}`)}
          </a>,
        );
      } else {
        out.push(...emphasise(label, `l${i}`));
      }
    } else {
      // A vault document, not in this repo: its name, no link.
      out.push(...emphasise(label, `l${i}`));
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(...emphasise(text.slice(last), `t${i}`));
  return <>{out}</>;
}

/** A paragraph of source text. */
export const P = ({
  text,
  className,
  resolveHeading,
}: {
  text: string;
  className?: string;
  resolveHeading?: (heading: string) => string | undefined;
}) => (
  <p className={className}>
    <Inline text={text} resolveHeading={resolveHeading} />
  </p>
);

/** The block shown wherever the sources do not yet contain the content. */
export const AwaitingAuthor = ({ what }: { what?: string }) => (
  <p className="awaiting">Awaiting author.{what ? ` — ${what}` : ''}</p>
);
