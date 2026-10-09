# WS3 — Workflow and authorization · build notes

Branch `worktree-agent-aee8afa0414210776` (based on `claude/zen-euler-ph3oag` @ 4eebc3c).
Scope: BUILD_PLAN §2 WS3, M1 + M3 tasks. All domain modules are pure (no I/O, no clock reads) and
exported from `@growth-os/domain`.

## Public API (for WS4 API modules and WS6 outbox)

### 1. State machines — `platform/workflow/{state-machine,guards,runtime}.ts`, `me/lifecycle/runtime.ts`

Instances over the frozen tables: `caseMachine`, `mandateMachine`, `opportunityMachine`,
`experimentMachine`, `gateRequestMachine`, `snapshotMachine`, `syncMachine`, `runMachine`.

```ts
import { gateRequestMachine, caseMachine, followOnForGate, createPolicyEngine } from '@growth-os/domain';

const actor = { kind: 'human', userId: session.userId, interactive: session.interactive } as const;
const checks = policy.gateDecisionChecks(subject, resource);           // see §2
const r = gateRequestMachine.apply(gate.status, 'approve_with_conditions', actor, {
  snapshot: { id: snap.id, hash: snap.contentHash, status: snap.status },
  decision: { snapshotId: body.snapshotId, snapshotHash: body.snapshotHash, conditions: body.conditions },
  decisionChecks: checks,
  requiredSignOffs: [{ area: 'finance', present: true }, { area: 'specialist', present: true }],
});
if (!r.ok) throw problem(r.code, { blockers: r.failed.map((f) => ({ key: f.key, message: f.message })) });
// r.to, r.events (analytics names, e.g. ['gate_approved']), r.auditAction ('gate_request.approve_with_conditions'),
// r.domainEvent ('gate.decided'), r.nextAction ({ key: 'meet_conditions', label, owner })
const next = followOnForGate('G2', 'approve_with_conditions', gate.status);   // { case: 'g2_approved', ... }
if (next.case) caseMachine.apply(caseRow.stage, next.case, { kind: 'system', reason: 'gate_decision' }, {});
```

- `apply(state, command, actor, facts)` → `{ ok: true, from, to, changed, events, auditAction, domainEvent,
  nextAction, guards }` or `{ ok: false, code, failed[], reasons[], nextAction }`. **Every** failed guard is
  listed in table order; `code` is the first failure's code. Codes: `INVALID_TRANSITION`,
  `PRECONDITIONS_UNMET`, `FORBIDDEN`, `AGENT_IDENTITY_FORBIDDEN`, `AUTHORITY_INSUFFICIENT`,
  `SELF_APPROVAL_PROHIBITED`, `CONFLICT_OF_INTEREST`, `SNAPSHOT_STALE`, `SNAPSHOT_HASH_MISMATCH`,
  `APPROVAL_INVALIDATED`, `APPROVAL_EXPIRED`, `CONNECTOR_UNAVAILABLE`, `BUDGET_EXHAUSTED`.
- `evaluate(state, actor, facts)` → every command from the state with `enabled` + `reasons` (render disabled
  buttons with the reason). `available(...)` → enabled commands. `nextActionFor(state)`.
- Actor rules: agents never apply anything; `human` transitions need an interactive human (service /
  non-interactive → `AGENT_IDENTITY_FORBIDDEN`, system → `FORBIDDEN`); `system` transitions only take
  `{ kind: 'system' }` (a person → `FORBIDDEN`). Unknown or throwing guards fail closed.
- Facts: `WorkflowFacts` (gate, snapshot, sync, run) and `LifecycleFacts` (case, mandate, opportunity,
  experiment). Load them from committed records. Missing facts fail closed. Notable facts:
  `preconditions` (from §3), `decisionChecks` (from §2), `approval: 'effective'|'invalidated'|'expired'|'missing'`,
  `expiresAt`/`now`/`executed`, `windowEnd`/`today` (tenant-local ISO dates), `heldFromStage`,
  `reviewAuthority` = `policy.check(subject,'outcome.decide',case).allow`, `stopAuthority` = `…'case.stop'…`.
