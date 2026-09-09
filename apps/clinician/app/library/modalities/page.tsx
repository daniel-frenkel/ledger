import Link from 'next/link';
import {
  CANON,
  CANON_CLUSTERS,
  CANON_HEADING,
  CANON_INTRO,
  CANON_UP_CLOSE_HEADING,
  CANON_UP_CLOSE_INTRO,
  CLOSING_CALLOUTS,
  CORE_SIX,
  CORE_SIX_AFTER,
  CORE_SIX_HEADING,
  CROSSWALK_STANDFIRST,
  CROSSWALK_SUBTITLE,
  CROSSWALK_TITLE,
  FRAMING_CALLOUTS,
  SEE_ALSO,

  type Callout as CalloutT,
  type ModalitySection,
  type HomeFloorSegment,
} from '@/content/modalities';
import { ALL_SECTIONS, MODALITY_SECTIONS } from '@/content/modality-sections';
import { Inline, P, headingAnchor } from '@/lib/inline';

export const metadata = { title: 'Modalities — Ledger clinician' };

/** [[#Heading]] resolves only to a section that exists on this page. */
const resolveHeading = (heading: string): string | undefined => {
  const target = headingAnchor(heading);
  const hit = ALL_SECTIONS.find((s) => headingAnchor(s.heading) === target);
  return hit ? hit.slug : undefined;
};

function Callout({ c }: { c: CalloutT }) {
  return (
    <div className={`callout ${c.kind}`}>
      <span className="c-title">{c.title}</span>
      {c.body.map((b, i) => (
        <P key={i} text={b} resolveHeading={resolveHeading} />
      ))}
    </div>
  );
}

/** Home floors, rendered as the source writes them, with floor numbers linked. */
function HomeFloors({ segments, separator }: { segments: readonly HomeFloorSegment[]; separator: string }) {
  return (
    <>
      {segments.map((s, i) => (
        <span key={i}>
          {i > 0 ? separator : ''}
          {s.floors.length > 0 ? (
            <Link href={`/library/floors/${s.floors[0]}`}>{s.text}</Link>
          ) : (
            <span>{s.text}</span>
          )}
        </span>
      ))}
    </>
  );
}

/** A floor cell from a technique table: "6 → 3", "conditions", "5–6". */
function FloorCell({ text, floors }: { text: string; floors: readonly number[] }) {
  if (floors.length === 0) return <>{text}</>;
  // Link each floor digit in place, leaving the rest of the cell as written.
  const parts = text.split(/\b([1-8])\b/g);
  return (
    <>
      {parts.map((p, i) =>
        /^[1-8]$/.test(p) ? (
          <Link key={i} href={`/library/floors/${p}`}>
            {p}
          </Link>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Section({ s, level }: { s: ModalitySection; level: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <section id={s.slug}>
      <H>{s.heading}</H>
      {s.coreLogic.map((p, i) => (
        <P key={i} text={p} resolveHeading={resolveHeading} />
      ))}

      {s.techniques.length > 0 ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Technique</th>
                <th>Lever pulled</th>
                <th>Floor</th>
                <th>When it fails</th>
              </tr>
            </thead>
            <tbody>
              {s.techniques.map((t) => (
                <tr key={t.technique}>
                  <td>
                    <Inline text={t.technique} />
                  </td>
                  <td>
                    <Inline text={t.lever} />
                  </td>
                  <td className="floorcell">
                    <FloorCell text={t.floorText} floors={t.floors} />
                  </td>
                  <td className="fails">
                    <Inline text={t.whenItFails} resolveHeading={resolveHeading} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {s.callouts.map((c, i) => (
        <Callout key={i} c={c} />
      ))}
      {s.whatPPAdds.map((p, i) => (
        <P key={i} text={p} resolveHeading={resolveHeading} />
      ))}
      {s.subsections.map((sub) => (
        <Section key={sub.slug} s={sub} level={3} />
      ))}
    </section>
  );
}

export default function ModalitiesPage() {
  return (
    <main>
      <h1>{CROSSWALK_TITLE}</h1>
      <p className="standfirst">{CROSSWALK_SUBTITLE}</p>
      <P text={CROSSWALK_STANDFIRST} resolveHeading={resolveHeading} />

      {FRAMING_CALLOUTS.map((c, i) => (
        <Callout key={i} c={c} />
      ))}

      <h2 id="core-six">{CORE_SIX_HEADING}</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Modality</th>
              <th>Primary lever(s)</th>
              <th>Home floors</th>
              <th>Its distinctive reach</th>
            </tr>
          </thead>
          <tbody>
            {CORE_SIX.map((r) => (
              <tr key={r.modality}>
                <td>
                  {r.section ? (
                    <a href={`#${r.section}`}>
                      <Inline text={r.modality} />
                    </a>
                  ) : (
                    <Inline text={r.modality} />
                  )}
                </td>
                <td>
                  <Inline text={r.primaryLever} />
                </td>
                <td className="floorcell">
                  <HomeFloors segments={r.homeFloors} separator={r.homeFloorsSeparator} />
                </td>
                <td>
                  <Inline text={r.distinctiveReach} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {CORE_SIX_AFTER.map((p, i) => (
        <P key={i} text={p} resolveHeading={resolveHeading} />
      ))}

      <h2 id="canon">{CANON_HEADING}</h2>
      <P text={CANON_INTRO} resolveHeading={resolveHeading} />
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Modality (ch.)</th>
              <th>What it is, in PP terms</th>
              <th>Primary lever(s)</th>
              <th>Home floor(s)</th>
              <th>Where it stalls / what to watch</th>
            </tr>
          </thead>
          <tbody>
            {CANON.map((r) => (
              <tr key={r.modality}>
                <td>
                  {r.section ? (
                    <a href={`#${r.section}`}>
                      <Inline text={r.modality} />
                    </a>
                  ) : (
                    <Inline text={r.modality} />
                  )}
                </td>
                <td>
                  <Inline text={r.whatItIs} />
                </td>
                <td>
                  <Inline text={r.primaryLever} />
                </td>
                <td className="floorcell">
                  <HomeFloors segments={r.homeFloors} separator={r.homeFloorsSeparator} />
                </td>
                <td className="fails">
                  <Inline text={r.whereItStalls} resolveHeading={resolveHeading} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {CANON_CLUSTERS.map((c, i) => (
        <div key={i}>
          {c.heading ? <P text={c.heading} resolveHeading={resolveHeading} /> : null}
          {c.body ? <P text={c.body} resolveHeading={resolveHeading} /> : null}
        </div>
      ))}

      <h2 id="up-close">{CANON_UP_CLOSE_HEADING}</h2>
      <P text={CANON_UP_CLOSE_INTRO} resolveHeading={resolveHeading} />

      {MODALITY_SECTIONS.map((s) => (
        <Section key={s.slug} s={s} level={2} />
      ))}

      {CLOSING_CALLOUTS.map((c, i) => (
        <Callout key={i} c={c} />
      ))}

      <P className="foot" text={SEE_ALSO} resolveHeading={resolveHeading} />
    </main>
  );
}
