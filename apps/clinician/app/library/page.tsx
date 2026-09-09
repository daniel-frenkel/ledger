import Link from 'next/link';
import { FLOOR_CONTENT } from '@/content/floors';
import { PROTOCOLS } from '@/content/protocols';
import { CORE_SIX, CANON } from '@/content/modalities';
import { REFERENCES, isVerified } from '@/content/references';
import { sourcesIn } from '@/lib/markdown/sources';

export const metadata = { title: 'Library — Ledger clinician' };

export default function LibraryIndex() {
  const tools = sourcesIn('tools').length;
  const verified = REFERENCES.filter(isVerified).length;

  return (
    <main>
      <h1>Library</h1>
      <p className="standfirst">
        The model, the floors, the modality crosswalk, the protocols, and the working tools. Reference material, held
        by the clinician. No client data appears on any page here.
      </p>

      <ul className="cards cards--3">
        <li className="card">
          <Link href="/library/model">
            <span className="n">The model</span>
            <h3>The Clinician’s Guide to Predictive Processing</h3>
            <p>The author’s primer: the machine, the floors, the furnace, and what the framework does not claim.</p>
          </Link>
        </li>
        <li className="card">
          <Link href="/library/floors">
            <span className="n">{FLOOR_CONTENT.length} floors</span>
            <h3>The floors of the self</h3>
            <p>What lives on each, what reaches it, what would falsify the placement — and each floor’s own note.</p>
          </Link>
        </li>
        <li className="card">
          <Link href="/library/modalities">
            <span className="n">
              {CORE_SIX.length} + {CANON.length} modalities
            </span>
            <h3>How the modalities recalibrate priors</h3>
            <p>Technique, lever, floor — and when it fails, which is the column that earns the crosswalk.</p>
          </Link>
        </li>
        <li className="card">
          <Link href="/library/protocols">
            <span className="n">{PROTOCOLS.length - 1} protocols · 1 clinical note</span>
            <h3>Protocols</h3>
            <p>Phase 0 gates through Phase 8 relapse, each rendered from its own document.</p>
          </Link>
        </li>
        <li className="card">
          <Link href="/library/tools">
            <span className="n">{tools} tools</span>
            <h3>Decision aid, map, router, one-pager</h3>
            <p>The procedure the locator is built from, and the route from presenting complaint to protocol.</p>
          </Link>
        </li>
        <li className="card">
          <Link href="/library/paper">
            <span className="n">The paper</span>
            <h3>A Unified Clinical Model of Psychotherapy</h3>
            <p>The document the rest of the corpus cites more than any other.</p>
          </Link>
        </li>
        <li className="card">
          <Link href="/library/references">
            <span className="n">
              {REFERENCES.length} references · {verified} tiered
            </span>
            <h3>References and the verification ledger</h3>
            <p>What the record-layer pass checked, and everything it does not cover.</p>
          </Link>
        </li>
        <li className="card">
          <Link href="/formulate">
            <span className="n">Formulate</span>
            <h3>Locating the floor</h3>
            <p>Gates, then signs, then a floor. It weights signs; it does not score a client.</p>
          </Link>
        </li>
      </ul>
    </main>
  );
}
