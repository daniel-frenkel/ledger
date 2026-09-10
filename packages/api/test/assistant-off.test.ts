/**
 * The assistant ships off, and off means no model call.
 *
 * Its own file because the config is read once per process: this one leaves
 * ASSISTANT_ENABLED unset, which is what a deployment gets if nobody touches
 * it, and asserts the route is closed and the SDK never used. The enabled path
 * is test/assistant.test.ts.
 *
 * No database — the 503 is returned before any query runs, which is the point.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { create, constructed } = vi.hoisted(() => ({ create: vi.fn(), constructed: vi.fn() }));

vi.hoisted(() => {
  // Unset is the state a deployment gets if nobody touches it, and the state
  // under test. CI sets neither, but a developer's .env might.
  delete process.env['ASSISTANT_ENABLED'];
  // This file needs no database, so it should run on a machine that has none.
  // CI sets this for the whole suite; config.ts refuses it in production.
  process.env['AUTH_TEST_MODE'] ??= 'true';
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
    constructor(opts: unknown) {
      constructed(opts);
    }
  },
}));

// Static imports are safe: vitest hoists vi.mock and vi.hoisted above them.
import { closeDb } from '../src/db/client.js';
import { ASSISTANT_OFF, ASSISTANT_OFF_CODE } from '../src/routes/assistant.js';
import { CLIENT_A, CLINICIAN, LogSink, asUser, buildApp } from './helpers.js';

let app: FastifyInstance;
let sink: LogSink;

beforeEach(async () => {
  create.mockReset();
  constructed.mockReset();
  sink = new LogSink();
  app = await buildApp(sink);
});
afterAll(async () => {
  await closeDb();
});

const post = (payload: Record<string, unknown>, who = CLINICIAN, role: 'client' | 'clinician' = 'clinician') =>
  app.inject({ method: 'POST', url: '/v1/assistant/locate', headers: asUser(who, role), payload });

describe('POST /v1/assistant/locate, with the assistant off', () => {
  it('returns 503 with a stable code, and never builds a client or calls the model', async () => {
    const res = await post({ clientId: CLIENT_A, note: 'anything at all' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: ASSISTANT_OFF_CODE, error: ASSISTANT_OFF });
    expect(constructed).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('says the same thing to a clinician with no link, so the switch leaks nothing about the caseload', async () => {
    const a = await post({ clientId: CLIENT_A, note: 'a note' });
    const b = await post({ clientId: '00000000-0000-4000-8000-000000009999', note: 'a note' });
    expect(a.statusCode).toBe(503);
    expect(b.body).toEqual(a.body);
  });

  it('refuses before validating the payload, so a malformed body cannot probe the route', async () => {
    const res = await post({ note: 42 });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: ASSISTANT_OFF_CODE, error: ASSISTANT_OFF });
  });

  it('still refuses an unauthenticated caller with a 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/assistant/locate', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('puts no part of the note in the log', async () => {
    const note = 'ZQX-OFFNOTE-9101 she went quiet when I asked about her father';
    await post({ clientId: CLIENT_A, note });
    expect(sink.text()).not.toContain('ZQX-OFFNOTE-9101');
    expect(sink.text()).not.toContain('her father');
  });
});
