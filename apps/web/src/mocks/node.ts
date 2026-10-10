/** MSW server for Vitest: hooks, shell and screen tests run against the same mocks as the browser. */
import { setupServer } from 'msw/node';
import { allHandlers } from './handlers';

export const mockServer = setupServer(...allHandlers());
export { resetMockState, session, setScenario, state } from './state';
export { resetReplay } from './define';
