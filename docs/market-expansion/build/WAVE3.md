# Wave 3 brief — API modules, analysis, connector/outbox

**From:** Principal Engineer · **Date:** 9 October 2026 · **Base:** branch from the integrated head of
`claude/zen-euler-ph3oag` that contains this file (Wave 1 = WS1, WS2, WS3, WS7 merged and green).
**Read first:** `/CLAUDE.md`, the shared build brief, `decisions.md` D-031 and **D-032…D-060** (Wave 1),
`artifacts.md` (build status per workflow), BUILD_PLAN §2–§8, and the notes your stream depends on:
`docs/market-expansion/build/notes/WS1.md` (pipeline), `WS2.md` (engines), `WS3.md` (machines, policy,
materiality, snapshots).

Four streams run in parallel: **WS4a**, **WS4b**, **WS5**, **WS6**. WS8a–d (screens) are already running
against MSW and switch to your endpoints as they land.

---

## 1. State of the integrated head

- 144 endpoints in the registry (D-037 added `cases.members`); **26 have handlers** (WS1: `auth.*`, `search.query`,
  `comments.add`, `evidence.*`, `admin.*`). The other **118** answer `500 INTERNAL "Not implemented yet: <id>"`.
  This brief assigns all 118: WS4a 64, WS4b 38, WS5 9, WS6 7.
- Domain is done and tested: engines (`createSizingEngine`, `createEconomicsEngine`, `createRankingEngine`),
  machines (`caseMachine`, `mandateMachine`, `opportunityMachine`, `experimentMachine`, `gateRequestMachine`,
  `snapshotMachine`, `syncMachine`, `runMachine`), `createPolicyEngine`, `evaluateGate`, `createSnapshot`,
  `createMaterialityEvaluator`, `followOnForGate` — all from `@growth-os/domain`.
- Platform runtime (`apps/api/src/platform/`, PE-owned now that WS1 has finished): `command()`, `query()`,
  `assertIfMatch`, `systemTools` (`pipeline.ts`); `roleAllows`, `caseVisible`, `canReadCase` (`authz.ts`);
  `resolveCase`, `casesByIds` (`cases.ts`); `pageOf`, cursors (`pagination.ts`); `entitlementFor`,
  `effectiveAccess` (`entitlements.ts`); `readAudit` (`audit-read.ts`); `findPins`, `applyMateriality`
  (`materiality.ts`); `ApiError`, `notFound`, `forbidden` (`errors.ts`); test helpers `createTestApp`,
  `seedTenant`, `login`, `call`, `pathOf` (`testing.ts`).
- Seeds: `aster-start` (approved MD-21, detected opportunities, people, authority, policies, licences, sources,
  connections; **no ME-104**) and `aster-demo` (ME-104 at Pilot approval pending, G2 v3 awaiting Elena,
  sizing v2/economics v2 from the real engines, EXP-03 with amendment and results, VAL-1…5 confirmed).
  In tests always use `seedTenant(db, profile)` (isolated copy with fresh ids); seed two tenants for
  cross-tenant attempts.

## 2. Rules for every Wave 3 stream

1. **Every handler** is `command()` or `query()` from `apps/api/src/platform/pipeline.ts` (D-042). `load` reads under RLS
   and throws `notFound()` for anything missing or hidden; `authorize` returns the policy decision (gates use the
   `PolicyEngine`, everything else `roleAllows`/`caseVisible`); `handle` applies the **machine** first and maps a
   refusal with `throw new ApiError(r.code, …, { blockers: r.failed })`; then writes state + `t.audit` +
   `t.analytics` (exactly the PRD §17 event the transition table lists) + `t.enqueue` in the same transaction.
2. **Never** compute money outside the engines (D-054). Never sum per-year with one-time money, never total market
   measures, never write 0 for missing (use Unavailable; honour `ladder.sam.available`, D-033).
3. **Machines decide, the database double-checks.** Use `machine.apply()`; use `machine.evaluate()` to return
   disabled buttons with reasons. When a gate follow-on targets the stage the case is already in, skip the case
   move (D-035). Pass `asOf` (tenant-local date, Europe/Berlin) in `PolicySubject` for authority checks (D-045).
4. **Materiality** (D-047): every commit that creates a new version of something a snapshot can pin calls
   `applyMateriality(t, { changeType, objectType, objectId, componentType, fromVersion, toVersion,
   decisionCritical?, label })` in the same transaction. `componentType` is the `SnapshotContent.components[].type`
   and `objectId` is the **previously committed** id that snapshots pin (e.g. the old `assumption_version` id).
   Then, if `result.caseStage` is set, the stage already moved; do not move it again.
5. **Snapshots**: build only with `createSnapshot()`; insert `content_canonical`/`content_hash` from its result and
   one `snapshot_component` row per component; always set `subject` (D-036).
