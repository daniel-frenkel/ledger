/**
 * Sentry with PII scrubbing. Disabled when SENTRY_DSN is empty.
 * beforeSend drops request bodies, headers, cookies, user context, and any
 * breadcrumb data — we keep error type, message, stack, and route.
 */
import * as Sentry from '@sentry/node';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

export function initSentry(): boolean {
  const c = config();
  if (!c.SENTRY_DSN) return false;
  Sentry.init({
    dsn: c.SENTRY_DSN,
    environment: c.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.query_string;
      }
      delete event.user;
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => {
          const out: (typeof event.breadcrumbs)[number] = {};
          if (b.category) out.category = b.category;
          if (b.level) out.level = b.level;
          if (b.timestamp) out.timestamp = b.timestamp;
          return out;
        });
      }
      if (event.extra) delete event.extra;
      if (event.contexts) delete event.contexts['user'];
      return event;
    },
  });
  return true;
}

const sentryPlugin: FastifyPluginAsync = async (app) => {
  if (!initSentry()) return;
  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) Sentry.captureException(err, { tags: { route: request.routeOptions?.url ?? 'unknown' } });
    reply.status(status).send({ error: status >= 500 ? 'internal error' : err.message });
  });
};

export default fp(sentryPlugin, { name: 'sentry' });
