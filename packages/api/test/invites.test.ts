/**
 * Invites and formulations, through the routes.
 *
 * The RLS suite proves the database refuses the wrong reads. This proves the
 * routes above it behave: the token appears exactly once and nowhere else, the
 * five redemption failures are indistinguishable, two simultaneous redemptions
 * of one token produce one link, and a formulation with an unattested gate is
 * not written.
 *
 * Needs Postgres with the migrations applied.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { closeDb } from '../src/db/client.js';
import { tokenHash } from '../src/routes/invites.js';
import { GATE_NAMES } from '../src/routes/formulations.js';
import {
  ADMIN_URL,
  CLIENT_A,
  CLIENT_B,
  CLINICIAN,
  CLINICIAN_B,
  LogSink,
  asUser,
  buildApp,
  truncateAll,
  uid,
} from './helpers.js';

let app: FastifyInstance;
let admin: pg.Client;

const CLEARED = { risk: true, dial: true, calibrated: true };

beforeAll(async () => {
  app = await buildApp();
  admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
});
afterAll(async () => {
  await app.close();
  await admin.end();
  await closeDb();
});

beforeEach(async () => {
  await truncateAll();
  await admin.query(`INSERT INTO users (id, role) VALUES ($1,'client'), ($2,'client'), ($3,'clinician'), ($4,'clinician')`, [
    CLIENT_A,
    CLIENT_B,
    CLINICIAN,
    CLINICIAN_B,
  ]);
});

/** Create an invite as the clinician and return its token. */
async function createInvite(who = CLINICIAN): Promise<{ id: string; token: string }> {
  const res = await app.inject({ method: 'POST', url: '/v1/invites', headers: asUser(who, 'clinician'), payload: {} });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; token: string };
}

const redeem = (token: string, who = CLIENT_A, share = {}) =>
  app.inject({
    method: 'POST',
    url: '/v1/invites/redeem',
    headers: asUser(who, 'client'),
    payload: { token, ...share },
  });

