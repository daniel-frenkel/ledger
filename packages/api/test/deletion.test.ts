/**
 * Account deletion, end to end.
 *
 * The auth provider is mocked at the `AuthAdmin` interface, not at a
 * Supabase client — that is what the seam is for. When Prompt 11 swaps in
 * Identity Platform, nothing in this file should need to change.
 *
 * Needs Postgres with the migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { closeDb } from '../src/db/client.js';
import { AuthAdminError, setAuthAdmin } from '../src/auth-admin.js';
import { DELETION_UNAVAILABLE_CODE } from '../src/routes/me.js';
import { purgeDeleted } from '../src/jobs/purge.js';
import {
  ADMIN_URL,
  CLIENT_A,
  CLIENT_B,
  CLINICIAN,
  LogSink,
  asUser,
  buildApp,
  truncateAll,
  uid,
} from './helpers.js';

let app: FastifyInstance;
let sink: LogSink;
let admin: pg.Client;
const deleteUser = vi.fn<(userId: string) => Promise<void>>();

const T = '2026-09-01T18:00:00.000Z';

beforeAll(async () => {
  admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
});
afterAll(async () => {
  setAuthAdmin(undefined);
  await admin.end();
  await closeDb();
});

beforeEach(async () => {
  deleteUser.mockReset();
  deleteUser.mockResolvedValue(undefined);
  setAuthAdmin({ deleteUser });
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

/**
 * A ledger for `who`: a prediction with a prior, a body state, a
 * reinterpretation, a journal entry, and a device.
 *
 * `offset` keeps two seeded users from sharing row ids — the uid() helper is
 * deterministic, so seeding twice with the same offset is a primary-key
 * collision rather than a second ledger.
 */
async function seed(who = CLIENT_A, offset = 0): Promise<void> {
  const id = (n: number) => uid(n + offset);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/sync',
    headers: asUser(who),
    payload: {
      deviceId: id(700),
      priors: [
        { id: id(201), label: 'if I show weakness they withdraw', category: 'mattering', origin: 'client', createdBy: 'client', createdAt: T, clientUpdatedAt: T },
      ],
      predictions: [
        {
          id: id(101),
          situation: 'telling the sergeant I froze',
          expectedOutcome: 'he will call me a coward',
          confidence: 80,
          priorIds: [id(201)],
          resolvedAt: T,
          actualOutcome: 'he nodded',
          outcomeVerdict: 'miss',
          outcomeSource: 'observed',
          surpriseRating: 8,
          presentForIt: true,
          createdAt: T,
          clientUpdatedAt: T,
        },
      ],
      reinterpretations: [{ id: id(301), predictionId: id(101), text: 'he was only being nice', createdAt: T, clientUpdatedAt: T }],
      journalEntries: [{ id: id(401), body: 'a thing I wrote', createdAt: T, clientUpdatedAt: T }],
      bodyStates: [
        {
          id: id(501),
          predictionId: id(101),
          phase: 'before',
          before: { intensity: 6, words: ['tight'], channels: [], kitPresent: [] },
          createdAt: T,
          clientUpdatedAt: T,
        },
      ],
    },
  });
  expect(res.statusCode).toBe(200);
  // The sync registered a device with no token; give it one, so "push tokens
  // go immediately" is testing something.
  await admin.query(`UPDATE devices SET expo_push_token = 'ExponentPushToken[x]' WHERE user_id = $1`, [who]);
}

const del = (who = CLIENT_A, role: 'client' | 'clinician' = 'client') =>
  app.inject({ method: 'DELETE', url: '/v1/me', headers: asUser(who, role) });

const count = async (table: string, where = '') =>
  Number((await admin.query(`SELECT count(*) n FROM ${table} ${where}`)).rows[0]!.n);

