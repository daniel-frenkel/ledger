'use client';

/**
 * Signing in, behind one interface, with two providers under it.
 *
 * The same seam as `apps/web/src/auth/client.ts` and for the same reason:
 * Prompt 11 moves production to Identity Platform and keeps Supabase for local
 * development and CI, and the requirement is that only the environment differs.
 * The wire protocol for Identity Platform lives once, in `@ledger/shared`, so
 * the two apps cannot drift on how a token is obtained or refreshed.
 *
 * This one carries a second factor as well. Go-live gate B2 requires a
 * clinician to prove two before they can invite anyone or read a client's
 * rows, and the API enforces that by reading the token's own claim — so
 * everything here produces such a token and none of it is trusted by itself.
 */
import {
  completeSignIn,
  finalizeMfaSignIn,
  finalizeTotpEnrollment,
  isExpired,
  refresh,
  sendSignInLink,
  startTotpEnrollment,
  type IdentityPlatformConfig,
  type MfaChallenge,
  type TokenSet,
  type TotpEnrollment,
} from '@ledger/shared';
import { createClient, type Session } from '@supabase/supabase-js';

const env = process.env;

export const API_URL = env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8080';
/** Where the client app lives, for the invite URL. */
export const WEB_URL = env['NEXT_PUBLIC_WEB_URL'] ?? 'http://localhost:5173';

const PROVIDER = (env['NEXT_PUBLIC_AUTH_PROVIDER'] ?? 'supabase') as 'supabase' | 'identity-platform';
const SUPABASE_URL = env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
const SUPABASE_ANON_KEY = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';
const IP_API_KEY = env['NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY'] ?? '';

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'anon', {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

export type SecondStep = 'code' | 'link';

/** What enrolment needs to show: a secret to scan, and a handle to confirm with. */
export interface TotpStart {
  /** `otpauth://` for a QR code, or the Supabase-supplied SVG. */
  uri: string;
  /** Opaque; hand it back to `confirmTotp`. */
  handle: string;
  /** Base32, for typing in by hand when a camera is not available. */
  secret?: string;
}

export interface ClinicianAuth {
  readonly provider: 'supabase' | 'identity-platform';
  isConfigured(): boolean;
  begin(email: string): Promise<SecondStep>;
  /** Supabase only: the emailed six-digit code. */
  completeWithCode?(email: string, code: string): Promise<MfaChallenge | null>;
  accessToken(): Promise<string | null>;
  signOut(): Promise<void>;
  subscribe(cb: () => void): () => void;
  signedIn(): boolean;

  /** Second factor, enrolment. */
  startTotp(accountName: string): Promise<TotpStart>;
  confirmTotp(handle: string, code: string): Promise<void>;
  /** Second factor, at sign-in, answering a challenge from `begin`/`complete`. */
  answerChallenge(challenge: MfaChallenge, code: string): Promise<void>;
}

// --- Supabase ----------------------------------------------------------------

class SupabaseAuth implements ClinicianAuth {
  readonly provider = 'supabase' as const;
  private session: Session | null = null;

  constructor() {
    void supabase.auth.getSession().then(({ data }) => {
      this.session = data.session;
    });
  }

  isConfigured(): boolean {
    return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
  }

  async begin(email: string): Promise<SecondStep> {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw error;
    return 'code';
  }

  /**
   * Supabase steps up in place rather than handing back a pending credential:
   * the OTP produces an aal1 session and the factor is then verified against
   * it. So there is never a challenge to return here.
   */
  async completeWithCode(email: string, code: string): Promise<MfaChallenge | null> {
    const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error || !data.session) throw error ?? new Error('no session');
    this.session = data.session;
    return null;
  }

  async accessToken(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
    this.session = null;
  }

  subscribe(cb: () => void): () => void {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      this.session = s;
      cb();
    });
    return () => data.subscription.unsubscribe();
  }

  signedIn(): boolean {
    return !!this.session;
  }

  async startTotp(): Promise<TotpStart> {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (error || !data) throw error ?? new Error('enroll failed');
    return { uri: data.totp.qr_code, handle: data.id, secret: data.totp.secret };
  }

  async confirmTotp(handle: string, code: string): Promise<void> {
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: handle });
    if (chErr || !ch) throw chErr ?? new Error('challenge failed');
    const { error } = await supabase.auth.mfa.verify({ factorId: handle, challengeId: ch.id, code: code.trim() });
    if (error) throw error;
  }

  async answerChallenge(): Promise<void> {
    // Unreachable: `completeWithCode` never returns a challenge for Supabase.
    throw new Error('no pending challenge');
  }
}

