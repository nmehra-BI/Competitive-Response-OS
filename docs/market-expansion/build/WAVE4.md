# Wave 4 brief — product decisions into the product (five parallel streams)

**From:** Principal Architect · **Date:** 10 October 2026 · **Base:** branch from the head of
`claude/zen-euler-ph3oag` that contains this file.
**Read first:** `/CLAUDE.md` (never-rules), `docs/market-expansion/PRODUCT_DECISIONS.md` (backlog tickets 1–15),
`decisions.md` **D-109…D-121** (what was decided) and **D-122…D-139** (how it lands in the contracts), D-031 (change
process), `docs/market-expansion/architecture/API.md` §11 and `DATA_MODEL.md` "Wave 4 additions", and
`docs/market-expansion/build/WAVE3.md` §2 (handler rules — they all still apply).

Five streams run in parallel: **E1**, **E2**, **E3**, **E4**, **E5**. Every contract, column, label, fixture value
and shared registration you need already exists on the base. **You do not edit `packages/contracts/**`,
`packages/db/migrations/**` or `fixtures/aster/**`** (except the one pre-approved line in §3/E3). If something is
missing, write a CR in your notes and tell the Principal Architect; do not work around it.

---

## 1. State of the base

- **Registry: 165 endpoints.** 148 have handlers. The **17 new ones answer `500 problem+json` `INTERNAL` "Not
  implemented yet: <id>"** until a stream lands them (`apps/api/src/server.test.ts` keeps passing):
  `feasibility.addDimension`, `pilot.tripStopRule`, `tasks.addDraft`, `tasks.editDraft`, `tasks.removeDraft`,
  `budget.listEntries`, `budget.reverseEntry`, `admin.committee`, `admin.setCommitteeMember`, `admin.licenses`,
  `admin.setLicense`, `admin.liveAnalysis`, `admin.setLiveAnalysis`, `admin.checkMapping`, `admin.createConnection`,
  `admin.authorizeConnection`, `admin.completeAuthorization`.
- **Extended contracts** (optional fields; old bodies still validate): see `API.md` §11. Highlights:
  `GatePolicyBody` (committee, expiry flag, matrix row, X rule), `AuthorityGrant.doaReference`, `CommitteeMember`,
  `ApprovalPanelState.route/.committee`, `Approval.seat`, `StopRule*`, `SnapshotContent.stopRules`,
  `OutcomeTarget.measureType`, `OutcomeReviewView.extensionLimits`, `License` rights/term/expiry,
  `LiveAnalysisSetting`, `ConnectorMappingCheck`, `Connection.jira`, `Proposal.oneStepAccept`, `BudgetEntry` reversal
  fields, `TaskSet.draftEditable`, `Task.budgetLine`, `Milestone.dueOn/evidenceExpected`, `SizingDraftPatch` and
  `economics.saveDraft` editor fields, `LineageNode.checks`, label helpers `thesisBlockerLabel`, `snapshotLabel`.
- **Migration `0006_product_decisions.sql`** (additive): tables `committee_member`, `tenant_ai_setting`,
  `connection_credential`, `connector_oauth_state` (RLS forced); new columns on `authority_grant`, `approval`,
  `outcome_target`, `license`, `budget_entry`, `milestone`, `task`, `sizing_input`, `feasibility_assessment`; guards
  for budget reversals, task removal and committee seats; `license_fail_closed`. Types regenerated.
- **Fixture (D-125)**: Elena G1 €50k / G2 €150k / X €50k with DoA references, no G3 grant; expiry G1 30, G2 30, X 14,
  G0/G3 never; G3 2 of 3 with the finance seat; X rule 25% / 50% / one per parent; committee Elena (chair), Katrin
  Vogel (finance), Thomas Berger (operations) — both in the dev picker; X1 €30k · 45 days; effort 16 h assumed /
  22 h actual; measure types; structured stop rules SR1–SR3 in aster-demo G2 v3; licence confirmations; MD-21 v1
  owner Jonas ("Returned to change the owner and confirm EUR"); golden `expectedLineage`, `expectedExtension`,
  `expectedScaleGate`, `expectedCommittee`.
- **Already landed for you** (do not redo): the G3 demand clause reads Demand thresholds only
  (`isDemandTarget`, D-126); web `INVALIDATES` entries for every new command (`apps/web/src/lib/query.ts`); admin
  route query `connection`, `code`, `state`; e2e `PERSONAS.katrin/.thomas`; `JOBS.timersLicenseExpiry` + crontab
  line (runs once a handler is registered); `PreviewItemResult.problemCodes` set by the simulated connector.

## 2. Rules for every stream

1. WAVE3 §2 rules 1–6 hold: every handler is `command()`/`query()`; machines decide, the database double-checks; one
   transaction writes state + `t.audit` + the PRD §17 analytics event (only where the transition table lists one) +
   outbox; materiality through `applyMateriality`; snapshots only through `createSnapshot()`.
2. **Tests per handler**: a cross-tenant attempt (404 `NOT_FOUND`), an unauthorized-role attempt (403 or 404 with
   the right code), an agent/service attempt where `auth: 'human'`, the audit action and (where listed) the
   analytics event, `Idempotency-Key` replay and `If-Match` 412 where declared, and `Schema.parse(res.json())`.
