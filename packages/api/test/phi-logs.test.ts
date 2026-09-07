/**
 * No PHI in logs, ever. Run a full sync at trace level with distinctive
 * seeded strings, then grep everything the logger wrote. The build fails if
 * any of them appears — including the user id.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closeDb } from '../src/db/client.js';
import { CLIENT_A, DEVICE_A, LogSink, asUser, buildApp, truncateAll, uid } from './helpers.js';

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
beforeEach(truncateAll);

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
});
