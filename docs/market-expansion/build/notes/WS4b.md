# WS4b — API: decide, execute, review · build notes

Branch `worktree-agent-a37bb4de81cd17812`, based on the integrated Wave 1 head `ca95231`.
Scope: WAVE3 §4. All 38 endpoints are implemented with `command()`/`query()`.

## What was built

| Module | Endpoints | Files |
|---|---|---|
| `me/experiments` | `experiments.list/create/updateDraft/amend/start/recordResult/recordDecision` | `index.ts`, `experiments.db.test.ts` |
| `me/gates` | `gates.preconditions/createRequest/get/submit/refreshSnapshot/withdraw/package/snapshotDiff/decide/recordPosition/recordDissent`, `conditions.markMet`, `gates.materialChanges/resolveMateriality` | `index.ts`, `lib/{common,serialize,facts,snapshot,package,moves,access,inbox}.ts`, `testkit.ts`, `gates.db.test.ts`, `lib/common.test.ts` |
| `me/pilot` | `pilot.get/saveDraft/activate/requestScopeChange/messageDrafts/updateMessageDraft`, `tasks.update/reportBlocker` | `index.ts`, `view.ts`, `pilot.db.test.ts` |
| `me/budget` | `budget.recordEntry` | `index.ts`, `budget.db.test.ts` |
| `me/outcomes` | `outcomes.get/recordObservation/saveReviewDraft/decide/requestExtension` | `index.ts`, `outcomes.db.test.ts` |
| `platform/reviews` | `reviews.inbox`, `reviews.respond` | `index.ts`, `reviews.db.test.ts` |
| `platform/work` | `work.mine` | `index.ts`, `work.db.test.ts` |
| security | steps 18 and 29 | `apps/api/test/db/security/approval.test.ts` |

### Acceptance steps → tests

