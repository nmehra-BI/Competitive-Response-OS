/**
 * Tenant-aware tool gateway (PRD §8, ARCHITECTURE §12.3). The ONLY way the agent touches data.
 * Every call is checked, in this order, and each check is recorded on the ToolCallRecord:
 *   1. allowlist: the tool exists (there are no write tools) and the skill allows it;
 *   2. budget:    tool calls left and wall time left in the run budget;
 *   3. tenant + identity: the run belongs to this tenant and still acts for its requesting human,
 *                 who can still read the run's case or mandate (the agent never has more access);
 *   4. schema:    args validated with the tool's strict Zod schema;
 *   5. entitlement: the handler applies licence + run scope to any source content it returns
 *                 (restricted → "denied · not summarised": no excerpt, summary or count).
 * Args are stored redacted (ids, keys, numbers and booleans only) with a SHA-256 of the full args.
 * Tool errors surface as errors, never as synthetic evidence. Source text never goes into `data`:
 * handlers return it as `untrusted` passages, which the harness wraps as data-only blocks.
 *
 * Deliberately absent (PRD §8 lists them as illustrative): workflow.request_gate,
 * work.create_approved_tasks, outcomes.record. The agent may only *propose* these; a human
 * command performs them.
 */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  AgentToolName,
  CountryCode,
  DisplayKey,
  EconomicsInput,
  Id,
  SizingInput,
  type ToolCallRecord,
} from '@growth-os/contracts';
import { hashOf } from '../util/hash';
import type { ToolSpec } from '../providers/provider';

export interface RunScope {
  tenantId: string;
  runId: string;
  caseId: string | null;
  mandateId: string | null;
  /** The human the run acts for. Tools apply this user's access, never broader. */
  requestedByUserId: string;
  correlationId: string;
}

/** A permitted passage returned by a tool. The text is untrusted data. */
export interface UntrustedPassage {
  evidenceId: string;
  sourceId: string;
  sourceKey: string;
  text: string;
}

export type ToolErrorCode =
  | 'denied'
  | 'not_found'
  | 'schema_invalid'
  | 'budget_exhausted'
  | 'connector_unavailable'
  | 'unknown_tool'
  | 'not_allowed'
  | 'error';

export type ToolResult =
  | {
      ok: true;
      /** Structured, permission-filtered data (ids, keys, metadata, engine outputs). No source text. */
      data: unknown;
      summary: string;
      /** Source and passage ids returned to this run (the only ids a proposal may cite). */
      evidenceIds: string[];
      untrusted?: UntrustedPassage[];
      /** null when no licensed content was involved; false when something was withheld. */
      entitlement?: boolean | null;
    }
  | { ok: false; code: ToolErrorCode; summary: string; entitlement?: boolean | null };

export interface ToolHandler {
  name: AgentToolName;
  version: string;
  /** Read-only. Implementations live in apps/worker and query under RLS with the requester's access. */
  run(scope: RunScope, args: unknown): Promise<ToolResult>;
}

/** Checks the run's tenant and the requesting human (DB-backed, injected by the worker). */
export interface ScopeChecker {
  check(scope: RunScope): Promise<{ tenant: boolean; identity: boolean; reason?: string }>;
}

export interface CallBudget {
  toolCallsLeft: number;
  /** Epoch ms after which no more calls are made. */
  deadlineMs: number;
}

export type GatewayRecord = Omit<ToolCallRecord, 'id' | 'createdAt'>;

export interface ToolGateway {
  list(): { name: AgentToolName; version: string }[];
  specs(allowed: readonly string[]): ToolSpec[];
  call(
    scope: RunScope,
    tool: string,
    args: unknown,
    opts: { allowedTools: readonly string[]; budget: CallBudget },
  ): Promise<{ result: ToolResult; record: GatewayRecord | null }>;
}

/** Tool catalogue for the MVP agent. All read-only or deterministic. */
export const AGENT_TOOLS: readonly { name: AgentToolName; purpose: string }[] = [
  {
    name: 'intelligence.search',
    purpose:
      'Search permitted, licensed evidence and uploads. Restricted sources are excluded before ranking.',
  },
  {
    name: 'evidence.get',
    purpose: 'Get permitted excerpts for an evidence id. Restricted → denied, not summarised.',
  },
  { name: 'portfolio.get_product', purpose: 'Read the tenant product catalogue entry.' },
  {
    name: 'crm.get_authorized_accounts',
    purpose: 'Authorized account aggregates. Unavailable in MVP (CRM not connected) → connector_unavailable.',
  },
  {
    name: 'sizing.calculate',
    purpose: 'Run the deterministic sizing engine on proposed inputs. Writes nothing.',
  },
  {
    name: 'economics.calculate',
    purpose: 'Run the deterministic economics engine on proposed inputs. Writes nothing.',
  },
  { name: 'work.preview_tasks', purpose: 'Dry-run preview of task fields for a draft plan. Writes nothing.' },
];

