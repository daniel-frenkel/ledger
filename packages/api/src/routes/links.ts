/**
 * Clinician ↔ client links. Milestone 1 ships the minimum: a client can see
 * their links, create one to a clinician by id, update consent layers, and
 * revoke. The clinician side lands with apps/clinician.
 */
import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { shareLayersSchema, uuid } from '@ledger/shared';
import { schema, withUser } from '../db/client.js';

const links: FastifyPluginAsync = async (app) => {
  app.get('/v1/links', async (request) => {
    return withUser(request.user, (tx) => tx.select().from(schema.clinicianClientLinks));
  });

  app.post('/v1/links', async (request, reply) => {
    const body = z.object({ clinicianId: uuid, layers: shareLayersSchema.partial().optional() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'invalid payload' });
    if (request.user.role !== 'client') return reply.status(403).send({ error: 'clients invite clinicians' });
    const id = crypto.randomUUID();
    await withUser(request.user, (tx) =>
      tx.insert(schema.clinicianClientLinks).values({
        id,
        clientId: request.user.id,
        clinicianId: body.data.clinicianId,
        requestedBy: 'client',
        status: 'pending',
        ...body.data.layers,
      }),
    );
    return reply.status(201).send({ id });
  });

  app.patch('/v1/links/:id', async (request, reply) => {
    const params = z.object({ id: uuid }).safeParse(request.params);
    const body = z
      .object({ status: z.enum(['active', 'revoked']).optional(), layers: shareLayersSchema.partial().optional() })
      .safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: 'invalid payload' });
    const updated = await withUser(request.user, (tx) =>
      tx
        .update(schema.clinicianClientLinks)
        .set({ ...(body.data.status ? { status: body.data.status } : {}), ...body.data.layers })
        .where(and(eq(schema.clinicianClientLinks.id, params.data.id)))
        .returning({ id: schema.clinicianClientLinks.id }),
    );
    if (updated.length === 0) return reply.status(404).send({ error: 'not found' });
    return { ok: true };
  });
};

export default links;
