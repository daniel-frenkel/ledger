/**
 * The only file that talks to Anthropic. Two jobs: a reflective prompt for
 * an entry the client chose, and a post-hoc "why" at the moment of mismatch.
 * Text in, text out. It never produces or touches a number shown to a user,
 * and it receives the minimum text needed — one entry, no identifiers, no
 * history.
 */
import Anthropic from '@anthropic-ai/sdk';
import { FRAMING } from '@ledger/shared';
import { config } from '../config.js';

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
