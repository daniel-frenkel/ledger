/**
 * Before. Write it down before, because "memory silently rewrites an
 * unrecorded prediction to match the outcome." Six fields, one optional
 * body section for people using the interoceptive track.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  BODY_CHANNELS,
  BODY_CHANNEL_LABELS,
  BODY_SEED_WORDS,
  EXIT_MOVES,
  EXIT_MOVE_LABELS,
  KIT_ITEMS,
  PRIOR_CATEGORIES,
  PRIOR_CATEGORY_LABELS,
  newPredictionInput,
  suggestPriors,
  type BodyChannel,
  type BodyStateBefore,
  type ExitMove,
  type KitItem,
  type Prediction,
  type Prior,
  type PriorCategory,
} from '@ledger/shared';
import { activePriors, putBodyState, putPrediction, putPrior } from '@/db';
import { crisisGate } from '@/crisis/gate';
import { newId, nowIso } from '@/ids';
import { requestSync } from '@/sync';
import { scheduleLocalCheckIn } from '@/notifications';
import { Button, Choice, Divider, Field, H2, P, Scale, Screen, Small } from '@/ui';
import { CrisisCard } from '@/ui/CrisisCard';

export default function Predict() {
  const router = useRouter();
  const [situation, setSituation] = useState('');
  const [expected, setExpected] = useState('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [reviseAfterN, setReviseAfterN] = useState<number | null>(null);
  const [exitForecast, setExitForecast] = useState<ExitMove | null>(null);
  const [exitNote, setExitNote] = useState('');
  const [priors, setPriors] = useState<Prior[]>([]);
  const [priorId, setPriorId] = useState<string | null>(null);
  const [newPriorLabel, setNewPriorLabel] = useState('');
  const [newPriorCategory, setNewPriorCategory] = useState<PriorCategory>('other');
  const [showBody, setShowBody] = useState(false);
  const [channels, setChannels] = useState<BodyChannel[]>([]);
  const [intensity, setIntensity] = useState<number | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [verdict, setVerdict] = useState('');
  const [kit, setKit] = useState<KitItem[]>([]);
  const [crisis, setCrisis] = useState<ReturnType<typeof crisisGate> extends Promise<infer R> ? R : never>();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    activePriors().then(setPriors);
  }, []);

  const suggestions = expected.length > 8 ? suggestPriors({ situation, expectedOutcome: expected }, priors) : [];
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async () => {
    setErr(null);
    const parsed = newPredictionInput.safeParse({
      situation,
      expectedOutcome: expected,
      confidence,
      reviseAfterN: reviseAfterN ?? undefined,
      exitForecast: exitForecast ?? undefined,
      exitForecastNote: exitNote.trim() || undefined,
      priorIds: priorId ? [priorId] : [],
    });
    if (!parsed.success) {
      setErr('Fill in the situation, what you expect, and how sure you are.');
      return;
    }
    const now = nowIso();
    let priorIds = parsed.data.priorIds;
    if (!priorId && newPriorLabel.trim().length > 0) {
      const prior: Prior = { id: newId(), label: newPriorLabel.trim(), category: newPriorCategory, origin: 'client', createdBy: 'client', createdAt: now, clientUpdatedAt: now };
      await putPrior(prior);
      priorIds = [prior.id];
    }
    const p: Prediction = {
      id: newId(),
      situation: parsed.data.situation,
      expectedOutcome: parsed.data.expectedOutcome,
      confidence: parsed.data.confidence,
      reviseAfterN: parsed.data.reviseAfterN ?? null,
      exitForecast: parsed.data.exitForecast ?? null,
      exitForecastNote: parsed.data.exitForecastNote ?? null,
      priorIds,
      createdAt: now,
      clientUpdatedAt: now,
    };
    // Crisis gate runs first, offline, before anything is written.
    const gate = await crisisGate('prediction', p.id, [p.situation, p.expectedOutcome]);
    await putPrediction(p);
    if (showBody && intensity != null) {
      const before: BodyStateBefore = { channels, intensity, words, kitPresent: kit };
      if (verdict.trim()) before.verdict = verdict.trim();
      await putBodyState({ id: newId(), predictionId: p.id, phase: 'before', before, createdAt: now, clientUpdatedAt: now });
    }
    requestSync();
    if (p.scheduledFor) void scheduleLocalCheckIn(p.id, new Date(p.scheduledFor));
    if (gate.risk.matched) {
      setCrisis(gate);
      return;
    }
    router.back();
  };

  if (crisis?.risk.matched) {
    return (
      <Screen>
        <CrisisCard resources={crisis.risk.resources} onDismiss={() => router.back()} />
        <Small>Your prediction was saved.</Small>
      </Screen>
    );
  }

  return (
    <Screen>
      <P muted>Write it before it happens. Afterward you’ll compare what happened to this, not to what you remember expecting.</P>
      <Field label="The situation" hint="What’s coming up that you’re dreading?" value={situation} onChangeText={setSituation} multiline placeholder="Telling my brother I can’t make the trip." />
      <Field label="What you expect to happen" hint="The forecast, in words. Concrete enough that the world can grade it." value={expected} onChangeText={setExpected} multiline placeholder="He goes quiet and doesn’t call for weeks." />
      <Scale label="How sure are you?" hint="Zero to a hundred." min={0} max={100} step={10} value={confidence} onChange={setConfidence} suffix="%" />

      <H2>Which rule is this testing?</H2>
      <Small>Optional. Pick one of yours, or name a new one. Nobody is a type; this is your list.</Small>
      {suggestions.length > 0 && !priorId ? (
        <Small>Looks like it might be: {suggestions.map((s) => `“${priors.find((p) => p.id === s.priorId)?.label}”`).join(', ')}</Small>
      ) : null}
      <Choice
        label=""
        options={priors.map((p) => ({ value: p.id, label: p.label }))}
        value={priorId}
        onChange={(v) => setPriorId(priorId === v ? null : v)}
      />
      {!priorId ? (
        <>
          <Field label="Or a new rule, in your words" value={newPriorLabel} onChangeText={setNewPriorLabel} placeholder="If I show weakness, they withdraw." />
          {newPriorLabel.trim() ? (
            <Choice label="It’s mostly about…" options={PRIOR_CATEGORIES.map((c) => ({ value: c, label: PRIOR_CATEGORY_LABELS[c] }))} value={newPriorCategory} onChange={setNewPriorCategory} />
          ) : null}
        </>
      ) : null}

      <Scale label="How many times would this have to go differently before you’d revise the rule?" hint="Optional. Say it now, before the result." min={1} max={10} value={reviseAfterN} onChange={setReviseAfterN} />

      <Choice
        label="How will you probably get out of this?"
        hint="Optional. A second forecast, about you. An exit you called in advance is easier to see when it starts."
        options={EXIT_MOVES.map((m) => ({ value: m, label: EXIT_MOVE_LABELS[m] }))}
        value={exitForecast}
        onChange={(v) => setExitForecast(exitForecast === v ? null : v)}
      />
      {exitForecast && exitForecast !== 'none' ? (
        <Field label="What it’ll look like" value={exitNote} onChangeText={setExitNote} placeholder="A bathroom break that never ends." maxLength={80} />
      ) : null}

      <Divider />
      {!showBody ? (
        <Button title="Add what your body is doing right now" kind="secondary" onPress={() => setShowBody(true)} />
      ) : (
        <>
          <H2>Your body, right now</H2>
          <Small>The body supplies the intensity; the meaning gets added. Log both separately.</Small>
          <Choice label="Where is it?" multi options={BODY_CHANNELS.map((c) => ({ value: c, label: BODY_CHANNEL_LABELS[c] }))} value={channels} onChange={(v) => setChannels(toggle(channels, v))} />
          <Scale label="How strong?" min={0} max={10} value={intensity} onChange={setIntensity} />
          <Choice label="Words for it" multi options={BODY_SEED_WORDS.map((w) => ({ value: w, label: w }))} value={words} onChange={(v) => setWords(toggle(words, v))} />
          <Field label="What is your body telling you it means?" hint="Verbatim. “Heart → something’s wrong.”" value={verdict} onChangeText={setVerdict} placeholder="Heart racing → I’m going to lose it in there." />
          <Choice label="What’s on the table?" hint="Anything that could take the credit for getting through it." multi options={KIT_ITEMS.map((k) => ({ value: k, label: k.replace('_', ' ') }))} value={kit} onChange={(v) => setKit(toggle(kit, v))} />
        </>
      )}

      {err ? <P style={{ color: '#b3261e' }}>{err}</P> : null}
      <Button title="Save it" onPress={save} />
    </Screen>
  );
}
