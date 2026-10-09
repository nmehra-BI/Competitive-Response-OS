/**
 * Bounded analysis harness: one agent, one skill per run, budgets, checkpoints, resume (PRD §8, §13).
 *
 * Lifecycle (status changes only through `runMachine`, system actor `worker`):
 *   queued → running → completed | partial | failed | waiting_for_input; cancelled by a person.
 *   partial | failed → queued (resume, a human command in the API) → running from the checkpoint.
 *
 * Loop. Every step commits atomically with the checkpoint (`RunStore.commit`), so a crash loses at
 * most the step in flight:
 *   1. Load the skill bundle; refuse a version other than the one the run was created with.
 *   2. Context = skill instructions + the untrusted-data rule + permission-filtered case context.
 *   3. provider.generate → tool calls → gateway.call each (allowlist, budget, tenant, identity,
 *      schema, entitlement) → results appended (source text only as untrusted evidence blocks).
 *   4. Final output: parse against the skill's SkillOutput schema (one repair attempt, then failed);
 *      then citations (only ids returned in this run), unsupported precision, "not a decision".
 *   5. Proposals are written with status `proposed` — never business records. Regeneration creates
 *      new proposals and supersedes pending ones; accepted or edited proposals are never touched.
 *   6. completed, or partial when any tool step failed (source unavailable, withheld, budget).
 * Resume reuses committed tool results keyed by tool + args hash; they are not re-executed.
 * Budgets: wall time and tool calls per attempt; tokens and cost per run. Tool-call budget exhausted →
 * remaining calls are refused and the provider finishes with what it has (partial). Time, token or
 * cost budget exhausted → failed with "Stopped — your work is saved" (resumable). The trace holds
 * structured summaries, ids and hashes only — never prompt text or model reasoning.
 */
import type {
  AgentToolName,
  RunBudget,
  RunStatus,
  RunUsage,
  SkillKey,
  SkillOutput,
} from '@growth-os/contracts';
import { runMachine, type RunCommand, type WorkflowFacts } from '@growth-os/domain';
import { UNTRUSTED_RULE, stripControl } from '../gateway/untrusted';
import type { GatewayRecord, RunScope, ToolGateway, ToolResult } from '../gateway/tool-gateway';
import type {
  AnalysisProvider,
  ContextBlock,
  ProviderResponse,
  ProviderToolCall,
  TokenUsage,
} from '../providers/provider';
import { skillOutputSchema, type SkillLoader } from '../skills/loader';
import { hashOf, stableStringify } from '../util/hash';
import { checkOutput } from './checks';

export const SYSTEM_WORKER = { kind: 'system', reason: 'worker' } as const;
export const MAX_TURNS_PER_ATTEMPT = 24;

export interface RunRecord {
  id: string;
  tenantId: string;
  caseId: string | null;
  mandateId: string | null;
  skill: SkillKey;
  skillVersion: string;
  goal: string;
  focus: Record<string, string>;
  status: RunStatus;
  requestedBy: string;
  budget: RunBudget;
  usage: RunUsage;
  checkpoint: Checkpoint | null;
  correlationId: string;
}

export interface StoredToolResult {
  tool: string;
  result: ToolResult;
}

export interface Checkpoint {
  v: 1;
  /** Next step sequence number. */
  seq: number;
  /** Provider calls completed (the fixture provider replays turn `turn`). */
  turn: number;
  /** Number of leading context blocks that are the initial context (instructions + case). */
  initialBlocks: number;
  context: ContextBlock[];
  pendingCalls: ProviderToolCall[];
  /** Completed tool results keyed by `tool:argsHash`; reused, never re-executed, on resume. */
  toolResults: Record<string, StoredToolResult>;
  /** Source and passage ids returned to this run (citable). */
  returnedIds: string[];
  failedToolSteps: { tool: string; code: string }[];
  attempt: number;
  attemptStartedAt: number;
  attemptToolCalls: number;
  attemptTurns: number;
  repairUsed: boolean;
  budgetNoticeSent: boolean;
  lastQuestion: string | null;
  pendingAnswer: string | null;
  output: { proposalIds: string[] } | null;
}

export interface StepRow {
  seq: number;
  kind: 'provider_call' | 'tool_call' | 'validation' | 'checkpoint' | 'proposal_write';
  status: 'started' | 'succeeded' | 'failed';
  summary: string;
  /** Structured refs, counts and hashes only. */
  data: Record<string, string | number | boolean | null>;
}

