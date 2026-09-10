'use client';

/**
 * Your stack.
 *
 * The set of modalities you can actually run, each at a stated depth —
 * docs/theory/tools/training-stack.md. The building is the one from
 * /formulate, shaded by how deeply your training reaches each floor, because
 * the document's argument is that a portfolio is measured by floor coverage
 * and not by how many rows it has.
 *
 * The modality list and its home floors come from content/modalities.ts, which
 * is this repository's single source for both — ported from
 * docs/theory/modalities.md. The arithmetic comes from @ledger/shared, which
 * takes that data as an argument and holds no copy of it.
 *
 * Nothing here is client data, and nothing here is ever shown to a client.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  STACK_DISCLAIMER,
  TIERS,
  coverage,
  stackWarnings,
  type CoverageLevel,
  type StackEntry,
  type StackGoal,
  type TierId,
} from '@ledger/shared';
import { STACK_MODALITIES } from '@/content/modalities';
import { BUILDING_CAPTION } from '@/content/observations';
import { Building } from '@/app/building';
import { ApiError, api, useClinicianSession } from '@/lib/api';
import { SignIn } from '@/app/sign-in';

const TIER_LABEL: Record<string, string> = Object.fromEntries(TIERS.map((t) => [t.id, t.name]));

const LEVEL_LABEL: Record<CoverageLevel, string> = {
  specialist: 'Specialist',
  'in-stack': 'In stack',
  literacy: 'Literacy only',
  gap: 'Gap',
};

/** The reading rules, rendered beside the selectors. Verbatim from the document. */
const READING_RULES: readonly string[] = [
  'One Master, three Fluents — that carries the degree. ACT gets the identity and the hours; the daily drivers get real command because every case uses them.',
  'Each literacy-tier unit gets one question walking in: this one gets literacy — what is the one lever I’m taking from it?',
  'The Deep row waits. One experiential certification, chosen after licensure, one at a time — acquiring certifications in parallel is the jack-of-all-trades error wearing a to-do list.',
];

