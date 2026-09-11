/**
 * Measures — a score from a published instrument, and nothing else.
 *
 * `POST /v1/measures` writes one; `GET /v1/measures` reads a client's own;
 * `GET /v1/clients/:clientId/measures` is the clinician's read through an
 * active link.
 *
 * What is not here is the point. No item text, no item-level responses, no
 * interpretation: the API stores a total and the instrument's published
 * subscales and refuses anything else. Some items are sensitive in a way a
 * total is not — PHQ-9 item 9 in particular — and storing them would put the
 * crisis rules in the position of needing to read them.
 *
 * Append-only. A re-administration is a new row at a new time; there is no
 * UPDATE grant and a trigger behind it. A score that can be revised is not a
 * measurement.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { INSTRUMENT_SPECS, instrument as instrumentSpec, measureSchema, uuid } from '@ledger/shared';
import { schema, withUser } from '../db/client.js';
import { clinicianReady } from '../clinician-gate.js';
import { logAccess } from '../audit.js';
import { newId } from '../ids.js';

/** Rate limits key on the acting user, not the IP. */
const perUser = (max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip },
});

export const CLINICIAN_NEEDS_CLIENT = 'A clinician-administered measure names the client it is about.';
export const NO_ACTIVE_LINK = 'no active link with this client';

const bodySchema = z.object({
  /** Only a clinician sends this; a client's own measure is about themselves. */
  clientId: uuid.nullish(),
  measure: measureSchema,
  appVersion: z.string().max(64).nullish(),
});

/** The row, as it goes out. `score` is numeric in Postgres and arrives as a string. */
const toJson = (r: typeof schema.measures.$inferSelect) => ({
  id: r.id,
  clientId: r.clientId,
  clinicianId: r.clinicianId,
  instrument: r.instrument,
  score: Number(r.score),
  subscales: r.subscales,
  administeredAt: r.administeredAt,
  administeredBy: r.administeredBy,
  /** Present when a clinician was involved; the purge reads it. */
  linkId: r.linkId,
  createdAt: r.createdAt,
});

const measures: FastifyPluginAsync = async (app) => {
  app.post('/v1/measures', { config: perUser(60, '1 hour') }, async (request, reply) => {
    const body = bodySchema.safeParse(request.body);
    // Field names and the schema's own message. measureSchema's messages are
    // written to be safe to show: a range, never the value that missed it.
    if (!body.success) {
      return reply.status(400).send({
        error: 'invalid payload',
        fields: body.error.issues.map((i) => i.path.join('.')),
        detail: body.error.issues[0]?.message,
      });
    }
    const { measure } = body.data;
    const isClinician = request.user.role === 'clinician';

    // The two shapes the database also insists on, checked here so the failure
    // is a sentence rather than a constraint name.
    if (isClinician && measure.administeredBy !== 'clinician') {
      return reply.status(422).send({ error: 'a clinician records a clinician-administered measure' });
    }
    if (!isClinician && measure.administeredBy !== 'client') {
      return reply.status(422).send({ error: 'a client records a self-administered measure' });
    }
    if (isClinician && !body.data.clientId) {
      return reply.status(400).send({ error: CLINICIAN_NEEDS_CLIENT, fields: ['clientId'] });
    }

    const clientId = isClinician ? body.data.clientId! : request.user.id;
    if (isClinician && clientId === request.user.id) {
      return reply.status(400).send({ error: 'invalid payload', fields: ['clientId'] });
    }

    // A clinician recording a measure about someone is working with client
    // data, so the gate applies before anything is written.
    if (isClinician && !clinicianReady(request, reply)) return reply;

    /**
     * The link the measure was taken under, if any — proposal 03 §2 and the
     * purge rule that follows from it. With a link the measure is part of the
     * care record and survives the client's purge, the way a formulation does;
     * without one it is the client's own data and goes with the account.
     *
     * A clinician's measure requires a link. A client's takes one if they are
     * linked at the time and none if they are not, which is the honest reading
     * of "was a clinician involved in this measurement".
     */
    const link = await withUser(request.user, async (tx) => {
      const [row] = await tx
        .select({ id: schema.clinicianClientLinks.id })
        .from(schema.clinicianClientLinks)
        .where(
          and(
            eq(schema.clinicianClientLinks.clientId, clientId),
            eq(schema.clinicianClientLinks.status, 'active'),
            ...(isClinician ? [eq(schema.clinicianClientLinks.clinicianId, request.user.id)] : []),
          ),
        );
      return row ?? null;
    });
    if (isClinician && !link) return reply.status(403).send({ error: NO_ACTIVE_LINK });

    const id = newId();
    try {
      await withUser(request.user, (tx) =>
        tx.insert(schema.measures).values({
          id,
          clientId,
          clinicianId: isClinician ? request.user.id : null,
          instrument: measure.instrument,
          score: String(measure.score),
          subscales: measure.subscales ?? null,
          administeredAt: new Date(measure.administeredAt),
          administeredBy: measure.administeredBy,
          linkId: link?.id ?? null,
          appVersion: body.data.appVersion ?? null,
        }),
      );
    } catch {
      // Never echo the driver's message: it quotes the row.
      return reply.status(409).send({ error: 'could not record the measure' });
    }
    return reply.status(201).send({ id });
  });

  /** A client's own measures, including the ones a clinician administered. */
  app.get('/v1/measures', async (request, reply) => {
    if (request.user.role !== 'client') return reply.status(403).send({ error: 'clients read their own measures' });
    const rows = await withUser(request.user, (tx) =>
      tx
        .select()
        .from(schema.measures)
        .where(eq(schema.measures.clientId, request.user.id))
        .orderBy(desc(schema.measures.administeredAt)),
    );
    return rows.map(toJson);
  });

  /** The clinician's read, through an active link. RLS does the scoping. */
  app.get('/v1/clients/:clientId/measures', async (request, reply) => {
    const params = z.object({ clientId: uuid }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'invalid id' });
    if (!clinicianReady(request, reply)) return reply;

    const rows = await withUser(request.user, async (tx) => {
      const found = await tx
        .select()
        .from(schema.measures)
        .where(eq(schema.measures.clientId, params.data.clientId))
        .orderBy(desc(schema.measures.administeredAt));
      await logAccess(tx, request.user, [
        { table: 'measures', clientId: params.data.clientId, rowCount: found.length },
      ]);
      return found;
    });
    return rows.map(toJson);
  });

  /**
   * The instruments, their ranges and their subscale names — so a form can be
   * built without shipping a second copy of the catalogue. Item text is not
   * here because it is not anywhere.
   */
  app.get('/v1/instruments', async () => ({
    instruments: Object.values(INSTRUMENT_SPECS),
    ims: instrumentSpec('ims'),
  }));
};

export default measures;
