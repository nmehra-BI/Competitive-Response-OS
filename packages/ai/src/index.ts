/**
 * @growth-os/ai — the bounded analysis agent. It has NO write tools and no database access:
 * lint forbids importing @growth-os/db and @growth-os/connectors here (D-019).
 */
export * from './providers/provider';
export * from './providers/fixture-provider';
export * from './providers/claude-provider';
export * from './gateway/tool-gateway';
export * from './harness/harness';

import { createClaudeProvider } from './providers/claude-provider';
import { createFixtureProvider, type FixtureSource } from './providers/fixture-provider';
import { readProviderConfig, type AnalysisProvider } from './providers/provider';

/** Select the provider from environment. Default: deterministic fixture provider. */
export function providerFromEnv(
  fixtures: FixtureSource,
  env: NodeJS.ProcessEnv = process.env,
): AnalysisProvider {
  const cfg = readProviderConfig(env);
  return cfg.provider === 'claude' ? createClaudeProvider(cfg) : createFixtureProvider(fixtures);
}
