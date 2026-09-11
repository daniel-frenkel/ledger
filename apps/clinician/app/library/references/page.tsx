import Link from 'next/link';
import { REFERENCES, UNVERIFIED_MARK, isVerified, type Reference } from '@/content/references';
import { sourceByName } from '@/lib/markdown/sources';
import { render } from '@/lib/markdown/render';
import { DocBody } from '@/lib/doc';

export const metadata = { title: 'References — CourageLoop clinician' };

const GROUPS: { kind: Reference['kind']; heading: string; note: string }[] = [
  {
    kind: 'ledger',
    heading: 'The paper’s reference list',
    note: 'The works checked in the signed Pass-1 record layer, with the evidence tier the ledger recorded.',
  },
  {
    kind: 'pin',
    heading: 'The protocols’ pin targets',
    note: 'Each protocol’s own citation table. The ledger checked the paper’s references, not these, so nearly all of them are outside its coverage.',
  },
  {
    kind: 'corpus',
    heading: 'The author’s corpus',
    note: 'Documents, not published works. The ledger does not cover them.',
  },
  { kind: 'external', heading: 'Cited in the design memo', note: 'Named in the file key of docs/theory-mapping.md.' },
];

const Row = ({ r }: { r: Reference }) => (
  <li>
    <span className="refname">{r.citedAs}</span>{' '}
    {isVerified(r) ? (
      <span className="tier">
        {r.tier}
        {r.ledgerRow !== null ? ` · row ${r.ledgerRow}` : ''}
      </span>
    ) : (
      <span className="tier unverified">{UNVERIFIED_MARK}</span>
    )}
    {r.citedBy.length > 0 ? (
      <span className="meta">
        {' '}
        ·{' '}
        {r.citedBy.map((slug, i) => (
          <span key={slug}>
            {i > 0 ? ', ' : ''}
            <Link href={`/library/protocols/${slug}`}>{slug}</Link>
          </span>
        ))}
      </span>
    ) : null}
  </li>
);

export default function ReferencesPage() {
  const counts = {
    total: REFERENCES.length,
    verified: REFERENCES.filter(isVerified).length,
    unverified: REFERENCES.filter((r) => !isVerified(r)).length,
  };
  const ledgerDoc = sourceByName('citation-verification-ledger');
  const out = ledgerDoc ? render(ledgerDoc, { dropTitle: true }) : null;

  return (
    <main>
      <p className="crumb">
        <Link href="/library">Library</Link> › References
      </p>
      <h1>References</h1>
      <p className="standfirst">
        Every work cited across the source documents: the paper’s reference list, each protocol’s pin targets, and the
        author’s own corpus. {counts.verified} of {counts.total} carry an evidence tier from the verification ledger.
        The other {counts.unverified} are outside its coverage and say so.
      </p>

      <div className="callout note">
        <span className="c-title">What a tier means, and what it does not</span>
        <p>
          The ledger’s Pass 1 checked the <em>record</em> — authors, year, title, journal, pages. It did not check
          whether a source argues what the sentence citing it says it argues. That is Pass 2, and it is still owed.
        </p>
        <p>
          “{UNVERIFIED_MARK}” means the ledger does not cover the work. It is a statement about the ledger’s coverage,
          not a judgement about the source.
        </p>
      </div>

      {GROUPS.map((g) => {
        const rows = REFERENCES.filter((r) => r.kind === g.kind);
        if (rows.length === 0) return null;
        return (
          <section key={g.kind}>
            <h2>
              {g.heading} <span className="meta">· {rows.length}</span>
            </h2>
            <p className="sub">{g.note}</p>
            <ul className="reflist">
              {rows.map((r) => (
                <Row key={r.key} r={r} />
              ))}
            </ul>
          </section>
        );
      })}

      {out ? (
        <>
          <h2 className="notehead">The verification ledger</h2>
          <DocBody html={out.html} />
        </>
      ) : null}
    </main>
  );
}
