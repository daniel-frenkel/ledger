import React, { useEffect, useState } from 'react';
import { FRAMING, CRISIS_RESOURCES } from '@ledger/shared';
import { useSession } from '@/auth/session';
import { auth } from '@/auth/client';
import { persistenceState } from '@/storage';
import { syncNow } from '@/sync';
import { DELETE_CONFIRMATION, confirms, deleteAccount } from '@/account';
import { researchState, setResearchConsent, type ResearchState } from '@/research';
import { recordUsage } from '@/usage';
import { Button, Card, Divider, Field, H1, H2, P, Screen, Small } from '@/ui';

export default function Settings() {
  const { signOut, session } = useSession();
  const signedInAs = session ? auth.email() : null;
  const [persisted, setPersisted] = useState<string | null>(null);

  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setProblem(null);
    try {
      await deleteAccount();
      // signOut wipes IndexedDB. The local copy has always left with the
      // account; this is the same path, reached deliberately.
      await signOut();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Something went wrong. Nothing has been deleted.');
      setDeleting(false);
    }
  };

  const [research, setResearch] = useState<ResearchState | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);

  useEffect(() => {
    void persistenceState().then(setPersisted);
    void researchState().then(setResearch);
    void recordUsage('settings_opened');
  }, []);

  const toggleResearch = async () => {
    if (!research) return;
    setResearchBusy(true);
    try {
      await setResearchConsent(!research.consented, research.current ?? undefined);
      setResearch(await researchState());
    } catch {
      // Leave the toggle where it was; the next open re-reads the truth.
    } finally {
      setResearchBusy(false);
    }
  };

  return (
    <Screen tabs>
      <H1>Settings</H1>
      <Card>
        <H2>Check-in reminders</H2>
        <P muted>A generic nudge when a prediction is waiting. The notification never contains what you wrote.</P>
        <Small>Reminders need the app installed to your home screen over https. They land with the first deployment.</Small>
      </Card>

      <Card>
        <H2>Where this is kept</H2>
        <P muted>
          Entries are written here first, in this browser, and sync when there’s a connection. The server keeps the durable copy.
        </P>
        <Small>
          {persisted === 'granted'
            ? 'This browser has agreed to keep the local copy until you clear it.'
            : persisted === 'denied' || persisted === 'unsupported'
              ? 'This browser may clear the local copy if it needs space. Anything already synced is safe on the server.'
              : 'Checking how this browser stores the local copy…'}
        </Small>
      </Card>

      <Card>
        <H2>Clinician</H2>
        <P muted>Solo by default. Connecting a clinician is optional, layer by layer, and revocable. This lands with the clinician app.</P>
      </Card>

      <Card>
        <H2>Research</H2>
        <P muted>
          This app keeps a record of what you predicted and what happened. With your permission, a stripped-down copy
          can be used to study whether keeping it changes anything.
        </P>
        <Small>
          Numbers and choices only — how sure you were, whether it came true, when things happened. Never anything you
          wrote. You are replaced by a scrambled code that is different every time and cannot be traced back, and every
          date is moved by a random number of days, so how far apart things happened stays right and what day they
          happened does not.
        </Small>
        <Small>
          Off unless you turn it on. Your clinician is not told either way and cannot see this. Turning it off stops
          your record being included from that moment on.
        </Small>
        {research ? (
          <Button
            title={research.consented ? 'Included — tap to stop' : 'Include my record'}
            kind={research.consented ? 'secondary' : 'primary'}
            disabled={researchBusy}
            onPress={() => void toggleResearch()}
          />
        ) : (
          <Small>Sign in to choose.</Small>
        )}
      </Card>

      <Card>
        <H2>Crisis lines</H2>
        {Object.values(CRISIS_RESOURCES).map((r) => (
          <P key={r.id}>
            {r.name}: {r.action}
          </P>
        ))}
        <Button title="Open veteranscrisisline.net" kind="link" onPress={() => window.open(CRISIS_RESOURCES.vcl_call.url, '_blank', 'noopener,noreferrer')} />
      </Card>

      <Card>
        <H2>What this is</H2>
        <P>{FRAMING.notATherapist}</P>
        <P muted>{FRAMING.frameworkCaveat}</P>
        <Small>{FRAMING.noStreaks}</Small>
      </Card>

      <Divider />
      <Button title="Sync now" kind="secondary" onPress={() => void syncNow()} />
      <Small>Signed in as an anonymous id{signedInAs ? ` (${signedInAs})` : ''}.</Small>
      <Button title="Sign out and clear this browser" kind="danger" onPress={() => void signOut()} />

      <Divider />
      <Card>
        <H2>Delete my account</H2>
        <P muted>
          Everything you have written goes: the forecasts, what happened, the rules you were testing, the notes. Any
          clinician connected to you loses access straight away.
        </P>
        <Small>
          Your entries are held for 30 days before they are destroyed, in case this was a mistake and you want them
          back. After that they cannot be recovered by anyone, including us. Your sign-in is deleted immediately.
        </Small>

        {!armed ? (
          <Button title="Delete my account" kind="danger" onPress={() => setArmed(true)} />
        ) : (
          <>
            <Field
              label={`Type ${DELETE_CONFIRMATION} to confirm`}
              value={typed}
              onChangeText={setTyped}
              placeholder={DELETE_CONFIRMATION}
            />
            {problem ? <P>{problem}</P> : null}
            <Button
              title={deleting ? 'Deleting…' : 'Delete everything'}
              kind="danger"
              disabled={!confirms(typed) || deleting}
              onPress={() => void remove()}
            />
            <Button
              title="Keep my account"
              kind="secondary"
              onPress={() => {
                setArmed(false);
                setTyped('');
                setProblem(null);
              }}
            />
          </>
        )}
      </Card>
    </Screen>
  );
}
