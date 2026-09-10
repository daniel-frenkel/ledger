/**
 * Research readiness — proposal 03, and the export in particular.
 *
 * The export is the one place in this system where data leaves it as a file.
 * Most of what follows is about what cannot be in that file.
 *
 * Needs Postgres with the migrations applied.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { closeDb } from '../src/db/client.js';
import { purgeDeleted } from '../src/jobs/purge.js';
import { setAuthAdmin } from '../src/auth-admin.js';
import { ALLOWLIST, FORBIDDEN_NAMES, FORBIDDEN_SUFFIXES, allowlistHash } from '../src/research/allowlist.js';
import { pseudonym, runExport, shiftDaysFor } from '../src/research/export.js';
import { ADMIN_URL, CLIENT_A, CLIENT_B, CLINICIAN, acceptBaa, asUser, buildApp, truncateAll, uid } from './helpers.js';

let app: FastifyInstance;
let admin: pg.Client;
let dir: string;

const T = '2026-09-01T18:00:00.000Z';
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
  setAuthAdmin({ deleteUser: async () => {}, assuranceLevel: () => 'aal2' });
  app = await buildApp();
  await truncateAll();
  await admin.query(`INSERT INTO users (id, role) VALUES ($1,'client'), ($2,'client'), ($3,'clinician')`, [
    CLIENT_A,
    CLIENT_B,
    CLINICIAN,
  ]);
  await acceptBaa([CLINICIAN]);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-export-'));
});
afterEach(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const consent = (who: string, consented = true) =>
  app.inject({
    method: 'PUT',
    url: '/v1/me/research-consent',
    headers: asUser(who, 'client'),
    payload: { consented },
  });

/** A ledger for `who`, offset so two participants do not share row ids. */
async function seed(who: string, offset = 0): Promise<void> {
  const id = (n: number) => uid(n + offset);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/sync',
    headers: asUser(who, 'client'),
    payload: {
      deviceId: id(700),
      appVersion: '1.2.3',
      usageEvents: [{ id: id(801), kind: 'app_open', createdAt: T }],
      priors: [
        { id: id(201), label: 'ZQX-LABEL if I show weakness they withdraw', category: 'mattering', origin: 'client', createdBy: 'client', createdAt: T, clientUpdatedAt: T },
      ],
      predictions: [
        {
          id: id(101),
          situation: 'ZQX-SITUATION telling the sergeant I froze',
          expectedOutcome: 'ZQX-EXPECTED he will call me a coward',
          confidence: 80,
          priorIds: [id(201)],
          resolvedAt: T,
          actualOutcome: 'ZQX-ACTUAL he nodded',
          outcomeVerdict: 'miss',
          outcomeSource: 'observed',
          surpriseRating: 8,
          presentForIt: true,
          countsFor: 20,
          createdAt: T,
          clientUpdatedAt: T,
        },
      ],
      reinterpretations: [{ id: id(301), predictionId: id(101), text: 'ZQX-REINTERP he was only being nice', createdAt: T, clientUpdatedAt: T }],
      journalEntries: [{ id: id(401), body: 'ZQX-JOURNAL a thing I wrote', createdAt: T, clientUpdatedAt: T }],
    },
  });
  expect(res.statusCode).toBe(200);
}

const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');

// ---------------------------------------------------------------------------
// The tables
// ---------------------------------------------------------------------------

