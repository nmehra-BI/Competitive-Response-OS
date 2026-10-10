/**
 * Query keys, typed query/command hooks, the invalidation map and polling helpers (FRONTEND §4).
 *
 * - Query key = [operationId, params, query].
 * - No optimistic updates for decisions, submissions, sends, activation or outcome decisions:
 *   commands wait for the server, then invalidate what changed.
 * - Every command declares what it invalidates (INVALIDATES). Any case-scoped command also
 *   invalidates the case header, activity and history (stage, rail and tab counts move together).
 */
import { API, ENDPOINTS, type EndpointDef, type RunStatus, type SyncStatus } from '@growth-os/contracts';
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { api, queryKey, type ApiBody, type ApiParams, type ApiQuery, type ApiResponse } from './api-client';
import { useIntent } from './idempotency';

export { queryKey };

export const STALE_DEFAULT_MS = 30_000;
/** Case header and decision package refresh faster (stage and snapshot state). */
export const STALE_FAST_MS = 10_000;
export const POLL_MS = 2_000;

const FAST = new Set<string>([API.cases.header.id, API.gates.package.id]);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_DEFAULT_MS,
        refetchOnWindowFocus: true,
        retry: (count, err) => count < 1 && !(err instanceof Error && err.name === 'ApiProblem'),
      },
      mutations: { retry: false },
    },
  });
}

// ---------------------------------------------------------------------------
// Polling (no websockets in MVP, D-026)
// ---------------------------------------------------------------------------

export const RUN_IN_FLIGHT: ReadonlySet<RunStatus> = new Set(['queued', 'running']);
export const SYNC_IN_FLIGHT: ReadonlySet<SyncStatus> = new Set(['sending', 'checking', 'retry_scheduled']);

/** `refetchInterval` that polls every 2 s while `active(data)` and stops at a terminal status. */
export function pollWhile<T>(active: (data: T) => boolean, ms = POLL_MS) {
  return (q: { state: { data: T | undefined } }) =>
    q.state.data !== undefined && active(q.state.data) ? ms : false;
}

// ---------------------------------------------------------------------------
// Invalidation map
// ---------------------------------------------------------------------------

const g = <K extends keyof typeof API>(k: K): string[] =>
  (Object.values(API[k]) as EndpointDef[]).filter((e) => e.method === 'GET').map((e) => e.id);

const CASE = [API.cases.header.id, API.cases.activity.id, API.cases.history.id, API.overview.listCases.id];
const PORTFOLIO = [API.overview.portfolio.id, API.work.reviewsInbox.id, API.work.myWork.id];
const DECISION = [...g('gates'), ...PORTFOLIO, API.gates.rail.id];
const MODELS = [...g('sizing'), ...g('economics'), API.lineage.get.id, API.assumptions.list.id];
const STALENESS = [API.gates.package.id, API.gates.rail.id, API.gates.materialChanges.id];