export interface TransitionWrite {
  command: RunCommand;
  from: RunStatus;
  to: RunStatus;
  auditAction: string;
  detail: string | null;
  needsInput?: { question: string; options: string[] } | null;
  error?: { code: string; message: string } | null;
  started?: boolean;
  finished?: boolean;
}

export interface CommitInput {
  /** The status the run must still have (otherwise the commit is refused: cancelled meanwhile). */
  expect: RunStatus;
  transition?: TransitionWrite;
  steps?: StepRow[];
  toolCall?: { seq: number; record: GatewayRecord };
  checkpoint: Checkpoint;
  usage?: Partial<RunUsage>;
  /**
   * Proposals to store (status `proposed`). The store supersedes earlier pending proposals of the same
   * skill and subject, never accepted or edited ones, and sets `checkpoint.output` to the new ids.
   */
  proposals?: { skill: SkillKey; output: SkillOutput };
}

export class RunStateChanged extends Error {
  constructor(readonly status: RunStatus) {
    super(`run is ${status}`);
    this.name = 'RunStateChanged';
  }
}

export interface RunStore {
  loadRun(runId: string): Promise<RunRecord>;
  status(runId: string): Promise<RunStatus>;
  /** Permission-filtered structured context for the run's subject (ids, keys, labels; no source text). */
  caseContext(run: RunRecord): Promise<unknown>;
  /** Tenant concurrency for analysis runs. */
  concurrencyAvailable(run: RunRecord): Promise<boolean>;
  /** Atomically: optional transition, steps, tool call record, checkpoint, usage, proposals. */
  commit(runId: string, input: CommitInput): Promise<{ proposalIds: string[] }>;
}

export interface AnalysisHarness {
  execute(runId: string): Promise<RunStatus>;
}

export interface HarnessDeps {
  provider: AnalysisProvider;
  gateway: ToolGateway;
  skills: SkillLoader;
  store: RunStore;
  now?: () => number;
}

const resultKey = (tool: string, args: unknown) => `${tool}:${hashOf(args ?? null)}`;

function emptyCheckpoint(context: ContextBlock[], now: number): Checkpoint {
  return {
    v: 1,
    seq: 0,
    turn: 0,
    initialBlocks: context.length,
    context,
    pendingCalls: [],
    toolResults: {},
    returnedIds: [],
    failedToolSteps: [],
    attempt: 1,
    attemptStartedAt: now,
    attemptToolCalls: 0,
    attemptTurns: 0,
    repairUsed: false,
    budgetNoticeSent: false,
    lastQuestion: null,
    pendingAnswer: null,
    output: null,
  };
}

/** A new attempt after resume. A run that already produced output regenerates from turn 0. */
export function nextAttempt(cp: Checkpoint, now: number): Checkpoint {
  const base = {
    ...cp,
    attempt: cp.attempt + 1,
    attemptStartedAt: now,
    attemptToolCalls: 0,
    attemptTurns: 0,
    budgetNoticeSent: false,
  };
  if (!cp.output) return { ...base, failedToolSteps: [] };
  return {
    ...base,
    turn: 0,
    context: cp.context.slice(0, cp.initialBlocks),
    pendingCalls: [],
    toolResults: Object.fromEntries(Object.entries(cp.toolResults).filter(([, r]) => r.result.ok)),
    returnedIds: [],
    failedToolSteps: [],
    repairUsed: false,
    output: null,
  };
}

function partialDetail(failed: Checkpoint['failedToolSteps']): string {
  const count = (codes: string[]) => failed.filter((f) => codes.includes(f.code)).length;
  const parts: string[] = [];
  const unavailable = count(['connector_unavailable']);
  const withheld = count(['denied', 'not_found']);
  const budget = count(['budget_exhausted']);
  const refused = count(['unknown_tool', 'not_allowed', 'schema_invalid', 'error']);
  if (unavailable) parts.push(`${unavailable} source${unavailable === 1 ? '' : 's'} unavailable`);
  if (withheld) parts.push(`${withheld} source${withheld === 1 ? '' : 's'} not available to you`);
  if (budget) parts.push('analysis budget reached');
  if (refused) parts.push(`${refused} request${refused === 1 ? '' : 's'} refused`);
  return parts.join(' · ') || 'some steps did not complete';
}

