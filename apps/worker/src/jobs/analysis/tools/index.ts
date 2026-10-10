/**
 * Database-backed, read-only tool handlers injected into the analysis tool gateway (D-019). Each call
 * opens its own tenant transaction (RLS on, worker role) and applies the requesting human's access:
 * hidden cases and sources are "not found", restricted content is "denied · not summarised" (no
 * excerpt, summary or count), excerpts reach the model only when the licence allows model context.
 * Source text is returned only as `untrusted` passages. Nothing here writes.
 */
import type { RunScope, ScopeChecker, ToolHandler, ToolResult } from '@growth-os/ai';
import type { ToolArgs } from '@growth-os/ai';
import { withTenant, type Db, type Tx } from '@growth-os/db';
import { createEconomicsEngine, createSizingEngine } from '@growth-os/domain';
import {
  canReadCase,
  canReadMandate,
  casesByIds,
  effectiveAccess,
  loadRequester,
  resolveEntitlement,
  visibleSourceIds,
  type Requester,
} from '../access';

export const TOOL_VERSION = '1.0.0';

export interface ToolEnv {
  db: Db;
}

function inTenant<T>(env: ToolEnv, scope: RunScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(
    env.db,
    { tenantId: scope.tenantId, userId: null, correlationId: scope.correlationId },
    fn,
  );
}

/** The run's subject (case or mandate), if the requester can still read it. */
async function subjectReadable(tx: Tx, r: Requester, scope: RunScope): Promise<boolean> {
  if (scope.caseId) {
    const [c] = await casesByIds(tx, [scope.caseId]);
    return Boolean(c && canReadCase(r, c));
  }
  if (scope.mandateId) {
    const m = await tx
      .selectFrom('me.mandate')
      .select(['business_unit_id'])
      .where('id', '=', scope.mandateId)
      .executeTakeFirst();
    return Boolean(m && canReadMandate(r, { businessUnitId: m.business_unit_id }));
  }
  return false;
}

/** Tenant + identity check run by the gateway before every call. */
export function createScopeChecker(env: ToolEnv): ScopeChecker {
  return {
    async check(scope) {
      return inTenant(env, scope, async (tx) => {
        const run = await tx
          .selectFrom('platform.agent_run')
          .select(['id', 'requested_by', 'status'])
          .where('id', '=', scope.runId)
          .executeTakeFirst();
        if (!run) return { tenant: false, identity: false, reason: 'run not in this workspace' };
        if (run.requested_by !== scope.requestedByUserId)
          return { tenant: true, identity: false, reason: 'run acts for another person' };
        const r = await loadRequester(tx, scope.requestedByUserId);
        if (!r || r.kind !== 'human' || !r.active)
          return { tenant: true, identity: false, reason: 'requester is not an active person' };
        if (!(await subjectReadable(tx, r, scope)))
          return { tenant: true, identity: false, reason: 'requester can no longer read this case' };
        return { tenant: true, identity: true };
      });
    },
  };
}

async function requester(tx: Tx, scope: RunScope): Promise<Requester> {
  const r = await loadRequester(tx, scope.requestedByUserId);
  if (!r) throw new Error('requester vanished');
  return r;
}

const DENIED: ToolResult = {
  ok: false,
  code: 'denied',
  summary: 'denied · not summarised',
  entitlement: false,
};
const NOT_FOUND: ToolResult = { ok: false, code: 'not_found', summary: 'not found' };

