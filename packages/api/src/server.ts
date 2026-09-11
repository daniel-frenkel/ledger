import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { config, corsOrigins } from './config.js';
import { loggerOptions } from './logging/logger.js';
import authPlugin from './plugins/auth.js';
import sentryPlugin from './plugins/sentry.js';
import health from './routes/health.js';
import syncRoute from './routes/sync.js';
import links from './routes/links.js';
import invites from './routes/invites.js';
import formulations from './routes/formulations.js';
import ai from './routes/ai.js';
import assistant from './routes/assistant.js';
import stack from './routes/stack.js';
import measures from './routes/measures.js';
import me from './routes/me.js';

export async function build(opts: { logger?: FastifyInstance['log'] } = {}): Promise<FastifyInstance> {
  const c = config();
  const app = Fastify({
    ...(opts.logger ? { loggerInstance: opts.logger } : { logger: loggerOptions() }),
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    // Request ids are the only per-request identifier that reaches logs.
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet);
  // An exact allowlist, in every environment. This used to be `false` in
  // production and `true` everywhere else, which meant production sent no CORS
  // headers at all — the client PWA on its own hostname could not have called
  // the API from a browser once the two were split across subdomains.
  await app.register(cors, { origin: corsOrigins(c) });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(sensible);
  await app.register(sentryPlugin);
  await app.register(authPlugin);

  await app.register(health);
  await app.register(syncRoute);
  await app.register(links);
  await app.register(invites);
  await app.register(formulations);
  await app.register(ai);
  await app.register(assistant);
  await app.register(stack);
  await app.register(measures);
  await app.register(me);

  // Default error handler when Sentry is off: never leak internals.
  if (!c.SENTRY_DSN) {
    app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
      const status = err.statusCode ?? 500;
      // Name and driver code only: a database error message can quote a value.
      if (status >= 500) app.log.error({ err: { type: err.name, code: (err as { code?: string }).code ?? null } });
      reply.status(status).send({ error: status >= 500 ? 'internal error' : err.message });
    });
  }

  return app;
}
