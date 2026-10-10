# WS1 — Platform / DB / identity · build notes

Branch: `worktree-agent-a4ea885fba7880ad9` (based on `claude/zen-euler-ph3oag` at `4eebc3c`).
Scope: BUILD_PLAN §2 WS1 row, M1 and M2 tasks.

---

## Command pipeline (for WS4, WS5, WS6)

Every handler is built with `command()` (writes) or `query()` (reads) from
`apps/api/src/platform/pipeline.ts`, and registered by operation id in `apps/api/src/modules/index.ts`.

**Steps (in order).** 1 session: cookie → live session (401 `UNAUTHENTICATED`) and identity loaded under
RLS · 2 validate: params / query / body with the endpoint's Zod schemas (400 `VALIDATION_FAILED`,
`errors[].path` like `body.n`) · 3 human: `auth: 'human'` endpoints need an interactive human (403
`AGENT_IDENTITY_FORBIDDEN`) · 4 headers: `If-Match` required where declared (428), parsed into `ctx.ifMatch`;
`Idempotency-Key` required where declared (428), begun per (tenant, user, key) — replay of a completed
request, 409 `IDEMPOTENCY_IN_PROGRESS`, 422 `IDEMPOTENCY_KEY_REUSED` · 5 transaction: `withTenant()` →
`load(ctx, tx)` → `authorize(ctx, facts)` → `handle(ctx, tools, facts)` · 6 invariant: a command that wrote
no audit event is refused (500, rolled back) · 7 response: parsed by the endpoint's response schema (unknown
fields stripped; a contract violation is a 500), idempotent response stored in the same transaction; the key
is released if anything failed, so the same intent can be retried.

**What a handler gets.**

| `ctx` | `def`, `params`, `query`, `body`, `files` (multipart), `identity` (user, tenant, roles, authority, `subject` for the PolicyEngine, `actor`), `tenantId`, `userId`, `correlationId`, `now`, `deps` (db, objects, config), `idempotencyKey`, `ifMatch`, `setHeader()`, `setETag(rowVersion)` |
|---|---|
| `tools` (commands) | `tx` (RLS-scoped transaction), `authz` (the allow decision), `audit({ action, objectType, objectId, objectVersion?, caseId?, summary, details?, before?, after? })`, `analytics(name, { objectType, objectId, objectVersion?, caseId?, stage? }, props)`, `enqueue(job, payload)`, `emit(domainEvent)` |
| `tools` (queries) | `tx`, `authz` |

`audit` fills actor, actor kind, actor role (from `authz.role`), authz rule/grant and correlation id; it
hashes `before`/`after` (only hashes are stored) and refuses content-like detail keys (`excerpt`,
`statement`, `body`, `text` …), non-primitive values and long strings. `analytics` validates the props
against the strict PRD §17 whitelist (`AnalyticsProps`) and the envelope; any extra key is a 500 and
rolls back. `enqueue` calls `graphile_worker.add_job` inside the transaction (adds `tenantId`,
`correlationId`), so the job exists iff the change commits.

**Authorize hook.** Return an `Authorization`: `{ allow: true, rule, authorityGrantId, role? }` or
`{ allow: false, code, rule, reason }`. Hidden resources must deny with `NOT_FOUND` (the reason is never
echoed). Helpers in `platform/authz.ts`: `roleAllows(subject, action, scope, { hidden })` (frozen
`ROLE_ACTIONS` + business-unit/case scope, agents limited to `AGENT_ALLOWED_ACTIONS`), `caseVisible`,
`canReadCase`, `matchingRole`, `signedIn`. Gate decisions, self-approval, ceilings and named reviewers
belong to the WS3 `PolicyEngine`; call it from `authorize` (it receives `ctx.identity.subject`).

**Example (a WS4 command).**

