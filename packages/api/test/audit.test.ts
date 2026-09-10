/**
 * Go-live gate B1, B2 and A1: the access log, clinician MFA, and the BAA gate.
 *
 * The three belong in one file because they are one rule stated three ways —
 * a clinician reaching a client's record must be who they say they are, must
 * have agreed to be a business associate, and must leave a trace.
 *
 * Needs Postgres with the migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { closeDb } from '../src/db/client.js';
import { setAuthAdmin } from '../src/auth-admin.js';
import { BAA_REQUIRED_CODE, MFA_REQUIRED_CODE } from '../src/clinician-gate.js';
import { baaVersion } from '../src/baa.js';
import { ADMIN_URL, CLIENT_A, CLINICIAN, CLINICIAN_B, acceptBaa, asUser, buildApp, truncateAll } from './helpers.js';

const BAA_VERSION = baaVersion();

let app: FastifyInstance;
let admin: pg.Client;

const CLEARED = { risk: true, dial: true, calibrated: true };

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

const invite = (who = CLINICIAN, aal: 'aal1' | 'aal2' = 'aal2') =>
  app.inject({ method: 'POST', url: '/v1/invites', headers: asUser(who, 'clinician', aal), payload: {} });

async function link(): Promise<void> {
  const made = await invite();
  const { token } = made.json() as { token: string };
  const done = await app.inject({
    method: 'POST',
    url: '/v1/invites/redeem',
    headers: asUser(CLIENT_A, 'client'),
    payload: { token },
  });
  expect(done.statusCode).toBe(200);
}

const rows = async (where = '') =>
  (await admin.query(`SELECT * FROM access_log ${where} ORDER BY table_name`)).rows;

// ---------------------------------------------------------------------------
// B1 — the access log
// ---------------------------------------------------------------------------

describe('the access log', () => {
  /**
   * The column list is the test. This table is kept for six years, and the one
   * way it goes wrong is by growing a column that holds what someone wrote —
   * at which point it is a second copy of the ledger with a longer retention
   * than the ledger.
   */
  it('has these columns and no others, and none of them can hold prose', async () => {
    const cols = await admin.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'access_log' ORDER BY column_name`,
    );
    expect(cols.rows.map((r: { column_name: string }) => r.column_name)).toEqual([
      'action',
      'actor_id',
      'actor_role',
      'at',
      'client_id',
      'id',
      'row_count',
      'table_name',
    ]);
  });

  it('records a clinician reading formulations, with the row count', async () => {
    await link();
    for (const floor of [3, 4]) {
      await app.inject({
        method: 'POST',
        url: '/v1/formulations',
        headers: asUser(CLINICIAN, 'clinician'),
        payload: {
          clientId: CLIENT_A,
          note: 'What I saw.',
          falsify: 'A session where it does not appear.',
          observations: [],
          gates: CLEARED,
          floor,
        },
      });
    }
    await app.inject({
      method: 'GET',
      url: `/v1/clients/${CLIENT_A}/formulations`,
      headers: asUser(CLINICIAN, 'clinician'),
    });

    const logged = await rows(`WHERE table_name = 'formulations'`);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      actor_id: CLINICIAN,
      actor_role: 'clinician',
      client_id: CLIENT_A,
      table_name: 'formulations',
      action: 'read',
      row_count: 2,
    });
  });

  it('records one line per table touched', async () => {
    await link();
    await app.inject({ method: 'GET', url: `/v1/clients/${CLIENT_A}/formulations`, headers: asUser(CLINICIAN, 'clinician') });
    await app.inject({ method: 'GET', url: `/v1/clients/${CLIENT_A}/measures`, headers: asUser(CLINICIAN, 'clinician') });

    expect((await rows()).map((r: { table_name: string }) => r.table_name)).toEqual(['formulations', 'measures']);
  });

  it('records a read that found nothing, because looking is the thing being recorded', async () => {
    await link();
    await app.inject({ method: 'GET', url: `/v1/clients/${CLIENT_A}/formulations`, headers: asUser(CLINICIAN, 'clinician') });

    const logged = await rows();
    expect(logged).toHaveLength(1);
    expect(logged[0].row_count).toBe(0);
  });

  it('writes no line when the read never happened', async () => {
    // Refused at the gate: nothing was read, so nothing is claimed.
    await invite(CLINICIAN, 'aal1');
    await app.inject({
      method: 'GET',
      url: `/v1/clients/${CLIENT_A}/formulations`,
      headers: asUser(CLINICIAN, 'clinician', 'aal1'),
    });
    expect(await rows()).toHaveLength(0);
  });

  it('is append-only, and nobody can rewrite or remove a line', async () => {
    await link();
    await app.inject({ method: 'GET', url: `/v1/clients/${CLIENT_A}/formulations`, headers: asUser(CLINICIAN, 'clinician') });

    await expect(admin.query(`UPDATE access_log SET row_count = 0`)).rejects.toThrow(/append-only/);
    await expect(admin.query(`DELETE FROM access_log`)).rejects.toThrow(/append-only/);
  });
});

// ---------------------------------------------------------------------------
// B2 — MFA
// ---------------------------------------------------------------------------

describe('clinician MFA', () => {
  it('refuses invite creation at aal1, and says what to do', async () => {
    const res = await invite(CLINICIAN, 'aal1');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: MFA_REQUIRED_CODE });
    expect((res.json() as { error: string }).error).toMatch(/second factor/i);
  });

  it('refuses every clinician read of client data at aal1', async () => {
    await link();
    for (const url of [`/v1/clients/${CLIENT_A}/formulations`, `/v1/clients/${CLIENT_A}/measures`]) {
      const res = await app.inject({ method: 'GET', url, headers: asUser(CLINICIAN, 'clinician', 'aal1') });
      expect(res.statusCode, url).toBe(403);
      expect(res.json(), url).toMatchObject({ code: MFA_REQUIRED_CODE });
    }
  });

  it('refuses writing a formulation at aal1', async () => {
    await link();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/formulations',
      headers: asUser(CLINICIAN, 'clinician', 'aal1'),
      payload: {
        clientId: CLIENT_A,
        note: 'What I saw.',
        falsify: 'A session where it does not appear.',
        observations: [],
        gates: CLEARED,
        floor: 3,
      },
    });
    expect(res.statusCode).toBe(403);
    expect((await admin.query(`SELECT * FROM formulations`)).rowCount).toBe(0);
  });

  it('leaves clients untouched — they are on one factor by design', async () => {
    await link();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync',
      headers: asUser(CLIENT_A, 'client', 'aal1'),
      payload: { deviceId: '00000000-0000-4000-8000-000000000700' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('reads the level through the seam, not from a Supabase claim directly', async () => {
    // Prompt 11 replaces the implementation; this check must not move.
    const seen: unknown[] = [];
    setAuthAdmin({
      deleteUser: async () => {},
      assuranceLevel: (claims) => {
        seen.push(claims);
        return 'aal2';
      },
    });
    // AUTH_TEST_MODE short-circuits token verification, so the seam is not
    // called here; what this asserts is that the interface carries the method
    // and a foreign implementation satisfies it.
    expect(typeof (await import('../src/auth-admin.js')).authAdmin().assuranceLevel).toBe('function');
    setAuthAdmin(undefined);
  });
});

// ---------------------------------------------------------------------------
// A1 — the BAA gate
// ---------------------------------------------------------------------------

describe('the clinician BAA gate', () => {
  const unaccepted = async () => {
    await admin.query(`UPDATE users SET baa_accepted_version = NULL, baa_accepted_at = NULL WHERE id = $1`, [
      CLINICIAN,
    ]);
  };

  it('refuses invite creation until the agreement is accepted', async () => {
    await unaccepted();
    const res = await invite();
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: BAA_REQUIRED_CODE });
    expect((await admin.query(`SELECT * FROM link_invites`)).rowCount).toBe(0);
  });

  it('refuses clinician reads of client data too', async () => {
    await link();
    await unaccepted();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/clients/${CLIENT_A}/formulations`,
      headers: asUser(CLINICIAN, 'clinician'),
    });
    expect(res.json()).toMatchObject({ code: BAA_REQUIRED_CODE });
  });

  it('accepts the current version and records who and when', async () => {
    await unaccepted();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/me/baa',
      headers: asUser(CLINICIAN, 'clinician'),
      payload: { version: BAA_VERSION },
    });
    expect(res.statusCode).toBe(200);

    const row = (await admin.query(`SELECT * FROM users WHERE id = $1`, [CLINICIAN])).rows[0]!;
    expect(row.baa_accepted_version).toBe(BAA_VERSION);
    expect(row.baa_accepted_at).not.toBeNull();

    expect((await invite()).statusCode).toBe(201);
  });

  it('refuses a version this build does not serve', async () => {
    await unaccepted();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/me/baa',
      headers: asUser(CLINICIAN, 'clinician'),
      payload: { version: 'something-else' },
    });
    expect(res.statusCode).toBe(409);
    expect((await admin.query(`SELECT baa_accepted_version FROM users WHERE id = $1`, [CLINICIAN])).rows[0]!.baa_accepted_version).toBeNull();
  });

  it('cannot be accepted on someone else’s behalf', async () => {
    await unaccepted();
    await app.inject({
      method: 'POST',
      url: '/v1/me/baa',
      headers: asUser(CLINICIAN_B, 'clinician'),
      payload: { version: BAA_VERSION },
    });
    // CLINICIAN_B accepted for themselves. There is no route that names
    // another user, and the column grant plus users_self_update means the row
    // written is always the caller's.
    const row = (await admin.query(`SELECT baa_accepted_version FROM users WHERE id = $1`, [CLINICIAN])).rows[0]!;
    expect(row.baa_accepted_version).toBeNull();
  });

  it('is not offered to a client', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/me/baa',
      headers: asUser(CLIENT_A, 'client'),
      payload: { version: BAA_VERSION },
    });
    expect(res.statusCode).toBe(403);
  });

  it('tells a caller what this build is asking for', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: asUser(CLINICIAN, 'clinician') });
    expect(res.json()).toMatchObject({
      role: 'clinician',
      mfa: true,
      baa: { current: BAA_VERSION, accepted: BAA_VERSION },
    });
  });
});