async function accessFor(
  tx: Tx,
  r: Requester,
  rows: readonly {
    id: string;
    license_id: string | null;
    availability: string;
    deleted_at: Date | string | null;
  }[],
): Promise<Map<string, { access: ReturnType<typeof effectiveAccess>; modelContext: boolean }>> {
  const licenseIds = [...new Set(rows.map((s) => s.license_id).filter((x): x is string => x !== null))];
  const [ents, licences] = licenseIds.length
    ? await Promise.all([
        tx
          .selectFrom('platform.source_entitlement')
          .select(['license_id', 'principal_type', 'principal', 'access'])
          .where('license_id', 'in', licenseIds)
          .execute(),
        tx
          .selectFrom('platform.license')
          .select(['id', 'allow_model_context'])
          .where('id', 'in', licenseIds)
          .execute(),
      ])
    : [[], []];
  return new Map(
    rows.map((s) => {
      const licence = s.license_id
        ? resolveEntitlement(
            ents.filter((e) => e.license_id === s.license_id),
            r,
          )
        : 'none';
      return [
        s.id,
        {
          access: effectiveAccess(licence, s),
          modelContext: licences.find((l) => l.id === s.license_id)?.allow_model_context ?? false,
        },
      ];
    }),
  );
}

export function evidenceGet(env: ToolEnv): ToolHandler {
  return {
    name: 'evidence.get',
    version: TOOL_VERSION,
    run: (scope, raw) =>
      inTenant(env, scope, async (tx) => {
        const args = raw as ToolArgs<'evidence.get'>;
        const r = await requester(tx, scope);
        const src = await tx
          .selectFrom('platform.source')
          .select([
            'id',
            'display_key',
            'title',
            'publisher',
            'published_on',
            'freshness',
            'license_id',
            'availability',
            'deleted_at',
          ])
          .where(args.sourceId ? 'id' : 'display_key', '=', (args.sourceId ?? args.sourceKey)!)
          .executeTakeFirst();
        if (!src || !(await visibleSourceIds(tx, r, [src.id])).has(src.id)) return NOT_FOUND;
        const a = (await accessFor(tx, r, [src])).get(src.id)!;
        if (a.access === 'none') return DENIED;
        const meta = {
          id: src.id,
          key: src.display_key,
          title: src.title,
          publisher: src.publisher,
          publishedOn: src.published_on,
          freshness: src.freshness,
        };
        if (a.access !== 'excerpt' || !a.modelContext)
          return {
            ok: true,
            data: { source: meta, access: 'aggregate_only', passages: [] },
            summary: 'aggregate only · no excerpts',
            evidenceIds: [],
            entitlement: false,
          };
        const passages = await tx
          .selectFrom('platform.evidence_passage')
          .select(['id', 'locator', 'excerpt'])
          .where('source_id', '=', src.id)
          .orderBy('created_at')
          .limit(5)
          .execute();
        return {
          ok: true,
          data: {
            source: meta,
            access: 'excerpt',
            passages: passages.map((p) => ({ id: p.id, locator: p.locator })),
          },
          summary: `${passages.length} passage${passages.length === 1 ? '' : 's'}`,
          evidenceIds: [src.id, ...passages.map((p) => p.id)],
          untrusted: passages.map((p) => ({
            evidenceId: p.id,
            sourceId: src.id,
            sourceKey: src.display_key,
            text: p.excerpt,
          })),
          entitlement: true,
        };
      }),
  };
}

const words = (q: string) =>
  q
    .toLowerCase()
    .split(/[^a-z0-9äöüß-]+/)
    .filter((w) => w.length >= 4);

async function connectionUnavailable(tx: Tx, kind: 'trade_registry' | 'crm' | 'market_data') {
  const c = await tx
    .selectFrom('platform.connection')
    .select(['name', 'status'])
    .where('kind', '=', kind)
    .executeTakeFirst();
  return !c || c.status !== 'connected' ? (c?.name ?? kind) : null;
}