- Hold: on success with `to === 'on_hold'`, store `held_from_stage = r.from`. Resume resolves to `heldFromStage`.
- `followOnForGate(gateCode, gateCommand, fromStatus?)` → `{ case, mandate, lockExperiments }`: the system
  transitions a gate command triggers. X never moves the case or unblocks G3; expiry moves no stage;
  withdrawing a draft moves nothing.

**WS6 (outbox / sync):** use `syncMachine` with `{ kind: 'system', reason: 'worker' }` for
`send_ok` (needs `externalKey`), `send_timeout`, `reconcile_*`, `send_failed_*` (`attempts`, default max 5),
`retry_due` (re-check `approval` + `connector` at send time), `pause_*`, `resume`. `approval_effective`
returns `APPROVAL_INVALIDATED` / `APPROVAL_EXPIRED`; `connector_connected` returns `CONNECTOR_UNAVAILABLE`.
Human `enqueue`/`manual_retry` need `previewCurrent`, `blockingConditionsMet`, `ownerAssigned`.

### 2. PolicyEngine — `platform/policy/policy-engine.ts`

```ts
const policy = createPolicyEngine();
const subject = { actor, roles, authority, participantOfCaseIds, asOf: '2026-11-27' }; // asOf: tenant-local date
const resource = { type: 'gate_request', id, businessUnitId, caseId, facts: {
  caseOwnerId, sponsorId, packageAuthorId, gateCode: 'G2', requestedAmount: '120000.00', currency: 'EUR',
  conflictedUserIds: [], namedReviewerId, licenseAccess, grantTargetUserId } };
policy.check(subject, 'gate.decide', resource);   // { allow, rule, authorityGrantId } | { allow:false, code, reason }
policy.allowedActions(subject, resource);         // Action[]
policy.gateDecisionChecks(subject, resource);     // { designatedApprover, authority, notSelf, notConflicted, authorityGrantId }
policy.approvalPanel(subject, resource);          // { canDecide, allowedDispositions, cannotDecideReason, authorityGrantId }
```