```ts
import { API } from '@growth-os/contracts';
import { command, query, assertIfMatch, type HandlerMap } from '../../../platform/pipeline';
import { caseVisible, roleAllows } from '../../../platform/authz';
import { resolveCase } from '../../../platform/cases';
import { notFound } from '../../../platform/errors';

export const opportunityHandlers: HandlerMap = {
  [API.opportunities.shortlist.id]: command(API.opportunities.shortlist, {
    load: async (ctx, tx) => {
      const opp = await tx.selectFrom('me.opportunity').selectAll()
        .where('display_key', '=', ctx.params.ref).executeTakeFirst();
      if (!opp) throw notFound();                       // other tenants' rows are invisible (RLS)
      return opp;
    },
    authorize: (ctx, opp) =>
      roleAllows(ctx.identity.subject, 'opportunity.triage', { businessUnitId: /* mandate BU */ null, caseId: null }),
    handle: async (ctx, t, opp) => {
      await t.tx.updateTable('me.opportunity').set({ status: 'shortlisted' }).where('id', '=', opp.id).execute();
      await t.audit({ action: 'opportunity.shortlisted', objectType: 'opportunity', objectId: opp.id,
                      summary: `Shortlisted ${opp.display_key}`, before: { status: opp.status }, after: { status: 'shortlisted' } });
      await t.analytics('opportunity_shortlisted', { objectType: 'opportunity', objectId: opp.id }, { origin: opp.origin as 'ai' });
      return toOpportunity(opp);                        // validated against API.opportunities.shortlist.response
    },
  }),
};
```

Draft writes: `assertIfMatch(ctx, row.row_version)` → 412 `VERSION_CONFLICT` with `detail: "current version N"`;
`ctx.setETag(newRowVersion)`. Reads: `query(def, { load?, authorize, handle })`.

**Other shared helpers (apps/api/src/platform).** `cases.ts` `resolveCase(tx, ref)` (UUID or `ME-104`) ·
`pagination.ts` `pageOf` / `encodeCursor` / `decodeCursor` (HMAC-signed, tenant- and operation-bound, 24 h,
no totals) · `entitlements.ts` `entitlementFor`, `entitlementsFor`, `effectiveAccess` (excerpt /
aggregate_only / none) · `audit-read.ts` `readAudit(tx, filter)` (History tab and admin audit) ·
`materiality.ts` `findPins`, `applyMateriality(tools, change, { now, actorUserId })` (writes
material_change, impacts, stale snapshot + gate `stale`, approval invalidation + gate `invalidated`,
pauses unsent outbox rows and external task links, `approval_invalidated` analytics, audit; the case-stage
move back stays with the case machine) · `pipeline.ts` `systemTools(tx, …)` for timers (actor kind
`system`) · `errors.ts` `ApiError`, `notFound()`, `forbidden()`, `toApiError()` (Zod, Fastify, DB guard
messages → codes; 42501 → `INVALID_TRANSITION`; unknown → `INTERNAL` without details).

**Packages/db.** `withTenant`, `enqueueJob(tx, name, payload)`, `allocateDisplayKey(tx, tenantId, prefix,
isTaken)` (skips taken keys; padding ME 3, OPP 2, SRC 3, EXP 2, ASM 2, MD 2), `createObjectStore()`
(content-addressed, `.data/objects` in dev), `auditWriter` (implements the frozen `AuditWriter`; shared by
API, worker and seed), `@growth-os/db/seed` `seedAster(db, { profile, isolated })`.

**Tests.** DB-backed tests are co-located as `*.db.test.ts` and run in the `db` project. Use
`apps/api/src/platform/testing.ts`: `createTestApp()`, `seedTenant(db, profile)` (an isolated copy of Aster
with fresh ids — seed two for cross-tenant attempts), `login(app, tenant.user('maya'))`,
`call(app, API.x.y, { params, query, body, cookie, idempotencyKey: true, ifMatch })`.

---

## Decisions

Each entry: title · context · decision · alternatives · consequences. For the PE to turn into D-0xx.

1. **Session resolution through an id-only SECURITY DEFINER function.**
   Context: `platform.session` is tenant-isolated, but the tenant is unknown until the cookie is resolved.
   Decision: migration 0002 adds `platform.resolve_session(token_hash)` returning `(session_id, tenant_id,
   user_id)` for live sessions only; executable by `me_app` only. The cookie (`gos_session`, httpOnly,
   SameSite=Lax, Secure) carries 32 random bytes; only SHA-256 is stored. Alternatives: tenant id inside the
   cookie (works, but couples cookie format to tenancy and OIDC); a non-RLS session table (breaks the
   "every table has RLS" rule). Consequences: OIDC later reuses the same resolution.

2. **Dev persona login only for illustrative tenants.** Context: D-017 dev login must never reach a real
   customer tenant. Decision: `platform.dev_login_tenant(user_id)` and `platform.illustrative_tenant_id(slug)`
   answer only for `tenant.illustrative = true`; routes exist only in `AUTH_MODE=dev`; the picker lists the
   six personas (roles sponsor … specialist) in seed order, then tenant admins; agents/services are refused
   (`AGENT_IDENTITY_FORBIDDEN`). Logging in again from the same browser revokes the previous session; login
   and logout are audited. Alternatives: config allow-list of user ids. Consequences: a misconfigured
   production `AUTH_MODE=dev` still cannot enter a real tenant.

