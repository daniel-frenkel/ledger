/**
 * DELETE /v1/me — delete this account.
 *
 * Two halves, in one order that matters. The rows here are soft-deleted and
 * every link revoked; then the identity is deleted at the auth provider. The
 * order is rows-then-identity because the reverse loses the ability to finish:
 * with the auth user gone first, a failure partway through leaves rows nobody
 * can sign in to reach and no request that can retry the rest.
 *
 * The route refuses to start at all when the provider is not configured. Half
 * a deletion is worse than none — the ledger gone from the user's view and the
 * account still able to sign in — so the check is before the first write, not
 * between the halves.
 *
 * Soft, not hard. `deleted_at` is what every policy and every query in this
 * codebase already treats as gone, so the account is immediately unreachable;
 * migration 0007's purge job removes the rows for real after the grace period.
 * That window is not a hedge, it is the recovery time for a mistaken deletion
 * and the window a restore from backup would need — docs/data-path.md says so
 * in the client's own words.
 *
 * Nothing here logs anything a user typed. The route logs a count of tables
 * touched and no identifier: the user id is itself PHI-adjacent under the
 * logging rules.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { AuthAdminError, authAdmin, authAdminConfigured } from '../auth-admin.js';
import { baaVersion } from '../baa.js';
import { schema, withUser } from '../db/client.js';

const perUser = (max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip },
});

/** Stable, and the same whether the key is missing or the provider is unknown. */
export const DELETION_UNAVAILABLE_CODE = 'DELETION_UNAVAILABLE';
export const DELETION_UNAVAILABLE =
  'Account deletion is not available on this deployment. Nothing has been changed.';

/**
 * A clinician does not delete their account here.
 *
 * Their formulations and assistant runs are a record they are keeping about
 * their own clinical reasoning, referenced by clients who did not write them
 * and cannot consent to their removal. Winding down a practice is a
 * conversation about retention, supervision and where the charts go — not a
 * button. 0007 already refuses to hard-delete any user row; this refuses to
 * start the soft delete for the one case where it would be wrong.
 */
export const CLINICIAN_DELETION_CODE = 'CLINICIAN_DELETION_UNSUPPORTED';
export const CLINICIAN_DELETION =
  'Clinician accounts are not deleted from here. Your formulations are part of a client record. Get in touch and we will work out what happens to them.';

/**
 * Every table holding rows the user owns that carries `deleted_at`.
 *
 * `crisis_events`, `prediction_priors` and `clinician_client_links` are absent
 * on purpose: they have no soft-delete column and cascade from `users` when
 * the purge job removes it. `devices` is absent for the opposite reason — it
 * is deleted outright below, because a push token that outlives the account is
 * a notification sent to someone who left.
 */
const OWNED = [
  schema.predictions,
  schema.priors,
  schema.bodyStates,
  schema.reinterpretations,
  schema.journalEntries,
] as const;

const me: FastifyPluginAsync = async (app) => {
  /**
   * Accept the business associate agreement — go-live gate A1.
   *
   * The user writes their own row and nothing else can: 0008 grants UPDATE on
   * exactly these two columns, and 0001's users_self_update scopes it to
   * `id = app_user_id()`. There is no route that accepts on someone's behalf.
   */
  app.post('/v1/me/baa', { config: perUser(10, '1 hour') }, async (request, reply) => {
    const body = z.object({ version: z.string().min(1).max(64) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'invalid payload', fields: ['version'] });
    let current: string;
    try {
      current = baaVersion();
    } catch {
      // The document is the source; without it there is no version to record
      // consent to. Type only — the reason names a path, not a secret.
      return reply.status(503).send({ error: 'the business associate agreement is unavailable' });
    }
    if (body.data.version !== current) {
      // Accepting a version this build does not serve would record consent to
      // a document nobody can produce.
      return reply.status(409).send({ error: 'that is not the current agreement', current });
    }
    if (request.user.role !== 'clinician') {
      return reply.status(403).send({ error: 'the business associate agreement is between us and a clinician' });
    }

    await withUser(request.user, (tx) =>
      tx
        .update(schema.users)
        .set({ baaAcceptedVersion: current, baaAcceptedAt: new Date() })
        .where(eq(schema.users.id, request.user.id)),
    );
    return reply.status(200).send({ version: body.data.version });
  });

  /** What this build is asking for, and whether this user has accepted it. */
  app.get('/v1/me', async (request, reply) => {
    let current: string | null = null;
    try {
      current = baaVersion();
    } catch {
      // Reported as null rather than as an error: the rest of this answer is
      // still true, and the setup screen can say the document is missing.
      current = null;
    }
    return reply.send({
      id: request.user.id,
      role: request.user.role,
      mfa: request.user.aal === 'aal2',
      baa: { current, accepted: request.user.baaAcceptedVersion },
    });
  });

  app.delete('/v1/me', { config: perUser(5, '1 hour') }, async (request, reply) => {
    // Before anything is written. A deletion that cannot finish must not start.
    if (!authAdminConfigured()) {
      return reply.status(503).send({ code: DELETION_UNAVAILABLE_CODE, error: DELETION_UNAVAILABLE });
    }

    if (request.user.role === 'clinician') {
      return reply.status(403).send({ code: CLINICIAN_DELETION_CODE, error: CLINICIAN_DELETION });
    }

    const now = new Date();
    const userId = request.user.id;

    const touched = await withUser(request.user, async (tx) => {
      let n = 0;
      for (const table of OWNED) {
        const r = await tx
          .update(table)
          .set({ deletedAt: now })
          .where(and(eq(table.userId, userId), isNull(table.deletedAt)));
        n += r.rowCount ?? 0;
      }

      // The links to them. Only a client reaches this route, so this is the
      // client's side; revoked is immediate and total, because every clinician
      // policy joins through status = 'active'. The `or` stays because the
      // shape of the record is two-sided even when the door is not.
      await tx
        .update(schema.clinicianClientLinks)
        .set({ status: 'revoked' })
        .where(
          and(
            or(
              eq(schema.clinicianClientLinks.clientId, userId),
              eq(schema.clinicianClientLinks.clinicianId, userId),
            ),
            eq(schema.clinicianClientLinks.status, 'active'),
          ),
        );

      // Push tokens go now, not in thirty days.
      await tx.delete(schema.devices).where(eq(schema.devices.userId, userId));

      // The user row last, so a failure above leaves an account that can still
      // sign in and retry rather than an orphaned ledger.
      await tx.update(schema.users).set({ deletedAt: now }).where(eq(schema.users.id, userId));
      return n;
    });

    try {
      await authAdmin().deleteUser(userId);
    } catch (err) {
      // The rows are already soft-deleted and the account is already
      // unreachable through this API. What is left is an identity that can
      // still obtain a token, so this is a real failure and says so — but it
      // is reported without undoing the first half, because the retry is the
      // same request and it is idempotent.
      request.log.error({
        event: 'account.delete.identity_failed',
        reason: err instanceof AuthAdminError ? err.reason : (err as Error).name,
      });
      return reply.status(502).send({ error: 'Your data is deleted. Signing out failed — please try again.' });
    }

    // A count and nothing else. No user id: the logging rules treat it as
    // identifying, and this line would be the one place it appeared.
    request.log.info({ event: 'account.deleted', rows: touched, tables: OWNED.length });
    return reply.status(204).send();
  });
};

export default me;
