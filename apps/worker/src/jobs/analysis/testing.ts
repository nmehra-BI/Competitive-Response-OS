/** Test support for the worker's analysis suites: insert runs as the API would, read them back. */
import { randomUUID } from 'node:crypto';
import type { RunBudget, SkillKey } from '@growth-os/contracts';
import { withTenant, type Db } from '@growth-os/db';

export const TEST_BUDGET: RunBudget = {
  wallTimeMs: 300_000,
  maxToolCalls: 40,
  maxInputTokens: 120_000,
  maxOutputTokens: 8_000,
  maxCostMicros: 2_000_000,
};

export async function insertRun(
  db: Db,
  tenantId: string,
  input: {
    skill: SkillKey;
    requestedBy: string;
    caseKey?: string;
    mandateKey?: string;
    focus?: Record<string, string>;
    budget?: Partial<RunBudget>;
  },
): Promise<string> {
  return withTenant(db, { tenantId, userId: null, correlationId: 'test' }, async (tx) => {
    let caseId: string | null = null;
    let subjectId: string;
    if (input.caseKey) {
      caseId = (
        await tx
          .selectFrom('platform.workflow_case')
          .select('id')
          .where('display_key', '=', input.caseKey)
          .executeTakeFirstOrThrow()
      ).id;
      subjectId = caseId;
    } else {
      subjectId = (
        await tx
          .selectFrom('me.mandate')
          .select('id')
          .where('display_key', '=', input.mandateKey ?? 'MD-21')
          .executeTakeFirstOrThrow()
      ).id;
    }
    const row = await tx
      .insertInto('platform.agent_run')
      .values({
        tenant_id: tenantId,
        case_id: caseId,
        subject_type: caseId ? 'case' : 'mandate',
        subject_id: subjectId,
        skill_key: input.skill,
        skill_version: '1.0.0',
        goal: 'test',
        requested_by: input.requestedBy,
        provider: 'fixture',
        input_snapshot_hash: '0'.repeat(64),
        budget: JSON.stringify({ ...TEST_BUDGET, ...input.budget }),
        checkpoint: JSON.stringify({ focus: input.focus ?? {} }),
        correlation_id: `test-${randomUUID()}`,
        idempotency_key: randomUUID(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
}

export function readRun(db: Db, tenantId: string, runId: string) {
  return withTenant(db, { tenantId, userId: null, correlationId: 'test' }, async (tx) => ({
    run: await tx
      .selectFrom('platform.agent_run')
      .selectAll()
      .where('id', '=', runId)
      .executeTakeFirstOrThrow(),
    steps: await tx
      .selectFrom('platform.agent_run_step')
      .selectAll()
      .where('run_id', '=', runId)
      .orderBy('seq')
      .execute(),
    toolCalls: await tx
      .selectFrom('platform.tool_call')
      .selectAll()
      .where('run_id', '=', runId)
      .orderBy('created_at')
      .execute(),
    proposals: await tx
      .selectFrom('platform.proposal')
      .selectAll()
      .where('run_id', '=', runId)
      .orderBy('created_at')
      .execute(),
    audit: await tx
      .selectFrom('platform.audit_event')
      .select(['action', 'actor_kind', 'summary'])
      .where('object_id', '=', runId)
      .orderBy('occurred_at')
      .execute(),
  }));
}