6. **Tests** are co-located `*.db.test.ts` inside your module folders (run by `pnpm test:db`); pure helpers get
   `*.test.ts`. Each handler test includes a **cross-tenant attempt (404)** and an **unauthorized-role attempt
   (403/404 with the right code)**, asserts the audit action and the analytics event (and that neither contains
   restricted text), and covers `Idempotency-Key` replay / `If-Match` 412 where the endpoint declares them.
   Responses are already validated by the pipeline; also `Schema.parse(res.json())` in tests.
7. **Shared files (†, one line each, keep both sides on conflict):** `apps/api/src/modules/index.ts` (one spread per
   module), `apps/worker/src/tasks.ts` (WS5, WS6), `vitest.config.ts` (WS6 only, §6). Do not edit
   `apps/api/src/platform/**`, `packages/domain/**`, `packages/db/**`, `packages/contracts/**`, migrations or
   `fixtures/aster/**`. If you need a helper or a contract change, write it as a CR in your notes; a tiny
   compile-only edit goes under "Out-of-scope edits".
8. **Notes:** `docs/market-expansion/build/notes/<WS4a|WS4b|WS5|WS6>.md` with Decisions, Workflow updates, Change
   requests, Out-of-scope edits, Status (same format as Wave 1). Do not edit `decisions.md` or `artifacts.md`.
9. **Done means:** `pnpm install && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm db:migrate
   && pnpm test:db` green on your DB; WS5 also `pnpm evals:smoke`; WS6 also the fault suite. Commit in logical
   commits on your worktree branch with the two trailer lines; do not push.

**Database per stream** (already created with pgcrypto and grants; export all three URLs in every DB command):

| Stream | DB | Env |
|---|---|---|
| WS4a | `growth_os_ws4` | `DATABASE_URL=postgres://me_app:me_app_dev@localhost:5432/growth_os_ws4`, `DATABASE_OWNER_URL=postgres://me_owner:me_owner_dev@…/growth_os_ws4`, `DATABASE_WORKER_URL=postgres://me_worker:me_worker_dev@…/growth_os_ws4` |
| WS4b | `growth_os_ws4b` | same pattern |
| WS5 | `growth_os_ws5` | same pattern |
| WS6 | `growth_os_ws6` | same pattern |

Then `pnpm db:migrate` (applies 0001–0003 and the job queue). For manual runs: `pnpm db:seed aster-start` or
`aster-demo`; `pnpm --filter @growth-os/db run reset` drops your DB's schemas (your DB only).

---

## 3. WS4a — API: discover and assess (64 endpoints)

**Owns (writes):** `apps/api/src/modules/me/{overview,mandates,opportunities,comparisons,cases,thesis,sizing,lineage,feasibility,economics,assumptions}/**`
and one line per module in `apps/api/src/modules/index.ts`. Reads anything.

**Endpoints (exact registry ids):**

| Module folder | Endpoint ids |
|---|---|
| `me/overview` | `overview.portfolio` |
| `me/cases` | `cases.list`, `cases.createDirect`, `cases.header`, `cases.transition`, `cases.members`, `cases.activity`, `cases.history`, `cases.requestReview` |
| `me/mandates` | `mandates.list`, `mandates.create`, `mandates.get`, `mandates.saveDraft`, `mandates.submitForG0` |
| `me/opportunities` | `opportunities.list`, `opportunities.get`, `opportunities.createManual`, `opportunities.shortlist`, `opportunities.dismiss`, `opportunities.merge`, `opportunities.restore`, `opportunities.convertToCase` |
| `me/comparisons` | `comparisons.create`, `comparisons.get`, `comparisons.previewRanking`, `comparisons.applyWeights`, `comparisons.setExclusion`, `comparisons.selectForAssessment` |
| `me/thesis` | `thesis.get`, `thesis.saveDraft`, `thesis.commit`, `claims.create`, `claims.accept`, `claims.discard`, `claims.challenge` |
| `me/sizing` | `sizing.get`, `sizing.saveDraft`, `sizing.calculateDraft`, `sizing.resolveDuplicateCohort`, `sizing.commit`, `sizing.getVersion`, `sizing.compareVersions`, `sizing.population` |
| `me/lineage` | `lineage.get` |
| `me/feasibility` | `feasibility.get`, `feasibility.sign`, `feasibility.recordDisagreement`, `feasibility.resolveBlocker` |
| `me/economics` | `economics.get`, `economics.saveDraft`, `economics.calculateDraft`, `economics.whatMustBeTrue`, `economics.commit`, `economics.requestFinanceReview`, `economics.signFinanceReview`, `economics.export` |
| `me/assumptions` | `assumptions.list`, `assumptions.create`, `assumptions.update`, `assumptions.versions`, `assumptions.retire`, `assumptions.dispute`, `challenges.reply`, `challenges.resolve` |

