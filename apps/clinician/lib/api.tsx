'use client';

/**
 * The clinician app's session and its one way of calling the API.
 *
 * Same shape as apps/web: email, no passwords, and one provider chosen from
 * the environment — Supabase for local and CI, Identity Platform in
 * production. The seam is in ./auth; this file is the React context over it
 * and the one way the app calls the API.
 *
 * Nothing in the Library imports this. Those pages are reference material with
 * no client data on them, and they stay prerendered and signed-out.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { API_URL, auth, isConfigured } from './auth';

export { API_URL, WEB_URL, auth, identityPlatform, isConfigured, supabase } from './auth';

interface SessionState {
  /** A boolean in an object, so `session ? …` reads as it did. */
  session: { signedIn: true } | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState>({ session: null, loading: true, signOut: async () => {} });

export function ClinicianSession({ children }: { children: React.ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
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
    setSignedIn(false);
  }, []);

  const value = useMemo(
    () => ({ session: signedIn ? ({ signedIn: true } as const) : null, loading, signOut }),
    [signedIn, loading, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useClinicianSession = () => useContext(Ctx);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The server's message. Never a value — the API sends field names only. */
    override readonly message: string,
    readonly fields: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * One fetch, one place. Notes and falsify lines go through here, so: never
 * cached, never retried blind, and the error carries the server's own message
 * rather than anything constructed from the request body.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await auth.accessToken();
  if (!token) throw new ApiError(401, 'Not signed in.');

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    let fields: string[] = [];
    try {
      const body = (await res.json()) as { error?: string; fields?: string[]; unknown?: string[] };
      if (body.error) message = body.error;
      fields = body.fields ?? body.unknown ?? [];
    } catch {
      // A body that is not JSON tells us nothing worth showing.
    }
    throw new ApiError(res.status, message, fields);
  }
  return (await res.json()) as T;
}
