/**
 * What the locating assistant is pinned to, and nothing else.
 *
 * Proposal 02 §3: the system prompt contains the locator's signs and their
 * definitions, the Decision Aid, the three gates, and the line about signs
 * versus self-report. It does not receive the ledger, the priors, or any
 * prior formulation — there is no code path here that could fetch one.
 *
 * The signs come from `@ledger/shared`, which is the same module the browser
 * draws the locator from and the API validates a formulation against, so the
 * assistant cannot be pinned to a different list than the one the clinician
 * ticks. The Decision Aid is read from `docs/theory/` at first use, because it
 * is a document the author edits and a copy in `src/` would go stale silently.
 *
 * That read is why `assertCorpusAvailable()` exists and why the route calls it
 * at registration when the assistant is on: a missing document must stop the
 * server at boot, not produce a truncated prompt on the first real note.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_KEYS, GATE_QUESTIONS, OBSERVATIONS } from '@ledger/shared';
import { findWorkspaceRoot } from '../env.js';

/** Documents quoted into the prompt, relative to `docs/theory/`. */
export const CORPUS_FILES = ['tools/decision-aid-locating-the-floor.md'] as const;

/** The line the Decision Aid opens with, and the reason this tool exists at all. */
export const SIGNS_NOT_SELF_REPORT =
  'the floor is read from signs and patterns the client is the last to see, not asked for by self-report';

function theoryDir(): string {
  const root = findWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
  if (!root) throw new Error('locate: cannot find the workspace root, so docs/theory is unreachable');
  return path.join(root, 'docs', 'theory');
}

function readCorpus(): string {
  const dir = theoryDir();
  return CORPUS_FILES.map((f) => {
    const file = path.join(dir, f);
    if (!fs.existsSync(file)) throw new Error(`locate: missing prompt document docs/theory/${f}`);
    // CR is a line terminator in JS regex; normalise once, at the read.
    return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').trim();
  }).join('\n\n---\n\n');
}

/** The signs, as the clinician reads them, with the floors each points at. */
function signList(): string {
  return OBSERVATIONS.map((o) => `- ${o.id}: "${o.q}"${o.note ? ` ${o.note}` : ''} (${o.tag})`).join('\n');
}

const RULES = `You read one clinical note written by a clinician about a session, and you mark which of the listed signs the note gives evidence for. That is the whole job.

Rules, all of them absolute:
- You return only the structured output. You have no free-text field and must not attempt one.
- You never name a floor, a number, a score, a diagnosis, a label, a protocol, or a recommendation. Floors are computed in code from the sign ids you return. You do not see the computation and must not anticipate it.
- Every evidence span must be copied character-for-character from the note. Do not paraphrase, correct spelling, expand an abbreviation, or trim to a nicer boundary. A span that is not an exact substring of the note is discarded, and the sign with it.
- Mark a sign only where the note reports what the clinician observed. ${SIGNS_NOT_SELF_REPORT}. If the note is mostly the client's own account of themselves with little the clinician observed, return selfReportOnly: true.
- Gates: you may ask, you may never answer. Return a gate key when the note gives no evidence that gate was addressed. You are not clearing it and not judging it; the clinician attests, separately, and nothing you return can substitute for that.
- If the note supports no sign, return an empty observations array. An empty answer is a correct answer.`;

let cached: string | undefined;

/** The system prompt. Built once per process; throws if a document is missing. */
export function systemPrompt(): string {
  cached ??= `You are a locating aid inside a clinician's case-formulation tool. You are not a therapist, you do not treat anyone, and predictive processing is the framework this tool is built on, not a validated treatment.

${RULES}

## The signs you may mark

${signList()}

## The gates you may ask about

${GATE_KEYS.map((k) => `- ${k}: ${GATE_QUESTIONS[k]}`).join('\n')}

## The procedure this tool implements

${readCorpus()}`;
  return cached;
}

/**
 * Boot-time check. Called when ASSISTANT_ENABLED is on, so a deployment that
 * shipped without `docs/theory/` fails to start instead of failing on a note.
 */
export function assertCorpusAvailable(): void {
  systemPrompt();
}
