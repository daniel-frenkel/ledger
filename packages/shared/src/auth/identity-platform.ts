/**
 * Google Cloud Identity Platform, spoken over REST.
 *
 * **Why this is in `shared`, which is otherwise pure.** Both clients have to
 * agree exactly on how a token is obtained, when it is refreshed, and what a
 * second factor means. Two copies of that would not stay identical, and the
 * way they would stop being identical is a security bug rather than a style
 * one — a refresh that is a minute late in one app and not the other, or an
 * MFA branch handled in the clinician app and forgotten in the client. So it
 * lives once, here. Raised as a design change at Prompt 11 and kept: the
 * placement is deliberate, not an oversight to tidy up later.
 *
 * It stays honest about the package's contract in two ways: it holds no state,
 * and it takes its `fetch`, so `shared`'s suite never opens a socket.
 *
 * **No SDK.** `firebase/auth` would do this, and would also be a new hosted
 * dependency in a repo whose standing rule is not to add one. Identity
 * Platform's REST surface is public and small, and the API side already
 * verifies its tokens with `jose` and a JWKS URL. Two fetches are a smaller
 * thing to own.
 *
 * **Storage is the caller's problem.** Nothing here writes to `localStorage`:
 * the PWA and the Next.js app keep sessions differently, and a refresh token
 * is the one credential in this system that is worth stealing, so where it
 * rests is a decision each app should make visibly rather than inherit.
 */

const IDENTITY = 'https://identitytoolkit.googleapis.com';
const SECURE_TOKEN = 'https://securetoken.googleapis.com';

export interface IdentityPlatformConfig {
  /** The browser API key. Public by design — it identifies the project, it does not authorise. */
  apiKey: string;
  /** Where the emailed link lands. Must be an authorised domain on the project. */
  continueUrl?: string;
  /** Injectable so tests never reach the network. */
  fetch?: typeof globalThis.fetch;
}

/** What a signed-in session consists of. `expiresAt` is absolute epoch ms. */
export interface TokenSet {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
}

/**
 * A sign-in that got as far as the first factor and stopped.
 *
 * Identity Platform answers the first factor with this instead of a token when
 * the account has a second factor enrolled. It is not a session: nothing here
 * authenticates anything until `finalizeMfaSignIn` returns.
 */
export interface MfaChallenge {
  pendingCredential: string;
  /** The enrolled factors. TOTP is the only kind this app enrols. */
  factors: { enrollmentId: string; displayName?: string }[];
}

export type SignInResult = { kind: 'session'; tokens: TokenSet } | { kind: 'mfa'; challenge: MfaChallenge };

/** The provider refused, or could not be reached. Never carries the response body. */
export class IdentityPlatformError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(`identity platform: ${code}`);
    this.name = 'IdentityPlatformError';
  }
}

interface RawTokens {
  idToken?: string;
  refreshToken?: string;
  expiresIn?: string;
  localId?: string;
  mfaPendingCredential?: string;
  mfaInfo?: { mfaEnrollmentId?: string; displayName?: string }[];
}

const now = (): number => Date.now();

/**
 * One request.
 *
 * Errors are reduced to Identity Platform's own error code — `EMAIL_NOT_FOUND`,
 * `INVALID_OOB_CODE` — and never the body, which echoes the request and so can
 * quote an email address. Callers turn the code into a sentence; nothing logs it.
 */
