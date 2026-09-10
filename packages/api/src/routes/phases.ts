/**
 * Phase events — proposal 03 §3.
 *
 * When a protocol phase started, completed, paused or was abandoned, for one
 * client. This is the vertical line on a multiple-baseline graph: the thing
 * that makes "before" and "during" distinguishable in an analysis nobody has
 * run yet.
 *
 * Clinician-written through an active link, append-only, and there is no note
 * column. It records *when* a phase started, not how it went — a note here
 * would be a second chart in a table designed for a date.
 *
 * The date is the clinician's, not the server's: a phase that started on
 * Tuesday and was recorded on Thursday started on Tuesday. Backdating is
 * bounded to fourteen days by a CHECK, so it is a correction rather than a
 * rewrite.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { uuid } from '@ledger/shared';
import { schema, withUser } from '../db/client.js';
import { clinicianReady } from '../clinician-gate.js';
import { logAccess } from '../audit.js';
import { newId } from '../ids.js';

const perUser = (max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip },
});

export const PHASE_KINDS = ['started', 'completed', 'paused', 'abandoned'] as const;

export const NO_ACTIVE_LINK = 'no active link with this client';
export const BACKDATE_LIMIT_DAYS = 14;
export const BACKDATE_REFUSED = `A phase can be dated up to ${BACKDATE_LIMIT_DAYS} days back. Older than that is a correction to make somewhere it can be explained.`;

const bodySchema = z.object({
  clientId: uuid,
  formulationId: uuid.nullish(),
  protocolSlug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  /** The protocol's own phase number. 0 is the gates. */
  phase: z.number().int().min(0).max(20),
  kind: z.enum(PHASE_KINDS),
  at: z.string().datetime({ offset: true }),
  appVersion: z.string().max(64).nullish(),
});

const phases: FastifyPluginAsync = async (app) => {
  app.post('/v1/phase-events', { config: perUser(120, '1 hour') }, async (request, reply) => {
    if (!clinicianReady(request, reply)) return reply;

    const body = bodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'invalid payload', fields: body.error.issues.map((i) => i.path.join('.')) });
    }
    const b = body.data;
    if (b.clientId === request.user.id) return reply.status(400).send({ error: 'invalid payload', fields: ['clientId'] });

    // Checked here as well as by the CHECK, so the refusal is a sentence
    // rather than a constraint name.
    const at = new Date(b.at);
    const days = (Date.now() - at.getTime()) / 86_400_000;
    if (days > BACKDATE_LIMIT_DAYS || days < -1) {
      return reply.status(422).send({ error: BACKDATE_REFUSED, fields: ['at'] });
    }

    const id = newId();
    try {
      const wrote = await withUser(request.user, async (tx) => {
        const [link] = await tx
          .select({ id: schema.clinicianClientLinks.id })
          .from(schema.clinicianClientLinks)
          .where(
            and(
              eq(schema.clinicianClientLinks.clinicianId, request.user.id),
              eq(schema.clinicianClientLinks.clientId, b.clientId),
              eq(schema.clinicianClientLinks.status, 'active'),
            ),
          );
        if (!link) return false;

        await tx.insert(schema.phaseEvents).values({
          id,
          clientId: b.clientId,
          clinicianId: request.user.id,
          formulationId: b.formulationId ?? null,
          protocolSlug: b.protocolSlug,
          phase: b.phase,
          kind: b.kind,
          at,
          appVersion: b.appVersion ?? null,
        });
        return true;
      });
      if (!wrote) return reply.status(403).send({ error: NO_ACTIVE_LINK });
    } catch {
      // Never echo the driver's message.
      return reply.status(409).send({ error: 'could not record that phase' });
    }
    return reply.status(201).send({ id });
  });

  /** The clinician's own view of a client's phases. Logged, like every read. */
  app.get('/v1/clients/:clientId/phase-events', async (request, reply) => {
    const params = z.object({ clientId: uuid }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'invalid id' });
    if (!clinicianReady(request, reply)) return reply;

    const rows = await withUser(request.user, async (tx) => {
      const found = await tx
        .select()
        .from(schema.phaseEvents)
        .where(eq(schema.phaseEvents.clientId, params.data.clientId))
        .orderBy(asc(schema.phaseEvents.at));
      await logAccess(tx, request.user, [
        { table: 'phase_events', clientId: params.data.clientId, rowCount: found.length },
      ]);
      return found;
    });

    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      formulationId: r.formulationId,
      protocolSlug: r.protocolSlug,
      phase: r.phase,
      kind: r.kind,
      at: r.at,
    }));
  });
};

export default phases;
