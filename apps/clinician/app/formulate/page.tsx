'use client';

/**
 * Locating the floor — ported from docs/design/floor-locator.html.
 *
 * Same gates, same weights, same scoring (top floor lit; any floor at 60% of
 * the top also lit), same warnings and the same order of precedence between
 * them, same keyboard handling on the floors and the ground.
 *
 * The sign list is no longer only the prototype's nine. The Decision Aid is
 * the locator's source document and its Step 1 list had drifted from the
 * prototype's OBS array; content/observations.ts now keeps both sets, tagged
 * by which document they came from.
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
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FLOOR_CONTENT, floor } from '@/content/floors';
import { protoTitlesForFloor, protocolByTitle } from '@/content/protocols';
import {
  BUILDING_CAPTION,
  GATES,
  GATES_EYEBROW,
  GATE_3_FOOTNOTE,
  GATE_BLOCKED,
  LOCATOR_DISCLAIMER,
  NO_FLOOR_TITLE,
  NO_FLOOR_WARNING,
  OBSERVATIONS,
  OBSERVATIONS_HEADING,
  OBSERVATIONS_SUB,
  FALSIFY_HINT,
  FALSIFY_LABEL,
  NOTE_HINT,
  NOTE_LABEL,
  ON_TRIAL,
  isLit,
  isOnTrial,
  reAimLabel,
  scoreFloors,
  warningFor,
} from '@/content/observations';
import { ApiError, api, useClinicianSession } from '@/lib/api';

interface LinkedClient {
  id: string;
  clientId: string;
  status: string;
}

const FLOOR_Y = (i: number) => 14 + (i - 1) * 39;

export default function FormulatePage() {
  const { session, loading: sessionLoading } = useClinicianSession();
  const [cleared, setCleared] = useState<Record<string, boolean>>({});
  const [ticked, setTicked] = useState<string[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  // The case this formulation is about.
  const [clients, setClients] = useState<LinkedClient[] | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [falsify, setFalsify] = useState('');
  const [saving, setSaving] = useState(false);
  const [written, setWritten] = useState<{ version: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const gatesOk = GATES.every((g) => cleared[g.id]);
  const { scores, checked, top, max } = scoreFloors(ticked);
  const shown = selected ?? top;

  // Active links only: a formulation cannot be written against any other kind,
  // and offering one would be an error the API has to refuse.
  useEffect(() => {
    if (!session) return;
    let live = true;
    void api<LinkedClient[]>('/v1/links')
      .then((rows) => {
        if (!live) return;
        const active = rows.filter((r) => r.status === 'active');
        setClients(active);
        setClientId((c) => c ?? active[0]?.clientId ?? null);
      })
      .catch(() => live && setClients([]));
    return () => {
      live = false;
    };
  }, [session]);

  // The re-aim count is the client's history, not this page's.
  const [priorVersions, setPriorVersions] = useState<number>(0);
  useEffect(() => {
    setPriorVersions(0);
    setWritten(null);
    if (!session || !clientId) return;
    let live = true;
    void api<{ version: number }[]>(`/v1/clients/${clientId}/formulations`)
      .then((rows) => live && setPriorVersions(rows[0]?.version ?? 0))
      .catch(() => live && setPriorVersions(0));
    return () => {
      live = false;
    };
  }, [session, clientId]);

  const toggleObs = (id: string) => {
    setSelected(null);
    setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  };

  const nextVersion = priorVersions + 1;
  const canWrite =
    !!clientId && gatesOk && ticked.length > 0 && note.trim() !== '' && falsify.trim() !== '' && !!shown && !saving;

  const write = useCallback(async () => {
    if (!clientId || !shown) return;
    setSaving(true);
    setProblem(null);
    try {
      const out = await api<{ id: string; version: number }>('/v1/formulations', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          note,
          falsify,
          observations: ticked,
          gates: { risk: !!cleared['risk'], dial: !!cleared['dial'], calibrated: !!cleared['calibrated'] },
          floor: shown,
          protocolSlug: null,
        }),
      });
      setWritten({ version: out.version });
      setPriorVersions(out.version);
      // The note is gone from this page the moment it is written; the row is
      // the record, and it is append-only.
      setNote('');
      setFalsify('');
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not write the formulation.');
    } finally {
      setSaving(false);
    }
  }, [clientId, shown, note, falsify, ticked, cleared]);

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
        <p className="who">Client</p>
        {sessionLoading ? (
          <span className="meta">Checking your session…</span>
        ) : !session ? (
          <span className="meta">
            Sign in to write a formulation. The locator below works without one — nothing on it is saved.
          </span>
        ) : clients === null ? (
          <span className="meta">Loading your clients…</span>
        ) : clients.length === 0 ? (
          <span className="meta">
            No active links yet. <Link href="/invites">Invite a client</Link> — they choose what to share when they
            accept.
          </span>
        ) : (
          <>
            <select
              className="picker"
              value={clientId ?? ''}
              onChange={(e) => setClientId(e.target.value)}
              aria-label="Client"
            >
              {clients.map((c) => (
                <option key={c.clientId} value={c.clientId}>
                  {c.clientId.slice(0, 8)}
                </option>
              ))}
            </select>
            <span className="meta">
              {priorVersions === 0
                ? 'First formulation for this client'
                : (reAimLabel(nextVersion) ?? `Version ${nextVersion}`)}
            </span>
          </>
        )}
        <span className="placeholder">
          Clients have no names in this system. The id is what there is.
        </span>
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
                {g.id === 'calibrated' ? <span className="g-twice">{GATE_3_FOOTNOTE}</span> : null}
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
            {OBSERVATIONS.map((o) => (
              <li key={o.id} className={ticked.includes(o.id) ? 'on' : ''}>
                <label>
                  <input type="checkbox" checked={ticked.includes(o.id)} onChange={() => toggleObs(o.id)} />
                  <span className="q">
                    {o.q}
                    {o.note ? <span className="o-note">{o.note}</span> : null}
                  </span>
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
            {isOnTrial(nextVersion) ? (
              <p className="warn on-trial">
                <strong>The formulation is on trial.</strong> {ON_TRIAL}
              </p>
            ) : null}

            <div className="write">
              <label className="field">
                <span className="label">{NOTE_LABEL}</span>
                <span className="hint">{NOTE_HINT}</span>
                <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">{FALSIFY_LABEL}</span>
                <span className="hint">{FALSIFY_HINT}</span>
                <textarea rows={3} value={falsify} onChange={(e) => setFalsify(e.target.value)} />
              </label>

              {problem ? <p className="warn">{problem}</p> : null}
              {written ? (
                <p className="meta">
                  Written as version {written.version}. Formulations are append-only — a re-aim is a new one, not an
                  edit.
                </p>
              ) : null}

              <div className="actions">
                <button className="btn" type="button" disabled={!canWrite} onClick={() => void write()}>
                  {saving ? 'Writing…' : 'Write this formulation'}
                </button>
                {shown && protoTitlesForFloor(shown)[0] ? (
                  <Link
                    className="btn ghost"
                    href={`/library/protocols/${protocolByTitle(protoTitlesForFloor(shown)[0]!)?.slug ?? ''}`}
                  >
                    Open protocol
                  </Link>
                ) : null}
              </div>
              {!canWrite && !saving ? (
                <p className="meta">
                  {!session
                    ? 'Sign in to write.'
                    : !clientId
                      ? 'Choose a client.'
                      : !gatesOk
                        ? 'Clear the gates first.'
                        : ticked.length === 0
                          ? 'Tick what you have observed.'
                          : note.trim() === ''
                            ? 'The note is required.'
                            : 'The falsify line is required.'}
                </p>
              ) : null}
            </div>
          </div>

          <p className="foot">{LOCATOR_DISCLAIMER}</p>
          <p className="foot">
            Built from the{' '}
            <Link href="/library/tools/decision-aid-locating-the-floor">Decision Aid</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
