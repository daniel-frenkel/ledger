import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FRAMEWORK_CAVEAT, NOT_A_THERAPIST } from '@/content/model';
import { sourceByName } from '@/lib/markdown/sources';
import { render } from '@/lib/markdown/render';
import { DocLayout } from '@/lib/doc';

export const metadata = { title: 'The model — Ledger clinician' };

/**
 * This page used to render docs/theory-mapping.md, which is a design memo —
 * written to plan the app, not to teach the model. docs/theory/clinicians-guide.md
 * is the author's own primer, so it is what the page shows now. The FRAMING
 * caveat stays above it, verbatim.
 */
export default function ModelPage() {
  const doc = sourceByName('clinicians-guide');
  if (!doc) notFound();
  const out = render(doc, { dropTitle: true });

  const head = (
    <>
      <p className="crumb">
        <Link href="/library">Library</Link> › The model
      </p>
      <h1>{doc.title}</h1>
      {doc.subtitle ? <p className="standfirst">{doc.subtitle}</p> : null}

      {/* FRAMING, verbatim and unsoftened. */}
      <div className="callout warning">
        <span className="c-title">Framework, not a validated treatment</span>
        <p>{FRAMEWORK_CAVEAT}</p>
        <p>{NOT_A_THERAPIST}</p>
      </div>
    </>
  );

  return <DocLayout head={head} out={out} />;
}