- Deny codes: `NOT_FOUND` (case not visible: other BU, case-scoped role elsewhere, revoked role — never 403),
  `FORBIDDEN`, `AGENT_IDENTITY_FORBIDDEN`, `AUTHORITY_INSUFFICIENT`, `SELF_APPROVAL_PROHIBITED`,
  `CONFLICT_OF_INTEREST`, `RESTRICTED_SOURCE`. `reason` is UI copy ("You authored this package and cannot
  approve it.", "Administrators configure roles and policies but cannot approve gates.", "No G3 approver with
  authority in this business unit — Authority gap.", "This request is above your delegated authority (up to €[limit]).").
- `gate.decide` order: visibility → admin (any tenant_admin role, even with sponsor role + grant) →
  self (package author, then case owner) → conflict → deciding role (sponsor / investment committee in
  scope) → authority (gate × BU × amount ≤ ceiling × currency × `asOf` within validity, not revoked). A spend
  gate (G1/G2/G3/X) with no amount cannot be approved. `check('gate.decide')` means "may approve";
  return/not-approved/abstain need only `designatedApprover` — `approvalPanel` lists exactly the allowed
  dispositions.
- Agents: only `case.read`, `source.read_metadata`, `source.read_excerpt` (licence `excerpt`, case in run
  scope via `participantOfCaseIds`). Service principals: nothing. Non-interactive humans: reads only.
- *Self* actions: `review.sign` only by `namedReviewerId`; finance `challenge.resolve` only on their own.
  Excerpts and site lists need a case-reading role + `licenseAccess: 'excerpt'`; else `RESTRICTED_SOURCE`.
- Admin `admin.configure` with `grantTargetUserId === self` → `FORBIDDEN`.

### 3. PreconditionEvaluator — `me/gates/preconditions.ts`

```ts
const ev = evaluateGate({ gateCode: 'G3', pilotTargets, scaleReadiness, economicsUpdatedAfterPilot,
  capacityReviewed, scope: { amount, currency } });
// ev.preconditions: Precondition[] (contract), ev.blockers: Blocker[] (problem+json "Why?"),
// ev.allMet, ev.metCount, ev.total,
// ev.summary: 'G3 preconditions unmet: demand threshold 3 of 4 (4 of 4 required); specialist scale-readiness review incomplete'
gateRequestMachine.apply('draft', 'submit', actor, { ..., preconditions: ev.preconditions });
deriveGateDisplayStatus({ gateCode, requestStatus, evaluation: ev, afterReview: true }); // GateStatus for the rail
```

Typed facts: `G0Facts`, `G1Facts`, `G2Facts`, `G3Facts`, `XFacts` (see file). Optional second argument:
the gate policy's `preconditionKeys`. Unknown or wrong-gate keys fail closed. Task completion is never an
input. `createPreconditionEvaluator()` implements the frozen interface.

### 4. MaterialityEvaluator — `platform/materiality/materiality.ts`

```ts
const m = createMaterialityEvaluator();
const out = m.evaluate(
  { caseId, changeType: 'decision_critical_assumption_changed', objectType: 'assumption', objectId,
    fromVersion: 2, toVersion: 3, decisionCritical: true, label: 'adoption assumption', at: committedAt },
  tenantPolicy /* or DEFAULT_MATERIALITY_POLICY */, pins /* from snapshot_component */);
// out.classification, out.ruleKey, out.staleSnapshotIds, out.invalidateApprovalIds, out.escalate, out.escalateTo,
// out.escalatedApprovalIds, out.gateCommands [{gateRequestId, command:'mark_stale'|'invalidate'}],
// out.impacts [{snapshotId, effect}] → material_change_impact rows, out.pauseUnsentWrites,
// out.reason 'adoption assumption changed on 26 Nov', out.reasonShort 'adoption assumption changed'
staleBanner(out.reason).title;  // 'This snapshot is out of date: adoption assumption changed on 26 Nov. Approval is disabled.'
invalidationNotice(4, out.reasonShort, true); // 'Approval for v4 no longer applies: … Pilot tasks paused.'
m.resolveEscalation('material', change, pins); // sponsor/IC classified an uncertain change
```

Material: awaiting-decision current snapshots → stale (`mark_stale`), effective approvals → invalidated
(`invalidate`, pause unsent writes). Uncertain (unlisted, sources, non-critical assumptions): snapshots stale +
escalate; approvals untouched until `resolveEscalation('material')`. Drafts (`committed: false`) do nothing.

### 5. Snapshot builder — `me/gates/snapshot-builder.ts`

```ts
const r = await createSnapshot({ ...contentWithoutSchemaVersion, components: [{ type, id, version, state: 'committed' }] },
                               nextSnapshotVersion(existingVersions));
if (!r.ok) throw problem(r.code, r.problems);    // drafts → PRECONDITIONS_UNMET; contract/money → VALIDATION_FAILED
insert decision_snapshot { version: r.snapshot.version, content_canonical: r.snapshot.canonical,
                           content_hash: r.snapshot.hash }; // fingerprint: r.snapshot.fingerprint ('7F3A·19C2')
diffSnapshotContent(v3.content, v4.content);    // "See what changed": changedFields + component added/removed/changed
verifySnapshotHash(canonical, hash);
```

Reuses `platform/snapshot/canonical` (JCS subset + SHA-256, matches the DB CHECK). Components are
de-duplicated and sorted; output is deep-frozen and a copy of the input.

### 6. Timer jobs — `apps/worker/src/jobs/timers/`

`createTimerTasks(db, { timeZone?, now? })` returns graphile tasks for `JOBS.timersApprovalExpiry` and
`JOBS.timersPilotWindow` (crontab already in `catalog.ts`). **Main.ts registration is left to the owner of
`apps/worker/src/main.ts`:** `taskList: { ...createTimerTasks(createDb('worker')), ... }`.
Pure planners `planApprovalExpiry` / `planPilotWindow` decide through the machines; `store.ts` applies per
tenant (`platform.list_tenant_ids()` + `withTenant`):
- **Approval expiry:** approved gate requests past `expires_at` and not executed → `expired`;
  `approval_invalidation(kind='expired')` per effective approval; pending outbox rows authorized by the gate
  → `paused` (+ linked `external_task_link` → `paused_approval_changed`); audit `gate.approval_expired`
  (actor_kind system). "Executed" = G0/G3 always; pilot activated under it; experiment it locked started; or
  an outbox row with `authorization_ref.gateRequestId` that is sending/checking/confirmed/sent.
- **Pilot window:** `pilot_running` cases whose current pilot plan `window_end` < tenant-local today →
  `review_due`, audit `case.stage_changed`. Running experiments past their window are counted (flagged),
  never changed.

## Decisions (for the PE to turn into D-0xx)

1. **Runtime result shape extended (additive).** Context: the stub `ApplyResult` lacked next action,
   audit action, domain event and per-failure codes. Decision: extend `ApplyResult` and `GuardResult`
   (optional `code`) in `packages/domain` (WS3-owned, not `packages/contracts`). Alternatives: return codes
   only (UI loses reasons). Consequences: WS4 maps `r.code` to problem+json and `r.failed` to `blockers`.
2. **First failed guard decides the error code; all failures are listed.** Context: API.md §6.1 check order.
   Decision: the gate table's guard order already matches it (`interactive_human` → `snapshot_current` →
   `hash_matches` → authority → self → conflict → sign-offs). Consequences: stale beats hash mismatch beats
   self-approval when several fail.
