/**
 * In-memory RunStore with the same semantics as the worker's Postgres store: atomic commits,
 * status expectations, superseding of pending proposals, and the human commands (cancel, resume,
 * answer) applied through `runMachine`. Used by unit tests and the eval runner (no database).
 */
import { randomUUID } from 'node:crypto';
import type { ProposalPayload, RunBudget, RunStatus, RunUsage, SkillKey } from '@growth-os/contracts';
import { runMachine, type Actor } from '@growth-os/domain';
import type { GatewayRecord } from '../gateway/tool-gateway';
import {
  RunStateChanged,
  type CommitInput,
  type RunRecord,
  type RunStore,
  type StepRow,
  type TransitionWrite,
} from './harness';

export interface MemoryProposal {
  id: string;
  runId: string;
  skill: SkillKey;
  subjectId: string;
  payload: ProposalPayload;
  status: 'proposed' | 'accepted' | 'edited_and_accepted' | 'rejected' | 'superseded';
}

export interface MemoryRun extends RunRecord {
  needsInput: { question: string; options: string[] } | null;
  error: { code: string; message: string } | null;
  detail: string | null;
  steps: StepRow[];
  toolCalls: GatewayRecord[];
  transitions: TransitionWrite[];
  caseOwnerId: string | null;
}

export interface MemoryRunStore extends RunStore {
  runs: Map<string, MemoryRun>;
  proposals: MemoryProposal[];
  createRun(input: {
    tenantId: string;
    skill: SkillKey;
    skillVersion: string;
    requestedBy: string;
    budget: RunBudget;
    caseId?: string | null;
    mandateId?: string | null;
    caseOwnerId?: string | null;
    goal?: string;
    focus?: Record<string, string>;
  }): MemoryRun;
  /** Human commands, as the API applies them. */
  cancel(runId: string, actor: Actor): RunStatus;
  resume(runId: string, actor: Actor): RunStatus;
  answer(runId: string, actor: Actor, answer: string): RunStatus;
  /** Number of commits refused because the run changed status (cancelled meanwhile). */
  refusedCommits: number;
  /** Simulate a crash: throw on the n-th next commit (before anything is applied). */
  failCommitAfter(n: number): void;
}

const ZERO: RunUsage = { elapsedMs: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 };

export function createMemoryRunStore(
  opts: { caseContext?: (run: RunRecord) => unknown; concurrency?: () => boolean } = {},
): MemoryRunStore {
  const runs = new Map<string, MemoryRun>();
  const proposals: MemoryProposal[] = [];
  let crashIn: number | null = null;
  const clone = <T>(v: T): T => structuredClone(v);

  const humanApply = (runId: string, command: 'cancel' | 'resume' | 'input_received', actor: Actor) => {
    const run = runs.get(runId);
    if (!run) throw new Error('not found');
    const r = runMachine.apply(run.status, command, actor, {
      requesterId: run.requestedBy,
      caseOwnerId: run.caseOwnerId,
      checkpointExists: run.checkpoint !== null,
      budgetAvailable: run.usage.costMicros < run.budget.maxCostMicros,
    });
    if (!r.ok) throw new Error(`${r.code}: ${r.reasons.join('; ')}`);
    run.status = r.to;
    return run;
  };

  const store: MemoryRunStore = {
    runs,
    proposals,
    refusedCommits: 0,
    failCommitAfter(n) {
      crashIn = n;
    },
    createRun(input) {
      const run: MemoryRun = {
        id: randomUUID(),
        tenantId: input.tenantId,
        caseId: input.caseId ?? null,
        mandateId: input.mandateId ?? null,
        skill: input.skill,
        skillVersion: input.skillVersion,
        goal: input.goal ?? 'Analysis',
        focus: input.focus ?? {},
        status: 'queued',
        requestedBy: input.requestedBy,
        budget: input.budget,
        usage: { ...ZERO },
        checkpoint: null,
        correlationId: `mem-${randomUUID()}`,
        needsInput: null,
        error: null,
        detail: null,
        steps: [],
        toolCalls: [],
        transitions: [],
        caseOwnerId: input.caseOwnerId ?? null,
      };
      runs.set(run.id, run);
      return run;
    },
    async loadRun(runId) {
      const run = runs.get(runId);
      if (!run) throw new Error(`run ${runId} not found`);
      return clone({
        id: run.id,
        tenantId: run.tenantId,
        caseId: run.caseId,
        mandateId: run.mandateId,
        skill: run.skill,
        skillVersion: run.skillVersion,
        goal: run.goal,
        focus: run.focus,
        status: run.status,
        requestedBy: run.requestedBy,
        budget: run.budget,
        usage: run.usage,
        checkpoint: run.checkpoint,
        correlationId: run.correlationId,
      });
    },
    async status(runId) {
      return runs.get(runId)!.status;
    },
    async caseContext(run) {
      return opts.caseContext ? opts.caseContext(run) : {};
    },
    async concurrencyAvailable() {
      return opts.concurrency ? opts.concurrency() : true;
    },
    async commit(runId, input: CommitInput) {
      if (crashIn !== null) {
        crashIn -= 1;
        if (crashIn <= 0) {
          crashIn = null;
          throw new Error('simulated worker crash');
        }
      }
      const run = runs.get(runId)!;
      if (run.status !== input.expect) {
        store.refusedCommits++;
        throw new RunStateChanged(run.status);
      }
      const seqs = new Set(run.steps.map((s) => s.seq));
      for (const s of input.steps ?? [])
        if (seqs.has(s.seq)) throw new Error(`duplicate step seq ${s.seq} for run ${runId}`);
      let ids: string[] = [];
      const checkpoint = clone(input.checkpoint);
      if (input.proposals) {
        const subjectId = run.caseId ?? run.mandateId ?? run.id;
        for (const p of proposals)
          if (p.status === 'proposed' && p.skill === input.proposals.skill && p.subjectId === subjectId)
            p.status = 'superseded';
        ids = input.proposals.output.proposals.map((payload) => {
          const id = randomUUID();
          proposals.push({
            id,
            runId,
            skill: input.proposals!.skill,
            subjectId,
            payload: clone(payload),
            status: 'proposed',
          });
          return id;
        });
        checkpoint.output = { proposalIds: ids };
      }
      run.steps.push(...clone(input.steps ?? []));
      if (input.toolCall) run.toolCalls.push(clone(input.toolCall.record));
      run.checkpoint = checkpoint;
      for (const [k, v] of Object.entries(input.usage ?? {})) run.usage[k as keyof RunUsage] += v ?? 0;
      if (input.transition) {
        const t = input.transition;
        run.status = t.to;
        run.transitions.push(clone(t));
        run.detail = t.detail;
        if (t.needsInput !== undefined) run.needsInput = t.needsInput;
        if (t.error !== undefined) run.error = t.error;
      }
      return { proposalIds: ids };
    },
    cancel(runId, actor) {
      return humanApply(runId, 'cancel', actor).status;
    },
    resume(runId, actor) {
      const run = humanApply(runId, 'resume', actor);
      run.error = null;
      return run.status;
    },
    answer(runId, actor, answer) {
      const run = humanApply(runId, 'input_received', actor);
      run.needsInput = null;
      if (run.checkpoint) run.checkpoint = { ...run.checkpoint, pendingAnswer: answer };
      return run.status;
    },
  };
  return store;
}
