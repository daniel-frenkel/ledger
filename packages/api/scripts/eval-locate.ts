/**
 * Measure the locating assistant against a person.
 *
 * Reads docs/theory/eval/locate-notes.md, runs each note through locate(), and
 * prints agreement on signs and on floor. Manual: it needs ANTHROPIC_API_KEY
 * and it costs money, so it is not in CI.
 *
 *   pnpm --filter @ledger/api eval:locate
 *
 * Proposal 02 §3: below 80% floor agreement on the author's own notes is a
 * prompt problem, and the number goes in the report. Until the author replaces
 * the placeholder rows there is no number worth reporting, and this says so
 * rather than printing one that looks like a result.
 *
 * The fixture is the answer key, so it is marked DRAFT and excluded from the
 * assistant's corpus. Nothing here passes the expected floor or the expected
 * signs to the model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OBSERVATION_IDS, scoreFloors } from '@ledger/shared';
import { findWorkspaceRoot } from '../src/env.js';
import { locate } from '../src/services/ai.js';

interface Case {
  id: string;
  placeholder: boolean;
  floor: number;
  observations: string[];
  note: string;
}

const FIXTURE = 'docs/theory/eval/locate-notes.md';

function fixturePath(): string {
  const root = findWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
  if (!root) throw new Error('cannot find the workspace root');
  return path.join(root, FIXTURE);
}

/** One `###` heading per case: an id, a floor, a list of sign ids, a blockquote. */
export function parseCases(markdown: string): Case[] {
  // CR is a line terminator in JS regex; normalise before anything parses.
  const text = markdown.replace(/\r\n?/g, '\n');
  const cases: Case[] = [];

  for (const block of text.split(/^### /m).slice(1)) {
    const heading = block.slice(0, block.indexOf('\n')).trim();
    const id = heading.split('·')[0]!.trim();
    const floor = Number(/^-\s+\*\*floor:\*\*\s*(\d)/m.exec(block)?.[1]);
    const observations = (/^-\s+\*\*observations:\*\*\s*(.+)$/m.exec(block)?.[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const note = block
      .split('\n')
      .filter((l) => l.startsWith('>'))
      .map((l) => l.replace(/^>\s?/, ''))
      .join(' ')
      .trim();

    if (!id || !Number.isFinite(floor) || note === '') continue;
    const unknown = observations.filter((o) => !OBSERVATION_IDS.includes(o));
    if (unknown.length > 0) throw new Error(`${id}: not a sign: ${unknown.join(', ')}`);

    cases.push({ id, placeholder: /PLACEHOLDER/.test(heading), floor, observations, note });
  }
  return cases;
}

/** |A ∩ B| / |A ∪ B| — credit for the signs both picked, penalty for either alone. */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / (A.size + B.size - hit);
}

async function main(): Promise<void> {
  const cases = parseCases(fs.readFileSync(fixturePath(), 'utf8'));
  if (cases.length === 0) throw new Error(`${FIXTURE}: no cases`);

  const placeholders = cases.filter((c) => c.placeholder).length;
  let floorAgree = 0;
  let signSum = 0;

  for (const c of cases) {
    const out = await locate(c.note);
    const ids = out.observations.map((o) => o.id);
    const floor = scoreFloors(ids).top;
    const sign = jaccard(c.observations, ids);
    signSum += sign;
    if (floor === c.floor) floorAgree++;

    const mark = floor === c.floor ? 'ok  ' : 'MISS';
    console.log(
      `${mark} ${c.id}${c.placeholder ? ' [PLACEHOLDER]' : ''}  floor ${floor ?? '-'} vs ${c.floor}  signs ${(sign * 100).toFixed(0)}%`,
    );
    // Sign ids only. The note is not printed, here or anywhere.
    console.log(`     assistant: ${ids.join(', ') || '(none)'}`);
    console.log(`     author:    ${c.observations.join(', ') || '(none)'}`);
  }

  const floorPct = (floorAgree / cases.length) * 100;
  console.log(`\nfloor agreement ${floorPct.toFixed(0)}% (${floorAgree}/${cases.length})`);
  console.log(`sign agreement  ${((signSum / cases.length) * 100).toFixed(0)}% mean Jaccard`);

  if (placeholders > 0) {
    console.log(
      `\n${placeholders} of ${cases.length} rows are still PLACEHOLDER. These numbers measure the harness, not the assistant. Do not report them.`,
    );
    return;
  }
  console.log(floorPct >= 80 ? '\nAt or above the 80% bar in proposal 02 §3.' : '\nBelow the 80% bar in proposal 02 §3 — this is a prompt problem.');
}

// Only when run as a script. test/eval-locate.test.ts imports the parser, and
// importing this file must not fire a run that costs money.
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
