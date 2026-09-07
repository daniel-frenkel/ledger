import React, { useState } from 'react';
import { Linking } from 'react-native';
import { FRAMING, CRISIS_RESOURCES } from '@ledger/shared';
import { useSession } from '@/auth/session';
import { registerForPush } from '@/notifications';
import { syncNow } from '@/sync';
import { Button, Card, Divider, H1, H2, P, Screen, Small } from '@/ui';

export default function Settings() {
  const { signOut, session } = useSession();
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  return (
    <Screen>
      <H1>Settings</H1>
      <Card>
        <H2>Check-in reminders</H2>
        <P muted>A generic nudge when a prediction is waiting. The notification never contains what you wrote.</P>
        <Button
          title="Turn on reminders"
          kind="secondary"
          onPress={async () => {
            const tok = await registerForPush();
            setPushMsg(tok ? 'Reminders are on.' : 'Reminders need notification permission (or a physical device).');
          }}
        />
        {pushMsg ? <Small>{pushMsg}</Small> : null}
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
        <Button title="Open veteranscrisisline.net" kind="link" onPress={() => Linking.openURL(CRISIS_RESOURCES.vcl_call.url)} />
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
      <Button title="Sign out and clear this phone" kind="danger" onPress={() => void signOut()} />
    </Screen>
  );
}
