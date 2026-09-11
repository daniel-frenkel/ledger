/**
 * The Supabase client itself, and nothing else.
 *
 * Supabase is the development and CI provider; production is Identity Platform
 * (go-live gate A2). What used to live here — `sendOtp`, `verifyOtp`,
 * `accessToken`, `API_URL` — moved to `./client`, which picks a provider and
 * presents one interface to the rest of the app. This file is now only the
 * construction of the library's client, imported by that one.
 *
 * The session lives in memory plus the library's own default storage. We never
 * write tokens to localStorage ourselves for this provider: the one copy is
 * the library's, so there is a single thing to clear on sign-out and nothing
 * of ours to leak. The anon key is public by design; RLS on the server is what
 * protects data.
 */
import { createClient } from '@supabase/supabase-js';

const env = import.meta.env;

export const SUPABASE_URL: string = env.VITE_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY: string = env.VITE_SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'anon', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    // No OAuth redirect flow here; email OTP never puts a token in the URL.
    detectSessionInUrl: false,
  },
});
