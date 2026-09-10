/**
 * The training stack and the roadmap, through the routes.
 *
 * The coverage arithmetic is tested in @ledger/shared and the catalogue in
 * apps/clinician. What is proved here is the trust model and the two design
 * decisions that are easy to reverse by accident: the reading rules are
 * *warnings*, so a second Master is stored rather than refused, and the scope
 * gate annotates, so a formulation outside the stack is always written.
 *
 * Needs Postgres with the migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { MODALITY_SLUGS } from '@ledger/shared';
import { closeDb } from '../src/db/client.js';
import { DUPLICATE_MODALITY, UNKNOWN_MODALITIES } from '../src/routes/stack.js';
import { acceptBaa, ADMIN_URL, CLIENT_A, CLINICIAN, CLINICIAN_B, asUser, buildApp, truncateAll } from './helpers.js';

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
  await acceptBaa([CLINICIAN, CLINICIAN_B]);
});
afterEach(async () => {
  await app.close();
});

const putStack = (stack: unknown[], who = CLINICIAN) =>
  app.inject({ method: 'PUT', url: '/v1/clinician/stack', headers: asUser(who, 'clinician'), payload: { stack } });

const getStack = (who = CLINICIAN) =>
  app.inject({ method: 'GET', url: '/v1/clinician/stack', headers: asUser(who, 'clinician') });

const putGoals = (goals: unknown[], who = CLINICIAN) =>
  app.inject({
    method: 'PUT',
    url: '/v1/clinician/stack/goals',
    headers: asUser(who, 'clinician'),
    payload: { goals },
  });

const getGoals = (who = CLINICIAN) =>
  app.inject({ method: 'GET', url: '/v1/clinician/stack/goals', headers: asUser(who, 'clinician') });

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
  it('stores a stack and reads it back', async () => {
    expect(
      (
        await putStack([
          { slug: 'act', tier: 'master' },
          { slug: 'cbt', tier: 'fluent' },
        ])
      ).statusCode,
    ).toBe(200);

    const got = (await getStack()).json() as { stack: { slug: string; tier: string }[] };
    expect(got.stack.map((s) => s.slug).sort()).toEqual(['act', 'cbt']);
  });

  it('replaces the stack whole: a modality left out is removed', async () => {
    await putStack([
      { slug: 'act', tier: 'master' },
      { slug: 'cbt', tier: 'fluent' },
    ]);
    await putStack([{ slug: 'act', tier: 'master' }]);
    expect(((await getStack()).json() as { stack: unknown[] }).stack).toHaveLength(1);
  });

  it('keeps created_at across a tier change, because an edit is not a new row', async () => {
    await putStack([{ slug: 'cbt', tier: 'literacy' }]);
    const first = (await admin.query(`SELECT created_at FROM clinician_stacks`)).rows[0]!;
    await putStack([{ slug: 'cbt', tier: 'fluent' }]);
    const second = (await admin.query(`SELECT created_at, tier FROM clinician_stacks`)).rows[0]!;

    expect(second.created_at).toEqual(first.created_at);
    expect(second.tier).toBe('fluent');
  });

  it('accepts an empty stack, which is how you clear one', async () => {
    await putStack([{ slug: 'act', tier: 'master' }]);
    expect((await putStack([])).statusCode).toBe(200);
    expect((await admin.query(`SELECT * FROM clinician_stacks`)).rowCount).toBe(0);
  });

  /**
   * The reading rules are guidance, not constraints. The app warns beside the
   * selectors; nothing here or in the database refuses the write.
   */
  it('stores a second Master and a second Deep rather than refusing them', async () => {
    const res = await putStack([
      { slug: 'act', tier: 'master' },
      { slug: 'cbt', tier: 'master' },
      { slug: 'emdr', tier: 'deep' },
      { slug: 'gestalt', tier: 'deep' },
    ]);
    expect(res.statusCode).toBe(200);
    expect((await admin.query(`SELECT * FROM clinician_stacks WHERE tier = 'master'`)).rowCount).toBe(2);
    expect((await admin.query(`SELECT * FROM clinician_stacks WHERE tier = 'deep'`)).rowCount).toBe(2);
  });

  it('accepts a second Master straight past the API too — no index caps it', async () => {
    await putStack([{ slug: 'act', tier: 'master' }]);
    await expect(
      admin.query(
        `INSERT INTO clinician_stacks (clinician_id, modality_slug, tier) VALUES ($1, 'cbt', 'master')`,
        [CLINICIAN],
      ),
    ).resolves.toBeTruthy();
  });

  it('refuses a slug that names no modality, and says which', async () => {
    const res = await putStack([
      { slug: 'act', tier: 'master' },
      { slug: 'internal-family-systems', tier: 'deep' },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: UNKNOWN_MODALITIES, unknown: ['internal-family-systems'] });
  });

  it('accepts every slug the shared mirror lists', async () => {
    const res = await putStack(MODALITY_SLUGS.map((slug) => ({ slug, tier: 'literacy' })));
    expect(res.statusCode).toBe(200);
    expect((await admin.query(`SELECT * FROM clinician_stacks`)).rowCount).toBe(MODALITY_SLUGS.length);
  });

  it('refuses the same modality twice', async () => {
    const res = await putStack([
      { slug: 'act', tier: 'master' },
      { slug: 'act', tier: 'fluent' },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: DUPLICATE_MODALITY });
  });

  it('refuses a tier that is not a tier', async () => {
    expect((await putStack([{ slug: 'act', tier: 'expert' }])).statusCode).toBe(400);
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
    expect(((await getStack(CLINICIAN_B)).json() as { stack: unknown[] }).stack).toEqual([]);
  });
});

