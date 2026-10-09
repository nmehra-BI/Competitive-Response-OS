/**
 * Thin adapter over the deterministic sizing engine. Screens and mocks import the engine ONLY from
 * here, so switching to the shared domain package is a one-file change.
 *
 * Today: the WS2 engine is not merged yet, so this folder carries a verbatim port of it.
 * Swap when `@growth-os/domain` ships the engines (WS2 merged):
 *   1. add `@growth-os/domain` to apps/web dependencies;
 *   2. replace the two imports below with
 *        import { createSizingEngine, SIZING_ENGINE_VERSION, lineageView, mergeLineage,
 *                 usedByTransitive } from '@growth-os/domain';
 *   3. delete numeric.ts, checks.ts, lineage.ts, canonical.ts and sizing.ts in this folder.
 * `engine.test.ts` keeps proving the golden fixture values either way.
 */
import { createSizingEngine, SIZING_ENGINE_VERSION } from './sizing';
import { lineageView, mergeLineage, usedByTransitive } from './lineage';

export { SIZING_ENGINE_VERSION, lineageView, mergeLineage, usedByTransitive };
export type { LineageView } from './lineage';

/** The sizing engine (pure; same input → same output and input hash). */
export const sizingEngine = createSizingEngine();