/** Extra cross-group effects. Same-group GETs are always invalidated. */
const EXTRA: Record<string, string[]> = {
  'auth.devLogin': ['*'],
  'auth.logout': ['*'],
  'reviews.respond': [...g('feasibility'), ...g('economics'), ...PORTFOLIO, ...CASE],
  'comments.add': CASE,
  'mandates.create': [API.overview.portfolio.id],
  'mandates.submitForG0': [...DECISION],
  'opportunities.convertToCase': [...CASE, API.overview.portfolio.id, ...g('comparisons')],
  'opportunities.merge': g('comparisons'),
  'comparisons.selectForAssessment': [...g('opportunities'), ...CASE],
  'cases.createDirect': [...CASE, API.overview.portfolio.id, ...g('mandates')],
  'cases.transition': [...CASE, ...PORTFOLIO],
  'cases.requestReview': [...PORTFOLIO],
  'thesis.commit': [...STALENESS],
  'claims.accept': [...g('thesis'), ...g('evidence')],
  'claims.challenge': [...g('thesis')],
  'sizing.commit': [...MODELS, ...STALENESS],
  'sizing.saveDraft': [API.lineage.get.id],
  'sizing.calculateDraft': [API.lineage.get.id],
  'economics.commit': [...MODELS, ...STALENESS],
  'economics.saveDraft': [API.lineage.get.id],
  'economics.calculateDraft': [API.lineage.get.id],
  'economics.requestFinanceReview': [...PORTFOLIO],
  'economics.signFinanceReview': [...PORTFOLIO, ...STALENESS],
  'feasibility.sign': [...PORTFOLIO, ...STALENESS],
  'assumptions.create': [...MODELS],
  'assumptions.update': [...MODELS, ...STALENESS],
  'assumptions.retire': [...MODELS, ...STALENESS],
  'assumptions.dispute': [...MODELS, ...PORTFOLIO],
  'challenges.reply': [...g('thesis'), ...g('evidence')],
  'challenges.resolve': [...MODELS, ...g('thesis'), ...g('evidence')],
  'experiments.create': [...STALENESS],
  'experiments.amend': [...STALENESS, ...g('taskSync')],
  'experiments.start': [...g('taskSync')],
  'experiments.recordResult': [...STALENESS, ...MODELS, ...PORTFOLIO],
  'experiments.recordDecision': [...STALENESS],
  'gates.createRequest': DECISION,
  'gates.submit': DECISION,
  'gates.refreshSnapshot': DECISION,
  'gates.withdraw': DECISION,
  'gates.decide': [...DECISION, ...g('experiments'), ...g('pilot'), ...g('taskSync'), ...g('mandates')],
  'gates.recordPosition': DECISION,
  'gates.recordDissent': DECISION,
  'conditions.markMet': [...DECISION, ...g('pilot')],
  'gates.resolveMateriality': DECISION,
  'pilot.activate': [...g('taskSync'), ...PORTFOLIO],
  'pilot.saveDraft': [...STALENESS],
  'tasks.update': [...PORTFOLIO, ...g('taskSync')],
  'tasks.reportBlocker': [...PORTFOLIO],
  'pilot.requestScopeChange': [...DECISION],
  'taskSync.preview': [...g('pilot'), ...g('experiments')],
  'taskSync.send': [...g('pilot'), ...g('experiments'), ...PORTFOLIO],
  'taskSync.retry': [...g('pilot'), ...g('experiments'), ...PORTFOLIO],
  'budget.recordEntry': [...g('pilot'), API.overview.portfolio.id],
  'outcomes.recordObservation': [...PORTFOLIO, API.gates.rail.id],
  'outcomes.decide': [...DECISION],
  'outcomes.requestExtension': [...DECISION],
  'evidence.upload': [...g('opportunities')],
  'evidence.challenge': [...g('thesis')],
  'evidence.markStale': [...STALENESS, ...MODELS],
  'evidence.replace': [...STALENESS, ...MODELS],
  'analysis.start': [...g('analysis')],
  'analysis.decideProposal': [
    ...g('thesis'),
    ...g('opportunities'),
    ...MODELS,
    ...g('experiments'),
    ...g('pilot'),
  ],
  'admin.reconnect': [...g('taskSync'), ...g('opportunities')],
  'admin.setMapping': [...g('taskSync')],
  'dev.setConnectorFaults': [...g('taskSync')],
  // Wave 4 (D-122 onward): registered here once so the streams never edit this map.
  'feasibility.addDimension': [...PORTFOLIO, ...STALENESS],
  'pilot.tripStopRule': [...PORTFOLIO],
  'tasks.addDraft': [...g('experiments'), ...PORTFOLIO],
  'tasks.editDraft': [...g('experiments'), ...PORTFOLIO],
  'tasks.removeDraft': [...g('experiments'), ...PORTFOLIO],
  'budget.reverseEntry': [...g('pilot'), API.overview.portfolio.id],
  'admin.setCommitteeMember': [...DECISION],
  'admin.setLicense': [...g('evidence')],
  'admin.setLiveAnalysis': [...g('analysis')],
  'admin.createConnection': [...g('taskSync')],
  'admin.completeAuthorization': [...g('taskSync'), ...g('pilot')],
};

