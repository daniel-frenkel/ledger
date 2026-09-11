/**
 * The de-identified export — proposal 03 §6.
 *
 * `pnpm --filter @ledger/api research:export --dry-run` or `--write <dir>`.
 *
 * Four properties, each of which is a way this could go wrong:
 *
 *   **Consented only.** Participants with consent given and not withdrawn, at
 *   the moment the run reads them. Enforced by RLS — `app_research_consented()`
 *   in 0009 — so a wrong `WHERE` here cannot widen it, and a withdrawal takes
 *   effect immediately with nothing to re-run.
 *
 *   **Pseudonymous.** `HMAC-SHA256(user_id, secret)` truncated, with a secret
 *   generated per run and printed once. Two exports cannot be joined without
 *   it, and the mapping is never stored — which also means a re-identification
 *   request cannot be answered, and that is the trade being made.
 *
 *   **Date-shifted.** One random offset per participant in [−180, +180] days,
 *   applied to every timestamp of theirs. Intervals within a participant
 *   survive exactly, which is what a single-case design needs; calendar dates
 *   do not, which is what re-identification needs.
 *
 *   **Allowlisted.** Columns come from `allowlist.ts` and the writer selects
 *   that list rather than the table, so a column added to a table cannot
 *   appear here by being added.
 *
 * Runs as the system role, in the pattern of the deletion job. It reads client
 * rows, so it is logged like every other read of client rows.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { schema, withSystem } from '../db/client.js';
import { logAccess } from '../audit.js';
import { newId } from '../ids.js';
import { ALLOWLIST, allowlistHash, type Column, type TableSpec } from './allowlist.js';

/** Days either side of true. The window is wide enough that a date is not a date. */
export const SHIFT_DAYS = 180;

export interface ExportOptions {
  dryRun: boolean;
  outDir?: string;
  /** Injectable so a test is deterministic; otherwise a fresh secret per run. */
  secret?: Buffer;
  now?: Date;
}

export interface ExportResult {
  runId: string;
  participants: number;
  /** Rows that would be written, per table. Counted on a dry run too. */
  rows: Record<string, number>;
  /** Printed once, never stored. Undefined on a dry run. */
  secret?: string;
  files: string[];
}

/** Stable within a run, meaningless across runs. */
export const pseudonym = (userId: string, secret: Buffer): string =>
  crypto.createHmac('sha256', secret).update(userId, 'utf8').digest('hex').slice(0, 16);

/**
 * One offset per participant, derived from the run secret so a run is
 * reproducible from its own secret and from nothing else.
 */
export function shiftDaysFor(userId: string, secret: Buffer): number {
  const h = crypto.createHmac('sha256', secret).update(`shift:${userId}`, 'utf8').digest();
  // Two bytes is plenty for a range of 361, and the modulo bias over 65536 is
  // far below anything that matters here.
  const n = h.readUInt16BE(0) % (SHIFT_DAYS * 2 + 1);
  return n - SHIFT_DAYS;
}

const shifted = (value: Date, days: number): string =>
  new Date(value.getTime() + days * 86_400_000).toISOString();

/**
 * One cell.
 *
 * Whether to shift comes from the allowlist's declared type, not from the
 * runtime value. The driver returns a timestamptz as a Date or as a string
 * depending on how the query was made, and a check like `v instanceof Date`
 * stops shifting silently the moment that changes — which is the worst way
 * this could fail, because it fails by writing real dates.
 *
 * RFC 4180 enough otherwise: quote what could be misread, escape the quotes.
 */
