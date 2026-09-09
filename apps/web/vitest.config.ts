/**
 * Separate from vite.config.ts on purpose. `vitest/config` resolves the
 * workspace-root vite while the app resolves its own, and mixing the two
 * makes structurally identical Plugin types unassignable under
 * exactOptionalPropertyTypes. Tests need no plugins — only the `@` alias.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': path.resolve(here, 'src') } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
  },
});
