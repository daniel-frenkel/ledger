/**
 * The URL a client opens to accept an invitation.
 *
 * The token goes in the fragment. Browsers do not send a fragment to a server,
 * so it stays out of access logs, referrer headers and proxies on the way —
 * which is the whole reason the invite is shaped this way, and the reason the
 * link has to be sent whole rather than rebuilt from its parts.
 *
 * Its own module, with no imports, deliberately: it lived in lib/api.tsx, and
 * anything that wanted this pure string function got a Supabase client
 * constructed at import time along with it. That is a bad trade in the browser
 * and fatal under Node 20, which has no global WebSocket for realtime-js to
 * find.
 */
export const inviteUrl = (webUrl: string, token: string): string =>
  `${webUrl.replace(/\/+$/, '')}/join#${token}`;
