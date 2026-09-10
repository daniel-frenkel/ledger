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
 * It is an interface with one method because the provider is changing.
 * `docs/go-live-gate.md` A2 moves production off Supabase to Google Cloud
 * Identity Platform, and Prompt 11 does that work. When it does, it adds an
 * implementation below and changes the switch — `routes/me.ts` does not move.
 *
 * There is no SDK here on purpose. The API already verifies Supabase tokens
 * with `jose` and a JWKS URL and has never needed the client library; one REST
 * call is a smaller thing to own than a dependency, and it is one fewer
 * package to replace at Prompt 11.
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