**Domain and platform APIs to use.**
- Mandates: `mandateMachine` (`submit` lists `owner_set` + `currency_set` failures together), `evaluateGate({ gateCode: 'G0', … })`
  for the G0 preconditions on submit, `createSnapshot()` with `subject: { type: 'mandate', … }`, `gateRequestMachine.apply('draft','submit',…)`.
  `mandates.submitForG0` creates the G0 gate request and snapshot; **deciding** G0 is WS4b's `gates.decide`.
- Opportunities: `opportunityMachine` (shortlist/dismiss need reasons where the table says; merge keeps both; convert needs a
  G0-approved mandate → `PRECONDITIONS_UNMET` otherwise); convert creates `workflow_case` in `discovery` with
  `allocateDisplayKey(tx, tenantId, 'ME', …)` so OPP-07 → ME-104 on `aster-start`; analytics `opportunity_shortlisted`.
- Comparisons: `createRankingEngine()` (D-057). Unknown cells are `null`, never 0.
- Cases: `caseMachine` for `cases.transition` (`start_assessment`, `hold` storing `held_from_stage`, `resume`, `stop` needs
  `stopAuthority` = `policy.check(subject,'case.stop',case).allow` — sponsor or investment committee, D-034, `close`);
  `cases.header` builds the gate rail with `deriveGateDisplayStatus()`; `cases.history`/`activity` use `readAudit()`;
  `cases.members` per D-037 (human principals with a role reaching the case + `case_participant`; no agents/services;
  admins only with a case role).
- Sizing/economics: `createSizingEngine().calculate()` / `createEconomicsEngine().calculate()` → insert
  `platform.calculation_result` (engine, version, input hash) → draft children; commit needs an unblocked result (DB CHECK).
  Lineage: `lineageView()`, `usedByTransitive()`, `mergeLineage()`; `lineage.get.usedBy` comes from `lineageView` (D-056).
  Money only through `sizing/numeric.ts` helpers (D-054).
- Commits call `applyMateriality` (rule 4): `sizing.commit` → `componentType 'sizing_version'`, `changeType
  'model_version_changed'`; `economics.commit` → `'economics_version'`, `'model_version_changed'`; `assumptions.update`
  (value change creates a version) → `'assumption_version'`, `'decision_critical_assumption_changed'` with
  `decisionCritical` from the assumption and `label` e.g. "adoption assumption"; `thesis.commit` → `'thesis_version'`;
  `feasibility.sign` scope changes → `'feasibility_review'`, `'specialist_scope_changed'`.
- Feasibility sign-off writes a structured `SignOffScope` (`coversGate`, `maxSites`, `maxDays`) — Lena's sign-off is
  "pilot only: up to 4 sites, 90 days" and must never cover G3 (D-045). `review.sign` only by the named reviewer.
- Finance review (`economics.signFinanceReview`) records checked / not checked lists.

**Seed profiles:** `aster-start` for the journey writes (steps 2–9, 15–16, 19); `aster-demo` for reads of committed
history (sizing v2, economics v2, dispute, feasibility) and for step 19 (G2 v3 awaiting decision).

**Acceptance steps and the tests that prove them** (one `it()` per row, named with the step number):

| Step | Test file | Proves |
|---|---|---|
| 2 | `me/opportunities/opportunities.db.test.ts` | list for MD-21: OPP-07 "Proposed · AI" origin, OPP-12 likely duplicate of OPP-07 (`discoveryPartial` comes from the seeded run) |
| 3 | same | merge OPP-12 → OPP-07 (both kept, linked); shortlist OPP-07; `opportunity_shortlisted`; replay with same key |
| 4 | `me/comparisons/comparisons.db.test.ts` | Austrian breweries blocks ranking until excluded; Unknown cells null; OPP-14 "Not ranked — 1 input missing" |
| 5 | `me/opportunities/opportunities.db.test.ts` | convert OPP-07 (owner Maya) → ME-104 stage Discovery; rail G0 Approved; convert before G0 → `PRECONDITIONS_UNMET` |
| 6 | `me/sizing/sizing.db.test.ts` | ladder TAM 5,000 · €100m/year, SAM 2,000 · €40m/year, reachable 500 (no money), SOM Base 100 · €2.0m; no total row |
| 7 | same | draft TAM 500 → blocking "SAM is larger than TAM"; commit refused; undo restores |
| 8 | same + `me/lineage/lineage.db.test.ts` | commit v2 (`sizing_snapshot_created`); lineage SAM exact €40,000,000, inputs one level, used by SOM and economics |
| 9 | `me/assumptions/assumptions.db.test.ts`, `me/economics/economics.db.test.ts` | Daniel disputes 20% with 10%; Downside 10%; scenario table €1.0m/€2.0m/€2.4m … €0k (break-even); €400k one-time separate; cash flow/payback Unavailable; `assumption_changed` |
| 15 | `me/feasibility/feasibility.db.test.ts` | Lena signs "pilot only: up to 4 sites, 90 days" (`coversGate G2`); someone else → 403 |
| 16 | `me/economics/economics.db.test.ts` | Daniel signs finance review with checked/not-checked lists |
| 19 | `me/assumptions/assumptions.db.test.ts` (on `aster-demo`) | Base adoption new version → G2 v3 `stale` with "adoption assumption changed on …"; `material_change` + audit; approval stays possible only after WS4b refresh |
| 30 | `me/cases/cases.db.test.ts` | history lists the seeded and new events once each in audit order with actor and version |
| — | `me/cases/cases.db.test.ts` | `cases.members` for ME-104 (no agent, no admin-only); `cases.transition stop` by sponsor and IC allowed, by Maya refused |
| — | `apps/api/test/db/security/tenancy.test.ts` (WS4a owns) | every WS4a endpoint with another tenant's ref → 404; no session → 401 |

