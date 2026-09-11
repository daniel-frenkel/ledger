/**
 * Sync — the one endpoint the phone talks to.
 *
 * Push: for each incoming row, upsert with last-write-wins on
 * `client_updated_at`, enforced *in the upsert itself* (`setWhere`) so two
 * devices syncing at once cannot interleave. Every pushed prediction /
 * journal entry is re-run through the crisis rules; a match becomes a
 * crisis_events row (deduped per user on source + entry id).
 *
 * Pull: return every row of the user's whose server `updated_at` is after
 * `since`. The client merges by id.
 *
 * All of it runs inside one `withUser` transaction, so RLS scopes every
 * statement to the caller, and under a per-user advisory lock so a user's
 * syncs are serialized (this is also what makes the `since` cursor safe: no
 * concurrent transaction for the same user can commit rows stamped earlier
 * than the cursor we hand back). Each row's statements run in a savepoint so
 * one bad row is reported in `rejected`, not fatal to the batch.
 *
 * The `userId` on each row is taken from the verified request, never from
 * the payload, and composite foreign keys in the schema make it impossible
 * to attach a child row to another user's prediction or prior.
 */
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { detectRiskInEntry, type CrisisEvent, type SyncPull, type SyncPush } from '@ledger/shared';
import { config } from '../config.js';
import { schema, withUser, type RequestUser, type Tx } from '../db/client.js';
import {
  bodyStateToRow,
  crisisToRow,
  journalToRow,
  predictionToRow,
  priorToRow,
  reinterpToRow,
  rowToBodyState,
  rowToCrisis,
  rowToJournal,
  rowToPrediction,
  rowToPrior,
  rowToReinterp,
} from './codec.js';

const { predictions, bodyStates, reinterpretations, priors, predictionPriors, journalEntries, crisisEvents, devices, usageEvents } =
  schema;

type Rejected = SyncPull['rejected'][number];

/** Run `fn` in a savepoint; return the error instead of aborting the transaction. */
async function attempt(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<unknown | null> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
    });
    return null;
  } catch (err) {
    return err;
  }
}

/** Strip identity/ownership columns from an upsert's SET clause. */
function updatable<T extends Record<string, unknown>>(row: T): Omit<T, 'id' | 'userId' | 'createdAt'> {
  const { id: _id, userId: _u, createdAt: _c, ...rest } = row;
  return rest;
}