3. **Owner-only RLS policies so SECURITY DEFINER functions work (bug fix in 0001).** Context: every table
   has `FORCE ROW LEVEL SECURITY`, which applies to the owner; `platform.list_tenant_ids()` returned no rows
   and `claim_outbox_batch()` could claim nothing (verified). Decision: 0002 adds policies `TO me_owner` only
   (SELECT on tenant, app_user, session, outbox_message; UPDATE on outbox_message). `me_app` and
   `me_worker` are unaffected. Alternatives: a BYPASSRLS role (db-up cannot create it; broader). Consequences:
   WS3 timers and WS6 sweep can use the frozen functions as designed; owner-run tooling sees all rows.

4. **Job queue installed by `db:migrate`; transactional enqueue from the API.** Decision: `db:migrate` runs
   graphile-worker migrations as the owner and grants `me_app`/`me_worker` usage plus policies on graphile's
   RLS-enabled private tables. `enqueueJob(tx, …)` / `tools.enqueue` call `graphile_worker.add_job` in the
   business transaction. Consequences: no worker-side install step; `db:reset` keeps the queue schema.

5. **Idempotency semantics.** Decision: `begin` commits an `in_progress` row in its own short transaction
   (so concurrent duplicates see it); `complete` stores the response inside the business transaction;
   failures release the key (errors are not cached — the same intent may be retried after fixing the
   cause); an `in_progress` row older than 2 minutes can be taken over; request hash = SHA-256 of stable
   JSON of (operation, params, query, body, file hashes); replays carry `Idempotent-Replayed: true`.
   Alternatives: cache 4xx responses (Stripe-style) — would force a new key after every validation fix.

6. **Every command must write an audit event; restricted-text guards on audit and analytics.** Decision:
   the pipeline refuses to commit a command with no audit event (opt out only with `audit: 'none'`).
   Audit details accept primitives only and refuse content-like keys; summaries are bounded. Analytics props
   use the strict per-event whitelist; violations are 500s that roll back the whole transaction.

7. **The analytics outbox is `platform.analytics_event` itself.** Decision: events are inserted with
   `emitted_at = NULL`; the `analytics.flush` worker job delivers them to the sink (pilot: the table) and
   stamps `emitted_at` (only the worker role may update). No `outbox_message(kind='analytics.emit')` rows.
   Alternatives: double-write to outbox_message — WS6's dispatcher would then have to route analytics.

8. **Domain events (`AuditWriter.emit`) are validated and collected per transaction, not stored.**
   Context: there is no domain-event table; the audit event is the persisted record. Decision: `emit`
   validates with `DomainEvent` and keeps them in-memory for the transaction (`auditWriter.emitted(tx)`).

9. **Responses are parsed by the endpoint schema before sending.** Unknown fields are stripped (defence
   against leaking columns); a contract violation is a 500 (logged with the operation id, no details).

10. **Licence entitlement resolution.** Precedence user rows › role rows › `case_member` (any role that can
    read cases) › `*` › none (fail closed); within a level the most permissive wins. Agents/services get
    `none` here (the WS5 gateway adds run scope). A restricted or deleted source reduces access
    (`restricted` + excerpt → aggregate_only; deleted → none). Only `excerpt` returns passages and the
    quoted fact / inferred claim / human assumption panel; challenges are hidden from `none` viewers.

11. **Source visibility follows case links.** A source used by no case is tenant-level evidence (visible to
    any role with `source.read_metadata`); a source used only by cases the viewer cannot read is 404 and
    never listed, counted or returned by search. Case links are read by an app adapter
    (`modules/platform/evidence/links.ts`: sizing inputs, cohorts, claims, converted opportunities, outcome
    actuals). Admins (no case role) read no evidence: detail 404, list 403.

12. **Uploads.** `POST /evidence/sources` takes `multipart/form-data`: field `metadata` = the contract body
    (JSON), one file part. Same bytes (SHA-256) → the existing source is returned (WF-10). JSON without a file
    is refused (400). Originals live in the content-addressed object store; ingestion is queued in the same
    transaction. Uploading needs `case.edit` or `model.edit_draft` in scope.

