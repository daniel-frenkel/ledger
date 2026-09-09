import Link from 'next/link';
import { ONE_LINE } from '@/content/protocols';
import { PROTOCOL_DOCS, summaryHtml } from '@/content/protocol-docs';
import { FRAMEWORK_CAVEAT, NOT_A_THERAPIST } from '@/content/model';
import { DocBody } from '@/lib/doc';

export const metadata = { title: 'Protocols — Ledger clinician' };

export default function ProtocolsIndex() {
  const rows = PROTOCOL_DOCS.map((p) => ({ ...p, html: summaryHtml(p) }));

  return (
    <main>
      <h1>Protocols</h1>
      <p className="standfirst">
        Twelve protocols and one clinical note, each rendered from its own document. The summary under each is that
        document’s own “{ONE_LINE}”. Floors are read off the locator, not asserted here.
      </p>

      {/* FRAMING, verbatim and unsoftened. */}
      <div className="callout warning">
        <span className="c-title">Framework, not a validated treatment</span>
        <p>{FRAMEWORK_CAVEAT}</p>
        <p>{NOT_A_THERAPIST}</p>
      </div>

      <ul className="protolist">
        {rows.map((p) => (
          <li key={p.slug}>
            <div className="protohead">
              <h2>
                <Link href={`/library/protocols/${p.slug}`}>{p.heading}</Link>
              </h2>
              <span className={p.label === 'Clinical note' ? 'kind note' : 'kind'}>{p.label}</span>
            </div>
            <p className="meta">{p.floors.length > 0 ? `Floor ${p.floors.join(' · ')}` : 'No floor routes here'}</p>
            <DocBody html={p.html} />
          </li>
        ))}
      </ul>
    </main>
  );
}
