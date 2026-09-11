import Link from 'next/link';
import { sourcesIn } from '@/lib/markdown/sources';

export const metadata = { title: 'Tools — CourageLoop clinician' };

/** The order the Decision Aid itself implies: aid, map, router, one-pager. */
const ORDER = [
  'decision-aid-locating-the-floor',
  'decision-map-locating-the-floor',
  'formulation-router',
  'case-formulation-one-page',
];

export default function ToolsIndex() {
  const tools = sourcesIn('tools').sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));

  return (
    <main>
      <h1>Tools</h1>
      <p className="standfirst">
        Four working documents: the procedure for locating a floor, the same logic as a map, the route from presenting
        complaint to protocol, and the one-page formulation. The locator on Formulate is built from the first of them.
      </p>

      <ul className="cards cards--2">
        {tools.map((t) => (
          <li className="card" key={t.name}>
            <Link href={t.href ?? '/library/tools'}>
              <span className="n">Tool</span>
              <h3>{t.title}</h3>
              {t.subtitle ? <p>{t.subtitle}</p> : null}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
