import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FLOOR_CONTENT, floor } from '@/content/floors';
import { protoTitlesForFloor, protocolByTitle } from '@/content/protocols';
import { modalitiesForFloor } from '@/content/modalities';
import { citeLabel } from '@/content/references';
import { Inline } from '@/lib/inline';
import { floorSource } from '@/lib/markdown/sources';
import { render } from '@/lib/markdown/render';
import { Contents, DocBody } from '@/lib/doc';

export function generateStaticParams() {
  return FLOOR_CONTENT.map((f) => ({ n: String(f.n) }));
}

export default async function FloorPage({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const f = floor(Number(n));
  if (!f) notFound();

  const modalities = modalitiesForFloor(f.n);
  // The floor's own note. Its H1 repeats the page title, so it is dropped.
  const doc = floorSource(f.n);
  const out = doc ? render(doc, { dropTitle: true }) : null;
  const protos = protoTitlesForFloor(f.n);

  return (
    <main>
      <p className="crumb">
        <Link href="/library/floors">Floors</Link> › Floor {f.n}
      </p>
      <h1>
        Floor {f.n} — {f.name}
      </h1>
      <p className="standfirst">{f.definition}</p>

      <dl style={{ margin: '1.5rem 0 0' }}>
        <div className="rrow">
          <dt>What lives here</dt>
          <dd>{f.lives}</dd>
        </div>
        <div className="rrow">
          <dt>What reaches it</dt>
          <dd>{f.reach}</dd>
        </div>
        <div className="rrow">
          <dt>Protocols</dt>
          <dd>
            {protos.length === 0 ? (
              <span className="meta">None. No upper-floor tool reaches it.</span>
            ) : (
              <div className="chips">
                {protos.map((title) => {
                  const p = protocolByTitle(title);
                  return p ? (
                    <Link className="chip route" key={title} href={`/library/protocols/${p.slug}`}>
                      {title}
                    </Link>
                  ) : (
                    <span className="chip" key={title}>
                      {title}
                    </span>
                  );
                })}
              </div>
            )}
          </dd>
        </div>
        <div className="rrow">
          <dt>Would falsify</dt>
          <dd>{f.falsify}</dd>
        </div>
        <div className="rrow">
          <dt>Modalities that reach this floor</dt>
          <dd>
            {modalities.length === 0 ? (
              <span className="meta">None named in the crosswalk’s home-floor columns.</span>
            ) : (
              <div className="chips">
                {modalities.map((m, i) => (
                  <Link
                    className="chip"
                    key={`${m.modality}-${i}`}
                    href={m.section ? `/library/modalities#${m.section}` : '/library/modalities'}
                  >
                    <Inline text={m.modality} />
                    {m.as !== String(f.n) ? <span className="meta"> · {m.as}</span> : null}
                  </Link>
                ))}
              </div>
            )}
          </dd>
        </div>
      </dl>

      <div className="callout">
        <span className="c-title">From the locator</span>
        <p>{f.warning}</p>
        {f.warningCondition ? <p className="meta">{f.warningCondition}</p> : null}
      </div>

      <h2 className="notehead">The floor note</h2>
      {out ? (
        <div className="doc">
          <DocBody html={out.html} />
          <Contents toc={out.toc} label="In the floor note" />
        </div>
      ) : null}

      <p className="cites">{citeLabel(f.cites)}</p>
    </main>
  );
}
