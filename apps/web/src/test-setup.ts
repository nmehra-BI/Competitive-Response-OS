/**
 * Vitest setup for the unit project. jsdom component tests render lazy screens against MSW; on a
 * loaded CI machine the first render can take longer than Testing Library's 1 s default for
 * `findBy*` / `waitFor`. A 5 s budget changes no assertion, only how long a query may wait.
 */
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 5000 });
}

export {};
