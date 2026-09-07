/**
 * Supabase Auth client. Email OTP only — no passwords on the phone. The
 * session lives in SecureStore (Keychain / Keystore), never AsyncStorage.
 * The anon key is public by design; RLS on the server is what protects data.
 */
import 'react-native-url-polyfill/auto';
import { createClient, type Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseAnonKey?: string; apiUrl?: string };

export const API_URL: string = extra.apiUrl ?? 'http://localhost:8080';

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(extra.supabaseUrl ?? 'http://localhost', extra.supabaseAnonKey ?? 'anon', {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const isConfigured = (): boolean => !!extra.supabaseUrl && !!extra.supabaseAnonKey;

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
