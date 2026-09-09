/**
 * The guard on truncateAll(). Both database-backed suites wipe every table, and
 * docs/NEXT-STEPS.md tells the developer to point them at Supabase once, during
 * setup — so the refusal, and the shape of the override, are load-bearing.
 *
 * This file needs no database on purpose: it has to keep running in exactly the
 * situation the guard exists for.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { assertDisposableDatabase, databaseHost } from './helpers.js';

const SUPABASE = 'postgresql://postgres.izv:pw@aws-0-us-east-2.pooler.supabase.com:5432/postgres';
const SUPABASE_HOST = 'aws-0-us-east-2.pooler.supabase.com';
const LOCAL = 'postgresql://postgres:password@localhost:5432/ledger';

afterEach(() => {
  delete process.env.ALLOW_DESTRUCTIVE_TESTS;
});

describe('databaseHost', () => {
  it('reads the host out of a Postgres URL', () => {
    expect(databaseHost(SUPABASE)).toBe(SUPABASE_HOST);
    expect(databaseHost(LOCAL)).toBe('localhost');
  });

  it('survives a password with reserved characters in it', () => {
    expect(databaseHost('postgresql://u:p%40ss%2Fword@localhost:5432/db')).toBe('localhost');
  });

  it('returns empty for something that is not a URL', () => {
    expect(databaseHost('not a url')).toBe('');
  });
});

describe('assertDisposableDatabase', () => {
  it('refuses a Supabase pooler URL', () => {
    expect(() => assertDisposableDatabase(SUPABASE)).toThrow(/Refusing to TRUNCATE/);
  });

  it('names the offending host, and the exact override that would permit it', () => {
    expect(() => assertDisposableDatabase(SUPABASE)).toThrow(new RegExp(SUPABASE_HOST));
    expect(() => assertDisposableDatabase(SUPABASE)).toThrow(/ALLOW_DESTRUCTIVE_TESTS=aws-0-us-east-2\.pooler\.supabase\.com/);
  });

  for (const url of [
    'postgresql://postgres:password@localhost:5432/ledger',
    'postgresql://postgres:password@127.0.0.1:5432/ledger',
    'postgresql://postgres:password@[::1]:5432/ledger',
    'postgresql://postgres:password@db:5432/ledger',
    'postgresql://postgres:password@host.docker.internal:5432/ledger',
    'postgres://postgres:password@localhost:5432/x?sslmode=verify-full',
  ]) {
    it(`accepts ${databaseHost(url)} without any override`, () => {
      expect(() => assertDisposableDatabase(url)).not.toThrow();
    });
  }

  it('accepts a remote host when the override names that exact host', () => {
    process.env.ALLOW_DESTRUCTIVE_TESTS = SUPABASE_HOST;
    expect(() => assertDisposableDatabase(SUPABASE)).not.toThrow();
  });

  it('rejects a bare "1" — the override has to name the database it grants', () => {
    process.env.ALLOW_DESTRUCTIVE_TESTS = '1';
    expect(() => assertDisposableDatabase(SUPABASE)).toThrow(/Refusing to TRUNCATE/);
  });

  it('does not let permission for one database authorise another', () => {
    // The value that legitimately unlocked the staging pooler must not follow a
    // changed .env to a different project.
    process.env.ALLOW_DESTRUCTIVE_TESTS = 'aws-0-eu-west-1.pooler.supabase.com';
    expect(() => assertDisposableDatabase(SUPABASE)).toThrow(/Refusing to TRUNCATE/);
  });

  it('refuses an unparseable connection string rather than assuming it is safe', () => {
    expect(() => assertDisposableDatabase('not a url')).toThrow(/Refusing to TRUNCATE/);
  });

  it('an empty override never satisfies an unparseable URL', () => {
    process.env.ALLOW_DESTRUCTIVE_TESTS = '';
    expect(() => assertDisposableDatabase('not a url')).toThrow(/Refusing to TRUNCATE/);
  });
});
