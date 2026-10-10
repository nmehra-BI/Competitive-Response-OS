/**
 * Claude API provider (official Anthropic TypeScript SDK). Enabled only by ANALYSIS_PROVIDER=claude.
 * The model name is read from ANALYSIS_MODEL; no model identifier appears anywhere in code.
 *
 * Mapping (rebuilt from persisted context blocks on every turn; the provider keeps no state):
 *  - instructions → `system`, followed by the untrusted-data rule and the output protocol;
 *  - case context → first user message (structured JSON, permission-filtered);
 *  - assistant tool calls → assistant `tool_use` blocks; results → user `tool_result` blocks, with
 *    each permitted passage inside an `<evidence … trust="untrusted">` data block (escaped);
 *  - human answers, repair requests and notices → user text.
 * The final output arrives through the `submit_output` tool (input schema = SkillOutput) and a question
 * for the requester through `ask_requester`; the harness validates both. Tool names are mapped to
 * API-safe names (`evidence.get` ↔ `evidence_get`). Only token counts and costs leave this module;
 * prompt text is never logged (traces store ids and hashes). Zero data retention is an account
 * setting (D-018) and is not requested per call.
 */
import Anthropic from '@anthropic-ai/sdk';
import { UNTRUSTED_RULE, wrapUntrusted } from '../gateway/untrusted';
import {
  ZERO_USAGE,
  type AnalysisProvider,
  type ContextBlock,
  type ProviderConfig,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderToolCall,
  type TokenUsage,
} from './provider';

export const SUBMIT_OUTPUT_TOOL = 'submit_output';
export const ASK_REQUESTER_TOOL = 'ask_requester';

const OUTPUT_PROTOCOL =
  'Use the read-only tools to gather permitted evidence and to compute every number with the engines. ' +
  `When you are done, call ${SUBMIT_OUTPUT_TOOL} exactly once with the complete output. If you need a ` +
  `decision from the person who asked, call ${ASK_REQUESTER_TOOL}. Cite only evidence ids returned to ` +
  'you in this conversation; label anything else as an assumption or unknown. Do not give confidence ' +
  'scores. You cannot approve, decide, sign or record outcomes: everything you return is a proposal.';

export const apiToolName = (name: string) => name.replace(/\./g, '_');

/** The subset of the SDK client the provider uses (injectable for tests). */
export interface MessagesClient {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: { timeout?: number },
    ): Promise<Anthropic.Message>;
  };
}

export interface ClaudeProviderOptions {
  client?: MessagesClient;
  /** Price per million tokens in micro-units of the billing currency (configuration). */
  inputMicrosPerMTok?: number;
  outputMicrosPerMTok?: number;
}

function inputSchema(schema: Record<string, unknown>): Anthropic.Tool.InputSchema {
  const { $schema: _ignored, ...rest } = schema;
  return { type: 'object', ...rest } as Anthropic.Tool.InputSchema;
}

