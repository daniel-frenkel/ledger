import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // Under CI only, also emit the JSON report that scripts/check-skips.mjs
    // reads. A skipped test is a test that is not running, and the summary
    // line hides that; the skip count is asserted against test-skips.json.
    ...(process.env.CI
      ? { reporters: ['default', 'json'] as const, outputFile: { json: './.vitest-results.json' } }
      : {}),
  },
});