function csvCell(v: unknown, type: Column['type'], days: number): string {
  if (v === null || v === undefined) return '';
  if (type === 'timestamp') {
    const d = v instanceof Date ? v : new Date(String(v));
    if (Number.isNaN(d.getTime())) throw new Error('export: a timestamp column held something that is not a date');
    return shifted(d, days);
  }
  if (Array.isArray(v)) return `"${v.join('|').replace(/"/g, '""')}"`;
  if (typeof v === 'object') return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function codebook(hash: string, participants: number, at: Date): string {
  const lines = [
    '# Codebook',
    '',
    `Generated ${at.toISOString()} from \`packages/api/src/research/allowlist.ts\`.`,
    `Allowlist SHA-256: \`${hash}\`. Participants: ${participants}.`,
    '',
    '`participant` is `HMAC-SHA256(user_id, run secret)` truncated to 16 hex characters.',
    'It is stable within this export and meaningless across exports; the mapping is not stored.',
    '',
    `Every timestamp is shifted by one random per-participant offset in [−${SHIFT_DAYS}, +${SHIFT_DAYS}] days.`,
    'Intervals within a participant are exact. Calendar dates are not, and must not be reported as dates.',
    '',
    'No column holding free text, a label, or any `_enc` value appears in this export or on the allowlist.',
    'No item-level questionnaire responses exist anywhere in the system to export.',
    '',
  ];
  for (const t of ALLOWLIST) {
    lines.push(`## ${t.table}`, '', '| column | type | meaning |', '| --- | --- | --- |');
    lines.push('| participant | pseudonym | The participant, pseudonymised. |');
    for (const c of t.columns) lines.push(`| ${c.name} | ${c.type} | ${c.meaning} |`);
    lines.push('');
  }
  return lines.join('\n');
}

async function readTable(
  tx: Parameters<Parameters<typeof withSystem>[0]>[0],
  spec: TableSpec,
): Promise<Record<string, unknown>[]> {
  // The allowlist chooses the columns, not `select *`. A column added to the
  // table cannot reach the output by being added.
  const cols = sql.join(
    spec.columns.map((c) => sql.raw(`"${c.name}"`)),
    sql`, `,
  );
  const q = sql`SELECT ${sql.raw(`"${spec.participant}"`)} AS participant, ${cols} FROM ${sql.raw(`"${spec.table}"`)}`;
  const res = await tx.execute<Record<string, unknown>>(q);
  return res.rows;
}

export async function runExport(opts: ExportOptions): Promise<ExportResult> {
  const at = opts.now ?? new Date();
  const secret = opts.secret ?? crypto.randomBytes(32);
  const runId = newId();
  const hash = allowlistHash();

  return withSystem(async (tx) => {
    // Consented participants. RLS returns only these, so the list and the rows
    // agree by construction rather than by both being filtered correctly.
    const people = await tx.execute<{ id: string }>(
      sql`SELECT id FROM users
           WHERE research_consent_at IS NOT NULL
             AND research_consent_withdrawn_at IS NULL
             AND deleted_at IS NULL`,
    );
    const ids = people.rows.map((r) => r.id);
    const shiftBy = new Map(ids.map((id) => [id, shiftDaysFor(id, secret)]));
    const names = new Map(ids.map((id) => [id, pseudonym(id, secret)]));

    const rows: Record<string, number> = {};
    const files: string[] = [];
    const audited: { table: string; count: number }[] = [];

    for (const spec of ALLOWLIST) {
      const found = await readTable(tx, spec);
      rows[spec.table] = found.length;
      audited.push({ table: spec.table, count: found.length });

      if (opts.dryRun || !opts.outDir) continue;

      const header = ['participant', ...spec.columns.map((c) => c.name)].join(',');
      const body = found.map((r) => {
        const who = String(r['participant']);
        const days = shiftBy.get(who) ?? 0;
        return [
          names.get(who) ?? '',
          ...spec.columns.map((c) => csvCell(r[c.name], c.type, days)),
        ].join(',');
      });
      const file = path.join(opts.outDir, `${spec.table}.csv`);
      fs.writeFileSync(file, `${[header, ...body].join('\n')}\n`, 'utf8');
      files.push(file);
    }

    if (!opts.dryRun && opts.outDir) {
      const file = path.join(opts.outDir, 'codebook.md');
      fs.writeFileSync(file, codebook(hash.toString('hex'), ids.length, at), 'utf8');
      files.push(file);
    }

    // The log of what left. Run id, time, participant count, allowlist hash —
    // nothing about who, because that would defeat the pseudonyms.
    await tx.insert(schema.exports_).values({
      id: runId,
      at,
      participantCount: ids.length,
      allowlistSha256: hash,
      dryRun: opts.dryRun,
    });

    // And one access-log line per table, as any other read of client rows.
    await logAccess(
      tx,
      { id: runId, role: 'system' as never },
      audited.map((a) => ({ table: 'research_export' as const, clientId: null, rowCount: a.count, action: 'export' as const })),
    );

    return {
      runId,
      participants: ids.length,
      rows,
      ...(opts.dryRun ? {} : { secret: secret.toString('hex') }),
      files,
    };
  });
}
