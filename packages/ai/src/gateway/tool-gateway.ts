/**
 * Tenant-aware tool gateway (PRD §8). The ONLY way the agent touches data. Every call checks:
 *   1. tenant: the run's tenant context;
 *   2. identity: the requesting human's access (the agent never has more access than that person);
 *   3. entitlement: licence access for any source content (restricted → denied, "not summarised");
 *   4. schema: args validated with Zod; unknown tool names rejected (no write tools exist here);
 *   5. budget: tool-call count, wall time and cost left in the run budget.
 * Each call writes a ToolCallRecord (args redacted, hashes only) and returns structured data.
 * Tool errors surface as errors, never as synthetic evidence.
 *
 * Deliberately absent (PRD §8 lists them as illustrative): workflow.request_gate,
 * work.create_approved_tasks, outcomes.record. The agent may only *propose* these; a human
 * command performs them.
 */
import type { AgentToolName, ToolCallRecord } from '@growth-os/contracts';

export interface RunScope {
  tenantId: string;
  runId: string;
  caseId: string | null;
  /** The human the run acts for. Tools apply this user's access, never broader. */
  requestedByUserId: string;
  correlationId: string;
}

export type ToolResult =
  | { ok: true; data: unknown; summary: string; evidenceIds: string[] }
  | {
      ok: false;
      code:
        'denied' | 'not_found' | 'schema_invalid' | 'budget_exhausted' | 'connector_unavailable' | 'error';
      summary: string;
    };

export interface ToolHandler {
  name: AgentToolName;
  version: string;
  /** Read-only. Implementations live in apps/worker and call domain queries with RLS + policy. */
  run(scope: RunScope, args: unknown): Promise<ToolResult>;
}

export interface ToolGateway {
  list(): { name: AgentToolName; version: string }[];
  call(
    scope: RunScope,
    tool: string,
    args: unknown,
  ): Promise<{ result: ToolResult; record: Omit<ToolCallRecord, 'id' | 'createdAt'> }>;
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

/** TODO(WS5): implement with a handler registry, Zod arg schemas and budget accounting. */
export function createToolGateway(_handlers: readonly ToolHandler[]): ToolGateway {
  return {
    list: () => AGENT_TOOLS.map((t) => ({ name: t.name, version: '1' })),
    call: async () => {
      throw new Error('TODO(WS5): ToolGateway.call');
    },
  };
}
