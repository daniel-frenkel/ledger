'use client';

/**
 * Locating the floor — ported from docs/design/floor-locator.html.
 *
 * Same gates, same nine signs and weights, same scoring (top floor lit; any
 * floor at 60% of the top also lit), same warnings and the same order of
 * precedence between them, same keyboard handling on the floors and the ground.
 *
 * Stateless this pass: nothing is saved, no client is loaded, and the case
 * header is a labelled placeholder. Persistence and the re-aim counter come
 * with the schema work.
 *
 * Two departures from the prototype, both because it was a demo and this is
 * not: the gates start unchecked, so locating is blocked until the clinician
 * actually clears them, and no observations are pre-ticked. Pre-ticked signs
 * would be findings nobody observed.
 */
import { useState } from 'react';
import Link from 'next/link';
import { FLOOR_CONTENT, floor } from '@/content/floors';
import { protocolByTitle } from '@/content/protocols';
import {
  BUILDING_CAPTION,
  GATES,
  GATES_EYEBROW,
  GATE_BLOCKED,
  LOCATOR_DISCLAIMER,
  NO_FLOOR_TITLE,
  NO_FLOOR_WARNING,
  OBSERVATIONS,
  OBSERVATIONS_HEADING,
  OBSERVATIONS_SUB,
  RESULT_ACTIONS,
  isLit,
  score,
  warningFor,
} from '@/content/observations';

const FLOOR_Y = (i: number) => 14 + (i - 1) * 39;

export default function FormulatePage() {
  const [cleared, setCleared] = useState<Record<string, boolean>>({});
  const [ticked, setTicked] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  const gatesOk = GATES.every((g) => cleared[g.id]);
  const { scores, checked, top, max } = score(ticked);
  const shown = selected ?? top;

  const toggleObs = (i: number) => {
    setSelected(null);
    setTicked((t) => (t.includes(i) ? t.filter((x) => x !== i) : [...t, i]));
  };

  const pick = (n: number) => setSelected(n);
  const onKey = (n: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(n);
    }
  };

  const f = shown ? floor(shown) : undefined;
  const warn = shown ? warningFor(shown, scores) : { lead: '', rest: NO_FLOOR_WARNING };

  return (
    <main>
      <div className="case">
        <p className="who">Client —</p>
        <span className="meta">No client loaded</span>
        <span className="placeholder">Static placeholder · re-aim counter lands with persistence</span>
      </div>

      <section className="gates">
        <p className="eyebrow">{GATES_EYEBROW}</p>
        <div className="gate-grid">
          {GATES.map((g) => (
            <div key={g.id} className={`gate ${cleared[g.id] ? 'cleared' : 'blocked'}`}>
              <input
                type="checkbox"
                id={g.id}
                checked={!!cleared[g.id]}
                onChange={(e) => setCleared((c) => ({ ...c, [g.id]: e.target.checked }))}
              />
              <label htmlFor={g.id}>
                <span className="g-name">{g.name}</span>
                <span className="g-note">{g.note}</span>
              </label>
            </div>
          ))}
        </div>
        {!gatesOk ? (
          <p className="gate-msg">
            <strong>{GATE_BLOCKED.lead}</strong> {GATE_BLOCKED.rest}
          </p>
        ) : null}
      </section>

      <div className="work">
        <div className="buildingwrap">
          <svg className="building" viewBox="0 0 200 340" role="img" aria-label="Eight floors of the self, floor one at the top">
            <g>
              {FLOOR_CONTENT.filter((x) => x.n <= 7).map((x) => {
                const y = FLOOR_Y(x.n);
                const lit = isLit(scores, max, x.n, gatesOk);
                return (
                  <g
                    key={x.n}
                    className={`floor${lit ? ' lit' : ''}${x.n === shown ? ' sel' : ''}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`Floor ${x.n}, ${x.name}`}
                    onClick={() => pick(x.n)}
                    onKeyDown={onKey(x.n)}
                  >
                    <rect className="fl-body" x={22} y={y} width={156} height={35} />
                    {[0, 1, 2, 3, 4].map((w) => (
                      <rect key={w} className="win" x={34 + w * 27} y={y + 22} width={11} height={7} />
                    ))}
                    <text className="fl-num" x={30} y={y + 15}>
                      {x.n}
                    </text>
                    <text className="fl-label" x={44} y={y + 15}>
                      {x.name}
                    </text>
                  </g>
                );
              })}
            </g>
            <rect
              className={`ground${isLit(scores, max, 8, gatesOk) ? ' lit' : ''}`}
              x={8}
              y={292}
              width={184}
              height={34}
              tabIndex={0}
              role="button"
              aria-label="Floor 8, the cultural substrate"
              onClick={() => pick(8)}
              onKeyDown={onKey(8)}
            />
            <text className="fl-num" x={16} y={313}>
              8
            </text>
            <text className="fl-label" x={30} y={313}>
              {floor(8)?.name}
            </text>
          </svg>
          <p className="b-cap">{BUILDING_CAPTION}</p>
        </div>

        <div>
          <h2>{OBSERVATIONS_HEADING}</h2>
          <p className="sub">{OBSERVATIONS_SUB}</p>

          <ul className="obs">
            {OBSERVATIONS.map((o, i) => (
              <li key={i} className={ticked.includes(i) ? 'on' : ''}>
                <label>
                  <input type="checkbox" checked={ticked.includes(i)} onChange={() => toggleObs(i)} />
                  <span className="q">{o.q}</span>
                  <span className="tag">{o.tag}</span>
                </label>
              </li>
            ))}
          </ul>

          <div className="result" style={{ opacity: gatesOk ? 1 : 0.35 }} aria-disabled={!gatesOk}>
            <div className="result-head">
              <h3>{f ? `Floor ${f.n} — ${f.name}` : NO_FLOOR_TITLE}</h3>
              <span className="n">
                {checked === 0 ? '0 signs' : `${checked} ${checked === 1 ? 'sign' : 'signs'} ticked`}
              </span>
            </div>
            <div className="result-body">
              <dl style={{ margin: 0 }}>
                <div className="rrow">
                  <dt>What lives here</dt>
                  <dd>{f ? f.lives : '—'}</dd>
                </div>
                <div className="rrow">
                  <dt>What reaches it</dt>
                  <dd>{f ? f.reach : '—'}</dd>
                </div>
                <div className="rrow">
                  <dt>Protocols</dt>
                  <dd>
                    <div className="chips">
                      {f?.proto.map((title) => {
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
                      {f && f.proto.length === 0 ? <span className="chip">—</span> : null}
                    </div>
                  </dd>
                </div>
                <div className="rrow">
                  <dt>Would falsify</dt>
                  <dd>{f ? f.falsify : '—'}</dd>
                </div>
              </dl>
            </div>
            <p className="warn">
              {warn.lead ? <strong>{warn.lead}</strong> : null}
              {warn.lead ? ' ' : ''}
              {warn.rest}
            </p>
            <div className="actions">
              {RESULT_ACTIONS.map((a, i) => (
                <button key={a} className={`btn${i === 0 ? '' : ' ghost'}`} type="button" disabled>
                  {a}
                </button>
              ))}
            </div>
            <p className="meta" style={{ padding: '0 1.25rem 1.25rem' }}>
              Actions are inert in this pass — nothing is saved yet.
            </p>
          </div>

          <p className="foot">{LOCATOR_DISCLAIMER}</p>
        </div>
      </div>
    </main>
  );
}
