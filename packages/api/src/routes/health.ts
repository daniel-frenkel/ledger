import type { FastifyPluginAsync } from 'fastify';
import { ping } from '../db/client.js';

const health: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_req, reply) => {
    try {
      const ok = await ping();
      return { ok, service: 'ledger-api' };
    } catch {
      return reply.status(503).send({ ok: false, service: 'ledger-api' });
    }
  });
  app.get('/', async () => ({ service: 'ledger-api', docs: 'https://github.com/daniel-frenkel/ledger' }));
};
export default health;
