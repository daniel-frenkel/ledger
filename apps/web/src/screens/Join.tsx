/**
 * /join — accepting a clinician's invitation.
 *
 * The token arrives in the fragment and is read into memory on mount, before
 * anything else can navigate. That ordering is the whole reason this screen
 * renders for a signed-out visitor instead of bouncing to /sign-in: a redirect
 * drops the fragment, and the invitation with it.
 *
 * No name appears anywhere. The system does not hold one, and inventing a
 * label ("Dr. —") to fill the gap would be a claim about who is on the other
 * end that nothing here can support.
 *
 * Every failure — unknown, expired, already used, revoked, or the clinician's
 * own link — gets the same sentence. The client learns nothing from the
 * difference, and neither does anyone else holding the link.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/auth/session';
import { API_URL, accessToken } from '@/auth/client';
import { captureToken, clearToken, heldToken } from '@/join/token';
import { syncNow } from '@/sync';
import { Button, Card, H1, H2, P, Screen, Small } from '@/ui';
import SignIn from '@/screens/SignIn';

/** The one message every failure gets. */
export const JOIN_FAILED = "This invitation isn't valid. Ask your clinician for a new one.";

/**
 * The only screen that names the product to someone who has never seen it.
 * Everywhere else inside the client app the thing is called the ledger, which
 * is the right word once you are in it and no use at all to a stranger who has
 * just followed a link from their clinician.
 */
export const JOIN_WHAT_THIS_IS =
  'CourageLoop is a notebook for behavioral experiments. Not a therapist, and not a treatment.';

export default function Join() {
  const { session } = useSession();
  const navigate = useNavigate();

  // Before any render decision: the fragment is only there on first load.
  const [token] = useState<string | null>(() => captureToken());
  const [sharePredictions, setSharePredictions] = useState(false);
  const [shareBodyStates, setShareBodyStates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => clearToken(), []);

  if (!token) {
    return (
      <Screen>
        <H1>Invitation</H1>
        <Card loud>
          <P>{JOIN_FAILED}</P>
        </Card>
      </Screen>
    );
  }

  // Signed out: sign in first. The token is already in memory, so coming back
  // to this screen afterwards costs nothing.
  if (!session) {
    return (
      <>
        <Screen>
          <Card>
            <H2>A clinician has invited you</H2>
            <P muted>Sign in first, and we’ll bring you straight back here.</P>
            <Small>{JOIN_WHAT_THIS_IS}</Small>
          </Card>
        </Screen>
        <SignIn />
      </>
    );
  }

  const accept = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const auth = await accessToken();
      if (!auth) {
        setFailed(true);
        return;
      }
      const res = await fetch(`${API_URL}/v1/invites/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` },
        body: JSON.stringify({ token: heldToken(), sharePredictions, shareBodyStates }),
        cache: 'no-store',
      });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      clearToken();
      void syncNow();
      navigate('/', { replace: true });
    } catch {
      // A network failure and a refused token look the same on purpose.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>A clinician has invited you</H1>
      <P muted>
        Accepting this connects your ledger to the clinician who sent it. You choose what they can see.
      </P>

      <Card>
        <Toggle
          label="Your clinician can read what you wrote"
          hint="The situation, what you expected, and how it turned out — in your own words."
          on={sharePredictions}
          onToggle={() => setSharePredictions((v) => !v)}
        />
        <Toggle
          label="Your clinician can see your body notes"
          hint="Where you felt it and how strong it was."
          on={shareBodyStates}
          onToggle={() => setShareBodyStates((v) => !v)}
        />
      </Card>

      <Small>You can change either of these, or end the link entirely, at any time from Settings.</Small>

      {failed ? (
        <Card loud>
          <P>{JOIN_FAILED}</P>
        </Card>
      ) : null}

      <Button title={busy ? 'Connecting…' : 'Accept invitation'} onPress={() => void accept()} disabled={busy} />
    </Screen>
  );
}

function Toggle({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="field">
      <button type="button" className="chip" aria-pressed={on} onClick={onToggle}>
        {on ? 'Yes' : 'No'}
      </button>
      <span className="label">{label}</span>
      <span className="hint">{hint}</span>
    </div>
  );
}
