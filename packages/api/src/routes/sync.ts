/**
 * POST /v1/sync — push local changes, pull server changes. Clients only.
 */
import type { FastifyPluginAsync } from 'fastify';
import { syncPushSchema } from '@ledger/shared';
import { sync } from '../services/sync.js';

const syncRoute: FastifyPluginAsync = async (app) => {
  app.post('/v1/sync', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (request.user.role !== 'client') return reply.status(403).send({ error: 'clients only' });
    const parsed = syncPushSchema.safeParse(request.body);
    if (!parsed.success) {
      // Field paths only — never echo values back.
      return reply.status(400).send({ error: 'invalid payload', issues: parsed.error.issues.map((i) => i.path.join('.')) });
    }
    const result = await sync(request.user, parsed.data);
    request.log.info({ route: 'sync', pushed: countPush(parsed.data), pulled: countPull(result), rejected: result.rejected.length });
    return result;
  });
};

function countPush(p: ReturnType<typeof syncPushSchema.parse>): number {
  return p.predictions.length + p.bodyStates.length + p.reinterpretations.length + p.priors.length + p.journalEntries.length + p.crisisEvents.length;
}
function countPull(r: Awaited<ReturnType<typeof sync>>): number {
  return r.predictions.length + r.bodyStates.length + r.reinterpretations.length + r.priors.length + r.journalEntries.length + r.crisisEvents.length;
}

export default syncRoute;