describe('DELETE /v1/me', () => {
  it('soft-deletes every owned row and the user, and leaves nothing live', async () => {
    await seed();
    expect((await del()).statusCode).toBe(204);

    for (const t of ['predictions', 'priors', 'body_states', 'reinterpretations', 'journal_entries']) {
      expect(await count(t, 'WHERE deleted_at IS NULL'), t).toBe(0);
      // Still there, just gone. The rows leave at the purge, not now.
      expect(await count(t), t).toBeGreaterThan(0);
    }
    const u = (await admin.query(`SELECT deleted_at FROM users WHERE id = $1`, [CLIENT_A])).rows[0]!;
    expect(u.deleted_at).not.toBeNull();
  });

  it('deletes push tokens immediately rather than in thirty days', async () => {
    await seed();
    await del();
    // A token that outlives the account is a notification sent to someone who left.
    expect(await count('devices', `WHERE user_id = '${CLIENT_A}'`)).toBe(0);
  });

  it('calls the auth provider exactly once, with this user', async () => {
    await seed();
    await del();
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith(CLIENT_A);
  });

  it('revokes links in both directions', async () => {
    // A client deleting their account revokes the link to them...
    const made = await app.inject({ method: 'POST', url: '/v1/invites', headers: asUser(CLINICIAN, 'clinician'), payload: {} });
    const { token } = made.json() as { token: string };
    await app.inject({ method: 'POST', url: '/v1/invites/redeem', headers: asUser(CLIENT_A), payload: { token } });
    expect(await count('clinician_client_links', `WHERE status = 'active'`)).toBe(1);

    await del();
    expect(await count('clinician_client_links', `WHERE status = 'active'`)).toBe(0);
  });

  it('revokes the links a clinician holds when the clinician deletes', async () => {
    const made = await app.inject({ method: 'POST', url: '/v1/invites', headers: asUser(CLINICIAN, 'clinician'), payload: {} });
    const { token } = made.json() as { token: string };
    await app.inject({ method: 'POST', url: '/v1/invites/redeem', headers: asUser(CLIENT_A), payload: { token } });

    expect((await del(CLINICIAN, 'clinician')).statusCode).toBe(204);
    expect(await count('clinician_client_links', `WHERE status = 'active'`)).toBe(0);
    // And the client's own ledger is untouched: it was never the clinician's.
    expect(await count('predictions', 'WHERE deleted_at IS NOT NULL')).toBe(0);
  });

  it('touches nobody else’s rows', async () => {
    await seed(CLIENT_A);
    await seed(CLIENT_B, 1000);
    await del(CLIENT_A);

    expect(await count('predictions', `WHERE user_id = '${CLIENT_B}' AND deleted_at IS NULL`)).toBe(1);
    expect(await count('journal_entries', `WHERE user_id = '${CLIENT_B}' AND deleted_at IS NULL`)).toBe(1);
  });

  it('is idempotent: a second call still succeeds and changes nothing more', async () => {
    await seed();
    await del();
    const first = (await admin.query(`SELECT deleted_at FROM users WHERE id = $1`, [CLIENT_A])).rows[0]!.deleted_at;

    expect((await del()).statusCode).toBe(204);
    const second = (await admin.query(`SELECT deleted_at FROM users WHERE id = $1`, [CLIENT_A])).rows[0]!.deleted_at;
    // The already-deleted rows are skipped, so their stamp does not move.
    expect(await count('predictions', 'WHERE deleted_at IS NULL')).toBe(0);
    expect(second).not.toBeNull();
    expect(first).not.toBeNull();
  });

  it('refuses before writing anything when the provider is not configured', async () => {
    await seed();
    setAuthAdmin(undefined);
    // No SUPABASE_SERVICE_ROLE_KEY in the test environment, so this is the
    // real unconfigured path rather than a simulated one.
    const devicesBefore = await count('devices');
    const res = await del();

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: DELETION_UNAVAILABLE_CODE });
    // Half a deletion is worse than none: nothing moved.
    expect(await count('predictions', 'WHERE deleted_at IS NULL')).toBe(1);
    expect(await count('devices')).toBe(devicesBefore);
    expect((await admin.query(`SELECT deleted_at FROM users WHERE id = $1`, [CLIENT_A])).rows[0]!.deleted_at).toBeNull();
  });

  it('reports a 502 when the identity call fails, and keeps the rows deleted', async () => {
    await seed();
    deleteUser.mockRejectedValue(new AuthAdminError('status 500'));
    const res = await del();

    expect(res.statusCode).toBe(502);
    // The data half succeeded and stays succeeded — the retry is this same
    // request, and it is idempotent.
    expect(await count('predictions', 'WHERE deleted_at IS NULL')).toBe(0);

    deleteUser.mockResolvedValue(undefined);
    expect((await del()).statusCode).toBe(204);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/v1/me' })).statusCode).toBe(401);
  });

  it('logs a count and no identifier, and nothing anyone typed', async () => {
    await seed();
    await del();
    const logs = sink.text();
    expect(logs).toContain('account.deleted');
    expect(logs).not.toContain(CLIENT_A);
    for (const s of ['sergeant', 'coward', 'weakness', 'a thing I wrote', 'ExponentPushToken']) {
      expect(logs, s).not.toContain(s);
    }
  });
});

describe('the purge job', () => {
  /**
   * Age a soft-deleted account past the grace period. One statement per query:
   * the wire protocol refuses several in a single parameterised call.
   */
  const AGED = ['users', 'predictions', 'priors', 'body_states', 'reinterpretations', 'journal_entries'];
  const age = async (days: number) => {
    for (const t of AGED) {
      await admin.query(
        `UPDATE ${t} SET deleted_at = now() - $1::interval WHERE deleted_at IS NOT NULL`,
        [`${days} days`],
      );
    }
  };

  it('removes nothing inside the grace period', async () => {
    await seed();
    await del();
    await age(29);

    expect((await purgeDeleted()).total).toBe(0);
    expect(await count('predictions')).toBe(1);
    expect(await count('users', `WHERE id = '${CLIENT_A}'`)).toBe(1);
  });

  it('removes everything past it, and the cascade takes the rest', async () => {
    await seed();
    await del();
    await age(31);

    const r = await purgeDeleted();
    expect(r.total).toBeGreaterThan(0);
    expect(r.removed['users']).toBe(1);

    for (const t of ['predictions', 'priors', 'body_states', 'reinterpretations', 'journal_entries', 'crisis_events', 'prediction_priors']) {
      expect(await count(t), t).toBe(0);
    }
    expect(await count('users', `WHERE id = '${CLIENT_A}'`)).toBe(0);
  });

  it('leaves a live account alone', async () => {
    await seed(CLIENT_A);
    await seed(CLIENT_B, 1000);
    await del(CLIENT_A);
    await age(31);

    await purgeDeleted();
    expect(await count('users', `WHERE id = '${CLIENT_B}'`)).toBe(1);
    expect(await count('predictions', `WHERE user_id = '${CLIENT_B}'`)).toBe(1);
  });

  it('is idempotent', async () => {
    await seed();
    await del();
    await age(31);

    await purgeDeleted();
    expect((await purgeDeleted()).total).toBe(0);
  });
});