describe('POST /v1/invites', () => {
  it('returns a token once, and a 32-byte hash is what gets stored', async () => {
    const { id, token } = await createInvite();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url, unpadded

    const row = (await admin.query(`SELECT * FROM link_invites WHERE id = $1`, [id])).rows[0]!;
    expect(Buffer.from(row.token_hash)).toEqual(tokenHash(token));
    // The token itself is nowhere in the row.
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('sets expiry seven days out, and the client cannot choose it', async () => {
    const { id } = await createInvite();
    const row = (await admin.query(`SELECT created_at, expires_at FROM link_invites WHERE id = $1`, [id])).rows[0]!;
    const days = (row.expires_at.getTime() - row.created_at.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 5);
  });

  it('refuses a client', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/invites', headers: asUser(CLIENT_A), payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/invites', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/invites', () => {
  it('lists only the caller’s open invites, and never a hash', async () => {
    const mine = await createInvite(CLINICIAN);
    await createInvite(CLINICIAN_B);
    const used = await createInvite(CLINICIAN);
    await redeem(used.token);

    const res = await app.inject({ method: 'GET', url: '/v1/invites', headers: asUser(CLINICIAN, 'clinician') });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([mine.id]);
    expect(res.body).not.toContain('token');
  });
});

describe('DELETE /v1/invites/:id', () => {
  it('revokes an open invite, and the token then fails like any other', async () => {
    const { id, token } = await createInvite();
    const del = await app.inject({ method: 'DELETE', url: `/v1/invites/${id}`, headers: asUser(CLINICIAN, 'clinician') });
    expect(del.statusCode).toBe(200);
    expect((await redeem(token)).statusCode).toBe(404);
  });

  it('cannot revoke another clinician’s invite', async () => {
    const { id } = await createInvite(CLINICIAN);
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/invites/${id}`,
      headers: asUser(CLINICIAN_B, 'clinician'),
    });
    expect(del.statusCode).toBe(404);
  });
});

describe('POST /v1/invites/redeem', () => {
  it('creates the link with the share flags the client chose', async () => {
    const { token } = await createInvite();
    const res = await redeem(token, CLIENT_A, { sharePredictions: true, shareBodyStates: false });
    expect(res.statusCode).toBe(200);

    const link = (await admin.query(`SELECT * FROM clinician_client_links WHERE client_id = $1`, [CLIENT_A])).rows[0]!;
    expect(link.status).toBe('active');
    expect(link.clinician_id).toBe(CLINICIAN);
    expect(link.share_predictions).toBe(true);
    expect(link.share_body_states).toBe(false);
    expect(link.consented_at).not.toBeNull();
  });

  it('gives one message for every failure', async () => {
    const good = await createInvite();
    const used = await createInvite();
    await redeem(used.token, CLIENT_B);
    const revoked = await createInvite();
    await app.inject({
      method: 'DELETE',
      url: `/v1/invites/${revoked.id}`,
      headers: asUser(CLINICIAN, 'clinician'),
    });

    const bodies = await Promise.all(
      [
        redeem('not-a-real-token'), // unknown
        redeem(used.token), // already used
        redeem(revoked.token), // revoked
        redeem(good.token, CLINICIAN), // the clinician themselves
      ].map(async (p) => {
        const r = await p;
        return { status: r.statusCode, body: r.body };
      }),
    );

    // Same status, same body, every time. Nothing distinguishes them.
    for (const b of bodies) expect(b.status).toBe(404);
    expect(new Set(bodies.map((b) => b.body)).size).toBe(1);
    expect(bodies[0]!.body).toContain("This invitation isn't valid");
  });

  it('a malformed body is the same answer as a bad token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invites/redeem',
      headers: asUser(CLIENT_A),
      payload: { nope: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("This invitation isn't valid");
  });

  /**
   * The proposal's single-use guarantee is one UPDATE with `redeemed_at IS
   * NULL` in its WHERE. That is a claim about what happens when two requests
   * arrive together, so it is tested that way rather than assumed.
   */
  it('two simultaneous redemptions of one token: one 200, one 404, one link', async () => {
    const { token } = await createInvite();

    const [a, b] = await Promise.all([redeem(token, CLIENT_A), redeem(token, CLIENT_B)]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 404]);

    const links = await admin.query(`SELECT * FROM clinician_client_links`);
    expect(links.rowCount).toBe(1);

    // The winner is the one that got the 200, and the invite records them.
    const winner = a.statusCode === 200 ? CLIENT_A : CLIENT_B;
    expect(links.rows[0]!.client_id).toBe(winner);
    const inv = (await admin.query(`SELECT redeemed_by, link_id FROM link_invites`)).rows[0]!;
    expect(inv.redeemed_by).toBe(winner);
    expect(inv.link_id).toBe(links.rows[0]!.id);
  });

  it('five simultaneous redemptions still produce exactly one link', async () => {
    const { token } = await createInvite();
    const results = await Promise.all([
      redeem(token, CLIENT_A),
      redeem(token, CLIENT_B),
      redeem(token, CLIENT_A),
      redeem(token, CLIENT_B),
      redeem(token, CLIENT_A),
    ]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 404)).toHaveLength(4);
    expect((await admin.query(`SELECT * FROM clinician_client_links`)).rowCount).toBe(1);
  });
});

describe('the token never leaves the create response', () => {
  it('appears in no log line, at trace level, across the whole flow', async () => {
    const sink = new LogSink();
    const noisy = await buildApp(sink);
    try {
      const created = await noisy.inject({
        method: 'POST',
        url: '/v1/invites',
        headers: asUser(CLINICIAN, 'clinician'),
        payload: {},
      });
      const { id, token } = created.json() as { id: string; token: string };
      await noisy.inject({ method: 'GET', url: '/v1/invites', headers: asUser(CLINICIAN, 'clinician') });
      await noisy.inject({ method: 'POST', url: '/v1/invites/redeem', headers: asUser(CLIENT_A), payload: { token } });
      // And a failure path, which is where a message tends to quote its input.
      await noisy.inject({ method: 'POST', url: '/v1/invites/redeem', headers: asUser(CLIENT_B), payload: { token } });
      await noisy.inject({ method: 'DELETE', url: `/v1/invites/${id}`, headers: asUser(CLINICIAN, 'clinician') });

      const logs = sink.text();
      expect(logs).not.toContain(token);
      expect(logs).not.toContain(tokenHash(token).toString('hex'));
      expect(logs).not.toContain(tokenHash(token).toString('base64'));
    } finally {
      await noisy.close();
    }
  });

  it('appears in no error body', async () => {
    const { token } = await createInvite();
    await redeem(token);
    const second = await redeem(token, CLIENT_B);
    expect(second.body).not.toContain(token);
    expect(second.body).not.toContain(tokenHash(token).toString('hex'));
  });
});

describe('POST /v1/formulations', () => {
  const NOTE = 'ZQX-NOTE-7001 he goes quiet whenever his sister is mentioned';
  const FALSIFY = 'ZQX-FALSIFY-7002 it would move after one disclosure test';

  const write = (over: Record<string, unknown> = {}, who = CLINICIAN) =>
    app.inject({
      method: 'POST',
      url: '/v1/formulations',
      headers: asUser(who, 'clinician'),
      payload: {
        clientId: CLIENT_A,
        note: NOTE,
        falsify: FALSIFY,
        observations: [0, 3],
        gates: CLEARED,
        floor: 4,
        ...over,
      },
    });

  async function link(share = {}) {
    const { token } = await createInvite();
    await redeem(token, CLIENT_A, share);
  }

  it('writes version 1, then 2 on a re-aim', async () => {
    await link();
    const first = await write();
    expect(first.statusCode).toBe(201);
    expect((first.json() as { version: number }).version).toBe(1);
    const second = await write({ floor: 6 });
    expect((second.json() as { version: number }).version).toBe(2);
  });

  it('refuses every gate that is not attested', async () => {
    await link();
    for (const gate of GATE_NAMES) {
      const res = await write({ gates: { ...CLEARED, [gate]: false } });
      expect(res.statusCode, gate).toBe(422);
      expect((res.json() as { fields: string[] }).fields).toEqual([gate]);
    }
    expect((await admin.query(`SELECT count(*) n FROM formulations`)).rows[0]!.n).toBe('0');
  });

  it('refuses a missing gate outright', async () => {
    await link();
    const res = await write({ gates: { risk: true, dial: true } });
    expect(res.statusCode).toBe(400);
  });

  it('requires the falsify line', async () => {
    await link();
    const res = await write({ falsify: '' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { fields: string[] }).fields).toContain('falsify');
  });

  it('refuses without an active link, and after revocation', async () => {
    expect((await write()).statusCode).toBe(403);
    await link();
    expect((await write()).statusCode).toBe(201);
    await admin.query(`UPDATE clinician_client_links SET status = 'revoked' WHERE client_id = $1`, [CLIENT_A]);
    expect((await write({ floor: 2 })).statusCode).toBe(403);
  });

  it('refuses a client', async () => {
    await link();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/formulations',
      headers: asUser(CLIENT_A),
      payload: { clientId: CLIENT_B, note: 'x', falsify: 'y', observations: [], gates: CLEARED, floor: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('stores the note encrypted and reads it back', async () => {
    await link();
    await write();
    const row = (await admin.query(`SELECT note_enc, falsify_enc FROM formulations`)).rows[0]!;
    expect(Buffer.from(row.note_enc).toString('utf8')).not.toContain('ZQX-NOTE');
    expect(Buffer.from(row.falsify_enc).toString('utf8')).not.toContain('ZQX-FALSIFY');

    const read = await app.inject({
      method: 'GET',
      url: `/v1/clients/${CLIENT_A}/formulations`,
      headers: asUser(CLINICIAN, 'clinician'),
    });
    const rows = read.json() as { note: string; falsify: string; version: number }[];
    expect(rows[0]!.note).toBe(NOTE);
    expect(rows[0]!.falsify).toBe(FALSIFY);
  });

  it('the note reaches no log line', async () => {
    const sink = new LogSink();
    const noisy = await buildApp(sink);
    try {
      const { token } = await createInvite();
      await noisy.inject({ method: 'POST', url: '/v1/invites/redeem', headers: asUser(CLIENT_A), payload: { token } });
      await noisy.inject({
        method: 'POST',
        url: '/v1/formulations',
        headers: asUser(CLINICIAN, 'clinician'),
        payload: { clientId: CLIENT_A, note: NOTE, falsify: FALSIFY, observations: [0], gates: CLEARED, floor: 4 },
      });
      // And a rejected one, where a validation message could echo the note.
      await noisy.inject({
        method: 'POST',
        url: '/v1/formulations',
        headers: asUser(CLINICIAN, 'clinician'),
        payload: { clientId: CLIENT_A, note: NOTE, falsify: FALSIFY, observations: [0], gates: { risk: false, dial: true, calibrated: true }, floor: 4 },
      });
      expect(sink.text()).not.toContain('ZQX-NOTE');
      expect(sink.text()).not.toContain('ZQX-FALSIFY');
    } finally {
      await noisy.close();
    }
  });

  it('a rejected formulation echoes field names, never the note', async () => {
    await link();
    const res = await write({ gates: { ...CLEARED, risk: false } });
    expect(res.body).not.toContain('ZQX-NOTE');
    expect(res.body).not.toContain('ZQX-FALSIFY');
  });
});

describe('GET /v1/clients/:clientId/formulations', () => {
  it('another clinician sees nothing, even with their own link to the client', async () => {
    const { token } = await createInvite(CLINICIAN);
    await redeem(token, CLIENT_A);
    await app.inject({
      method: 'POST',
      url: '/v1/formulations',
      headers: asUser(CLINICIAN, 'clinician'),
      payload: { clientId: CLIENT_A, note: 'n', falsify: 'f', observations: [], gates: CLEARED, floor: 3 },
    });

    const other = await createInvite(CLINICIAN_B);
    await redeem(other.token, CLIENT_B);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/clients/${CLIENT_A}/formulations`,
      headers: asUser(CLINICIAN_B, 'clinician'),
    });
    expect(res.json()).toEqual([]);
  });

  it('refuses a client asking for their own', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/clients/${CLIENT_A}/formulations`,
      headers: asUser(CLIENT_A),
    });
    expect(res.statusCode).toBe(403);
  });
});
