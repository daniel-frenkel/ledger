import Link from 'next/link';
import { FLOOR_CONTENT, FLOOR_CAVEATS } from '@/content/floors';
import { citeLabel } from '@/content/references';
import { BUILDING_CAPTION } from '@/content/observations';

export const metadata = { title: 'The floors — CourageLoop clinician' };

export default function FloorsIndex() {
  return (
    <main>
      <h1>The floors of the self</h1>
      <p className="standfirst">
        Eight floors, top down. Each page carries what lives there, what reaches it, which protocols route to it,
        what would falsify the placement, and the warning the locator attaches to it.
      </p>
      <p className="meta">{BUILDING_CAPTION}</p>

      <ul className="cards cards--3">
        {FLOOR_CONTENT.map((f) => (
          <li className="card" key={f.n}>
            <Link href={`/library/floors/${f.n}`}>
              <span className="n">Floor {f.n}</span>
              <h3>{f.name}</h3>
              <p>{f.lives}</p>
            </Link>
          </li>
        ))}
      </ul>

      <h2>Two honesty notes the app inherits</h2>
      {FLOOR_CAVEATS.map((c, i) => (
        <div key={i}>
          <p>{c.text}</p>
          <p className="cites">{citeLabel(c.cites)}</p>
        </div>
      ))}
    </main>
  );
}