| Step | Test |
|---|---|
| 10 | `gates.db.test.ts` "G1 path · step 10" (ME-110 set up as an assessment case, plan created through `experiments.create`, G1 submit → v1 hashed, preconditions met); `experiments.db.test.ts` step 10 (EXP-04: 20 sites, ≥ 8, ≥ 4, €15k) |
| 11 | `gates.db.test.ts` step 11 (stage Validation, plan locked, `validation_authorized` + `gate_approved`); `reviews.db.test.ts` (Elena's inbox shows "Approve validation €15k") |
| 13, 14 | `experiments.db.test.ts` (amendment 1 to 20 Nov, original kept; locked edit → `INVALID_TRANSITION`; results 9/4 → Met · Met, `experiment_completed`; no period → 400) |
| 17 | `gates.db.test.ts` "step 17" (seeded v3: fingerprint, button label, C1/C2 proposed, Daniel's dissent, stage); a fresh G2 submit after withdraw proves `gate_submitted` and the stage move |
| 18 | `approval.test.ts` (Maya → `SELF_APPROVAL_PROHIBITED`, admin → `FORBIDDEN`, agent → `AGENT_IDENTITY_FORBIDDEN`, wrong hash → `SNAPSHOT_HASH_MISMATCH`, other snapshot → `SNAPSHOT_STALE`, DB guard refuses a direct insert); above ceiling → `AUTHORITY_INSUFFICIENT` in `gates.db.test.ts` |
| 19 | `gates.db.test.ts` (Base adoption change → v3 stale; decide → `SNAPSHOT_STALE`; refresh → v4 current, v3 superseded; diff "Adoption 20% by year 3: 20% → 25%") |
| 20 | `gates.db.test.ts` (approve with C1/C2 on v4 → Pilot approved, `expires_at` +14 days, `gate_approved`) |
| 21–22 | `pilot.db.test.ts` (unowned task 2 and open C1 listed together; owner + C1 met → activated, `pilot_activated {tasks: 6}`, task set for WS6) |
| 25–27 | `outcomes.db.test.ts` (Not met · Not met · Inconclusive, `outcome_recorded`; review draft; "Revise and extend" → Validation, `extension_requested`; X1 Awaiting decision with €[cap]; X1 approve → `AUTHORITY_INSUFFICIENT`) |
| 28 | `gates.db.test.ts` (G3 request → 409 `PRECONDITIONS_UNMET`, four blockers, D-039 summary) |
| 29 | `approval.test.ts` (admin, every disposition → `FORBIDDEN`; admin inbox empty) |
| scope change | `pilot.db.test.ts` (G2 invalidated, outbox row paused, link paused, PIL-11 preserved, case → Pilot approval pending) |
| coordinator notes | `gates.db.test.ts`: proposed conditions repeated word for word keep C1/C2 (no duplicates; a new one gets the next key); after return → resubmit only the current snapshot's decisions are listed and the package is approvable (G2, and G0 for a new mandate; MD-21's package shows only v2's approval). `pilot.db.test.ts` "WS6 hand-off" asserts the task set shape |

Every endpoint has a cross-tenant 404 and an unauthorized-role attempt (403/404 with the right code); state changes assert their audit action and analytics event, and that neither carries free text (rationale, dissent, blocker text).

## Decisions

1. **Decision order in `gates.decide`.**
   - *Context:* The machine's guard order puts authority before self-approval. That would give Maya `FORBIDDEN` (she has no deciding role) instead of `SELF_APPROVAL_PROHIBITED`.
   - *Decision:* The handler checks, in this order: AGENT (pipeline), gate state, then `SNAPSHOT_STALE` (stale gate, non-current snapshot, or another snapshot id), then `SNAPSHOT_HASH_MISMATCH`, then the policy. For approve dispositions the policy is `policy.check('gate.decide')`: admin → self → conflict → role → authority, on the tenant-local `asOf`. For other dispositions it is designated approver and not conflicted. Last comes `gateRequestMachine.apply` for sign-offs and condition owners (`PRECONDITIONS_UNMET`). The authorize hook only checks visibility. Admins pass it so the policy can refuse them with `FORBIDDEN`.
   - *Consequences:* This matches WAVE3 §4 and D-046. The DB guard repeats the critical checks.
2. **Proposed conditions live in the request's scope JSON.**
   - *Decision:* `gate_request.scope` stores `GateScope + proposedConditions`. Contract reads strip the extra key. On `approve_with_conditions`, a condition whose text matches a proposed one word for word (whitespace-normalised) and has the same flag gets that proposal's key (C1, C2…). New conditions get the next free keys. Duplicates in the body are ignored.
   - *Alternatives:* Proposed rows in `platform.condition` (they would block activation if the approver dropped them).
3. **Snapshot content builder.**
   - *Data fields:* Assumptions (current versions), sizing, economics, validation results, dissent and components are rebuilt from committed rows.
   - *Narrative fields:* ask, recommendation, alternatives, limitations, stop rules, outcome targets and sign-offs carry over from the previous snapshot on refresh and resubmit. Positions recorded on the previous snapshot are merged into the sign-offs. The diff therefore shows real changes only.
   - *First snapshot:* Defaults come from the gate definition and the committed records.
   - *Pinning:* G1 pins the draft experiment plans it authorizes (frozen by the lock). G2 and later pin result versions and signed feasibility reviews.
   - *Other:* `subject` is always set (D-036). Outcome targets are copied to the new snapshot on refresh, so the thresholds never move.
4. **The activated plan version is indexed under the approved G2 snapshot.**
   - *Context:* The G2 snapshot cannot pin a draft plan. Without a pin, a scope change would not reach the approval.
   - *Decision:* At activation, a `snapshot_component (pilot_plan_version)` row is added for the approved snapshot. This is insert-only and leaves the hashed content unchanged. `pilot.requestScopeChange` then calls `applyMateriality` with `spend_ceiling_changed` or `plan_tasks_changed`. See CR-WS4b-2.
5. **Package fields describe one snapshot.**
   - *Decision:* `approvals`, `positions` and `panel` belong to the viewed snapshot only. `gateHistory` lists every decision on every snapshot of the subject's gates, plus open requests.
   - *Panel:* `canDecide` is false for a stale, superseded or decided snapshot, or after the viewer's own decision, with the reason. `viewerAuthorityText` is "Up to €[limit] · BU Water". The chain is the case sponsor.
6. **Expiry.** `expires_at = decided_at + approvalExpiryDays` (gate policy, default 14) for G1, G2 and X only. G0 and G3 never expire, as in the WS3 timers.
7. **G3 is refused at `gates.createRequest`** while any precondition is unmet. The response is `PRECONDITIONS_UNMET` with the D-039 summary as the title and all blockers. Other gates may be drafted with open preconditions. `submit` checks them.
8. **X placeholder cap.** `outcomes.requestExtension` treats `spendCap: "0"` as the €[cap] placeholder. `requested_amount` stays null, the precondition gets `capPlaceholder: true`, and approval is refused by the policy (D-040). A positive cap is a real amount. See CR-WS4b-3.
9. **Outcome results.**
   - Numeric thresholds compare exactly as decimals.
   - Placeholder thresholds ("Within [hours per site]") read the stated direction of the value text ("Above …" → not met for `lte`).
   - Qualitative targets → Inconclusive.
   - An observation without a target has no result.
   - See CR-WS4b-4.
10. **Outcome review lifecycle.**
    - Activation opens `outcome_review` v1 for the authorizing G2. The causal-limitation draft is the approved package's known limitations.
    - `outcomes.get` is 404 before activation.
    - Because the view contract requires ≥ 1 causal limitation, an empty list renders a single "not stated yet" line. The decision guard uses the stored list, and every outcome decision requires a real limitation.
11. **Experiments and materiality.**
    - An amendment is a new plan version and calls `applyMateriality(changeType 'other')`. Unlisted types are uncertain and escalate to the sponsor.
    - A new result version does the same against the previous result version (G2 snapshots pin results).
12. **Budget meter.**
    - One-time pilot budget money of a single gate is summed in integer cents. This is a guard, not an engine calculation, and recurring money never enters it.
    - An empty ledger shows `0.00` (a true empty sum).
    - Over-cap committed or spent entries are refused (`PRECONDITIONS_UNMET`, blocker `budget_ceiling`).
13. **Validation task set at G1 lock.** The G1 follow-on creates the experiment's `task_set` (`owner_type 'experiment'`, authorizing G1, `validation_tasks` mapping and connection) for WS6. WS4b never sends tasks.
14. **Text never in audit.** Rationale, dissent statements, blocker text and notes are stored in their tables or as task comments. Audit carries ids, codes and counts.
15. **Analytics `extension_requested`.**
    - It is emitted by the case transition `outcome_revise_or_extend` (transition table) and again by `outcomes.requestExtension` (WAVE3 §4).
    - The PE may want to keep one. Both carry `{ parentGate }`.

16. **G0 follow-ons (WS4a hand-off).**
    - Deciding G0 runs the mandate machine and sets `me.mandate.status`. Approval also sets `g0_gate_request_id` and `current_version_id`.
    - Approval moves every case on that mandate still in `draft_mandate` (`cases.createDirect`) to Discovery with `g0_approved`. `mandate_approved` is emitted once.
    - Tested in `gates.db.test.ts` (MD-90 and ME-120).

## Overlap with WS4a helpers (for the PE to dedupe at integration)

WS4a (branch `worktree-agent-ad566429339d548dd`) landed in parallel. WS4b keeps its own equivalents for now and does not import that branch:

| WS4b | WS4a | Note |
|---|---|---|
| `me/gates/lib/facts.ts` `loadGateFacts` / `evaluate` | `me/cases/gate-facts.ts` `g1Facts`, `g2Facts`, `g3Facts`, `evaluateCaseGate` | Use one source, so `gates.preconditions` and the header rail agree. G1 facts must match: evidence sources from sizing inputs, cohorts and claims; decision-critical assumptions; feasibility rows. |
| `me/gates/lib/serialize.ts` `toGateRequest`, `buttonLabel` | `me/cases/gate-read.ts` `toGateRequest`, `gateButtonLabel` | WS4b's version strips the stored `proposedConditions` key from the scope (decision 2). |
| `me/gates/lib/snapshot.ts` sizing summary, economics table, sign-offs | `committedSizingSummary`, `committedEconomicsSummary`, `committedThesis` | WS4b carries narrative fields over from the previous snapshot. WS4a's `committedThesis` would give a better first-snapshot recommendation and alternatives. |

`reviews.inbox` and `reviews.respond` read every `platform.review_request` row addressed to the viewer, including WS4a's `cases.requestReview` and `economics.requestFinanceReview` (`target_type 'model_review'`, economics tab via `area 'finance'`).

## Workflow updates

- **WF-05 (validation):** implemented. Draft edits are refused once locked (`INVALID_TRANSITION`). Amendments need a reason. Results are append-only with a period and source, and "Too early to read" counts as recorded. New failure paths: amending a draft (409), observations with unknown metrics (400).
- **WF-06 (gates, snapshots, decisions, materiality resolution):** implemented end to end. New failure paths:
  - deciding twice on one snapshot (`INVALID_TRANSITION`)
  - conditions with a disposition other than `approve_with_conditions` (400)
  - a second open request of the same gate (409)
  - resolving a non-uncertain change (409)
- **WF-07 (activation hand-off):** blockers are listed together (unowned tasks with their ordinal and title, open blocking conditions with key and text). After a scope change on an active plan, the scope-change request stays `open`. The case owner then opens a new G2.
- **WF-08 (outcomes):** implemented. G3 is blocked with four blockers (D-039). X does not move the case and does not unblock G3.

## Change requests

- **CR-WS4b-1 (platform helper):** an `applyResolution` in `apps/api/src/platform/materiality.ts`. `gates.resolveMateriality` mirrors the approval half of `applyMateriality` locally (`me/gates/lib/moves.ts#applyInvalidations`).
- **CR-WS4b-2 (contract/process):** let G2 snapshots pin the pilot plan explicitly. Either commit a plan version at G2 submit, or document the activation-time component index (decision 4) as the convention.
- **CR-WS4b-3 (contract):** make `outcomes.requestExtension.body.spendCap` nullable for the €[cap] placeholder instead of `"0"`.
- **CR-WS4b-4 (contract):** add an optional human `result` to `outcomes.recordObservation` for targets with placeholder or qualitative thresholds, instead of reading the direction from text.
- **CR-WS4b-5 (contract):** `MaterialChange.actor` is a required `PersonRef`, but system-detected changes have no actor. WS4b returns a nil-UUID "System" person. A nullable actor would be honest.
- **CR-WS4b-6 (domain):** a budget helper (`OneTimeAmount` sum/compare for a single budget) in `packages/domain`, replacing the integer-cent guard in `me/budget`.
- **Note for WS4a:** `cases.requestReview` writes `platform.review_request` rows that `reviews.inbox/respond` read. `assumptions.update` must call `applyMateriality` with `componentType 'assumption_version'` and `objectId` = the previous version (the step 19 test simulates exactly that).

## Out-of-scope edits

- `apps/api/src/modules/index.ts` †: seven one-line registrations (gates, experiments, pilot, budget, outcomes, reviews, work).

## Status

**Done:**
- All 38 WS4b endpoints.
- Acceptance steps 10, 11, 13, 14, 17–22, 25–29 and the scope-change variant.
- The three coordinator requests: proposed conditions kept as C1/C2, current-snapshot decision fields after return → resubmit, and the WS6 task-set shape test.

**Results:**
- `pnpm typecheck`, `lint`, `format:check`: clean.
- `pnpm test`: 1892 passed.
- `pnpm test:db` on `growth_os_ws4b`: all suites green (WS4b adds 8 DB files, 69 tests).

**Known gaps:**
- `readiness` on the outcome review is always `[]` (there is no table for it).
- Blocker "notify the case owner" is recorded in audit details only (no notification system).
- Approval chain shows only the case sponsor (no multi-approver routing).
- The G1 test path sets up ME-110 by direct inserts until WS4a's sizing, assumption and feasibility endpoints land.
- The pilot-window timer's `review_due` move is simulated by a direct stage update in the outcomes test.
