/**
 * Open — predictions written and not yet checked. The whole app in one
 * screen: write one before, check it after.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Prediction } from '@ledger/shared';
import { openPredictions, outboxCount } from '@/db';
import { getStatus, onStatus, type SyncStatus } from '@/sync';
import { Button, Card, H1, P, Screen, Small, useTheme } from '@/ui';

export default function Open() {
  const router = useRouter();
  const t = useTheme();
  const [items, setItems] = useState<Prediction[]>([]);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState<SyncStatus>(getStatus());

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const [p, n] = await Promise.all([openPredictions(), outboxCount()]);
        if (live) {
          setItems(p);
          setPending(n);
        }
      })();
      const off = onStatus(setStatus);
      return () => {
        live = false;
        off();
      };
    }, []),
  );

  return (
    <Screen>
      <H1>Open</H1>
      <Small>
        {status === 'offline' ? 'Offline — entries are saved here and will sync later.' : status === 'syncing' ? 'Syncing…' : status === 'error' ? 'Couldn’t reach the server; will retry.' : pending > 0 ? `${pending} waiting to sync.` : 'Up to date.'}
      </Small>
      <Button title="Write a prediction" onPress={() => router.push('/predict')} />
      <View style={{ height: 12 }} />
      {items.length === 0 ? (
        <P muted>Nothing open. Before the next thing you’re dreading, write down what you expect and how sure you are.</P>
      ) : (
        items.map((p) => (
          <Pressable key={p.id} onPress={() => router.push(`/resolve/${p.id}`)}>
            <Card>
              <P style={{ fontWeight: '600', marginBottom: 2 }}>{p.situation}</P>
              <P muted>“{p.expectedOutcome}” — {p.confidence}% sure</P>
              <Small>
                Written {new Date(p.createdAt).toLocaleDateString()}
                {p.scheduledFor ? ` · expected ${new Date(p.scheduledFor).toLocaleDateString()}` : ''}
              </Small>
              <P style={{ color: t.accent, marginTop: 6, marginBottom: 0 }}>Check it →</P>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
