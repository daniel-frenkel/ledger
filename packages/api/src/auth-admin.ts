/**
 * Deleting the identity, behind one method.
 *
 * Identity — email, phone, display name — is never in the application
 * database. It lives with the auth provider, and the application database
 * knows a user only as a UUID and a role (docs/data-path.md). So "delete my
 * account" has two halves: the rows here, and the account there. This is the
 * second half, and it is the only place in the API that holds a credential
 * able to act on another user.
 *
 * It is an interface because the provider changed. `docs/go-live-gate.md` A2
 * moved production off Supabase to Google Cloud Identity Platform; both
 * implementations are below and the switch picks one from `AUTH_PROVIDER`.
 * Supabase stays for local and CI. Nothing in `routes/me.ts` moved, and the
 * deletion tests never knew the difference, which was the point of the seam.
 *
 * There is no SDK here on purpose, for either provider. The API verifies
 * tokens with `jose` and a JWKS URL and has never needed a client library; a
 * REST call is a smaller thing to own than a dependency.
 */
import { config } from './config.js';

/** Authenticator assurance level, in the auth world's own vocabulary. */
export type AssuranceLevel = 'aal1' | 'aal2';

/** The verified claims of a token. Never the raw string: this is post-verification. */
export type VerifiedClaims = Record<string, unknown>;

export interface AuthAdmin {
  /**
   * Delete the identity for `userId`. Idempotent: an account already gone is
   * success, because the caller is finishing a deletion either way.
   */
  deleteUser(userId: string): Promise<void>;

  /**
   * How many factors this token actually proved.
   *
   * The claim's name and shape are the provider's, which is why reading it is
   * behind the seam: go-live gate B2 requires `aal2` for clinicians, and that
   * requirement should survive the move to Identity Platform without the
   * check that enforces it being rewritten.
   *
   * Fails closed. A token with no assurance claim is `aal1` — one factor is
   * what a bearer token proves unless something says otherwise.
   */
  assuranceLevel(jwt: VerifiedClaims): AssuranceLevel;
}

/** The provider could not be reached or refused. Carries no response body. */
export class AuthAdminError extends Error {
  constructor(readonly reason: string) {
    super(`auth admin: ${reason}`);
    this.name = 'AuthAdminError';
  }
}

/**
 * Supabase Auth, via the admin REST endpoint.
 *
 * The service-role key bypasses every Supabase policy, which is why it is not
 * in the API's environment for any other purpose and why nothing else in this
 * codebase reads it. It never touches the application database — that
 * connection is `ledger_api`, which has RLS enforced and no BYPASSRLS.
 */
class SupabaseAuthAdmin implements AuthAdmin {
  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
  ) {}

  /**
   * Supabase puts the assurance level in the `aal` claim, and it is present
   * on every token the project issues once MFA exists on the project.
   */
  assuranceLevel(jwt: VerifiedClaims): AssuranceLevel {
    return jwt['aal'] === 'aal2' ? 'aal2' : 'aal1';
  }

  async deleteUser(userId: string): Promise<void> {
    const base = this.url.replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: {
          apikey: this.serviceRoleKey,
          authorization: `Bearer ${this.serviceRoleKey}`,
          'content-type': 'application/json',
        },
      });
    } catch (err) {
      // The provider's own message can quote the request. Type only.
      throw new AuthAdminError(`unreachable (${(err as Error).name})`);
    }
    // Already gone is done. A deletion that is retried must be able to finish.
    if (res.status === 404) return;
    if (!res.ok) throw new AuthAdminError(`status ${res.status}`);
  }
}

/**
 * Google Cloud Identity Platform, via the Identity Toolkit admin REST API.
 *
 * **No key file, by construction.** The organisation enforces
 * `constraints/iam.disableServiceAccountKeyCreation`, so there is no downloaded
 * credential to hold and none of this works from a laptop. The access token
 * comes from the metadata server of whatever Cloud Run revision is executing,
 * which means the identity acting here is the service account attached to the
 * revision — visible in the console, revocable in one click, and impossible to
 * copy out. That is a better arrangement than the Supabase service-role key it
 * replaces, which is a long-lived secret sitting in the environment.
 *
 * No SDK either, for the same reason there is no Supabase client here: two REST
 * calls are a smaller thing to own than `google-auth-library` and `firebase-admin`.
 */
