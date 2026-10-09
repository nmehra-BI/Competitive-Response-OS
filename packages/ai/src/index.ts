/**
 * @growth-os/ai — the bounded analysis agent. It has NO write tools and no database access:
 * lint forbids importing @growth-os/db and @growth-os/connectors here (D-019). Database-backed tool
 * handlers and the run store live in apps/worker/src/jobs/analysis and are injected.
 */
export * from './providers/provider';
export * from './providers/fixture-provider';
export * from './providers/claude-provider';
export * from './gateway/tool-gateway';
export * from './gateway/untrusted';
export * from './harness/harness';
export * from './harness/checks';
export * from './harness/memory-store';
export * from './skills/loader';
export * from './util/hash';

import { createClaudeProvider } from './providers/claude-provider';
import {
  createFileFixtureSource,
  createFixtureProvider,
  type FixtureSource,
} from './providers/fixture-provider';
import { readProviderConfig, type AnalysisProvider } from './providers/provider';
import { defaultSkillsDir } from './skills/loader';

/**
 * Select the provider from environment. Default: the deterministic fixture provider. A Claude
 * configuration without key or model throws (never a silent fallback to fixtures, D-018).
 */
export function providerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fixtures: FixtureSource = createFileFixtureSource(defaultSkillsDir(env)),
): AnalysisProvider {
  const cfg = readProviderConfig(env);
  return cfg.provider === 'claude' ? createClaudeProvider(cfg) : createFixtureProvider(fixtures);
}
