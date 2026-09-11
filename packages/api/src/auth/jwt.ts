/**
 * Bearer token verification, with no idea which provider issued the token.
 *
 * Everything provider-specific is resolved in `config.tokenVerification()` —
 * the key set, the issuer, the audience — so moving production from Supabase
 * to Identity Platform (go-live gate A2) changes configuration and not this
 * file. What stays here is the part that must be true of any provider:
 *
 *   **The signature is not enough.** Google signs the Identity Platform tokens
 *   of every project on earth with one shared key set. A token from a stranger's
 *   project verifies perfectly against those keys, so `issuer` and `audience`
 *   are what actually bind a token to *this* deployment. They are passed to
 *   `jwtVerify`, which throws when either fails to match.
 *
 * Role comes from the token if present and the database row is the final word;
 * the auth plugin reconciles them.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { USER_ROLES, type UserRole } from '@ledger/shared';
import { config, tokenVerification, type Config } from '../config.js';

export interface VerifiedIdentity {
  userId: string;
  role: UserRole;
  /** The verified payload, for the provider-specific reads behind auth-admin.ts. */
  claims: JWTPayload;
}

/** Whatever `jwtVerify` will accept as a key source. */
type KeySource = Parameters<typeof jwtVerify>[1];

/** One remote key set per URL, cached: `jose` handles its own refresh and backoff. */
const keySets = new Map<string, KeySource>();

/**
 * Test seam, in the shape of `setAuthAdmin`.
 *
 * `createRemoteJWKSet` fetches through Node's http stack rather than
 * `globalThis.fetch`, so a stubbed global does not intercept it and a test
 * cannot serve its own fixture key any other way. Pass `undefined` to restore
 * the real fetch for that URL.
 */
export function setKeySet(url: string, source: KeySource | undefined): void {
  if (source) keySets.set(url, source);
  else keySets.delete(url);
}

function keySetFor(url: string): KeySource {
  let set = keySets.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url));
    keySets.set(url, set);
  }
  return set;
}

/**
 * The role claim.
 *
 * Supabase carries it in `app_metadata.role`. Identity Platform's equivalent
 * is a custom claim set by the admin API, which lands at the top level; both
 * are read, and neither is trusted further than the database row that the auth
 * plugin reconciles against.
 */
function roleFromClaims(payload: JWTPayload): UserRole {
  const meta = payload['app_metadata'] as { role?: unknown } | undefined;
  const candidates = [meta?.role, payload['role']];
  for (const r of candidates) {
    if (typeof r === 'string' && (USER_ROLES as readonly string[]).includes(r)) return r as UserRole;
  }
  return 'client';
}

/**
 * `c` is injectable only so a test can verify a token against a fixture key
 * without fighting the module-level config cache. Production passes nothing.
 */
export async function verifyJwt(token: string, c: Config = config()): Promise<VerifiedIdentity> {
  const v = tokenVerification(c);
  const opts = {
    ...(v.audience ? { audience: v.audience } : {}),
    ...(v.issuer ? { issuer: v.issuer } : {}),
  };

  let payload: JWTPayload;
  if (v.jwksUrl) {
    ({ payload } = await jwtVerify(token, keySetFor(v.jwksUrl), opts));
  } else if (v.secret) {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(v.secret), { ...opts, algorithms: ['HS256'] }));
  } else {
    throw new Error('No JWT verification method configured');
  }
  if (!payload.sub) throw new Error('token has no subject');
  return { userId: payload.sub, role: roleFromClaims(payload), claims: payload };
}

/**
 * The pre-Prompt-11 name. Kept for one release so nothing outside this package
 * breaks on the rename; `verifyJwt` is the name to use.
 *
 * @deprecated use {@link verifyJwt}
 */
export const verifySupabaseJwt = verifyJwt;
