import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { OUTCOME_VERDICTS, detectRiskInEntry } from '@ledger/shared';
import { explainMismatch, reflectivePrompt } from '../services/ai.js';

const ai: FastifyPluginAsync = async (app) => {
  app.post('/v1/ai/why', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = z
      .object({
        expectedOutcome: z.string().min(1).max(4000),
        confidence: z.number().int().min(0).max(100),
        actualOutcome: z.string().min(1).max(4000),
        verdict: z.enum(OUTCOME_VERDICTS),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'invalid payload' });
    // The crisis check runs before any model call, same as everywhere else.
    const risk = detectRiskInEntry([body.data.expectedOutcome, body.data.actualOutcome]);
    if (risk.matched) return { text: null, crisis: risk };
    return { text: await explainMismatch(body.data), crisis: null };
  });

  app.post('/v1/ai/reflect', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = z.object({ entry: z.string().min(1).max(20000) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'invalid payload' });
    const risk = detectRiskInEntry([body.data.entry]);
    if (risk.matched) return { text: null, crisis: risk };
    return { text: await reflectivePrompt(body.data.entry), crisis: null };
  });
};
export default ai;
