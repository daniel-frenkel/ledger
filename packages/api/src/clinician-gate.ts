/**
 * What a clinician must have before they touch a client's record.
 *
 * Two conditions, from `docs/go-live-gate.md`:
 *
 *   B2 — a second factor. Email OTP is one, and one is not enough for an
 *        account that can read other people's clinical records.
 *   A1 — an accepted BAA. The vendor is a business associate of every
 *        clinician who uses this with a client, and the agreement has to exist
 *        before the first invite rather than after the first incident.
 *
 * Both are checked in one place so a route added later cannot forget one, and
 * both return a message a clinician can act on rather than a bare 403 — the
 * failure here is almost always "you have not done the thing yet", not "you
 * are not allowed".
 *
 * Clients are untouched by all of it.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

export const MFA_REQUIRED_CODE = 'MFA_REQUIRED';
export const MFA_REQUIRED =
  'Set up a second factor before working with client data. Settings → Two-factor authentication.';

export const BAA_REQUIRED_CODE = 'BAA_REQUIRED';
export const BAA_REQUIRED =
  'Accept the business associate agreement before working with client data. It is on your first-sign-in screen.';

export const CLINICIANS_ONLY = 'clinicians only';

/**
 * Guard a route that reads or writes a client's record as a clinician.
 *
 * Returns true when the request may proceed. When it returns false it has
 * already sent the reply, so the caller returns immediately.
 *
 * Order matters a little: MFA first, because a clinician without a second
 * factor should not be shown a contract to accept — get the account secure,
 * then get the paperwork.
 */
export function clinicianReady(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.user.role !== 'clinician') {
    void reply.status(403).send({ error: CLINICIANS_ONLY });
    return false;
  }
  if (request.user.aal !== 'aal2') {
    void reply.status(403).send({ code: MFA_REQUIRED_CODE, error: MFA_REQUIRED });
    return false;
  }
  if (!request.user.baaAcceptedVersion) {
    void reply.status(403).send({ code: BAA_REQUIRED_CODE, error: BAA_REQUIRED });
    return false;
  }
  return true;
}
