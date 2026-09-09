import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sourceByName, sourcesIn } from '@/lib/markdown/sources';
import { render } from '@/lib/markdown/render';
import { DocLayout } from '@/lib/doc';

export function generateStaticParams() {
  return sourcesIn('tools').map((t) => ({ slug: t.name }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = sourceByName(slug);
  return { title: t ? `${t.title} — Ledger clinician` : 'Not found' };
}

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = sourceByName(slug);
  if (!doc || doc.kind !== 'tool') notFound();

  const out = render(doc, { dropTitle: true });
  const isAid = doc.name === 'decision-aid-locating-the-floor';

  const head = (
    <>
      <p className="crumb">
        <Link href="/library/tools">Tools</Link> › {doc.title}
      </p>
      <h1>{doc.title}</h1>
      {doc.subtitle ? <p className="standfirst">{doc.subtitle}</p> : null}
      {isAid ? (
        <p className="meta" style={{ margin: '0 0 1.5rem' }}>
          The locator on <Link href="/formulate">Formulate</Link> is built from this document.
        </p>
      ) : null}
    </>
  );

  return <DocLayout head={head} out={out} />;
}