class IdentityPlatformAuthAdmin implements AuthAdmin {
  /** Cached until shortly before it expires; the metadata server rate-limits. */
  private token?: { value: string; expiresAt: number };

  constructor(private readonly projectId: string) {}

  /**
   * Identity Platform records the second factor in the `firebase` claim as
   * `sign_in_second_factor` — 'totp' for the authenticator app that go-live
   * gate B2 asks clinicians to enrol. Its presence is the whole signal: the
   * token was minted after a second factor was proved.
   *
   * Fails closed, as the Supabase implementation does.
   */
  assuranceLevel(jwt: VerifiedClaims): AssuranceLevel {
    const fb = jwt['firebase'] as { sign_in_second_factor?: unknown } | undefined;
    const factor = fb?.sign_in_second_factor;
    return typeof factor === 'string' && factor !== '' ? 'aal2' : 'aal1';
  }

  /** An OAuth token for the runtime service account, from the metadata server. */
  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) return this.token.value;
    let res: Response;
    try {
      res = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-account/default/token',
        { headers: { 'Metadata-Flavor': 'Google' } },
      );
    } catch (err) {
      throw new AuthAdminError(`metadata server unreachable (${(err as Error).name})`);
    }
    if (!res.ok) throw new AuthAdminError(`metadata server status ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new AuthAdminError('metadata server returned no token');
    this.token = { value: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  async deleteUser(userId: string): Promise<void> {
    const token = await this.accessToken();
    let res: Response;
    try {
      res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/accounts:delete`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ localId: userId }),
        },
      );
    } catch (err) {
      throw new AuthAdminError(`unreachable (${(err as Error).name})`);
    }
    // Already gone is done, as above: a retried deletion has to be able to
    // finish. Identity Toolkit answers 400 USER_NOT_FOUND rather than 404.
    if (res.status === 404) return;
    if (res.status === 400) {
      const body = (await res.text()).slice(0, 200);
      if (body.includes('USER_NOT_FOUND')) return;
      // Never echo the body: it can quote the request, and the request
      // carries a user id.
      throw new AuthAdminError('status 400');
    }
    if (!res.ok) throw new AuthAdminError(`status ${res.status}`);
  }
}

/**
 * Whether the configured provider has what it needs.
 *
 * `routes/me.ts` checks this before it soft-deletes anything: a run that
 * cannot finish the second half must not start the first. Half a deletion is
 * worse than none — the rows are gone from the user's view and the account
 * still signs in.
 */
export function authAdminConfigured(env = config()): boolean {
  if (override) return true;
  switch (env.AUTH_PROVIDER) {
    case 'supabase':
      return !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_ROLE_KEY;
    // No credential to check: the token comes from the metadata server at call
    // time, and the project id is all that has to be configured.
    case 'identity-platform':
      return !!env.GCP_PROJECT_ID;
    default:
      return false;
  }
}

let cached: AuthAdmin | undefined;
let override: AuthAdmin | undefined;

/** The configured provider. Throws if it is not configured; callers check first. */
export function authAdmin(): AuthAdmin {
  if (override) return override;
  const c = config();
  if (!authAdminConfigured(c)) throw new AuthAdminError('not configured');
  switch (c.AUTH_PROVIDER) {
    case 'supabase':
      cached ??= new SupabaseAuthAdmin(c.SUPABASE_URL!, c.SUPABASE_SERVICE_ROLE_KEY!);
      return cached;
    case 'identity-platform':
      cached ??= new IdentityPlatformAuthAdmin(c.GCP_PROJECT_ID!);
      return cached;
    default:
      // Unreachable while the enum has one member; here so adding one to the
      // enum without adding it here fails to compile rather than at runtime.
      throw new AuthAdminError(`no implementation for ${String(c.AUTH_PROVIDER)}`);
  }
}

/**
 * Swap the implementation. The API suite mocks *this interface* rather than a
 * provider's client, which is the point of the seam: the deletion tests do not
 * change when the provider does.
 */
export function setAuthAdmin(impl: AuthAdmin | undefined): void {
  override = impl;
}
