/**
 * First-run onboarding (CR-ONB-1, decisions.md D-190 onward; design ONBOARDING.md).
 *
 * The signed-in person's own guide state: GET derives the checklist from the viewer's OWN records (cases they
 * own, decisions they recorded, their tasks and review requests) so nothing hidden is ever counted (never-rule
 * 8); PATCH records one change through the command pipeline with an audit event; the dev-only reset clears the
 * row in an illustrative workspace. People only: agents and services are refused here (`auth: 'human'`, and the
 * reset checks the actor) and by the table guard in 0008. No analytics event: onboarding is not a PRD §17 event
 * (proposed as CR-ONB-2, D-197).
 */
import { API, type EndpointDef, type GuideStepKey, type OnboardingState } from '@growth-os/contracts';
import { hostedWithoutDemo, sql, type Tx } from '@growth-os/db';
import {
  applyPatch,
  checkPatch,
  composeSteps,
  EMPTY_ONBOARDING,
  guidePathFor,
  stepDef,
  type OnboardingRowState,
} from '@growth-os/domain';
import type { Authorization, Identity } from '../../../platform/context';
import { ApiError } from '../../../platform/errors';
import { command, query, type Ctx, type HandlerMap } from '../../../platform/pipeline';

const RULE = 'onboarding:self';

/** Only the person themself, and only people. */
function selfOnly(identity: Identity): Authorization {
  if (identity.actor.kind !== 'human' || !identity.interactive)
    return { allow: false, rule: RULE, code: 'AGENT_IDENTITY_FORBIDDEN', reason: 'People only.' };
  return { allow: true, rule: RULE, authorityGrantId: null, role: null };
}

/** Reset: dev features on, an illustrative workspace, people only (D-165, like the dev clock). */
function canResetFor(identity: Identity, authMode: string): boolean {
  return authMode === 'dev' && identity.tenant.illustrative && !hostedWithoutDemo();
}

interface Row {
  welcome_seen_at: Date | null;
  explainer_status: 'not_started' | 'completed' | 'skipped';
  guide_dismissed: boolean;
  visited_steps: string[];
  coach_marks_dismissed: string[];
  updated_at: Date;
}

async function loadRow(tx: Tx, userId: string): Promise<Row | null> {
  const row = await tx
    .selectFrom('platform.user_onboarding')
    .select([
      'welcome_seen_at',
      'explainer_status',
      'guide_dismissed',
      'visited_steps',
      'coach_marks_dismissed',
      'updated_at',
    ])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return (row as Row | undefined) ?? null;
}

function toRowState(row: Row | null): OnboardingRowState {
  if (!row) return { ...EMPTY_ONBOARDING, visitedSteps: [], coachMarksDismissed: [] };
  return {
    welcomeSeen: row.welcome_seen_at !== null,
    explainer: row.explainer_status,
    guideDismissed: row.guide_dismissed,
    visitedSteps: [...row.visited_steps],
    coachMarksDismissed: [...row.coach_marks_dismissed],
  };
}

interface ExistsQuery {
  execute(tx: Tx): Promise<{ rows: { ok: boolean }[] }>;
}
const exists = async (tx: Tx, q: ExistsQuery): Promise<boolean> => (await q.execute(tx)).rows[0]?.ok === true;

/**
 * State-derived steps. Every query is limited to the viewer's own records (owner, approver, reviewer, task
 * owner), inside the tenant transaction (RLS), so the result never reveals anything the viewer cannot see.
 */
