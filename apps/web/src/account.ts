/**
 * Deleting the account, from the client's side.
 *
 * One call. The server soft-deletes every row, revokes every link, drops the
 * push tokens and deletes the identity; the caller then signs out, which wipes
 * IndexedDB — `signOut` in auth/session.tsx already does that, because the
 * local store holds plaintext entries and has always left with the account.
 *
 * The word the user has to type is here rather than in the screen so the
 * screen and the check cannot drift apart, and so the test can assert on it.
 */
import { API_URL, accessToken } from '@/auth/supabase';

/** Typed exactly, case-sensitively, before the button does anything. */
export const DELETE_CONFIRMATION = 'delete';

export const confirms = (typed: string): boolean => typed.trim().toLowerCase() === DELETE_CONFIRMATION;

export class DeleteAccountError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DeleteAccountError';
  }
}

/**
 * Ask the server to delete this account.
 *
 * Resolves only when the whole thing succeeded. A 503 means the deployment
 * cannot honour deletion and nothing was changed; a 502 means the data is gone
 * but the identity is not, and the user should try again — that retry is this
 * same call, which is idempotent.
 */
export async function deleteAccount(): Promise<void> {
  const token = await accessToken();
  if (!token) throw new DeleteAccountError(401, 'You are not signed in.');

  const res = await fetch(`${API_URL}/v1/me`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 204) return;

  let message = 'Something went wrong. Nothing has been deleted — please try again.';
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // A body that is not JSON tells the user nothing worth showing.
  }
  throw new DeleteAccountError(res.status, message);
}
