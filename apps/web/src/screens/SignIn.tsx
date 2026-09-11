import React, { useState } from 'react';
import { FRAMING } from '@ledger/shared';
import { isConfigured, sendOtp, verifyOtp } from '@/auth/supabase';
import { Button, Field, H1, P, Screen, Small } from '@/ui';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      await sendOtp(email.trim());
      setSent(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setErr(null);
    try {
      await verifyOtp(email.trim(), code.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>CourageLoop</H1>
      <P muted>{FRAMING.tagline}</P>
      <P>{FRAMING.notATherapist}</P>
      {!isConfigured() ? <P muted>Sign-in isn’t configured in this build (missing Supabase settings). See .env.example.</P> : null}
      {!sent ? (
        <>
          <Field label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChangeText={setEmail} placeholder="you@example.com" />
          <Button title="Send me a code" onPress={send} disabled={busy || !email.includes('@')} />
        </>
      ) : (
        <>
          <Field label="Code from your email" inputMode="numeric" autoComplete="one-time-code" value={code} onChangeText={setCode} placeholder="123456" />
          <Button title="Sign in" onPress={verify} disabled={busy || code.length < 6} />
          <Button title="Use a different email" kind="link" onPress={() => setSent(false)} />
        </>
      )}
      {err ? <P danger>{err}</P> : null}
      <Small>No password. Your email is held by the sign-in service; the ledger itself stores only an anonymous id.</Small>
    </Screen>
  );
}
