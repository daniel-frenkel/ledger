import { MODEL_BLOCKS, MODEL_STANDFIRST, MODEL_TITLE, FRAMEWORK_CAVEAT, NOT_A_THERAPIST } from '@/content/model';
import { citeLabel } from '@/content/references';
import { P } from '@/lib/inline';

export const metadata = { title: 'The model — Ledger clinician' };

export default function ModelPage() {
  return (
    <main>
      <h1>{MODEL_TITLE}</h1>
      <p className="standfirst">{MODEL_STANDFIRST}</p>

      {/* FRAMING, verbatim and unsoftened. */}
      <div className="callout warning">
        <span className="c-title">Framework, not a validated treatment</span>
        <p>{FRAMEWORK_CAVEAT}</p>
        <p>{NOT_A_THERAPIST}</p>
      </div>

      {MODEL_BLOCKS.map((b) => (
        <section key={b.heading}>
          <h2>{b.heading}</h2>
          {b.body.map((para, i) => (
            <P key={i} text={para} />
          ))}
          <p className="cites">{citeLabel(b.cites)}</p>
        </section>
      ))}
    </main>
  );
}
