import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PROTOCOLS, PROTOCOL_SECTIONS, protocol } from '@/content/protocols';
import { floor } from '@/content/floors';
import { AwaitingAuthor } from '@/lib/inline';

export function generateStaticParams() {
  return PROTOCOLS.map((p) => ({ slug: p.slug }));
}

export default async function ProtocolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = protocol(slug);
  if (!p) notFound();

  return (
    <main>
      <p className="crumb">
        <Link href="/library/protocols">Protocols</Link> › {p.title}
      </p>
      <h1>{p.title}</h1>

      <dl style={{ margin: '1.25rem 0 0' }}>
        <div className="rrow">
          <dt>Target floor(s)</dt>
          <dd>
            {p.floors.length === 0 ? (
              <span className="meta">No floor in the locator routes here.</span>
            ) : (
              <div className="chips">
                {p.floors.map((n) => (
                  <Link className="chip route" key={n} href={`/library/floors/${n}`}>
                    {n} — {floor(n)?.name}
                  </Link>
                ))}
              </div>
            )}
          </dd>
        </div>
      </dl>

      {PROTOCOL_SECTIONS.map((s) => (
        <section key={s}>
          <h2>{s}</h2>
          {p.sections[s] ? <p>{p.sections[s]}</p> : <AwaitingAuthor />}
        </section>
      ))}
    </main>
  );
}
