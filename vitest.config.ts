import { defineConfig } from 'vitest/config';

/**
 * Two projects with different characteristics:
 *
 * - `unit` exercises pure logic — argument parsing, identifier quoting,
 *   redaction, formatting — with no database and no filesystem beyond
 *   temporary directories. It is fast and may run in parallel.
 * - `integration` talks to a real PostgreSQL server. One disposable cluster
 *   is created for the whole run by the global setup, and the files run one
 *   at a time so that two of them cannot disagree about the fixture.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/helpers/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