export function intelligenceSearch(env: ToolEnv): ToolHandler {
  return {
    name: 'intelligence.search',
    version: TOOL_VERSION,
    run: (scope, raw) =>
      inTenant(env, scope, async (tx) => {
        const args = raw as ToolArgs<'intelligence.search'>;
        if (args.connection === 'trade_registry') {
          const down = await connectionUnavailable(tx, 'trade_registry');
          if (down)
            return {
              ok: false,
              code: 'connector_unavailable',
              summary: `${down} unavailable · not searched`,
            };
          return { ok: true, data: { hits: [] }, summary: '0 registry records', evidenceIds: [] };
        }
        const r = await requester(tx, scope);
        const rows = await tx
          .selectFrom('platform.source')
          .select([
            'id',
            'display_key',
            'title',
            'published_on',
            'freshness',
            'license_id',
            'availability',
            'deleted_at',
          ])
          .execute();
        const visible = await visibleSourceIds(
          tx,
          r,
          rows.map((s) => s.id),
        );
        const access = await accessFor(tx, r, rows);
        // Restricted, deleted and unentitled sources are excluded before ranking (never counted).
        const terms = words(args.query);
        const hits = rows
          .filter((s) => visible.has(s.id) && access.get(s.id)!.access !== 'none')
          .map((s) => ({ s, score: terms.filter((t) => s.title.toLowerCase().includes(t)).length }))
          .filter((h) => h.score > 0)
          .sort((a, b) => b.score - a.score || a.s.display_key.localeCompare(b.s.display_key))
          .slice(0, args.limit)
          .map(({ s }) => ({
            id: s.id,
            key: s.display_key,
            title: s.title,
            publishedOn: s.published_on,
            freshness: s.freshness,
            access: access.get(s.id)!.access,
          }));
        return {
          ok: true,
          data: { hits },
          summary: `${hits.length} document${hits.length === 1 ? '' : 's'}`,
          evidenceIds: hits.map((h) => h.id),
          entitlement: true,
        };
      }),
  };
}

export function portfolioGetProduct(env: ToolEnv): ToolHandler {
  return {
    name: 'portfolio.get_product',
    version: TOOL_VERSION,
    run: (scope, raw) =>
      inTenant(env, scope, async (tx) => {
        const args = raw as ToolArgs<'portfolio.get_product'>;
        let productId = args.productId ?? null;
        if (!productId) {
          let mandateId = scope.mandateId;
          if (!mandateId && scope.caseId) {
            const c = await tx
              .selectFrom('platform.workflow_case')
              .select('mandate_id')
              .where('id', '=', scope.caseId)
              .executeTakeFirst();
            mandateId = c?.mandate_id ?? null;
          }
          if (mandateId) {
            const v = await tx
              .selectFrom('me.mandate as m')
              .innerJoin('me.mandate_version as v', 'v.id', 'm.current_version_id')
              .select('v.product_id')
              .where('m.id', '=', mandateId)
              .executeTakeFirst();
            productId = v?.product_id ?? null;
          }
        }
        if (!productId) return NOT_FOUND;
        const p = await tx
          .selectFrom('platform.product')
          .select(['id', 'key', 'name', 'description'])
          .where('id', '=', productId)
          .executeTakeFirst();
        if (!p) return NOT_FOUND;
        return { ok: true, data: { product: p }, summary: `product ${p.key}`, evidenceIds: [] };
      }),
  };
}

export function crmAccounts(env: ToolEnv): ToolHandler {
  return {
    name: 'crm.get_authorized_accounts',
    version: TOOL_VERSION,
    run: (scope) =>
      inTenant(env, scope, async (tx) => {
        const down = await connectionUnavailable(tx, 'crm');
        return {
          ok: false,
          code: 'connector_unavailable',
          summary: down ? `${down} not connected` : 'CRM accounts are not available in the MVP',
        };
      }),
  };
}

