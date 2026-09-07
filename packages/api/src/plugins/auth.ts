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
import { verifySupabaseJwt } from '../auth/jwt.js';
import { withUser, schema } from '../db/client.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; role: UserRole };
  }
}

const PUBLIC = new Set(['/health', '/']);

async function identify(request: FastifyRequest): Promise<{ id: string; role: UserRole }> {
  const c = config();
  if (c.AUTH_TEST_MODE) {
    // Tests only. Never enabled in production (config refuses).
    const raw = request.headers['x-test-user'];
    const val = Array.isArray(raw) ? raw[0] : raw;
    if (!val) throw Object.assign(new Error('missing x-test-user'), { statusCode: 401 });
    const [id, role = 'client'] = val.split(':');
    if (!id || !(USER_ROLES as readonly string[]).includes(role)) throw Object.assign(new Error('bad x-test-user'), { statusCode: 401 });
    return { id, role: role as UserRole };
  }
  const auth = request.headers.authorization;
  if (!auth?.startsWith('Bearer ')) throw Object.assign(new Error('missing bearer token'), { statusCode: 401 });
  try {
    const v = await verifySupabaseJwt(auth.slice(7));
    return { id: v.userId, role: v.role };
  } catch {
    throw Object.assign(new Error('invalid token'), { statusCode: 401 });
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('user', null as unknown as FastifyRequest['user']);
  app.addHook('onRequest', async (request) => {
    if (PUBLIC.has(request.url.split('?')[0] ?? '')) return;
    const ident = await identify(request);
    // Ensure the users row exists; the DB role wins.
    const role = await withUser(ident, async (tx) => {
      const existing = await tx.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, ident.id));
      if (existing[0]) return existing[0].role;
      await tx.insert(schema.users).values({ id: ident.id, role: ident.role }).onConflictDoNothing();
      return ident.role;
    });
    request.user = { id: ident.id, role };
  });
};

export default fp(authPlugin, { name: 'auth' });
