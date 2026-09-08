/**
 * Supabase Auth client. Email OTP only — no passwords.
 *
 * The session lives in memory plus the library's own default storage. We never
 * write tokens to localStorage ourselves: the one copy is the library's, so
 * there is a single thing to clear on sign-out and nothing of ours to leak.
 * The anon key is public by design; RLS on the server is what protects data.
 */
import { createClient, type Session } from '@supabase/supabase-js';

const env = import.meta.env;

/** VITE_* first, EXPO_PUBLIC_* as the fallback, so one root .env feeds both clients. */
export const API_URL: string = env.VITE_API_URL ?? env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';
const SUPABASE_URL: string = env.VITE_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY: string = env.VITE_SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'anon', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    // No OAuth redirect flow here; email OTP never puts a token in the URL.
    detectSessionInUrl: false,
  },
});

export const isConfigured = (): boolean => !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

export async function sendOtp(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyOtp(email: string, token: string): Promise<Session> {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error || !data.session) throw error ?? new Error('no session');
  return data.session;
}

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