3. **Policy self-check before role check for `gate.decide`.** Context: BUILD_PLAN §8 step 18 expects
   `SELF_APPROVAL_PROHIBITED` when Maya (case owner, no deciding role) forces a decision. Decision: order
   visibility → admin → self → conflict → role → authority. Alternatives: role first (Maya would get
   `FORBIDDEN`). Consequences: an author always sees the self-approval message.
4. **Admin never approves, even with a sponsor role and a grant.** Holding any tenant_admin role blocks
   `gate.decide` (CLAUDE.md never-rule 6, S14). Also refuses self-configuration of grants.
5. **Authority needs a decision date (`PolicySubject.asOf`).** The domain never reads the clock; without it
   authority fails closed. A spend gate (G1/G2/G3/X) with no amount is never approvable; G0 needs a
   null-ceiling grant. Multiple grants: the first (by id) that covers amount and currency.
6. **Extension cap placeholder.** Context: X1 must be "Awaiting decision" with `€[cap]` (no amount in PRD),
   but X requires `extension_cap_set`. Decision: `XFacts.capPlaceholder: true` satisfies the precondition
   for submission; approval stays impossible (decision 5) until a real amount is set. Alternatives: block
   submission (breaks acceptance step 27). Consequences: PM must confirm the cap before X1 can be approved.
7. **G3 demand blocker copy.** `pilot_actuals_vs_thresholds` gates only targets with a numeric threshold
   (placeholders like `[hours per site]` and qualitative targets cannot gate). Metrics in
   `DEMAND_METRIC_KEYS` (`paid_use_continuation`) render "Demand threshold · 3 of 4 met; 4 of 4 required".
   Missing observations are unmet ("no data recorded"), never zero.
8. **Materiality details.** A non-critical assumption change (rule says material, `decisionCritical:false`)
   classifies `uncertain`; `decisionCritical` undefined is treated as critical (fail safe). Only snapshots of
   gates `awaiting_decision` go stale; approved gates are invalidated (material) or escalated (uncertain).
   Resolving as not material leaves stale snapshots stale (refresh required; snapshots never go back to current).
9. **Specialist sign-off coverage** is structural: `coversGates` must include the gate and `maxSites`/
   `maxDays` must cover the requested scope. Lena's pilot-only sign-off covers G2 and never G3.
10. **Timers.** Expiry is skipped for executed approvals (`not_yet_executed` guard) with the "executed"
    definition in §6; G0/G3 approvals never expire. Pilot window uses tenant-local dates (default
    Europe/Berlin): a 28 Feb window ends at 00:00 on 1 Mar Berlin time. Per-tenant transactions; one failing
    tenant does not block others (the job still fails so graphile retries).

## Workflow updates

- **WF-01, WF-02:** mandate and opportunity machines implemented; MD-21 v1 fails `owner_set` and
  `currency_set` with both reasons; G0 decision → `followOnForGate('G0', …)` → mandate approve/return.
- **WF-05:** experiment `lock` on G1 approval (`followOnForGate('G1','approve').lockExperiments`); amendment is
  an `unchanged` transition with a required reason; "Too early to read" counts as recorded.
