/**
 * The clinician's own training stack, and the roadmap beside it.
 *
 * `GET`/`PUT /v1/clinician/stack` and `GET`/`PUT /v1/clinician/stack/goals`.
 * Replace rather than patch, both of them: a stack is a current statement of
 * depth, not a log, and a partial update makes "I dropped that one"
 * indistinguishable from "I forgot to send it".
 *
 * None of this is client data. A clinician's training is their own, there is no
 * client policy on either table, and nothing here reads or writes anything
 * about a client.
 *
 * Coverage is *not* computed here. The modality catalogue lives in
 * `apps/clinician/content/modalities.ts` — one source, ported from
 * `docs/theory/modalities.md` — and this package cannot import from an app, so
 * the API validates slugs and stores rows and the app does the arithmetic with
 * `coverage()` from `@ledger/shared`. The slug list the API validates against
 * is a mirror pinned to that module by a test.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, eq, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { MODALITY_SLUGS, stackEntrySchema, stackGoalSchema, unknownModalitySlugs } from '@ledger/shared';
import { schema, withUser } from '../db/client.js';

/** Rate limits key on the acting user, not the IP: one clinician, one budget. */
const perUser = (max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip },
});

export const UNKNOWN_MODALITIES = 'Some of those name no modality in the catalogue.';
export const DUPLICATE_MODALITY = 'A modality appears twice. A stack states one depth per modality.';
const ONLY_CLINICIANS = 'clinicians hold a stack';

/**
 * There is deliberately no cap on Master or Deep here.
 *
 * The reading rules allow one of each, and the app says so beside the
 * selectors — but they are rules about how a career is built, not facts about
 * a row. A clinician mid-transition between two certifications is describing
 * something true, and refusing the write would teach them to describe
 * something false instead. `stackWarnings()` in @ledger/shared is where the
 * rule is stated.
 */

const stackBody = z.object({ stack: z.array(stackEntrySchema).max(MODALITY_SLUGS.length) });
const goalsBody = z.object({ goals: z.array(stackGoalSchema).max(MODALITY_SLUGS.length) });

const stack: FastifyPluginAsync = async (app) => {
  app.get('/v1/clinician/stack', async (request, reply) => {
    if (request.user.role !== 'clinician') return reply.status(403).send({ error: ONLY_CLINICIANS });

    const rows = await withUser(request.user, (tx) =>
      tx.select().from(schema.clinicianStacks).where(eq(schema.clinicianStacks.clinicianId, request.user.id)),
    );
    return { stack: rows.map((r) => ({ slug: r.modalitySlug, tier: r.tier, updatedAt: r.updatedAt })) };
  });

  app.put('/v1/clinician/stack', { config: perUser(60, '1 hour') }, async (request, reply) => {
    if (request.user.role !== 'clinician') return reply.status(403).send({ error: ONLY_CLINICIANS });

    const body = stackBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'invalid payload', fields: body.error.issues.map((i) => i.path.join('.')) });
    }
    const entries = body.data.stack;

    const unknown = unknownModalitySlugs(entries.map((e) => e.slug));
    if (unknown.length > 0) return reply.status(422).send({ error: UNKNOWN_MODALITIES, unknown });

    const slugs = entries.map((e) => e.slug);
    if (new Set(slugs).size !== slugs.length) return reply.status(422).send({ error: DUPLICATE_MODALITY });

    await withUser(request.user, async (tx) => {
      const mine = eq(schema.clinicianStacks.clinicianId, request.user.id);
      // Drop what is no longer in the stack, then upsert the rest. A whole
      // delete-and-reinsert would churn created_at, which is the one thing on
      // the row worth keeping across an edit.
      await tx
        .delete(schema.clinicianStacks)
        .where(slugs.length > 0 ? and(mine, notInArray(schema.clinicianStacks.modalitySlug, slugs)) : mine);

      for (const e of entries) {
        await tx
          .insert(schema.clinicianStacks)
          .values({ clinicianId: request.user.id, modalitySlug: e.slug, tier: e.tier })
          .onConflictDoUpdate({
            target: [schema.clinicianStacks.clinicianId, schema.clinicianStacks.modalitySlug],
            set: { tier: e.tier, updatedAt: new Date() },
          });
      }
    });

    return reply.status(200).send({ stack: entries });
  });

  // --- the roadmap ----------------------------------------------------------

  app.get('/v1/clinician/stack/goals', async (request, reply) => {
    if (request.user.role !== 'clinician') return reply.status(403).send({ error: ONLY_CLINICIANS });

    const rows = await withUser(request.user, (tx) =>
      tx.select().from(schema.stackGoals).where(eq(schema.stackGoals.clinicianId, request.user.id)),
    );
    return {
      goals: rows.map((r) => ({
        slug: r.modalitySlug,
        targetTier: r.targetTier,
        targetBy: r.targetBy,
        doneAt: r.doneAt,
      })),
    };
  });

  app.put('/v1/clinician/stack/goals', { config: perUser(60, '1 hour') }, async (request, reply) => {
    if (request.user.role !== 'clinician') return reply.status(403).send({ error: ONLY_CLINICIANS });

    const body = goalsBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'invalid payload', fields: body.error.issues.map((i) => i.path.join('.')) });
    }
    const goals = body.data.goals;

    const unknown = unknownModalitySlugs(goals.map((g) => g.slug));
    if (unknown.length > 0) return reply.status(422).send({ error: UNKNOWN_MODALITIES, unknown });

    const slugs = goals.map((g) => g.slug);
    if (new Set(slugs).size !== slugs.length) return reply.status(422).send({ error: DUPLICATE_MODALITY });

    await withUser(request.user, async (tx) => {
      const mine = eq(schema.stackGoals.clinicianId, request.user.id);
      await tx
        .delete(schema.stackGoals)
        .where(slugs.length > 0 ? and(mine, notInArray(schema.stackGoals.modalitySlug, slugs)) : mine);

      for (const g of goals) {
        await tx
          .insert(schema.stackGoals)
          .values({
            clinicianId: request.user.id,
            modalitySlug: g.slug,
            targetTier: g.targetTier,
            targetBy: g.targetBy ?? null,
            doneAt: g.doneAt ? new Date(g.doneAt) : null,
          })
          .onConflictDoUpdate({
            target: [schema.stackGoals.clinicianId, schema.stackGoals.modalitySlug],
            set: {
              targetTier: g.targetTier,
              targetBy: g.targetBy ?? null,
              doneAt: g.doneAt ? new Date(g.doneAt) : null,
            },
          });
      }
    });

    return reply.status(200).send({ goals });
  });
};

export default stack;
