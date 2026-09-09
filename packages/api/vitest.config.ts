import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 60000,
    /*
     * These files share one database, and several of them TRUNCATE it between
     * tests. Run in parallel, a sync in one file holds row locks while another
     * file's beforeEach asks for the AccessExclusiveLock that TRUNCATE needs,
     * and Postgres kills one of them:
     *
     *   error: deadlock detected (40P01)
     *     Process 197 waits for AccessExclusiveLock … blocked by process 196.
     *     Process 196 waits for RowExclusiveLock … blocked by process 197.
     *     ❯ truncateAll test/helpers.ts
     *
     * Serialising the files removes the race outright. The suite is a few
     * seconds either way, so isolation is worth more here than concurrency.
     */
    fileParallelism: false,
  },
});