async function derive(tx: Tx, uid: string): Promise<Partial<Record<GuideStepKey, boolean>>> {
  const owned = sql`SELECT c.id FROM platform.workflow_case c WHERE c.owner_user_id = ${uid}`;
  const [shortlist, ownsCase, sizing, validation, submitG2, decided, taskSync, actuals, responded] =
    await Promise.all([
      exists(
        tx,
        sql<{ ok: boolean }>`SELECT EXISTS (
          SELECT 1 FROM me.opportunity o
            LEFT JOIN me.mandate m ON m.id = o.mandate_id
            LEFT JOIN me.mandate_version mv ON mv.id = m.current_version_id
           WHERE o.status IN ('shortlisted', 'converted')
             AND (mv.owner_user_id = ${uid} OR o.converted_case_id IN (${owned}))) AS ok`,
      ),
      exists(tx, sql<{ ok: boolean }>`SELECT EXISTS (${owned}) AS ok`),
      exists(
        tx,
        sql<{ ok: boolean }>`SELECT EXISTS (SELECT 1 FROM me.sizing_version s
          WHERE s.state = 'committed' AND s.case_id IN (${owned})) AS ok`,
      ),
      exists(
        tx,
        sql<{
          ok: boolean;
        }>`SELECT EXISTS (SELECT 1 FROM me.experiment e WHERE e.case_id IN (${owned})) AS ok`,
      ),
      exists(
        tx,
        sql<{ ok: boolean }>`SELECT EXISTS (SELECT 1 FROM platform.gate_request g
          WHERE g.gate_code = 'G2' AND g.submitted_at IS NOT NULL AND g.case_id IN (${owned})) AS ok`,
      ),
      exists(
        tx,
        sql<{
          ok: boolean;
        }>`SELECT EXISTS (SELECT 1 FROM platform.approval a WHERE a.approver_user_id = ${uid}) AS ok`,
      ),
      exists(
        tx,
        sql<{ ok: boolean }>`SELECT EXISTS (SELECT 1 FROM platform.task t
          JOIN platform.external_task_link l ON l.task_id = t.id
          WHERE t.owner_user_id = ${uid} AND l.sync_status = 'confirmed' AND l.external_key IS NOT NULL) AS ok`,
      ),
      exists(
        tx,
        sql<{ ok: boolean }>`SELECT EXISTS (SELECT 1 FROM platform.outcome_observation o
          WHERE o.recorded_by = ${uid}) AS ok`,
      ),
      exists(
        tx,
        sql<{ ok: boolean }>`SELECT EXISTS (SELECT 1 FROM platform.review_request r
          WHERE r.reviewer_user_id = ${uid} AND r.responded_at IS NOT NULL) AS ok`,
      ),
    ]);
  return {
    'build.shortlist': shortlist,
    'build.case': ownsCase,
    'build.sizing': sizing,
    'build.validation': validation,
    'build.submitG2': submitG2,
    'decide.decide': decided,
    'run.taskSync': taskSync,
    'run.actuals': actuals,
    'review.respond': responded,
  };
}

/**
 * The viewer's own case for "Show me" links: the open case they own that is furthest through the gates (then the
 * most recently updated), else the case of their latest task.
 */
async function ownCaseKey(tx: Tx, uid: string): Promise<string | null> {
  const r = await sql<{ key: string }>`
    SELECT key FROM (
      SELECT c.display_key AS key, 0 AS pref, c.updated_at AS at,
             (SELECT count(*) FROM platform.gate_request g WHERE g.case_id = c.id) AS gates
        FROM platform.workflow_case c
       WHERE c.owner_user_id = ${uid} AND c.stage NOT IN ('closed')
      UNION ALL
      SELECT c.display_key, 1, t.updated_at, 0 FROM platform.task t
        JOIN platform.workflow_case c ON c.id = t.case_id
       WHERE t.owner_user_id = ${uid} AND t.removed_at IS NULL
    ) x ORDER BY pref, gates DESC, at DESC LIMIT 1`.execute(tx);
  return r.rows[0]?.key ?? null;
}

async function stateFor(
  tx: Tx,
  ctx: Pick<Ctx<EndpointDef>, 'userId' | 'identity' | 'deps'>,
): Promise<OnboardingState> {
  const uid = ctx.userId;
  const path = guidePathFor(ctx.identity.roles);
  const [row, derived, caseKey] = await Promise.all([loadRow(tx, uid), derive(tx, uid), ownCaseKey(tx, uid)]);
  const s = toRowState(row);
  return {
    path,
    welcomeSeen: s.welcomeSeen,
    explainer: s.explainer,
    guideDismissed: s.guideDismissed,
    steps: composeSteps(path, derived, s.visitedSteps, { caseKey }),
    coachMarksDismissed: s.coachMarksDismissed.filter(
      (k): k is GuideStepKey => !!stepDef(path, k as GuideStepKey),
    ),
    canReset: canResetFor(ctx.identity, ctx.deps.config.authMode),
    updatedAt: row ? new Date(row.updated_at).toISOString() : null,
  };
}

