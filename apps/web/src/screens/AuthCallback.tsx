/**
 * /auth/callback — where the emailed sign-in link lands.
 *
 * The link carries one thing: a single-use `oobCode`. It is not a session and
 * it is not a token — on its own it signs nobody in, because finishing the
 * sign-in also requires the email address it was issued for. That is the
 * property that makes it safe for this URL to be public: someone who
 * intercepts the link still has to know whose it is.
 *
 * The address is remembered in `sessionStorage` when the link is sent, so the
 * usual path is invisible. It is gone whenever the link is opened on a
 * different device or a new tab — which is common and not an error — and then
 * the screen asks for it, which is the same check by another route.
 *
 * The code is read once on mount and then stripped from the URL, so it does
 * not sit in the address bar, in history, or in a referrer header on the next
 * navigation.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { identityPlatform } from '@/auth/client';
import { Button, Card, Field, H1, P, Screen, Small } from '@/ui';

const PENDING_EMAIL_KEY = 'cl.pendingEmail';

/** Every failure gets this. The differences between them help nobody here. */
export const CALLBACK_FAILED = 'That sign-in link didn’t work. Ask for another from the sign-in screen.';

function takeCodeFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('oobCode');
  if (code) {
    // Strip it before anything else can navigate or report a referrer.
    const clean = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState(null, '', clean);
  }
  return code;
}

function rememberedEmail(): string {
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const client = identityPlatform();

  // Read once, before any render decision: the query string is only there on
  // the first load, exactly as the invite token is on /join.
  const [code] = useState<string | null>(() => takeCodeFromUrl());
  const [email, setEmail] = useState(() => rememberedEmail());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);
  const attempted = useRef(false);

  const finish = React.useCallback(
    async (address: string) => {
      if (!client || !code) return;
      setBusy(true);
      setFailed(false);
      try {
        const challenge = await client.completeFromLink(address, code);
        if (challenge) {
          // A second factor is enrolled. Clinicians only, and the enrolment
          // screen is in the clinician app — a client app that reaches here
          // has nothing to show, so it says so rather than pretending.
          setNeedsMfa(true);
          return;
        }
        navigate('/', { replace: true });
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [client, code, navigate],
  );

  // The usual path: the address was remembered, so finish without asking.
  useEffect(() => {
    if (attempted.current || !code || !email) return;
    attempted.current = true;
    void finish(email);
  }, [code, email, finish]);

  if (!client) {
    return (
      <Screen>
        <H1>Signing in</H1>
        <Card loud>
          <P>This build doesn’t use email links.</P>
        </Card>
      </Screen>
    );
  }

  if (!code) {
    return (
      <Screen>
        <H1>Signing in</H1>
        <Card loud>
          <P>{CALLBACK_FAILED}</P>
        </Card>
      </Screen>
    );
  }

  if (needsMfa) {
    return (
      <Screen>
        <H1>One more step</H1>
        <Card>
          <P>This account has a second factor. Sign in from the clinician app, which can ask for it.</P>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <H1>Signing in</H1>
      {busy ? <P muted>One moment…</P> : null}

      {/* Opened on another device, or in a new tab: ask for the address. */}
      {!busy && !email ? (
        <>
          <P>Confirm the email this link was sent to.</P>
          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
          />
          <Button title="Sign in" onPress={() => void finish(email.trim())} disabled={!email.includes('@')} />
          <Small>The link alone isn’t enough on purpose.</Small>
        </>
      ) : null}

      {failed ? (
        <Card loud>
          <P>{CALLBACK_FAILED}</P>
        </Card>
      ) : null}
    </Screen>
  );
}