describe('usage_events', () => {
  it('has exactly five columns, and none of them can hold a payload', async () => {
    const cols = await admin.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'usage_events' ORDER BY column_name`,
    );
    expect(cols.rows.map((r: { column_name: string }) => r.column_name)).toEqual([
      'app_version',
      'created_at',
      'id',
      'kind',
      'user_id',
    ]);
  });

  it('is written by the client through sync, with the build stamped on it', async () => {
    await seed(CLIENT_A);
    const row = (await admin.query(`SELECT * FROM usage_events`)).rows[0]!;
    expect(row).toMatchObject({ user_id: CLIENT_A, kind: 'app_open', app_version: '1.2.3' });
  });
});

describe('provenance', () => {
  it('stamps app_version and received_at on every synced row', async () => {
    await seed(CLIENT_A);
    for (const t of ['predictions', 'priors', 'reinterpretations', 'journal_entries']) {
      const row = (await admin.query(`SELECT app_version, received_at FROM ${t}`)).rows[0]!;
      expect(row.app_version, t).toBe('1.2.3');
      expect(row.received_at, t).not.toBeNull();
    }
  });

  it('refuses to let received_at move', async () => {
    await seed(CLIENT_A);
    await expect(admin.query(`UPDATE predictions SET received_at = now()`)).rejects.toThrow(/server clock/);
  });
});

// ---------------------------------------------------------------------------
// The allowlist — the boundary of the export
// ---------------------------------------------------------------------------

describe('the allowlist', () => {
  it('contains no _enc column', () => {
    for (const t of ALLOWLIST) {
      for (const c of t.columns) {
        for (const bad of FORBIDDEN_SUFFIXES) expect(c.name.endsWith(bad), `${t.table}.${c.name}`).toBe(false);
      }
    }
  });

  it('contains no label, no text, and nothing anyone typed', () => {
    for (const t of ALLOWLIST) {
      for (const c of t.columns) {
        expect(FORBIDDEN_NAMES as readonly string[], `${t.table}.${c.name}`).not.toContain(c.name);
      }
    }
  });

  it('names every column it exports, so a new column cannot arrive by being added', async () => {
    // Every allowlisted column must actually exist; the export selects the
    // list, so a rename would fail here rather than silently drop data.
    for (const t of ALLOWLIST) {
      const cols = await admin.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [t.table],
      );
      const have = new Set(cols.rows.map((r: { column_name: string }) => r.column_name));
      expect(have.has(t.participant), `${t.table}.${t.participant}`).toBe(true);
      for (const c of t.columns) expect(have.has(c.name), `${t.table}.${c.name}`).toBe(true);
    }
  });

  it('hashes to something stable that changes when the shape does', () => {
    expect(allowlistHash()).toHaveLength(32);
    expect(allowlistHash().equals(allowlistHash())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------

describe('the export', () => {
  it('includes a consented participant and excludes everyone else', async () => {
    await seed(CLIENT_A);
    await seed(CLIENT_B, 1000);
    await consent(CLIENT_A);

    const out = await runExport({ dryRun: false, outDir: dir });
    expect(out.participants).toBe(1);

    const csv = read('predictions.csv');
    expect(csv.trim().split('\n')).toHaveLength(2); // header + one row
  });

  it('excludes a participant who withdrew', async () => {
    await seed(CLIENT_A);
    await consent(CLIENT_A);
    await consent(CLIENT_A, false);

    const out = await runExport({ dryRun: false, outDir: dir });
    expect(out.participants).toBe(0);
    expect(read('predictions.csv').trim().split('\n')).toHaveLength(1);
  });

  it('writes no column outside the allowlist, and nothing anyone typed', async () => {
    await seed(CLIENT_A);
    await consent(CLIENT_A);
    await runExport({ dryRun: false, outDir: dir });

    for (const t of ALLOWLIST) {
      const csv = read(`${t.table}.csv`);
      const header = csv.split('\n')[0]!.split(',');
      expect(header, t.table).toEqual(['participant', ...t.columns.map((c) => c.name)]);
      // And nothing seeded as prose survived anywhere in the file.
      expect(csv, t.table).not.toMatch(/ZQX-/);
    }
  });

  it('replaces the user id with a pseudonym that is not the id', async () => {
    await seed(CLIENT_A);
    await consent(CLIENT_A);
    await runExport({ dryRun: false, outDir: dir });

    const csv = read('predictions.csv');
    expect(csv).not.toContain(CLIENT_A);
    expect(csv.split('\n')[1]!.split(',')[0]).toMatch(/^[0-9a-f]{16}$/);
  });

  it('gives two runs different pseudonyms for the same person', async () => {
    await seed(CLIENT_A);
    await consent(CLIENT_A);

    await runExport({ dryRun: false, outDir: dir });
    const first = read('predictions.csv').split('\n')[1]!.split(',')[0];
    await runExport({ dryRun: false, outDir: dir });
    const second = read('predictions.csv').split('\n')[1]!.split(',')[0];

    expect(first).not.toBe(second);
  });

  it('shifts dates, and keeps every interval within a participant exact', async () => {
    const secret = Buffer.alloc(32, 7);
    const days = shiftDaysFor(CLIENT_A, secret);
    expect(Math.abs(days)).toBeLessThanOrEqual(180);

    await seed(CLIENT_A);
    await consent(CLIENT_A);
    await runExport({ dryRun: false, outDir: dir, secret });

    const header = read('predictions.csv').split('\n')[0]!.split(',');
    const row = read('predictions.csv').split('\n')[1]!.split(',');
    const created = new Date(row[header.indexOf('created_at')]!);
    const resolved = new Date(row[header.indexOf('resolved_at')]!);

    // Both were seeded at the same instant, so the interval is zero — and
    // stays zero. The absolute date has moved by the participant's offset.
    expect(resolved.getTime() - created.getTime()).toBe(0);
    expect(created.getTime()).toBe(new Date(T).getTime() + days * 86_400_000);
    expect(pseudonym(CLIENT_A, secret)).toBe(row[0]);
  });

  it('writes a codebook naming every column it exported', async () => {
    await seed(CLIENT_A);
    await consent(CLIENT_A);
    await runExport({ dryRun: false, outDir: dir });

    const book = read('codebook.md');
    for (const t of ALLOWLIST) {
      expect(book, t.table).toContain(`## ${t.table}`);
      for (const c of t.columns) expect(book, `${t.table}.${c.name}`).toContain(`| ${c.name} |`);
    }
    expect(book).toContain('the mapping is not stored');
  });

  it('logs the run without saying who was in it', async () => {
    await seed(CLIENT_A);
    await consent(CLIENT_A);
    const out = await runExport({ dryRun: false, outDir: dir });

    const row = (await admin.query(`SELECT * FROM exports`)).rows[0]!;
    expect(row.id).toBe(out.runId);
    expect(row.participant_count).toBe(1);
    expect(Buffer.from(row.allowlist_sha256)).toEqual(allowlistHash());
    // Nothing about who: no column could hold it.
    expect(JSON.stringify(row)).not.toContain(CLIENT_A);
  });

  it('writes nothing on a dry run, but still reports what it would', async () => {
    await seed(CLIENT_A);
    await consent(CLIENT_A);

    const out = await runExport({ dryRun: true });
    expect(out.participants).toBe(1);
    expect(out.rows['predictions']).toBe(1);
    expect(out.secret).toBeUndefined();
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The measures split, carried from Prompt 14
// ---------------------------------------------------------------------------

describe('measures and the purge', () => {
  const measure = (who: string, role: 'client' | 'clinician', clientId?: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/measures',
      headers: asUser(who, role),
      payload: {
        ...(clientId ? { clientId } : {}),
        measure: {
          instrument: 'ims',
          score: 42,
          administeredAt: T,
          administeredBy: role,
        },
      },
    });

  async function link(): Promise<void> {
    const made = await app.inject({ method: 'POST', url: '/v1/invites', headers: asUser(CLINICIAN, 'clinician'), payload: {} });
    const { token } = made.json() as { token: string };
    const done = await app.inject({ method: 'POST', url: '/v1/invites/redeem', headers: asUser(CLIENT_A, 'client'), payload: { token } });
    expect(done.statusCode).toBe(200);
  }

  it('records the link a clinician measure was taken under', async () => {
    await link();
    expect((await measure(CLINICIAN, 'clinician', CLIENT_A)).statusCode).toBe(201);
    expect((await admin.query(`SELECT link_id FROM measures`)).rows[0]!.link_id).not.toBeNull();
  });

  it('records no link for a self-administered measure with no clinician', async () => {
    expect((await measure(CLIENT_A, 'client')).statusCode).toBe(201);
    expect((await admin.query(`SELECT link_id FROM measures`)).rows[0]!.link_id).toBeNull();
  });

  it('keeps a linked measure through the client’s purge and deletes an unlinked one', async () => {
    await link();
    await measure(CLINICIAN, 'clinician', CLIENT_A); // care record
    await admin.query(`UPDATE clinician_client_links SET status = 'revoked'`);
    await measure(CLIENT_A, 'client'); // the client's own, no link
    await admin.query(`UPDATE clinician_client_links SET status = 'active'`);

    expect((await admin.query(`SELECT count(*) n FROM measures`)).rows[0]!.n).toBe('2');

    await app.inject({ method: 'DELETE', url: '/v1/me', headers: asUser(CLIENT_A, 'client') });
    await admin.query(`UPDATE users SET deleted_at = now() - interval '31 days' WHERE id = $1`, [CLIENT_A]);
    await purgeDeleted();

    const left = await admin.query(`SELECT link_id FROM measures`);
    expect(left.rowCount, 'the care record survives, the client’s own does not').toBe(1);
    expect(left.rows[0]!.link_id).not.toBeNull();
  });
});

describe('research consent is the client’s alone', () => {
  /**
   * The clinician app shows nothing about a client's research consent, and the
   * API gives it nothing to show. Not a UI decision: a clinician who could see
   * it could ask about it, and a request from the person holding the notes is
   * not a free choice.
   */
  const CONSENT_COLUMNS = ['research_consent', 'researchConsent', 'consentAt', 'consent_at'];

  it('appears in no clinician route’s response', async () => {
    await admin.query(
      `UPDATE users SET research_consent_at = now(), research_consent_version = 'v1' WHERE id = $1`,
      [CLIENT_A],
    );
    const made = await app.inject({ method: 'POST', url: '/v1/invites', headers: asUser(CLINICIAN, 'clinician'), payload: {} });
    const { token } = made.json() as { token: string };
    await app.inject({ method: 'POST', url: '/v1/invites/redeem', headers: asUser(CLIENT_A, 'client'), payload: { token } });

    for (const url of [
      '/v1/links',
      '/v1/invites',
      `/v1/clients/${CLIENT_A}/formulations`,
      `/v1/clients/${CLIENT_A}/measures`,
      `/v1/clients/${CLIENT_A}/phase-events`,
      '/v1/clinician/stack',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: asUser(CLINICIAN, 'clinician') });
      for (const c of CONSENT_COLUMNS) expect(res.body, `${url}: ${c}`).not.toContain(c);
    }
  });

  it('is refused to a clinician trying to set it', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/me/research-consent',
      headers: asUser(CLINICIAN, 'clinician'),
      payload: { consented: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('leaves the consent timestamp as history when withdrawn', async () => {
    await consent(CLIENT_A);
    await consent(CLIENT_A, false);
    const row = (await admin.query(`SELECT * FROM users WHERE id = $1`, [CLIENT_A])).rows[0]!;
    // That someone consented on a date does not stop being true.
    expect(row.research_consent_at).not.toBeNull();
    expect(row.research_consent_withdrawn_at).not.toBeNull();
  });

  it('does not touch clinician sharing, and clinician sharing does not touch it', async () => {
    await consent(CLIENT_A);
    const made = await app.inject({ method: 'POST', url: '/v1/invites', headers: asUser(CLINICIAN, 'clinician'), payload: {} });
    const { token } = made.json() as { token: string };
    await app.inject({ method: 'POST', url: '/v1/invites/redeem', headers: asUser(CLIENT_A, 'client'), payload: { token } });

    const row = (await admin.query(`SELECT research_consent_at FROM users WHERE id = $1`, [CLIENT_A])).rows[0]!;
    expect(row.research_consent_at).not.toBeNull();
  });
});
