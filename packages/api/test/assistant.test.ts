/**
 * The locating assistant, switched on, through the route.
 *
 * `locate()` is mocked here — test/locate-contract.test.ts is where the model's
 * output is policed. This file is about everything around it: the link check
 * that happens before the note goes anywhere, the row that gets written, the
 * floors computed in code rather than by the model, and the fact that no part
 * of the note survives the request.
 *
 * Needs Postgres with the migrations applied.
 */
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';

const { locateMock } = vi.hoisted(() => ({ locateMock: vi.fn() }));

vi.hoisted(() => {
  process.env['ASSISTANT_ENABLED'] = 'true';
  process.env['ANTHROPIC_API_KEY'] ??= 'test-key-not-a-real-one';
  process.env['AUTH_TEST_MODE'] ??= 'true';
});

vi.mock('../src/services/ai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/ai.js')>();
  return { ...actual, locate: locateMock };
});

// Static imports are safe: vitest hoists vi.mock and vi.hoisted above them.
import { closeDb } from '../src/db/client.js';
import { LocateSchemaError } from '../src/services/ai.js';
import { noteHash } from '../src/routes/assistant.js';
import { observation } from '@ledger/shared';
import { ADMIN_URL, CLIENT_A, CLIENT_B, CLINICIAN, LogSink, asUser, buildApp, truncateAll } from './helpers.js';

/** The columns proposal 02 §3 allows, plus the gate keys migration 0004 adds. */
const ROW_SHAPE = [
  'client_id',
  'clinician_id',
  'created_at',
  'gate_question_ids',
  'id',
  'latency_ms',
  'model',
  'note_sha256',
  'observation_ids',
];

const NOTE =
  'ZQX-NOTE-9201 She could recite the whole formulation back to me and it changed nothing. ' +
  'ZQX-NOTE-9202 Twice she flinched before I had finished the sentence.';
const RECITE = 'recite the whole formulation back to me and it changed nothing';
const FLINCH = 'flinched before I had finished the sentence';

const ANSWER = {
  observations: [
    { id: 'insight-does-not-move', evidence: [RECITE] },
    { id: 'reaction-before-thought', evidence: [FLINCH] },
  ],
  gateQuestions: ['risk', 'calibrated'],
  selfReportOnly: false,
  model: 'claude-test-model',
  latencyMs: 42,
};

let app: FastifyInstance;
let sink: LogSink;
let admin: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
});
afterAll(async () => {
  await admin.end();
  await closeDb();
});

beforeEach(async () => {
  locateMock.mockReset();
  locateMock.mockResolvedValue(ANSWER);
  // A fresh app per test: @fastify/rate-limit keeps its counters in a store
  // created at registration, and the 30-an-hour cap has its own test below.
  sink = new LogSink();
  app = await buildApp(sink);
  await truncateAll();
  await admin.query(`INSERT INTO users (id, role) VALUES ($1,'client'), ($2,'client'), ($3,'clinician')`, [
    CLIENT_A,
    CLIENT_B,
    CLINICIAN,
  ]);
});
afterEach(async () => {
  await app.close();
});

/** An active link from CLINICIAN to `who`, made the way a real one is made. */
async function link(who = CLIENT_A): Promise<void> {
  const made = await app.inject({
    method: 'POST',
    url: '/v1/invites',
    headers: asUser(CLINICIAN, 'clinician'),
    payload: {},
  });
  const { token } = made.json() as { token: string };
  const redeemed = await app.inject({
    method: 'POST',
    url: '/v1/invites/redeem',
    headers: asUser(who, 'client'),
    payload: { token },
  });
  expect(redeemed.statusCode).toBe(200);
}

const post = (payload: Record<string, unknown>, who = CLINICIAN, role: 'client' | 'clinician' = 'clinician') =>
  app.inject({ method: 'POST', url: '/v1/assistant/locate', headers: asUser(who, role), payload });