3. **Never-rules you are most likely to touch**: 1 (no write path for the agent; committee seats are humans only),
   2 (quorum counts approvals on the **current** snapshot hash only; earlier ones lapse), 3 (budget lines, reversals,
   extension caps and the €400k investment are one-time money — never next to or summed with a `/year` figure),
   5 (a cleared input is Unknown, never 0), 6 (admins never seat themselves or approve), 7 (a tripped stop rule and
   task completion never move a gate), 8 (an unconfirmed or expired licence is metadata only — no excerpt, model
   context, embedding, export or count), 9 (Jira "Confirmed · PIL-n" only after Jira returns the key; reconcile by
   the entity property before any retry), 11 (one human act for "Accept as fact", never by regeneration), 12 (stop
   rules and thresholds never move silently), 13 (removal and reversal never delete).
4. **Copy** comes from the label maps and helpers (`*_LABELS`, `thesisBlockerLabel`, `snapshotLabel`,
   `COMMITTEE_SEAT_LABELS`, `MEASURE_TYPE_LABELS`, `STOP_RULE_*_LABELS`, `LICENSE_*_LABELS`,
   `ASSIGNEE_MAPPING_STATUS_LABELS`, `LINEAGE_RELATION_LABELS`, `BUDGET_ENTRY_KIND_LABELS`). No model name anywhere.
5. **Ownership is by path** (§3). Shared files take **one-line registrations only**, keep both sides on conflict:
   - `apps/api/src/modules/index.ts` — one spread per new handler map. Stream maps that **replace** an existing
     handler (E4 `admin.setMapping`, E5 `admin.connections`/`testConnection`/`reconnect`) are spread **after**
     `adminHandlers`; leave the old handler in `admin/index.ts` untouched (removed at integration).
   - `apps/web/src/screens/admin/AdminScreen.tsx` (owner E3) — E4 and E5 add one import and one `<Section/>` line.
   - `apps/web/src/screens/validation/ValidationScreen.tsx` (owner E4) — E2 adds one import and one render line.
   - `apps/web/src/screens/decisions/DecisionsScreen.tsx` (owner E3) — nobody else.
   - `apps/worker/src/tasks.ts` — E3 one line (`timers.license_expiry`); `apps/worker/src/schedule.test.ts` — E3 adds
     the job to the registered list.
   - `apps/web/e2e/aster-journey.spec.ts` — a stream edits **only the test() blocks of the steps listed for it**
     (E3: 17, 20, 27–29; E4: 10–12 if copy changes, 23; E1/E2: none — D-095 API entry stays until integration).
   - `apps/api/test/db/security/tenancy.test.ts` — E2 adds the `feasibility.addDimension` row and removes it from
     `WAVE4_PENDING`.
   - Do **not** edit `apps/web/src/lib/query.ts`, `apps/web/src/app/routes.ts`, `apps/web/e2e/support/**`,
     `apps/api/src/platform/**`, `packages/db/src/**` (except E3 `approval.ts`), contracts, migrations, fixtures.
6. **Notes**: `docs/market-expansion/build/notes/W4-E<n>.md` (Decisions, Workflow updates, Change requests,
   Out-of-scope edits, Status). Do not edit `decisions.md` or `artifacts.md`.
7. **Done means**: `pnpm install && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm db:migrate
   && pnpm test:db` green on **your** DB, `pnpm evals:smoke` (E4), your real-stack spec **and** the whole
   `pnpm test:e2e:real` on **your** e2e DB, `pnpm test:e2e` (mock) if you touched a screen. Commit in small logical
   commits on your branch with the two trailer lines; do not push.

**Databases** (created, migrated to 0006 on 2026-10-10; re-migrate after any rebase with
`pnpm --filter @growth-os/db run reset && pnpm db:migrate`). Export all three URLs, same pattern as WAVE3 §2:
`DATABASE_URL=postgres://me_app:me_app_dev@localhost:5432/<db>`, `DATABASE_OWNER_URL=…me_owner:me_owner_dev…`,
`DATABASE_WORKER_URL=…me_worker:me_worker_dev…`. Real-stack e2e: `E2E_DB_NAME=<e2e db>` and the four ports below
(`E2E_API_PORT`, `E2E_WEB_PORT`, `E2E_AIDOWN_API_PORT`, `E2E_AIDOWN_WEB_PORT`) so streams can run at the same time;
`E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell` here.

| Stream | DB (`test:db`) | e2e DB | e2e ports (api, web, ai-down api, ai-down web) |
|---|---|---|---|
| E1 | `growth_os_ws4` | `growth_os_ws4_e2e` | 4720, 5720, 4721, 5721 |
| E2 | `growth_os_ws4b` | `growth_os_ws4b_e2e` | 4730, 5730, 4731, 5731 |
| E3 | `growth_os_ws5` | `growth_os_ws5_e2e` | 4740, 5740, 4741, 5741 |
| E4 | `growth_os_ws8` | `growth_os_ws8_e2e` | 4750, 5750, 4751, 5751 |
| E5 | `growth_os_ws6` | `growth_os_ws6_e2e` | 4760, 5760, 4761, 5761 |

## 3. Streams

### Summary

