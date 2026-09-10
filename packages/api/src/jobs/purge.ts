/**
 * The thirty-day half of account deletion.
 *
 * `DELETE /v1/me` stamps `deleted_at`, which makes an account unreachable
 * immediately. This removes the rows for real once the grace period has
 * passed — the window that exists so a deletion made in the wrong five minutes
 * can still be undone from a backup, and after which it cannot.
 *
 * It runs in the system context, which is still the `ledger_api` role and
 * still under RLS. Migration 0007's policies are what make the DELETE legal
 * and they are strictly narrower than anything asked for here: a live row, or
 * one inside the grace period, is unreachable by the verb regardless of what
 * this file's `where` clause says. If the interval below were wrong tomorrow,
 * the database would still refuse.
 *
 * `users` goes last and does most of the work. Every child table cascades from
 * it — `crisis_events`, `devices`, `prediction_priors`,
 * `clinician_client_links`, `formulations`, `measures` — so completeness does
 * not depend on the list below being right. The per-table deletes exist so the
 * count is meaningful and so a table that ever loses its cascade is still
 * covered.
 */
import cron from 'node-cron';
import { and, isNotNull, lt, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { schema, withSystem } from '../db/client.js';
import { logger } from '../logging/logger.js';

/** Child tables first, `users` last: the order is the cascade's, not alphabetical. */
const PURGE_ORDER = [
  { name: 'body_states', table: schema.bodyStates },
  { name: 'reinterpretations', table: schema.reinterpretations },
  { name: 'journal_entries', table: schema.journalEntries },
  { name: 'predictions', table: schema.predictions },
  { name: 'priors', table: schema.priors },
] as const;

export interface PurgeResult {
  /** Rows removed per table, plus `users`. Zero-count tables are omitted. */
  removed: Record<string, number>;
  total: number;
}

/**
 * One pass. Idempotent: a second run in the same minute finds nothing, and a
 * run interrupted partway leaves the rest for the next tick.
 */
export async function purgeDeleted(): Promise<PurgeResult> {
  const graceDays = config().DELETION_GRACE_DAYS;
  const cutoff = sql`now() - ${`${graceDays} days`}::interval`;

  return withSystem(async (tx) => {
    const removed: Record<string, number> = {};
    let total = 0;

    for (const { name, table } of PURGE_ORDER) {
      const r = await tx.delete(table).where(and(isNotNull(table.deletedAt), lt(table.deletedAt, cutoff)));
      const n = r.rowCount ?? 0;
      if (n > 0) removed[name] = n;
      total += n;
    }

    // Last, and the one that matters: the cascade removes whatever the loop
    // above did not name.
    const u = await tx
      .delete(schema.users)
      .where(and(isNotNull(schema.users.deletedAt), lt(schema.users.deletedAt, cutoff)));
    const n = u.rowCount ?? 0;
    if (n > 0) removed['users'] = n;
    total += n;

    return { removed, total };
  });
}

/** Wire the purge into the scheduler. Called from jobs/index.ts. */
export function schedulePurge(): void {
  const c = config();
  cron.schedule(c.CRON_PURGE_TICK, async () => {
    try {
      const r = await purgeDeleted();
      // Counts only. There is no user id and no content in a purge log line,
      // and there is nothing left to identify by the time it runs.
      if (r.total > 0) logger().info({ job: 'purgeDeleted', ...r });
    } catch (err) {
      logger().error({ job: 'purgeDeleted', err: { type: (err as Error).name } });
    }
  });
}
