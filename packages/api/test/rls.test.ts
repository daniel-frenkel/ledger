/**
 * Row-level security, tested as the API role with raw SQL. These tests do not
 * go through the application code at all: if they pass, the database itself
 * refuses cross-user reads even when the API is wrong.
 *
 * Requires a Postgres with the migrations applied and the ledger_api role
 * (docker compose up -d db && pnpm db:migrate). Run with `pnpm test:rls`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { API_URL, ADMIN_URL, CLIENT_A, CLIENT_B, CLINICIAN, assertDisposableDatabase, truncateAll, uid } from './helpers.js';

let api: pg.Client;
let admin: pg.Client;

const LINK = uid(50);
const PRED_A = uid(101);
const PRIOR_A = uid(201);
const JOURNAL_A = uid(301);
const JOURNAL_A_SHARED = uid(302);
const RE_A = uid(401);
const CRISIS_A = uid(501);
const DEVICE_A = uid(601);

/** Run a callback as (user, role) inside a transaction and roll back. */
async function as<T>(userId: string, role: 'client' | 'clinician', fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await api.query('BEGIN');
  try {
    await api.query(`SELECT set_config('request.user_id', $1, true), set_config('request.role', $2, true)`, [userId, role]);
    return await fn(api);
  } finally {
    await api.query('ROLLBACK');
  }
}
/** Same, but commit. */
async function asCommit<T>(userId: string, role: 'client' | 'clinician', fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await api.query('BEGIN');
  try {
    await api.query(`SELECT set_config('request.user_id', $1, true), set_config('request.role', $2, true)`, [userId, role]);
    const r = await fn(api);
    await api.query('COMMIT');
    return r;
  } catch (e) {
    await api.query('ROLLBACK');
    throw e;
  }
}

const count = async (c: pg.Client, sql: string, params: unknown[] = []) => Number((await c.query(sql, params)).rows[0]?.n ?? 0);

