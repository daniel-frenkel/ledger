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
import { AuthAdminError, authAdmin, authAdminConfigured } from '../auth-admin.js';
import { schema, withUser } from '../db/client.js';

const perUser = (max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip },
});

/** Stable, and the same whether the key is missing or the provider is unknown. */
export const DELETION_UNAVAILABLE_CODE = 'DELETION_UNAVAILABLE';
export const DELETION_UNAVAILABLE =
  'Account deletion is not available on this deployment. Nothing has been changed.';

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
  app.delete('/v1/me', { config: perUser(5, '1 hour') }, async (request, reply) => {
    // Before anything is written. A deletion that cannot finish must not start.
    if (!authAdminConfigured()) {
      return reply.status(503).send({ code: DELETION_UNAVAILABLE_CODE, error: DELETION_UNAVAILABLE });
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

      // Links, both directions. A clinician deleting their account revokes the
      // links they hold; a client deleting theirs revokes the links to them.
      // Revoked is immediate and total — every clinician policy joins through
      // status = 'active'.
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
