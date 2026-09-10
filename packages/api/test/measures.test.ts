/**
 * Measures, and "how much does this one count?" through the routes.
 *
 * The arithmetic is tested in @ledger/shared. What is proved here is the trust
 * model around it: who may write a measure about whom, that a clinician cannot
 * write one for a client they do not hold a link to, that a score cannot be
 * revised once written, and that `counts_for` survives a sync round trip
 * without being invented for a hit.
 *
 * Needs Postgres with the migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { INSTRUMENT_SPECS } from '@ledger/shared';
import { closeDb } from '../src/db/client.js';
import { NO_ACTIVE_LINK } from '../src/routes/measures.js';
import {
  ADMIN_URL,
  acceptBaa,
  CLIENT_A,
  CLIENT_B,
  CLINICIAN,
  DEVICE_A,
  LogSink,
  asUser,
  buildApp,
  truncateAll,
  uid,
} from './helpers.js';

let app: FastifyInstance;
let sink: LogSink;
let admin: pg.Client;

const T = '2026-09-01T18:00:00.000Z';

const IMS = {
  instrument: 'ims',
  score: 42,
  subscales: { negative_expectations: 12, assimilation: 15, cognitive_immunization: 15 },
  administeredAt: T,
};

beforeAll(async () => {
  admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
});
afterAll(async () => {
  await admin.end();
  await closeDb();
});

beforeEach(async () => {
  sink = new LogSink();
  app = await buildApp(sink);
  await truncateAll();
  await admin.query(`INSERT INTO users (id, role) VALUES ($1,'client'), ($2,'client'), ($3,'clinician')`, [
    CLIENT_A,
    CLIENT_B,
    CLINICIAN,
  ]);
  await acceptBaa([CLINICIAN]);
});
afterEach(async () => {
  await app.close();
});

async function link(who = CLIENT_A): Promise<void> {
  const made = await app.inject({
    method: 'POST',
    url: '/v1/invites',
    headers: asUser(CLINICIAN, 'clinician'),
    payload: {},
  });
  const { token } = made.json() as { token: string };
  const done = await app.inject({
    method: 'POST',
    url: '/v1/invites/redeem',
    headers: asUser(who, 'client'),
    payload: { token },
  });
  expect(done.statusCode).toBe(200);
}

const postMeasure = (payload: Record<string, unknown>, who: string, role: 'client' | 'clinician') =>
  app.inject({ method: 'POST', url: '/v1/measures', headers: asUser(who, role), payload });

describe('POST /v1/measures', () => {
  it('lets a client record their own, with no clinician on the row', async () => {
    const res = await postMeasure(
      { measure: { ...IMS, administeredBy: 'client' } },
      CLIENT_A,
      'client',
    );
    expect(res.statusCode).toBe(201);

    const row = (await admin.query(`SELECT * FROM measures`)).rows[0]!;
    expect(row.client_id).toBe(CLIENT_A);
    expect(row.clinician_id).toBeNull();
    expect(row.administered_by).toBe('client');
    expect(Number(row.score)).toBe(42);
    expect(row.subscales).toEqual(IMS.subscales);
  });

  it('lets a clinician record one through an active link, naming themselves', async () => {
    await link();
    const res = await postMeasure(
      { clientId: CLIENT_A, measure: { ...IMS, administeredBy: 'clinician' } },
      CLINICIAN,
      'clinician',
    );
    expect(res.statusCode).toBe(201);

    const row = (await admin.query(`SELECT * FROM measures`)).rows[0]!;
    expect(row.client_id).toBe(CLIENT_A);
    expect(row.clinician_id).toBe(CLINICIAN);
    expect(row.administered_by).toBe('clinician');
  });

  it('refuses a clinician with no active link', async () => {
    const res = await postMeasure(
      { clientId: CLIENT_B, measure: { ...IMS, administeredBy: 'clinician' } },
      CLINICIAN,
      'clinician',
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: NO_ACTIVE_LINK });
    expect((await admin.query(`SELECT * FROM measures`)).rowCount).toBe(0);
  });

  it('refuses a client claiming a clinician administered it', async () => {
    const res = await postMeasure(
      { measure: { ...IMS, administeredBy: 'clinician' } },
      CLIENT_A,
      'client',
    );
    expect(res.statusCode).toBe(422);
  });

  it('refuses a clinician writing a measure about themselves', async () => {
    const res = await postMeasure(
      { clientId: CLINICIAN, measure: { ...IMS, administeredBy: 'clinician' } },
      CLINICIAN,
      'clinician',
    );
    expect(res.statusCode).toBe(400);
  });

  it('refuses a total outside the published range, and names the range not the value', async () => {
    const res = await postMeasure(
      { measure: { ...IMS, instrument: 'phq9', score: 47, subscales: null, administeredBy: 'client' } },
      CLIENT_A,
      'client',
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ detail: `PHQ-9 totals run 0–${INSTRUMENT_SPECS.phq9.max}` });
    expect(res.body).not.toContain('47');
  });

  it('refuses a subscale the instrument does not publish', async () => {
    const res = await postMeasure(
      { measure: { ...IMS, subscales: { rumination: 9 }, administeredBy: 'client' } },
      CLIENT_A,
      'client',
    );
    expect(res.statusCode).toBe(400);
  });

  it('is append-only: a score cannot be revised once written', async () => {
    await postMeasure({ measure: { ...IMS, administeredBy: 'client' } }, CLIENT_A, 'client');
    await expect(admin.query(`UPDATE measures SET score = 1`)).rejects.toThrow(/append-only/);
  });

  it('lets a client read their own, including one their clinician administered', async () => {
    await link();
    await postMeasure(
      { clientId: CLIENT_A, measure: { ...IMS, administeredBy: 'clinician' } },
      CLINICIAN,
      'clinician',
    );
    const res = await app.inject({ method: 'GET', url: '/v1/measures', headers: asUser(CLIENT_A) });
    const rows = res.json() as { instrument: string; score: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ instrument: 'ims', score: 42 });
  });

  it('shows a clinician nothing once the link is revoked', async () => {
    await link();
    await postMeasure(
      { clientId: CLIENT_A, measure: { ...IMS, administeredBy: 'clinician' } },
      CLINICIAN,
      'clinician',
    );
    await admin.query(`UPDATE clinician_client_links SET status = 'revoked'`);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/clients/${CLIENT_A}/measures`,
      headers: asUser(CLINICIAN, 'clinician'),
    });
    expect(res.json()).toEqual([]);
    // The client still sees it. It is a score about them.
    const own = await app.inject({ method: 'GET', url: '/v1/measures', headers: asUser(CLIENT_A) });
    expect(own.json()).toHaveLength(1);
  });
});

describe('counts_for through sync', () => {
  const pred = (over: Record<string, unknown> = {}) => ({
    id: uid(701),
    situation: 'a situation',
    expectedOutcome: 'an expectation',
    confidence: 80,
    priorIds: [],
    resolvedAt: T,
    actualOutcome: 'what happened',
    outcomeVerdict: 'miss',
    outcomeSource: 'observed',
    surpriseRating: 8,
    presentForIt: true,
    createdAt: T,
    clientUpdatedAt: T,
    ...over,
  });

  /** One sync is a push and a pull: the response carries the rows back. */
  const sync = (predictions: unknown[], since?: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/sync',
      headers: asUser(CLIENT_A),
      payload: { deviceId: DEVICE_A, predictions, ...(since ? { since } : {}) },
    });

  it('stores the answer and reads it back', async () => {
    const res = await sync([pred({ countsFor: 20 })]);
    expect(res.statusCode).toBe(200);
    expect((await admin.query(`SELECT counts_for FROM predictions`)).rows[0]!.counts_for).toBe(20);

    // The push response is the pull: the row comes back through the codec.
    const body = res.json() as { predictions: { countsFor: number | null }[] };
    expect(body.predictions[0]!.countsFor).toBe(20);
  });

  it('stores null when the question was skipped, and never a hundred', async () => {
    await sync([pred({})]);
    expect((await admin.query(`SELECT counts_for FROM predictions`)).rows[0]!.counts_for).toBeNull();
  });

  it('refuses a value outside 0–100', async () => {
    expect((await sync([pred({ countsFor: 140 })])).statusCode).toBe(400);
    expect((await admin.query(`SELECT * FROM predictions`)).rowCount).toBe(0);
  });

  it('is refused by the database too, straight past the API', async () => {
    await sync([pred({ countsFor: 20 })]);
    await expect(admin.query(`UPDATE predictions SET counts_for = 200`)).rejects.toThrow(
      /predictions_counts_for_range/,
    );
  });

  it('reaches the clinician summary view, which carries no prose', async () => {
    await sync([pred({ countsFor: 20 })]);
    const cols = await admin.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'predictions_summary'`,
    );
    const names = cols.rows.map((r: { column_name: string }) => r.column_name);
    expect(names).toContain('counts_for');
    // The view still carries nothing a client typed.
    for (const prose of ['situation_enc', 'actual_outcome_enc', 'expected_outcome_enc']) {
      expect(names).not.toContain(prose);
    }
  });

  it('puts no part of the answer or the note in the log', async () => {
    await sync([pred({ countsFor: 20, situation: 'ZQX-COUNTS-9401 the meeting with my supervisor' })]);
    expect(sink.text()).not.toContain('ZQX-COUNTS-9401');
    expect(sink.text()).not.toContain('supervisor');
  });
});
