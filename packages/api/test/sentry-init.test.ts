/**
 * That Sentry actually initialises, and that the scrubber is wired into it.
 *
 * SENTRY_DSN is empty everywhere — locally, in CI, and in the .env this repo
 * ships — so initSentry() returns false and nothing in the rest of the suite
 * ever runs Sentry's init path. That is exactly the path a major version bump
 * breaks, and it would break silently: the first anyone would know is the day
 * a DSN gets set in production.
 *
 * So: a syntactically valid DSN pointing nowhere, one init, and a check that
 * the client Sentry built is holding our beforeSend. No event is captured and
 * tracesSampleRate is 0, so nothing is sent.
 *
 * This file sets process.env before importing config, and config() caches on
 * first call — it relies on vitest giving each test file its own module
 * registry.
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/node';

// A well-formed DSN for a project that does not exist, on a host that does not
// resolve. Set before the config module is imported.
process.env['SENTRY_DSN'] = 'https://0123456789abcdef0123456789abcdef@o0.ingest.invalid/0';

const { initSentry, scrubEvent, REDACTED } = await import('../src/plugins/sentry.js');

afterAll(async () => {
  await Sentry.close(0);
  delete process.env['SENTRY_DSN'];
});

describe('initSentry with a DSN present', () => {
  it('initialises and reports that it did', () => {
    expect(initSentry()).toBe(true);
    expect(Sentry.getClient()).toBeDefined();
  });

  it('registered our beforeSend, and it is the scrubber', () => {
    const options = Sentry.getClient()?.getOptions();
    expect(options).toBeDefined();
    expect(typeof options?.beforeSend).toBe('function');

    // Run what Sentry is actually holding, not what we think we passed.
    const scrubbed = options?.beforeSend?.(
      { message: 'ZQX-INIT-9101 telling the sergeant I froze', extra: { a: 'ZQX-INIT-9102' } } as never,
      {},
    );
    expect(JSON.stringify(scrubbed)).not.toMatch(/ZQX-/);
    expect((scrubbed as { message?: string } | null)?.message).toBe(REDACTED);
  });

  it('registered a beforeBreadcrumb that strips content at capture', () => {
    const options = Sentry.getClient()?.getOptions();
    expect(typeof options?.beforeBreadcrumb).toBe('function');
    const crumb = options?.beforeBreadcrumb?.(
      { category: 'http', level: 'info', message: 'ZQX-INIT-9103', data: { body: 'ZQX-INIT-9104' } } as never,
      {},
    );
    expect(JSON.stringify(crumb)).not.toMatch(/ZQX-/);
    expect(crumb).toMatchObject({ category: 'http', level: 'info' });
  });

  it('sends no traces and no default PII', () => {
    const options = Sentry.getClient()?.getOptions();
    expect(options?.tracesSampleRate).toBe(0);
    expect(options?.sendDefaultPii).toBe(false);
  });

  it('still exports the scrubber as a pure function', () => {
    expect(scrubEvent({ message: 'ZQX-INIT-9105' })).toEqual({ message: REDACTED });
  });
});
