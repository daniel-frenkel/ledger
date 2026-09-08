/**
 * Open — predictions written and not yet checked. The whole app in one
 * screen: write one before, check it after.
 */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Prediction } from '@ledger/shared';
import { openPredictions, outboxCount } from '@/db';
import { hasStaleOutbox } from '@/storage';
import { getStatus, onStatus, type SyncStatus } from '@/sync';
import { Button, Card, H1, P, Screen, Small } from '@/ui';

export default function Open() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Prediction[]>([]);
  const [pending, setPending] = useState(0);
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState<SyncStatus>(getStatus());

  useEffect(() => {
    let live = true;
    void (async () => {
      const [p, n, s] = await Promise.all([openPredictions(), outboxCount(), hasStaleOutbox()]);
      if (live) {
        setItems(p);
        setPending(n);
        setStale(s);
      }
    })();
    const off = onStatus(setStatus);
    return () => {
      live = false;
      off();
    };
  }, []);

  return (
    <Screen tabs>
      <H1>Open</H1>
      <Small>
        {status === 'offline'
          ? 'Offline — entries are saved here and will sync later.'
          : status === 'syncing'
            ? 'Syncing…'
            : status === 'error'
              ? 'Couldn’t reach the server; will retry.'
              : pending > 0
                ? `${pending} waiting to sync.`
                : 'Up to date.'}
      </Small>
      {stale ? (
        <div className="notice">
          <Small>Some entries haven’t synced in over a week. Open the app with a connection so they’re saved.</Small>
        </div>
      ) : null}
      <Button title="Write a prediction" onPress={() => navigate('/predict')} />
      <div className="spacer" />
      {items.length === 0 ? (
        <P muted>Nothing open. Before the next thing you’re dreading, write down what you expect and how sure you are.</P>
      ) : (
        items.map((p) => (
          <Link key={p.id} className="card-link" to={`/resolve/${p.id}`}>
            <Card>
              <P strong>{p.situation}</P>
              <P muted>
                “{p.expectedOutcome}” — {p.confidence}% sure
              </P>
              <Small>
                Written {new Date(p.createdAt).toLocaleDateString()}
                {p.scheduledFor ? ` · expected ${new Date(p.scheduledFor).toLocaleDateString()}` : ''}
              </Small>
              <p className="p accent" style={{ marginTop: 6, marginBottom: 0 }}>
                Check it →
              </p>
            </Card>
          </Link>
        ))
      )}
    </Screen>
  );
}