// --- Identity Platform -------------------------------------------------------

const STORE_KEY = 'cl.clinician.session';
const PENDING_EMAIL_KEY = 'cl.clinician.pendingEmail';

function readStored(): TokenSet | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as TokenSet;
    return t.refreshToken && t.userId ? t : null;
  } catch {
    return null;
  }
}

class IdentityPlatformAuth implements ClinicianAuth {
  readonly provider = 'identity-platform' as const;
  private tokens: TokenSet | null = null;
  private listeners = new Set<() => void>();
  private refreshing: Promise<TokenSet> | null = null;
  /** Set at enrolment start, because `confirmTotp` needs the id token too. */
  private enrolment: TotpEnrollment | null = null;

  constructor(private readonly cfg: IdentityPlatformConfig) {
    // Next.js renders this module on the server first, where there is no
    // localStorage; reading it lazily keeps that from throwing at import.
    if (typeof window !== 'undefined') this.tokens = readStored();
  }

  isConfigured(): boolean {
    return !!this.cfg.apiKey;
  }

  private set(tokens: TokenSet | null): void {
    this.tokens = tokens;
    try {
      if (tokens) localStorage.setItem(STORE_KEY, JSON.stringify(tokens));
      else localStorage.removeItem(STORE_KEY);
    } catch {
      /* private mode: the session lives for this tab only */
    }
    for (const cb of this.listeners) cb();
  }

  async begin(email: string): Promise<SecondStep> {
    await sendSignInLink(this.cfg, email);
    try {
      sessionStorage.setItem(PENDING_EMAIL_KEY, email);
    } catch {
      /* the callback page asks instead */
    }
    return 'link';
  }

  /** Called by /auth/callback. Returns a challenge when a second factor is enrolled. */
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

  async answerChallenge(challenge: MfaChallenge, code: string): Promise<void> {
    const first = challenge.factors[0];
    if (!first) throw new Error('no enrolled factor');
    this.set(await finalizeMfaSignIn(this.cfg, challenge, first.enrollmentId, code.trim()));
  }

  async accessToken(): Promise<string | null> {
    const t = this.tokens;
    if (!t) return null;
    if (!isExpired(t)) return t.idToken;
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
      this.set(null);
      return null;
    }
  }

  async signOut(): Promise<void> {
    this.set(null);
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

  async startTotp(accountName: string): Promise<TotpStart> {
    const token = await this.accessToken();
    if (!token) throw new Error('not signed in');
    this.enrolment = await startTotpEnrollment(this.cfg, token, accountName);
    return {
      uri: this.enrolment.uri,
      handle: this.enrolment.sessionInfo,
      secret: this.enrolment.sharedSecretKey,
    };
  }

  async confirmTotp(handle: string, code: string): Promise<void> {
    const token = await this.accessToken();
    if (!token) throw new Error('not signed in');
    await finalizeTotpEnrollment(this.cfg, token, handle, code.trim());
    // The token in hand still says one factor. Identity Platform issues the
    // aal2 claim at sign-in, not at enrolment, so the session has to be renewed
    // before the API will accept it — and the honest way to renew it is to sign
    // in again, which is what the enrolment screen then asks for.
    this.enrolment = null;
  }
}

// --- the one this build uses -------------------------------------------------

function build(): ClinicianAuth {
  if (PROVIDER === 'identity-platform') {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return new IdentityPlatformAuth({
      apiKey: IP_API_KEY,
      continueUrl: `${env['NEXT_PUBLIC_CLINICIAN_URL'] ?? origin}/auth/callback`,
    });
  }
  return new SupabaseAuth();
}

export const auth: ClinicianAuth = build();

export const identityPlatform = (): IdentityPlatformAuth | null =>
  auth instanceof IdentityPlatformAuth ? auth : null;

export const isConfigured = (): boolean => auth.isConfigured();