export async function sync(user: RequestUser, push: SyncPush): Promise<SyncPull> {
  const keyVersion = config().FIELD_ENCRYPTION_KEY_VERSION;
  const rejected: Rejected[] = [];
  const now = new Date().toISOString();

  return withUser(user, async (tx) => {
    // Serialize this user's syncs (see header).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`);

    // --- device / push token -------------------------------------------------
    await tx
      .insert(devices)
      .values({ id: push.deviceId, userId: user.id, expoPushToken: push.expoPushToken ?? null })
      .onConflictDoUpdate({
        target: [devices.userId, devices.id],
        set: { expoPushToken: push.expoPushToken ?? null, lastPullAt: sql`now()` },
      });

    /**
     * The build that wrote this push, onto every row it creates. One value per
     * push rather than per row: the client cannot be running two versions at
     * once, and a per-row field would be one more thing a client could lie
     * about individually.
     */
    const stamp = <T extends object>(row: T): T & { appVersion: string | null } => ({
      ...row,
      appVersion: push.appVersion ?? null,
    });

    // --- priors first (predictions reference them) ------------------------------
    for (const p of push.priors) {
      const row = stamp(priorToRow(p, user.id, keyVersion));
      const err = await attempt(tx, (sp) =>
        sp
          .insert(priors)
          .values(row)
          .onConflictDoUpdate({ target: priors.id, set: updatable(row), setWhere: sql`${priors.clientUpdatedAt} <= excluded.client_updated_at` }),
      );
      if (err) rejected.push({ id: p.id, table: 'priors', code: pgCode(err) });
    }

    // --- predictions ----------------------------------------------------------------
    const crisisToLog: CrisisEvent[] = [];
    for (const p of push.predictions) {
      const row = stamp(predictionToRow(p, user.id, keyVersion));
      const err = await attempt(tx, (sp) =>
        sp
          .insert(predictions)
          .values(row)
          .onConflictDoUpdate({
            target: predictions.id,
            set: updatable(row),
            setWhere: sql`${predictions.clientUpdatedAt} <= excluded.client_updated_at`,
          }),
      );
      if (err) {
        rejected.push({ id: p.id, table: 'predictions', code: pgCode(err) });
        continue;
      }
      // Was our write the winner? If a newer version is already stored, leave its tags alone.
      const stored = await tx.select({ cu: predictions.clientUpdatedAt }).from(predictions).where(eq(predictions.id, p.id));
      if (!stored[0] || stored[0].cu.getTime() > new Date(p.clientUpdatedAt).getTime()) continue;

      // Prior tags: replace the client-assigned set; keep clinician-assigned rows.
      // Only priors the caller owns can be referenced (RLS hides the rest, and
      // the composite FK would refuse anyway).
      const tagErr = await attempt(tx, async (sp) => {
        await sp.delete(predictionPriors).where(and(eq(predictionPriors.predictionId, p.id), eq(predictionPriors.assignedBy, 'client')));
        if (p.priorIds.length === 0) return;
        const owned = await sp.select({ id: priors.id }).from(priors).where(inArray(priors.id, p.priorIds));
        for (const { id: priorId } of owned) {
          await sp.insert(predictionPriors).values({ predictionId: p.id, priorId, userId: user.id, assignedBy: 'client' }).onConflictDoNothing();
        }
      });
      if (tagErr) rejected.push({ id: p.id, table: 'prediction_priors', code: pgCode(tagErr) });

      // Crisis re-check, server side. The client already ran the same rules.
      const risk = detectRiskInEntry([p.situation, p.expectedOutcome, p.actualOutcome]);
      if (risk.matched) {
        crisisToLog.push({ id: crypto.randomUUID(), source: 'prediction', sourceEntryId: p.id, ruleIds: risk.ruleIds, resourcesShown: risk.resources, detectedOnDevice: false, createdAt: now });
      }
    }

    // --- body states ----------------------------------------------------------------
    for (const b of push.bodyStates) {
      const row = stamp(bodyStateToRow(b, user.id, keyVersion));
      const err = await attempt(tx, (sp) =>
        sp
          .insert(bodyStates)
          .values(row)
          .onConflictDoUpdate({ target: bodyStates.id, set: updatable(row), setWhere: sql`${bodyStates.clientUpdatedAt} <= excluded.client_updated_at` }),
      );
      if (err) rejected.push({ id: b.id, table: 'body_states', code: pgCode(err) });
    }

    // --- reinterpretations: insert-only; the only permitted update is soft-delete ---
    for (const r of push.reinterpretations) {
      const existing = await tx.select({ cu: reinterpretations.clientUpdatedAt }).from(reinterpretations).where(eq(reinterpretations.id, r.id));
      if (!existing[0]) {
        const err = await attempt(tx, (sp) => sp.insert(reinterpretations).values(stamp(reinterpToRow(r, user.id, keyVersion))));
        if (err) rejected.push({ id: r.id, table: 'reinterpretations', code: pgCode(err) });
        continue;
      }
      if (r.deletedAt) {
        const deletedAt = new Date(r.deletedAt);
        const clientUpdatedAt = new Date(r.clientUpdatedAt);
        const err = await attempt(tx, (sp) =>
          sp
            .update(reinterpretations)
            .set({ deletedAt, clientUpdatedAt })
            .where(and(eq(reinterpretations.id, r.id), sql`${reinterpretations.clientUpdatedAt} <= ${clientUpdatedAt}`)),
        );
        if (err) rejected.push({ id: r.id, table: 'reinterpretations', code: pgCode(err) });
      } else if (new Date(r.clientUpdatedAt).getTime() > existing[0].cu.getTime()) {
        // An edit to an existing reinterpretation: refused by design. Tell the
        // client so it can revert to the server copy instead of diverging.
        rejected.push({ id: r.id, table: 'reinterpretations', code: 'append_only' });
      }
    }

    // --- journal ----------------------------------------------------------------------
    for (const j of push.journalEntries) {
      const row = stamp(journalToRow(j, user.id, keyVersion));
      const err = await attempt(tx, (sp) =>
        sp
          .insert(journalEntries)
          .values(row)
          .onConflictDoUpdate({ target: journalEntries.id, set: updatable(row), setWhere: sql`${journalEntries.clientUpdatedAt} <= excluded.client_updated_at` }),
      );
      if (err) {
        rejected.push({ id: j.id, table: 'journal_entries', code: pgCode(err) });
        continue;
      }
      const risk = detectRiskInEntry([j.body]);
      if (risk.matched) {
        crisisToLog.push({ id: crypto.randomUUID(), source: 'journal', sourceEntryId: j.id, ruleIds: risk.ruleIds, resourcesShown: risk.resources, detectedOnDevice: false, createdAt: now });
      }
    }

    // --- crisis events: client-detected first, then server-detected --------------------
    for (const c of [...push.crisisEvents, ...crisisToLog]) {
      const err = await attempt(tx, (sp) =>
        sp
          .insert(crisisEvents)
          .values(stamp(crisisToRow(c, user.id)))
          .onConflictDoUpdate({
            target: [crisisEvents.userId, crisisEvents.source, crisisEvents.sourceEntryId],
            set: {
              // keep the earliest detection; merge rule ids; record acknowledgement
              ruleIds: sql`(SELECT ARRAY(SELECT DISTINCT unnest(array_cat(${crisisEvents.ruleIds}, ARRAY[${sql.join(c.ruleIds.map((r) => sql`${r}`), sql`, `)}]::text[])) ORDER BY 1))`,
              ...(c.acknowledgedAt ? { acknowledgedAt: new Date(c.acknowledgedAt) } : {}),
            },
          }),
      );
      if (err) rejected.push({ id: c.id, table: 'crisis_events', code: pgCode(err) });
    }

    // --- usage events ---------------------------------------------------------------
    // No payload, no entity id, no text — five columns, and proposal 03 §5 is
    // explicit that it stays that way. Duplicates are ignored rather than
    // rejected: a client retries a push it is unsure landed, and a repeated
    // app_open is not an error worth telling anyone about.
    for (const u of push.usageEvents) {
      await attempt(tx, (sp) =>
        sp
          .insert(usageEvents)
          .values({
            id: u.id,
            userId: user.id,
            kind: u.kind,
            appVersion: push.appVersion ?? null,
            createdAt: new Date(u.createdAt),
          })
          .onConflictDoNothing(),
      );
    }

    // --- pull -----------------------------------------------------------------------
    return pull(tx, user, push.since ?? null, rejected);
  });
}

