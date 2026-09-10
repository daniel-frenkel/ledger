/**
 * The clinician's own training stack.
 *
 * `GET /v1/clinician/stack` reads it; `PUT /v1/clinician/stack` replaces it
 * whole. Replace rather than patch because a stack is a current statement of
 * depth, not a log: removing a modality you no longer run is a correction, and
 * a partial update makes "I dropped that one" indistinguishable from "I forgot
 * to send it".
 *
 * None of this is client data. A clinician's training is their own, there is no
 * client policy on the table, and nothing here reads or writes anything about a
 * client. It is in the API rather than the browser because the scope gate on
 * `POST /v1/formulations` has to compute a verdict the clinician cannot set.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, eq, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  CAPPED_TIERS,
  MODALITIES,
  coverage,
  stackEntrySchema,
  stackWarnings,
  tier as tierMeta,
  unknownModalitySlugs,
  type StackEntry,
} from '@ledger/shared';
import { schema, withUser } from '../db/client.js';
import { newId } from '../ids.js';

/** Rate limits key on the acting user, not the IP: one clinician, one budget. */
const perUser = (max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip },
});

export const UNKNOWN_MODALITIES = 'Some of those name no modality in the catalogue.';
export const DUPLICATE_MODALITY = 'A modality appears twice. A stack states one depth per modality.';
export const TIER_CAP =
  'The reading rules allow one Master and one Deep at a time. Acquiring certifications in parallel is the error the rule exists for.';

const bodySchema = z.object({ stack: z.array(stackEntrySchema).max(MODALITIES.length) });

const stack: FastifyPluginAsync = async (app) => {
  app.get('/v1/clinician/stack', async (request, reply) => {
    if (request.user.role !== 'clinician') return reply.status(403).send({ error: 'clinicians hold a stack' });

    const rows = await withUser(request.user, (tx) =>
      tx
        .select()
        .from(schema.clinicianModalities)
        .where(eq(schema.clinicianModalities.clinicianId, request.user.id)),
    );

    // `tier` is text in the column and a union in the type; 0005's CHECK is
    // what keeps the two honest.
    const entries = rows.map((r) => ({ slug: r.modalitySlug, tier: r.tier })) as StackEntry[];
    return {
      stack: rows.map((r) => ({ slug: r.modalitySlug, tier: r.tier, updatedAt: r.updatedAt })),
      // Computed here so the page cannot disagree with the gate.
      coverage: coverage(entries),
      warnings: stackWarnings(entries),
    };
  });

  app.put('/v1/clinician/stack', { config: perUser(60, '1 hour') }, async (request, reply) => {
    if (request.user.role !== 'clinician') return reply.status(403).send({ error: 'clinicians hold a stack' });

    const body = bodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'invalid payload', fields: body.error.issues.map((i) => i.path.join('.')) });
    }
    const entries = body.data.stack;

    const unknown = unknownModalitySlugs(entries.map((e) => e.slug));
    if (unknown.length > 0) return reply.status(422).send({ error: UNKNOWN_MODALITIES, unknown });

    const slugs = entries.map((e) => e.slug);
    if (new Set(slugs).size !== slugs.length) {
      return reply.status(422).send({ error: DUPLICATE_MODALITY });
    }
    // The partial unique indexes in 0005 enforce this too. Checking here first
    // turns a driver error into a sentence that says which rule was broken.
    for (const capped of CAPPED_TIERS) {
      const n = entries.filter((e) => e.tier === capped).length;
      if (n > 1) return reply.status(422).send({ error: TIER_CAP, fields: [capped] });
    }

    try {
      await withUser(request.user, async (tx) => {
        const mine = eq(schema.clinicianModalities.clinicianId, request.user.id);
        // Drop what is no longer in the stack, then upsert the rest. A whole
        // delete-and-reinsert would churn created_at, which is the one thing on
        // the row worth keeping across an edit.
        await tx
          .delete(schema.clinicianModalities)
          .where(slugs.length > 0 ? and(mine, notInArray(schema.clinicianModalities.modalitySlug, slugs)) : mine);

        for (const e of entries) {
          await tx
            .insert(schema.clinicianModalities)
            .values({ id: newId(), clinicianId: request.user.id, modalitySlug: e.slug, tier: e.tier })
            .onConflictDoUpdate({
              target: [schema.clinicianModalities.clinicianId, schema.clinicianModalities.modalitySlug],
              set: { tier: e.tier, updatedAt: new Date() },
            });
        }
      });
    } catch {
      // Never echo the driver's message. The partial indexes are the likely
      // cause and the message above already says what they mean.
      return reply.status(409).send({ error: TIER_CAP });
    }

    return reply.status(200).send({
      stack: entries,
      coverage: coverage(entries),
      warnings: stackWarnings(entries),
    });
  });

  /** The catalogue, so the page does not ship its own copy of the document. */
  app.get('/v1/clinician/modalities', async (request, reply) => {
    if (request.user.role !== 'clinician') return reply.status(403).send({ error: 'clinicians hold a stack' });
    return {
      modalities: MODALITIES,
      tiers: ['master', 'deep', 'fluent', 'literacy'].map((id) => ({ id, ...tierMeta(id) })),
    };
  });
};

export default stack;
