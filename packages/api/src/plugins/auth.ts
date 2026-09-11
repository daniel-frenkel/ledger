/**
 * Fastify auth plugin. Every route except /health requires a bearer token.
 * On success `request.user = { id, role }`. The users row is created on
 * first sight (id only — no email, no name) and its role wins over the token's.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { USER_ROLES, type UserRole } from '@ledger/shared';
import { config } from '../config.js';
import { authAdmin } from '../auth-admin.js';
import { verifyJwt } from '../auth/jwt.js';
import { withUser, schema } from '../db/client.js';
import type { AssuranceLevel } from '../auth-admin.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string;
      role: UserRole;
      /**
       * How many factors the token proved. Go-live gate B2 requires aal2 of a
       * clinician before they can invite anyone or read a client's rows.
       */
      aal: AssuranceLevel;
      /** Which clinician BAA version they accepted, or null. Gate A1. */
      baaAcceptedVersion: string | null;
    };
  }
}

const PUBLIC = new Set(['/health', '/']);

async function identify(request: FastifyRequest): Promise<{ id: string; role: UserRole; aal: AssuranceLevel }> {
  const c = config();
  if (c.AUTH_TEST_MODE) {
    // Tests only. Never enabled in production (config refuses).
    const raw = request.headers['x-test-user'];
    const val = Array.isArray(raw) ? raw[0] : raw;
    if (!val) throw Object.assign(new Error('missing x-test-user'), { statusCode: 401 });
    // `id:role:aal`. The assurance level defaults to aal2, because a test that
    // is not about MFA is a test whose clinician has already enrolled — the
    // MFA tests pass `:aal1` explicitly. In production the default is the
    // other way: assuranceLevel() reads the claim and fails closed to aal1.
    const [id, role = 'client', aal = 'aal2'] = val.split(':');
    if (!id || !(USER_ROLES as readonly string[]).includes(role)) throw Object.assign(new Error('bad x-test-user'), { statusCode: 401 });
    if (aal !== 'aal1' && aal !== 'aal2') throw Object.assign(new Error('bad x-test-user'), { statusCode: 401 });
    return { id, role: role as UserRole, aal };
  }
  const auth = request.headers.authorization;
  if (!auth?.startsWith('Bearer ')) throw Object.assign(new Error('missing bearer token'), { statusCode: 401 });
  try {
    const v = await verifyJwt(auth.slice(7));
    // Behind the seam: the claim's name is the provider's, and Prompt 11
    // changes the provider without changing the checks that read this.
    return { id: v.userId, role: v.role, aal: authAdmin().assuranceLevel(v.claims) };
  } catch {
    throw Object.assign(new Error('invalid token'), { statusCode: 401 });
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('user', null as unknown as FastifyRequest['user']);
  app.addHook('onRequest', async (request) => {
    if (PUBLIC.has(request.url.split('?')[0] ?? '')) return;
    const ident = await identify(request);
    // Ensure the users row exists; the DB role wins. The BAA version comes
    // from the same read rather than a second one per guarded route.
    const row = await withUser(ident, async (tx) => {
      const existing = await tx
        .select({ role: schema.users.role, baa: schema.users.baaAcceptedVersion })
        .from(schema.users)
        .where(eq(schema.users.id, ident.id));
      if (existing[0]) return existing[0];
      await tx.insert(schema.users).values({ id: ident.id, role: ident.role }).onConflictDoNothing();
      return { role: ident.role, baa: null };
    });
    request.user = { id: ident.id, role: row.role, aal: ident.aal, baaAcceptedVersion: row.baa };
  });
};

export default fp(authPlugin, { name: 'auth' });
