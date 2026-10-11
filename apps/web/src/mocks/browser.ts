/**
 * Browser mock worker. Started from main.tsx when `VITE_MSW=on` (see `pnpm --filter
 * @growth-os/web dev:mock`). Exposes `window.__growthOsMocks` for switching variants by hand:
 *   __growthOsMocks.setScenario({ g2Stale: true }); __growthOsMocks.reset();
 */
import { setupWorker } from 'msw/browser';
import { allHandlers } from './handlers';
import { resetMockState, setScenario, state } from './state';

export async function startMockWorker(): Promise<void> {
  const worker = setupWorker(...allHandlers());
  (window as unknown as { __growthOsMocks: unknown }).__growthOsMocks = {
    state,
    setScenario,
    reset: resetMockState,
  };
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    quiet: true,
  });
}
