/**
 * The typed confirmation, and what the delete call does with a response.
 *
 * The network call is stubbed. What is worth pinning is the behaviour around
 * it: the word has to be typed, a 503 has to read as "nothing was changed",
 * and a failure must never be reported as success — the one mistake here that
 * would leave someone believing their record is gone when it is not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DELETE_CONFIRMATION, DeleteAccountError, confirms, deleteAccount } from '@/account';

vi.mock('@/auth/client', () => ({
  API_URL: 'https://api.test',
  accessToken: async () => 'a-token',
}));

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body?: unknown) => {
  const fetchMock = vi.fn(async () =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('the confirmation', () => {
  it('accepts the word, trimmed and in any case', () => {
    expect(confirms(DELETE_CONFIRMATION)).toBe(true);
    expect(confirms('  DELETE  ')).toBe(true);
    expect(confirms('Delete')).toBe(true);
  });

  it('accepts nothing else — not empty, not nearly', () => {
    for (const s of ['', ' ', 'delet', 'delete my account', 'yes', 'ok']) {
      expect(confirms(s), JSON.stringify(s)).toBe(false);
    }
  });
});

describe('deleteAccount', () => {
  it('resolves only on 204', async () => {
    respond(204);
    await expect(deleteAccount()).resolves.toBeUndefined();
  });

  it('sends a DELETE to /v1/me with the token and no body', async () => {
    const f = respond(204);
    await deleteAccount();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/me');
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer a-token');
    expect(init.body).toBeUndefined();
  });

  it('rejects on a 503 and carries the server’s "nothing changed" message', async () => {
    respond(503, { code: 'DELETION_UNAVAILABLE', error: 'Account deletion is not available on this deployment. Nothing has been changed.' });
    const err = (await deleteAccount().catch((e: unknown) => e)) as DeleteAccountError;
    expect(err).toBeInstanceOf(DeleteAccountError);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/Nothing has been changed/);
  });

  it('rejects on a 502 — the half-done case the user has to be told about', async () => {
    respond(502, { error: 'Your data is deleted. Signing out failed — please try again.' });
    await expect(deleteAccount()).rejects.toBeInstanceOf(DeleteAccountError);
  });

  it('rejects rather than resolving when the body is not JSON', async () => {
    // The failure mode that matters: never report a failed deletion as done.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502</html>', { status: 502 })));
    await expect(deleteAccount()).rejects.toBeInstanceOf(DeleteAccountError);
  });

  it('rejects without calling the server when there is no session', async () => {
    const f = respond(204);
    const mod = await import('@/auth/client');
    vi.spyOn(mod, 'accessToken').mockResolvedValue(null);
    await expect(deleteAccount()).rejects.toMatchObject({ status: 401 });
    expect(f).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
