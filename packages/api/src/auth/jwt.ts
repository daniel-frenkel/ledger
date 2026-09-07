/**
 * Supabase JWT verification. JWKS (asymmetric) preferred; HS256 secret as a
 * fallback for older projects. Role comes from `app_metadata.role` in the
 * token if present, otherwise defaults to `client`; the database row is the
 * final word and is reconciled in the auth plugin.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { USER_ROLES, type UserRole } from '@ledger/shared';
import { config } from '../config.js';

export interface VerifiedIdentity {
  userId: string;
  role: UserRole;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function roleFromClaims(payload: JWTPayload): UserRole {
  const meta = payload['app_metadata'] as { role?: unknown } | undefined;
  const r = meta?.role;
  return typeof r === 'string' && (USER_ROLES as readonly string[]).includes(r) ? (r as UserRole) : 'client';
}

export async function verifySupabaseJwt(token: string): Promise<VerifiedIdentity> {
  const c = config();
  const issuer = c.SUPABASE_URL ? `${c.SUPABASE_URL.replace(/\/$/, '')}/auth/v1` : undefined;
  const opts = { audience: 'authenticated', ...(issuer ? { issuer } : {}) };

  let payload: JWTPayload;
  if (c.SUPABASE_JWKS_URL) {
    jwks ??= createRemoteJWKSet(new URL(c.SUPABASE_JWKS_URL));
    ({ payload } = await jwtVerify(token, jwks, opts));
  } else if (c.SUPABASE_JWT_SECRET) {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(c.SUPABASE_JWT_SECRET), { ...opts, algorithms: ['HS256'] }));
  } else {
    throw new Error('No JWT verification method configured');
  }
  if (!payload.sub) throw new Error('token has no subject');
  return { userId: payload.sub, role: roleFromClaims(payload) };
}
