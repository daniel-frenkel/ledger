import React, { useState } from 'react';
import { FRAMING } from '@ledger/shared';
import { auth, isConfigured, type SecondStep } from '@/auth/client';
import { Button, Field, H1, P, Screen, Small } from '@/ui';

/**
 * Email, then whatever the provider sends back.
 *
 * Supabase emails a six-digit code you type in here; Identity Platform emails a
 * link you follow, which lands on /auth/callback. `begin()` reports which, so
 * this screen shows one of two second steps rather than knowing which provider
 * the build is configured for.
 */
export default function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<SecondStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      setStep(await auth.begin(email.trim()));
    } catch {
      // Whether an address has an account is not something this screen should
      // confirm, so every failure gets the same sentence.
      setErr('Could not send that. Check the address and try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setErr(null);
    try {
      await auth.completeWithCode?.(email.trim(), code.trim());
    } catch {
      setErr('That code did not work. Ask for another.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>CourageLoop</H1>
      <P muted>{FRAMING.tagline}</P>
      <P>{FRAMING.notATherapist}</P>
      {!isConfigured() ? <P muted>Sign-in isn’t configured in this build. See .env.example.</P> : null}

      {step === null ? (
        <>
          <Field label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChangeText={setEmail} placeholder="you@example.com" />
          <Button
            title={auth.provider === 'identity-platform' ? 'Send me a link' : 'Send me a code'}
            onPress={send}
            disabled={busy || !email.includes('@')}
          />
        </>
      ) : step === 'link' ? (
        <>
          <P>Check your email. The link signs you in on this device.</P>
          <Small>It expires, and it only works once. If it doesn’t arrive, ask for another.</Small>
          <Button title="Use a different email" kind="link" onPress={() => setStep(null)} />
        </>
      ) : (
        <>
          <Field label="Code from your email" inputMode="numeric" autoComplete="one-time-code" value={code} onChangeText={setCode} placeholder="123456" />
          <Button title="Sign in" onPress={verify} disabled={busy || code.length < 6} />
          <Button title="Use a different email" kind="link" onPress={() => setStep(null)} />
        </>
      )}

      {err ? <P danger>{err}</P> : null}
      <Small>No password. Your email is held by the sign-in service; the ledger itself stores only an anonymous id.</Small>
    </Screen>
  );
}