- **WF-06:** gate request + snapshot machines, policy checks, snapshot builder and materiality implemented as
  described. New failure path: decision on an older snapshot id → `SNAPSHOT_STALE` even if that row is still
  marked current.
- **WF-07:** `syncMachine` + `approval_effective` / `connector_connected` codes for WS6; activation guard
  lists open blocking conditions and unowned tasks together.
- **WF-08:** G3 blocked on the Aster outcome with the exact fixture blockers and summary; X never unblocks G3.
  Timer moves the case to Review due after the window.
- **WF-06 (expiry):** new failure path — an expired approval pauses pending outbox rows; ambiguous
  (`checking`) rows keep reconciling and count as "executed", so the approval does not expire under them.

## Change requests

1. **ROLE_ACTIONS vs ARCHITECTURE §7.3 (investment committee `case.stop`).** The table gives the investment
   committee "Outcome decision, stop case"; frozen `ROLE_ACTIONS.investment_committee` lacks `case.stop`.
   The engine follows `ROLE_ACTIONS` (IC is refused). Proposal: add `case.stop` to `investment_committee`,
   or correct the table.
2. **G3 acceptance message vs G3 preconditions.** BUILD_PLAN §8 step 28 / `fixtures/aster gates.g3.blockedBy`
   list two blockers, but G3 also requires `updated_economics_and_capacity` and `approved_scale_budget`. With
   honest Aster data at step 28 (no scale amount requested, economics not updated with actuals) those two are
   also unmet and the message would list four. My Aster test sets them as met. Proposal: either the seed /
   step-28 facts treat them as met (scale request carries a budget; economics refreshed), or the expected
   message lists all unmet preconditions. PE to decide.
3. **Case stage on G2 expiry.** The frozen case table has no transition for an expired G2; the case stays
   `pilot_approved` and activation is blocked by `approval_effective` (`APPROVAL_EXPIRED`). Proposal (optional):
   add `g2_expired: pilot_approved → pilot_approval_pending` so the rail shows the need for a new request.
4. **Domain event sink.** Machines return `domainEvent` types, but `0001_init.sql` has no domain event table.
   WS1/WS4 to decide where `DomainEvent`s are written (audit `action` currently carries the type).

## Out-of-scope edits

- `vitest.config.ts`: unit project excludes `**/*.db.test.ts`; db project includes
  `apps/worker/src/**/*.db.test.ts` (so the timer DB tests run in `pnpm test:db`, not in the unit run).
- Stub removed in `packages/domain/src/me/gates/definitions.ts` (`createPreconditionEvaluator` moved to
  `preconditions.ts`; interface unchanged) and `packages/domain/src/index.ts` exports — both inside WS3 paths
  or the domain barrel.

## Status

**Done:** state machine runtime; all 8 machines; policy engine with role × action matrix; precondition
evaluator G0/G1/G2/G3/X; materiality evaluator incl. escalation resolution; snapshot builder; approval-expiry
and pilot-window timer jobs (pure planners + Postgres store + graphile tasks).

**Tests:** `pnpm test` 1723 passed (13 WS2 golden todos untouched); WS3 adds ~1700, including 410 role × action
cells + agent/service rows (511 policy tests), every state × command for all 8 machines (allowed and forbidden),
each guard failing on its own, and actor checks. `pnpm test:db` 15 passed (4 timer DB tests + 11 guards).
`pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean.

**Known gaps / notes:**
- Could not create `growth_os_ws3` (switching to the postgres OS user is blocked in this sandbox; `me_owner`
  has no CREATEDB). The timer DB tests run inside a rolled-back transaction, so I ran `pnpm test:db` against
  `growth_os`; nothing persists.
- `apps/worker/src/main.ts` does not yet register tasks (owner: WS1/WS5/WS6 per its TODO). Use
  `createTimerTasks(db)`.
- Overdue experiments are only counted by the pilot-window job; there is no table for flags yet.
- WS6 conventions assumed by expiry pausing: outbox rows carry `authorization_ref.gateRequestId` and
  `aggregate_type = 'external_task_link'` with `aggregate_id` = link id.
- `approvalPanel.viewerAuthorityText` and `chain` are left to WS4 (need BU names and routing).
