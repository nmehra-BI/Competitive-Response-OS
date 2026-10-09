import { defineConfig } from 'vitest/config';

// Unit tests run without a database. Database-backed suites live in packages/db/test and
// apps/api/test/db and run with `pnpm test:db` (requires `pnpm db:up && pnpm db:migrate`).
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
            // Component and hook tests (jsdom via a `// @vitest-environment jsdom` docblock per file).
            'packages/*/src/**/*.test.tsx',
            'apps/*/src/**/*.test.tsx',
            'fixtures/*/src/**/*.test.ts',
            'fixtures/*/test/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          include: ['packages/db/test/**/*.test.ts', 'apps/api/test/db/**/*.test.ts'],
          environment: 'node',
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
