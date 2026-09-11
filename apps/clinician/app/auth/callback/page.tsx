'use client';

/**
 * /auth/callback — where the emailed sign-in link lands.
 *
 * The same shape as the client app's, with one extra step that only exists
 * here: a clinician who has enrolled a second factor is asked for it before
 * the session becomes real. Go-live gate B2 requires two factors before any
 * client data is readable, and the API enforces that on the token's own claim,
 * so what happens here is only how such a token gets made.
 *
 * The link carries a single-use code and nothing else. Finishing also needs
 * the email address it was issued for, which is what makes it safe for this
 * URL to be public: intercepting the link is not enough.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MfaChallenge } from '@ledger/shared';
import { auth, identityPlatform } from '@/lib/api';

const PENDING_EMAIL_KEY = 'cl.clinician.pendingEmail';

const CALLBACK_FAILED = 'That sign-in link didn’t work. Ask for another from the sign-in screen.';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [totp, setTotp] = useState('');
  const attempted = useRef(false);

  // Read the code once, then strip it from the address bar so it is not left
  // in history or sent as a referrer on the next navigation. In an effect
  // because there is no `window` during the server render.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oob = params.get('oobCode');
    if (oob) window.history.replaceState(null, '', window.location.pathname);
    setCode(oob);
    try {
      setEmail(sessionStorage.getItem(PENDING_EMAIL_KEY) ?? '');
    } catch {
      setEmail('');
    }
    setReady(true);
  }, []);

  const finish = useCallback(
    async (address: string, oob: string) => {
      const client = identityPlatform();
      if (!client) return;
      setBusy(true);
      setFailed(false);
      try {
        const pending = await client.completeFromLink(address, oob);
        if (pending) setChallenge(pending);
        else router.replace('/library');
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (attempted.current || !ready || !code || !email) return;
    attempted.current = true;
    void finish(email, code);
  }, [ready, code, email, finish]);

  const answer = async () => {
    if (!challenge) return;
    setBusy(true);
    try {
      await auth.answerChallenge(challenge, totp);
      router.replace('/library');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <main><p className="meta">One moment…</p></main>;

  if (!identityPlatform()) {
    return (
      <main>
        <h1>Signing in</h1>
        <p className="meta">This build doesn’t use email links.</p>
      </main>
    );
  }

  if (!code) {
    return (
      <main>
        <h1>Signing in</h1>
        <p className="warn">{CALLBACK_FAILED}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Signing in</h1>

      {challenge ? (
        <div className="field">
          <span className="label">Code from your authenticator</span>
          <input inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} />
          <p className="actions">
            <button className="btn" type="button" disabled={busy || totp.trim() === ''} onClick={() => void answer()}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </p>
        </div>
      ) : busy ? (
        <p className="meta">One moment…</p>
      ) : !email ? (
        /* Opened on another device, or in a new tab. Same check, asked aloud. */
        <div className="field">
          <span className="label">Confirm the email this link was sent to</span>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <span className="hint">The link alone isn’t enough, on purpose.</span>
          <p className="actions">
            <button
              className="btn"
              type="button"
              disabled={!email.includes('@')}
              onClick={() => void finish(email.trim(), code)}
            >
              Sign in
            </button>
          </p>
        </div>
      ) : null}

      {failed ? <p className="warn">{CALLBACK_FAILED}</p> : null}
    </main>
  );
}
