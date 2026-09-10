'use client';

/**
 * Signing in, for the pages that touch client data.
 *
 * Email OTP, no passwords — the same as the client app, and the same Supabase
 * project. The Library does not use this: those pages are reference material
 * with no client data on them and stay signed-out and prerendered.
 */
import React, { useState } from 'react';
import { isConfigured, sendOtp, verifyOtp } from '@/lib/api';

export function SignIn({ what = 'continue' }: { what?: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!isConfigured()) {
    return (
      <main>
        <h1>Sign in</h1>
        <div className="callout warning">
          <span className="c-title">Not configured</span>
          <p>
            NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set, so there is nothing to sign in to.
          </p>
        </div>
      </main>
    );
  }

  const send = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await sendOtp(email.trim());
      setSent(true);
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
      await verifyOtp(email.trim(), code.trim());
    } catch {
      setProblem('That code did not work. Ask for another.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>Sign in</h1>
      <p className="standfirst">You need to be signed in to {what}.</p>

      {!sent ? (
        <div className="field">
          <span className="label">Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="actions">
            <button className="btn" type="button" disabled={busy || email.trim() === ''} onClick={() => void send()}>
              {busy ? 'Sending…' : 'Send a code'}
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