| Stream | Tickets | New endpoints | Extended endpoints | Owned paths (roots) |
|---|---|---|---|---|
| E1 Data-entry editors A | 1 (S06, S08) | 0 | 2 | `modules/me/sizing`, `modules/me/economics`, `screens/sizing`, `screens/economics`, `ui/…/ledger.tsx` |
| E2 Data-entry editors B + S11 | 1 (S11, S09 add assumption, S07), 7 (trip), 9 | 4 | 4 | `modules/me/pilot`, `modules/me/budget`, `modules/me/assumptions`, `modules/me/feasibility`, `screens/pilot`, `screens/feasibility`, S09 register files |
| E3 Governance | 3, 4, 6, 7 (request side), 12, 13, 11 (in owned files) | 6 | 11 | `modules/me/gates`, `modules/me/outcomes`, `modules/platform/admin` (index + 3 new files), `modules/platform/evidence`, domain `policy` + `me/gates`, worker timers + analysis provider gate, `screens/decisions`, `screens/brief`, `screens/outcomes`, `screens/admin` (owner) |
| E4 Workflow UX | 5, 8, 11, 14, 15 | 4 | 7 | `modules/tasksync`, `modules/analysis`, `modules/me/thesis`, `modules/me/lineage`, `modules/platform/work`, `admin/mapping.ts`, domain `me/validation`, `me/sizing`, `platform/materiality`, `screens/validation` (owner), `screens/thesis`, `screens/history`, `screens/my-work`, `LineageDrawer` |
| E5 Jira Cloud adapter | 2 | 3 | 3 | `packages/connectors/src/jira/**`, `connectors/src/factory.ts`, `admin/connections.ts`, `connector-faults/jira/**`, `JiraConnectionPanel.tsx`, `docs/…/integrations/JIRA_CLOUD.md` |

**Why this split differs from the proposal (D-139):** ticket 7 is split at the module boundary. The request side —
`stopRules` on `gates.createRequest`, freezing them into the snapshot, the `budget_and_stop_rules` precondition and
the S10 "Stop rules · pre-registered" section — lives in `modules/me/gates` and `PrepareRequest.tsx`, which E3 already
owns for ticket 12 (measure types in the same S10 form) and ticket 3 (quorum). Giving both to E3 avoids two streams in
one form and one journey step (17). E2 keeps the execution side (S11 display, `pilot.tripStopRule`) and tests it
against the stop rules already seeded in aster-demo G2 v3. Ticket 11 has no single module: E4 owns it and does the
thesis labels, task-sync link text, history, My Work and the shared `packages/ui` status chips; E3 applies
`snapshotLabel` in the files it owns (`gates/lib/inbox.ts`, `gates/lib/package.ts`, decisions and brief screens,
`ApprovalPanel`). The admin module is split by file so E3, E4 and E5 never edit the same handler.

---

### E1 — Data-entry editors A: S06 sizing editor, S08 economics editor (ticket 1, first half)

**Decisions:** D-112 §2, §3, D-132, D-030 (cash flow and payback stay "Not available"), D-033, D-054, never-rules 3,
4, 5. **Contracts:** `SizingDraftPatch` (exported) incl. `boundary.productBoundary`, `boundary.includes`,
`inputs[].basisText`, `clearInputKeys`, `dedupRuleText`, `overlaps[].method`; `economics.saveDraft` body incl.
`currency`, `priceYear`, `horizonYears`, `opexScopeNote`, `clearInputKeys`, `drivers[].assumptionId/sourceId`;
`MarketBoundary`, `LedgerRow`, `EconomicsDriverKey`, `MONEY_MEASURE_LABELS`. **Columns:** `me.sizing_input.basis_text`
(existing `market_boundary.product_boundary`, `includes_*`, `sizing_version.dedup_rule_text`,
`cohort_overlap.method_text`, `economics_version.exclusions_text` carry the rest).

