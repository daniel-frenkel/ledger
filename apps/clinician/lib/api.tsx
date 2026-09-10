'use client';

/**
 * The clinician app's session and its one way of calling the API.
 *
 * Same shape as apps/web: Supabase email OTP, no passwords, and the session
 * lives in the library's own storage rather than anything of ours — one thing
 * to clear on sign-out and nothing of ours to leak. The anon key is public by
 * design; RLS is what protects data.
 *
 * Nothing in the Library imports this. Those pages are reference material with
 * no client data on them, and they stay prerendered and signed-out.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';

const env = process.env;

export const API_URL = env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8080';
/** Where the client app lives, for the invite URL. */
export const WEB_URL = env['NEXT_PUBLIC_WEB_URL'] ?? 'http://localhost:5173';

const SUPABASE_URL = env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
const SUPABASE_ANON_KEY = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'anon', {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

export const isConfigured = (): boolean => !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

interface SessionState {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState>({ session: null, loading: true, signOut: async () => {} });

export function ClinicianSession({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, loading, signOut }), [session, loading, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useClinicianSession = () => useContext(Ctx);

export async function sendOtp(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyOtp(email: string, token: string): Promise<Session> {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error || !data.session) throw error ?? new Error('no session');
  return data.session;
}

/**
 * The URL a client opens to accept an invitation.
 *
 * The token goes in the fragment. Browsers do not send a fragment to a server,
 * so it stays out of access logs, referrer headers and proxies on the way —
 * which is the whole reason the invite is shaped this way, and the reason the
 * link has to be sent whole rather than rebuilt from its parts.
 */
export const inviteUrl = (webUrl: string, token: string): string =>
  `${webUrl.replace(/\/+$/, '')}/join#${token}`;

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
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
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
