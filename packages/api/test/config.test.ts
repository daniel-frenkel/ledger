/**
 * `.env.example` ships empty placeholders and NEXT-STEPS step 5 says to copy
 * it, so an empty value has to mean "not set". Before this, `SUPABASE_JWT_SECRET=`
 * with nothing after it was validated as "" against .min(16) and the server
 * refused to boot with a filled-in, otherwise valid .env.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

/** A minimal valid environment: everything required, nothing optional. */
const base = {
  DATABASE_URL: 'postgresql://ledger_api:pw@localhost:5432/ledger',
  FIELD_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  SUPABASE_JWKS_URL: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('accepts the minimal environment', () => {
    expect(loadConfig({ ...base }).DATABASE_URL).toBe(base.DATABASE_URL);
  });

  // One case per optional variable that would fail its own validator on "".
  for (const key of ['SUPABASE_JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_JWKS_URL', 'DATABASE_MIGRATE_URL', 'SENTRY_DSN'] as const) {
    it(`treats an empty ${key} as unset`, () => {
      const env = { ...base, [key]: '' };
      // SUPABASE_JWKS_URL is the only auth method here; blanking it needs a stand-in.
      if (key === 'SUPABASE_JWKS_URL') env.SUPABASE_JWT_SECRET = 'a-secret-of-sufficient-length';
      const c = loadConfig(env);
      expect(c[key]).toBeUndefined();
    });
  }

  it('still rejects a value that is present and wrong', () => {
    expect(() => loadConfig({ ...base, SUPABASE_URL: 'not-a-url' })).toThrow(/SUPABASE_URL/);
  });

  it('still rejects a missing required value', () => {
    const { FIELD_ENCRYPTION_KEY: _drop, ...without } = base;
    expect(() => loadConfig(without)).toThrow(/FIELD_ENCRYPTION_KEY/);
  });

  /**
   * The shape that broke production.
   *
   * `DATABASE_URL` was `z.string().url()`, which is `new URL()`, and the Cloud
   * SQL Unix-socket form has an empty authority — the host is in `?host=`,
   * after the path. `new URL()` throws on it, so `config()` threw before
   * `listen()`, the container never bound, and Cloud Run reported a port
   * timeout that named nothing useful.
   *
   * Nothing caught it because every test used a local TCP URL, which IS a
   * valid WHATWG URL. The socket form existed only in production. So the case
   * that broke it is now the case that is covered.
   */
  describe('the Cloud SQL socket connection string', () => {
    const SOCKET =
      'postgresql://ledger_api:pw@/ledger?host=/cloudsql/courageloop-prod:us-west1:courageloop-db';

    it('is rejected by z.string().url(), which is why .url() was the wrong check', () => {
      // Not testing our code — pinning the fact the fix rests on.
      expect(() => new URL(SOCKET)).toThrow();
    });

    it('is accepted for DATABASE_URL', () => {
      expect(loadConfig({ ...base, DATABASE_URL: SOCKET }).DATABASE_URL).toBe(SOCKET);
    });

    it('is accepted for DATABASE_MIGRATE_URL', () => {
      const c = loadConfig({ ...base, DATABASE_MIGRATE_URL: SOCKET });
      expect(c.DATABASE_MIGRATE_URL).toBe(SOCKET);
    });

    it('still accepts the ordinary TCP form', () => {
      const tcp = 'postgresql://user:pass@localhost:5432/ledger';
      expect(loadConfig({ ...base, DATABASE_URL: tcp }).DATABASE_URL).toBe(tcp);
      expect(loadConfig({ ...base, DATABASE_URL: tcp.replace('postgresql', 'postgres') })).toBeTruthy();
    });
  });

  /**
   * The parser is permissive on its own — it reads "not a url" as a database
   * name — so the scheme check and the host/database requirements are what
   * make this a validator rather than a formality.
   */
  describe('what a connection string still has to be', () => {
    for (const [why, value] of [
      ['not a connection string at all', 'not a url'],
      ['the wrong scheme', 'https://example.com/ledger'],
      ['empty', ''],
      ['a scheme and nothing else', 'postgresql://'],
      ['no database', 'postgresql://user:pw@localhost:5432'],
    ] as const) {
      it(`refuses ${why}`, () => {
        expect(() => loadConfig({ ...base, DATABASE_URL: value })).toThrow(/DATABASE_URL/);
      });
    }

    it('never puts the connection string in the error message', () => {
      // It carries a password.
      const secret = 'postgresql://user:hunter2-do-not-log@/ledger';
      try {
        loadConfig({ ...base, DATABASE_URL: secret });
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).not.toContain('hunter2-do-not-log');
      }
    });
  });

  it('never puts a value in the error message', () => {
    try {
      loadConfig({ ...base, SUPABASE_URL: 'super-secret-not-a-url' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain('super-secret-not-a-url');
    }
  });
});
