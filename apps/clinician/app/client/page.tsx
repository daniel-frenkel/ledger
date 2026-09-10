'use client';

/**
 * One client's record, for the two things this prompt adds: recording a
 * measure and marking a protocol phase.
 *
 * Both are append-only and both are dated by the clinician rather than the
 * server — a measure taken on Tuesday and typed on Thursday was taken on
 * Tuesday. Neither has a note field: a measure is a score and a phase is a
 * date, and anything else belongs in the formulation or in supervision.
 *
 * There is no name here, because there is no name in the system. The picker
 * shows a truncated id, as Formulate does.
 *
 * Nothing on this page shows or asks about research consent. That is the
 * client's own, on their own screen, and a clinician who could see it could
 * ask about it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { INSTRUMENTS, INSTRUMENT_SPECS, instrument as spec, type Instrument } from '@ledger/shared';
import { ApiError, api, useClinicianSession } from '@/lib/api';
import { PROTOCOLS } from '@/content/protocols';
import { SignIn } from '@/app/sign-in';

interface LinkedClient {
  clientId: string;
}

const PHASE_KINDS = ['started', 'completed', 'paused', 'abandoned'] as const;

const today = () => new Date().toISOString().slice(0, 10);

export default function ClientPage() {
  const { session, loading } = useClinicianSession();
  const [clients, setClients] = useState<LinkedClient[] | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- measure --------------------------------------------------------------
  const [inst, setInst] = useState<Instrument>('ims');
  const [score, setScore] = useState('');
  const [subscales, setSubscales] = useState<Record<string, string>>({});
  const [takenOn, setTakenOn] = useState(today());

  // --- phase ----------------------------------------------------------------
  const [protocolSlug, setProtocolSlug] = useState('');
  const [phase, setPhase] = useState('1');
  const [kind, setKind] = useState<(typeof PHASE_KINDS)[number]>('started');
  const [phaseOn, setPhaseOn] = useState(today());

  const load = useCallback(async () => {
    try {
      const rows = await api<LinkedClient[]>('/v1/links');
      setClients(rows);
      setClientId((c) => c ?? rows[0]?.clientId ?? null);
    } catch {
      setClients([]);
    }
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  const instSpec = useMemo(() => spec(inst)!, [inst]);

  const recordMeasure = async () => {
    if (!clientId) return;
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      const subs = Object.fromEntries(
        Object.entries(subscales)
          .filter(([, v]) => v.trim() !== '')
          .map(([k, v]) => [k, Number(v)]),
      );
      await api('/v1/measures', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          measure: {
            instrument: inst,
            score: Number(score),
            subscales: Object.keys(subs).length > 0 ? subs : null,
            administeredAt: new Date(`${takenOn}T12:00:00Z`).toISOString(),
            administeredBy: 'clinician',
          },
        }),
      });
      setSaved('Measure recorded.');
      setScore('');
      setSubscales({});
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  const markPhase = async () => {
    if (!clientId || !protocolSlug) return;
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      await api('/v1/phase-events', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          protocolSlug,
          phase: Number(phase),
          kind,
          at: new Date(`${phaseOn}T12:00:00Z`).toISOString(),
        }),
      });
      setSaved('Phase marked.');
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not mark that.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main><p className="meta">Checking your session…</p></main>;
  if (!session) return <SignIn what="record a measure" />;

  return (
    <main>
      <h1>A client&rsquo;s record</h1>
      <p className="standfirst">
        A measure is a score and a phase is a date. Neither has a note field — what you saw goes in a{' '}
        <Link href="/formulate">formulation</Link>.
      </p>

      <div className="field">
        <span className="label">Client</span>
        {clients === null ? (
          <p className="meta">Loading…</p>
        ) : clients.length === 0 ? (
          <p className="meta">
            Nobody has accepted an invitation yet. <Link href="/invites">Invite a client</Link>.
          </p>
        ) : (
          <select value={clientId ?? ''} onChange={(e) => setClientId(e.target.value)}>
            {clients.map((c) => (
              <option key={c.clientId} value={c.clientId}>
                {c.clientId.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
        <span className="hint">There are no names in this system, by design.</span>
      </div>

      <h2>Record a measure</h2>
      <div className="field">
        <span className="label">Instrument</span>
        <select
          value={inst}
          onChange={(e) => {
            setInst(e.target.value as Instrument);
            setSubscales({});
          }}
        >
          {INSTRUMENTS.map((i) => (
            <option key={i} value={i}>
              {INSTRUMENT_SPECS[i].name}
            </option>
          ))}
        </select>
        <span className="hint">
          Total runs {instSpec.min}–{instSpec.max}. {instSpec.source}. No item-level responses are stored anywhere.
        </span>
      </div>
      <div className="field">
        <span className="label">Total</span>
        <input inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value)} />
      </div>
      {instSpec.subscales.map((sub) => (
        <div className="field" key={sub}>
          <span className="label">{sub.replace(/_/g, ' ')}</span>
          <input
            inputMode="numeric"
            value={subscales[sub] ?? ''}
            onChange={(e) => setSubscales((x) => ({ ...x, [sub]: e.target.value }))}
          />
        </div>
      ))}
      <div className="field">
        <span className="label">Taken on</span>
        <input type="date" value={takenOn} onChange={(e) => setTakenOn(e.target.value)} />
      </div>
      <p className="actions">
        <button
          className="btn"
          type="button"
          disabled={busy || !clientId || score.trim() === ''}
          onClick={() => void recordMeasure()}
        >
          {busy ? 'Recording…' : 'Record measure'}
        </button>
      </p>

      <h2>Mark a phase</h2>
      <p className="sub">The vertical line on a multiple-baseline graph. Datable up to fourteen days back.</p>
      <div className="field">
        <span className="label">Protocol</span>
        <select value={protocolSlug} onChange={(e) => setProtocolSlug(e.target.value)}>
          <option value="">Choose…</option>
          {PROTOCOLS.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.title}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="label">Phase</span>
        <input inputMode="numeric" value={phase} onChange={(e) => setPhase(e.target.value)} />
        <span className="hint">The protocol&rsquo;s own number. 0 is the gates.</span>
      </div>
      <div className="field">
        <span className="label">What happened</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as (typeof PHASE_KINDS)[number])}>
          {PHASE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="label">On</span>
        <input type="date" value={phaseOn} onChange={(e) => setPhaseOn(e.target.value)} />
      </div>
      <p className="actions">
        <button
          className="btn"
          type="button"
          disabled={busy || !clientId || !protocolSlug}
          onClick={() => void markPhase()}
        >
          {busy ? 'Marking…' : 'Mark phase'}
        </button>
      </p>

      {saved ? <p className="meta">{saved}</p> : null}
      {problem ? <p className="warn">{problem}</p> : null}

      <p className="foot">
        Both are append-only: a correction is a new row, not an edit.
      </p>
    </main>
  );
}
