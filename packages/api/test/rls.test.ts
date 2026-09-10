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
import {
  API_URL,
  ADMIN_URL,
  CLIENT_A,
  CLIENT_B,
  CLINICIAN,
  CLINICIAN_B,
  assertDisposableDatabase,
  truncateAll,
  uid,
} from './helpers.js';

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

/** The purge job's context: system role, no user id, the grace period set. */
async function asSystemTx<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await api.query('BEGIN');
  try {
    await api.query(
      `SELECT set_config('request.role', 'system', true),
              set_config('request.user_id', '', true),
              set_config('app.deletion_grace_days', '30', true)`,
    );
    return await fn(api);
  } finally {
    await api.query('ROLLBACK');
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

/** Revoke the link the way the app does: a status change, not a delete. */
async function revoke() {
  await admin.query(`UPDATE clinician_client_links SET status = 'revoked' WHERE id = $1`, [LINK]);
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

// ---------------------------------------------------------------------------
// 0003 — invites, formulations, assistant runs
//
// The trust model these hold: the clinician originates an invite and the
// client's redemption is the consent; the client can never see an invite;
// consent stays the client's; and a formulation is the clinician's note that
// nobody rewrites and nobody reads through a closed link.
// ---------------------------------------------------------------------------

describe('0003 invites and formulations', () => {
  const INVITE = uid(801);
  const INVITE_B = uid(802);
  const FORM = uid(901);
  const RUN = uid(951);
  const NEW_LINK = uid(60);
  const LINK_B = uid(71);

  /** A 32-byte hash, distinct per seed number. */
  const hash = (n: number) => Buffer.alloc(32, n);

  beforeEach(async () => {
    await admin.query(`INSERT INTO users (id, role) VALUES ($1,'clinician')`, [CLINICIAN_B]);
  });

  /** Insert an invite as the owner, bypassing RLS, with an explicit lifecycle. */
  async function seedInvite(
    id: string,
    clinician: string,
    n: number,
    opts: { expired?: boolean; revoked?: boolean; redeemedBy?: string } = {},
  ) {
    await admin.query(
      `INSERT INTO link_invites (id, clinician_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '7 days')`,
      [id, clinician, hash(n)],
    );
    // The guard forces created_at and expires_at on insert, and refuses to let
    // them move afterwards — which is the point of it. Ageing a fixture row is
    // the one legitimate reason to step around it.
    if (opts.expired) {
      await admin.query(`ALTER TABLE link_invites DISABLE TRIGGER link_invites_guard`);
      await admin.query(`UPDATE link_invites SET expires_at = now() - interval '1 hour' WHERE id = $1`, [id]);
      await admin.query(`ALTER TABLE link_invites ENABLE TRIGGER link_invites_guard`);
    }
    if (opts.revoked) await admin.query(`UPDATE link_invites SET revoked_at = now() WHERE id = $1`, [id]);
    if (opts.redeemedBy) {
      await admin.query(`UPDATE link_invites SET redeemed_at = now(), redeemed_by = $2 WHERE id = $1`, [
        id,
        opts.redeemedBy,
      ]);
    }
  }

  // --- visibility ----------------------------------------------------------

  it('#15 a clinician cannot read another clinician’s invites', async () => {
    await seedInvite(INVITE, CLINICIAN, 1);
    await seedInvite(INVITE_B, CLINICIAN_B, 2);
    await as(CLINICIAN, 'clinician', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM link_invites`)).toBe(1);
      expect(await count(c, `SELECT count(*) n FROM link_invites WHERE id = $1`, [INVITE_B])).toBe(0);
    });
  });

  it('#16 a client cannot read link_invites at all, even holding the token hash', async () => {
    await seedInvite(INVITE, CLINICIAN, 1);
    await as(CLIENT_A, 'client', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM link_invites`)).toBe(0);
      expect(await count(c, `SELECT count(*) n FROM link_invites WHERE token_hash = $1`, [hash(1)])).toBe(0);
    });
  });

  it('#17 a client can neither insert an invite nor touch one', async () => {
    await seedInvite(INVITE, CLINICIAN, 1);
    await as(CLIENT_A, 'client', async (c) => {
      await expect(
        c.query(`INSERT INTO link_invites (id, clinician_id, token_hash, expires_at) VALUES ($1,$2,$3, now())`, [
          uid(803),
          CLINICIAN,
          hash(9),
        ]),
      ).rejects.toThrow();
    });
    await as(CLIENT_A, 'client', async (c) => {
      // Invisible, so there is nothing to update rather than a refusal.
      const r = await c.query(`UPDATE link_invites SET revoked_at = now() WHERE id = $1`, [INVITE]);
      expect(r.rowCount).toBe(0);
    });
  });

  // --- redemption ----------------------------------------------------------

  it('#18 a good token redeems once and creates an active link', async () => {
    await seedInvite(INVITE, CLINICIAN, 1);
    const link = await asCommit(CLIENT_A, 'client', async (c) => {
      const r = await c.query(`SELECT redeem_invite($1, $2, true, false) AS link`, [hash(1), NEW_LINK]);
      return r.rows[0]?.link as string | null;
    });
    expect(link).toBe(NEW_LINK);
    const row = (await admin.query(`SELECT * FROM clinician_client_links WHERE id = $1`, [NEW_LINK])).rows[0]!;
    expect(row.status).toBe('active');
    expect(row.client_id).toBe(CLIENT_A);
    expect(row.clinician_id).toBe(CLINICIAN);
    expect(row.share_predictions).toBe(true);
    expect(row.share_body_states).toBe(false);
    expect(row.consented_at).not.toBeNull();
    const inv = (await admin.query(`SELECT * FROM link_invites WHERE id = $1`, [INVITE])).rows[0]!;
    expect(inv.redeemed_by).toBe(CLIENT_A);
    expect(inv.link_id).toBe(NEW_LINK);
  });

  it('#19 used, expired, revoked, unknown and self tokens all fail identically', async () => {
    await seedInvite(uid(811), CLINICIAN, 11, { redeemedBy: CLIENT_B });
    await seedInvite(uid(812), CLINICIAN, 12, { expired: true });
    await seedInvite(uid(813), CLINICIAN, 13, { revoked: true });
    await seedInvite(uid(814), CLINICIAN, 14);

    const attempt = (who: string, role: 'client' | 'clinician', h: Buffer, linkId: string) =>
      asCommit(who, role, async (c) => {
        const r = await c.query(`SELECT redeem_invite($1, $2, true, true) AS link`, [h, linkId]);
        return r.rows[0]?.link as string | null;
      });

    // Every one returns NULL — the same answer, so nothing distinguishes
    // "no such token" from "already used".
    expect(await attempt(CLIENT_A, 'client', hash(11), uid(61))).toBeNull(); // used
    expect(await attempt(CLIENT_A, 'client', hash(12), uid(62))).toBeNull(); // expired
    expect(await attempt(CLIENT_A, 'client', hash(13), uid(63))).toBeNull(); // revoked
    expect(await attempt(CLIENT_A, 'client', hash(99), uid(64))).toBeNull(); // unknown
    expect(await attempt(CLINICIAN, 'client', hash(14), uid(65))).toBeNull(); // self

    expect(await count(admin, `SELECT count(*) n FROM clinician_client_links`)).toBe(0);
  });

  it('#20 a token cannot be redeemed twice', async () => {
    await seedInvite(INVITE, CLINICIAN, 1);
    const first = await asCommit(
      CLIENT_A,
      'client',
      async (c) => (await c.query(`SELECT redeem_invite($1, $2, false, false) AS link`, [hash(1), NEW_LINK])).rows[0]?.link,
    );
    expect(first).toBe(NEW_LINK);
    const second = await asCommit(
      CLIENT_B,
      'client',
      async (c) => (await c.query(`SELECT redeem_invite($1, $2, false, false) AS link`, [hash(1), uid(66)])).rows[0]?.link,
    );
    expect(second).toBeNull();
    expect(await count(admin, `SELECT count(*) n FROM clinician_client_links`)).toBe(1);
  });

  it('#21 a clinician cannot redeem, even someone else’s invite', async () => {
    await seedInvite(INVITE, CLINICIAN_B, 1);
    const out = await asCommit(
      CLINICIAN,
      'clinician',
      async (c) => (await c.query(`SELECT redeem_invite($1, $2, true, true) AS link`, [hash(1), NEW_LINK])).rows[0]?.link,
    );
    expect(out).toBeNull();
  });

  // --- consent stays the client's -----------------------------------------

  it('#22 a clinician cannot set share flags on their own link', async () => {
    await linkActive();
    await as(CLINICIAN, 'clinician', async (c) => {
      await expect(
        c.query(`UPDATE clinician_client_links SET share_predictions = true WHERE id = $1`, [LINK]),
      ).rejects.toThrow(/only the client can change what is shared/);
    });
    await as(CLINICIAN, 'clinician', async (c) => {
      await expect(
        c.query(`UPDATE clinician_client_links SET share_body_states = true WHERE id = $1`, [LINK]),
      ).rejects.toThrow(/only the client can change what is shared/);
    });
  });

  it('#23 a clinician may revoke their own link and change nothing else', async () => {
    await linkActive();
    await asCommit(CLINICIAN, 'clinician', (c) =>
      c.query(`UPDATE clinician_client_links SET status = 'revoked' WHERE id = $1`, [LINK]),
    );
    const row = (await admin.query(`SELECT * FROM clinician_client_links WHERE id = $1`, [LINK])).rows[0]!;
    expect(row.status).toBe('revoked');
    expect(row.revoked_at).not.toBeNull();

    // A second, untouched link: the clinician may not move anything else on it.
    await admin.query(
      `INSERT INTO clinician_client_links (id, clinician_id, client_id, status, requested_by, consented_at)
       VALUES ($1, $2, $3, 'active', 'clinician', now())`,
      [LINK_B, CLINICIAN, CLIENT_B],
    );
    await as(CLINICIAN, 'clinician', async (c) => {
      await expect(
        c.query(`UPDATE clinician_client_links SET consented_at = now() - interval '1 day' WHERE id = $1`, [LINK_B]),
      ).rejects.toThrow(/a clinician may only revoke a link/);
    });
    await as(CLINICIAN, 'clinician', async (c) => {
      await expect(
        c.query(`UPDATE clinician_client_links SET requested_by = 'client' WHERE id = $1`, [LINK_B]),
      ).rejects.toThrow(/a clinician may only revoke a link/);
    });
  });

  it('#24 the client keeps their ledger when the link is revoked', async () => {
    await linkActive({ predictions: true });
    await asCommit(CLIENT_A, 'client', (c) =>
      c.query(`UPDATE clinician_client_links SET status = 'revoked' WHERE id = $1`, [LINK]),
    );
    await as(CLIENT_A, 'client', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM predictions WHERE user_id = $1`, [CLIENT_A])).toBe(1);
    });
  });

  // --- formulations --------------------------------------------------------

  /** A formulation for CLIENT_A, inserted as the clinician, through RLS. */
  const insertFormulation = (c: pg.Client, id = FORM, version = 1) =>
    c.query(
      `INSERT INTO formulations (id, clinician_id, client_id, link_id, version, note_enc, falsify_enc, observations, gates, floor)
       VALUES ($1, $2, $3, $4, $5, '\\x00', '\\x00', '[0,3]'::jsonb, '{"risk":true,"dial":true,"calibrated":true}'::jsonb, 4)`,
      [id, CLINICIAN, CLIENT_A, LINK, version],
    );

  it('#25 a clinician writes and reads a formulation through an active link', async () => {
    await linkActive();
    await asCommit(CLINICIAN, 'clinician', (c) => insertFormulation(c));
    await as(CLINICIAN, 'clinician', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM formulations`)).toBe(1);
    });
  });

  it('#26 a formulation cannot be written without an active link', async () => {
    await linkActive();
    await admin.query(`UPDATE clinician_client_links SET status = 'revoked' WHERE id = $1`, [LINK]);
    await as(CLINICIAN, 'clinician', async (c) => {
      await expect(insertFormulation(c)).rejects.toThrow();
    });
  });

  it('#27 a clinician cannot update or delete a formulation', async () => {
    await linkActive();
    await asCommit(CLINICIAN, 'clinician', (c) => insertFormulation(c));
    await as(CLINICIAN, 'clinician', async (c) => {
      // No grant, and no policy either. Two locks, both checked.
      await expect(c.query(`UPDATE formulations SET floor = 7 WHERE id = $1`, [FORM])).rejects.toThrow();
    });
    await as(CLINICIAN, 'clinician', async (c) => {
      await expect(c.query(`DELETE FROM formulations WHERE id = $1`, [FORM])).rejects.toThrow();
    });
    expect(await count(admin, `SELECT count(*) n FROM formulations WHERE floor = 4`)).toBe(1);
  });

  it('#28 a clinician cannot read formulations for a client whose link is revoked', async () => {
    await linkActive();
    await asCommit(CLINICIAN, 'clinician', (c) => insertFormulation(c));
    await admin.query(`UPDATE clinician_client_links SET status = 'revoked' WHERE id = $1`, [LINK]);
    await as(CLINICIAN, 'clinician', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM formulations`)).toBe(0);
    });
    // The door closed; the row did not move.
    expect(await count(admin, `SELECT count(*) n FROM formulations`)).toBe(1);
  });

  it('#29 a clinician cannot read another clinician’s formulation for the same client', async () => {
    await linkActive();
    await asCommit(CLINICIAN, 'clinician', (c) => insertFormulation(c));
    await admin.query(
      `INSERT INTO clinician_client_links (id, clinician_id, client_id, status, requested_by, consented_at)
       VALUES ($1, $2, $3, 'active', 'clinician', now())`,
      [uid(70), CLINICIAN_B, CLIENT_A],
    );
    await as(CLINICIAN_B, 'clinician', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM formulations`)).toBe(0);
    });
  });

  it('#30 the client cannot read formulations about themselves in this version', async () => {
    await linkActive();
    await asCommit(CLINICIAN, 'clinician', (c) => insertFormulation(c));
    await as(CLIENT_A, 'client', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM formulations`)).toBe(0);
    });
  });

  it('#31 versions are unique per pair, so a re-aim cannot collide', async () => {
    await linkActive();
    await asCommit(CLINICIAN, 'clinician', (c) => insertFormulation(c, FORM, 1));
    await as(CLINICIAN, 'clinician', async (c) => {
      await expect(insertFormulation(c, uid(902), 1)).rejects.toThrow();
    });
    await asCommit(CLINICIAN, 'clinician', (c) => insertFormulation(c, uid(903), 2));
    expect(await count(admin, `SELECT count(*) n FROM formulations`)).toBe(2);
  });

  it('#32 a formulation needs all three gate attestations present', async () => {
    await linkActive();
    await as(CLINICIAN, 'clinician', async (c) => {
      await expect(
        c.query(
          `INSERT INTO formulations (id, clinician_id, client_id, link_id, version, note_enc, falsify_enc, gates, floor)
           VALUES ($1, $2, $3, $4, 1, '\\x00', '\\x00', '{"risk":true,"dial":true}'::jsonb, 4)`,
          [uid(904), CLINICIAN, CLIENT_A, LINK],
        ),
      ).rejects.toThrow();
    });
  });

  // --- assistant runs ------------------------------------------------------

  it('#33 assistant runs are readable only by their author, and never updated', async () => {
    await linkActive();
    await asCommit(CLINICIAN, 'clinician', (c) =>
      c.query(
        `INSERT INTO assistant_runs (id, clinician_id, client_id, note_sha256, model, latency_ms)
         VALUES ($1, $2, $3, $4, 'test-model', 12)`,
        [RUN, CLINICIAN, CLIENT_A, hash(7)],
      ),
    );
    await as(CLINICIAN_B, 'clinician', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM assistant_runs`)).toBe(0);
    });
    await as(CLINICIAN, 'clinician', async (c) => {
      await expect(c.query(`UPDATE assistant_runs SET model = 'x' WHERE id = $1`, [RUN])).rejects.toThrow();
    });
  });

  // --- the training stack --------------------------------------------------

  it('#34 a clinician sees only their own training stack', async () => {
    await asCommit(CLINICIAN, 'clinician', (c) =>
      c.query(`INSERT INTO clinician_stacks (clinician_id, modality_slug, tier) VALUES ($1, 'act', 'master')`, [
        CLINICIAN,
      ]),
    );
    await as(CLINICIAN, 'clinician', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM clinician_stacks`)).toBe(1);
    });
    await as(CLINICIAN_B, 'clinician', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM clinician_stacks`)).toBe(0);
    });
  });

  it('#35 a client cannot read a training stack or a roadmap at all, linked or not', async () => {
    await linkActive();
    await asCommit(CLINICIAN, 'clinician', async (c) => {
      await c.query(`INSERT INTO clinician_stacks (clinician_id, modality_slug, tier) VALUES ($1, 'cbt', 'fluent')`, [
        CLINICIAN,
      ]);
      await c.query(`INSERT INTO stack_goals (clinician_id, modality_slug, target_tier) VALUES ($1, 'emdr', 'deep')`, [
        CLINICIAN,
      ]);
    });
    // Their own clinician's stack included. This is not a directory of who
    // treats what, and nothing here is designed to become one.
    await as(CLIENT_A, 'client', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM clinician_stacks`)).toBe(0);
      expect(await count(c, `SELECT count(*) n FROM stack_goals`)).toBe(0);
    });
  });

  it('#36 a clinician cannot write into another clinician’s stack or roadmap', async () => {
    await as(CLINICIAN_B, 'clinician', async (c) => {
      await expect(
        c.query(`INSERT INTO clinician_stacks (clinician_id, modality_slug, tier) VALUES ($1, 'act', 'master')`, [
          CLINICIAN,
        ]),
      ).rejects.toThrow();
      await expect(
        c.query(`INSERT INTO stack_goals (clinician_id, modality_slug, target_tier) VALUES ($1, 'act', 'master')`, [
          CLINICIAN,
        ]),
      ).rejects.toThrow();
    });
  });

  it('#37 the reading rules are not constraints: a second Master and Deep are stored', async () => {
    // The app warns. The database does not refuse — a clinician mid-transition
    // between certifications is describing something true.
    await asCommit(CLINICIAN, 'clinician', (c) =>
      c.query(
        `INSERT INTO clinician_stacks (clinician_id, modality_slug, tier)
         VALUES ($1,'act','master'), ($1,'cbt','master'), ($1,'emdr','deep'), ($1,'gestalt','deep')`,
        [CLINICIAN],
      ),
    );
    await as(CLINICIAN, 'clinician', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM clinician_stacks WHERE tier = 'master'`)).toBe(2);
      expect(await count(c, `SELECT count(*) n FROM clinician_stacks WHERE tier = 'deep'`)).toBe(2);
    });
  });

  it('#38 the scope annotation is a record, not a constraint', async () => {
    await linkActive();
    const insert = (outside: boolean | null, version: number) =>
      asCommit(CLINICIAN, 'clinician', (c) =>
        c.query(
          `INSERT INTO formulations
             (id, clinician_id, client_id, link_id, version, note_enc, falsify_enc,
              observations, gates, floor, outside_stack)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, decode('00', 'hex'), decode('00', 'hex'),
              '[]'::jsonb, '{"risk":true,"dial":true,"calibrated":true}'::jsonb, 6, $5)`,
          [CLINICIAN, CLIENT_A, LINK, version, outside],
        ),
      );

    // Every value is legal. The gate annotates; nothing about it can refuse a
    // write, and there is no CHECK left that could.
    await expect(insert(true, 1)).resolves.toBeTruthy();
    await expect(insert(false, 2)).resolves.toBeTruthy();
    await expect(insert(null, 3)).resolves.toBeTruthy();
  });

  // --- measures -----------------------------------------------------------

  it('#39 a client reads every measure about themselves, including the clinician’s', async () => {
    await linkActive();
    await asCommit(CLINICIAN, 'clinician', (c) =>
      c.query(
        `INSERT INTO measures (id, client_id, clinician_id, instrument, score, administered_at, administered_by)
         VALUES (gen_random_uuid(), $1, $2, 'ims', 42, now(), 'clinician')`,
        [CLIENT_A, CLINICIAN],
      ),
    );
    await as(CLIENT_A, 'client', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM measures`)).toBe(1);
    });
    await as(CLIENT_B, 'client', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM measures`)).toBe(0);
    });
  });

  it('#40 a clinician reads a measure only through an active link', async () => {
    await linkActive();
    await asCommit(CLIENT_A, 'client', (c) =>
      c.query(
        `INSERT INTO measures (id, client_id, instrument, score, administered_at, administered_by)
         VALUES (gen_random_uuid(), $1, 'ims', 30, now(), 'client')`,
        [CLIENT_A],
      ),
    );
    await as(CLINICIAN, 'clinician', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM measures`)).toBe(1);
    });
    await as(CLINICIAN_B, 'clinician', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM measures`)).toBe(0);
    });
    await revoke();
    await as(CLINICIAN, 'clinician', async (c) => {
      expect(await count(c, `SELECT count(*) n FROM measures`)).toBe(0);
    });
  });

  it('#41 a client cannot write a measure that names a clinician', async () => {
    await linkActive();
    await as(CLIENT_A, 'client', async (c) => {
      await expect(
        c.query(
          `INSERT INTO measures (id, client_id, clinician_id, instrument, score, administered_at, administered_by)
           VALUES (gen_random_uuid(), $1, $2, 'ims', 42, now(), 'clinician')`,
          [CLIENT_A, CLINICIAN],
        ),
      ).rejects.toThrow();
    });
  });

  it('#42 a clinician cannot write a measure about a client they do not hold', async () => {
    await as(CLINICIAN, 'clinician', async (c) => {
      await expect(
        c.query(
          `INSERT INTO measures (id, client_id, clinician_id, instrument, score, administered_at, administered_by)
           VALUES (gen_random_uuid(), $1, $2, 'ims', 42, now(), 'clinician')`,
          [CLIENT_B, CLINICIAN],
        ),
      ).rejects.toThrow();
    });
  });

  it('#43 a measure is append-only', async () => {
    await asCommit(CLIENT_A, 'client', (c) =>
      c.query(
        `INSERT INTO measures (id, client_id, instrument, score, administered_at, administered_by)
         VALUES (gen_random_uuid(), $1, 'ims', 30, now(), 'client')`,
        [CLIENT_A],
      ),
    );
    await as(CLIENT_A, 'client', async (c) => {
      await expect(c.query(`UPDATE measures SET score = 1`)).rejects.toThrow();
    });
  });

  // --- deletion -----------------------------------------------------------

  it('#44 a client cannot hard-delete their own live rows', async () => {
    // 0007 grants DELETE for the first time. 0001's client policies are FOR
    // ALL, which includes DELETE — so without the RESTRICTIVE policies in 0007
    // that grant would hand every client the power to destroy their own
    // ledger. This is the test that says it did not.
    await as(CLIENT_A, 'client', async (c) => {
      for (const t of ['predictions', 'priors', 'body_states', 'reinterpretations', 'journal_entries']) {
        const r = await c.query(`DELETE FROM ${t}`);
        expect(r.rowCount, t).toBe(0);
      }
      // users has no DELETE grant at all, so this is an error rather than
      // zero rows: formulations and assistant_runs cascade from it.
      await expect(c.query(`DELETE FROM users WHERE id = $1`, [CLIENT_A])).rejects.toThrow(/permission denied/i);
    });
    // Everything is still there.
    await as(CLIENT_A, 'client', async (c) => {
      expect(await count(c, 'SELECT count(*) n FROM predictions')).toBe(1);
      expect(await count(c, 'SELECT count(*) n FROM journal_entries')).toBe(2);
    });
  });

  it('#45 a client cannot hard-delete rows of their own deleted account either', async () => {
    await admin.query(`UPDATE users SET deleted_at = now() - interval '90 days' WHERE id = $1`, [CLIENT_A]);
    // Past the grace period, but the client is not the system role.
    await as(CLIENT_A, 'client', async (c) => {
      expect((await c.query(`DELETE FROM predictions`)).rowCount).toBe(0);
      // And nobody deletes a users row at all: there is no grant, so this is
      // an error rather than zero rows. formulations and assistant_runs
      // cascade from it, and they are the clinician's record.
      await expect(c.query(`DELETE FROM users WHERE id = $1`, [CLIENT_A])).rejects.toThrow(/permission denied/i);
    });
    expect(Number((await admin.query(`SELECT count(*) n FROM predictions`)).rows[0]!.n)).toBe(1);
  });

  it('#46 a clinician cannot hard-delete a linked client’s rows', async () => {
    await linkActive({ predictions: true });
    await admin.query(`UPDATE users SET deleted_at = now() - interval '90 days' WHERE id = $1`, [CLIENT_A]);
    await as(CLINICIAN, 'clinician', async (c) => {
      expect((await c.query(`DELETE FROM predictions`)).rowCount).toBe(0);
    });
  });

  it('#47 the system role deletes only rows of a deleted account past the grace period', async () => {
    const asSystem = asSystemTx;

    // Live account: refused even as system.
    await asSystem(async (c) => {
      expect((await c.query(`DELETE FROM predictions`)).rowCount).toBe(0);
    });

    // Account deleted but inside the window: still refused.
    await admin.query(`UPDATE users SET deleted_at = now() - interval '10 days' WHERE id = $1`, [CLIENT_A]);
    await asSystem(async (c) => {
      expect((await c.query(`DELETE FROM predictions`)).rowCount).toBe(0);
    });

    // Past the window: allowed. prediction_priors first — nothing cascades.
    await admin.query(`UPDATE users SET deleted_at = now() - interval '31 days' WHERE id = $1`, [CLIENT_A]);
    await asSystem(async (c) => {
      await c.query(`DELETE FROM prediction_priors`);
      await c.query(`DELETE FROM body_states`);
      await c.query(`DELETE FROM reinterpretations`);
      await c.query(`DELETE FROM crisis_events`);
      expect((await c.query(`DELETE FROM predictions`)).rowCount).toBe(1);
    });
  });

  it('#48 the system role scrubs a deleted user and cannot touch a live one', async () => {
    const scrub = (uid: string) =>
      asSystemTx(async (c) => (await c.query(`UPDATE users SET timezone = 'UTC' WHERE id = $1`, [uid])).rowCount);

    // Live: no rows. The policy's USING is app_purgeable_user(id).
    expect(await scrub(CLIENT_A)).toBe(0);

    // Deleted but inside the grace period: still no rows.
    await admin.query(`UPDATE users SET deleted_at = now() - interval '10 days' WHERE id = $1`, [CLIENT_A]);
    expect(await scrub(CLIENT_A)).toBe(0);

    // Past it: the scrub lands, and only on that row.
    await admin.query(`UPDATE users SET deleted_at = now() - interval '31 days' WHERE id = $1`, [CLIENT_A]);
    expect(await scrub(CLIENT_A)).toBe(1);
    expect(await scrub(CLIENT_B)).toBe(0);
  });

  it('#49 the system role cannot un-delete a user it scrubbed', async () => {
    await admin.query(`UPDATE users SET deleted_at = now() - interval '31 days' WHERE id = $1`, [CLIENT_A]);
    // WITH CHECK is the same predicate as USING, so a row cannot be updated
    // out of the purgeable set — clearing deleted_at would do exactly that.
    await asSystemTx(async (c) => {
      await expect(c.query(`UPDATE users SET deleted_at = NULL WHERE id = $1`, [CLIENT_A])).rejects.toThrow(
        /row-level security/i,
      );
    });
  });

  it('#50 the system role reads only what it may purge, and nothing else', async () => {
    // It needs to read: a DELETE whose WHERE touches a column has SELECT
    // policies applied to it too, so a system role that could read nothing
    // would delete nothing. The predicate is the same one, so what it can see
    // is exactly what it can destroy — a live account stays invisible to it,
    // and a bug in the purge job cannot become a cross-user read.
    const asSystem = asSystemTx;
    const TABLES = ['predictions', 'priors', 'journal_entries', 'body_states', 'reinterpretations'];

    // Live rows: invisible.
    await asSystem(async (c) => {
      for (const t of TABLES) expect(await count(c, `SELECT count(*) n FROM ${t}`), t).toBe(0);
    });

    // Account deleted but inside the window: still invisible.
    await admin.query(`UPDATE users SET deleted_at = now() - interval '10 days' WHERE id = $1`, [CLIENT_A]);
    await asSystem(async (c) => {
      expect(await count(c, `SELECT count(*) n FROM predictions`)).toBe(0);
    });

    // Past the window: visible, because it is about to be deleted.
    await admin.query(`UPDATE users SET deleted_at = now() - interval '31 days' WHERE id = $1`, [CLIENT_A]);
    await asSystem(async (c) => {
      expect(await count(c, `SELECT count(*) n FROM predictions`)).toBe(1);
      expect(await count(c, `SELECT count(*) n FROM journal_entries`)).toBe(2);
      // CLIENT_B is live, so nothing of theirs is visible even now.
      expect(await count(c, `SELECT count(*) n FROM users WHERE id = $1`, [CLIENT_B])).toBe(0);
    });
  });
});
