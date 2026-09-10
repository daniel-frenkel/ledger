/**
 * Scheduled jobs (node-cron, in-process). Each tick is idempotent.
 *
 * nudgeUnresolved: for every client with a prediction whose scheduled_for
 * passed more than 2 hours ago and is still open, send one generic push.
 * Runs as a service job outside RLS? No — it runs with a system context
 * that is still subject to RLS, using a per-user transaction per device, so
 * a job bug cannot read across users either.
 */
import cron from 'node-cron';
import { and, isNull, lt, sql, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb, schema, withUser } from '../db/client.js';
import { logger } from '../logging/logger.js';
import { sendCheckInPrompts } from '../services/push.js';
import { schedulePurge } from './purge.js';

export async function nudgeUnresolved(): Promise<{ users: number; sent: number }> {
  // Step 1: find candidate user ids. This one query runs outside RLS
  // (no user context) but selects ids only — no content, no timestamps returned.
  const rows = await getDb()
    .selectDistinct({ userId: schema.predictions.userId })
    .from(schema.predictions)
    .where(
      and(
        isNull(schema.predictions.resolvedAt),
        isNull(schema.predictions.abandonedAt),
        isNull(schema.predictions.deletedAt),
        lt(schema.predictions.scheduledFor, sql`now() - interval '2 hours'`),
      ),
    );
  let sent = 0;
  for (const { userId } of rows) {
    const tokens = await withUser({ id: userId, role: 'client' }, (tx) =>
      tx.select({ token: schema.devices.expoPushToken }).from(schema.devices).where(eq(schema.devices.userId, userId)),
    );
    sent += await sendCheckInPrompts(tokens.map((t) => t.token).filter((t): t is string => !!t));
  }
  return { users: rows.length, sent };
}

export function startJobs(): void {
  const c = config();
  if (!c.JOBS_ENABLED || c.NODE_ENV === 'test') return;
  cron.schedule(c.CRON_NUDGE_TICK, async () => {
    try {
      const r = await nudgeUnresolved();
      logger().info({ job: 'nudgeUnresolved', ...r });
    } catch (err) {
      logger().error({ job: 'nudgeUnresolved', err });
    }
  });
  schedulePurge();
}
