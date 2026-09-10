/**
 * No PHI in logs, ever. Run a full sync at trace level with distinctive
 * seeded strings, then grep everything the logger wrote. The build fails if
 * any of them appears — including the user id.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { locateMock } = vi.hoisted(() => ({ locateMock: vi.fn() }));

vi.hoisted(() => {
  // The assistant ships off. It is switched on here because a route that
  // returns 503 proves nothing about whether a note would have been logged.
  process.env['ASSISTANT_ENABLED'] = 'true';
  process.env['ANTHROPIC_API_KEY'] ??= 'test-key-not-a-real-one';
});

// The model is mocked; what is under test is our side of the call.
vi.mock('../src/services/ai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/ai.js')>();
  return { ...actual, locate: locateMock };
});

// Static imports are safe: vitest hoists vi.mock and vi.hoisted above them.
import { closeDb } from '../src/db/client.js';
import { CLIENT_A, CLINICIAN, DEVICE_A, LogSink, acceptBaa, asUser, buildApp, truncateAll, uid } from './helpers.js';

const SEEDS = {
  situation: 'ZQX-SITUATION-8841 telling the sergeant I froze',
  expected: 'ZQX-EXPECTED-8842 he will call me a coward',
  actual: 'ZQX-ACTUAL-8843 he nodded and said same',
  reinterp: 'ZQX-REINTERP-8844 he was only being nice',
  prior: 'ZQX-PRIOR-8845 if I show weakness they withdraw',
  journal: 'ZQX-JOURNAL-8846 I want to die',
  verdict: 'ZQX-VERDICT-8847',
  room: 'ZQX-ROOM-8848',
  word: 'ZQX-WORD-8849',
};

let sink: LogSink;
let app: FastifyInstance;

beforeAll(async () => {
  sink = new LogSink();
  app = await buildApp(sink);
});
afterAll(async () => {
  await app.close();
  await closeDb();
});
beforeEach(async () => {
  await truncateAll();
  // The clinician needs an accepted BAA to create an invite (gate A1); the
  // gate itself is tested in audit.test.ts.
  await acceptBaa([CLINICIAN]);
});

describe('PHI never reaches the log', () => {
  it('after a full sync (including a crisis match and a 400), no seeded string or user id is logged', async () => {
    const T = '2026-09-01T18:00:00.000Z';
    const pred = {
      id: uid(101),
      situation: SEEDS.situation,
      expectedOutcome: SEEDS.expected,
      confidence: 80,
      priorIds: [uid(201)],
      resolvedAt: T,
      actualOutcome: SEEDS.actual,
      outcomeVerdict: 'miss',
      outcomeSource: 'observed',
      surpriseRating: 8,
      presentForIt: true,
      createdAt: T,
      clientUpdatedAt: T,
    };
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/sync',
      headers: asUser(CLIENT_A),
      payload: {
        deviceId: DEVICE_A,
        priors: [{ id: uid(201), label: SEEDS.prior, category: 'mattering', origin: 'client', createdBy: 'client', createdAt: T, clientUpdatedAt: T }],
        predictions: [pred],
        reinterpretations: [{ id: uid(301), predictionId: pred.id, text: SEEDS.reinterp, createdAt: T, clientUpdatedAt: T }],
        journalEntries: [{ id: uid(401), body: SEEDS.journal, createdAt: T, clientUpdatedAt: T }],
        bodyStates: [
          {
            id: uid(501),
            predictionId: pred.id,
            phase: 'before',
            before: { intensity: 6, words: [SEEDS.word], verdict: SEEDS.verdict, room: SEEDS.room },
            createdAt: T,
            clientUpdatedAt: T,
          },
        ],
      },
    });
    expect(ok.statusCode).toBe(200);

    // a validation failure that echoes paths
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/sync',
      headers: asUser(CLIENT_A),
      payload: { deviceId: DEVICE_A, predictions: [{ ...pred, confidence: 999 }] },
    });
    expect(bad.statusCode).toBe(400);

    // a server error path (bad JSON body)
    await app.inject({ method: 'POST', url: '/v1/sync', headers: { ...asUser(CLIENT_A), 'content-type': 'application/json' }, payload: '{not json' });

    const logs = sink.text();
    expect(logs.length).toBeGreaterThan(0); // the logger did run
    for (const [name, s] of Object.entries(SEEDS)) {
      expect(logs, `seed "${name}" leaked`).not.toContain(s);
      // also the distinctive token alone
      expect(logs, `token of "${name}" leaked`).not.toMatch(/ZQX-/);
    }
    expect(logs, 'user id leaked').not.toContain(CLIENT_A);
    expect(logs, 'x-test-user header leaked').not.toContain('x-test-user');
    expect(logs, 'authorization header leaked').not.toMatch(/authorization/i);
  });

  /**
   * The assistant is the first hop where a third party reads client prose, so
   * the note gets the same treatment as everything above and one check more:
   * the spans the model quotes back are also the client's words, and they are
   * returned to the clinician who wrote them without being written down.
   */
  it('a locating run leaks no part of the note, on the happy path or either failure', async () => {
    const NOTE_SEEDS = {
      observed: 'ZQX-NOTE-9301 she recited the formulation back and nothing moved',
      reaction: 'ZQX-NOTE-9302 flinched before I finished the sentence',
      quoted: 'ZQX-NOTE-9303 he will decide I am the difficult one',
    };
    const note = Object.values(NOTE_SEEDS).join('. ');

    locateMock.mockResolvedValue({
      // The evidence spans are the client's words coming back out.
      observations: [
        { id: 'insight-does-not-move', evidence: [NOTE_SEEDS.observed] },
        { id: 'reaction-before-thought', evidence: [NOTE_SEEDS.reaction] },
      ],
      gateQuestions: ['risk'],
      selfReportOnly: false,
      model: 'claude-test-model',
      latencyMs: 7,
    });

    // A link, made the way a real one is.
    const made = await app.inject({
      method: 'POST',
      url: '/v1/invites',
      headers: asUser(CLINICIAN, 'clinician'),
      payload: {},
    });
    const { token } = made.json() as { token: string };
    await app.inject({ method: 'POST', url: '/v1/invites/redeem', headers: asUser(CLIENT_A), payload: { token } });

    const locateCall = (body: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/v1/assistant/locate',
        headers: asUser(CLINICIAN, 'clinician'),
        payload: body,
      });

    const ok = await locateCall({ clientId: CLIENT_A, note });
    expect(ok.statusCode).toBe(200);
    // The clinician does get the spans back — that is the feature.
    expect(ok.body).toContain('ZQX-NOTE-9301');

    // Both failure paths, because an error is the usual way text escapes.
    locateMock.mockRejectedValue(new Error(`upstream rejected: ${note}`));
    expect((await locateCall({ clientId: CLIENT_A, note })).statusCode).toBe(502);

    locateMock.mockRejectedValue(Object.assign(new Error('bad shape'), { name: 'LocateSchemaError', reason: note }));
    expect((await locateCall({ clientId: CLIENT_A, note })).statusCode).toBe(502);

    const logs = sink.text();
    for (const [name, s] of Object.entries(NOTE_SEEDS)) {
      expect(logs, `note seed "${name}" leaked`).not.toContain(s);
    }
    expect(logs, 'a note token leaked').not.toMatch(/ZQX-NOTE-/);
    expect(logs, 'clinician id leaked').not.toContain(CLINICIAN);
    // The row that records the run is checked in test/assistant.test.ts, which
    // reads it back column by column.
  });
});
