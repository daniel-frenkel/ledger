/**
 * Sentry with PHI scrubbing. Disabled when SENTRY_DSN is empty.
 *
 * The standing rule is that free text from a user never reaches a log line, an
 * error message, a Sentry event, or a test fixture that gets printed. pino is
 * covered by test/phi-logs.test.ts. This is the other sink, and scrubEvent is
 * the whole of its guarantee, which is why it is an exported pure function
 * rather than an inline closure: test/sentry-scrubber.test.ts runs it directly.
 *
 * What survives an event: the error's *type*, the stack, the route pattern,
 * the environment, and breadcrumb shape (category, level, timestamp). That is
 * enough to find a bug.
 *
 * What does not: every field that can carry text a person typed. Messages and
 * exception values are redacted rather than deleted — an error class with no
 * message is still worth seeing, and a message is exactly where a validation
 * error tends to echo its input.
 */
import * as Sentry from '@sentry/node';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

export const REDACTED = '[redacted]';

/** Breadcrumb fields that cannot carry free text. Everything else is dropped. */
const BREADCRUMB_KEEP = ['category', 'level', 'timestamp', 'type'] as const;

type Loose = Record<string, unknown>;

/**
 * Strip everything from an event that could carry what a person typed.
 *
 * Written against the event as a plain object rather than against Sentry's
 * types: the shape is what matters, the guarantee has to survive a major
 * version bump, and a field this does not recognise is a field it should not
 * be silently keeping.
 */
export function scrubEvent<E extends object>(event: E): E {
  const e = event as Loose;

  // The message, wherever it lives.
  if (typeof e['message'] === 'string') e['message'] = REDACTED;
  if (e['logentry'] && typeof e['logentry'] === 'object') {
    e['logentry'] = { message: REDACTED };
  }

  // Exception values carry the thrown Error's message.
  const exception = e['exception'] as Loose | undefined;
  const values = exception?.['values'];
  if (Array.isArray(values)) {
    for (const v of values as Loose[]) {
      if (typeof v['value'] === 'string') v['value'] = REDACTED;
      // Local variables are off by default; make that not a matter of config.
      const frames = (v['stacktrace'] as Loose | undefined)?.['frames'];
      if (Array.isArray(frames)) for (const f of frames as Loose[]) delete f['vars'];
    }
  }

  // The request: body, headers, cookies, query string, and the URL, which
  // carries the path and anything appended to it.
  const request = e['request'] as Loose | undefined;
  if (request) {
    for (const k of ['data', 'headers', 'cookies', 'query_string', 'url', 'env']) delete request[k];
  }

  // The transaction name groups events in the UI and is normally the route
  // pattern Fastify matched — worth keeping, but it is a free-form string and
  // anything may set it, so it is kept only while it still looks like a route.
  if (typeof e['transaction'] === 'string' && !/^\/[A-Za-z0-9/_:.-]*$/.test(e['transaction'])) {
    e['transaction'] = REDACTED;
  }

  // Identity, and anything hung off the event by us or by an integration.
  delete e['user'];
  delete e['extra'];
  delete e['contexts'];
  delete e['attachments'];

  // Breadcrumbs keep their shape and lose their content.
  const crumbs = e['breadcrumbs'];
  if (Array.isArray(crumbs)) {
    e['breadcrumbs'] = (crumbs as Loose[]).map((b) => {
      const out: Loose = {};
      for (const k of BREADCRUMB_KEEP) if (b[k] !== undefined) out[k] = b[k];
      return out;
    });
  }

  // Tags are set by this file only, and only to a route *pattern*. Anything
  // else got there from an integration and is not worth the risk.
  const tags = e['tags'] as Loose | undefined;
  if (tags) e['tags'] = 'route' in tags ? { route: tags['route'] } : {};

  return event;
}

export function initSentry(): boolean {
  const c = config();
  if (!c.SENTRY_DSN) return false;
  Sentry.init({
    dsn: c.SENTRY_DSN,
    environment: c.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => {
      // Cheaper than scrubbing later, and it keeps the data out of the buffer
      // that a crash could otherwise flush.
      const out: Loose = {};
      for (const k of BREADCRUMB_KEEP) {
        const v = (crumb as Loose)[k];
        if (v !== undefined) out[k] = v;
      }
      return out as typeof crumb;
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
