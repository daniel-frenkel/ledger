import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FRAMEWORK_CAVEAT, NOT_A_THERAPIST } from '@/content/model';
import { sourceByName } from '@/lib/markdown/sources';
import { render } from '@/lib/markdown/render';
import { DocLayout } from '@/lib/doc';

export const metadata = { title: 'The paper — Ledger clinician' };

/**
 * The paper is here because the corpus links to it more than to anything else —
 * twelve wikilinks from six documents, the Decision Aid among them. Without a
 * page those all render as dead plain text.
 *
 * It arrived with 26 of its 33 figures; the seven that are missing render as
 * their alt text and are listed in EXPECTED_MISSING_FIGURES.
 */
export default function PaperPage() {
  const doc = sourceByName('paper');
  if (!doc) notFound();
  const out = render(doc, { dropTitle: true });

  const head = (
    <>
      <p className="crumb">
        <Link href="/library">Library</Link> › {doc.title}
      </p>
      <h1>{doc.title}</h1>
      {doc.subtitle ? <p className="standfirst">{doc.subtitle}</p> : null}

      {/* FRAMING, verbatim and unsoftened. */}
      <div className="callout warning">
        <span className="c-title">Framework, not a validated treatment</span>
        <p>{FRAMEWORK_CAVEAT}</p>
        <p>{NOT_A_THERAPIST}</p>
      </div>
      <p className="meta" style={{ margin: '0 0 1.5rem' }}>
        Seven of this document’s figures are not in the repository. They appear below as their captions.
      </p>
    </>
  );

  return <DocLayout head={head} out={out} />;
}