**Owned paths**
- `apps/api/src/modules/me/sizing/**`, `apps/api/src/modules/me/economics/**`
- `packages/domain/src/me/economics/**` (only if an engine input mapping needs a helper; engines' IO is frozen)
- `apps/web/src/screens/sizing/**`, `apps/web/src/screens/economics/**`, `packages/ui/src/components/ledger.tsx`
- `apps/web/e2e/real/w4-e1-editors.spec.ts`, `apps/web/e2e/w4-e1-editors.spec.ts` (mock)
- `docs/market-expansion/build/notes/W4-E1.md`

**Endpoints:** `sizing.saveDraft`, `economics.saveDraft` (extended); exercise `sizing.calculateDraft`,
`sizing.commit`, `economics.calculateDraft`, `economics.commit` unchanged.

**Build**
- S06 "Sizing draft editor": market unit, currency, reference year (price year), product boundary text, what the
  spend includes (hardware · software · services · replacement); TAM site count and annual spend per site; cohort
  rows (name, site count, rule, source); overlap row (count, dedup rule); reachable pool (site count, channel
  definition → `basisText`, source); adoption, horizon and capacity as links to assumptions. Each input is Evidence
  (source) or Assumption (link); a blank clears the input (`clearInputKeys`) and the ledger shows Unknown; the
  `MISSING_INPUT` check blocks commit. Autosave with If-Match; "Create snapshot vN" commits.
- S08 "Economics driver editor": price per year, gross margin %, annual incremental opex with scope note, capacity,
  adoption per scenario; one-time investment in a **separate block** labelled one-time; currency and base year once in
  the header. Cash flow and payback stay "Not available — reason".
- A new case with no sizing yet: the first save needs the boundary (existing rule).

**Tests that prove ticket 1 (E1 half)**
- `sizing.db.test.ts`: save with every new field round-trips; `clearInputKeys` → input absent, `MISSING_INPUT` blocks
  commit, ladder never shows 0; `basisText` survives commit and appears in the ledger; cross-tenant 404; read-only
  reviewer 403; `sizing_snapshot_created` on commit; 412 on stale If-Match.
- `economics.db.test.ts`: header currency/year/horizon, opex scope note, driver links; clearing a driver →
  Unavailable result, never 0; one-time investment never in a `/year` row; cross-tenant; unauthorized role.
- Unit: `SizingScreen.test.tsx`, `EconomicsScreen.test.tsx` for blank-is-Unknown, one-time block, labels.
- **Real e2e** `w4-e1-editors.spec.ts` from `aster-start`: Maya creates a direct case (`cases.createDirect` through
  S01), fills the S06 editor in the UI to the PRD §6 numbers (assumptions created through the API in `beforeAll` until
  E2's S09 form lands), commits sizing v1 with **€40m/year SAM** and **500 unique sites**, fills S08 and commits with
  the four scenario rows and **€400k one-time** apart; axe clean on both editors.

---

### E2 — Data-entry editors B: S11 plan, S09 add assumption, S07 request review; stop-rule trips; record spend (tickets 1, 7, 9)

**Decisions:** D-112 §1, §4, §5 and "PQ-12 stop rules", D-114 §2, D-127, D-132, D-133, UX research §7.3, never-rules
3, 7, 13. **Contracts:** `assumptions.create` (`sourceIds`, `currency`, `priceYear`), `feasibility.addDimension`,
`TaskDraftInput` (`milestoneOrdinal`, `dependsOnOrdinals`, `budgetLine`), milestone `dueOn`/`evidenceExpected`,
`Task.budgetLine`, `Milestone`, `StopRuleState`, `PilotPlanView.stopRules/budgetEntries`, `pilot.tripStopRule`,
`budget.recordEntry` (`reference`, `taskId`), `budget.listEntries`, `budget.reverseEntry`, `BudgetEntry`,
`BUDGET_ENTRY_KIND_LABELS`, `STOP_RULE_*_LABELS`. **Columns:** `milestone.due_on/evidence_expected`,
`task.budget_amount/currency/note`, `budget_entry.reference/task_id/reverses_entry_id/reversal_reason` (guard
`budget_entry_reversal_guard`), `feasibility_assessment.question_detail`.

**Owned paths**
- `apps/api/src/modules/me/pilot/**`, `apps/api/src/modules/me/budget/**`, `apps/api/src/modules/me/assumptions/**`,
  `apps/api/src/modules/me/feasibility/**`
- `apps/web/src/screens/pilot/**`, `apps/web/src/screens/feasibility/**`
- `apps/web/src/screens/validation/AssumptionRegister.tsx`, `AddAssumptionForm.tsx` (new), `register.ts`,
  `register.test.ts`, `ChangeValueForm.tsx`, `DisputePanel.tsx`
- `apps/web/e2e/real/w4-e2-plan-and-spend.spec.ts`, `apps/web/e2e/w4-e2-plan-and-spend.spec.ts` (mock)
- one-line: `ValidationScreen.tsx` (render `AddAssumptionForm`), `tenancy.test.ts` (row + `WAVE4_PENDING`)
- `docs/market-expansion/build/notes/W4-E2.md`

**Endpoints (new 4):** `feasibility.addDimension`, `pilot.tripStopRule`, `budget.listEntries`, `budget.reverseEntry`.
**Extended (4):** `pilot.saveDraft`, `pilot.get`, `budget.recordEntry`, `assumptions.create`. Uses
`cases.requestReview` (unchanged) for the S07 review request.

**Build**
- S09 "Add assumption": statement; value and unit; owner; confidence basis (Evidence link → `sourceIds`, or
  "Assumption — no evidence"); sensitivity High · Medium · Low; decision-critical; validation method; due date.
- S07 "Add dimension / Request review": fixed dimension list (`FEASIBILITY_DIMENSION_LABELS`), named reviewer, due
  date, the question and scope of review; AI may draft the question (existing `feasibility_question` proposal), never
  the answer. Policy action: `review.request`.
- S11 "Pilot plan editor": tasks (title, owner, dependency, due date, deliverable, optional one-time budget line) and
  milestones (name, date, evidence expected); new rows reference each other by ordinal in one patch; cycles refused.
- S11 stop rules: list the approved G2's rules (`PilotPlanView.stopRules`, read from the approved snapshot);
  "Report trip" (owner or pilot owner) with evidence → `pilot.tripStopRule` creates a `review_request` (area
  `sponsor`, target `stop_rule`) and an audit event `stop_rule.tripped`; **no** task, gate or case state changes.
- S11 "Record spend" under the budget meter: kind (Committed · Spent), amount (EUR, one-time), date, description,
  reference (PO or invoice), optional task; above the remaining approved amount → refused with "Request scope
  change" (`PRECONDITIONS_UNMET` with a blocker linking `pilot.requestScopeChange`). Correction = "Reverse" with a
  reason. The meter subtracts reversals.

**Tests that prove tickets 1 (E2 half), 7 (trip), 9**
- `assumptions.db.test.ts`: create with sources → Evidence quality from the source; without → "Assumption — no
  evidence"; cross-tenant; read-only reviewer 403; `assumption_changed` analytics.
- `feasibility.db.test.ts`: add dimension (one per dimension per case, `UNIQUE (case_id, dimension)` → 409), named
  reviewer must be a case member; cross-tenant; agent principal refused; audit.
- `pilot.db.test.ts`: milestones with date/evidence and tasks with budget lines round-trip; ordinal references;
  `tripStopRule` creates exactly one sponsor review item, leaves `pilot_plan.status`, task statuses, gate and case
  stage unchanged (assert), replay with the same Idempotency-Key returns the same item; cross-tenant; reviewer 403.
- `budget.db.test.ts`: reference and task link; over-remaining refused with the scope-change blocker; reversal
  (reason required; second reversal and reversal-of-reversal refused by API and by the DB guard); meter subtracts;
  `listEntries` returns entries and the meter; cross-tenant; read-only 403.
- **Real e2e** `w4-e2-plan-and-spend.spec.ts` from `aster-demo` (G2 approved via `support/journey.ts`, D-095): Jonas
  edits the plan (milestone date, task budget line), activates, records €8k spent with PO number, reverses it with a
  reason (meter back to €0k), records €130k → "Request scope change"; Jonas reports SR2 tripped → Elena's Reviews
  inbox shows the item, the case stage is still Pilot running; Maya adds an assumption and an S07 dimension in the UI.

---

### E3 — Governance: committee and policy defaults, extension rule, licences and live analysis, measure types, G3 investment (tickets 3, 4, 6, 7-request, 12, 13)

**Decisions:** D-109 (all), D-110, D-111, D-112 (stop rules on S10), D-115, D-120, D-122…D-126, D-127 (request
side), D-129, D-130, D-136, D-137, never-rules 1, 2, 3, 6, 8, 10, 12. **Contracts:** `GatePolicyBody` new fields,
`ExtensionRule`, `AuthorityTemplate`, `AuthorityGrant.doaReference`, `CommitteeMember`, `ApprovalPanelState.route/
.committee`, `Approval.seat`, `GateRequest.route/.stopRules`, `StopRuleInput`/`StopRule`, `SnapshotContent.stopRules`
and `.outcomeTargets[].measureType`, `MeasureType`, `OutcomeReviewView.extensionLimits`, `outcomes.requestExtension`
new fields, `License` rights fields, `LicenseInput`, `LiveAnalysisSetting`, `COMMITTEE_*_LABELS`,
`APPROVAL_ROUTE_LABELS`, `LICENSE_*_LABELS`. **Columns/tables:** `authority_grant.doa_reference`,
`committee_member`, `approval.committee_seat` (`approval_one_per_seat_idx`), `outcome_target.measure_type`,
`license.*` (`license_fail_closed`), `tenant_ai_setting`. **Golden:** `expectedExtension`, `expectedScaleGate`,
`expectedCommittee`.

**Owned paths**
- `apps/api/src/modules/me/gates/**`, `apps/api/src/modules/me/outcomes/**`
- `apps/api/src/modules/platform/admin/index.ts` and new `admin/committee.ts`, `admin/licences.ts`,
  `admin/live-analysis.ts`; `apps/api/src/modules/platform/evidence/**`
- `packages/domain/src/platform/policy/**`, `packages/domain/src/me/gates/**` (pre-approved: `ME_GATES.X` button
  label with duration and the keys `extension_within_rule`, `one_extension_per_parent`), `packages/db/src/approval.ts`
- pre-approved one-liner: add the same two keys to the X `preconditionKeys` in `fixtures/aster/src/org.ts`
- `apps/worker/src/jobs/timers/**` (new `license-expiry.ts`), `apps/worker/src/jobs/analysis/run.ts` (provider gate
  only), one line each in `apps/worker/src/tasks.ts` and `schedule.test.ts`
- `apps/web/src/screens/decisions/**`, `apps/web/src/screens/brief/**`, `apps/web/src/screens/outcomes/**`,
  `apps/web/src/screens/admin/**` (owner; new `CommitteeSection.tsx`, `LicencesSection.tsx`,
  `LiveAnalysisSection.tsx`), `apps/web/src/app/connected/ApprovalPanel.tsx`, `packages/ui/src/components/gates.tsx`
- `aster-journey.spec.ts` steps 17, 20, 27–29; `apps/web/e2e/real/w4-e3-governance.spec.ts`; mock specs it breaks
- `docs/market-expansion/build/notes/W4-E3.md`

**Endpoints (new 6):** `admin.committee`, `admin.setCommitteeMember`, `admin.licenses`, `admin.setLicense`,
`admin.liveAnalysis`, `admin.setLiveAnalysis`. **Extended (11):** `gates.createRequest` (stop rules, measure
types), `gates.submit` / `gates.refreshSnapshot` (stop rules frozen and copied), `gates.decide` (quorum, seat,
lapse), `gates.package` (route, committee panel), `gates.preconditions` (X rule, G3 investment wording, ≥ 1 stop
rule), `outcomes.get` (`extensionLimits`, scale summary), `outcomes.requestExtension` (rule, real-tenant cap),
`admin.setAuthority` / `admin.authority` (DoA, 12-month default, gaps incl. "Committee named · G3 authority not
granted"), `admin.publishPolicy` (new fields), `evidence.get` / `evidence.list` (fail closed by rights status).

**Build**
- Ticket 3: route a request by the matrix (`authority` row + the viewer's grant): sponsor within their ceiling, else
  committee within `committeeCeiling`, else authority gap. Committee quorum: `requiredApprovals` approvals on the
  same snapshot hash, every `requiredSeats` seat among them; excluded: package author, case owner, the finance
  reviewer who signed this case's economics review, anyone conflicted; abstain does not count; the request ends
  "Not approved" when quorum can no longer be reached. Stale snapshot → earlier approvals lapse (panel `lapsed`).
  Per-gate expiry from the policy (`approvalExpires`). X cumulative: parent G2 + all its extensions ≤ the sponsor's
  G2 ceiling. DoA reference required on new grants; `validTo` defaults to 12 months. The panel shows "Your authority:
  up to €150k · BU Water" and "Waiting on second approver · finance seat".
- Ticket 4: X preconditions check share (≤ 25% of the parent approved amount), duration (≤ 50% of the parent window,
  ≥ 14 days), one per parent, scope subset (same or fewer sites, no new sites, no outreach), re-tested targets named;
  null cap refused in real tenants "State the extension cap and duration"; S12 form shows `extensionLimits.text`;
  button "Approve extension €30k · 45 days".
- Ticket 6: licence S14 editor (written confirmation, term end, on-expiry action); fail closed everywhere the
  evidence module and the worker's evidence tool read permissions (`rightsStatus` ≠ confirmed → metadata only);
  `timers.license_expiry` runs the action and drops permissions in the same write (the DB constraint enforces it).
  Live analysis: S14 setting; when the deployment's `ANALYSIS_PROVIDER` is live and the tenant is off, the run stops
  before any provider call with "Stopped — your work is saved" and a business reason; the fixture provider is
  unaffected. Enabling and disabling are audited.
- Ticket 7 (request side): S10 "Stop rules · pre-registered" next to "Pilot thresholds · pre-registered" (trigger,
  consequence, owner); stored in the request scope, frozen into the first G2 snapshot, copied forward; a change is an
  amendment-style new request, never a silent edit; `budget_and_stop_rules` needs ≥ 1 on G2 requests created after
  D-122 (aster-demo G2 v3 already has SR1–SR3).
- Ticket 12: S10 threshold row requires a measure type; stored on `outcome_target.measure_type` and in the snapshot;
  load it into the G3 facts (`TargetFact.measureType`; the domain rule is already in place).
- Ticket 13: the fourth G3 blocker reads "No scale budget requested · economics vN carries €400k one-time
  scale-entry investment" from the committed economics; omitted when the viewer cannot read the economics; never in a
  sentence with a `/year` figure.
- Ticket 11 in owned files: `snapshotLabel` in `gates/lib/inbox.ts`, `gates/lib/package.ts`, decisions, brief and the
  approval panel ("G2 · Snapshot v3").

**Tests that prove tickets 3, 4, 6, 7, 12, 13**
- `gates.db.test.ts` / new `committee.db.test.ts`: G3 with a seeded test grant for Katrin and Thomas — one approval →
  "Waiting on second approver · finance seat"; chair + operations (no finance) → not approved yet; finance + one →
  approved; snapshot goes stale after one approval → it lapses, the refreshed snapshot needs two fresh approvals;
  finance "Not approved" → request "Not approved"; author/owner/finance reviewer refused `SELF_APPROVAL_PROHIBITED`
  / `CONFLICT_OF_INTEREST`; admin refused; agent refused by the API **and** the DB; Elena's G2 €120k approve sets
  `expires_at` +30 days, G3 none; a €200k G2 routes to the committee. Tests stop granting Priya the committee role.
- `outcomes.db.test.ts`: X €30k · 45 days approvable by Elena (€150k cumulative); €31k or 46 days or a second X →
  refused with the rule's reason; null cap in a real (non-illustrative) tenant → 400 "State the extension cap and
  duration", in Aster still submittable/never approvable; `extensionLimits` equals `expectedExtension`; G3 summary
  equals `expectedScaleGate` with four blockers in D-039 order; viewer without economics access → no investment text.
- `admin.db.test.ts` (+ new files' tests): committee list and gaps; admin cannot seat themselves; licence edit
  without confirmation but with permissions → 400 and the DB refuses; live analysis on without addendum → 400;
  every change audited; non-admin 403; cross-tenant 404.
- `evidence.db.test.ts`: an unconfirmed licence returns no excerpt, no passage count; after the expiry job the
  excerpt disappears and provenance stays.
- Worker: `license-expiry` plan unit test + db test; analysis run with a live provider configured and the tenant off
  makes **zero** provider calls.
- Domain unit: policy engine quorum, routing and X cumulative; preconditions for the X rule and G3 investment.
- **Real e2e** `w4-e3-governance.spec.ts` from `aster-demo`: S14 shows the matrix with DoA, the committee "Committee
  named · G3 authority not granted", licences with rights status, live analysis Off; S10 shows "Your authority: up to
  €150k"; journey steps 17 (stop rule + measure types entered in S10), 20 ("If unused by" = decision + 30 days),
  27 (X1 €30k · 45 days, limits text, "Approve extension €30k · 45 days"), 28 (four blockers with the €400k one-time
  wording), 29 (authority gap) updated in `aster-journey.spec.ts`.

---

### E4 — Workflow UX: validation draft tasks, task mapping editor, labels, "Accept as fact", reachable-pool check (tickets 5, 8, 11, 14, 15)

**Decisions:** D-113, D-114 §1, D-116, D-117, D-118 (PQ-15, PQ-19), D-119 (PQ-6), D-128, D-131, D-134, D-137,
never-rules 2, 9, 11. **Contracts:** `tasks.addDraft` / `editDraft` / `removeDraft`, `ValidationTaskDraftInput`,
`TaskSet.draftEditable`, `admin.checkMapping`, `ConnectorMappingCheck`, `admin.setMapping.acknowledgeMaterialImpact`,
`ASSIGNEE_MAPPING_STATUS_LABELS`, `PreviewItemResult.problemCodes`, `analysis.decideProposal.acceptAsFact`,
`Proposal.oneStepAccept`, `LineageNode.checks`, `lineage.get` `usedBy[].relation/detail`, `LineageRelation`,
`thesisBlockerLabel`, `THESIS_BLOCKER_STATUS_HINTS`, `snapshotLabel`. **Columns:** `task.removed_at/removed_by`
(guard `task_removal_guard`). **Golden:** `expectedLineage`, `expectedBlocking.reachableExceedsSam`.

**Owned paths**
- `apps/api/src/modules/tasksync/**`, `apps/api/src/modules/analysis/**`, `apps/api/src/modules/me/thesis/**`,
  `apps/api/src/modules/me/lineage/**`, `apps/api/src/modules/platform/work/**`, new
  `apps/api/src/modules/platform/admin/mapping.ts` (`admin.checkMapping` and the replacing `admin.setMapping`)
- `packages/domain/src/me/validation/**`, `packages/domain/src/me/sizing/**`, `packages/domain/src/platform/materiality/**`
- `apps/web/src/screens/validation/**` (owner) except E2's files listed above; new `ValidationTaskDraft.tsx`
- `apps/web/src/screens/thesis/**`, `apps/web/src/screens/history/**`, `apps/web/src/screens/my-work/**`,
  `apps/web/src/app/connected/LineageDrawer.tsx`, `packages/ui/src/components/status.tsx`, `status-maps.ts`
- new `apps/web/src/screens/admin/TaskMappingEditor.tsx` + one line in `AdminScreen.tsx`
- `aster-journey.spec.ts` steps 10–12 (only if copy changes) and 23; `apps/web/e2e/real/w4-e4-workflow.spec.ts`
- `docs/market-expansion/build/notes/W4-E4.md`

**Endpoints (new 4):** `tasks.addDraft`, `tasks.editDraft`, `tasks.removeDraft`, `admin.checkMapping`.
**Extended (7):** `admin.setMapping` (replacement handler), `analysis.decideProposal`, `analysis.proposals`
(`oneStepAccept`), `lineage.get`, `thesis.get` (blocker labels), `taskSync.get` (`draftEditable`, removed tasks
hidden), `taskSync.preview` (link text "ME-104 · G2 · Snapshot v3").

**Build**
- Ticket 5: S09 "Validation tasks · Draft" after G1 approval; experiment owner and case owner edit title, owner
  (directory picker), due date (inside the experiment window) and deliverable; add a task; remove an unsent task.
  Sent tasks read-only with their key; a task added after sending is unsent until previewed and sent. Never threshold,
  sample or budget. Each edit audited `task.updated`; not material. Policy: `experiment.edit`.
- Ticket 8: S14 › Connections › Jira row › "Task mapping" with tabs Validation tasks / Pilot tasks: project, issue
  type, assignee table (person · role · Jira account · Mapped / Unmapped / Not found). "Check with Jira" →
  `admin.checkMapping` (connector `preview()` with one synthetic item per person; `problemCodes` decide Not found).
  Project or issue-type change on a mapping used by an approved, unsent task set → dialog with the impact lines
  ("Approval G2 · Snapshot v3 needs re-approval · unsent tasks pause") and Save sends
  `acknowledgeMaterialImpact: true`, which runs `applyMateriality` (`plan_destination_changed`); assignee edits are not
  material. Journey step 23 switches from `admin.setMapping` through the API to this editor.
- Ticket 11: "Pending · G2" / "Blocker · G3" with the tooltip hints on S05; "G2 · Snapshot v2" wherever E4 owns the
  text; retried task narrative uses the next free key (`PIL-17`), never a reserved one.
- Ticket 14: S05 offers "Accept as fact" when `oneStepAccept.available`; confirm dialog shows claim, kind and
  citations; one transaction writes both audit events; otherwise "Add as draft" only.
- Ticket 15: the sizing engine already raises `REACHABLE_EXCEEDS_SAM`; add the `checked_against` lineage edge and
  the SAM drawer line "Used by: Reachable pool (upper-bound check: 500 ≤ 2,000 sites)"; correct the acceptance
  script wording (BUILD_PLAN §8) to the honest chain.

**Tests that prove tickets 5, 8, 11, 14, 15**
- `tasksync.db.test.ts`: add/edit/remove on an unsent validation set; edit or remove a sent task → 409
  `INVALID_TRANSITION` (and the DB guard); removed task excluded from preview and send; If-Match 412; experiment
  owner and case owner allowed, sponsor/reviewer 403; cross-tenant 404; `task.updated` audit; no analytics event.
- `mapping.db.test.ts`: Mapped/Unmapped/Not found from the simulated connector; impact lines for a used mapping;
  save without acknowledgement → 409; with it → material change recorded, unsent tasks pause, G2 approval
  invalidated; assignee-only edit not material; admin only; cross-tenant.
- `proposals.db.test.ts`: one-step accept creates an accepted claim and writes both audit events in one transaction;
  edited payload or a restricted citation → 400 and nothing written; agent refused; replay idempotent.
- `lineage.db.test.ts` + domain golden: SAM `usedBy` equals `expectedLineage.samUsedBy`; pool 2,500 > SAM 2,000 →
  `REACHABLE_EXCEEDS_SAM` blocks like SAM > TAM.
- Unit: thesis labels and tooltips; `snapshotLabel` usage; `ValidationScreen.test.tsx` draft section.
- `pnpm evals:smoke` (the claim proposals feed one-step acceptance).
- **Real e2e** `w4-e4-workflow.spec.ts`: after G1 (aster-demo → approve via API) Maya edits a draft validation task,
  adds one, removes one, previews and sends (only the remaining tasks confirmed); admin edits the pilot mapping in S14
  with "Check with Jira" and the material-change dialog; Maya accepts a cited AI claim in one step on S05; SAM drawer
  shows the upper-bound check; thesis shows "Pending · G2".

---

### E5 — Jira Cloud adapter (ticket 2)

**Decisions:** D-121, D-135, D-104 ("Jira connection expired"), D-020/D-084 (simulated stays the default), D-021
(idempotency key), never-rules 9, 10, 15. **Contracts:** `TaskConnector` (frozen interface; implement it),
`ConnectorError` kinds, `PreviewItemResult.problemCodes`, `externalTaskIdempotencyKey`, `Connection.jira`,
`admin.createConnection`, `admin.authorizeConnection`, `admin.completeAuthorization`. **Tables:**
`connection_credential` (ciphertext + key id only), `connector_oauth_state` (sha256 of state, single use).
**Env:** `TASK_CONNECTOR=jira`, `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`, `JIRA_REDIRECT_URI`, `JIRA_API_BASE_URL`,
`CONNECTOR_TOKEN_KEY` (`.env.example`).

**Owned paths**
- `packages/connectors/src/jira/**` (adapter, OAuth client, token store, crypto, mock Jira HTTP server, unit tests)
- `packages/connectors/src/factory.ts` (register provider `jira_cloud` when `TASK_CONNECTOR=jira`; extend `deps` with
  an **optional** `jira` block for tests — no call site changes in the worker or `modules/tasksync`)
- new `apps/api/src/modules/platform/admin/connections.ts` (the three new endpoints and replacing handlers for
  `admin.connections`, `admin.testConnection`, `admin.reconnect`, so `Connection.jira` is filled)
- `apps/api/test/connector-faults/jira/**`, new `apps/web/src/screens/admin/JiraConnectionPanel.tsx` + one line in
  `AdminScreen.tsx`
- `docs/market-expansion/integrations/JIRA_CLOUD.md` (customer IT admin guide), `docs/market-expansion/build/notes/W4-E5.md`

**Endpoints (new 3):** `admin.createConnection`, `admin.authorizeConnection`, `admin.completeAuthorization`.
**Extended (3, replacing handlers):** `admin.connections`, `admin.testConnection`, `admin.reconnect`.

**Build**
- OAuth 2.0 (3LO) as the dedicated integration account: consent URL with scopes `read:jira-work write:jira-work
  read:jira-user offline_access`, single-use state (sha256 stored, 10-minute expiry), code exchange, accessible
  resources → `cloudId`, `/myself` → account; tokens AES-256-GCM encrypted with `CONNECTOR_TOKEN_KEY`; refresh before
  expiry and on 401 with rotation; revoked or failed refresh → connection `expired` and `token_expired` errors
  (sends pause; "Jira connection expired").
- `createTask`: create issue in the mapped project, then set the issue entity property `growth-os.idempotency`
  `{ key }` (and a label) — **the key must be on the issue before success is reported**; return `PIL-n` only from
  Jira's response. `findByIdempotencyKey`: JQL search in the mapped project on the entity property (and label) —
  reconcile before any retry after `timeout_ambiguous`. `preview`: project, issue type, assignable-user checks
  without writes, with `problemCodes`. `health`: `/myself` + project browse permission.
- Errors map to `ConnectorError`: 401 → `token_expired`, 403 → `permission_denied`, 404 project → `validation`,
  429 → `rate_limited` with `Retry-After`, 5xx → `transient`, timeout after send → `timeout_ambiguous`.
- Logs never contain tokens, codes or issue bodies (log-scrubbing suite stays green).

**Tests that prove ticket 2** (no network: every test runs against the **local mock Jira HTTP server**)
- Unit (`packages/connectors/src/jira/*.test.ts`): OAuth URL and state single use; code exchange; refresh on expiry
  and on 401; refresh-token rotation; scopes recorded; 429 honours `Retry-After`; error mapping table; crypto
  round-trip and wrong key fails closed.
- Fault suite (`apps/api/test/connector-faults/jira/*.test.ts`, mirrors `connector-faults/*` on the simulated
  connector): partial failure (5 of 6, retry only failed, zero duplicates); timeout after success → reconcile finds
  the issue by entity property, no second issue; expired token mid-send → paused, reconnect resumes only after the
  send-time re-check; approval invalidated → unsent paused; concurrent retry → one issue per key; crash between
  create and confirm → reconcile.
- `connections.db.test.ts`: create/authorize/complete (state replay refused, foreign state refused), tokens stored
  only as ciphertext, admin only, cross-tenant 404, audit without secrets.
- The simulated connector remains the default (`TASK_CONNECTOR` unset or `simulated` → unchanged behaviour; the whole
  real e2e passes unchanged).
- **Real e2e** `apps/web/e2e/real/w4-e5-jira.spec.ts` with the mock server started by the spec and
  `TASK_CONNECTOR=jira` on a dedicated API port: admin adds a Jira Cloud connection, completes the consent redirect
  (mock), sees "Connected · Growth OS integration"; a pilot send creates six issues with keys from the mock.

---

## 4. Integration order and after Wave 4

Merge order E1 → E2 → E3 → E4 → E5 (each rebases and re-runs §2 rule 7). After the last merge the PE retires D-095:
the journey walks S09 add assumption, S06, S08, S07 and S11 in the UI, removes the replaced admin handlers from
`admin/index.ts`, clears `WAVE4_PENDING`, and records CI in `decisions.md`.