async function call<T>(cfg: IdentityPlatformConfig, url: string, body: unknown): Promise<T> {
  const f = cfg.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await f(`${url}?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (err) {
    throw new IdentityPlatformError(`unreachable (${(err as Error).name})`);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    const code = json.error?.message?.split(' ')[0] ?? `status_${res.status}`;
    throw new IdentityPlatformError(code, res.status);
  }
  return json as T;
}

function toTokenSet(raw: RawTokens): TokenSet {
  if (!raw.idToken || !raw.refreshToken || !raw.localId) {
    throw new IdentityPlatformError('incomplete_token_response');
  }
  // `expiresIn` is seconds, as a string. A minute is shaved off so a request
  // started just before expiry does not arrive just after it.
  const seconds = Number(raw.expiresIn ?? '3600');
  return {
    idToken: raw.idToken,
    refreshToken: raw.refreshToken,
    expiresAt: now() + Math.max(0, seconds - 60) * 1000,
    userId: raw.localId,
  };
}

/**
 * Send the sign-in link.
 *
 * Email-only, no password, which is what the client app has always done. The
 * link carries a single-use `oobCode` and nothing else; `continueUrl` is where
 * it lands, and Identity Platform refuses a domain that is not on the
 * project's authorised list, so a stolen link cannot be redirected.
 */
export async function sendSignInLink(cfg: IdentityPlatformConfig, email: string): Promise<void> {
  await call(cfg, `${IDENTITY}/v1/accounts:sendOobCode`, {
    requestType: 'EMAIL_SIGNIN',
    email,
    canHandleCodeInApp: true,
    ...(cfg.continueUrl ? { continueUrl: cfg.continueUrl } : {}),
  });
}

/**
 * Finish a sign-in from the code in the link.
 *
 * The email is required as well as the code, which is the property that makes
 * this flow safe to land on a public URL: someone who intercepts the link
 * still has to know whose it is.
 */
export async function completeSignIn(
  cfg: IdentityPlatformConfig,
  email: string,
  oobCode: string,
): Promise<SignInResult> {
  const raw = await call<RawTokens>(cfg, `${IDENTITY}/v1/accounts:signInWithEmailLink`, { email, oobCode });
  if (raw.mfaPendingCredential) {
    return {
      kind: 'mfa',
      challenge: {
        pendingCredential: raw.mfaPendingCredential,
        factors: (raw.mfaInfo ?? [])
          .filter((m) => !!m.mfaEnrollmentId)
          .map((m) => ({
            enrollmentId: m.mfaEnrollmentId as string,
            ...(m.displayName ? { displayName: m.displayName } : {}),
          })),
      },
    };
  }
  return { kind: 'session', tokens: toTokenSet(raw) };
}

/** Exchange a refresh token for a new id token. The refresh token may rotate. */
export async function refresh(cfg: IdentityPlatformConfig, refreshToken: string): Promise<TokenSet> {
  const f = cfg.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    // This one endpoint is form-encoded rather than JSON.
    res = await f(`${SECURE_TOKEN}/v1/token?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
      cache: 'no-store',
    });
  } catch (err) {
    throw new IdentityPlatformError(`unreachable (${(err as Error).name})`);
  }
  if (!res.ok) throw new IdentityPlatformError('refresh_failed', res.status);
  const body = (await res.json()) as { id_token?: string; refresh_token?: string; expires_in?: string; user_id?: string };
  return toTokenSet({
    ...(body.id_token !== undefined ? { idToken: body.id_token } : {}),
    ...(body.refresh_token !== undefined ? { refreshToken: body.refresh_token } : {}),
    ...(body.expires_in !== undefined ? { expiresIn: body.expires_in } : {}),
    ...(body.user_id !== undefined ? { localId: body.user_id } : {}),
  });
}

/** True when the set is close enough to expiry that it should be refreshed first. */
export const isExpired = (t: TokenSet, at: number = now()): boolean => t.expiresAt <= at;

// --- the second factor -------------------------------------------------------
//
// Go-live gate B2: a clinician must prove two factors before they can invite
// anyone or read a client's rows. The API enforces that by reading the token's
// own claim (`auth-admin.ts`), so nothing below is trusted by the server — this
// is only the enrolment and challenge dance that produces such a token.

export interface TotpEnrollment {
  sessionInfo: string;
  /** The base32 secret, for an authenticator app. */
  sharedSecretKey: string;
  /** `otpauth://` URI for a QR code, built by the caller if it wants one. */
  uri: string;
}

export async function startTotpEnrollment(
  cfg: IdentityPlatformConfig,
  idToken: string,
  accountName: string,
  issuer = 'CourageLoop',
): Promise<TotpEnrollment> {
  const raw = await call<{ totpSessionInfo?: { sharedSecretKey?: string; sessionInfo?: string } }>(
    cfg,
    `${IDENTITY}/v2/accounts/mfaEnrollment:start`,
    { idToken, totpEnrollmentInfo: {} },
  );
  const secret = raw.totpSessionInfo?.sharedSecretKey;
  const sessionInfo = raw.totpSessionInfo?.sessionInfo;
  if (!secret || !sessionInfo) throw new IdentityPlatformError('incomplete_totp_start');
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return {
    sessionInfo,
    sharedSecretKey: secret,
    uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`,
  };
}

export async function finalizeTotpEnrollment(
  cfg: IdentityPlatformConfig,
  idToken: string,
  sessionInfo: string,
  verificationCode: string,
  displayName = 'Authenticator app',
): Promise<void> {
  await call(cfg, `${IDENTITY}/v2/accounts/mfaEnrollment:finalize`, {
    idToken,
    displayName,
    totpVerificationInfo: { sessionInfo, verificationCode },
  });
}

/** Answer a challenge from `completeSignIn`, producing a real session. */
export async function finalizeMfaSignIn(
  cfg: IdentityPlatformConfig,
  challenge: MfaChallenge,
  enrollmentId: string,
  verificationCode: string,
): Promise<TokenSet> {
  const raw = await call<RawTokens>(cfg, `${IDENTITY}/v2/accounts/mfaSignIn:finalize`, {
    mfaPendingCredential: challenge.pendingCredential,
    mfaEnrollmentId: enrollmentId,
    totpVerificationInfo: { verificationCode },
  });
  return toTokenSet(raw);
}
