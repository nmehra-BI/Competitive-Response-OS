/**
 * AnalysisProvider: the only seam between the harness and a model vendor (D-018).
 *
 * - `fixture` (default): deterministic, offline, used in dev, CI and evals smoke runs.
 * - `claude`: enabled with ANALYSIS_PROVIDER=claude and ANTHROPIC_API_KEY; the model name comes from
 *   ANALYSIS_MODEL (configuration, never code). Missing key → startup error, never a silent fallback.
 *
 * The provider returns tool-call requests (the harness executes them through the gateway), a question
 * for the requester, or a final structured output that the harness validates against the skill schema.
 * Providers never see restricted content: the gateway filters before context assembly. The request is
 * rebuilt from persisted context blocks on every turn, so a provider keeps no hidden state between
 * turns and a run resumes after a crash from its checkpoint alone.
 */
import type { AgentToolName, SkillKey } from '@growth-os/contracts';

export interface ToolSpec {
  name: AgentToolName;
  description: string;
  /** JSON Schema for arguments (generated from Zod). */
  inputSchema: Record<string, unknown>;
}

export interface ProviderToolCall {
  callId: string;
  /** Requested tool name. Not trusted: the gateway rejects anything outside the allowlist. */
  tool: string;
  args: Record<string, unknown>;
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
      /** The tool call that returned this passage. */
      callId?: string;
    }
  | { kind: 'assistant_tool_calls'; calls: ProviderToolCall[] }
  | { kind: 'tool_result'; callId: string; tool: string; ok: boolean; json: unknown }
  | { kind: 'human_input'; question: string; text: string }
  | { kind: 'repair'; errors: string[] }
  | { kind: 'notice'; text: string };

export interface ProviderRequest {
  runId: string;
  skill: SkillKey;
  skillVersion: string;
  /** Number of provider calls already completed in this run (persisted in the checkpoint). */
  turn: number;
  context: ContextBlock[];
  tools: ToolSpec[];
  /** JSON Schema of SkillOutput for structured output. */
  outputSchema: Record<string, unknown>;
  maxOutputTokens: number;
  /** Fixture script name for the fixture provider ("default" unless the run's focus names one). */
  fixtureKey: string;
  correlationId: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
}

export type ProviderErrorCode = 'timeout' | 'rate_limited' | 'provider_unavailable' | 'refused' | 'malformed';

export type ProviderResponse =
  | { type: 'tool_calls'; calls: ProviderToolCall[]; usage: TokenUsage }
  | { type: 'final'; output: unknown; usage: TokenUsage }
  | { type: 'needs_input'; question: string; options: string[]; usage: TokenUsage }
  | { type: 'error'; code: ProviderErrorCode; message: string; usage: TokenUsage };

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

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, costMicros: 0 };

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
  const timeout = env.ANALYSIS_REQUEST_TIMEOUT_MS ? Number(env.ANALYSIS_REQUEST_TIMEOUT_MS) : undefined;
  return {
    provider,
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANALYSIS_MODEL,
    requestTimeoutMs: timeout && Number.isFinite(timeout) ? timeout : undefined,
  };
}
