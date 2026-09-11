'use client';

/**
 * The two things a clinician does once, before they can invite anyone.
 *
 * Go-live gate B2 (a second factor) and A1 (the business associate
 * agreement). The API refuses `POST /v1/invites` and every read of client data
 * without both, with a code this page reads back — so the gate is enforced
 * server-side and explained here, rather than enforced here and hoped for
 * there.
 *
 * Enrolment talks to the identity provider rather than to our API, which is
 * unavoidable — it is the provider that holds the factor. Since Prompt 11 it
 * goes through the seam in lib/auth.ts, so this screen no longer names a
 * provider. The *check* was already behind packages/api/src/auth-admin.ts and
 * never moved.
 */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, api, auth, useClinicianSession } from '@/lib/api';
import { SignIn } from '@/app/sign-in';

interface Me {
  role: string;
  mfa: boolean;
  baa: { current: string; accepted: string | null };
}

export function SetupClient({ version, draft, body }: { version: string; draft: boolean; body: string }) {
  const { session, loading } = useClinicianSession();
  const [me, setMe] = useState<Me | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // --- MFA ------------------------------------------------------------------
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [reSignIn, setReSignIn] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/v1/me'));
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    if (session) void refresh();
  }, [session, refresh]);

  const enroll = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const started = await auth.startTotp('clinician');
      setFactorId(started.handle);
      setQr(started.uri);
      setSecret(started.secret ?? null);
    } catch {
      setProblem('Could not start enrollment. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!factorId) return;
    setBusy(true);
    setProblem(null);
    try {
      await auth.confirmTotp(factorId, code);
      setQr(null);
      setSecret(null);
      setCode('');
      // Supabase steps the current session up to aal2 in place. Identity
      // Platform mints the claim at sign-in, so the token in hand still says
      // one factor and the API will still refuse client data until the next
      // sign-in. Say so rather than letting the next screen fail.
      if (auth.provider === 'identity-platform') setReSignIn(true);
      await refresh();
    } catch {
      setProblem('That code did not work. Check your authenticator and try again.');
    } finally {
      setBusy(false);
    }
  };

  // --- BAA ------------------------------------------------------------------
  const accept = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api('/v1/me/baa', { method: 'POST', body: JSON.stringify({ version }) });
      await refresh();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main><p className="meta">Checking your session…</p></main>;
  if (!session) return <SignIn what="set up your account" />;

  const mfaDone = me?.mfa === true;
  const baaDone = !!me?.baa.accepted && me.baa.accepted === version;

  return (
    <main>
      <h1>Before your first client</h1>
      <p className="standfirst">
        Two things, once. The API refuses to create an invitation or show you a client&rsquo;s record until both are
        done — not as a formality, but because neither is something to do afterwards.
      </p>

      <h2>{mfaDone ? '✓ ' : ''}Two-factor authentication</h2>
      {reSignIn ? (
        <div className="callout warning">
          <span className="c-title">Enrolled — sign in once more</span>
          <p>
            Your current session still proves one factor. Sign out and back in, and the new one will carry both.
          </p>
        </div>
      ) : null}

      {mfaDone ? (
        <p className="meta">Enrolled. Your sign-in now proves two factors.</p>
      ) : (
        <>
          <p>
            An emailed code is one factor. An account that can read other people&rsquo;s clinical records needs two.
            Use any authenticator app.
          </p>
          {!qr ? (
            <p className="actions">
              <button className="btn" type="button" onClick={() => void enroll()} disabled={busy}>
                {busy ? 'Starting…' : 'Set up two-factor'}
              </button>
            </p>
          ) : (
            <>
              {qr.startsWith('data:') ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={qr} alt="Scan this with your authenticator app" width={200} height={200} />
              ) : (
                /*
                 * Identity Platform hands back an otpauth:// URI rather than a
                 * rendered code. Drawing it as a QR would mean a QR library,
                 * and this app does not add a dependency for one screen a
                 * clinician sees once — so the secret is typed in, and the
                 * link opens an authenticator directly on a phone.
                 */
                <div className="callout">
                  <span className="c-title">Add this to your authenticator</span>
                  <p className="tokenbox">
                    <code>{secret}</code>
                  </p>
                  <p className="meta">
                    On a phone, <a href={qr}>open it in your authenticator</a>. Otherwise type the key in by hand.
                  </p>
                </div>
              )}
              <div className="field">
                <span className="label">The six-digit code from the app</span>
                <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <p className="actions">
                <button className="btn" type="button" onClick={() => void verify()} disabled={busy || code.trim() === ''}>
                  {busy ? 'Checking…' : 'Confirm'}
                </button>
              </p>
            </>
          )}
        </>
      )}

      <h2>{baaDone ? '✓ ' : ''}Business associate agreement</h2>
      {baaDone ? (
        <p className="meta">Accepted, version {me?.baa.accepted}.</p>
      ) : (
        <>
          {draft ? (
            <div className="callout warning">
              <span className="c-title">This is a placeholder, not an agreement</span>
              <p>
                No lawyer has seen this text and nobody should accept it as a contract. It exists so the flow can be
                built and tested before counsel&rsquo;s template arrives. Accepting it records a version string and
                nothing more.
              </p>
            </div>
          ) : null}
          <div className="baa">
            <pre>{body}</pre>
          </div>
          <p className="meta">Version {version}.</p>
          <p className="actions">
            <button className="btn" type="button" onClick={() => void accept()} disabled={busy || !mfaDone}>
              {busy ? 'Recording…' : 'I accept this agreement'}
            </button>
          </p>
          {!mfaDone ? <p className="meta">Set up two-factor first.</p> : null}
        </>
      )}

      {problem ? <p className="warn">{problem}</p> : null}

      {mfaDone && baaDone ? (
        <p className="foot">
          Both done. <Link href="/invites">Invite a client</Link>.
        </p>
      ) : null}
    </main>
  );
}
