/**
 * What the model is allowed to say, and what happens when it says anything else.
 *
 * The Anthropic SDK is mocked, so these are tests of our contract rather than
 * of the model: the schema has exactly three fields, an id must be a real sign,
 * an evidence span must be an exact substring of the note, and everything else
 * is a rejection that carries no content.
 *
 * No database. Needs a valid config, like every other file that builds the app.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.hoisted(() => {
  process.env['ANTHROPIC_API_KEY'] ??= 'test-key-not-a-real-one';
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
    constructor(_opts: unknown) {}
  },
}));

// Static imports are safe: vitest hoists vi.mock and vi.hoisted above them.
import { LocateSchemaError, keepOnlyGrounded, locate } from '../src/services/ai.js';
import { CORPUS_FILES, SIGNS_NOT_SELF_REPORT, systemPrompt } from '../src/services/locate-prompt.js';
import { GATE_KEYS, OBSERVATION_IDS } from '@ledger/shared';

/** A note with two distinctive spans, so a substring check cannot pass by accident. */
const NOTE =
  'She could recite the whole formulation back to me and it changed nothing. ' +
  'Twice she flinched before I had finished the sentence.';

const RECITE = 'recite the whole formulation back to me and it changed nothing';
const FLINCH = 'flinched before I had finished the sentence';

const toolCall = (input: unknown) => ({ content: [{ type: 'tool_use', name: 'locate', input }] });

const wellFormed = {
  observations: [
    { id: 'insight-does-not-move', evidence: [RECITE] },
    { id: 'reaction-before-thought', evidence: [FLINCH] },
  ],
  gateQuestions: ['risk'],
  selfReportOnly: false,
};

beforeEach(() => create.mockReset());

