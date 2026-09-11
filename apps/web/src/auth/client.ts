/**
 * Signing in, behind one interface, with two providers under it.
 *
 * Prompt 11 moves production to Identity Platform and keeps Supabase for local
 * development and CI. The requirement is that the *code path* is identical and
 * only the environment differs — so this is a seam with two implementations,
 * the same shape as `AuthAdmin` on the server, and not a replacement.
 *
 * The two providers deliver the second step differently and the screen has to
 * know which: Supabase emails a six-digit code you type back, Identity Platform
 * emails a link you follow. `begin()` says which happened, and that is the only
 * provider-shaped thing that reaches the UI.
 *
 * **Where the session rests.** Supabase keeps its own; for Identity Platform we
 * keep it, and it goes in `localStorage`. That is a real exposure and worth
 * naming: a refresh token is the one credential here worth stealing, and the
 * browser profile is what protects it — the same protection the IndexedDB
 * entries already rely on (docs/data-path.md hop 1a). Session storage would be
 * safer and would sign the client out every time they close the tab, which for
 * an app people open once a day is a worse trade than the one being made.
 */
import {
  completeSignIn,
  isExpired,
  refresh,
  sendSignInLink,
  type IdentityPlatformConfig,
  type MfaChallenge,
  type TokenSet,
} from '@ledger/shared';
import { supabase } from './supabase';

const env = import.meta.env;

export type SecondStep = 'code' | 'link';

export interface AuthClient {
  readonly provider: 'supabase' | 'identity-platform';
  isConfigured(): boolean;
  /** Start a sign-in. Says how the second step will reach the user. */
  begin(email: string): Promise<SecondStep>;
  /** Finish a 'code' sign-in. Providers that email a link do not implement it. */
  completeWithCode?(email: string, code: string): Promise<void>;
  /** A valid access token, refreshed if it is due. Null when signed out. */
  accessToken(): Promise<string | null>;
  signOut(): Promise<void>;
  /** Called whenever the signed-in state changes. Returns an unsubscribe. */
  subscribe(cb: () => void): () => void;
  signedIn(): boolean;
  /**
   * The address this session signed in with, shown back on Settings.
   *
   * It is never stored in the application database and never leaves the
   * device — this reads it from the session the provider already holds, so
   * that the Settings line is the same either way.
   */
  email(): string | null;
}

// --- Supabase ----------------------------------------------------------------

class SupabaseClient implements AuthClient {
  readonly provider = 'supabase' as const;
  private hasSession = false;
  private address: string | null = null;

  constructor(
    private readonly url: string,
    private readonly anonKey: string,
  ) {
    void supabase.auth.getSession().then(({ data }) => {
      this.hasSession = !!data.session;
      this.address = data.session?.user.email ?? null;
    });
  }

  email(): string | null {
    return this.address;
  }

  isConfigured(): boolean {
    return !!this.url && !!this.anonKey;
  }

  async begin(email: string): Promise<SecondStep> {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw error;
    return 'code';
  }

  async completeWithCode(email: string, code: string): Promise<void> {
    const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error || !data.session) throw error ?? new Error('no session');
    this.hasSession = true;
    this.address = data.session.user.email ?? null;
  }

  async accessToken(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
    this.hasSession = false;
  }

  subscribe(cb: () => void): () => void {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      this.hasSession = !!s;
      this.address = s?.user.email ?? null;
      cb();
    });
    return () => data.subscription.unsubscribe();
  }

  signedIn(): boolean {
    return this.hasSession;
  }
}

// --- Identity Platform -------------------------------------------------------

const STORE_KEY = 'cl.session';
/** Remembered between sending the link and following it, on this device only. */
const PENDING_EMAIL_KEY = 'cl.pendingEmail';

function readStored(): TokenSet | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as TokenSet;
    return t.refreshToken && t.userId ? t : null;
  } catch {
    // A corrupt or unreadable store is signed-out, not an error to show anyone.
    return null;
  }
}

class IdentityPlatformClient implements AuthClient {
  readonly provider = 'identity-platform' as const;
  private tokens: TokenSet | null = readStored();
  private listeners = new Set<() => void>();
  /** In flight, so two simultaneous requests do not both refresh. */
  private refreshing: Promise<TokenSet> | null = null;