async function pull(tx: Tx, user: RequestUser, since: string | null, rejected: Rejected[]): Promise<SyncPull> {
  // Compare in Postgres, as text → timestamptz, so microseconds survive (a JS
  // Date would truncate the cursor to milliseconds and re-send the last batch).
  const after = <C extends { updatedAt: unknown }>(t: C) => (since ? gt(t.updatedAt as never, sql`${since}::timestamptz`) : undefined);

  const predRows = await tx.select().from(predictions).where(and(eq(predictions.userId, user.id), after(predictions)));
  const tagRows = predRows.length ? await tx.select().from(predictionPriors).where(eq(predictionPriors.userId, user.id)) : [];
  const tagsByPrediction = new Map<string, string[]>();
  for (const t of tagRows) {
    if (!tagsByPrediction.has(t.predictionId)) tagsByPrediction.set(t.predictionId, []);
    tagsByPrediction.get(t.predictionId)!.push(t.priorId);
  }

  const bodyRows = await tx.select().from(bodyStates).where(and(eq(bodyStates.userId, user.id), after(bodyStates)));
  const reRows = await tx.select().from(reinterpretations).where(and(eq(reinterpretations.userId, user.id), after(reinterpretations)));
  const priorRows = await tx.select().from(priors).where(and(eq(priors.userId, user.id), after(priors)));
  const journalRows = await tx.select().from(journalEntries).where(and(eq(journalEntries.userId, user.id), after(journalEntries)));
  const crisisRows = await tx.select().from(crisisEvents).where(and(eq(crisisEvents.userId, user.id), after(crisisEvents)));

  // clock_timestamp() taken AFTER every write in this transaction, so every
  // row we stamped is ≤ the cursor; and because this user's syncs are
  // serialized by the advisory lock, no other transaction can later commit a
  // row for this user stamped earlier than this value.
  const serverTime = (await tx.execute<{ now: string }>(sql`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`)).rows[0]!.now;

  return {
    serverTime,
    predictions: predRows.map((r) => rowToPrediction(r, tagsByPrediction.get(r.id) ?? [])),
    bodyStates: bodyRows.map(rowToBodyState),
    reinterpretations: reRows.map(rowToReinterp),
    priors: priorRows.map(rowToPrior),
    journalEntries: journalRows.map(rowToJournal),
    crisisEvents: crisisRows.map(rowToCrisis),
    rejected,
  };
}

function pgCode(err: unknown): string {
  const e = err as { code?: string; constraint?: string };
  return e.constraint ?? e.code ?? 'error';
}