export function sizingCalculate(): ToolHandler {
  const engine = createSizingEngine();
  return {
    name: 'sizing.calculate',
    version: TOOL_VERSION,
    async run(_scope, raw) {
      const out = await engine.calculate(raw as ToolArgs<'sizing.calculate'>);
      const blocking = out.checks.filter((c) => c.blocking);
      const sam = out.ladder.sam;
      const summary = out.blocked
        ? `blocked · ${blocking.map((c) => c.key).join(', ')}`
        : sam.available === false
          ? 'SAM not available'
          : `SAM ${sam.population} sites · ${sam.value.amount} ${sam.value.currency}/year · reproducible`;
      return {
        ok: true,
        data: {
          engine: out.engine,
          engineVersion: out.engineVersion,
          inputHash: out.inputHash,
          blocked: out.blocked,
          checks: out.checks.map((c) => ({ key: c.key, blocking: c.blocking, message: c.message })),
          ladder: out.blocked ? { tam: out.ladder.tam, sam: out.ladder.sam } : out.ladder,
          crossCheck: out.crossCheck,
        },
        summary,
        evidenceIds: [],
      };
    },
  };
}

export function economicsCalculate(): ToolHandler {
  const engine = createEconomicsEngine();
  return {
    name: 'economics.calculate',
    version: TOOL_VERSION,
    async run(_scope, raw) {
      const out = await engine.calculate(raw as ToolArgs<'economics.calculate'>);
      const base = out.scenarios.find((s) => s.scenario === 'base');
      return {
        ok: true,
        data: {
          engine: out.engine,
          engineVersion: out.engineVersion,
          inputHash: out.inputHash,
          blocked: out.blocked,
          checks: out.checks.map((c) => ({ key: c.key, blocking: c.blocking, message: c.message })),
          scenarios: out.scenarios,
          oneTimeInvestment: out.oneTimeInvestment,
          cashFlow: out.cashFlow,
          payback: out.payback,
          breakEven: out.breakEven,
          exclusionsText: out.exclusionsText,
        },
        summary: out.blocked
          ? 'blocked · recommendation incomplete'
          : `base ${base?.customers ?? 'n/a'} customers · reproducible`,
        evidenceIds: [],
      };
    },
  };
}

export function workPreviewTasks(env: ToolEnv): ToolHandler {
  return {
    name: 'work.preview_tasks',
    version: TOOL_VERSION,
    run: (scope, raw) =>
      inTenant(env, scope, async (tx) => {
        const args = raw as ToolArgs<'work.preview_tasks'>;
        const ownerIds = [
          ...new Set(args.tasks.map((t) => t.ownerId).filter((x): x is string => x !== null)),
        ];
        const owners = ownerIds.length
          ? await tx
              .selectFrom('platform.app_user')
              .select(['id', 'display_name', 'kind', 'is_active'])
              .where('id', 'in', ownerIds)
              .execute()
          : [];
        const titles = new Set(args.tasks.map((t) => t.title));
        const tasks = args.tasks.map((t) => {
          const owner = owners.find((o) => o.id === t.ownerId);
          const issues: string[] = [];
          if (!t.ownerId) issues.push('Owner needed');
          else if (!owner || owner.kind !== 'human' || !owner.is_active)
            issues.push('Owner is not an active person');
          for (const d of t.dependsOnTitles) if (!titles.has(d)) issues.push(`Unknown dependency: ${d}`);
          return {
            title: t.title,
            function: t.function,
            ownerId: t.ownerId,
            ownerName: owner?.display_name ?? null,
            dueOffsetDays: t.dueOffsetDays,
            issues,
          };
        });
        const withIssues = tasks.filter((t) => t.issues.length > 0).length;
        return {
          ok: true,
          data: { dryRun: true, writes: 0, tasks },
          summary: `${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${withIssues} need${withIssues === 1 ? 's' : ''} attention · nothing written`,
          evidenceIds: [],
        };
      }),
  };
}

export function createToolHandlers(env: ToolEnv): ToolHandler[] {
  return [
    intelligenceSearch(env),
    evidenceGet(env),
    portfolioGetProduct(env),
    crmAccounts(env),
    sizingCalculate(),
    economicsCalculate(),
    workPreviewTasks(env),
  ];
}
