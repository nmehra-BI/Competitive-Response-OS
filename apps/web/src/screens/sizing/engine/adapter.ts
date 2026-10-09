/**
 * Thin adapter over the deterministic sizing engine. Screens and mocks import the engine ONLY from
 * here. Since Wave 2 integration it re-exports the WS2 engine from `@growth-os/domain` (the same
 * code the API and the seed run, D-063); `engine.test.ts` keeps proving the golden fixture values
 * and the WS2 input hashes.
 */
import {
  createSizingEngine,
  SIZING_ENGINE_VERSION,
  lineageView,
  mergeLineage,
  usedByTransitive,
} from '@growth-os/domain';

export { SIZING_ENGINE_VERSION, lineageView, mergeLineage, usedByTransitive };
export type { LineageView } from '@growth-os/domain';

/** The sizing engine (pure; same input → same output and input hash). */
export const sizingEngine = createSizingEngine();
