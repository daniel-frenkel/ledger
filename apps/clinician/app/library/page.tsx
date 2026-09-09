import Link from 'next/link';
import { FLOOR_CONTENT } from '@/content/floors';
import { PROTOCOLS } from '@/content/protocols';
import { CORE_SIX, CANON } from '@/content/modalities';

export const metadata = { title: 'Library — Ledger clinician' };

export default function LibraryIndex() {
  return (
    <main>
      <h1>Library</h1>
      <p className="standfirst">
        The model, the floors, the modality crosswalk, and the protocols. Reference material, held by the
        clinician. No client data appears on any page here.
      </p>

      <ul className="cards cards--3">
        <li className="card">
          <Link href="/library/model">
            <span className="n">The model</span>
            <h3>Vocabulary and its discipline</h3>
            <p>Prediction, prior, precision, the furnace, and what a skeptical reviewer will say.</p>
          </Link>
        </li>
        <li className="card">
          <Link href="/library/floors">
            <span className="n">{FLOOR_CONTENT.length} floors</span>
            <h3>The floors of the self</h3>
            <p>What lives on each, what reaches it, and what would falsify the placement.</p>
          </Link>
        </li>
        <li className="card">
          <Link href="/library/modalities">
            <span className="n">{CORE_SIX.length} + {CANON.length} modalities</span>
            <h3>How the modalities recalibrate priors</h3>
            <p>Technique, lever, floor — and when it fails, which is the column that earns the crosswalk.</p>
          </Link>
        </li>
        <li className="card">
          <Link href="/library/protocols">
            <span className="n">{PROTOCOLS.length} protocols</span>
            <h3>Protocols</h3>
            <p>Scaffolds only. The bodies are clinical content and are awaiting the author.</p>
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
