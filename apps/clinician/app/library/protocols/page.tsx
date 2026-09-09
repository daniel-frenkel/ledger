import Link from 'next/link';
import { PROTOCOLS } from '@/content/protocols';
import { FRAMEWORK_CAVEAT, NOT_A_THERAPIST } from '@/content/model';

export const metadata = { title: 'Protocols — Ledger clinician' };

export default function ProtocolsIndex() {
  return (
    <main>
      <h1>Protocols</h1>
      <p className="standfirst">
        Thirteen protocols. Each page is a scaffold: the sections are named and ordered, and the bodies are
        awaiting the author. Floors are read off the locator, not asserted here.
      </p>

      {/* FRAMING, verbatim and unsoftened. */}
      <div className="callout warning">
        <span className="c-title">Framework, not a validated treatment</span>
        <p>{FRAMEWORK_CAVEAT}</p>
        <p>{NOT_A_THERAPIST}</p>
      </div>

      <ul className="cards cards--3">
        {PROTOCOLS.map((p) => (
          <li className="card" key={p.slug}>
            <Link href={`/library/protocols/${p.slug}`}>
              <span className="n">
                {p.floors.length > 0 ? `Floor ${p.floors.join(' · ')}` : 'No floor routes here'}
              </span>
              <h3>{p.title}</h3>
              <p>Awaiting author.</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
