'use client';

/**
 * The training stack.
 *
 * A stack is the set of modalities you can actually run, each at a stated
 * depth — docs/theory/tools/training-stack.md. The page shows floor coverage
 * rather than a count, because that is the document's whole argument: a
 * portfolio is measured by which floors it reaches, not by how many rows it
 * has.
 *
 * Nothing on this page is client data. It is here because the scope gate on
 * Formulate reads it, and a clinician should be able to see what the gate will
 * say before it says it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FLOORS, MODALITIES, TIERS, type TierId } from '@ledger/shared';
import { ApiError, api, useClinicianSession } from '@/lib/api';
import { SignIn } from '@/app/sign-in';

interface StackResponse {
  stack: { slug: string; tier: TierId }[];
  coverage: Record<string, TierId | null>;
  warnings: string[];
}

const TIER_LABEL: Record<string, string> = Object.fromEntries(TIERS.map((t) => [t.id, t.name]));

export default function StackPage() {
  const { session, loading } = useClinicianSession();
  const [chosen, setChosen] = useState<Record<string, TierId | ''>>({});
  const [server, setServer] = useState<StackResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const out = await api<StackResponse>('/v1/clinician/stack');
      setServer(out);
      setChosen(Object.fromEntries(out.stack.map((s) => [s.slug, s.tier])));
    } catch {
      setServer({ stack: [], coverage: {}, warnings: [] });
    }
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  const entries = useMemo(
    () =>
      Object.entries(chosen)
        .filter(([, t]) => t !== '')
        .map(([slug, tier]) => ({ slug, tier: tier as TierId })),
    [chosen],
  );

  const save = async () => {
    setSaving(true);
    setProblem(null);
    setSaved(false);
    try {
      const out = await api<StackResponse>('/v1/clinician/stack', {
        method: 'PUT',
        body: JSON.stringify({ stack: entries }),
      });
      setServer(out);
      setSaved(true);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not save the stack.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <main><p className="meta">Checking your session…</p></main>;
  if (!session) return <SignIn what="edit your training stack" />;

  return (
    <main>
      <h1>Your training stack</h1>
      <p className="standfirst">
        The modalities you can actually run, each at a stated depth. Coverage is read by floor, not by count — a
        stack is judged on which floors it reaches. Read <Link href="/library/tools/training-stack">the document</Link>{' '}
        for the tiers and the reading rules.
      </p>

      <h2>Depth, by modality</h2>
      <ul className="reflist">
        {MODALITIES.map((m) => (
          <li key={m.slug}>
            <span className="refname">
              {m.name}
              <span className="meta">
                {' '}
                — {m.lever}
                {m.floors.length > 0 ? ` · floors ${m.floors.slice().sort((a, b) => a - b).join(', ')}` : ' · the dimmer'}
              </span>
            </span>
            <select
              value={chosen[m.slug] ?? ''}
              onChange={(e) => {
                setSaved(false);
                setChosen((c) => ({ ...c, [m.slug]: e.target.value as TierId | '' }));
              }}
            >
              <option value="">Not in the stack</option>
              {TIERS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>

      <p className="actions">
        <button className="btn" type="button" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save the stack'}
        </button>
        {saved ? <span className="meta"> Saved.</span> : null}
      </p>
      {problem ? <p className="warn">{problem}</p> : null}

      <h2>Floor coverage</h2>
      <ul className="reflist">
        {FLOORS.map((f) => {
          const at = server?.coverage[String(f.n)] ?? null;
          return (
            <li key={f.n}>
              <span className="refname">
                {f.n} · {f.name}
              </span>
              <span className={at ? 'meta' : 'warn'}>{at ? TIER_LABEL[at] : 'nothing reaches it'}</span>
            </li>
          );
        })}
      </ul>

      {server && server.warnings.length > 0 ? (
        <div className="callout warning">
          <span className="c-title">The reading rules</span>
          <ul>
            {server.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="meta">
            Advisory. The rules are about how a career is built, and the app states them rather than enforcing them —
            except one Master and one Deep at a time, which the database holds.
          </p>
        </div>
      ) : null}

      <p className="foot">
        Formulate reads this. A formulation on a floor your stack does not reach is still written — you are asked to
        say you know, and the answer is kept on the row.
      </p>
    </main>
  );
}