function summaryOf(patch: Record<string, unknown>): string {
  const parts: string[] = [];
  if (patch.welcomeSeen) parts.push('welcome seen');
  if (patch.explainer === 'completed') parts.push('tour watched');
  if (patch.explainer === 'skipped') parts.push('tour skipped');
  if (patch.guideDismissed === true) parts.push('guide skipped');
  if (patch.guideDismissed === false) parts.push('guide resumed');
  if (patch.visitedStep) parts.push(`step ${String(patch.visitedStep)} complete`);
  if (patch.dismissCoachMark) parts.push(`coach mark ${String(patch.dismissCoachMark)} dismissed`);
  return `Getting started: ${parts.join(', ')}`;
}

export const onboardingHandlers: HandlerMap = {
  [API.onboarding.get.id]: query(API.onboarding.get, {
    authorize: (ctx) => selfOnly(ctx.identity),
    handle: (ctx, { tx }) => stateFor(tx, ctx),
  }),

  [API.onboarding.update.id]: command(API.onboarding.update, {
    authorize: (ctx) => selfOnly(ctx.identity),
    handle: async (ctx, t) => {
      const path = guidePathFor(ctx.identity.roles);
      const check = checkPatch(path, ctx.body);
      if (!check.ok) throw new ApiError('VALIDATION_FAILED', check.reason);
      // Serialize this person's changes (two tabs, a visit and a dismissal at once): read-modify-write under a
      // transaction-scoped lock so no change is lost.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`onboarding:${ctx.userId}`}))`.execute(t.tx);
      const before = toRowState(await loadRow(t.tx, ctx.userId));
      const next = applyPatch(before, ctx.body);
      const welcomeSeenAt = next.welcomeSeen ? (before.welcomeSeen ? undefined : ctx.now) : null;
      const values = {
        explainer_status: next.explainer,
        explainer_updated_at: next.explainer !== before.explainer ? ctx.now : undefined,
        guide_dismissed: next.guideDismissed,
        visited_steps: next.visitedSteps,
        coach_marks_dismissed: next.coachMarksDismissed,
        ...(welcomeSeenAt !== undefined ? { welcome_seen_at: welcomeSeenAt } : {}),
      };
      await t.tx
        .insertInto('platform.user_onboarding')
        .values({ tenant_id: ctx.tenantId, user_id: ctx.userId, ...values })
        .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doUpdateSet(values))
        .execute();
      await t.audit({
        action: 'onboarding.updated',
        objectType: 'user',
        objectId: ctx.userId,
        summary: summaryOf(ctx.body),
        details: {
          welcomeSeen: next.welcomeSeen,
          explainer: next.explainer,
          guideDismissed: next.guideDismissed,
          visitedStep: ctx.body.visitedStep ?? null,
          dismissCoachMark: ctx.body.dismissCoachMark ?? null,
        },
        before,
        after: next,
      });
      return stateFor(t.tx, ctx);
    },
  }),

  [API.onboarding.reset.id]: command(API.onboarding.reset, {
    authorize: (ctx) => {
      const self = selfOnly(ctx.identity);
      if (!self.allow) return self;
      if (!canResetFor(ctx.identity, ctx.deps.config.authMode))
        return {
          allow: false,
          rule: 'dev:onboarding_reset',
          code: 'FORBIDDEN',
          reason: 'Resetting the guide is for illustrative workspaces only.',
        };
      return { allow: true, rule: 'dev:onboarding_reset', authorityGrantId: null, role: null };
    },
    handle: async (ctx, t) => {
      const before = toRowState(await loadRow(t.tx, ctx.userId));
      await t.tx.deleteFrom('platform.user_onboarding').where('user_id', '=', ctx.userId).execute();
      await t.audit({
        action: 'onboarding.reset',
        objectType: 'user',
        objectId: ctx.userId,
        summary: 'Getting started reset (illustrative workspace)',
        before,
        after: EMPTY_ONBOARDING,
      });
      return stateFor(t.tx, ctx);
    },
  }),
};
