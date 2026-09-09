import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PROTOCOLS } from '@/content/protocols';
import { protocolDoc } from '@/content/protocol-docs';
import { floor } from '@/content/floors';
import { render } from '@/lib/markdown/render';
import { DocLayout } from '@/lib/doc';

export function generateStaticParams() {
  return PROTOCOLS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = protocolDoc(slug);
  return { title: p ? `${p.heading} — Ledger clinician` : 'Not found' };
}

export default async function ProtocolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = protocolDoc(slug);
  if (!p) notFound();

  // The document's H1 is dropped: the page header shows the title once.
  const out = render(p.doc, { dropTitle: true });

  const head = (
    <>
      <p className="crumb">
        <Link href="/library/protocols">Protocols</Link> › {p.heading}
      </p>
      <div className="titlerow">
        <h1>{p.heading}</h1>
        <span className={p.label === 'Clinical note' ? 'kind note' : 'kind'}>{p.label}</span>
      </div>
      {p.doc.subtitle ? <p className="standfirst">{p.doc.subtitle}</p> : null}

      {p.floors.length > 0 ? (
        <div className="chips" style={{ margin: '0.75rem 0 1.5rem' }}>
          {p.floors.map((n) => (
            <Link className="chip route" key={n} href={`/library/floors/${n}`}>
              Floor {n} — {floor(n)?.name}
            </Link>
          ))}
        </div>
      ) : (
        <p className="meta">No floor in the locator routes here.</p>
      )}
    </>
  );

  return <DocLayout head={head} out={out} />;
}
