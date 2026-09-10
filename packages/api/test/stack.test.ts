/**
 * The training stack, and the scope gate on a formulation.
 *
 * Two things are worth proving here rather than in @ledger/shared, where the
 * arithmetic already is: the reading rules are enforced by the database and not
 * only by the API, and the scope verdict on a formulation row is computed from
 * the clinician's own stack rather than accepted from the request.
 *
 * Needs Postgres with the migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { MODALITIES, TIER_IDS } from '@ledger/shared';
import { closeDb } from '../src/db/client.js';
import { SCOPE_NOT_ACKNOWLEDGED } from '../src/routes/formulations.js';
import { DUPLICATE_MODALITY, TIER_CAP, UNKNOWN_MODALITIES } from '../src/routes/stack.js';
import {
  ADMIN_URL,
  CLIENT_A,
  CLINICIAN,
  CLINICIAN_B,
  asUser,
  buildApp,
  truncateAll,
} from './helpers.js';

let app: FastifyInstance;
let admin: pg.Client;

const CLEARED = { risk: true, dial: true, calibrated: true };

beforeAll(async () => {
  admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
});
afterAll(async () => {
  await admin.end();
  await closeDb();
});

beforeEach(async () => {
  app = await buildApp();
  await truncateAll();
  await admin.query(`INSERT INTO users (id, role) VALUES ($1,'client'), ($2,'clinician'), ($3,'clinician')`, [
    CLIENT_A,
    CLINICIAN,
    CLINICIAN_B,
  ]);
});
afterEach(async () => {
  await app.close();
});

const putStack = (stack: unknown[], who = CLINICIAN) =>
  app.inject({
    method: 'PUT',
    url: '/v1/clinician/stack',
    headers: asUser(who, 'clinician'),
    payload: { stack },
  });

const getStack = (who = CLINICIAN) =>
  app.inject({ method: 'GET', url: '/v1/clinician/stack', headers: asUser(who, 'clinician') });

/** An active link, made the way a real one is. */
async function link(): Promise<void> {
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
    headers: asUser(CLIENT_A, 'client'),
    payload: { token },
  });
  expect(done.statusCode).toBe(200);
}

const formulate = (floor: number, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/v1/formulations',
    headers: asUser(CLINICIAN, 'clinician'),
    payload: {
      clientId: CLIENT_A,
      note: 'What I saw in the room.',
      falsify: 'A session where the pattern does not appear at all.',
      observations: [],
      gates: CLEARED,
      floor,
      ...extra,
    },
  });

describe('PUT /v1/clinician/stack', () => {
  it('stores a stack and reads it back with its coverage', async () => {
    const res = await putStack([
      { slug: 'act', tier: 'master' },
      { slug: 'cbt', tier: 'fluent' },
    ]);
    expect(res.statusCode).toBe(200);

    const got = (await getStack()).json() as {
      stack: { slug: string; tier: string }[];
      coverage: Record<string, string | null>;
    };
    expect(got.stack.map((s) => s.slug).sort()).toEqual(['act', 'cbt']);
    expect(got.coverage['5']).toBe('master');
    expect(got.coverage['4']).toBeNull();
  });

  it('replaces the stack whole: a modality left out is removed', async () => {
    await putStack([
      { slug: 'act', tier: 'master' },
      { slug: 'cbt', tier: 'fluent' },
    ]);
    await putStack([{ slug: 'act', tier: 'master' }]);

    const got = (await getStack()).json() as { stack: { slug: string }[] };
    expect(got.stack.map((s) => s.slug)).toEqual(['act']);
  });

  it('keeps created_at across a tier change, because an edit is not a new row', async () => {
    await putStack([{ slug: 'cbt', tier: 'literacy' }]);
    const first = (await admin.query(`SELECT id, created_at FROM clinician_modalities`)).rows[0]!;

    await putStack([{ slug: 'cbt', tier: 'fluent' }]);
    const second = (await admin.query(`SELECT id, created_at, tier FROM clinician_modalities`)).rows[0]!;

    expect(second.id).toBe(first.id);
    expect(second.created_at).toEqual(first.created_at);
    expect(second.tier).toBe('fluent');
  });

  it('accepts an empty stack, which is how you clear one', async () => {
    await putStack([{ slug: 'act', tier: 'master' }]);
    expect((await putStack([])).statusCode).toBe(200);
    expect((await admin.query(`SELECT * FROM clinician_modalities`)).rowCount).toBe(0);
  });

  it('refuses a slug that names no modality, and says which', async () => {
    const res = await putStack([{ slug: 'act', tier: 'master' }, { slug: 'emdr', tier: 'deep' }]);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: UNKNOWN_MODALITIES, unknown: ['emdr'] });
  });

  it('refuses the same modality twice', async () => {
    const res = await putStack([
      { slug: 'act', tier: 'master' },
      { slug: 'act', tier: 'fluent' },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: DUPLICATE_MODALITY });
  });

  it('refuses two Masters and two Deeps, by the reading rules', async () => {
    const twoMasters = await putStack([
      { slug: 'act', tier: 'master' },
      { slug: 'cbt', tier: 'master' },
    ]);
    expect(twoMasters.statusCode).toBe(422);
    expect(twoMasters.json()).toMatchObject({ error: TIER_CAP, fields: ['master'] });

    const twoDeeps = await putStack([
      { slug: 'experiential', tier: 'deep' },
      { slug: 'gestalt', tier: 'deep' },
    ]);
    expect(twoDeeps.statusCode).toBe(422);
  });

  it('is enforced by the database too, not only by the route', async () => {
    await putStack([{ slug: 'act', tier: 'master' }]);
    // Straight past the API, as the migration role.
    await expect(
      admin.query(
        `INSERT INTO clinician_modalities (id, clinician_id, modality_slug, tier)
         VALUES (gen_random_uuid(), $1, 'cbt', 'master')`,
        [CLINICIAN],
      ),
    ).rejects.toThrow(/clinician_modalities_one_master/);
  });

  it('refuses a tier that is not a tier', async () => {
    const res = await putStack([{ slug: 'act', tier: 'expert' }]);
    expect(res.statusCode).toBe(400);
  });

  it('refuses a client', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/clinician/stack',
      headers: asUser(CLIENT_A, 'client'),
      payload: { stack: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('is one clinician’s own: another clinician’s stack is not visible', async () => {
    await putStack([{ slug: 'act', tier: 'master' }], CLINICIAN);
    const other = (await getStack(CLINICIAN_B)).json() as { stack: unknown[] };
    expect(other.stack).toEqual([]);
  });

  it('serves the catalogue so the page ships no copy of the document', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/clinician/modalities',
      headers: asUser(CLINICIAN, 'clinician'),
    });
    const body = res.json() as { modalities: unknown[]; tiers: { id: string }[] };
    expect(body.modalities).toHaveLength(MODALITIES.length);
    expect(body.tiers.map((t) => t.id)).toEqual([...TIER_IDS]);
  });
});

