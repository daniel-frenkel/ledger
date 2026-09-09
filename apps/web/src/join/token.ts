/**
 * The invite token, held in memory and nowhere else.
 *
 * It arrives in the URL fragment — `/join#<token>` — which the browser never
 * sends to a server, so it stays out of access logs, referrer headers and
 * proxies. Keeping that true on this side means three things:
 *
 *   it is never written to localStorage, sessionStorage or IndexedDB, because
 *   a bearer credential that outlives the tab is a credential left lying about;
 *
 *   it is taken out of the address bar as soon as it is read, so it is not
 *   sitting in the URL while the client reads the page, and does not go into
 *   history;
 *
 *   it survives the sign-in round trip in this module, because /join renders
 *   for a signed-out visitor rather than redirecting — a redirect would drop
 *   the fragment and the invite with it.
 */

let held: string | null = null;

/**
 * Read the token out of the fragment and clear it from the address bar.
 * Safe to call more than once: after the first call the fragment is gone and
 * the held value answers.
 */
export function captureToken(): string | null {
  const raw = window.location.hash.replace(/^#/, '').trim();
  if (raw !== '') {
    held = decodeURIComponent(raw);
    // replaceState so the token is not left in history for the back button.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return held;
}

export const heldToken = (): string | null => held;

/** Forget it — on success, on failure, and on leaving the page. */
export function clearToken(): void {
  held = null;
}
