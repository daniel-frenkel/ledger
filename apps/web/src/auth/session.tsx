/**
 * Whether anyone is signed in, for the rest of the app.
 *
 * It used to hold a Supabase `Session` object, which meant every screen that
 * asked "is someone signed in" was coupled to that provider's shape. It now
 * holds a boolean and a user id: the only two things any screen actually used,
 * and the two things both providers can answer.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { auth } from './client';
import { wipeAll } from '@/db';

interface SessionState {
  /** Kept as an object rather than a boolean so `session ? …` reads as before. */
  session: { signedIn: true } | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState>({ session: null, loading: true, signOut: async () => {} });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    // Ask once for the current state: a stored session is already in memory for
    // Identity Platform, and a round trip for Supabase.
    void auth.accessToken().then((t) => {
      if (!alive) return;
      setSignedIn(!!t);
      setLoading(false);
    });
    const unsubscribe = auth.subscribe(() => {
      if (alive) setSignedIn(auth.signedIn());
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await auth.signOut();
    await wipeAll(); // IndexedDB holds plaintext entries; it leaves with the account
    setSignedIn(false);
  }, []);

  return (
    <Ctx.Provider value={{ session: signedIn ? { signedIn: true } : null, loading, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);
