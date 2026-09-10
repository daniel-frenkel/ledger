/**
 * Formulations — where the locator's output lives.
 *
 * The clinician's working notes about a client, the way a paper chart is.
 * Append-only: a re-aim is a new row at `version + 1`, never an edit, and the
 * API role holds no UPDATE or DELETE grant. The client does not read these in
 * this version.
 *
 * Two rules live here rather than in the database, because the database cannot
 * express them:
 *
 *   All three gates must be TRUE. Migration 0003's CHECK requires the three
 *   keys to be present and boolean — it cannot require them to be attested,
 *   because `{"risk": false}` is a perfectly well-formed refusal to attest.
 *   A formulation with an unattested gate is not written.
 *
 *   The note and the falsify line are encrypted before they reach the row, and
 *   neither ever appears in a log line or an error body.
 */
import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  GATE_KEYS,
  allGatesCleared,
  gatesSchema,
  scopeGate,
  scopeNeedsAck,
  uuid,
  unknownObservationIds,
  type StackEntry,
} from '@ledger/shared';
import { schema, withUser } from '../db/client.js';
import { decryptField, encryptField } from '../crypto/fields.js';
import { newId } from '../ids.js';

/**
 * The clinician's attestation, and the gate rule. Both from @ledger/shared, so
 * the locator that collects the attestation and the route that refuses it
 * cannot disagree.
 */
export { GATE_KEYS as GATE_NAMES, allGatesCleared, gatesSchema } from '@ledger/shared';

export const UNKNOWN_OBSERVATIONS = 'Some observation ids are not signs the locator knows.';

/**
 * The scope gate. Unlike the three gates above it, this one does not refuse —
 * a clinician may work outside their stack under supervision, and often should.
 * It refuses to let that happen silently.
 */
export const SCOPE_NOT_ACKNOWLEDGED =
  'This floor is outside your training stack. You can still write the formulation — say so explicitly and it is recorded on the row.';

export const GATES_NOT_CLEARED =
  'Every gate has to be cleared before a formulation is written. Locating past an open gate hands the prior fresh evidence with your signature on it.';

const bodySchema = z.object({
  clientId: uuid,
  note: z.string().min(1),
  /** What would show this placement wrong. Required, by the proposal. */
  falsify: z.string().min(1),
  /** Observation ids from the locator's list in @ledger/shared. */
  observations: z.array(z.string()),
  gates: gatesSchema,
  floor: z.number().int().min(1).max(8),
  protocolSlug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .nullish(),
  assistantRunId: uuid.nullish(),
  /**
   * The clinician saying they know this floor is outside their stack. The
   * verdict itself is never accepted from the body — it is computed from their
   * own stack, server-side, below.
   */
  scopeAck: z.boolean().default(false),
});

const formulations: FastifyPluginAsync = async (app) => {
  app.post('/v1/formulations', { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (request, reply) => {
    if (request.user.role !== 'clinician') return reply.status(403).send({ error: 'clinicians write formulations' });
    const body = bodySchema.safeParse(request.body);
    // Field names only — a zod message can quote the value it rejected, and
    // the note is in this payload.
    if (!body.success) {
      return reply.status(400).send({ error: 'invalid payload', fields: body.error.issues.map((i) => i.path.join('.')) });
    }
    const b = body.data;
    if (b.clientId === request.user.id) return reply.status(400).send({ error: 'invalid payload', fields: ['clientId'] });
    // Membership, not shape: an id that names no sign would be stored forever
    // and score as nothing, which is worse than a refusal.
    const unknown = unknownObservationIds(b.observations);
    if (unknown.length > 0) {
      return reply.status(422).send({ error: UNKNOWN_OBSERVATIONS, unknown });
    }
    if (!allGatesCleared(b.gates)) {
      return reply.status(422).send({ error: GATES_NOT_CLEARED, fields: GATE_KEYS.filter((k) => !b.gates[k]) });
    }

    // The scope gate. The verdict comes from the clinician's own stack and the
    // floor they are placing this client on; the body may say only whether they
    // accept writing outside it.
    const stack = await withUser(request.user, (tx) =>
      tx
        .select({ slug: schema.clinicianModalities.modalitySlug, tier: schema.clinicianModalities.tier })
        .from(schema.clinicianModalities)
        .where(eq(schema.clinicianModalities.clinicianId, request.user.id)),
    );
    // `tier` is text in the column and a union in the type; 0005's CHECK is
    // what keeps the two honest. scopeGate, not scopeFor: a clinician with no
    // stack on file is not out of scope, they are unstated, and the row records
    // null rather than a verdict computed from nothing.
    const scope = scopeGate(stack as StackEntry[], b.floor);
    if (scopeNeedsAck(scope) && !b.scopeAck) {
      return reply.status(422).send({ error: SCOPE_NOT_ACKNOWLEDGED, scope, floor: b.floor });
    }

    const id = newId();
    try {
      const version = await withUser(request.user, async (tx) => {
        // The link the formulation is written against. RLS already limits this
        // to the caller's own links; the trigger re-checks it is active.
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
        if (!link) return null;

        // 1 first, +1 per re-aim. UNIQUE (clinician, client, version) is what
        // actually decides it under a race; this only picks the next number.
        const [prev] = await tx
          .select({ max: sql<number | null>`max(${schema.formulations.version})` })
          .from(schema.formulations)
          .where(
            and(
              eq(schema.formulations.clinicianId, request.user.id),
              eq(schema.formulations.clientId, b.clientId),
            ),
          );
        const next = (prev?.max ?? 0) + 1;

        await tx.insert(schema.formulations).values({
          id,
          clinicianId: request.user.id,
          clientId: b.clientId,
          linkId: link.id,
          version: next,
          noteEnc: encryptField(b.note, 'note_enc'),
          falsifyEnc: encryptField(b.falsify, 'falsify_enc'),
          observations: b.observations,
          gates: b.gates,
          floor: b.floor,
          protocolSlug: b.protocolSlug ?? null,
          assistantRunId: b.assistantRunId ?? null,
          scope,
          scopeAck: b.scopeAck,
        });
        return next;
      });

      if (version === null) return reply.status(403).send({ error: 'no active link with this client' });
      return reply.status(201).send({ id, version, scope });
    } catch {
      // Never echo the driver's message: it can quote the row, ciphertext and
      // note length included.
      return reply.status(409).send({ error: 'could not write the formulation' });
    }
  });

  app.get('/v1/clients/:clientId/formulations', async (request, reply) => {
    const params = z.object({ clientId: uuid }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'invalid id' });
    if (request.user.role !== 'clinician') return reply.status(403).send({ error: 'clinicians read formulations' });

    // RLS does the scoping: author, and an active link. A revoked link returns
    // an empty list rather than a 403 — the rows are simply not visible.
    const rows = await withUser(request.user, (tx) =>
      tx
        .select()
        .from(schema.formulations)
        .where(eq(schema.formulations.clientId, params.data.clientId))
        .orderBy(desc(schema.formulations.version)),
    );

    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      clientId: r.clientId,
      floor: r.floor,
      protocolSlug: r.protocolSlug,
      observations: r.observations,
      gates: r.gates,
      scope: r.scope,
      scopeAck: r.scopeAck,
      assistantRunId: r.assistantRunId,
      createdAt: r.createdAt,
      note: decryptField(r.noteEnc, 'note_enc'),
      falsify: decryptField(r.falsifyEnc, 'falsify_enc'),
    }));
  });
};

export default formulations;
