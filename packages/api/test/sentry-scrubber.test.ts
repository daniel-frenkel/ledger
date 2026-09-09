/**
 * No PHI in Sentry, ever.
 *
 * phi-logs.test.ts covers pino. This covers the other sink, and it is the same
 * shape of test: seed an event with distinctive strings in every field that
 * could carry what a person typed, run the scrubber, and grep the whole
 * serialised result. If a seed survives anywhere, the build fails.
 *
 * Needs no database and no DSN — scrubEvent is a pure function, which is the
 * reason it was pulled out of the Sentry.init closure.
 */
import { describe, expect, it } from 'vitest';
import { REDACTED, scrubEvent } from '../src/plugins/sentry.js';

/** Distinctive enough that a substring match cannot be a coincidence. */
const SEEDS = {
  message: 'ZQX-MESSAGE-9001 telling the sergeant I froze',
  exception: 'ZQX-EXCEPTION-9002 he will call me a coward',
  body: 'ZQX-BODY-9003 I want to die',
  extra: 'ZQX-EXTRA-9004 if I show weakness they withdraw',
  crumb: 'ZQX-CRUMB-9005 he nodded and said same',
  crumbData: 'ZQX-CRUMBDATA-9006 the room where it happened',
  user: 'ZQX-USER-9007 daniel@example.com',
  cookie: 'ZQX-COOKIE-9008',
  header: 'ZQX-HEADER-9009',
  query: 'ZQX-QUERY-9010',
  url: 'ZQX-URL-9011',
  context: 'ZQX-CONTEXT-9012',
  frameVar: 'ZQX-FRAMEVAR-9013',
  tag: 'ZQX-TAG-9014',
  logentry: 'ZQX-LOGENTRY-9015',
  transaction: 'ZQX-TRANSACTION-9016',
};

/** An event with a seed in every field that could carry free text. */
const seededEvent = () => ({
  event_id: 'abc123',
  timestamp: 1788968560,
  platform: 'node',
  environment: 'test',
  message: SEEDS.message,
  transaction: `/v1/sync ${SEEDS.transaction}`,
  logentry: { message: SEEDS.logentry, params: [SEEDS.logentry] },
  exception: {
    values: [
      {
        type: 'ZodError',
        value: SEEDS.exception,
        stacktrace: {
          frames: [
            {
              filename: '/app/src/services/sync.ts',
              function: 'syncPush',
              lineno: 73,
              vars: { situation: SEEDS.frameVar },
            },
          ],
        },
      },
    ],
  },
  request: {
    method: 'POST',
    url: `https://api.example.com/v1/sync?note=${SEEDS.url}`,
    data: { situation: SEEDS.body },
    headers: { authorization: `Bearer ${SEEDS.header}`, 'user-agent': 'x' },
    cookies: { session: SEEDS.cookie },
    query_string: `note=${SEEDS.query}`,
    env: { REMOTE_ADDR: '203.0.113.7' },
  },
  user: { id: SEEDS.user, email: SEEDS.user, ip_address: '203.0.113.7' },
  extra: { prediction: SEEDS.extra },
  contexts: { user: { note: SEEDS.context }, trace: { note: SEEDS.context } },
  tags: { route: '/v1/sync', situation: SEEDS.tag },
  breadcrumbs: [
    {
      category: 'http',
      level: 'info',
      timestamp: 1788968560,
      type: 'http',
      message: SEEDS.crumb,
      data: { body: SEEDS.crumbData },
    },
  ],
  attachments: [{ filename: 'body.json', data: SEEDS.body }],
});

const serialise = (v: unknown) => JSON.stringify(v);

describe('scrubEvent', () => {
  it('lets no seeded string through, anywhere in the event', () => {
    const out = serialise(scrubEvent(seededEvent()));
    for (const [field, seed] of Object.entries(SEEDS)) {
      expect(out, `${field} survived`).not.toContain(seed);
    }
    // And nothing that merely looks like one.
    expect(out).not.toMatch(/ZQX-/);
  });

  it('redacts the message rather than deleting it', () => {
    // An error class with no message at all is harder to triage than one that
    // says its message was withheld.
    const out = scrubEvent(seededEvent()) as Record<string, unknown>;
    expect(out['message']).toBe(REDACTED);
    expect(out['logentry']).toEqual({ message: REDACTED });
  });

  it('keeps the exception type and the stack, and redacts the value', () => {
    const out = scrubEvent(seededEvent()) as Record<string, unknown>;
    const v = (out['exception'] as { values: Record<string, unknown>[] }).values[0]!;
    expect(v['type']).toBe('ZodError');
    expect(v['value']).toBe(REDACTED);
    const frame = (v['stacktrace'] as { frames: Record<string, unknown>[] }).frames[0]!;
    expect(frame['filename']).toBe('/app/src/services/sync.ts');
    expect(frame['function']).toBe('syncPush');
    expect(frame['lineno']).toBe(73);
    expect(frame).not.toHaveProperty('vars');
  });

  it('keeps the route tag and drops every other tag', () => {
    const out = scrubEvent(seededEvent()) as Record<string, unknown>;
    expect(out['tags']).toEqual({ route: '/v1/sync' });
  });

  it('keeps breadcrumb shape and drops breadcrumb content', () => {
    const out = scrubEvent(seededEvent()) as Record<string, unknown>;
    expect(out['breadcrumbs']).toEqual([
      { category: 'http', level: 'info', timestamp: 1788968560, type: 'http' },
    ]);
  });

  it('removes the request body, headers, cookies, query string and URL', () => {
    const out = scrubEvent(seededEvent()) as Record<string, unknown>;
    const req = out['request'] as Record<string, unknown>;
    expect(req['method']).toBe('POST');
    for (const k of ['data', 'headers', 'cookies', 'query_string', 'url', 'env']) {
      expect(req, k).not.toHaveProperty(k);
    }
  });

  it('removes user, extra, contexts and attachments outright', () => {
    const out = scrubEvent(seededEvent()) as Record<string, unknown>;
    for (const k of ['user', 'extra', 'contexts', 'attachments']) {
      expect(out, k).not.toHaveProperty(k);
    }
  });

  it('keeps what makes an event worth having', () => {
    const out = scrubEvent(seededEvent()) as Record<string, unknown>;
    expect(out['event_id']).toBe('abc123');
    expect(out['environment']).toBe('test');
    expect(out['platform']).toBe('node');
    expect(out['timestamp']).toBe(1788968560);
  });

  it('survives an event that is missing everything', () => {
    expect(() => scrubEvent({})).not.toThrow();
    expect(scrubEvent({})).toEqual({});
    expect(() => scrubEvent({ exception: { values: [] } })).not.toThrow();
    expect(() => scrubEvent({ request: {}, breadcrumbs: [] })).not.toThrow();
  });

  it('does not invent fields it was not given', () => {
    // A scrubber that adds `tags: {}` to an event with no tags is noise.
    expect(scrubEvent({ event_id: 'x' })).toEqual({ event_id: 'x' });
  });
});
