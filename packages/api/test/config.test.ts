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

  it('never puts a value in the error message', () => {
    try {
      loadConfig({ ...base, SUPABASE_URL: 'super-secret-not-a-url' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain('super-secret-not-a-url');
    }
  });
});