/** Context blocks → Messages API conversation. Exported for tests. */
export function toMessages(context: readonly ContextBlock[]): {
  system: string;
  messages: Anthropic.MessageParam[];
} {
  const systemParts: string[] = [];
  const messages: Anthropic.MessageParam[] = [];
  const pushUser = (content: Anthropic.ContentBlockParam[]) => {
    const last = messages[messages.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(...content);
    else messages.push({ role: 'user', content });
  };
  const evidenceFor = (callId: string) =>
    context
      .filter(
        (b): b is Extract<ContextBlock, { kind: 'evidence' }> => b.kind === 'evidence' && b.callId === callId,
      )
      .map((b) => wrapUntrusted(b.evidenceId, b.sourceKey, b.text));

  for (const b of context) {
    switch (b.kind) {
      case 'instructions':
        systemParts.push(b.text);
        break;
      case 'case_context':
        pushUser([
          {
            type: 'text',
            text: `Case context (structured, permission-filtered):\n${JSON.stringify(b.json)}`,
          },
        ]);
        break;
      case 'assistant_tool_calls':
        messages.push({
          role: 'assistant',
          content: b.calls.map((c) => ({
            type: 'tool_use' as const,
            id: c.callId,
            name: apiToolName(c.tool),
            input: c.args,
          })),
        });
        break;
      case 'tool_result': {
        const passages = evidenceFor(b.callId);
        pushUser([
          {
            type: 'tool_result',
            tool_use_id: b.callId,
            is_error: !b.ok,
            content: [JSON.stringify(b.json), ...passages].join('\n'),
          },
        ]);
        break;
      }
      case 'evidence':
        if (!b.callId) pushUser([{ type: 'text', text: wrapUntrusted(b.evidenceId, b.sourceKey, b.text) }]);
        break;
      case 'human_input':
        pushUser([{ type: 'text', text: `The requester answered "${b.question}": ${b.text}` }]);
        break;
      case 'repair':
        pushUser([
          {
            type: 'text',
            text: `Your output did not match the schema:\n- ${b.errors.join('\n- ')}\nCall ${SUBMIT_OUTPUT_TOOL} again with a corrected output.`,
          },
        ]);
        break;
      case 'notice':
        pushUser([{ type: 'text', text: b.text }]);
        break;
    }
  }
  if (messages.length === 0) messages.push({ role: 'user', content: 'Begin.' });
  const rule = systemParts.some((p) => p.includes(UNTRUSTED_RULE)) ? [] : [UNTRUSTED_RULE];
  return { system: [...systemParts, ...rule, OUTPUT_PROTOCOL].join('\n\n'), messages };
}

function usageOf(m: Anthropic.Message, opts: ClaudeProviderOptions): TokenUsage {
  const inputTokens = m.usage?.input_tokens ?? 0;
  const outputTokens = m.usage?.output_tokens ?? 0;
  const cost =
    (inputTokens * (opts.inputMicrosPerMTok ?? 0) + outputTokens * (opts.outputMicrosPerMTok ?? 0)) /
    1_000_000;
  return { inputTokens, outputTokens, costMicros: Math.ceil(cost) };
}

function errorResponse(err: unknown): ProviderResponse {
  const r = (
    code: Extract<ProviderResponse, { type: 'error' }>['code'],
    message: string,
  ): ProviderResponse => ({
    type: 'error',
    code,
    message,
    usage: ZERO_USAGE,
  });
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return r('timeout', 'The analysis service timed out.');
  if (err instanceof Anthropic.RateLimitError) return r('rate_limited', 'The analysis service is busy.');
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return r('provider_unavailable', 'The analysis service rejected the configured credentials.');
  if (err instanceof Anthropic.BadRequestError) return r('malformed', 'The analysis request was rejected.');
  if (err instanceof Anthropic.APIError)
    return r('provider_unavailable', `The analysis service failed (${err.status ?? 'network'}).`);
  return r('provider_unavailable', 'The analysis service could not be reached.');
}

export function createClaudeProvider(
  config: ProviderConfig,
  opts: ClaudeProviderOptions = {},
): AnalysisProvider {
  if (!config.apiKey || !config.model)
    throw new Error('Claude provider needs apiKey and model from configuration');
  const model = config.model;
  const timeout = config.requestTimeoutMs ?? 120_000;
  const client: MessagesClient =
    opts.client ?? new Anthropic({ apiKey: config.apiKey, timeout, maxRetries: 2 });
  const options = {
    inputMicrosPerMTok: opts.inputMicrosPerMTok ?? Number(process.env.ANALYSIS_INPUT_MICROS_PER_MTOK ?? 0),
    outputMicrosPerMTok: opts.outputMicrosPerMTok ?? Number(process.env.ANALYSIS_OUTPUT_MICROS_PER_MTOK ?? 0),
  };

  return {
    name: 'claude',
    modelConfig: model,
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const { system, messages } = toMessages(req.context);
      const byApiName = new Map(req.tools.map((t) => [apiToolName(t.name), t.name as string]));
      const tools: Anthropic.Tool[] = [
        ...req.tools.map((t) => ({
          name: apiToolName(t.name),
          description: t.description,
          input_schema: inputSchema(t.inputSchema),
        })),
        {
          name: SUBMIT_OUTPUT_TOOL,
          description: 'Submit the final structured output (proposals for human review).',
          input_schema: inputSchema(req.outputSchema),
        },
        {
          name: ASK_REQUESTER_TOOL,
          description: 'Ask the person who requested this analysis a question you cannot answer from data.',
          input_schema: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
            },
            required: ['question'],
          },
        },
      ];
      let m: Anthropic.Message;
      try {
        m = await client.messages.create(
          { model, max_tokens: req.maxOutputTokens, system, messages, tools, tool_choice: { type: 'auto' } },
          { timeout },
        );
      } catch (err) {
        return errorResponse(err);
      }
      const usage = usageOf(m, options);
      if (m.stop_reason === 'refusal')
        return {
          type: 'error',
          code: 'refused',
          message: 'The analysis service declined this request.',
          usage,
        };
      const uses = m.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
      const calls: ProviderToolCall[] = uses
        .filter((u) => u.name !== SUBMIT_OUTPUT_TOOL && u.name !== ASK_REQUESTER_TOOL)
        .map((u) => ({
          callId: u.id,
          // Unknown names pass through unchanged; the gateway refuses them.
          tool: byApiName.get(u.name) ?? u.name,
          args: (u.input ?? {}) as Record<string, unknown>,
        }));
      if (calls.length > 0) return { type: 'tool_calls', calls, usage };
      const submit = uses.find((u) => u.name === SUBMIT_OUTPUT_TOOL);
      if (submit) return { type: 'final', output: submit.input, usage };
      const ask = uses.find((u) => u.name === ASK_REQUESTER_TOOL);
      if (ask) {
        const input = (ask.input ?? {}) as { question?: unknown; options?: unknown };
        return {
          type: 'needs_input',
          question: typeof input.question === 'string' ? input.question : 'Please clarify the request.',
          options: Array.isArray(input.options)
            ? input.options.filter((o): o is string => typeof o === 'string')
            : [],
          usage,
        };
      }
      if (m.stop_reason === 'max_tokens')
        return { type: 'error', code: 'malformed', message: 'The analysis output was cut off.', usage };
      // Text without the output tool: hand it to validation (which asks for one repair).
      const text = m.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
      let output: unknown = null;
      try {
        output = JSON.parse(text);
      } catch {
        output = null;
      }
      return { type: 'final', output, usage };
    },
  };
}
