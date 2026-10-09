import { defineConfig } from 'vitest/config';

// Unit tests run without a database. Database-backed suites live in packages/db/test, apps/api/test/db
// and co-located `*.db.test.ts` files, and run with `pnpm test:db` (requires `pnpm db:up && pnpm db:migrate`).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'packages/*/src/**/*.test.ts',
            'packages/*/test/unit/**/*.test.ts',
            'apps/*/src/**/*.test.ts',
            'fixtures/*/src/**/*.test.ts',
            'fixtures/*/test/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/*.db.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          include: [
            'packages/db/test/**/*.test.ts',
            'apps/api/test/db/**/*.test.ts',
            'apps/*/src/**/*.db.test.ts',
          ],
          environment: 'node',
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 20000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
