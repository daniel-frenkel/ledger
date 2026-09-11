/**
 * Verifying an Identity Platform token, against a fixture key.
 *
 * The case that matters here is the third one. Google signs the Identity
 * Platform tokens of **every project on earth** with one shared key set, so a
 * signature check alone proves only that Google minted the token — not that it
 * was minted for this deployment. Anyone with a free Google Cloud project
 * could otherwise hand us a perfectly valid token and be signed in as whoever
 * they liked.
 *
 * What binds a token to us is the audience (our project id) and the issuer
 * (`https://securetoken.google.com/<project>`). Those come from
 * `tokenVerification()`, and this asserts they are actually enforced rather
 * than merely configured.
 *
 * No network: the fixture key set is installed through the seam in `jwt.ts`,
 * because `jose` fetches a remote JWKS through Node's http stack rather than
 * `globalThis.fetch`, and a stubbed global would not intercept it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { loadConfig, tokenVerification, IDENTITY_PLATFORM_JWKS } from '../src/config.js';
import { setKeySet, verifyJwt } from '../src/auth/jwt.js';

const PROJECT = 'courageloop-prod';

const base = {
  DATABASE_URL: 'postgresql://ledger_api:pw@localhost:5432/ledger',
  FIELD_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
} as NodeJS.ProcessEnv;

const identityPlatform = loadConfig({
  ...base,
  AUTH_PROVIDER: 'identity-platform',
  GCP_PROJECT_ID: PROJECT,
});

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let privateKey: KeyPair['privateKey'];
let publicJwk: JWK;

/** A token as Identity Platform would mint it, with whatever we want changed. */
async function mint(over: { iss?: string; aud?: string; sub?: string; claims?: Record<string, unknown> } = {}) {
  return new SignJWT({ ...(over.claims ?? {}) })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
    .setIssuer(over.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(over.aud ?? PROJECT)
    .setSubject(over.sub ?? 'user-abc')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'fixture', alg: 'RS256', use: 'sig' };

  // Serve exactly the key Google would have served, at the URL the config
  // resolves to, and nothing else.
  setKeySet(IDENTITY_PLATFORM_JWKS, createLocalJWKSet({ keys: [publicJwk] }));
});

afterAll(() => {
  setKeySet(IDENTITY_PLATFORM_JWKS, undefined);
});

describe('the configuration', () => {
  it('derives the issuer and audience from the project id', () => {
    expect(tokenVerification(identityPlatform)).toEqual({
      jwksUrl: IDENTITY_PLATFORM_JWKS,
      issuer: `https://securetoken.google.com/${PROJECT}`,
      audience: PROJECT,
    });
  });

  it('refuses to start on identity-platform with no project id', () => {
    expect(() => loadConfig({ ...base, AUTH_PROVIDER: 'identity-platform' })).toThrow(/GCP_PROJECT_ID/);
  });

  // The old name keeps working for one release, and the new one wins.
  it('reads SUPABASE_JWKS_URL as a fallback for AUTH_JWKS_URL', () => {
    const old = loadConfig({ ...base, SUPABASE_JWKS_URL: 'https://example.test/a' });
    expect(tokenVerification(old).jwksUrl).toBe('https://example.test/a');
    const both = loadConfig({
      ...base,
      SUPABASE_JWKS_URL: 'https://example.test/a',
      AUTH_JWKS_URL: 'https://example.test/b',
    });
    expect(tokenVerification(both).jwksUrl).toBe('https://example.test/b');
  });
});

describe('verifying a token', () => {
  it('accepts one minted for this project', async () => {
    const v = await verifyJwt(await mint(), identityPlatform);
    expect(v.userId).toBe('user-abc');
    expect(v.role).toBe('client');
  });

  it('reads a clinician role from a custom claim', async () => {
    const v = await verifyJwt(await mint({ claims: { role: 'clinician' } }), identityPlatform);
    expect(v.role).toBe('clinician');
  });

  /**
   * The whole reason the audience check exists. This token is signed by the
   * same key as a real one and is valid in every other respect.
   */
  it('rejects a validly signed token minted for another project', async () => {
    const other = await mint({ iss: 'https://securetoken.google.com/someone-else', aud: 'someone-else' });
    await expect(verifyJwt(other, identityPlatform)).rejects.toThrow();
  });

  it('rejects one whose audience is right but whose issuer is not', async () => {
    const spoofed = await mint({ iss: 'https://securetoken.google.com/someone-else' });
    await expect(verifyJwt(spoofed, identityPlatform)).rejects.toThrow();
  });

  it('rejects one with no subject', async () => {
    const anonymous = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer(`https://securetoken.google.com/${PROJECT}`)
      .setAudience(PROJECT)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    await expect(verifyJwt(anonymous, identityPlatform)).rejects.toThrow(/subject/);
  });
});