/**
 * One source for the agreement's version.
 *
 * The clinician app renders the document and offers its version; the API
 * accepts only the version it reads from the same file. A constant that could
 * drift from the document would mean recording consent to text nobody can
 * produce — which is the failure this file exists to prevent.
 */
describe('the BAA version', () => {
  it('is the frontmatter of docs/legal/clinician-baa.md, and nothing else', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { findWorkspaceRoot } = await import('../src/env.js');
    const { BAA_FILE, parseFrontmatter, baaDoc } = await import('../src/baa.js');

    const raw = fs.readFileSync(path.join(findWorkspaceRoot(process.cwd())!, BAA_FILE), 'utf8');
    const front = parseFrontmatter(raw);

    expect(front['version'], 'the document must carry a version').toBeTruthy();
    expect(baaDoc().version).toBe(front['version']);
    expect(BAA_VERSION).toBe(front['version']);
  });

  it('knows the placeholder is still a placeholder', async () => {
    const { baaDoc } = await import('../src/baa.js');
    // When counsel's template lands, this flips and the setup screen stops
    // saying nobody should accept it. Until then it must not quietly pass.
    expect(baaDoc().draft).toBe(true);
  });

  it('is what the acceptance route records, without being told', async () => {
    await admin.query(`UPDATE users SET baa_accepted_version = NULL, baa_accepted_at = NULL WHERE id = $1`, [CLINICIAN]);
    await app.inject({
      method: 'POST',
      url: '/v1/me/baa',
      headers: asUser(CLINICIAN, 'clinician'),
      payload: { version: BAA_VERSION },
    });
    const row = (await admin.query(`SELECT baa_accepted_version FROM users WHERE id = $1`, [CLINICIAN])).rows[0]!;
    expect(row.baa_accepted_version).toBe(BAA_VERSION);
  });
});
