/**
 * The locating assistant — POST /v1/assistant/locate.
 *
 * A clinician sends one note about one client they hold an active link to,
 * and gets back a pre-filled locator: which signs the note gives evidence for,
 * the exact spans it read them from, which gates it could not see addressed,
 * and the floors those signs score to. The clinician ticks, unticks, attests
 * the gates and writes the formulation. Nothing here writes a formulation and
 * nothing here clears a gate.
 *
 * Ships off. `ASSISTANT_ENABLED` is false by default and this is the first hop
 * where a third party reads client prose, so it stays off until the BAA in
 * docs/data-path.md hop 8 is signed.
 *
 * The note is PHI and gets the strictest handling in the codebase:
 *   - it is never logged, never echoed in an error body, never returned;
 *   - it is not stored — `assistant_runs` holds its SHA-256 and nothing else;
 *   - the evidence spans go back to the clinician who wrote the note in the
 *     same request, and are not persisted anywhere.
 * test/phi-logs.test.ts runs a locate call with seeded strings and greps
 * everything the logger wrote, plus the row that was written.
 */
import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { GATE_QUESTIONS, locate as locateFloors, observation, uuid } from '@ledger/shared';
import { schema, withUser } from '../db/client.js';
import { newId } from '../ids.js';
import { config } from '../config.js';
import { LocateSchemaError, locate } from '../services/ai.js';
import { assertCorpusAvailable } from '../services/locate-prompt.js';

/** Stable, and the same string whether the switch is off or the key is missing. */
export const ASSISTANT_OFF_CODE = 'ASSISTANT_DISABLED';
export const ASSISTANT_OFF = 'The locating assistant is off until the data agreement is in place';

/** Rate limits key on the acting user, not the IP: one clinician, one budget. */
const perUser = (max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip },
});

const bodySchema = z.object({ clientId: uuid, note: z.string().min(1).max(20_000) });

export const noteHash = (note: string): Buffer => crypto.createHash('sha256').update(note, 'utf8').digest();

const assistant: FastifyPluginAsync = async (app) => {
  const c = config();

  // A deployment that shipped without docs/theory/ must fail at boot rather
  // than build a truncated prompt on the first real note.
  if (c.ASSISTANT_ENABLED) assertCorpusAvailable();

  app.post('/v1/assistant/locate', { config: perUser(30, '1 hour') }, async (request, reply) => {
    // Before anything else, and before any model call: off is off.
    if (!c.ASSISTANT_ENABLED || !c.ANTHROPIC_API_KEY) {
      return reply.status(503).send({ code: ASSISTANT_OFF_CODE, error: ASSISTANT_OFF });
    }
    if (request.user.role !== 'clinician') return reply.status(403).send({ error: 'clinicians use the locating assistant' });

    const body = bodySchema.safeParse(request.body);
    // Field names only — a zod message can quote the value it rejected, and
    // the note is in this payload.
    if (!body.success) {
      return reply.status(400).send({ error: 'invalid payload', fields: body.error.issues.map((i) => i.path.join('.')) });
    }
    const b = body.data;
    if (b.clientId === request.user.id) return reply.status(400).send({ error: 'invalid payload', fields: ['clientId'] });

    // The link, before the note goes anywhere. RLS would refuse the row write
    // afterwards, but by then the note has already left the building.
    const link = await withUser(request.user, async (tx) => {
      const [row] = await tx
        .select({ id: schema.clinicianClientLinks.id })
        .from(schema.clinicianClientLinks)
        .where(
          and(
            eq(schema.clinicianClientLinks.clinicianId, request.user.id),
            eq(schema.clinicianClientLinks.clientId, b.clientId),
            eq(schema.clinicianClientLinks.status, 'active'),
          ),
        );
      return row ?? null;
    });
    if (!link) return reply.status(403).send({ error: 'no active link with this client' });

    let out;
    try {
      out = await locate(b.note);
    } catch (err) {
      // Both branches log a code and nothing else. A model error can quote the
      // request, and the request is the note.
      if (err instanceof LocateSchemaError) {
        request.log.warn({ event: 'locate.schema_rejected', reason: err.reason });
        return reply.status(502).send({ error: 'the assistant returned something unusable' });
      }
      request.log.error({ event: 'locate.failed', type: (err as Error).name });
      return reply.status(502).send({ error: 'the assistant could not be reached' });
    }

    const ids = out.observations.map((o) => o.id);
    const runId = newId();

    // The row: a hash, ids, a model name and a duration. Written before the
    // response, so a run that reached the model is recorded even if the
    // clinician never sees the answer.
    await withUser(request.user, (tx) =>
      tx.insert(schema.assistantRuns).values({
        id: runId,
        clinicianId: request.user.id,
        clientId: b.clientId,
        noteSha256: noteHash(b.note),
        observationIds: ids,
        gateQuestionIds: out.gateQuestions,
        model: out.model,
        latencyMs: out.latencyMs,
      }),
    );

    // Floors are computed here, from the ids, by the same function the browser
    // runs. The model never saw a floor and never emitted one. Gates are
    // treated as open: nothing the assistant returns can clear one, so the
    // scoring it hands back must not look as though something had.
    const located = locateFloors(ids, false);

    return reply.status(200).send({
      runId,
      observations: out.observations.map((o) => ({
        id: o.id,
        q: observation(o.id)?.q ?? null,
        evidence: o.evidence,
      })),
      gateQuestions: out.gateQuestions.map((k) => ({ id: k, question: GATE_QUESTIONS[k] })),
      selfReportOnly: out.selfReportOnly,
      scores: located.scores,
      // Null until the clinician attests the gates; the locator recomputes
      // with gatesOk once they have.
      floor: located.floor,
      model: out.model,
    });
  });
};

export default assistant;
