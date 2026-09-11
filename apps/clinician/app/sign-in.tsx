'use client';

/**
 * Signing in, for the pages that touch client data.
 *
 * Email, no passwords — the same as the client app, through the same seam.
 * Supabase emails a six-digit code; Identity Platform emails a link that lands
 * on /auth/callback. `begin()` says which, so this screen shows one of two
 * second steps rather than knowing which provider the build uses.
 *
 * A third step exists only here: a clinician with a second factor enrolled is
 * asked for it, because go-live gate B2 requires two before any client data is
 * readable. The Library does not use any of this — those pages are reference
 * material with no client data on them and stay signed-out and prerendered.
 */
import React, { useState } from 'react';
import type { MfaChallenge } from '@ledger/shared';
import { auth, isConfigured } from '@/lib/api';

export function SignIn({ what = 'continue' }: { what?: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [linked, setLinked] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!isConfigured()) {
    return (
      <main>
        <h1>Sign in</h1>
        <div className="callout warning">
          <span className="c-title">Not configured</span>
          <p>
            Sign-in is not configured in this build, so there is nothing to sign in to. See .env.example.
          </p>
        </div>
      </main>
    );
  }

  const send = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const step = await auth.begin(email.trim());
      if (step === 'link') setLinked(true);
      else setSent(true);
    } catch {
      // The same message either way: whether an address has an account is not
      // something this screen should confirm.
      setProblem('Could not send a code. Check the address and try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const pending = await auth.completeWithCode?.(email.trim(), code.trim());
      if (pending) setChallenge(pending);
    } catch {
      setProblem('That code did not work. Ask for another.');
    } finally {
      setBusy(false);
    }
  };

  const answer = async () => {
    if (!challenge) return;
    setBusy(true);
    setProblem(null);
    try {
      await auth.answerChallenge(challenge, totp.trim());
      setChallenge(null);
    } catch {
      setProblem('That code did not work. Check your authenticator and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>Sign in</h1>
      <p className="standfirst">You need to be signed in to {what}.</p>

      {challenge ? (
        <div className="field">
          <span className="label">Code from your authenticator</span>
          <input inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} />
          <span className="hint">Your account has a second factor. Client data stays closed until it is answered.</span>
          <p className="actions">
            <button className="btn" type="button" disabled={busy || totp.trim() === ''} onClick={() => void answer()}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </p>
        </div>
      ) : linked ? (
        <div className="callout">
          <span className="c-title">Check your email</span>
          <p>The link signs you in on this device. It expires, and it only works once.</p>
          <p className="actions">
            <button className="btn ghost" type="button" onClick={() => setLinked(false)}>
              Use a different address
            </button>
          </p>
        </div>
      ) : !sent ? (
        <div className="field">
          <span className="label">Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="actions">
            <button className="btn" type="button" disabled={busy || email.trim() === ''} onClick={() => void send()}>
              {busy ? 'Sending…' : auth.provider === 'identity-platform' ? 'Send a link' : 'Send a code'}
            </button>
          </p>
        </div>
      ) : (
        <div className="field">
          <span className="label">The code from your email</span>
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          <p className="actions">
            <button className="btn" type="button" disabled={busy || code.trim() === ''} onClick={() => void verify()}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button className="btn ghost" type="button" onClick={() => setSent(false)}>
              Use a different address
            </button>
          </p>
        </div>
      )}

      {problem ? <p className="warn">{problem}</p> : null}
    </main>
  );
}
