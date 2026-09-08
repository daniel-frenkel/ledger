/**
 * The ledger. One sentence per rule, in the person's own record. No charts
 * in milestone 1 — the sentence is the point. No streaks, ever.
 */
import React, { useEffect, useState } from 'react';
import { FRAMING, summarizeLedger, type LedgerSummary } from '@ledger/shared';
import { allBodyStates, allPredictions, allPriors, allReinterpretations } from '@/db';
import { Card, H1, H2, P, Screen, Small } from '@/ui';

export default function Ledger() {
  const [s, setS] = useState<LedgerSummary | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [predictions, priors, reinterpretations, bodyStates] = await Promise.all([
        allPredictions(),
        allPriors(),
        allReinterpretations(),
        allBodyStates(),
      ]);
      if (live) setS(summarizeLedger({ predictions, priors, reinterpretations, bodyStates }));
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!s)
    return (
      <Screen tabs>
        <P muted>Loading…</P>
      </Screen>
    );

  return (
    <Screen tabs>
      <H1>Ledger</H1>
      <Card>
        <P>{s.overall.sentence}</P>
        {s.overall.loudMisses > 0 ? <Small>{s.overall.loudMisses} of those were high-confidence forecasts that missed.</Small> : null}
        {s.overall.unclear > 0 ? <Small>{s.overall.unclear} couldn’t be scored.</Small> : null}
      </Card>

      {s.byPrior.length > 0 ? <H2>By rule</H2> : null}
      {s.byPrior.map(({ prior, calibration, furnace }) => (
        <Card key={prior.id}>
          <P strong>“{prior.label}”</P>
          <P>{calibration.sentence}</P>
          {calibration.meanConfidenceOnMisses != null ? (
            <Small>When it didn’t happen, you’d been {Math.round(calibration.meanConfidenceOnMisses)}% sure it would.</Small>
          ) : null}
          {furnace.exits.forecast > 0 ? (
            <Small>
              Exits: named {furnace.exits.forecast}, took {furnace.exits.taken}, didn’t take {furnace.exits.notTaken}
              {furnace.exits.differentExit ? `, took a different one ${furnace.exits.differentExit}` : ''}.
            </Small>
          ) : null}
          {furnace.survivalsWithoutKit + furnace.survivalsWithKit > 0 ? (
            <Small>
              Body: got through it {furnace.survivalsWithoutKit} {furnace.survivalsWithoutKit === 1 ? 'time' : 'times'} with nothing on the table,{' '}
              {furnace.survivalsWithKit} with the kit.
            </Small>
          ) : null}
        </Card>
      ))}

      {s.untagged.total > 0 ? (
        <Card>
          <P strong>Not tied to a rule</P>
          <P>{s.untagged.sentence}</P>
        </Card>
      ) : null}

      <Small>
        {FRAMING.noStreaks} {FRAMING.frameworkCaveat}
      </Small>
    </Screen>
  );
}