13. **Ingestion sanitization and passage extraction.** Scripts, styles, comments, hidden elements
    (`hidden`, `aria-hidden`, `display:none`), zero-width/bidi and control characters are removed; up to 3
    paragraphs, each cut to the licence's sentence limit (0 → no passages); binary files (PDF) are stored
    but yield no passages (`partial`); hash mismatch or invalid text → `failed`. Never fabricated.

14. **Freshness thresholds.** Ageing after 365 days (licensed editions), 30 days (authorized uploads, public
    web), 90 days (internal), counted from publication (or retrieval). The daily job only moves Current →
    Ageing; Stale and Superseded are human acts because they run materiality. (Aster: SRC-021 ageing, SRC-014
    current.) Not yet a tenant policy kind — candidate for a CR if customers need different thresholds.

15. **Admin invariants.** Admins cannot change their own roles or grants; `tenant_admin` cannot be combined
    with `sponsor`/`investment_committee`; no authority grant to a tenant admin; only human principals hold
    roles/authority; publishing a policy retires the previous active version (kept); a gate policy cannot
    allow self-approval (frozen schema). Authority gaps are computed per business unit × gate from grants
    effective today. Connection health (`GET /admin/connections`) is readable by case roles too (S03, S11).

16. **Seed runner design.** One tenant transaction with RLS and all guard triggers on. Approvals in seeded
    history go through the real approval guard using a short-lived session for the approver, revoked at the
    decision time. Seeded history is written as `actor_kind 'system'` audit events dated at the fixture
    journey moments (`details.illustrative = true`). An id remap (`isolated: true`) seeds independent copies
    for tests. Display-key counters are set so the journey's conversion of OPP-07 yields ME-104 (taken keys
    are skipped by `allocateDisplayKey`).

17. **Demo engine outputs until WS2 lands.** `aster-demo` commits sizing v2 / economics v2 with the real
    engines when they are implemented; until then the output is built from the fixture's golden expectations
    and `engine_version` is suffixed `+aster-golden` (never claims an engine ran). Re-seed after WS2 lands to
    get engine lineage.

18. **Shared audit writer in `packages/db`.** The API, worker and seed must write identical audit/analytics
    rows and the worker must not import the API app, so the writer lives in `packages/db/src/audit.ts`.

19. **Co-located DB tests.** `apps/*/src/**/*.db.test.ts` run in the `db` vitest project (excluded from
    `unit`). `apps/api/test/**` stays WS4's.

20. **Cron items instead of crontab text.** graphile-worker's crontab grammar rejects dotted task names, and
    the frozen catalogue uses them; the worker converts `CRONTAB` lines to structured cron items for its
    registered tasks only (`apps/worker/src/schedule.ts`).

## Workflow updates

- **WF-10 Evidence challenge and restricted-source handling — implemented** (API + ingestion + freshness).
  Changes/additions: re-upload of the same bytes returns the existing source; uploads need multipart; admins
  get 404 on source detail. New failure paths: upload without a file → 400; licence from another tenant →
  400; mark stale on a superseded source → 409 `INVALID_TRANSITION` ("mark its replacement instead");
  replacing a source with itself → 400; replacement superseded or deleted → 409; ingestion → `failed` on
  missing object or hash mismatch, `partial` on binary files.
- **WF-06 (materiality part) — shared helper implemented** (`applyMateriality`). The classification is WS3's
  evaluator; until it lands, marking stale / replacing a source that a snapshot pins returns 500
  (`TODO(WS3)` from the evaluator). Unpinned sources work. Case-stage rollback stays with WS3/WS4.
- **WF-01 / G0 — seed only.** MD-21 v1 returned and v2 approved are seeded through the real approval guard.
- **WF-07 note.** `admin.reconnect` sets the connection to Connected but does not resume paused sync; WS6's
  outbox resumes only after its own reconcile and authorization re-check (never-rule 9/10).

## Change requests

1. **CR (WS7 client): multipart upload.** `evidence.upload`'s summary says "multipart: metadata + file" but
   the body schema has no file and `apps/web/src/lib/api-client.ts` sends JSON only. The API accepts
   `multipart/form-data` with a `metadata` JSON field and one file part. Proposal: the web client gains a
   multipart path for this endpoint (no contract change), or the contract documents the part names.
2. **CR (contracts): G0 snapshots have no case.** `SnapshotContent.caseId/caseKey` are required, but a
   standalone G0 (`gate_request.subject_type = 'mandate'`) has no case. The seed uses the mandate id and key
   (MD-21). Proposal: `subjectType`, `subjectId`, `subjectKey` (or nullable `caseId`).