  constructor(private readonly cfg: IdentityPlatformConfig) {}

  isConfigured(): boolean {
    return !!this.cfg.apiKey;
  }

  private set(tokens: TokenSet | null): void {
    this.tokens = tokens;
    try {
      if (tokens) localStorage.setItem(STORE_KEY, JSON.stringify(tokens));
      else localStorage.removeItem(STORE_KEY);
    } catch {
      // Private mode, or storage disabled. The session still works for this
      // tab; it simply will not survive a reload.
    }
    for (const cb of this.listeners) cb();
  }

  async begin(email: string): Promise<SecondStep> {
    await sendSignInLink(this.cfg, email);
    try {
      sessionStorage.setItem(PENDING_EMAIL_KEY, email);
    } catch {
      // The callback screen asks for the address instead.
    }
    return 'link';
  }

  /** The other half of `begin`, called by the /auth/callback screen. */
  async completeFromLink(email: string, oobCode: string): Promise<MfaChallenge | null> {
    const result = await completeSignIn(this.cfg, email, oobCode);
    if (result.kind === 'mfa') return result.challenge;
    this.set(result.tokens);
    try {
      sessionStorage.removeItem(PENDING_EMAIL_KEY);
    } catch {
      /* nothing to clear */
    }
    return null;
  }

  /** Used after a second factor is answered. */
  adopt(tokens: TokenSet): void {
    this.set(tokens);
  }

  async accessToken(): Promise<string | null> {
    const t = this.tokens;
    if (!t) return null;
    if (!isExpired(t)) return t.idToken;
    // One refresh at a time: a screen that fires three requests at once should
    // not spend three refresh tokens, and Identity Platform rotates them.
    this.refreshing ??= refresh(this.cfg, t.refreshToken)
      .then((fresh) => {
        this.set(fresh);
        return fresh;
      })
      .finally(() => {
        this.refreshing = null;
      });
    try {
      return (await this.refreshing).idToken;
    } catch {
      // A refresh token that no longer works means signed out, which is a
      // state and not an error.
      this.set(null);
      return null;
    }
  }

  async signOut(): Promise<void> {
    this.set(null);
  }

  /**
   * The `email` claim of the current id token.
   *
   * Read without verifying: this is the user's own token, shown back to the
   * user on their own device, so the only thing a forged one could do is
   * mislabel their own Settings screen. Anything that matters is checked by
   * the API against the signature.
   */
  email(): string | null {
    const t = this.tokens;
    if (!t) return null;
    try {
      const payload = t.idToken.split('.')[1];
      if (!payload) return null;
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      const claims = JSON.parse(json) as { email?: unknown };
      return typeof claims.email === 'string' ? claims.email : null;
    } catch {
      return null;
    }
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  signedIn(): boolean {
    return !!this.tokens;
  }
}

// --- the one this build uses -------------------------------------------------

export const API_URL: string = env.VITE_API_URL ?? env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';

const PROVIDER = (env.VITE_AUTH_PROVIDER ?? env.EXPO_PUBLIC_AUTH_PROVIDER ?? 'supabase') as AuthClient['provider'];

function build(): AuthClient {
  if (PROVIDER === 'identity-platform') {
    return new IdentityPlatformClient({
      apiKey: env.VITE_IDENTITY_PLATFORM_API_KEY ?? env.EXPO_PUBLIC_IDENTITY_PLATFORM_API_KEY ?? '',
      // Where the emailed link lands. Must be an authorised domain on the
      // project, which is what stops a stolen link being redirected.
      continueUrl: `${env.VITE_WEB_URL ?? window.location.origin}/auth/callback`,
    });
  }
  return new SupabaseClient(
    env.VITE_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    env.VITE_SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  );
}

export const auth: AuthClient = build();

/** Narrowed accessor for the callback screen, which only exists for this provider. */
export const identityPlatform = (): IdentityPlatformClient | null =>
  auth instanceof IdentityPlatformClient ? auth : null;

export const isConfigured = (): boolean => auth.isConfigured();
export const accessToken = (): Promise<string | null> => auth.accessToken();