describe('the roadmap', () => {
  it('stores a goal with a target tier and a date, and reads it back', async () => {
    const res = await putGoals([{ slug: 'emdr', targetTier: 'deep', targetBy: '2028-06-01' }]);
    expect(res.statusCode).toBe(200);

    const got = (await getGoals()).json() as { goals: { slug: string; targetTier: string; doneAt: string | null }[] };
    expect(got.goals[0]).toMatchObject({ slug: 'emdr', targetTier: 'deep', doneAt: null });
  });

  it('marks one done', async () => {
    await putGoals([{ slug: 'emdr', targetTier: 'deep', targetBy: '2028-06-01' }]);
    await putGoals([
      { slug: 'emdr', targetTier: 'deep', targetBy: '2028-06-01', doneAt: '2027-01-05T00:00:00.000Z' },
    ]);
    const got = (await getGoals()).json() as { goals: { doneAt: string | null }[] };
    expect(got.goals[0]!.doneAt).not.toBeNull();
  });

  it('has nowhere to put a note', async () => {
    const cols = await admin.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'stack_goals'`,
    );
    expect(cols.rows.map((r: { column_name: string }) => r.column_name).sort()).toEqual([
      'clinician_id',
      'created_at',
      'done_at',
      'modality_slug',
      'target_by',
      'target_tier',
    ]);
  });

  it('refuses an unknown slug and a client', async () => {
    expect((await putGoals([{ slug: 'nope', targetTier: 'deep' }])).statusCode).toBe(422);
    const asClient = await app.inject({
      method: 'GET',
      url: '/v1/clinician/stack/goals',
      headers: asUser(CLIENT_A, 'client'),
    });
    expect(asClient.statusCode).toBe(403);
  });

  it('is one clinician’s own', async () => {
    await putGoals([{ slug: 'emdr', targetTier: 'deep' }], CLINICIAN);
    expect(((await getGoals(CLINICIAN_B)).json() as { goals: unknown[] }).goals).toEqual([]);
  });
});

describe('the scope gate on POST /v1/formulations', () => {
  /**
   * The gate annotates. Every case below writes the formulation; what changes
   * is the boolean recorded beside it.
   */
  it('records the annotation the clinician was shown', async () => {
    await link();
    const res = await formulate(7, { outsideStack: true });
    expect(res.statusCode).toBe(201);
    expect((await admin.query(`SELECT outside_stack FROM formulations`)).rows[0]!.outside_stack).toBe(true);
  });

  it('writes the formulation whether the floor is in the stack or not', async () => {
    await link();
    expect((await formulate(3, { outsideStack: false })).statusCode).toBe(201);
    expect((await formulate(7, { outsideStack: true })).statusCode).toBe(201);
    expect((await admin.query(`SELECT * FROM formulations`)).rowCount).toBe(2);
  });

  it('never refuses for scope, whatever the payload says', async () => {
    await link();
    // No 422 exists for this any more. If one comes back, the gate has been
    // turned into a block again.
    for (const outsideStack of [true, false, null, undefined]) {
      await admin.query(`DELETE FROM formulations`);
      const res = await formulate(7, outsideStack === undefined ? {} : { outsideStack });
      expect(res.statusCode, String(outsideStack)).toBe(201);
    }
  });

  it('leaves the column null when the app says nothing', async () => {
    await link();
    await formulate(3);
    expect((await admin.query(`SELECT outside_stack FROM formulations`)).rows[0]!.outside_stack).toBeNull();
  });

  it('has no constraint tying the annotation to anything', async () => {
    await link();
    const linkId = (await admin.query(`SELECT id FROM clinician_client_links`)).rows[0]!.id;
    // A row claiming it was outside the stack, with no stack on file at all.
    // That is a legal thing to record: the clinician saw a line and wrote anyway.
    await expect(
      admin.query(
        `INSERT INTO formulations
           (id, clinician_id, client_id, link_id, version, note_enc, falsify_enc,
            observations, gates, floor, outside_stack)
         VALUES (gen_random_uuid(), $1, $2, $3, 99, '\\x00'::bytea, '\\x00'::bytea,
            '[]'::jsonb, '{"risk":true,"dial":true,"calibrated":true}'::jsonb, 7, true)`,
        [CLINICIAN, CLIENT_A, linkId],
      ),
    ).resolves.toBeTruthy();
  });

  it('reads the annotation back on the formulation list', async () => {
    await link();
    await formulate(7, { outsideStack: true });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/clients/${CLIENT_A}/formulations`,
      headers: asUser(CLINICIAN, 'clinician'),
    });
    expect((res.json() as { outsideStack: boolean }[])[0]).toMatchObject({ outsideStack: true });
  });
});