describe('the scope gate on POST /v1/formulations', () => {
  it('writes a covered verdict with no acknowledgement asked for', async () => {
    await link();
    await putStack([{ slug: 'cbt', tier: 'fluent' }]); // floors 3 and 5

    const res = await formulate(3);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ scope: 'covered' });

    const row = (await admin.query(`SELECT scope, scope_ack FROM formulations`)).rows[0]!;
    expect(row.scope).toBe('covered');
    expect(row.scope_ack).toBe(false);
  });

  it('refuses an uncovered floor until the clinician says they know', async () => {
    await link();
    await putStack([{ slug: 'cbt', tier: 'fluent' }]);

    const refused = await formulate(7);
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ error: SCOPE_NOT_ACKNOWLEDGED, scope: 'uncovered', floor: 7 });
    expect((await admin.query(`SELECT * FROM formulations`)).rowCount).toBe(0);

    const written = await formulate(7, { scopeAck: true });
    expect(written.statusCode).toBe(201);
    const row = (await admin.query(`SELECT scope, scope_ack FROM formulations`)).rows[0]!;
    expect(row.scope).toBe('uncovered');
    expect(row.scope_ack).toBe(true);
  });

  it('calls working literacy a stretch, and asks for the same acknowledgement', async () => {
    await link();
    await putStack([{ slug: 'dbt', tier: 'literacy' }]); // floors 7 and 5, at literacy

    const refused = await formulate(7);
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ scope: 'stretch' });

    expect((await formulate(7, { scopeAck: true })).statusCode).toBe(201);
    expect((await admin.query(`SELECT scope FROM formulations`)).rows[0]!.scope).toBe('stretch');
  });

  it('computes the verdict from the stack and ignores anything the body claims', async () => {
    await link();
    await putStack([{ slug: 'cbt', tier: 'fluent' }]);

    // The body says "covered". The stack says otherwise, and the stack wins.
    const res = await formulate(7, { scopeAck: true, scope: 'covered' });
    expect(res.statusCode).toBe(201);
    expect((await admin.query(`SELECT scope FROM formulations`)).rows[0]!.scope).toBe('uncovered');
  });

  it('treats an empty stack as covering nothing', async () => {
    await link();
    const res = await formulate(3);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ scope: 'uncovered' });
  });

  it('reads the verdict back on the formulation list', async () => {
    await link();
    await putStack([{ slug: 'cbt', tier: 'fluent' }]);
    await formulate(3);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/clients/${CLIENT_A}/formulations`,
      headers: asUser(CLINICIAN, 'clinician'),
    });
    const rows = res.json() as { scope: string; scopeAck: boolean }[];
    expect(rows[0]).toMatchObject({ scope: 'covered', scopeAck: false });
  });

  it('is enforced by the database: an unacknowledged out-of-scope row is refused', async () => {
    await link();
    const linkId = (await admin.query(`SELECT id FROM clinician_client_links`)).rows[0]!.id;
    await expect(
      admin.query(
        `INSERT INTO formulations
           (id, clinician_id, client_id, link_id, version, note_enc, falsify_enc,
            observations, gates, floor, scope, scope_ack)
         VALUES (gen_random_uuid(), $1, $2, $3, 1, '\\x00'::bytea, '\\x00'::bytea,
            '[]'::jsonb, '{"risk":true,"dial":true,"calibrated":true}'::jsonb, 7, 'uncovered', false)`,
        [CLINICIAN, CLIENT_A, linkId],
      ),
    ).rejects.toThrow(/formulations_scope_acknowledged/);
  });
});
