/**
 * The only file that talks to Anthropic. Three jobs: a reflective prompt for
 * an entry the client chose, a post-hoc "why" at the moment of mismatch, and
 * the locating assistant, which is the only one that reads a clinician's note
 * and the only one that does not return text. None of them produces or touches
 * a number shown to a user, and each receives the minimum text needed — one
 * entry, or one note, with no identifiers and no history.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { FRAMING, GATE_KEYS, OBSERVATION_IDS, isObservationId } from '@ledger/shared';
import { config } from '../config.js';
import { systemPrompt } from './locate-prompt.js';

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  const key = config().ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('AI features are not configured'), { statusCode: 503 });
  client ??= new Anthropic({ apiKey: key });
  return client;
}

const SYSTEM = `You are a writing aid inside a prediction ledger app for behavioral experiments. ${FRAMING.notATherapist}
Rules you must follow:
- You are not a therapist and must not diagnose, treat, or give clinical advice.
- Never invent numbers, counts, percentages, or statistics. If the user's record is relevant, it will be quoted to you; do not compute anything.
- Never tell the person what their prediction "really" means or assign them a pattern, type, or label.
- Reply in plain, short prose. No lists. No headers. Under 120 words.
- If the text suggests the person may be in danger, say only: "It sounds like you're carrying a lot right now. Please reach out to 988 (press 1 for veterans) or text 838255." and nothing else.`;

export interface WhyInput {
  expectedOutcome: string;
  confidence: number;
  actualOutcome: string;
  verdict: 'hit' | 'partial' | 'miss' | 'unclear';
}

/** The "why" at the moment of mismatch: reads the record back; no interpretation of the person. */
export async function explainMismatch(input: WhyInput): Promise<string> {
  const c = config();
  const user = `Before, the person wrote: "${input.expectedOutcome}" and was ${input.confidence}% sure.
After, they wrote: "${input.actualOutcome}". They marked it: ${input.verdict}.
In two or three sentences, read the forecast back against the record, in second person, without judging them and without explaining why they predicted what they did. Then, in one sentence, say what a written forecast is for: the prediction is fixed before the outcome so the outcome can be compared to it honestly.`;
  const res = await anthropic().messages.create({
    model: c.ANTHROPIC_MODEL,
    max_tokens: 300,
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
}

/** A reflective prompt for a journal entry the person chose. One question, no advice. */
export async function reflectivePrompt(entry: string): Promise<string> {
  const c = config();
  const res = await anthropic().messages.create({
    model: c.ANTHROPIC_MODEL,
    max_tokens: 150,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Here is a journal entry: "${entry}"\nOffer one open question the writer could sit with. No advice, no interpretation, one sentence.`,
      },
    ],
  });
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
}

// ---------------------------------------------------------------------------
// The locating assistant
//
// Proposal 02 §3. Third job, and the only one that reads a clinician's note:
// it marks which of the locator's signs the note gives evidence for, and it
// may ask about a gate. It cannot do anything else, because the schema has
// nowhere to put anything else — no floor, no number, no free text, no
// sentence the clinician did not write.
//
// Everything here is model plumbing and validation. Hashing, scoring, the
// database row and the link check belong to routes/assistant.ts; this function
// never sees a user id, a client id, or anything but the note itself.
// ---------------------------------------------------------------------------

/** Raised when the model returns something the contract does not allow. Carries no content. */
export class LocateSchemaError extends Error {
  constructor(readonly reason: string) {
    super(`locate: model output rejected (${reason})`);
    this.name = 'LocateSchemaError';
  }
}

/**
 * Exactly the three fields in proposal 02 §3, and `.strict()` on both objects
 * so an extra key is a rejection rather than a field that gets ignored.
 */
const locateOutputSchema = z
  .object({
    observations: z
      .array(z.object({ id: z.string(), evidence: z.array(z.string()) }).strict())
      .max(OBSERVATION_IDS.length),
    gateQuestions: z.array(z.enum(GATE_KEYS)),
    selfReportOnly: z.boolean(),
  })
  .strict();

export type LocateOutput = z.infer<typeof locateOutputSchema>;

export interface LocateResult extends LocateOutput {
  model: string;
  latencyMs: number;
}

/** The tool the model must call. `enum` on the id is the first of two guards; the second is in code. */
const LOCATE_TOOL = {
  name: 'locate',
  description: 'Mark the signs this note gives evidence for. The only way to answer.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['observations', 'gateQuestions', 'selfReportOnly'],
    properties: {
      observations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'evidence'],
          properties: {
            id: { type: 'string', enum: [...OBSERVATION_IDS] },
            evidence: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', description: 'A span copied character-for-character from the note.' },
            },
          },
        },
      },
      gateQuestions: { type: 'array', items: { type: 'string', enum: [...GATE_KEYS] } },
      selfReportOnly: { type: 'boolean' },
    },
  },
};

/**
 * Keep only what the note actually says.
 *
 * Two things are dropped without comment: a sign the model named that is not
 * a sign, and an evidence span that is not an exact substring of the note. A
 * sign left with no span is dropped too — an unquoted mark is the model's
 * assertion rather than the clinician's observation, which is the one thing
 * this tool must never launder.
 */
export function keepOnlyGrounded(out: LocateOutput, note: string): LocateOutput {
  const seen = new Set<string>();
  const observations: LocateOutput['observations'] = [];
  for (const o of out.observations) {
    if (!isObservationId(o.id) || seen.has(o.id)) continue;
    const evidence = [...new Set(o.evidence)].filter((e) => e.length > 0 && note.includes(e));
    if (evidence.length === 0) continue;
    seen.add(o.id);
    observations.push({ id: o.id, evidence });
  }
  return {
    observations,
    gateQuestions: [...new Set(out.gateQuestions)],
    selfReportOnly: out.selfReportOnly,
  };
}

/**
 * One note in, sign ids and quoted spans out.
 *
 * The note is PHI. It is passed to the model and then dropped: it is not
 * logged, not returned, not stored, and not attached to an error. The only
 * trace a run leaves is the row routes/assistant.ts writes, which holds the
 * note's SHA-256 and no part of the note.
 *
 * `stack` is the clinician's own training stack — modality and tier, theirs,
 * not client data. It constrains what the model is told it may suggest and
 * changes nothing about what it may return.
 */
export async function locate(note: string, stack: readonly { slug: string; tier: string }[] = []): Promise<LocateResult> {
  const c = config();
  const started = Date.now();
  const res = await anthropic().messages.create({
    model: c.ANTHROPIC_MODEL,
    max_tokens: 2000,
    system: systemPrompt(stack),
    tools: [LOCATE_TOOL],
    tool_choice: { type: 'tool', name: LOCATE_TOOL.name },
    messages: [{ role: 'user', content: note }],
  });
  const latencyMs = Date.now() - started;

  const call = res.content.find((b) => b.type === 'tool_use' && b.name === LOCATE_TOOL.name);
  // Anything that is not the tool call is a refusal to answer in the only
  // shape allowed. There is no fallback to reading text: text is what this
  // whole design exists to prevent.
  if (!call || call.type !== 'tool_use') throw new LocateSchemaError('no tool call');

  const parsed = locateOutputSchema.safeParse(call.input);
  // Field names and the issue code only. A zod message quotes the value it
  // rejected, and the value here can be a span of the note.
  if (!parsed.success) {
    throw new LocateSchemaError(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}:${i.code}`).join(','));
  }

  return { ...keepOnlyGrounded(parsed.data, note), model: c.ANTHROPIC_MODEL, latencyMs };
}
