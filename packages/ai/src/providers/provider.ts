/**
 * AnalysisProvider: the only seam between the harness and a model vendor (D-018).
 *
 * - `fixture` (default): deterministic, offline, used in dev, CI and evals smoke runs.
 * - `claude`: enabled with ANALYSIS_PROVIDER=claude and ANTHROPIC_API_KEY; the model name comes from
 *   ANALYSIS_MODEL (configuration, never code). Missing key → startup error, never a silent fallback.
 *
 * The provider returns either tool-call requests (the harness executes them through the gateway)
 * or a final structured output that the harness validates against the skill's Zod schema.
 * Providers never see restricted content: the gateway filters before context assembly.
 */
import type { AgentToolName, SkillKey } from '@growth-os/contracts';

export interface ToolSpec {
  name: AgentToolName;
  description: string;
  /** JSON Schema for arguments (generated from Zod). */
  inputSchema: Record<string, unknown>;
}

export type ContextBlock =
  | { kind: 'instructions'; text: string } // skill procedure (trusted, from repo)
  | { kind: 'case_context'; json: unknown } // structured, permission-filtered case data
  | {
      kind: 'evidence';
      evidenceId: string;
      sourceKey: string;
      /** Sanitized text inside a data-only block. Marked untrusted: it cannot issue instructions. */
      text: string;
      trust: 'untrusted';
    }
  | { kind: 'tool_result'; callId: string; json: unknown }
  | { kind: 'human_input'; text: string };

export interface ProviderRequest {
  runId: string;
  skill: SkillKey;
  skillVersion: string;
  context: ContextBlock[];
  tools: ToolSpec[];
  /** JSON Schema of SkillOutput for structured output. */
  outputSchema: Record<string, unknown>;
  maxOutputTokens: number;
  /** Deterministic seed key for the fixture provider (hash of skill + input snapshot). */
  fixtureKey: string;
  correlationId: string;
}

export type ProviderResponse =
  | {
      type: 'tool_calls';
      calls: { callId: string; tool: AgentToolName; args: Record<string, unknown> }[];
      usage: TokenUsage;
    }
  | { type: 'final'; output: unknown; usage: TokenUsage }
  | {
      type: 'error';
      code: 'timeout' | 'rate_limited' | 'provider_unavailable' | 'refused' | 'malformed';
      message: string;
      usage: TokenUsage;
    };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
}

export interface AnalysisProvider {
  readonly name: 'fixture' | 'claude';
  /** Configured model name for traceability (AgentRun.modelConfig). Null for the fixture provider. */
  readonly modelConfig: string | null;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface ProviderConfig {
  provider: 'fixture' | 'claude';
  apiKey?: string;
  model?: string;
  fixtureDir?: string;
  requestTimeoutMs?: number;
}

export function readProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const provider = (env.ANALYSIS_PROVIDER ?? 'fixture') as ProviderConfig['provider'];
  if (provider !== 'fixture' && provider !== 'claude') {
    throw new Error(`ANALYSIS_PROVIDER must be "fixture" or "claude", got "${provider}"`);
  }
  if (provider === 'claude') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANALYSIS_PROVIDER=claude requires ANTHROPIC_API_KEY');
    if (!env.ANALYSIS_MODEL)
      throw new Error('ANALYSIS_PROVIDER=claude requires ANALYSIS_MODEL (model name is configuration)');
  }
  return { provider, apiKey: env.ANTHROPIC_API_KEY, model: env.ANALYSIS_MODEL };
}