const NOT_CASE_SCOPED = new Set(['auth', 'search', 'admin', 'dev', 'evidence', 'mandates', 'comparisons']);

function groupOf(id: string): keyof typeof API | undefined {
  return (Object.keys(API) as (keyof typeof API)[]).find((k) =>
    (Object.values(API[k]) as EndpointDef[]).some((e) => e.id === id),
  );
}

/** Mutation id → GET ids it invalidates ('*' = everything). Built once from the registry. */
export const INVALIDATES: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    ENDPOINTS.filter((e) => e.method !== 'GET').map((e) => {
      const group = groupOf(e.id)!;
      const set = new Set<string>([...g(group), ...(EXTRA[e.id] ?? [])]);
      if (!NOT_CASE_SCOPED.has(group)) CASE.forEach((c) => set.add(c));
      return [e.id, [...set]];
    }),
  ),
);

export async function invalidateAfter(qc: QueryClient, mutationId: string): Promise<void> {
  const targets = INVALIDATES[mutationId] ?? [];
  if (targets.includes('*')) {
    qc.clear(); // persona switch / logout: no cached content survives (FRONTEND §9)
    return;
  }
  const set = new Set(targets);
  await qc.invalidateQueries({ predicate: (q) => set.has(String(q.queryKey[0])) });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

type QOpts<D extends EndpointDef> = Omit<
  UseQueryOptions<ApiResponse<D>, Error, ApiResponse<D>, readonly unknown[]>,
  'queryKey' | 'queryFn'
>;

/** Typed GET: `useApiQuery(API.cases.header, { params: { caseRef: 'ME-104' } })`. */
export function useApiQuery<D extends EndpointDef>(
  def: D,
  args: { params?: ApiParams<D>; query?: ApiQuery<D> } = {},
  opts: QOpts<D> = {},
) {
  return useQuery({
    queryKey: queryKey(def, args.params, args.query),
    queryFn: ({ signal }) => api(def, { params: args.params, query: args.query, signal }),
    staleTime: FAST.has(def.id) ? STALE_FAST_MS : STALE_DEFAULT_MS,
    ...opts,
  });
}

export interface CommandVars<D extends EndpointDef> {
  params?: ApiParams<D>;
  body?: ApiBody<D>;
  query?: ApiQuery<D>;
  ifMatch?: number;
  /** File part for a multipart endpoint (`evidence.upload`). */
  file?: Blob;
}

/**
 * Typed command. Idempotent endpoints get one Idempotency-Key per user intent (useIntent);
 * transient failures retry with the same key. On success the invalidation map runs.
 */
export function useCommand<D extends EndpointDef>(
  def: D,
  opts: { onSuccess?: (data: ApiResponse<D>) => void } = {},
) {
  const qc = useQueryClient();
  const intent = useIntent();
  return useMutation<ApiResponse<D>, Error, CommandVars<D>>({
    mutationKey: [def.id],
    mutationFn: (vars) => {
      const call = (key?: string) =>
        api(def, {
          params: vars.params,
          body: vars.body,
          query: vars.query,
          ifMatch: vars.ifMatch,
          idempotencyKey: key,
          file: vars.file,
        });
      // A different file is a different intent (new key); the same file retries with the same key.
      const f = vars.file ? { size: vars.file.size, type: vars.file.type } : undefined;
      return def.idempotent ? intent.run({ p: vars.params, b: vars.body, f }, call) : call();
    },
    onSuccess: async (data) => {
      await invalidateAfter(qc, def.id);
      opts.onSuccess?.(data);
    },
  });
}