describe('locate', () => {
  it('returns exactly the three fields, and the ids the model marked', async () => {
    create.mockResolvedValue(toolCall(wellFormed));
    const out = await locate(NOTE);

    expect(Object.keys(out).sort()).toEqual([
      'gateQuestions',
      'latencyMs',
      'model',
      'observations',
      'selfReportOnly',
    ]);
    expect(out.observations.map((o) => o.id)).toEqual(['insight-does-not-move', 'reaction-before-thought']);
    expect(out.gateQuestions).toEqual(['risk']);
    expect(out.selfReportOnly).toBe(false);
  });

  it('forces the tool: the model is given no way to answer in prose', async () => {
    create.mockResolvedValue(toolCall(wellFormed));
    await locate(NOTE);

    const args = create.mock.calls[0]![0] as {
      tool_choice: { type: string; name: string };
      tools: { input_schema: { properties: Record<string, unknown>; additionalProperties: boolean } }[];
    };
    expect(args.tool_choice).toEqual({ type: 'tool', name: 'locate' });
    const props = args.tools[0]!.input_schema.properties;
    expect(Object.keys(props).sort()).toEqual(['gateQuestions', 'observations', 'selfReportOnly']);
    expect(args.tools[0]!.input_schema.additionalProperties).toBe(false);
  });

  it('pins the id to a real sign and the gate to a real gate, in the schema itself', async () => {
    create.mockResolvedValue(toolCall(wellFormed));
    await locate(NOTE);
    const schema = (create.mock.calls[0]![0] as { tools: { input_schema: Record<string, any> }[] }).tools[0]!
      .input_schema;
    expect(schema['properties'].observations.items.properties.id.enum).toEqual([...OBSERVATION_IDS]);
    expect(schema['properties'].gateQuestions.items.enum).toEqual([...GATE_KEYS]);
  });

  it('drops an evidence span that is not an exact substring of the note', async () => {
    create.mockResolvedValue(
      toolCall({
        // Tidied punctuation and a paraphrase. Both are inventions.
        observations: [{ id: 'insight-does-not-move', evidence: ['she could recite the whole formulation'] }],
        gateQuestions: [],
        selfReportOnly: false,
      }),
    );
    const out = await locate(NOTE);
    expect(out.observations).toEqual([]);
  });

  it('keeps the spans that are exact and drops the ones that are not, within one observation', async () => {
    create.mockResolvedValue(
      toolCall({
        observations: [{ id: 'insight-does-not-move', evidence: [RECITE, 'a sentence never written'] }],
        gateQuestions: [],
        selfReportOnly: false,
      }),
    );
    const out = await locate(NOTE);
    expect(out.observations).toEqual([{ id: 'insight-does-not-move', evidence: [RECITE] }]);
  });

  it('drops an id that is not a sign, even though the schema forbade it', async () => {
    create.mockResolvedValue(
      toolCall({
        observations: [
          { id: 'borderline-traits', evidence: [RECITE] },
          { id: 'reaction-before-thought', evidence: [FLINCH] },
        ],
        gateQuestions: [],
        selfReportOnly: false,
      }),
    );
    const out = await locate(NOTE);
    expect(out.observations.map((o) => o.id)).toEqual(['reaction-before-thought']);
  });

  it('rejects an extra field rather than ignoring it', async () => {
    create.mockResolvedValue(toolCall({ ...wellFormed, impression: 'She presents as avoidantly attached.' }));
    await expect(locate(NOTE)).rejects.toBeInstanceOf(LocateSchemaError);
  });

  it('rejects a free-text field smuggled into an observation', async () => {
    create.mockResolvedValue(
      toolCall({
        observations: [{ id: 'insight-does-not-move', evidence: [RECITE], rationale: 'because she said so' }],
        gateQuestions: [],
        selfReportOnly: false,
      }),
    );
    await expect(locate(NOTE)).rejects.toBeInstanceOf(LocateSchemaError);
  });

  it('rejects a prose answer with no tool call', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'This looks like floor 6 to me.' }] });
    await expect(locate(NOTE)).rejects.toThrow(/no tool call/);
  });

  it('rejects a floor, because there is nowhere to put one', async () => {
    create.mockResolvedValue(toolCall({ ...wellFormed, floor: 6 }));
    await expect(locate(NOTE)).rejects.toBeInstanceOf(LocateSchemaError);
  });

  it('puts no part of the note into the rejection', async () => {
    create.mockResolvedValue(
      toolCall({
        observations: [{ id: 'insight-does-not-move', evidence: 'not-an-array' }],
        gateQuestions: [],
        selfReportOnly: false,
      }),
    );
    const err = (await locate(NOTE).catch((e: Error) => e)) as LocateSchemaError;
    const text = `${err.message} ${err.reason ?? ''} ${err.stack ?? ''}`;
    expect(text).not.toContain(RECITE);
    expect(text).not.toContain(FLINCH);
    expect(text).not.toContain('not-an-array');
  });

  it('records the model id and a duration, and nothing else about the call', async () => {
    create.mockResolvedValue(toolCall(wellFormed));
    const out = await locate(NOTE);
    expect(typeof out.model).toBe('string');
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('keepOnlyGrounded', () => {
  it('de-duplicates ids and spans', () => {
    const out = keepOnlyGrounded(
      {
        observations: [
          { id: 'insight-does-not-move', evidence: [RECITE, RECITE] },
          { id: 'insight-does-not-move', evidence: [RECITE] },
        ],
        gateQuestions: ['risk', 'risk'],
        selfReportOnly: true,
      },
      NOTE,
    );
    expect(out.observations).toEqual([{ id: 'insight-does-not-move', evidence: [RECITE] }]);
    expect(out.gateQuestions).toEqual(['risk']);
  });

  it('drops an empty span, which matches every note', () => {
    const out = keepOnlyGrounded(
      { observations: [{ id: 'insight-does-not-move', evidence: [''] }], gateQuestions: [], selfReportOnly: false },
      NOTE,
    );
    expect(out.observations).toEqual([]);
  });
});

describe('the system prompt', () => {
  it('carries every sign the clinician can tick, by id', () => {
    const p = systemPrompt();
    for (const id of OBSERVATION_IDS) expect(p, id).toContain(id);
  });

  it('carries the three gates and the line about self-report', () => {
    const p = systemPrompt();
    for (const k of GATE_KEYS) expect(p).toContain(k);
    expect(p).toContain(SIGNS_NOT_SELF_REPORT);
  });

  it('carries the Decision Aid, read from docs/theory rather than copied', () => {
    expect(CORPUS_FILES).toContain('tools/decision-aid-locating-the-floor.md');
    expect(systemPrompt()).toContain('Step 0 · The gates');
  });

  it('tells the model it is not a therapist', () => {
    expect(systemPrompt()).toMatch(/not a therapist/i);
  });
});