**Hand-offs:** export read serializers WS4b needs (e.g. committed sizing/economics/thesis summaries for snapshot content)
from `me/<module>/read.ts`; export `createOpportunityFromProposal` and `createClaimFromProposal` writers from
`me/opportunities/writers.ts` and `me/thesis/writers.ts` for WS5 (they run inside the caller's pipeline `tools`).

---

## 4. WS4b — API: decide, execute, review (38 endpoints)

**Owns (writes):** `apps/api/src/modules/me/{experiments,gates,pilot,budget,outcomes}/**`,
`apps/api/src/modules/platform/{reviews,work}/**`, `apps/api/test/db/security/approval.test.ts`, one line per module in
`apps/api/src/modules/index.ts`.

**Endpoints (exact registry ids):**

| Module folder | Endpoint ids |
|---|---|
| `me/experiments` | `experiments.list`, `experiments.create`, `experiments.updateDraft`, `experiments.amend`, `experiments.start`, `experiments.recordResult`, `experiments.recordDecision` |
| `me/gates` (gate requests, snapshots, decisions, positions, dissent, conditions, material changes) | `gates.preconditions`, `gates.createRequest`, `gates.get`, `gates.submit`, `gates.refreshSnapshot`, `gates.withdraw`, `gates.package`, `gates.snapshotDiff`, `gates.decide`, `gates.recordPosition`, `gates.recordDissent`, `conditions.markMet`, `gates.materialChanges`, `gates.resolveMateriality` |
| `me/pilot` | `pilot.get`, `pilot.saveDraft`, `pilot.activate`, `tasks.update`, `tasks.reportBlocker`, `pilot.requestScopeChange`, `pilot.messageDrafts`, `pilot.updateMessageDraft` |
| `me/budget` | `budget.recordEntry` |
| `me/outcomes` | `outcomes.get`, `outcomes.recordObservation`, `outcomes.saveReviewDraft`, `outcomes.decide`, `outcomes.requestExtension` |
| `platform/reviews` | `reviews.inbox`, `reviews.respond` |
| `platform/work` | `work.mine` |

**Domain and platform APIs to use.**
- Gates: `evaluateGate()` (G1/G2/G3/X facts loaded from committed records; G3 lists every unmet precondition, D-039;
  X with `capPlaceholder: true` may be submitted, never approved, D-040); `createSnapshot()` + `nextSnapshotVersion()`;
  `diffSnapshotContent()` for `gates.snapshotDiff`; `gateRequestMachine` for submit/refresh (old snapshot → `supersede`
  via `snapshotMachine`)/withdraw/decide; `followOnForGate()` → `caseMachine`/`mandateMachine`/experiment `lock`.
- `gates.decide`: `policy.gateDecisionChecks(subject, resource)` and `policy.approvalPanel()`; facts `snapshot`,
  `decision {snapshotId, snapshotHash, conditions}`, `requiredSignOffs`; insert `platform.approval` (the DB guard re-checks
  session, current snapshot, hash, grant, not self); set `expires_at` from the gate policy (default 14 days);
  conditions C1 (blocks execution) / C2 (monitor). Errors in this order: `AGENT_IDENTITY_FORBIDDEN`, `SNAPSHOT_STALE`,
  `SNAPSHOT_HASH_MISMATCH`, `FORBIDDEN` (admin), `SELF_APPROVAL_PROHIBITED`, `CONFLICT_OF_INTEREST`,
  `AUTHORITY_INSUFFICIENT`, `PRECONDITIONS_UNMET` (D-046).
- `gates.resolveMateriality`: `createMaterialityEvaluator().resolveEscalation(…)` by sponsor/IC (`materiality.resolve`);
  apply the returned `gateCommands`/invalidations the same way `applyMateriality` does (ask the PE for a shared
  `applyResolution` helper in `platform/materiality.ts` if you need one — CR in notes).
- Experiments: `experimentMachine` (lock comes only from the G1 follow-on; amendments are new plan versions with a reason,
  the original stays visible; results are append-only versions with period and source; `experiment_completed`).
- Pilot: `caseMachine.apply('pilot_approved','pilot_activated', …, { approval, blockingConditionsMet, allTasksOwned })`
  — activation reports missing owner and open C1 together; activation creates/locks the `platform.task_set`
  (`owner_type 'pilot_plan_version'`, `authorizing_gate_request_id` = G2) and its `platform.task` rows. **WS4b never sends
  tasks**: preview/send/retry are WS6. Scope change (`pilot.requestScopeChange`) commits a new pilot plan version and calls
  `applyMateriality` with `componentType 'pilot_plan_version'`, `changeType 'spend_ceiling_changed'` or
  `'plan_tasks_changed'`. Message drafts stay drafts (never-rule 14; there is no send).
- Outcomes: observations append-only with period and source, compared to the thresholds in the approved G2 snapshot;
  `outcomes.decide` → `caseMachine` `outcome_revise_or_extend` / `outcome_stop` (needs `reviewAuthority`);
  `outcomes.requestExtension` creates gate request X1 (`extension_requested`); "scale" as an outcome → 400.
- Reviews inbox: review requests (from WS4a `cases.requestReview`) and gate requests awaiting the viewer's decision,
  scoped by `approvalPanel().canDecide`; `work.mine` lists the viewer's tasks/reviews/conditions.

**Seed profiles:** `aster-demo` for G2 v3 decisions, stale/refresh, conditions, activation, outcomes; `aster-start` +
WS4a's endpoints (or direct fixture inserts in test setup until WS4a lands) for the G1 path.

**Acceptance steps and the tests that prove them:**

| Step | Test file | Proves |
|---|---|---|
| 10 | `me/experiments/experiments.db.test.ts`, `me/gates/gates.db.test.ts` | EXP-03 created (20 sites, ≥ 8, ≥ 4, €15k); G1 submit → snapshot v1 hashed; preconditions met |
| 11 | `platform/reviews/reviews.db.test.ts`, `me/gates/gates.db.test.ts` | Elena's inbox shows "Approve validation €15k"; approve → stage Validation, EXP-03 locked, `validation_authorized` + `gate_approved` |
| 13 | `me/experiments/experiments.db.test.ts` | amendment 1 to 20 Nov with reason; original plan kept as "Original (pre-registered)"; editing a locked plan → `INVALID_TRANSITION` |
| 14 | same | results 9/4 with period and source → Met · 9 of 8, Met · 4 of 4; `experiment_completed`; no period → 400 |
| 17 | `me/gates/gates.db.test.ts` | G2 package v3 (pilot €120k, 90 days, Jonas, stop rules, C1 proposed) with fingerprint and Daniel's dissent; stage Pilot approval pending; `gate_submitted` |
| 18 | `apps/api/test/db/security/approval.test.ts` | Maya forcing a decision → `SELF_APPROVAL_PROHIBITED`; admin → `FORBIDDEN`; agent → `AGENT_IDENTITY_FORBIDDEN`; above ceiling → `AUTHORITY_INSUFFICIENT`; wrong hash → `SNAPSHOT_HASH_MISMATCH` |
| 19 | `me/gates/gates.db.test.ts` | on a stale v3: decide → `SNAPSHOT_STALE`; `gates.refreshSnapshot` → v4 current, v3 superseded; `gates.snapshotDiff` shows the adoption change |
| 20 | same | Elena approves "Approve pilot €120k · 90 days" on v4 with C1 (blocks execution) and C2 (monitor) → Pilot approved, `expires_at` set, `gate_approved` |
| 21–22 | `me/pilot/pilot.db.test.ts` | activation blocked by unowned task 2 and open C1 (both listed); assign owner + `conditions.markMet` → activated, `pilot_activated`, task set created for WS6 |
| 25 | `me/outcomes/outcomes.db.test.ts` | actuals 3 of 4 paid use (billing), effort above (effort log), buyer fit mixed → Not met · Not met · Inconclusive; `outcome_recorded` |
| 26–27 | same | review draft with causal limitations; Elena "Revise and extend" → stage Validation; X1 Awaiting decision with `€[cap]`; `extension_requested`; X1 approve → refused (no amount) |
| 28 | `me/gates/gates.db.test.ts` | G3 request → 409 `PRECONDITIONS_UNMET` with four blockers and the D-039 summary |
| 29 | `apps/api/test/db/security/approval.test.ts` | admin decides any gate → `FORBIDDEN` |
| — | `me/pilot/pilot.db.test.ts` | scope change after activation → G2 invalidated, unsent outbox rows paused, confirmed tasks preserved, case → Pilot approval pending |
| — | each module test | cross-tenant 404 and unauthorized-role attempt for every WS4b endpoint |

---

## 5. WS5 — AI and analysis (9 endpoints + harness, skills, evals)

**Owns (writes):** `packages/ai/**`, `skills/**`, `evals/**`, `apps/worker/src/jobs/analysis/**`,
`apps/api/src/modules/analysis/**`, one line in `apps/api/src/modules/index.ts`, one line in `apps/worker/src/tasks.ts`.

**Endpoints:** `analysis.start`, `analysis.get`, `analysis.latestForCase`, `analysis.cancel`, `analysis.resume`,
`analysis.provideInput`, `analysis.proposals`, `analysis.decideProposal`, and `opportunities.requestDiscovery`
(`POST /me/mandates/:ref/discovery-runs`; the handler lives in `modules/analysis`).

**What to build and which APIs to use.**
- `createHarness(deps)`, `createFixtureProvider()` (scripted turns from `skills/<skill>/fixtures`, the default),
  `createClaudeProvider()` behind `ANALYSIS_PROVIDER=claude` + `ANTHROPIC_API_KEY` + `ANALYSIS_MODEL` (the model name is
  configuration only; never in code, comments, docs or commits), `createToolGateway(handlers)` with the seven
  `AGENT_TOOLS`. Missing fixture or key is an error, never a silent fallback (D-018).
- `packages/ai` may not import `@growth-os/db` or `@growth-os/connectors` (lint). DB-backed tool handlers live in
  `apps/worker/src/jobs/analysis/tools/*` and are injected into the gateway: `evidence.get` and `intelligence.search` use
  `effectiveAccess` semantics (licence + run scope; restricted → "denied · not summarised", no excerpt or count);
  `sizing.calculate`/`economics.calculate` call the WS2 engines; `work.preview_tasks` is a dry run that writes nothing.
- Runs: `runMachine` (system actor `worker`) for queued → running → completed / waiting_for_input / partial / failed /
  cancelled; checkpoint every step; resume reuses stored tool results; budgets 5 min, 40 tool calls, token and cost caps.
  The run acts with the requesting human's access only. `analysis.start` enqueues `JOBS.analysisRun` with
  `t.enqueue` in the same transaction; register `analysis.run` in `createTaskList`.
- Outputs validate against `SkillOutput`; a citation not returned in this run becomes Unknown; results are stored as
  proposals. `analysis.decideProposal` (accept / edit-and-accept / reject) writes business records only through WS4a's
  exported writers (`createOpportunityFromProposal`, `createClaimFromProposal`) inside the pipeline, with provenance;
  regeneration never overwrites human edits (never-rule 11). Agents never approve, sign or record outcomes.
- Skills: fixture scripts for all 10 skills; `mandate-to-search-plan` must reproduce the Aster discovery (trade registry
  unavailable → run `partial`, OPP-12 likely duplicate). Evals: `pnpm evals:smoke` runs the deterministic suites with the
  fixture provider (citation validity 100%, provenance 100%, 0 injections, 0 restricted leakage).

**Seed profiles:** `aster-start` (discovery on MD-21; ME-104 does not exist yet), `aster-demo` (case-scoped runs on ME-104:
scenario economics, outcome review).

**Acceptance steps and tests:**

| Step | Test file | Proves |
|---|---|---|
| 2 | `apps/api/src/modules/analysis/discovery.db.test.ts` | discovery run on MD-21 → partial ("1 source unavailable"), candidates as proposals "Proposed · AI", accepting one creates a Detected opportunity with provenance |
| 26 | `apps/api/src/modules/analysis/proposals.db.test.ts` | outcome-review recommendation stored as a proposal marked "not a decision"; accepting never records a decision |
| WF-09 | `apps/worker/src/jobs/analysis/run.db.test.ts` | checkpoint and resume after a simulated worker restart reuse tool results; budget exhausted → partial; provider error → failed "Stopped — your work is saved" |
| security | `apps/worker/src/jobs/analysis/gateway.db.test.ts` | Jonas's run cannot see SRC-030 content (denied · not summarised), aggregates only for the site list; injected instructions in evidence produce no action |
| AI down | `apps/api/src/modules/analysis/analysis.db.test.ts` | provider forced to fail → run failed; every WS4 command still works (no dependency on runs) |
| — | each test | cross-tenant 404; agent/service identities refused on every human command |

---

## 6. WS6 — Connector and outbox (7 endpoints + worker jobs)

**Owns (writes):** `packages/connectors/**`, `apps/worker/src/jobs/outbox/**`, `apps/api/src/modules/tasksync/**`,
`apps/api/test/connector-faults/**`, one line in `apps/api/src/modules/index.ts`, one line in `apps/worker/src/tasks.ts`,
and one include line in `vitest.config.ts` (db project: `'apps/api/test/connector-faults/**/*.test.ts'`).

**Endpoints:** `taskSync.get`, `taskSync.preview`, `taskSync.send`, `taskSync.retry`, `taskSync.exportCsv`,
`dev.setConnectorFaults`, `dev.simulatedIssues` (dev routes only when `AUTH_MODE=dev`, like WS1's dev login).

**What to build and which APIs to use.**
- `createSimulatedConnector(connectionId, store)` over `sim.external_issue` (unique per idempotency key, Jira-like keys
  `VAL-n`, `PIL-n`) with fault rules: timeout-after-success, 5xx, permission failure, expired token, rate limit.
- `taskSync.preview` (mandatory before the first write; binds the send to the plan content by hash);
  `taskSync.send` writes one `external_task_link` + one `outbox_message` per task in the business transaction
  (`kind 'task.create'`, `aggregate_type 'external_task_link'`, `aggregate_id` = link id,
  `authorization_ref.gateRequestId` = the task set's authorizing gate — the expiry timer and materiality depend on
  this convention), key = `externalTaskIdempotencyKey(…)`, enqueue `outbox.dispatch` with `t.enqueue`.
- Worker jobs `outbox.dispatch`, `outbox.reconcile`, `outbox.sweep` (cron every minute via `platform.claim_outbox_batch`,
  fixed by migration 0002). Drive every status change with `syncMachine` and `{ kind: 'system', reason: 'worker' }`:
  re-check at send time `approval` (`effective` / `invalidated` / `expired` from `approval_invalidation` and gate status)
  and connector status → `APPROVAL_INVALIDATED` / `APPROVAL_EXPIRED` / `CONNECTOR_UNAVAILABLE`; timeout → `checking` →
  `findByIdempotencyKey` → confirmed or `retry_scheduled` with backoff (max 5) → failed. Permission failure fails that task
  only; expired token pauses the connection (`paused_connector`), internal tasks continue, CSV export works.
  "Confirmed" only with an external key (never-rule 9). `taskSync.retry` re-sends failed tasks only, same keys; human
  `enqueue`/`manual_retry` need `previewCurrent`, `blockingConditionsMet`, `ownerAssigned`.
- Audit and analytics `external_task_confirmed` / `external_task_failed` per task through the shared writer
  `auditWriter.record(tx, …)` / `auditWriter.analytics(tx, …)` from `@growth-os/db` (the worker must not import the API
  app; WS1's evidence and analytics jobs show the pattern).

**Seed profiles:** `aster-demo` — VAL-1…5 already confirmed under G1 (use for retry/no-duplicate checks and for building a
fresh experiment task set in tests). Pilot task sets come from WS4b's `pilot.activate`; until it lands, create the PIL
task set in test setup with direct inserts that follow §6's conventions (G2 approved via the real approval guard).

**Acceptance steps and tests:**

| Step | Test file | Proves |
|---|---|---|
| 12 | `apps/api/src/modules/tasksync/tasksync.db.test.ts` | preview shows destination, assignees, permission; send → "Confirmed · VAL-1…VAL-5" only after the connector returns keys |
| 22 | `apps/api/test/connector-faults/partial.test.ts` | permission fault on task 2 → "5 of 6 tasks confirmed in Jira · 1 failed (permission)"; `external_task_failed` |
| 23 | same | fix mapping → "Retry 1 failed task" → 6 of 6; simulator holds exactly 6 issues (one per key); `external_task_confirmed` ×6 |
| 24 | `apps/api/test/connector-faults/timeout.test.ts` | timeout-after-success → Checking → reconcile → Confirmed; no duplicate |
| variants | `apps/api/test/connector-faults/{expired-token,crash,concurrent-retry,invalidated}.test.ts` | expired token pauses, CSV export works; worker crash mid-send → sweep reclaims and reconciles; concurrent retry clicks → one issue per key; approval invalidated or expired → unsent rows paused, sent preserved |
| — | `tasksync.db.test.ts` | cross-tenant 404; unauthorized role (e.g. Daniel) → 403; dev routes absent when `AUTH_MODE` ≠ dev |

---

## 7. Cross-stream contracts inside Wave 3

| Producer → consumer | Contract |
|---|---|
| WS4a → WS4b | Committed versions and `read.ts` serializers for snapshot content; materiality calls on every commit (rule 4) |
| WS4a → WS5 | `createOpportunityFromProposal`, `createClaimFromProposal` writers (run inside the caller's `tools`) |
| WS4b → WS6 | `pilot.activate` creates `task_set` (`authorizing_gate_request_id`) + `task` rows; WS6 owns everything from preview on |
| WS6 → WS4b, timers | outbox conventions in §6 (`authorization_ref.gateRequestId`, `aggregate_type`, `aggregate_id`) |
| WS4b → WS8c/d | `gates.package` returns the snapshot id + hash the connected `ApprovalPanel` binds to (D-059) |
| all → PE | Requests for `apps/api/src/platform/**`, contracts or migrations go in your notes as CRs; the PE integrates Wave 3 in the order WS4a → WS4b → WS6 → WS5 |

---

## 8. Contract additions after Wave 1 (for Wave 3 integration)

Added by the PE at the Wave 2 screen integration (D-068, `decisions.md`), after the Wave 3 streams branched.
Every change is **additive and backward compatible**: new optional response fields, two new GET endpoints, two
new label maps, and one request field widened to accept null. Code built against the Wave 1 contracts still
compiles and its responses still validate. At the Wave 3 integration the PE (or the owning stream, by CR) wires
the API side listed in the last column; until then the web app falls back where the field is absent.

| # | Contract change | Where | API side to wire at Wave 3 integration | Owner |
|---|---|---|---|---|
| 1 | `OutcomeReviewView.rowVersion?: RowVersion` | `entities/execution.ts` | `outcomes.get` returns the review row version; `outcomes.saveReviewDraft` checks If-Match against it (`assertIfMatch`) | WS4b |
| 2 | `OutcomeReviewView.extensionRequest?: GateRequest \| null` | `entities/execution.ts` | `outcomes.get` includes the latest X request whose parent is this case's G2 | WS4b |
| 3 | `MessageDraft.rowVersion?: RowVersion` | `entities/execution.ts` | `pilot.get` / `pilot.messageDrafts` return it; `pilot.updateMessageDraft` checks If-Match against it | WS4b |
| 4 | `WorkItem.rowVersion?: RowVersion \| null`; `WorkItem.id` is the task id for kind `task` | `entities/execution.ts` | `work.mine` sets `rowVersion` on task items (the `tasks.update` If-Match) | WS4b |
| 5 | `RankingRow.rank?: number \| null` (1-based among ranked rows; null when not ranked) | `entities/case.ts` | Already produced by `createRankingEngine()` in `@growth-os/domain`; `comparisons.get/previewRanking/applyWeights` pass it through | WS4a |
| 6 | `ComparisonCell.evidenceQuality?: EvidenceQuality \| null` | `entities/case.ts` | `comparisons.get` sets it on `growth_evidence` cells | WS4a |
| 7 | `FeasibilityAssessment.questionDetail?: string \| null` | `entities/models.ts` | `feasibility.get` returns the full question (specialist review: the request's question text) | WS4a |
| 8 | `ThesisView.blockers[].status?: ThesisBlockerStatus` (`pending` · `blocker` · `resolved`) + `THESIS_BLOCKER_STATUS_LABELS` | `entities/assumption.ts`, `enums.ts` | `thesis.get` sets it (resolved blockers may be omitted) | WS4a |
| 9 | `DecisionPackageView.changesSince?: { sinceVersion, viewedAt } \| null` | `entities/gate.ts` | `gates.package` returns the version and time the viewer last opened this request (null when never) | WS4b |
| 10 | `Tenant.timeZone?: string` (IANA; absent → Europe/Berlin) | `entities/platform.ts` | **Migration** (PE at integration, after the Wave 3 migrations): `ALTER TABLE platform.tenant ADD COLUMN time_zone text NOT NULL DEFAULT 'Europe/Berlin'`; `auth.me` returns it; materiality stale reasons and the pilot-window timer read it instead of the constant | PE + WS1 code |
| 11 | `outcomes.requestExtension` body: `spendCap: DecimalString \| null`, `durationDays: int \| null` | `api/execute.ts` | Null means the PRD placeholder (`€[cap]`, `[duration] days`): set `XFacts.capPlaceholder = true`; the request is submittable, never approvable (D-040, D-045) | WS4b |
| 12 | New `people.list` — `GET /people?businessUnitId=&role=` → `{ items: DirectoryPerson[] }` (`PersonRef` + `roles` + `businessUnitIds`) | `api/shell.ts` (`API.directory.people`) | Active human principals with ≥ 1 role in the tenant, filtered by role scope; never agents/services; tenant admins only listed with their admin role. Readable by any human with a role. Cross-tenant and unauthenticated tests as usual | WS4a |
| 13 | New `catalogue.scopeOptions` — `GET /me/scope-options?businessUnitId=` → `ScopeOptions` (`businessUnits`, `products`, `segments`, `countries`) | `api/shell.ts` (`API.directory.scopeOptions`) | Business units the viewer can see; `platform.product` and `platform.segment`; countries used by the tenant's mandates and opportunities | WS4a |
| 14 | New label maps `REVIEW_AREA_LABELS`, `GATE_REQUEST_STATUS_LABELS` | `enums.ts` | None (labels only) | — |

API behaviour clarified (no contract change, D-068):

- `gates.decide` with `approve_with_conditions` may repeat the package's **proposed** conditions verbatim (S10 sends
  them so the approver approves what was proposed); conditions equal to a proposed one (same text) are the same
  condition, never duplicates.
- `assumptions.update` returns **snapshot ids** in `staleSnapshotIds` and **approval ids** in `invalidatedApprovalIds`
  (the field names), never gate request ids.
- The registry has **146** endpoints (144 + `people.list`, `catalogue.scopeOptions`); both answer
  `500 "Not implemented yet"` until wired.