/** Strict argument schemas: unknown keys are refused. */
export const TOOL_ARGS = {
  'intelligence.search': z
    .object({
      query: z.string().min(1).max(300),
      /** Which connection to search: licensed market data (default) or the trade registry. */
      connection: z.enum(['market_data', 'trade_registry']).default('market_data'),
      limit: z.number().int().min(1).max(20).default(10),
    })
    .strict(),
  'evidence.get': z
    .object({ sourceId: Id.optional(), sourceKey: DisplayKey.optional() })
    .strict()
    .refine((a) => Boolean(a.sourceId) !== Boolean(a.sourceKey), 'Give exactly one of sourceId or sourceKey'),
  'portfolio.get_product': z.object({ productId: Id.optional() }).strict(),
  'crm.get_authorized_accounts': z
    .object({ segmentId: Id.optional(), countryCode: CountryCode.optional() })
    .strict(),
  'sizing.calculate': SizingInput,
  'economics.calculate': EconomicsInput,
  'work.preview_tasks': z
    .object({
      tasks: z
        .array(
          z
            .object({
              title: z.string().min(1).max(200),
              function: z.string().min(1).max(80),
              ownerId: Id.nullable(),
              dueOffsetDays: z.number().int().nullable(),
              dependsOnTitles: z.array(z.string()).default([]),
            })
            .strict(),
        )
        .min(1)
        .max(50),
    })
    .strict(),
} satisfies Record<AgentToolName, z.ZodTypeAny>;

export type ToolArgs<N extends AgentToolName> = z.output<(typeof TOOL_ARGS)[N]>;

const KEEP_STRING =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Z]{1,5}(-[A-Z0-9]{1,6})+|[A-Z]{2,3}|-?\d+(\.\d+)?)$/i;

/** Keep ids, display keys, codes, numbers and booleans; replace free text with its length. */
export function redactArgs(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[redacted]';
  if (typeof value === 'string') return KEEP_STRING.test(value) ? value : `[text:${value.length}]`;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactArgs(v, depth + 1));
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactArgs(v, depth + 1)]),
    );
  return '[redacted]';
}

const isAgentTool = (name: string): name is AgentToolName => AgentToolName.safeParse(name).success;

export function createToolGateway(
  handlers: readonly ToolHandler[],
  deps: { scope: ScopeChecker; now?: () => number },
): ToolGateway {
  const now = deps.now ?? (() => Date.now());
  const byName = new Map(handlers.map((h) => [h.name, h]));
  return {
    list: () => AGENT_TOOLS.map((t) => ({ name: t.name, version: byName.get(t.name)?.version ?? '1' })),

    specs: (allowed) =>
      AGENT_TOOLS.filter((t) => allowed.includes(t.name)).map((t) => ({
        name: t.name,
        description: t.purpose,
        inputSchema: zodToJsonSchema(TOOL_ARGS[t.name], { target: 'jsonSchema7' }) as Record<string, unknown>,
      })),

    async call(scope, tool, args, { allowedTools, budget }) {
      const started = now();
      // 1. Allowlist. A name outside the catalogue cannot be recorded as a tool call at all.
      if (!isAgentTool(tool))
        return {
          result: { ok: false, code: 'unknown_tool', summary: 'refused · not an available tool' },
          record: null,
        };
      const handler = byName.get(tool);
      const record = (
        outcome: GatewayRecord['outcome'],
        summary: string,
        check: Partial<GatewayRecord['scopeCheck']>,
      ): GatewayRecord => ({
        runId: scope.runId,
        tool,
        toolVersion: handler?.version ?? '1',
        argsHash: hashOf(args ?? null),
        argsRedacted: (redactArgs(args ?? {}) ?? {}) as Record<string, unknown>,
        scopeCheck: { tenant: false, entitlement: null, schema: false, budget: false, ...check },
        outcome,
        resultSummary: summary,
        latencyMs: Math.max(0, Math.round(now() - started)),
      });
      const fail = (
        code: ToolErrorCode,
        summary: string,
        check: Partial<GatewayRecord['scopeCheck']>,
        outcome: GatewayRecord['outcome'] = 'denied',
      ) => ({ result: { ok: false as const, code, summary }, record: record(outcome, summary, check) });

      if (!allowedTools.includes(tool) || !handler)
        return fail('not_allowed', 'refused · tool not allowed for this skill', {});
      // 2. Budget.
      if (budget.toolCallsLeft <= 0 || now() >= budget.deadlineMs)
        return fail('budget_exhausted', 'refused · analysis budget used up', {});
      // 3. Tenant and identity.
      const s = await deps.scope.check(scope);
      if (!s.tenant || !s.identity)
        return fail('denied', `refused · ${s.reason ?? 'access check failed'}`, {
          tenant: s.tenant,
          budget: true,
        });
      // 4. Schema.
      const parsed = TOOL_ARGS[tool].safeParse(args);
      if (!parsed.success)
        return fail(
          'schema_invalid',
          `refused · invalid arguments (${parsed.error.issues.length} issue${parsed.error.issues.length === 1 ? '' : 's'})`,
          { tenant: true, budget: true },
          'error',
        );
      // 5. Run (the handler applies entitlements to content).
      // A thrown error is not a tool result: it propagates, and the run resumes from its checkpoint.
      const result = await handler.run(scope, parsed.data);
      const outcome: GatewayRecord['outcome'] = result.ok
        ? 'ok'
        : result.code === 'denied' || result.code === 'not_found'
          ? 'denied'
          : 'error';
      return {
        result,
        record: record(outcome, result.summary, {
          tenant: true,
          schema: true,
          budget: true,
          entitlement: result.entitlement ?? null,
        }),
      };
    },
  };
}