export default function StackPage() {
  const { session, loading } = useClinicianSession();
  const [tab, setTab] = useState<'stack' | 'roadmap'>('stack');

  const [chosen, setChosen] = useState<Record<string, TierId | ''>>({});
  const [goals, setGoals] = useState<Record<string, { targetTier: TierId; targetBy: string | null; doneAt: string | null }>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, g] = await Promise.all([
        api<{ stack: { slug: string; tier: TierId }[] }>('/v1/clinician/stack'),
        api<{ goals: (StackGoal & { targetTier: TierId })[] }>('/v1/clinician/stack/goals'),
      ]);
      setChosen(Object.fromEntries(s.stack.map((x) => [x.slug, x.tier])));
      setGoals(
        Object.fromEntries(
          g.goals.map((x) => [x.slug, { targetTier: x.targetTier, targetBy: x.targetBy ?? null, doneAt: x.doneAt ?? null }]),
        ),
      );
    } catch {
      setChosen({});
      setGoals({});
    }
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  const stack: StackEntry[] = useMemo(
    () =>
      Object.entries(chosen)
        .filter(([, t]) => t !== '')
        .map(([slug, t]) => ({ slug, tier: t as TierId })),
    [chosen],
  );

  const cover = useMemo(() => coverage(stack, STACK_MODALITIES), [stack]);
  const warnings = useMemo(() => stackWarnings(stack, STACK_MODALITIES), [stack]);
  const levelOf = (n: number): CoverageLevel => cover.floors.find((f) => f.floor === n)?.level ?? 'gap';

  const save = async () => {
    setSaving(true);
    setProblem(null);
    setSaved(false);
    try {
      await api('/v1/clinician/stack', { method: 'PUT', body: JSON.stringify({ stack }) });
      await api('/v1/clinician/stack/goals', {
        method: 'PUT',
        body: JSON.stringify({
          goals: Object.entries(goals).map(([slug, g]) => ({ slug, ...g })),
        }),
      });
      setSaved(true);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <main><p className="meta">Checking your session…</p></main>;
  if (!session) return <SignIn what="edit your training stack" />;

  return (
    <main>
      <h1>Your stack</h1>
      <p className="standfirst">
        The modalities you can actually run, each at a stated depth. Coverage is read by floor, not by count. Read{' '}
        <Link href="/library/tools/training-stack">the document</Link> for the tiers and the rules.
      </p>

      <div className="tabs sub">
        <button className={`btn ghost${tab === 'stack' ? ' on' : ''}`} type="button" onClick={() => setTab('stack')}>
          Stack
        </button>
        <button className={`btn ghost${tab === 'roadmap' ? ' on' : ''}`} type="button" onClick={() => setTab('roadmap')}>
          Roadmap
        </button>
      </div>

      <div className="work">
        <div>
          <Building
            classFor={(n) => `cov-${levelOf(n)}`}
            describe={(n) => LEVEL_LABEL[levelOf(n)]}
            caption={BUILDING_CAPTION}
          />
          <ul className="legend">
            {(['specialist', 'in-stack', 'literacy', 'gap'] as CoverageLevel[]).map((l) => (
              <li key={l}>
                <span className={`swatch cov-${l}`} aria-hidden="true" /> {LEVEL_LABEL[l]}
              </li>
            ))}
          </ul>

          {/* The dimmer is under the building because it is under everything. */}
          <div className="dimmer-row">
            <span className="label">The dimmer</span>
            <p className="meta">
              {cover.dimmer.length > 0
                ? cover.dimmer.map((s) => STACK_MODALITIES.find((m) => m.slug === s)?.name ?? s).join(', ')
                : 'Nothing yet. Nothing writes while it is off.'}
            </p>
          </div>

          <p className="foot">{STACK_DISCLAIMER}</p>
        </div>

        <div>
          {tab === 'stack' ? (
            <>
              <h2>Depth, by modality</h2>
              <ul className="reflist">
                {STACK_MODALITIES.map((m) => (
                  <li key={m.slug}>
                    <span className="refname">
                      {m.name}
                      <span className="meta">
                        {' '}
                        — {m.lever}
                        {m.floors.length > 0 ? ` · floors ${m.floors.join(', ')}` : ''}
                        {m.dimmer ? ' · the dimmer' : ''}
                      </span>
                    </span>
                    <select
                      aria-label={`${m.name} tier`}
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

              <div className="callout">
                <span className="c-title">The reading rules</span>
                <ol>
                  {READING_RULES.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ol>
              </div>

              {warnings.length > 0 ? (
                <div className="callout warning">
                  <span className="c-title">Worth a look</span>
                  <ul>
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  <p className="meta">
                    Guidance, not rules the app enforces. Nothing here stops you saving a stack that says what is true.
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <h2>Roadmap</h2>
              <p className="sub">Where each one is going, and by when. No notes — that is what supervision is for.</p>
              <ul className="reflist">
                {STACK_MODALITIES.map((m) => {
                  const g = goals[m.slug];
                  return (
                    <li key={m.slug}>
                      <span className="refname">{m.name}</span>
                      <select
                        aria-label={`${m.name} target tier`}
                        value={g?.targetTier ?? ''}
                        onChange={(e) => {
                          setSaved(false);
                          const v = e.target.value as TierId | '';
                          setGoals((all) => {
                            const next = { ...all };
                            if (v === '') delete next[m.slug];
                            else next[m.slug] = { targetTier: v, targetBy: g?.targetBy ?? null, doneAt: g?.doneAt ?? null };
                            return next;
                          });
                        }}
                      >
                        <option value="">No goal</option>
                        {TIERS.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        aria-label={`${m.name} target date`}
                        disabled={!g}
                        value={g?.targetBy ?? ''}
                        onChange={(e) => {
                          setSaved(false);
                          setGoals((all) =>
                            g ? { ...all, [m.slug]: { ...g, targetBy: e.target.value || null } } : all,
                          );
                        }}
                      />
                      <label className="tick">
                        <input
                          type="checkbox"
                          disabled={!g}
                          checked={!!g?.doneAt}
                          onChange={(e) => {
                            setSaved(false);
                            setGoals((all) =>
                              g
                                ? { ...all, [m.slug]: { ...g, doneAt: e.target.checked ? new Date().toISOString() : null } }
                                : all,
                            );
                          }}
                        />
                        <span>Done</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <p className="actions">
            <button className="btn" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved ? <span className="meta"> Saved.</span> : null}
          </p>
          {problem ? <p className="warn">{problem}</p> : null}
        </div>
      </div>

      <p className="foot">
        <Link href="/formulate">Formulate</Link> reads this. A formulation on a floor your stack does not reach is
        still written — you are told, and the answer is kept on the row.
      </p>
    </main>
  );
}
