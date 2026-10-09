/**
 * Bounded analysis harness: one agent, one skill per run, budgets, checkpoints, resume (PRD §8, §13).
 *
 * Loop (each numbered step is checkpointed in agent_run_step before the next starts):
 *   1. Load skill (skill.yaml + instructions.md + output schema); refuse unknown skill versions.
 *   2. Build context from permission-filtered case data and permitted evidence only.
 *   3. provider.generate → tool calls → gateway.call each (budget checked) → append results → repeat.
 *   4. On final output: validate against SkillOutput + skill schema. Then citation check: every
 *      evidence id cited must have been returned by evidence.get/intelligence.search in THIS run;
 *      otherwise the claim is downgraded to kind 'unknown' (never kept as evidence).
 *   5. Write Proposals (status 'proposed'). Never write business records. Never overwrite human edits:
 *      regeneration creates a new proposal that supersedes the previous pending one.
 *   6. Status: completed | partial (some steps failed or budget reached with committed proposals) |
 *      failed. Malformed output → one repair attempt with the validation errors, then failed.
 * Resume: start from last_checkpoint_seq; completed tool results are reused, not re-executed.
 * Budget exhausted → partial or failed with "Stopped — your work is saved"; calculations and
 * approvals keep working without AI (manual path is always available).
 */
import type { AnalysisRun, RunBudget, SkillKey, SkillOutput } from '@growth-os/contracts';
import type { AnalysisProvider } from '../providers/provider';
import type { RunScope, ToolGateway } from '../gateway/tool-gateway';

export interface RunStore {
  loadRun(runId: string): Promise<AnalysisRun>;
  setStatus(runId: string, status: AnalysisRun['status'], detail: string | null): Promise<void>;
  appendStep(
    runId: string,
    step: { seq: number; kind: string; status: string; summary: string; data: unknown },
  ): Promise<void>;
  saveCheckpoint(runId: string, seq: number, checkpoint: unknown): Promise<void>;
  writeProposals(runId: string, output: SkillOutput): Promise<string[]>;
  addUsage(
    runId: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      costMicros: number;
      toolCalls: number;
      elapsedMs: number;
    },
  ): Promise<void>;
}

export interface SkillBundle {
  key: SkillKey;
  version: string;
  instructions: string;
  allowedTools: string[];
  budget: Partial<RunBudget>;
  outputSchema: Record<string, unknown>;
}

export interface SkillLoader {
  load(key: SkillKey): Promise<SkillBundle>;
}

export interface AnalysisHarness {
  execute(scope: RunScope, runId: string): Promise<AnalysisRun['status']>;
}

export interface HarnessDeps {
  provider: AnalysisProvider;
  gateway: ToolGateway;
  skills: SkillLoader;
  store: RunStore;
  now: () => number;
}

/** TODO(WS5): implement the loop above. */
export function createHarness(_deps: HarnessDeps): AnalysisHarness {
  return {
    execute: async () => {
      throw new Error('TODO(WS5): AnalysisHarness.execute');
    },
  };
}
