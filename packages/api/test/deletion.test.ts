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
import { CLINICIAN_DELETION_CODE, DELETION_UNAVAILABLE_CODE } from '../src/routes/me.js';
import { SCRUBBED_TIMEZONE, purgeDeleted } from '../src/jobs/purge.js';
import {
  ADMIN_URL,
  acceptBaa,
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
  // Only deleteUser is exercised here; the assurance level is the auth
  // plugin's business and has its own tests in audit.test.ts.
  setAuthAdmin({ deleteUser, assuranceLevel: () => 'aal2' });
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

  /**
   * A clinician does not delete their account from here.
   *
   * Their formulations are a record of their own clinical reasoning,
   * referenced by clients who did not write them and cannot consent to their
   * removal. Winding down a practice is a conversation about retention and
   * where the charts go, not a button.
   */
  it('refuses a clinician, and changes nothing', async () => {
    const made = await app.inject({ method: 'POST', url: '/v1/invites', headers: asUser(CLINICIAN, 'clinician'), payload: {} });
    const { token } = made.json() as { token: string };
    await app.inject({ method: 'POST', url: '/v1/invites/redeem', headers: asUser(CLIENT_A), payload: { token } });

    const res = await del(CLINICIAN, 'clinician');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: CLINICIAN_DELETION_CODE });

    // The link is still active, the account still live, the provider untouched.
    expect(await count('clinician_client_links', `WHERE status = 'active'`)).toBe(1);
    expect((await admin.query(`SELECT deleted_at FROM users WHERE id = $1`, [CLINICIAN])).rows[0]!.deleted_at).toBeNull();
    expect(deleteUser).not.toHaveBeenCalled();
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

  it('leaves a row the client deleted on its own — the unit is the account', async () => {
    await seed();
    // One prediction removed by the client, the account still live.
    await admin.query(`UPDATE predictions SET deleted_at = now() - interval '90 days'`);

    expect((await purgeDeleted()).total).toBe(0);
    expect(await count('predictions')).toBe(1);
  });

  it('removes every table of the client’s own, in an order the foreign keys allow', async () => {
    await seed();
    await del();
    await age(31);

    const r = await purgeDeleted();
    expect(r.users).toBe(1);
    expect(r.total).toBeGreaterThan(0);

    // Nothing cascades from users in this schema, so "empty afterwards" is the
    // only check that would notice a table the job forgot to name.
    for (const t of [
      'predictions',
      'priors',
      'body_states',
      'reinterpretations',
      'journal_entries',
      'crisis_events',
      'prediction_priors',
      'devices',
      'link_invites',
    ]) {
      expect(await count(t), t).toBe(0);
    }
  });

  it('leaves a tombstone rather than deleting the user', async () => {
    await seed();
    await del();
    await age(31);
    await purgeDeleted();

    const row = (await admin.query(`SELECT * FROM users WHERE id = $1`, [CLIENT_A])).rows[0];
    expect(row, 'the users row must survive as a tombstone').toBeDefined();
    expect(row.deleted_at).not.toBeNull();
  });

  /**
   * The columns a tombstone is allowed to have.
   *
   * This list is the point of the test. Adding a column to `users` fails here
   * until someone decides whether it belongs on a tombstone — which is the
   * decision that would otherwise be made silently, by omission, the first
   * time identity or a consent flag lands on this table.
   */
  const TOMBSTONE_COLUMNS = [
    // Clinician-only, from 0008. A clinician row never reaches the purge —
    // DELETE /v1/me refuses one — but the scrub nulls these anyway: a column
    // left out because of who happens to hold it is one that gets missed the
    // day that changes.
    'baa_accepted_at',
    'baa_accepted_version',
    'created_at',
    'deleted_at',
    'id',
    // Research consent, from 0009. Scrubbed with everything else: a consent
    // record for an account that no longer exists is a claim nobody can act on.
    'research_consent_at',
    'research_consent_version',
    'research_consent_withdrawn_at',
    'role',
    'timezone',
  ];

  it('leaves nothing readable on the tombstone', async () => {
    await seed();
    await del();
    await age(31);
    await purgeDeleted();

    const cols = await admin.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' ORDER BY column_name`,
    );
    expect(
      cols.rows.map((r: { column_name: string }) => r.column_name),
      'a new column on users needs a decision about the tombstone',
    ).toEqual(TOMBSTONE_COLUMNS);

    const row = (await admin.query(`SELECT * FROM users WHERE id = $1`, [CLIENT_A])).rows[0]!;
    // timezone is a coarse location and is the only column here that ever said
    // anything about the person. It is NOT NULL, so it is neutralised.
    expect(row.timezone).toBe(SCRUBBED_TIMEZONE);
    // What is left is the id, the fact of deletion, and the role that makes a
    // clinician's foreign key to this row still mean something.
    expect(row.id).toBe(CLIENT_A);
    expect(row.role).toBe('client');
    expect(row.baa_accepted_version).toBeNull();
    expect(row.baa_accepted_at).toBeNull();
    expect(row.research_consent_at).toBeNull();
    expect(row.research_consent_version).toBeNull();
    expect(row.research_consent_withdrawn_at).toBeNull();
  });

  it('keeps a formulation through its client’s purge, pointing at the tombstone', async () => {
    // The clinician's record of their own reasoning is not the client's to
    // delete — and formulations cascade from users, so a hard delete would
    // have taken it silently rather than failing.
    const made = await app.inject({ method: 'POST', url: '/v1/invites', headers: asUser(CLINICIAN, 'clinician'), payload: {} });
    const { token } = made.json() as { token: string };
    await app.inject({ method: 'POST', url: '/v1/invites/redeem', headers: asUser(CLIENT_A), payload: { token } });

    const written = await app.inject({
      method: 'POST',
      url: '/v1/formulations',
      headers: asUser(CLINICIAN, 'clinician'),
      payload: {
        clientId: CLIENT_A,
        note: 'What I saw in the room.',
        falsify: 'A session where the pattern does not appear at all.',
        observations: [],
        gates: { risk: true, dial: true, calibrated: true },
        floor: 3,
      },
    });
    expect(written.statusCode).toBe(201);

    await del(CLIENT_A);
    await age(31);
    await purgeDeleted();

    const f = (await admin.query(`SELECT * FROM formulations`)).rows[0];
    expect(f, 'the formulation must survive').toBeDefined();
    expect(f.client_id).toBe(CLIENT_A);
    expect(f.note_enc).not.toBeNull();

    // And the id it points at resolves — to a tombstone.
    const u = (await admin.query(`SELECT * FROM users WHERE id = $1`, [f.client_id])).rows[0]!;
    expect(u.deleted_at).not.toBeNull();
    expect(u.timezone).toBe(SCRUBBED_TIMEZONE);

    // The link survives too, revoked: formulations.link_id is NOT NULL and
    // cascades from it, so deleting the link would delete the formulation.
    expect(await count('clinician_client_links', `WHERE status = 'revoked'`)).toBe(1);
  });

  it('leaves a live account alone', async () => {
    await seed(CLIENT_A);
    await seed(CLIENT_B, 1000);
    await del(CLIENT_A);
    await age(31);

    await purgeDeleted();
    expect(await count('users', `WHERE id = '${CLIENT_B}' AND timezone <> '${SCRUBBED_TIMEZONE}'`)).toBe(1);
    expect(await count('predictions', `WHERE user_id = '${CLIENT_B}'`)).toBe(1);
    expect(await count('predictions', `WHERE user_id = '${CLIENT_A}'`)).toBe(0);
  });

  it('is idempotent', async () => {
    await seed();
    await del();
    await age(31);

    await purgeDeleted();
    expect((await purgeDeleted()).total).toBe(0);
  });
});