3. **CR (fixture vs DB): MD-21 v1.** The fixture says v1 was returned for a missing owner and currency, but
   0001 requires every field on a committed mandate version. Seeded v1 carries the v2 values without the
   outreach exclusion. Proposal: allow returned versions to be incomplete, or adjust the fixture narrative.
4. **CR (fixture): only v2 of sizing and economics.** The fixture defines v2 only; the demo seeds version 2
   without a v1 (and SRC-011's "Sizing v1 only" impact has no row). Proposal: add v1 inputs to the fixture if
   the History tab needs them.
5. **CR (contracts/DB): access requests.** `evidence.requestAccess` has no table; requests are recorded as
   audit events (`source.access_requested`, reason truncated to 160 chars). Proposal: a
   `platform.access_request` table if licence owners need an inbox.
6. **Note for WS6:** 0002 fixes `claim_outbox_batch()`/`list_tenant_ids()` under FORCE RLS (decision 3).
7. **Note for WS3:** the job catalogue's crontab text cannot be fed to graphile-worker as-is (decision 20);
   register timer tasks in `apps/worker/src/main.ts` and they are scheduled automatically.

## Out-of-scope edits

- `vitest.config.ts`: unit project excludes `**/*.db.test.ts`; db project includes `apps/*/src/**/*.db.test.ts`;
  db timeouts raised (seeding per suite).
- `apps/api/src/server.ts`: now re-exports the bootstrap from `apps/api/src/platform/server.ts` (same exports).
- `apps/api/src/main.ts`: unchanged. `apps/api/src/modules/index.ts` †: appended six one-line registrations.
- `apps/api/package.json`: `@fastify/multipart` 9.4.0, `@growth-os/fixtures-aster` (test helpers).
- `apps/worker/package.json`: dev dependency `@growth-os/fixtures-aster` (worker DB tests).
- `apps/worker/src/main.ts` (runs WS1 tasks; other streams add theirs) and new `apps/worker/src/schedule.ts`.
- `.env.example`: `DEV_TENANT_SLUG`, `SESSION_TTL_MS`, `COOKIE_SECURE`, `MAX_UPLOAD_BYTES`.
- `packages/db/package.json`: dependencies `graphile-worker`, `@growth-os/domain`, `@growth-os/connectors`;
  export `./seed`. (`packages/db/**` is WS1's.)

## Status

**Done.**
- Migration `0002_ws1_platform_runtime.sql`; `db:migrate` also installs the job queue; `db:seed aster-start`
  and `aster-demo` (illustrative tenant); `db:reset` works end to end.
- API runtime: Fastify bootstrap over the frozen registry (dev-only routes gated, CSRF content-type check,
  correlation ids, problem+json, 404 handler, multipart), sessions, dev persona login, `withTenant` scoping,
  the command pipeline, error mapper, idempotency store, If-Match, audit + analytics writers with guards.
- Modules: auth (`auth.*`, `GET /me`), evidence (7 endpoints), search, comments, admin (12 endpoints incl.
  diagnostics), audit (`admin.audit`). 26 endpoints implemented.
- Worker: `evidence.ingest`, `evidence.freshness`, `analytics.flush`; worker boots with cron items.
- CI: lint, format, typecheck, unit, DB setup, migrate, `test:db`, `db:seed aster-demo`,
  `scripts/smoke-api.sh`, evals smoke, web build, e2e placeholder.
- Tests: unit 55 passed (+13 pre-existing `todo` golden tests owned by WS2); DB 108 passed (guards 11,
  seed 10, pipeline 23, auth 10, evidence 19, search 6, comments 5, admin 13, materiality 3, worker 8 — the
  totals in the hand-off message are from the final run).

**Left / known gaps.**
- Marking stale / replacing a source pinned by a snapshot returns 500 until WS3 implements
  `MaterialityEvaluator` (unpinned sources work; the helper is tested with a stand-in evaluator).
- OIDC login (production) not built (pilot uses dev login, D-017).
- Observability: pino redaction exists; OpenTelemetry spans, request metrics and the CI log-scrub test are
  not done yet.
- Expired idempotency records: `purgeExpiredIdempotency(tx)` exists but no scheduled job (expired keys are
  reused safely by `begin`).
- `admin.testConnection` reports stored connection state; a live probe through WS6's `TaskConnector` can
  replace it without a contract change.
- Production object storage adapter (bucket) behind `ObjectStore`; production bundling of apps.
