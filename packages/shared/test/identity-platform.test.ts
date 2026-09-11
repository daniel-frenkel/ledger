/**
 * The Identity Platform wire protocol.
 *
 * `shared` is otherwise a package of pure functions, and this module is the one
 * exception — it is here because both clients have to agree exactly on how a
 * token is obtained and refreshed, and two copies that drift would be a
 * security bug rather than a style one. It keeps the package's promise in the
 * way that matters for a test suite: `fetch` is injected, so none of this opens
 * a socket.
 *
 * What is worth asserting is the handling, not the happy path: that a
 * second-factor answer is recognised as a challenge rather than mistaken for a
 * session, that expiry is computed with a margin, and that an error is reduced
 * to a code and never carries the body — which for these endpoints echoes the
 * request, and the request contains an email address.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  IdentityPlatformError,
  completeSignIn,
  isExpired,
  refresh,
  sendSignInLink,
  type IdentityPlatformConfig,
} from '../src/auth/identity-platform.js';

/** A fetch that answers once with `body`, and records what it was asked. */
function stub(body: unknown, ok = true, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status: ok ? status : status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fn: fn as unknown as typeof globalThis.fetch, calls };
}

const cfg = (f: typeof globalThis.fetch): IdentityPlatformConfig => ({
  apiKey: 'test-key',
  continueUrl: 'https://app.courageloop.com/auth/callback',
  fetch: f,
});

describe('sending the link', () => {
  it('asks for an email sign-in and carries the continue url', async () => {
    const s = stub({});
    await sendSignInLink(cfg(s.fn), 'someone@example.test');
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toContain('accounts:sendOobCode');
    expect(s.calls[0]!.url).toContain('key=test-key');
    const sent = JSON.parse(String(s.calls[0]!.init.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({
      requestType: 'EMAIL_SIGNIN',
      email: 'someone@example.test',
      canHandleCodeInApp: true,
      continueUrl: 'https://app.courageloop.com/auth/callback',
    });
  });
});

describe('completing a sign-in', () => {
  it('returns a session', async () => {
    const s = stub({ idToken: 'id', refreshToken: 'r', expiresIn: '3600', localId: 'uid-1' });
    const result = await completeSignIn(cfg(s.fn), 'someone@example.test', 'code-1');
    expect(result.kind).toBe('session');
    if (result.kind !== 'session') throw new Error('unreachable');
    expect(result.tokens.userId).toBe('uid-1');
    // A minute of margin, so a request begun just before expiry does not land
    // just after it.
    expect(result.tokens.expiresAt).toBeGreaterThan(Date.now() + 3500 * 1000);
    expect(result.tokens.expiresAt).toBeLessThanOrEqual(Date.now() + 3540 * 1000);
  });

  /**
   * The case that must not be mistaken for a session. Identity Platform
   * answers the first factor with a pending credential and no token; reading
   * that as a successful sign-in would be letting one factor through a door
   * that gate B2 says needs two.
   */
  it('returns a challenge, not a session, when a second factor is enrolled', async () => {
    const s = stub({
      mfaPendingCredential: 'pending-xyz',
      mfaInfo: [{ mfaEnrollmentId: 'enr-1', displayName: 'Authenticator app' }],
    });
    const result = await completeSignIn(cfg(s.fn), 'someone@example.test', 'code-1');
    expect(result.kind).toBe('mfa');
    if (result.kind !== 'mfa') throw new Error('unreachable');
    expect(result.challenge.pendingCredential).toBe('pending-xyz');
    expect(result.challenge.factors).toEqual([{ enrollmentId: 'enr-1', displayName: 'Authenticator app' }]);
  });

  it('refuses a response with no token and no challenge', async () => {
    const s = stub({ localId: 'uid-1' });
    await expect(completeSignIn(cfg(s.fn), 'a@b.test', 'c')).rejects.toThrow(/incomplete_token_response/);
  });
});

describe('errors', () => {
  it('carries the provider code and never the body', async () => {
    const s = stub({ error: { message: 'INVALID_OOB_CODE : someone@example.test asked' } }, false, 400);
    try {
      await completeSignIn(cfg(s.fn), 'someone@example.test', 'stale');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(IdentityPlatformError);
      const err = e as IdentityPlatformError;
      expect(err.code).toBe('INVALID_OOB_CODE');
      expect(err.status).toBe(400);
      // The address was in the body the provider sent back. It must not be in
      // anything we raise, because a raised message is a message that gets logged.
      expect(err.message).not.toContain('someone@example.test');
    }
  });

  it('reports an unreachable provider without inventing a status', async () => {
    const fn = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof globalThis.fetch;
    await expect(sendSignInLink(cfg(fn), 'a@b.test')).rejects.toThrow(/unreachable \(TypeError\)/);
  });
});

describe('refresh', () => {
  it('posts form-encoded and accepts a rotated refresh token', async () => {
    const s = stub({ id_token: 'id2', refresh_token: 'r2', expires_in: '3600', user_id: 'uid-1' });
    const t = await refresh(cfg(s.fn), 'r1');
    expect(s.calls[0]!.url).toContain('securetoken.googleapis.com');
    expect(String(s.calls[0]!.init.body)).toBe('grant_type=refresh_token&refresh_token=r1');
    expect(t.refreshToken).toBe('r2');
    expect(t.idToken).toBe('id2');
  });
});

describe('expiry', () => {
  it('is a comparison against the stored instant', () => {
    const t = { idToken: 'i', refreshToken: 'r', userId: 'u', expiresAt: 1_000 };
    expect(isExpired(t, 999)).toBe(false);
    expect(isExpired(t, 1_000)).toBe(true);
    expect(isExpired(t, 1_001)).toBe(true);
  });
});
