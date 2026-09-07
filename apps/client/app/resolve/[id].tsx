/**
 * After. Read the forecast back, record what happened, score it, and — only
 * then — one dated question for the half-minute after the surprise. The
 * reinterpretation is stored separately and cannot edit the outcome.
 */
import React, { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ABANDON_REASONS,
  CREDITED_TO,
  EXIT_MOVES,
  EXIT_MOVE_LABELS,
  KIT_ITEMS,
  OUTCOME_SOURCES,
  OUTCOME_VERDICTS,
  OWN_PART_OPTIONS,
  VERDICT_ARRIVED,
  isLoudMiss,
  resolvePredictionInput,
  type AbandonReason,
  type BodyStateAfter,
  type CreditedTo,
  type ExitMove,
  type KitItem,
  type OutcomeSource,
  type OutcomeVerdict,
  type OwnPart,
  type Prediction,
  type VerdictArrived,
} from '@ledger/shared';
import { bodyStatesFor, getPrediction, putBodyState, putPrediction, putReinterpretation } from '@/db';
import { crisisGate } from '@/crisis/gate';
import { newId, nowIso } from '@/ids';
import { requestSync } from '@/sync';
import { Button, Card, Choice, Divider, Field, H1, H2, P, Scale, Screen, Small, useTheme } from '@/ui';
import { CrisisCard } from '@/ui/CrisisCard';

const VERDICT_LABELS: Record<OutcomeVerdict, string> = { hit: 'It happened', partial: 'Partly', miss: 'It didn’t', unclear: 'Can’t say' };
const SOURCE_LABELS: Record<OutcomeSource, string> = { observed: 'I saw / heard it', inferred: 'I could tell what they thought' };
const OWN_PART_LABELS: Record<OwnPart, string> = { none: 'Nothing', made_it_likelier: 'I made it likelier', held_back: 'I held back', unsure: 'Not sure' };
const ABANDON_LABELS: Record<AbandonReason, string> = { situation_did_not_occur: 'It never came up', avoided: 'I didn’t go', left_early: 'I left before it could happen', forgot: 'Forgot', other: 'Other' };
const CREDIT_LABELS: Record<CreditedTo, string> = { body: 'My body handled it', kit: 'Something I brought', person: 'Someone there', technique: 'A technique', luck: 'Luck' };