export function createHarness(deps: HarnessDeps): AnalysisHarness {
  const now = deps.now ?? (() => Date.now());
  const { store, provider, gateway, skills } = deps;

  function transition(
    from: RunStatus,
    command: RunCommand,
    facts: WorkflowFacts,
    extra: Omit<TransitionWrite, 'command' | 'from' | 'to' | 'auditAction'>,
  ): TransitionWrite | { refused: string; code: string } {
    const r = runMachine.apply(from, command, SYSTEM_WORKER, facts);
    if (!r.ok) return { refused: r.reasons.join('; '), code: r.code };
    return { command, from, to: r.to, auditAction: r.auditAction, ...extra };
  }

  async function execute(runId: string): Promise<RunStatus> {
    let run = await store.loadRun(runId);
    const skill = await skills.load(run.skill);
    const scope: RunScope = {
      tenantId: run.tenantId,
      runId: run.id,
      caseId: run.caseId,
      mandateId: run.mandateId,
      requestedByUserId: run.requestedBy,
      correlationId: run.correlationId,
    };
    let tick = now();
    const elapsed = () => {
      const t = now();
      const d = Math.max(0, Math.round(t - tick));
      tick = t;
      return d;
    };

    let cp: Checkpoint;
    if (run.status === 'queued') {
      const t = transition(
        'queued',
        'start',
        {
          tenantConcurrencyAvailable: await store.concurrencyAvailable(run),
          budgetAvailable: run.usage.costMicros < run.budget.maxCostMicros,
        },
        { detail: null, needsInput: null, error: null, started: true },
      );
      if ('refused' in t) {
        if (t.code !== 'BUDGET_EXHAUSTED') return 'queued'; // concurrency: the job retries later
        const f = transition(
          'queued',
          'fail',
          {},
          {
            detail: 'Stopped — your work is saved',
            error: { code: 'BUDGET_EXHAUSTED', message: 'The analysis budget is used up.' },
            finished: true,
          },
        );
        if ('refused' in f) throw new Error(f.refused);
        await store.commit(runId, {
          expect: 'queued',
          transition: f,
          checkpoint: run.checkpoint ?? emptyCheckpoint([], now()),
        });
        return 'failed';
      }
      if (run.skillVersion !== skill.version) {
        const f = transition(
          'queued',
          'fail',
          {},
          {
            detail: 'Stopped — your work is saved',
            error: {
              code: 'SKILL_VERSION_CHANGED',
              message: 'The skill changed since this analysis was requested.',
            },
            finished: true,
          },
        );
        if ('refused' in f) throw new Error(f.refused);
        await store.commit(runId, {
          expect: 'queued',
          transition: f,
          checkpoint: run.checkpoint ?? emptyCheckpoint([], now()),
        });
        return 'failed';
      }
      if (run.checkpoint) cp = nextAttempt(run.checkpoint, now());
      else {
        const caseContext = await store.caseContext(run);
        cp = emptyCheckpoint(
          [
            { kind: 'instructions', text: `${skill.instructions}\n\n${UNTRUSTED_RULE}` },
            { kind: 'case_context', json: { goal: run.goal, focus: run.focus, subject: caseContext } },
          ],
          now(),
        );
      }
      try {
        await store.commit(runId, {
          expect: 'queued',
          transition: t,
          checkpoint: { ...cp, seq: cp.seq + 1 },
          steps: [
            {
              seq: cp.seq,
              kind: 'checkpoint',
              status: 'succeeded',
              summary: cp.attempt === 1 ? 'Started' : `Resumed from step ${cp.seq} (attempt ${cp.attempt})`,
              data: { attempt: cp.attempt, reusableResults: Object.keys(cp.toolResults).length },
            },
          ],
        });
        cp = { ...cp, seq: cp.seq + 1 };
      } catch (err) {
        if (err instanceof RunStateChanged) return err.status;
        throw err;
      }
      run = { ...run, status: 'running' };
    } else if (run.status === 'running') {
      if (!run.checkpoint) {
        // Crashed between start and the first commit: rebuild the initial context.
        const caseContext = await store.caseContext(run);
        cp = emptyCheckpoint(
          [
            { kind: 'instructions', text: `${skill.instructions}\n\n${UNTRUSTED_RULE}` },
            { kind: 'case_context', json: { goal: run.goal, focus: run.focus, subject: caseContext } },
          ],
          now(),
        );
      } else cp = run.checkpoint;
    } else {
      return run.status; // waiting, terminal or awaiting resume: nothing to do
    }

    const commit = async (input: Omit<CommitInput, 'expect' | 'checkpoint'>, next: Checkpoint) => {
      const res = await store.commit(runId, {
        expect: 'running',
        checkpoint: next,
        ...input,
        usage: { ...input.usage, elapsedMs: (input.usage?.elapsedMs ?? 0) + elapsed() },
      });
      cp = next;
      return res;
    };
    const step = (s: Omit<StepRow, 'seq'>, at = cp.seq): StepRow => ({ ...s, seq: at });

    const finish = async (
      command: RunCommand,
      facts: WorkflowFacts,
      extra: Omit<TransitionWrite, 'command' | 'from' | 'to' | 'auditAction'>,
      steps: StepRow[] = [],
      next: Checkpoint = cp,
      usage?: Partial<RunUsage>,
    ): Promise<RunStatus> => {
      const t = transition('running', command, facts, extra);
      if ('refused' in t) throw new Error(`run ${runId}: ${command} refused: ${t.refused}`);
      await commit({ transition: t, steps, usage }, next);
      return t.to;
    };

    try {
      for (;;) {
        const status = await store.status(runId);
        if (status !== 'running') return status;

        // A human answer arrived while waiting for input.
        if (cp.pendingAnswer !== null) {
          const answered: ContextBlock = {
            kind: 'human_input',
            question: cp.lastQuestion ?? '',
            text: cp.pendingAnswer,
          };
          await commit(
            {
              steps: [
                step({ kind: 'checkpoint', status: 'succeeded', summary: 'Your answer was added', data: {} }),
              ],
            },
            { ...cp, seq: cp.seq + 1, context: [...cp.context, answered], pendingAnswer: null },
          );
          continue;
        }

        // Execute pending tool calls one by one, committing each result.
        if (cp.pendingCalls.length > 0) {
          const call = cp.pendingCalls[0]!;
          const key = resultKey(call.tool, call.args);
          const reused = cp.toolResults[key];
          let result: ToolResult;
          let record: GatewayRecord | null = null;
          let toolCalls = 0;
          if (reused) result = reused.result;
          else {
            const g = await gateway.call(scope, call.tool, call.args, {
              allowedTools: skill.allowedTools,
              budget: {
                toolCallsLeft:
                  Math.min(skill.budget.maxToolCalls, run.budget.maxToolCalls) - cp.attemptToolCalls,
                deadlineMs: cp.attemptStartedAt + run.budget.wallTimeMs,
              },
            });
            result = g.result;
            record = g.record;
            // Only calls that passed the budget check count against it.
            toolCalls = record && record.scopeCheck.budget ? 1 : 0;
          }
          const blocks: ContextBlock[] = [
            {
              kind: 'tool_result',
              callId: call.callId,
              tool: call.tool,
              ok: result.ok,
              json: result.ok ? result.data : { error: result.code, summary: result.summary },
            },
          ];
          if (result.ok)
            for (const p of result.untrusted ?? [])
              blocks.push({
                kind: 'evidence',
                evidenceId: p.evidenceId,
                sourceKey: p.sourceKey,
                text: stripControl(p.text),
                trust: 'untrusted',
                callId: call.callId,
              });
          if (!result.ok && result.code === 'budget_exhausted' && !cp.budgetNoticeSent)
            blocks.push({ kind: 'notice', text: 'The tool budget is used up. Finish with what you have.' });
          const next: Checkpoint = {
            ...cp,
            seq: cp.seq + 1,
            pendingCalls: cp.pendingCalls.slice(1),
            context: [...cp.context, ...blocks],
            toolResults:
              result.ok && !reused && record
                ? { ...cp.toolResults, [key]: { tool: call.tool, result } }
                : cp.toolResults,
            returnedIds: result.ok
              ? [...new Set([...cp.returnedIds, ...result.evidenceIds])]
              : cp.returnedIds,
            failedToolSteps: result.ok
              ? cp.failedToolSteps
              : [...cp.failedToolSteps, { tool: call.tool, code: result.code }],
            attemptToolCalls: cp.attemptToolCalls + toolCalls,
            budgetNoticeSent: cp.budgetNoticeSent || (!result.ok && result.code === 'budget_exhausted'),
          };
          await commit(
            {
              steps: [
                step({
                  kind: 'tool_call',
                  status: result.ok ? 'succeeded' : 'failed',
                  summary: `${call.tool} · ${reused ? 'reused · ' : ''}${result.summary}`,
                  data: {
                    tool: call.tool,
                    callId: call.callId,
                    argsHash: hashOf(call.args ?? null),
                    reused: Boolean(reused),
                    outcome: result.ok ? 'ok' : result.code,
                  },
                }),
              ],
              toolCall: record ? { seq: cp.seq, record } : undefined,
              usage: { toolCalls },
            },
            next,
          );
          continue;
        }

        // Budgets before calling the provider again.
        const timeUp = now() - cp.attemptStartedAt >= run.budget.wallTimeMs;
        const costUp = run.usage.costMicros >= run.budget.maxCostMicros;
        const tokensUp =
          run.usage.inputTokens >= run.budget.maxInputTokens ||
          run.usage.outputTokens >= run.budget.maxOutputTokens * MAX_TURNS_PER_ATTEMPT;
        const turnsUp = cp.attemptTurns >= MAX_TURNS_PER_ATTEMPT;
        if (timeUp || costUp || tokensUp || turnsUp) {
          return await finish(
            'fail',
            {},
            {
              detail: 'Stopped — your work is saved',
              error: {
                code: 'BUDGET_EXHAUSTED',
                message: timeUp
                  ? 'The analysis reached its time budget.'
                  : costUp || tokensUp
                    ? 'The analysis reached its cost budget.'
                    : 'The analysis reached its step limit.',
              },
              finished: true,
            },
            [
              step({
                kind: 'checkpoint',
                status: 'failed',
                summary: 'Budget reached · stopped, your work is saved',
                data: { timeUp, costUp, tokensUp, turnsUp },
              }),
            ],
            { ...cp, seq: cp.seq + 1 },
          );
        }

        let response: ProviderResponse;
        try {
          response = await provider.generate({
            runId,
            skill: run.skill,
            skillVersion: run.skillVersion,
            turn: cp.turn,
            context: cp.context,
            tools: gateway.specs(skill.allowedTools),
            outputSchema: skill.outputSchema,
            maxOutputTokens: Math.min(skill.budget.maxOutputTokens, run.budget.maxOutputTokens),
            fixtureKey: run.focus.fixture ?? 'default',
            correlationId: run.correlationId,
          });
        } catch (err) {
          response = {
            type: 'error',
            code: 'provider_unavailable',
            message: err instanceof Error ? err.message.slice(0, 200) : 'Provider error',
            usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
          };
        }
        const u: TokenUsage = response.usage;
        run = {
          ...run,
          usage: {
            ...run.usage,
            inputTokens: run.usage.inputTokens + u.inputTokens,
            outputTokens: run.usage.outputTokens + u.outputTokens,
            costMicros: run.usage.costMicros + u.costMicros,
          },
        };
        const usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMicros: u.costMicros };
        const providerStep = (status: StepRow['status'], summary: string, extra: StepRow['data'] = {}) =>
          step({
            kind: 'provider_call',
            status,
            summary,
            data: {
              turn: cp.turn,
              response: response.type,
              inputTokens: u.inputTokens,
              outputTokens: u.outputTokens,
              ...extra,
            },
          });
        const advanced: Checkpoint = {
          ...cp,
          seq: cp.seq + 1,
          turn: cp.turn + 1,
          attemptTurns: cp.attemptTurns + 1,
        };

        if (response.type === 'error') {
          return await finish(
            'fail',
            {},
            {
              detail: 'Stopped — your work is saved',
              error: { code: `provider_${response.code}`, message: response.message.slice(0, 200) },
              finished: true,
            },
            [providerStep('failed', `Analysis service error · ${response.code}`)],
            { ...cp, seq: cp.seq + 1 },
            usage,
          );
        }

        if (response.type === 'tool_calls') {
          const calls = response.calls.slice(0, 20);
          await commit(
            {
              steps: [
                providerStep(
                  'succeeded',
                  `Requested ${calls.length} tool call${calls.length === 1 ? '' : 's'}`,
                  { calls: calls.length },
                ),
              ],
              usage,
            },
            {
              ...advanced,
              pendingCalls: calls,
              context: [...cp.context, { kind: 'assistant_tool_calls', calls }],
            },
          );
          continue;
        }

        if (response.type === 'needs_input') {
          return await finish(
            'ask_input',
            {},
            {
              detail: 'Needs your input',
              needsInput: {
                question: response.question.slice(0, 500),
                options: response.options.slice(0, 6),
              },
            },
            [providerStep('succeeded', 'Asked for your input')],
            { ...advanced, lastQuestion: response.question.slice(0, 500) },
            usage,
          );
        }

        // Final output: schema first.
        const parsed = skillOutputSchema(skill.allowedProposalTypes).safeParse(response.output);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .slice(0, 10)
            .map((i) => `${i.path.join('.') || 'output'}: ${i.message}`);
          const vstep = step(
            {
              kind: 'validation',
              status: 'failed',
              summary: `Output did not match the schema (${parsed.error.issues.length} issue${parsed.error.issues.length === 1 ? '' : 's'})${cp.repairUsed ? '' : ' · one repair attempt'}`,
              data: { issues: parsed.error.issues.length, repair: !cp.repairUsed },
            },
            cp.seq + 1,
          );
          if (!cp.repairUsed) {
            await commit(
              { steps: [providerStep('succeeded', 'Returned output'), vstep], usage },
              {
                ...advanced,
                seq: cp.seq + 2,
                repairUsed: true,
                context: [...cp.context, { kind: 'repair', errors: issues }],
              },
            );
            continue;
          }
          return await finish(
            'fail',
            {},
            {
              detail: 'Stopped — your work is saved',
              error: {
                code: 'malformed_output',
                message: 'The analysis output did not match its schema after one repair.',
              },
              finished: true,
            },
            [providerStep('succeeded', 'Returned output'), vstep],
            { ...advanced, seq: cp.seq + 2 },
            usage,
          );
        }

        // Citations, unsupported precision, "not a decision".
        const supportTexts = cp.context.flatMap((b) =>
          b.kind === 'evidence'
            ? [b.text]
            : b.kind === 'tool_result' && b.ok
              ? [stableStringify(b.json)]
              : b.kind === 'case_context'
                ? [stableStringify(b.json)]
                : [],
        );
        const checked = checkOutput(parsed.data, new Set(cp.returnedIds), supportTexts);
        const steps = [
          providerStep('succeeded', 'Returned output'),
          step(
            {
              kind: 'validation',
              status: 'succeeded',
              summary:
                `Output valid · ${checked.citationsRemoved} unverified citation${checked.citationsRemoved === 1 ? '' : 's'} removed · ` +
                `${checked.claimsDowngraded} claim${checked.claimsDowngraded === 1 ? '' : 's'} marked Unknown`,
              data: {
                proposals: checked.output.proposals.length,
                citationsRemoved: checked.citationsRemoved,
                claimsDowngraded: checked.claimsDowngraded,
                unsupportedFigures: checked.unsupportedFigures.length,
              },
            },
            cp.seq + 1,
          ),
          step(
            {
              kind: 'proposal_write',
              status: 'succeeded',
              summary: `${checked.output.proposals.length} proposal${checked.output.proposals.length === 1 ? '' : 's'} for review`,
              data: {
                count: checked.output.proposals.length,
                types: [...new Set(checked.output.proposals.map((p) => p.type))].join(','),
              },
            },
            cp.seq + 2,
          ),
        ];
        const partial = cp.failedToolSteps.length > 0;
        const t = partial
          ? transition(
              'running',
              'complete_partial',
              {},
              {
                detail: partialDetail(cp.failedToolSteps),
                finished: true,
              },
            )
          : transition(
              'running',
              'complete',
              { outputSchemaValid: true, citationsValid: true },
              { detail: null, finished: true, needsInput: null, error: null },
            );
        if ('refused' in t) throw new Error(t.refused);
        const next: Checkpoint = { ...advanced, seq: cp.seq + 3 };
        const res = await commit(
          { transition: t, steps, usage, proposals: { skill: run.skill, output: checked.output } },
          next,
        );
        cp = { ...cp, output: { proposalIds: res.proposalIds } };
        return t.to;
      }
    } catch (err) {
      if (err instanceof RunStateChanged) return err.status;
      throw err;
    }
  }

  return { execute };
}

/** Allowed tool names of a skill, typed (helper for handlers and tests). */
export const toolNames = (names: readonly string[]): AgentToolName[] => names as AgentToolName[];
