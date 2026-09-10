/**
 * The thirty-day half of account deletion.
 *
 * `DELETE /v1/me` stamps `deleted_at`, which makes an account unreachable
 * immediately. This removes the rows for real once the grace period has
 * passed — the window that exists so a deletion made in the wrong five minutes
 * can still be undone from a backup, and after which it cannot.
 *
 * **Nothing cascades.** Every foreign key to `users` in the milestone-1 schema
 * is `ON DELETE NO ACTION`, deliberately: no single delete anywhere should be
 * able to take a ledger with it. The price is that this job has to name every
 * table and delete in dependency order, and that a table added later without
 * being added here would be missed. `test/deletion.test.ts` checks the ledger
 * is empty afterwards by counting every table, so that omission fails loudly
 * rather than leaving rows behind.
 *
 * It runs in the system context, which is still the `ledger_api` role and
 * still under RLS. Migration 0007's policies are what make the DELETE legal
 * and they are narrower than anything asked for here: a row belonging to a
 * live account, or to one inside the grace period, is unreachable by the verb
 * regardless of what this file's `where` clause says. If the interval below
 * were wrong tomorrow, the database would still refuse.
 *
 * The unit is the account. A row a client soft-deleted on its own — one
 * prediction they removed — is not purged here yet; see docs/data-path.md,
 * where the rule for those is decided and queued.
 *
 * **The users row is never deleted.** `formulations` and `assistant_runs` are
 * the clinician's record of their own clinical reasoning, and both cascade
 * from users — deleting the row would take them silently. So the row is
 * scrubbed to a tombstone instead: its id and its deleted_at survive, and
 * nothing else on it says anything about the person.
 */
import cron from 'node-cron';
import { inArray, or, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { schema, withSystem } from '../db/client.js';
import { logger } from '../logging/logger.js';

/**
 * Dependency order: children before parents.
 *
 * `prediction_priors` first — it is the only table with composite foreign keys
 * to two others, so nothing else can go before it. Then the tables that point
 * at `predictions`, then `predictions` and `priors` themselves, then the rest.
 */
const PURGE_ORDER = [
  { name: 'prediction_priors', table: schema.predictionPriors },
  { name: 'body_states', table: schema.bodyStates },
  { name: 'reinterpretations', table: schema.reinterpretations },
  { name: 'crisis_events', table: schema.crisisEvents },
  { name: 'predictions', table: schema.predictions },
  { name: 'priors', table: schema.priors },
  { name: 'journal_entries', table: schema.journalEntries },
  { name: 'devices', table: schema.devices },
] as const;

/**
 * What `timezone` becomes. It is NOT NULL, so it cannot be nulled, and a real
 * zone is a coarse location — this is the neutral value that says nothing.
 */
export const SCRUBBED_TIMEZONE = 'UTC';

export interface PurgeResult {
  /** Accounts scrubbed to a tombstone. */
  users: number;
  /** Rows removed per table. Zero-count tables are omitted. */
  removed: Record<string, number>;
  total: number;
}

/**
 * One pass. Idempotent: a second run in the same minute finds nothing, and a
 * run interrupted partway leaves the rest for the next tick.
 */
export async function purgeDeleted(): Promise<PurgeResult> {
  const graceDays = config().DELETION_GRACE_DAYS;

  return withSystem(async (tx) => {
    // Which accounts. The system role can see only these, by the same
    // predicate that lets it delete them.
    const due = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        sql`${schema.users.deletedAt} IS NOT NULL
            AND ${schema.users.deletedAt} < now() - ${`${graceDays} days`}::interval`,
      );
    const ids = due.map((u) => u.id);
    if (ids.length === 0) return { users: 0, removed: {}, total: 0 };

    const removed: Record<string, number> = {};
    let total = 0;

    for (const { name, table } of PURGE_ORDER) {
      const r = await tx.delete(table).where(inArray(table.userId, ids));
      const n = r.rowCount ?? 0;
      if (n > 0) removed[name] = n;
      total += n;
    }

    // A consumed invite is a token hash and two timestamps, not a clinical
    // record, and it names the person who redeemed it. It goes.
    const invites = await tx
      .delete(schema.linkInvites)
      .where(or(inArray(schema.linkInvites.clinicianId, ids), inArray(schema.linkInvites.redeemedBy, ids)));
    if ((invites.rowCount ?? 0) > 0) removed['link_invites'] = invites.rowCount ?? 0;
    total += invites.rowCount ?? 0;

    // The link itself stays. formulations.link_id is NOT NULL and cascades
    // from it, so deleting a link deletes the clinician's formulations with
    // it. It was revoked when the account was deleted, which is what makes it
    // inert; it is not the client's data to destroy.

    // The tombstone. Not a delete: formulations and assistant_runs cascade
    // from this row and are the clinician's record, not the client's data.
    // What is left afterwards is an id, a deleted_at, and nothing that says
    // anything about the person — see TOMBSTONE_COLUMNS in the test, which
    // fails if a column is added to users without a decision about it.
    const u = await tx
      .update(schema.users)
      .set({ timezone: SCRUBBED_TIMEZONE })
      .where(inArray(schema.users.id, ids));
    const users = u.rowCount ?? 0;
    if (users > 0) removed['users_scrubbed'] = users;

    return { users, removed, total };
  });
}

/** Wire the purge into the scheduler. Called from jobs/index.ts. */
export function schedulePurge(): void {
  const c = config();
  cron.schedule(c.CRON_PURGE_TICK, async () => {
    try {
      const r = await purgeDeleted();
      // Counts only. There is no user id and no content in a purge log line,
      // and by the time it runs there is nothing left to identify.
      if (r.total > 0) logger().info({ job: 'purgeDeleted', ...r });
    } catch (err) {
      logger().error({ job: 'purgeDeleted', err: { type: (err as Error).name } });
    }
  });
}