export default function Resolve() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const [p, setP] = useState<Prediction | null>(null);
  const [hadBodyBefore, setHadBodyBefore] = useState(false);
  const [mode, setMode] = useState<'resolve' | 'abandon'>('resolve');
  const [actual, setActual] = useState('');
  const [verdict, setVerdict] = useState<OutcomeVerdict | null>(null);
  const [source, setSource] = useState<OutcomeSource | null>(null);
  const [surprise, setSurprise] = useState<number | null>(null);
  const [present, setPresent] = useState<'yes' | 'no' | null>(null);
  const [ownPart, setOwnPart] = useState<OwnPart | null>(null);
  const [exitActual, setExitActual] = useState<ExitMove | null>(null);
  const [exitNote, setExitNote] = useState('');
  const [reinterp, setReinterp] = useState('');
  const [abandonReason, setAbandonReason] = useState<AbandonReason | null>(null);
  // body after
  const [peak, setPeak] = useState<number | null>(null);
  const [ranPastPeak, setRanPastPeak] = useState<'yes' | 'no' | null>(null);
  const [arrived, setArrived] = useState<VerdictArrived | null>(null);
  const [credited, setCredited] = useState<CreditedTo | null>(null);
  const [kitUsed, setKitUsed] = useState<KitItem[]>([]);
  const [wordNow, setWordNow] = useState('');
  const [done, setDone] = useState<{ loud: boolean; crisis: Awaited<ReturnType<typeof crisisGate>> | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getPrediction(id).then(setP);
    bodyStatesFor(id).then((b) => setHadBodyBefore(b.some((x) => x.phase === 'before')));
  }, [id]);

  if (!p) return <Screen><P muted>Loading…</P></Screen>;

  const abandon = async () => {
    if (!abandonReason) return;
    const now = nowIso();
    await putPrediction({ ...p, abandonedAt: now, abandonReason, clientUpdatedAt: now });
    requestSync();
    router.back();
  };

  const save = async () => {
    setErr(null);
    const parsed = resolvePredictionInput.safeParse({
      actualOutcome: actual,
      outcomeVerdict: verdict,
      outcomeSource: source,
      surpriseRating: surprise,
      presentForIt: present === 'yes',
      ownPart: ownPart ?? undefined,
      exitActual: exitActual ?? undefined,
      exitActualNote: exitNote.trim() || undefined,
      reinterpretation: reinterp.trim() || undefined,
    });
    if (!parsed.success || present == null) {
      setErr('Say what happened, whether it matched, how you know, and how surprised you were.');
      return;
    }
    const now = nowIso();
    const resolved: Prediction = {
      ...p,
      resolvedAt: now,
      actualOutcome: parsed.data.actualOutcome,
      outcomeVerdict: parsed.data.outcomeVerdict,
      outcomeSource: parsed.data.outcomeSource,
      surpriseRating: parsed.data.surpriseRating,
      presentForIt: parsed.data.presentForIt,
      ownPart: parsed.data.ownPart ?? null,
      exitActual: parsed.data.exitActual ?? null,
      exitActualNote: parsed.data.exitActualNote ?? null,
      clientUpdatedAt: now,
    };
    const gate = await crisisGate('prediction', p.id, [resolved.actualOutcome, parsed.data.reinterpretation]);
    await putPrediction(resolved);
    if (parsed.data.reinterpretation) {
      await putReinterpretation({ id: newId(), predictionId: p.id, text: parsed.data.reinterpretation, createdAt: now, clientUpdatedAt: now });
    }
    let after: BodyStateAfter | undefined;
    if (hadBodyBefore && peak != null && arrived && credited) {
      after = { peakIntensity: peak, ranPastPeak: ranPastPeak === 'yes', verdictArrived: arrived, creditedTo: credited, kitUsed };
      if (wordNow.trim()) after.wordNow = wordNow.trim();
      await putBodyState({ id: newId(), predictionId: p.id, phase: 'after', after, createdAt: now, clientUpdatedAt: now });
    }
    requestSync();
    setDone({ loud: isLoudMiss(resolved, after), crisis: gate.risk.matched ? gate : null });
  };

  if (done) {
    return (
      <Screen>
        {done.crisis ? <CrisisCard resources={done.crisis.risk.resources} onDismiss={() => router.back()} /> : null}
        {p.exitForecast && p.exitForecast !== 'none' && exitActual === 'none' ? (
          <Card>
            <P>You said you’d probably {EXIT_MOVE_LABELS[p.exitForecast].toLowerCase()}. You didn’t.</P>
            <Small>That’s the round that counts: the exit was named, and not taken.</Small>
          </Card>
        ) : null}
        {done.loud ? (
          <Card style={{ borderColor: t.accent, borderWidth: 2 }}>
            <H2>Read it back</H2>
            <P>Before, you wrote: “{p.expectedOutcome}” — and you were {p.confidence}% sure.</P>
            <P>Then: “{actual}”</P>
            <P muted>That’s the whole point of writing it down first. The forecast was fixed before the result, so this is a real miss, not a memory of one.</P>
          </Card>
        ) : (
          <Card>
            <P>Saved.</P>
            {verdict === 'unclear' || present === 'no' ? <Small>This one won’t be scored — it goes in the “can’t say” column, which is worth talking through with a person.</Small> : null}
          </Card>
        )}
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Small>You wrote, {new Date(p.createdAt).toLocaleDateString()}:</Small>
        <P style={{ fontWeight: '600' }}>{p.situation}</P>
        <P>“{p.expectedOutcome}” — {p.confidence}% sure</P>
      </Card>
      <Choice label="" options={[{ value: 'resolve', label: 'It happened (or didn’t)' }, { value: 'abandon', label: 'I never ran it' }]} value={mode} onChange={setMode} />

      {mode === 'abandon' ? (
        <>
          <Choice label="Why not?" hint="No judgment. A prediction never tested just stays open, and it’s useful to know which ones." options={ABANDON_REASONS.map((r) => ({ value: r, label: ABANDON_LABELS[r] }))} value={abandonReason} onChange={setAbandonReason} />
          <Button title="Save" onPress={abandon} disabled={!abandonReason} />
        </>
      ) : (
        <>
          <H1>What actually happened</H1>
          <Field label="" hint="What they said and did. Not what they were thinking." value={actual} onChangeText={setActual} multiline placeholder="He said okay and asked about next month." />
          <Choice label="Did the forecast come true?" options={OUTCOME_VERDICTS.map((v) => ({ value: v, label: VERDICT_LABELS[v] }))} value={verdict} onChange={setVerdict} />
          <Choice label="How do you know?" options={OUTCOME_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))} value={source} onChange={setSource} />
          <Scale label="How surprised were you?" min={0} max={10} value={surprise} onChange={setSurprise} />
          <Choice label="Were you there for it?" hint="Could you say what actually happened, moment to moment? If it was too big to track, say no — that’s useful too." options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'It was a blur' }]} value={present} onChange={setPresent} />

          {hadBodyBefore ? (
            <>
              <Divider />
              <H2>Your body, afterward</H2>
              <Scale label="How strong did it get?" min={0} max={10} value={peak} onChange={setPeak} />
              <Choice label="Did you stay past the peak?" options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'Left at the first flinch' }]} value={ranPastPeak} onChange={setRanPastPeak} />
              <Choice label="Did what your body predicted arrive?" options={VERDICT_ARRIVED.map((v) => ({ value: v, label: v }))} value={arrived} onChange={setArrived} />
              <Choice label="What got you through it?" hint="Be honest about the credit. It’s the only way this column counts." options={CREDITED_TO.map((c) => ({ value: c, label: CREDIT_LABELS[c] }))} value={credited} onChange={setCredited} />
              <Choice label="Used anything from the kit?" multi options={KIT_ITEMS.map((k) => ({ value: k, label: k.replace('_', ' ') }))} value={kitUsed} onChange={(v) => setKitUsed(kitUsed.includes(v) ? kitUsed.filter((x) => x !== v) : [...kitUsed, v])} />
              <Field label="A word for it now" value={wordNow} onChangeText={setWordNow} placeholder="shaky" />
            </>
          ) : null}

          <Divider />
          {p.exitForecast ? (
            <>
              <Small>
                Before, you said your exit would probably be: {EXIT_MOVE_LABELS[p.exitForecast].toLowerCase()}
                {p.exitForecastNote ? ` — “${p.exitForecastNote}”` : ''}.
              </Small>
              <Choice label="Did you?" options={EXIT_MOVES.map((m) => ({ value: m, label: EXIT_MOVE_LABELS[m] }))} value={exitActual} onChange={setExitActual} />
            </>
          ) : (
            <Choice label="Did you take an exit?" hint="Optional." options={EXIT_MOVES.map((m) => ({ value: m, label: EXIT_MOVE_LABELS[m] }))} value={exitActual} onChange={setExitActual} />
          )}
          {exitActual && exitActual !== 'none' ? <Field label="What it looked like" value={exitNote} onChangeText={setExitNote} maxLength={80} /> : null}
          <Choice label="Your part, if any" hint="Optional. Did you do anything that made it more likely to go the way you expected?" options={OWN_PART_OPTIONS.map((o) => ({ value: o, label: OWN_PART_LABELS[o] }))} value={ownPart} onChange={setOwnPart} />
          <Field label="What did you tell yourself about why it went that way?" hint="Optional. This is kept as its own dated note; it can’t change what you wrote above." value={reinterp} onChangeText={setReinterp} multiline placeholder="He was only being nice because Mom was there." />

          {err ? <P style={{ color: '#b3261e' }}>{err}</P> : null}
          <Button title="Save" onPress={save} />
        </>
      )}
    </Screen>
  );
}
