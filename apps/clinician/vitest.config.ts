import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': here } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Under CI only, also emit the JSON report that scripts/check-skips.mjs
    // reads. A skipped test is a test that is not running, and the summary
    // line hides that; the skip count is asserted against test-skips.json.
    ...(process.env.CI
      ? { reporters: ['default', 'json'] as const, outputFile: { json: './.vitest-results.json' } }
      : {}),
  },
});
