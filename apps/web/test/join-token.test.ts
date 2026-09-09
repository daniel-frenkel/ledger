/**
 * The invite token's handling on the client.
 *
 * The token is a bearer credential. It arrives in a URL fragment specifically
 * so it never reaches a server log, and the job on this side is not to undo
 * that: memory only, out of the address bar as soon as it is read, and out of
 * history too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureToken, clearToken, heldToken } from '../src/join/token';

const TOKEN = 'ZQX0token0value0000000000000000000000000000';

/** A window stub with just the surface token.ts touches. */
function stubWindow(hash: string) {
  const replaceState = vi.fn((_s: unknown, _t: string, url: string) => {
    const [pathname, search = ''] = url.split('?');
    Object.assign(win.location, { pathname, search: search ? `?${search}` : '', hash: '' });
  });
  const win = {
    location: { hash, pathname: '/join', search: '' },
    history: { replaceState },
  };
  vi.stubGlobal('window', win);
  return { win, replaceState };
}

beforeEach(() => clearToken());
afterEach(() => {
  clearToken();
  vi.unstubAllGlobals();
});

describe('captureToken', () => {
  it('reads the token out of the fragment', () => {
    stubWindow(`#${TOKEN}`);
    expect(captureToken()).toBe(TOKEN);
    expect(heldToken()).toBe(TOKEN);
  });

  it('clears the fragment from the address bar, and from history', () => {
    const { win, replaceState } = stubWindow(`#${TOKEN}`);
    captureToken();
    // replaceState, not pushState: the back button must not reach it either.
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0]![2]).toBe('/join');
    expect(win.location.hash).toBe('');
  });

  it('keeps answering after the fragment is gone', () => {
    stubWindow(`#${TOKEN}`);
    expect(captureToken()).toBe(TOKEN);
    // A re-render calls it again; the fragment has already been cleared.
    expect(captureToken()).toBe(TOKEN);
    expect(heldToken()).toBe(TOKEN);
  });

  it('decodes a percent-encoded fragment', () => {
    stubWindow('#a%2Bb%2Fc');
    expect(captureToken()).toBe('a+b/c');
  });

  it('returns null when there is no fragment', () => {
    stubWindow('');
    expect(captureToken()).toBeNull();
    expect(heldToken()).toBeNull();
  });

  it('treats a bare # as no token', () => {
    stubWindow('#');
    expect(captureToken()).toBeNull();
  });

  it('preserves a query string when it rewrites the URL', () => {
    const { replaceState } = stubWindow(`#${TOKEN}`);
    (window as unknown as { location: { search: string } }).location.search = '?src=email';
    captureToken();
    expect(replaceState.mock.calls[0]![2]).toBe('/join?src=email');
  });
});

describe('the token is never persisted', () => {
  it('writes to no browser storage', () => {
    stubWindow(`#${TOKEN}`);
    const local: Record<string, string> = {};
    const session: Record<string, string> = {};
    vi.stubGlobal('localStorage', { setItem: (k: string, v: string) => void (local[k] = v) });
    vi.stubGlobal('sessionStorage', { setItem: (k: string, v: string) => void (session[k] = v) });

    captureToken();

    expect(Object.keys(local)).toEqual([]);
    expect(Object.keys(session)).toEqual([]);
  });

  it('is forgotten on clear', () => {
    stubWindow(`#${TOKEN}`);
    captureToken();
    clearToken();
    expect(heldToken()).toBeNull();
  });
});
