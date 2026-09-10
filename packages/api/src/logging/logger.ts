/**
 * Pino with a redaction list. PHI must never reach a log line; the list
 * below is enforced at serialization, not by convention. Request logs carry
 * a request id and route, never a user id.
 *
 * test/phi-logs.test.ts seeds known strings through a full sync and fails
 * the build if any of them appears in captured log output.
 */
import pino, { type Logger, type LoggerOptions } from 'pino';
import { config } from '../config.js';

/** Paths removed from every log object. Wildcards cover nested payloads. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-test-user"]',
  'req.body',
  'res.body',
  'body',
  'payload',
  'user',
  'userId',
  'user_id',
  'email',
  // An invite token is a bearer credential, and its hash is the lookup key.
  // Neither is ever logged deliberately; this is the backstop.
  'token',
  'tokenHash',
  'token_hash',
  'note',
  'falsify',
  'situation',
  'expectedOutcome',
  'actualOutcome',
  'text',
  'label',
  'words',
  'verdict',
  'room',
  'wordNow',
  'feltVsObserved',
  '*.situation',
  '*.expectedOutcome',
  '*.actualOutcome',
  '*.text',
  '*.label',
  '*.body',
  '*.words',
  '*.verdict',
  '*.room',
  '*.wordNow',
  '*.feltVsObserved',
  '*.userId',
  '*.user_id',
  '*.email',
  '*.token',
  '*.tokenHash',
  '*.token_hash',
  '*.note',
  '*.falsify',
];

export function loggerOptions(): LoggerOptions {
  const c = config();
  return {
    level: c.NODE_ENV === 'test' ? 'silent' : c.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: { paths: REDACT_PATHS, remove: true },
    base: { service: 'ledger-api' },
    // Never serialize full request/response objects.
    serializers: {
      req: (req: { id?: string; method?: string; url?: string }) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      err: pino.stdSerializers.err,
    },
  };
}

let root: Logger | undefined;
export function logger(): Logger {
  if (!root) root = pino(loggerOptions());
  return root;
}

/** Test hook: build a logger that writes to a sink you control. */
export function loggerTo(stream: NodeJS.WritableStream, level = 'trace'): Logger {
  return pino({ ...loggerOptions(), level }, stream);
}