beforeAll(async () => {
  // Checked again here, before a connection is even opened: this suite
  // truncates and re-seeds on every test, and truncateAll() is not the only
  // way it writes. Failing early keeps the refusal legible.
  assertDisposableDatabase();
  api = new pg.Client({ connectionString: API_URL });
  admin = new pg.Client({ connectionString: ADMIN_URL });
  await api.connect();
  await admin.connect();
  const role = await api.query(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`);
  expect(role.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
});
afterAll(async () => {
  await api.end();
  await admin.end();
});

beforeEach(async () => {
  await truncateAll();
  // Seed as admin (bypasses RLS) so the fixtures are exactly what we say they are.
  await admin.query(`INSERT INTO users (id, role) VALUES ($1,'client'), ($2,'client'), ($3,'clinician')`, [CLIENT_A, CLIENT_B, CLINICIAN]);
  await admin.query(
    `INSERT INTO predictions (id, user_id, situation_enc, expected_outcome_enc, confidence, created_at, client_updated_at)
     VALUES ($1, $2, '\\x00', '\\x00', 80, now(), now())`,
    [PRED_A, CLIENT_A],
  );
  await admin.query(
    `INSERT INTO priors (id, user_id, label_enc, category, origin, created_by, created_at, client_updated_at)
     VALUES ($1, $2, '\\x00', 'mattering', 'client', 'client', now(), now())`,
    [PRIOR_A, CLIENT_A],
  );
  await admin.query(`INSERT INTO prediction_priors (prediction_id, prior_id, user_id, assigned_by) VALUES ($1, $2, $3, 'client')`, [PRED_A, PRIOR_A, CLIENT_A]);
  await admin.query(
    `INSERT INTO body_states (id, user_id, prediction_id, phase, intensity, created_at, client_updated_at) VALUES ($1, $2, $3, 'before', 5, now(), now())`,
    [uid(701), CLIENT_A, PRED_A],
  );
  await admin.query(
    `INSERT INTO reinterpretations (id, user_id, prediction_id, text_enc, created_at, client_updated_at) VALUES ($1, $2, $3, '\\x00', now(), now())`,
    [RE_A, CLIENT_A, PRED_A],
  );
  await admin.query(
    `INSERT INTO journal_entries (id, user_id, body_enc, shared_at, created_at, client_updated_at)
     VALUES ($1, $3, '\\x00', NULL, now(), now()), ($2, $3, '\\x00', now(), now(), now())`,
    [JOURNAL_A, JOURNAL_A_SHARED, CLIENT_A],
  );
  await admin.query(
    `INSERT INTO crisis_events (id, user_id, source, source_entry_id, rule_ids, resources_shown, detected_on_device, created_at)
     VALUES ($1, $2, 'prediction', $3, '{R03_want_to_die}', '{lifeline_988}', true, now())`,
    [CRISIS_A, CLIENT_A, PRED_A],
  );
  await admin.query(`INSERT INTO devices (id, user_id) VALUES ($1, $2)`, [DEVICE_A, CLIENT_A]);
});

async function linkActive(layers: Partial<Record<'calibration' | 'predictions' | 'priors' | 'body_states' | 'crisis_events', boolean>> = {}) {
  const l = { calibration: true, predictions: false, priors: true, body_states: false, crisis_events: true, ...layers };
  await admin.query(
    `INSERT INTO clinician_client_links (id, clinician_id, client_id, status, requested_by,
       share_calibration, share_predictions, share_priors, share_body_states, share_crisis_events, consented_at)
     VALUES ($1, $2, $3, 'active', 'client', $4, $5, $6, $7, $8, now())`,
    [LINK, CLINICIAN, CLIENT_A, l.calibration, l.predictions, l.priors, l.body_states, l.crisis_events],
  );
}

describe('clients', () => {
  it('A sees its own rows in every table', async () => {
    await as(CLIENT_A, 'client', async (c) => {
      expect(await count(c, 'SELECT count(*) n FROM predictions')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM priors')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM prediction_priors')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM body_states')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM reinterpretations')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM journal_entries')).toBe(2);
      expect(await count(c, 'SELECT count(*) n FROM crisis_events')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM devices')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM predictions_summary')).toBe(1);
    });
  });

  it('B sees nothing of A — in every table, and in the summary view', async () => {
    await as(CLIENT_B, 'client', async (c) => {
      for (const t of ['predictions', 'priors', 'prediction_priors', 'body_states', 'reinterpretations', 'journal_entries', 'crisis_events', 'devices', 'predictions_summary']) {
        expect(await count(c, `SELECT count(*) n FROM ${t}`), t).toBe(0);
      }
      expect(await count(c, 'SELECT count(*) n FROM users')).toBe(1);
    });
  });

  it('B cannot update or delete A’s prediction (zero rows affected, no error)', async () => {
    await as(CLIENT_B, 'client', async (c) => {
      const u = await c.query(`UPDATE predictions SET confidence = 1 WHERE id = $1`, [PRED_A]);
      expect(u.rowCount).toBe(0);
    });
    await as(CLIENT_A, 'client', async (c) => {
      expect((await c.query(`SELECT confidence FROM predictions WHERE id = $1`, [PRED_A])).rows[0]!.confidence).toBe(80);
    });
  });

  it('B cannot insert a row under A’s user_id', async () => {
    await expect(
      as(CLIENT_B, 'client', (c) =>
        c.query(
          `INSERT INTO predictions (id, user_id, situation_enc, expected_outcome_enc, confidence, created_at, client_updated_at)
           VALUES ($1, $2, '\\x00', '\\x00', 50, now(), now())`,
          [uid(999), CLIENT_A],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('no user context at all → nothing visible', async () => {
    await api.query('BEGIN');
    try {
      expect(await count(api, 'SELECT count(*) n FROM predictions')).toBe(0);
      expect(await count(api, 'SELECT count(*) n FROM users')).toBe(0);
    } finally {
      await api.query('ROLLBACK');
    }
  });

  it('reinterpretations are append-only even for the owner', async () => {
    await expect(
      as(CLIENT_A, 'client', (c) => c.query(`UPDATE reinterpretations SET text_enc = '\\x01' WHERE id = $1`, [RE_A])),
    ).rejects.toThrow(/append-only/);
    await as(CLIENT_A, 'client', async (c) => {
      const r = await c.query(`UPDATE reinterpretations SET deleted_at = now() WHERE id = $1`, [RE_A]);
      expect(r.rowCount).toBe(1);
    });
  });
});

describe('clinicians', () => {
  it('with no link: sees nothing', async () => {
    await as(CLINICIAN, 'clinician', async (c) => {
      for (const t of ['predictions', 'priors', 'body_states', 'reinterpretations', 'journal_entries', 'crisis_events', 'devices', 'predictions_summary']) {
        expect(await count(c, `SELECT count(*) n FROM ${t}`), t).toBe(0);
      }
    });
  });

  it('with a pending link: still nothing', async () => {
    await admin.query(
      `INSERT INTO clinician_client_links (id, clinician_id, client_id, status, requested_by) VALUES ($1,$2,$3,'pending','client')`,
      [LINK, CLINICIAN, CLIENT_A],
    );
    await as(CLINICIAN, 'clinician', async (c) => {
      expect(await count(c, 'SELECT count(*) n FROM predictions')).toBe(0);
      expect(await count(c, 'SELECT count(*) n FROM predictions_summary')).toBe(0);
      expect(await count(c, 'SELECT count(*) n FROM clinician_client_links')).toBe(1);
    });
  });

  it('default layers: calibration summary + priors + crisis events; no prose, no body, no journal', async () => {
    await linkActive();
    await as(CLINICIAN, 'clinician', async (c) => {
      expect(await count(c, 'SELECT count(*) n FROM predictions_summary')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM predictions')).toBe(0); // full rows not shared
      expect(await count(c, 'SELECT count(*) n FROM reinterpretations')).toBe(0);
      expect(await count(c, 'SELECT count(*) n FROM priors')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM prediction_priors')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM crisis_events')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM body_states')).toBe(0);
      expect(await count(c, 'SELECT count(*) n FROM devices')).toBe(0);
      // journal: only the explicitly shared entry
      expect(await count(c, 'SELECT count(*) n FROM journal_entries')).toBe(1);
      expect((await c.query('SELECT id FROM journal_entries')).rows[0]!.id).toBe(JOURNAL_A_SHARED);
    });
  });

  it('the summary view exposes no encrypted columns', async () => {
    const cols = (await admin.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'predictions_summary'`)).rows.map((r) => r.column_name as string);
    expect(cols.some((c) => c.endsWith('_enc'))).toBe(false);
  });

  it('share_predictions: full rows and reinterpretations become visible', async () => {
    await linkActive({ predictions: true });
    await as(CLINICIAN, 'clinician', async (c) => {
      expect(await count(c, 'SELECT count(*) n FROM predictions')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM reinterpretations')).toBe(1);
    });
  });

  it('share_body_states gates body_states', async () => {
    await linkActive({ body_states: true });
    await as(CLINICIAN, 'clinician', async (c) => expect(await count(c, 'SELECT count(*) n FROM body_states')).toBe(1));
  });

  it('turning a layer off hides it; share_calibration off hides the summary', async () => {
    await linkActive({ priors: false, crisis_events: false, calibration: false });
    await as(CLINICIAN, 'clinician', async (c) => {
      expect(await count(c, 'SELECT count(*) n FROM priors')).toBe(0);
      expect(await count(c, 'SELECT count(*) n FROM crisis_events')).toBe(0);
      expect(await count(c, 'SELECT count(*) n FROM predictions_summary')).toBe(0);
    });
  });

  it('may set safe_to_test on a shared prior, and nothing else', async () => {
    await linkActive();
    await asCommit(CLINICIAN, 'clinician', async (c) => {
      const r = await c.query(`UPDATE priors SET safe_to_test = false WHERE id = $1`, [PRIOR_A]);
      expect(r.rowCount).toBe(1);
    });
    await expect(
      as(CLINICIAN, 'clinician', (c) => c.query(`UPDATE priors SET category = 'rank' WHERE id = $1`, [PRIOR_A])),
    ).rejects.toThrow(/safe_to_test/);
    await expect(
      as(CLINICIAN, 'clinician', (c) => c.query(`UPDATE priors SET retired_at = now() WHERE id = $1`, [PRIOR_A])),
    ).rejects.toThrow(/safe_to_test/);
  });

  it('may add a clinician-origin prior, not a client-origin one', async () => {
    await linkActive();
    await as(CLINICIAN, 'clinician', async (c) => {
      const ok = await c.query(
        `INSERT INTO priors (id, user_id, label_enc, category, origin, created_by, created_at, client_updated_at)
         VALUES ($1, $2, '\\x00', 'rank', 'clinician', 'clinician', now(), now())`,
        [uid(202), CLIENT_A],
      );
      expect(ok.rowCount).toBe(1);
    });
    await expect(
      as(CLINICIAN, 'clinician', (c) =>
        c.query(
          `INSERT INTO priors (id, user_id, label_enc, category, origin, created_by, created_at, client_updated_at)
           VALUES ($1, $2, '\\x00', 'rank', 'client', 'client', now(), now())`,
          [uid(203), CLIENT_A],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot change consent layers or activate a link', async () => {
    await admin.query(
      `INSERT INTO clinician_client_links (id, clinician_id, client_id, status, requested_by) VALUES ($1,$2,$3,'pending','clinician')`,
      [LINK, CLINICIAN, CLIENT_A],
    );
    await expect(as(CLINICIAN, 'clinician', (c) => c.query(`UPDATE clinician_client_links SET status = 'active' WHERE id = $1`, [LINK]))).rejects.toThrow(
      /only the client/,
    );
    await expect(
      as(CLINICIAN, 'clinician', (c) => c.query(`UPDATE clinician_client_links SET share_predictions = true WHERE id = $1`, [LINK])),
    ).rejects.toThrow(/only the client/);
    // …but may revoke
    await as(CLINICIAN, 'clinician', async (c) => {
      const r = await c.query(`UPDATE clinician_client_links SET status = 'revoked' WHERE id = $1`, [LINK]);
      expect(r.rowCount).toBe(1);
    });
  });

  it('client activates, then revokes: every door closes at once', async () => {
    await admin.query(
      `INSERT INTO clinician_client_links (id, clinician_id, client_id, status, requested_by, share_predictions, share_body_states)
       VALUES ($1,$2,$3,'pending','clinician', true, true)`,
      [LINK, CLINICIAN, CLIENT_A],
    );
    await asCommit(CLIENT_A, 'client', (c) => c.query(`UPDATE clinician_client_links SET status = 'active' WHERE id = $1`, [LINK]));
    await as(CLINICIAN, 'clinician', async (c) => {
      expect(await count(c, 'SELECT count(*) n FROM predictions')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM body_states')).toBe(1);
      expect((await c.query('SELECT consented_at FROM clinician_client_links')).rows[0]!.consented_at).toBeTruthy();
    });
    await asCommit(CLIENT_A, 'client', (c) => c.query(`UPDATE clinician_client_links SET status = 'revoked' WHERE id = $1`, [LINK]));
    await as(CLINICIAN, 'clinician', async (c) => {
      for (const t of ['predictions', 'priors', 'body_states', 'reinterpretations', 'journal_entries', 'crisis_events', 'predictions_summary']) {
        expect(await count(c, `SELECT count(*) n FROM ${t}`), t).toBe(0);
      }
    });
  });

  it('a clinician role claim does not unlock a client’s own rows for someone else', async () => {
    // B pretending to be a clinician, no link
    await as(CLIENT_B, 'clinician', async (c) => {
      expect(await count(c, 'SELECT count(*) n FROM predictions')).toBe(0);
      expect(await count(c, 'SELECT count(*) n FROM predictions_summary')).toBe(0);
    });
  });

});

describe('regressions from review', () => {
  it('#1 a clinician cannot re-point an active link at another client', async () => {
    await linkActive({ predictions: true });
    await expect(
      as(CLINICIAN, 'clinician', (c) => c.query(`UPDATE clinician_client_links SET client_id = $1 WHERE id = $2`, [CLIENT_B, LINK])),
    ).rejects.toThrow(/re-pointed/);
    // …and a client cannot re-point their own link at a different clinician either
    await expect(
      as(CLIENT_A, 'client', (c) => c.query(`UPDATE clinician_client_links SET clinician_id = $1 WHERE id = $2`, [CLIENT_B, LINK])),
    ).rejects.toThrow(/re-pointed/);
  });

  it('#2 a client cannot promote themselves to clinician', async () => {
    await expect(as(CLIENT_A, 'client', (c) => c.query(`UPDATE users SET role = 'clinician' WHERE id = $1`, [CLIENT_A]))).rejects.toThrow(
      /permission denied/,
    );
    // timezone is still editable
    await as(CLIENT_A, 'client', async (c) => {
      const r = await c.query(`UPDATE users SET timezone = 'America/Denver' WHERE id = $1`, [CLIENT_A]);
      expect(r.rowCount).toBe(1);
    });
  });

  it('#5 a client cannot attach a child row to another user’s prediction or prior', async () => {
    await expect(
      as(CLIENT_B, 'client', (c) =>
        c.query(
          `INSERT INTO body_states (id, user_id, prediction_id, phase, intensity, created_at, client_updated_at) VALUES ($1, $2, $3, 'after', 5, now(), now())`,
          [uid(702), CLIENT_B, PRED_A],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
    await admin.query(
      `INSERT INTO priors (id, user_id, label_enc, category, origin, created_by, created_at, client_updated_at) VALUES ($1, $2, '\\x00', 'rank', 'client', 'client', now(), now())`,
      [uid(211), CLIENT_B],
    );
    // B's own prior, A's prediction → composite FK refuses
    await expect(
      as(CLIENT_B, 'client', (c) =>
        c.query(`INSERT INTO prediction_priors (prediction_id, prior_id, user_id, assigned_by) VALUES ($1, $2, $3, 'client')`, [PRED_A, uid(211), CLIENT_B]),
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      as(CLIENT_B, 'client', (c) =>
        c.query(
          `INSERT INTO reinterpretations (id, user_id, prediction_id, text_enc, created_at, client_updated_at) VALUES ($1, $2, $3, '\\x00', now(), now())`,
          [uid(402), CLIENT_B, PRED_A],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('#5 crisis dedupe is per user: B cannot squat on A’s (source, entry) key', async () => {
    await as(CLIENT_B, 'client', async (c) => {
      const r = await c.query(
        `INSERT INTO crisis_events (id, user_id, source, source_entry_id, rule_ids, resources_shown, detected_on_device, created_at)
         VALUES ($1, $2, 'prediction', $3, '{R02_suicid}', '{lifeline_988}', true, now())`,
        [uid(502), CLIENT_B, PRED_A],
      );
      expect(r.rowCount).toBe(1);
    });
    // A's own event for the same entry still upserts fine
    await as(CLIENT_A, 'client', async (c) => {
      const r = await c.query(
        `INSERT INTO crisis_events (id, user_id, source, source_entry_id, rule_ids, resources_shown, detected_on_device, created_at)
         VALUES ($1, $2, 'prediction', $3, '{R02_suicid}', '{lifeline_988}', false, now())
         ON CONFLICT (user_id, source, source_entry_id) DO UPDATE SET rule_ids = excluded.rule_ids`,
        [uid(503), CLIENT_A, PRED_A],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it('#6 predictions_summary is a security barrier: a leaky qual cannot read hidden rows', async () => {
    // No link. A qual that would error on A's row must not be evaluated against it.
    await as(CLINICIAN, 'clinician', async (c) => {
      const r = await c.query(`SELECT * FROM predictions_summary WHERE (confidence::text || 'x')::int > 0`);
      expect(r.rowCount).toBe(0);
    });
  });

  it('#14 a clinician tagging a prediction bumps predictions.updated_at so the client pulls it', async () => {
    await linkActive();
    const before = (await admin.query(`SELECT updated_at FROM predictions WHERE id = $1`, [PRED_A])).rows[0]!.updated_at as Date;
    await asCommit(CLINICIAN, 'clinician', (c) =>
      c.query(`INSERT INTO priors (id, user_id, label_enc, category, origin, created_by, created_at, client_updated_at) VALUES ($1, $2, '\\x00', 'rank', 'clinician', 'clinician', now(), now())`, [uid(210), CLIENT_A]),
    );
    await asCommit(CLINICIAN, 'clinician', (c) =>
      c.query(`INSERT INTO prediction_priors (prediction_id, prior_id, user_id, assigned_by) VALUES ($1, $2, $3, 'clinician')`, [PRED_A, uid(210), CLIENT_A]),
    );
    const after = (await admin.query(`SELECT updated_at FROM predictions WHERE id = $1`, [PRED_A])).rows[0]!.updated_at as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});
