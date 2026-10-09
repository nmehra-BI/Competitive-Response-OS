// ESLint flat config for the Growth OS monorepo.
// Boundary rules here enforce the modular-monolith layout (see decisions.md D-008).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** Pure packages stay pure: no database, no HTTP, no provider SDKs. */
const purePaths = [
  { name: 'pg', message: 'contracts/domain are pure. Use packages/db from apps.' },
  { name: 'kysely', message: 'contracts/domain are pure. Use packages/db from apps.' },
  { name: 'fastify', message: 'contracts/domain are pure.' },
  { name: '@anthropic-ai/sdk', message: 'Provider SDKs live in packages/ai only.' },
];
/** Growth OS shared primitives (./platform folders) must never import Market Expansion (./me) code. */
const noAppImports = [
  { group: ['**/me/**', '**/me'], message: 'Growth OS platform code must not import app (me) modules.' },
];

const purePackages = {
  files: ['packages/contracts/src/**/*.ts', 'packages/domain/src/**/*.ts'],
  rules: { 'no-restricted-imports': ['error', { paths: purePaths }] },
};
const pureAndPlatform = {
  files: ['packages/domain/src/platform/**/*.ts'],
  rules: { 'no-restricted-imports': ['error', { paths: purePaths, patterns: noAppImports }] },
};
const platformMustNotImportApp = {
  files: ['apps/*/src/platform/**/*.ts', 'packages/connectors/src/**/*.ts'],
  rules: { 'no-restricted-imports': ['error', { patterns: noAppImports }] },
};

/** The agent package must not reach write paths. */
const aiHasNoWritePaths = {
  files: ['packages/ai/src/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          { name: '@growth-os/connectors', message: 'The analysis agent has no write tools (D-019).' },
          {
            name: '@growth-os/db',
            message: 'The analysis agent reads through the tool gateway only (D-019).',
          },
        ],
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'design/**',
      'docs/**',
      'packages/db/src/generated/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['scripts/**', '**/scripts/**', '**/*.config.{js,ts}', 'packages/db/src/cli/**'],
    rules: { 'no-console': 'off' },
  },
  purePackages,
  pureAndPlatform,
  platformMustNotImportApp,
  aiHasNoWritePaths,
  prettier,
);
