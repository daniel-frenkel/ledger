/**
 * Invites — how a clinician–client link comes into existence.
 *
 * The clinician originates; the client's redemption is the consent. The token
 * is 32 random bytes, returned exactly once in the response that creates it,
 * and never stored: the row holds only its SHA-256. The invite URL puts it in
 * a fragment (`/join#<token>`), which browsers do not send to a server, so it
 * never reaches an access log, a referrer header, or a proxy.
 *
 * Nothing in this file may put a token or a token hash into a log line or a
 * response body other than the one create response. test/invite-secrecy.test.ts
 * greps for both.
 */
import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { uuid } from '@ledger/shared';
import { schema, withUser } from '../db/client.js';
import { clinicianReady } from '../clinician-gate.js';
import { newId } from '../ids.js';

/** Rate limits key on the acting user, not the IP: one clinician, one budget. */
const perUser = (max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip },
});

/** The one message every redemption failure gets. */
const REDEEM_FAILED = "This invitation isn't valid. Ask your clinician for a new one.";

/** Open invites a clinician may hold at once. Mirrored by a trigger in 0003. */
export const MAX_OPEN_INVITES = 20;

export const tokenHash = (token: string): Buffer => crypto.createHash('sha256').update(token, 'utf8').digest();

const invites: FastifyPluginAsync = async (app) => {
  // --- create ---------------------------------------------------------------
  app.post('/v1/invites', { config: perUser(10, '1 hour') }, async (request, reply) => {
    // Go-live gate A1 and B2: no invite exists before the second factor and
    // the signed agreement do. This is the route the gate names, because it is
    // the one that brings a client into the system at all.
    if (!clinicianReady(request, reply)) return reply;

    // 32 bytes, base64url so it survives a URL fragment untouched.
    const token = crypto.randomBytes(32).toString('base64url');
    const id = newId();

    try {
      const row = await withUser(request.user, async (tx) => {
        const open = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.linkInvites)
          .where(and(isNull(schema.linkInvites.redeemedAt), isNull(schema.linkInvites.revokedAt)));
        if ((open[0]?.n ?? 0) >= MAX_OPEN_INVITES) {
          return null;
        }
        const [created] = await tx
          .insert(schema.linkInvites)
          .values({
            id,
            clinicianId: request.user.id,
            tokenHash: tokenHash(token),
            // The trigger sets both; a value is required by the column type.
            expiresAt: new Date(),
          })
          .returning({ id: schema.linkInvites.id, expiresAt: schema.linkInvites.expiresAt });
        return created ?? null;
      });

      if (!row) {
        return reply.status(409).send({ error: `You already have ${MAX_OPEN_INVITES} invitations waiting.` });
      }
      // The only time the token exists outside the client's browser.
      return reply.status(201).send({ id: row.id, token, expiresAt: row.expiresAt });
    } catch {
      // Never echo the driver's message: it can quote the row, hash included.
      return reply.status(400).send({ error: 'could not create an invitation' });
    }
  });

  // --- list own, still open -------------------------------------------------
  app.get('/v1/invites', async (request, reply) => {
    if (request.user.role !== 'clinician') return reply.status(403).send({ error: 'clinicians invite clients' });
    // token_hash is deliberately not selected. There is no route that returns it.
    return withUser(request.user, (tx) =>
      tx
        .select({
          id: schema.linkInvites.id,
          createdAt: schema.linkInvites.createdAt,
          expiresAt: schema.linkInvites.expiresAt,
        })
        .from(schema.linkInvites)
        .where(and(isNull(schema.linkInvites.redeemedAt), isNull(schema.linkInvites.revokedAt)))
        .orderBy(desc(schema.linkInvites.createdAt)),
    );
  });

  // --- revoke ---------------------------------------------------------------
  app.delete('/v1/invites/:id', async (request, reply) => {
    const params = z.object({ id: uuid }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'invalid id' });
    if (request.user.role !== 'clinician') return reply.status(403).send({ error: 'clinicians invite clients' });

    const revoked = await withUser(request.user, (tx) =>
      tx
        .update(schema.linkInvites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.linkInvites.id, params.data.id),
            isNull(schema.linkInvites.redeemedAt),
            isNull(schema.linkInvites.revokedAt),
          ),
        )
        .returning({ id: schema.linkInvites.id }),
    );
    // RLS already limits this to the caller's own invites; a miss is a 404 for
    // an invite that is not theirs and for one already used, identically.
    if (revoked.length === 0) return reply.status(404).send({ error: 'not found' });
    return { ok: true };
  });

  // --- redeem ---------------------------------------------------------------
  app.post('/v1/invites/redeem', { config: perUser(20, '1 hour') }, async (request, reply) => {
    const body = z
      .object({
        token: z.string().min(1).max(200),
        sharePredictions: z.boolean().default(false),
        shareBodyStates: z.boolean().default(false),
      })
      .safeParse(request.body);
    // A malformed body is the same answer as a bad token: the caller learns
    // nothing from the difference.
    if (!body.success) return reply.status(404).send({ error: REDEEM_FAILED });
    if (request.user.role !== 'client') return reply.status(404).send({ error: REDEEM_FAILED });

    const linkId = newId();
    let created: string | null = null;
    try {
      created = await withUser(request.user, async (tx) => {
        // One statement inside the function is the single-use guarantee, and
        // it is the database's, not this route's. Two simultaneous redemptions
        // of the same token cannot both win: the second matches no row.
        const r = await tx.execute<{ link: string | null }>(
          sql`SELECT redeem_invite(${tokenHash(body.data.token)}, ${linkId}, ${body.data.sharePredictions}, ${body.data.shareBodyStates}) AS link`,
        );
        return (r.rows[0]?.link as string | null) ?? null;
      });
    } catch {
      // A unique violation on the pair (already linked to this clinician) is
      // indistinguishable from a bad token, on purpose.
      return reply.status(404).send({ error: REDEEM_FAILED });
    }

    if (!created) return reply.status(404).send({ error: REDEEM_FAILED });
    return reply.status(200).send({ linkId: created });
  });
};

export default invites;
