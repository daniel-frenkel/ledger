import React, { useEffect, useState } from 'react';
import { FRAMING, CRISIS_RESOURCES } from '@ledger/shared';
import { useSession } from '@/auth/session';
import { persistenceState } from '@/storage';
import { syncNow } from '@/sync';
import { Button, Card, Divider, H1, H2, P, Screen, Small } from '@/ui';

export default function Settings() {
  const { signOut, session } = useSession();
  const [persisted, setPersisted] = useState<string | null>(null);

  useEffect(() => {
    void persistenceState().then(setPersisted);
  }, []);

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
      <Small>Signed in as an anonymous id{session?.user.email ? ` (${session.user.email})` : ''}.</Small>
      <Button title="Sign out and clear this browser" kind="danger" onPress={() => void signOut()} />
    </Screen>
  );
}