describe('POST /v1/assistant/locate', () => {
  it('writes exactly the columns the proposal allows, and no others', async () => {
    await link();
    const res = await post({ clientId: CLIENT_A, note: NOTE });
    expect(res.statusCode).toBe(200);

    const row = (await admin.query(`SELECT * FROM assistant_runs`)).rows[0]!;
    expect(Object.keys(row).sort()).toEqual(ROW_SHAPE);
  });

  it('stores the note as a 32-byte hash and stores no part of the note itself', async () => {
    await link();
    await post({ clientId: CLIENT_A, note: NOTE });

    const row = (await admin.query(`SELECT * FROM assistant_runs`)).rows[0]!;
    expect(Buffer.from(row.note_sha256)).toEqual(noteHash(NOTE));
    expect(Buffer.from(row.note_sha256)).toHaveLength(32);

    // Nothing recognisable from the note, and no evidence span, anywhere.
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain('ZQX-NOTE-9201');
    expect(serialised).not.toContain('ZQX-NOTE-9202');
    expect(serialised).not.toContain(RECITE);
    expect(serialised).not.toContain(FLINCH);
    expect(serialised).not.toContain('flinched');
  });

  it('stores the observation ids, the gate keys, the model and the timing', async () => {
    await link();
    await post({ clientId: CLIENT_A, note: NOTE });

    const row = (await admin.query(`SELECT * FROM assistant_runs`)).rows[0]!;
    expect(row.observation_ids).toEqual(['insight-does-not-move', 'reaction-before-thought']);
    expect(row.gate_question_ids).toEqual(['risk', 'calibrated']);
    expect(row.model).toBe('claude-test-model');
    expect(row.latency_ms).toBe(42);
    expect(row.clinician_id).toBe(CLINICIAN);
    expect(row.client_id).toBe(CLIENT_A);
  });

  it('computes the floors in code and leaves the floor null while the gates are open', async () => {
    await link();
    const res = await post({ clientId: CLIENT_A, note: NOTE });
    const body = res.json() as { scores: Record<string, number>; floor: number | null };

    // insight-does-not-move and reaction-before-thought both weight floor 3
    // down and 6 up; the numbers come from @ledger/shared, not from the model.
    expect(Object.keys(body.scores)).toHaveLength(8);
    expect(body.floor).toBeNull();
  });

  it('returns the spans the model quoted and the wording from our own table, not the model', async () => {
    await link();
    const res = await post({ clientId: CLIENT_A, note: NOTE });
    const body = res.json() as {
      observations: { id: string; q: string; evidence: string[] }[];
      gateQuestions: { id: string; question: string }[];
    };

    expect(body.observations[0]!.evidence).toEqual([RECITE]);
    // The wording is whatever @ledger/shared says it is. Asserting it against
    // the module rather than against a word is the whole point: the model does
    // not supply this string and cannot change it.
    expect(body.observations[0]!.q).toBe(observation('insight-does-not-move')!.q);
    expect(body.gateQuestions.map((g) => g.id)).toEqual(['risk', 'calibrated']);
    expect(body.gateQuestions[0]!.question).toMatch(/acute risk/i);
  });

  it('refuses a client', async () => {
    await link();
    const res = await post({ clientId: CLIENT_A, note: NOTE }, CLIENT_A, 'client');
    expect(res.statusCode).toBe(403);
    expect(locateMock).not.toHaveBeenCalled();
  });

  it('refuses a clinician with no active link, before the note reaches the model', async () => {
    const res = await post({ clientId: CLIENT_B, note: NOTE });
    expect(res.statusCode).toBe(403);
    expect(locateMock).not.toHaveBeenCalled();
    expect((await admin.query(`SELECT * FROM assistant_runs`)).rowCount).toBe(0);
  });

  it('refuses a revoked link, and writes nothing', async () => {
    await link();
    await admin.query(`UPDATE clinician_client_links SET status = 'revoked'`);
    const res = await post({ clientId: CLIENT_A, note: NOTE });
    expect(res.statusCode).toBe(403);
    expect(locateMock).not.toHaveBeenCalled();
  });

  it('refuses a clinician naming themselves as the client', async () => {
    const res = await post({ clientId: CLINICIAN, note: NOTE });
    expect(res.statusCode).toBe(400);
    expect(locateMock).not.toHaveBeenCalled();
  });

  it('names the field and not the value when the payload is wrong', async () => {
    const res = await post({ clientId: CLIENT_A, note: '' });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('ZQX');
    expect(res.json()).toMatchObject({ fields: ['note'] });
  });

  it('returns 502 and writes no row when the model breaks the contract', async () => {
    await link();
    locateMock.mockRejectedValue(new LocateSchemaError('observations.0.id:invalid_enum_value'));
    const res = await post({ clientId: CLIENT_A, note: NOTE });

    expect(res.statusCode).toBe(502);
    expect((await admin.query(`SELECT * FROM assistant_runs`)).rowCount).toBe(0);
    // The reason is a field path and a code; it is safe to log and is logged.
    expect(sink.text()).toContain('locate.schema_rejected');
  });

  it('returns 502 and writes no row when the model cannot be reached', async () => {
    await link();
    locateMock.mockRejectedValue(new Error('socket hang up'));
    const res = await post({ clientId: CLIENT_A, note: NOTE });

    expect(res.statusCode).toBe(502);
    expect((await admin.query(`SELECT * FROM assistant_runs`)).rowCount).toBe(0);
  });

  it('caps runs at thirty an hour, per clinician', async () => {
    await link();
    for (let i = 0; i < 30; i++) {
      expect((await post({ clientId: CLIENT_A, note: `${NOTE} ${i}` })).statusCode).toBe(200);
    }
    expect((await post({ clientId: CLIENT_A, note: NOTE })).statusCode).toBe(429);
  });

  it('puts no part of the note, and no evidence span, into the log', async () => {
    await link();
    await post({ clientId: CLIENT_A, note: NOTE });
    await post({ clientId: CLIENT_A, note: '' });
    locateMock.mockRejectedValue(new Error('socket hang up'));
    await post({ clientId: CLIENT_A, note: NOTE });

    const logged = sink.text();
    for (const needle of ['ZQX-NOTE-9201', 'ZQX-NOTE-9202', RECITE, FLINCH, 'flinched', 'recite']) {
      expect(logged, needle).not.toContain(needle);
    }
  });
});
