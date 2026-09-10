/**
 * Research consent, from the client's side — proposal 03 §4.
 *
 * Off unless turned on, and separate from clinician sharing in every way. The
 * clinician is not told either way and cannot see this screen or its answer.
 *
 * Withdrawal is immediate and stops any future export including this person.
 * Exports already made cannot be recalled, because there is no way to find
 * anyone in them — the same protection working in the other direction, which
 * the consent text says in those words.
 */
import { API_URL, accessToken } from '@/auth/supabase';

export interface ResearchState {
  /** The consent text version this build shows. */
  current: string | null;
  consented: boolean;
  /** Which version they agreed to, if any. */
  version: string | null;
}

async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  if (!token) throw new Error('not signed in');
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    cache: 'no-store',
  });
}

export async function researchState(): Promise<ResearchState | null> {
  try {
    const res = await authed('/v1/me');
    if (!res.ok) return null;
    const body = (await res.json()) as { research?: ResearchState };
    return body.research ?? null;
  } catch {
    return null;
  }
}

/** Turn it on or off. Resolves only when the server recorded it. */
export async function setResearchConsent(consented: boolean, version?: string): Promise<void> {
  const res = await authed('/v1/me/research-consent', {
    method: 'PUT',
    body: JSON.stringify({ consented, ...(version ? { version } : {}) }),
  });
  if (!res.ok) throw new Error(`consent ${res.status}`);
}
