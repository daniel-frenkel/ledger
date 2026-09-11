/**
 * The CORS allowlist.
 *
 * The client PWA, the clinician app and the API are three hostnames under
 * courageloop.com, so the browser asks permission before the first two may
 * talk to the third. Before this, `origin` was `false` in production and
 * `true` everywhere else: production answered with no CORS headers at all,
 * which would have refused the real client the moment the apps were split
 * across subdomains, and development reflected whatever origin asked.
 *
 * What is under test is that the list is exact in both directions — an origin
 * on it gets the header, an origin off it gets nothing — and that a wildcard
 * cannot be configured in.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { corsOrigins, loadConfig } from '../src/config.js';
import { closeDb } from '../src/db/client.js';
import { buildApp } from './helpers.js';

const base = {
  DATABASE_URL: 'postgresql://ledger_api:pw@localhost:5432/ledger',
  FIELD_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  SUPABASE_JWKS_URL: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
} as NodeJS.ProcessEnv;

const HOSTS_OF_RECORD = [
  'https://courageloop.com',
  'https://app.courageloop.com',
  'https://api.courageloop.com',
];

describe('the allowlist', () => {
  it('defaults to the three hostnames of record', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'production' });
    expect(corsOrigins(c)).toEqual(HOSTS_OF_RECORD);
  });

  it('adds the dev origins outside production, and never inside it', () => {
    const dev = corsOrigins(loadConfig({ ...base, NODE_ENV: 'development' }));
    expect(dev).toContain('http://localhost:5173');
    expect(corsOrigins(loadConfig({ ...base, NODE_ENV: 'production' }))).not.toContain('http://localhost:5173');
  });

  it('refuses a wildcard', () => {
    expect(() => loadConfig({ ...base, CORS_ORIGINS: '*' })).toThrow(/wildcard is not an allowlist/);
    expect(() => loadConfig({ ...base, CORS_ORIGINS: 'https://courageloop.com,*' })).toThrow(/wildcard/);
  });

  // A trailing slash never matches an Origin header, so it fails as a silent
  // refusal in production. Better to refuse to boot.
  it('refuses an origin with a trailing slash or a path', () => {
    expect(() => loadConfig({ ...base, CORS_ORIGINS: 'https://courageloop.com/' })).toThrow(/trailing slash/);
    expect(() => loadConfig({ ...base, CORS_ORIGINS: 'https://courageloop.com/api' })).toThrow(/trailing slash/);
  });
});

describe('what the server actually answers', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  // A preflight is answered by the plugin and never reaches a handler, so none
  // of this touches the database.
  const preflight = (origin: string) =>
    app.inject({
      method: 'OPTIONS',
      url: '/v1/sync',
      headers: { origin, 'access-control-request-method': 'POST' },
    });

  for (const origin of HOSTS_OF_RECORD) {
    it(`allows ${origin}`, async () => {
      const res = await preflight(origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    });
  }

  it('gives an origin that is not on the list no header at all', async () => {
    const res = await preflight('https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  // The near miss is the one worth having a test for: a lookalike host, and a
  // subdomain of the real one that nobody has allowed.
  it('rejects a lookalike and an unlisted subdomain', async () => {
    for (const origin of ['https://courageloop.com.evil.example', 'https://staging.courageloop.com']) {
      const res = await preflight(origin);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});
