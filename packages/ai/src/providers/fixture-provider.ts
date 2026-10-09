/**
 * Deterministic fixture provider (default). Replays scripted responses from
 * skills/<skill>/fixtures/<fixtureKey>.json, falling back to skills/<skill>/fixtures/default.json.
 *
 * A fixture file is a list of turns: each turn is either tool calls or a final output. The provider
 * returns turn i on call i for a run. Missing fixture → `error: provider_unavailable` (an error,
 * never synthetic evidence). Special fixtures exercise failure paths: `malformed.json` (schema
 * violation), `injection.json` (attempts to call a non-existent write tool), `timeout.json`.
 */
import type { AnalysisProvider, ProviderRequest, ProviderResponse } from './provider';

export interface FixtureTurn {
  type: 'tool_calls' | 'final' | 'error';
  calls?: { callId: string; tool: string; args: Record<string, unknown> }[];
  output?: unknown;
  code?: string;
  message?: string;
}

export interface FixtureSource {
  load(skill: string, fixtureKey: string): Promise<FixtureTurn[] | null>;
}

export function createFixtureProvider(_source: FixtureSource): AnalysisProvider {
  return {
    name: 'fixture',
    modelConfig: null,
    generate: async (_req: ProviderRequest): Promise<ProviderResponse> => {
      // TODO(WS5): track the turn index per runId; return the scripted turn with zero cost usage.
      throw new Error('TODO(WS5): fixture provider');
    },
  };
}
