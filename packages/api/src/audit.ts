/**
 * Who read whose rows — go-live gate B1.
 *
 * RLS decides who *can* read a client's record. This records who *did*. A
 * policy is a control; an access log is evidence, and a risk analysis asks for
 * both.
 *
 * The line is written on the same transaction as the read it describes, so a
 * read that rolls back leaves no claim that it happened, and a read that
 * commits cannot commit without its line.
 *
 * **There is no content column and there will not be one.** The point of this
 * table is that it can be kept for six years without becoming a second copy of
 * the ledger: who, whose, which table, how many rows, when. `test/audit.test.ts`
 * asserts the column list, so a column that could hold prose fails there
 * rather than in review.
 */
import { schema, type Tx } from './db/client.js';
import { newId } from './ids.js';
import type { RequestUser } from './db/client.js';

/** Tables whose reads are logged. Client rows, and only client rows. */
export type AuditedTable =
  | 'predictions'
  | 'predictions_summary'
  | 'priors'
  | 'body_states'
  | 'reinterpretations'
  | 'journal_entries'
  | 'crisis_events'
  | 'formulations'
  | 'measures';

export type AuditAction = 'read' | 'export';

export interface AccessRecord {
  table: AuditedTable;
  /** Whose rows. Null only for a read not about one client, e.g. a cohort export. */
  clientId: string | null;
  rowCount: number;
  action?: AuditAction;
}

/**
 * Record one or more reads, inside the caller's transaction.
 *
 * Zero-row reads are logged too. "I looked and there was nothing" is a fact
 * about who went looking, which is the question this table answers; dropping
 * them would make an empty result the one way to read unobserved.
 */
export async function logAccess(tx: Tx, user: RequestUser, records: readonly AccessRecord[]): Promise<void> {
  if (records.length === 0) return;
  await tx.insert(schema.accessLog).values(
    records.map((r) => ({
      id: newId(),
      actorId: user.id,
      actorRole: user.role,
      clientId: r.clientId,
      tableName: r.table,
      action: r.action ?? 'read',
      rowCount: r.rowCount,
    })),
  );
}
