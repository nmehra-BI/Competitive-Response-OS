# WS4a — API: discover and assess · build notes

Base: `ca95231` (integrated Wave 1 head). DB: `growth_os_ws4`. Scope: WAVE3.md §3. All 64 endpoints are
implemented with WS1's `command()` / `query()`, WS2's engines and WS3's machines, policy and materiality.

## Module map

| Folder (`apps/api/src/modules/me/…`) | Endpoints | Shared exports |
|---|---|---|
| `cases/` | `cases.list`, `cases.createDirect`, `cases.header`, `cases.transition`, `cases.members`, `cases.activity`, `cases.history`, `cases.requestReview` | `access.ts` (case loading, policy decisions with `asOf`, people, serializers), `read.ts` (`buildHeader`, `buildRail`, `buildListRow`), `gate-read.ts` (`toGateRequest`, `gateButtonLabel`), `gate-facts.ts` (`g1Facts`, `g2Facts`, `g3Facts`, `evaluateCaseGate`), `sources.ts` (chips), `test-support.ts` |
| `overview/` | `overview.portfolio` | |
| `mandates/` | `mandates.*` (5) | `insertMandate`, `toMandate`, `mandateVisible` |
| `opportunities/` | `opportunities.*` (8, not `requestDiscovery`) | `read.ts`, **`writers.ts` (`createOpportunityFromProposal`)**, `createCaseRow` |
| `comparisons/` | `comparisons.*` (6) | `toComparison` |
| `thesis/` | `thesis.*`, `claims.*` (7) | `read.ts` (`thesisView`, `committedThesis`, `claimsByIds`), **`writers.ts` (`createClaimFromProposal`)** |
| `sizing/` | `sizing.*` (8) | `model.ts` (engine input, `recalcSizingDraft`, `storeCalculation`), `read.ts` (`committedSizingSummary`, `redactBlockedSizing`) |
| `lineage/` | `lineage.get` | `exactValue` |
| `feasibility/` | `feasibility.*` (4) | `feasibilityView` |
| `economics/` | `economics.*` (8) | `model.ts`, `read.ts` (`committedEconomicsSummary`, `scenarioTable`) |
| `assumptions/` | `assumptions.*`, `challenges.*` (8) | `read.ts` (`caseAssumptions`, `challengesWhere`, `assumptionLabel`) |

## Hand-offs

**WS5 (writers run inside the caller's pipeline `tools`; each writes one audit event).**

```ts
import { createOpportunityFromProposal } from '../me/opportunities/writers';
const opp = await createOpportunityFromProposal(t, { tenantId, actorUserId, now, identity }, {
  proposalId, agentRunId, mandateId, name, trigger, fitRationale,
  countryCode?, sourceIds?, unknowns?, fitCriteria?, likelyDuplicateOfId?,
}); // → Opportunity, status Detected, origin 'ai' ("Proposed · AI"), agent_run_id = provenance

import { createClaimFromProposal } from '../me/thesis/writers';
const claim = await createClaimFromProposal(t, { tenantId, actorUserId, now, identity }, {
  proposalId, agentRunId, caseId, statement, sourceIds, kindDetail?,
}); // → Claim, kind 'inference_ai', origin 'ai', status 'proposed' — never accepted by the writer
```

`actorUserId` is the person accepting the proposal; acceptance of an AI claim as a fact stays a human
`claims.accept` (never-rule 11). Both writers validate source ids and refuse unknown ones (400).

**WS4b (snapshot content and gate facts).** `committedSizingSummary(tx, caseId)` → `SnapshotContent.sizing`
(+ `version`); `committedEconomicsSummary(tx, caseId)` → `SnapshotContent.economics` (per-year table text,
one-time note, "Cash flow and payback not available"); `committedThesis(tx, caseId)` (recommendation,
alternatives with "No entry"); `caseAssumptions` (pinned `current.id` = `assumption_version` component);
`feasibilityView` (current review ids = `feasibility_review` components); `g1Facts/g2Facts/g3Facts` and
`evaluateCaseGate` for `gates.preconditions` (the case header rail uses the same facts, so they agree);
`toGateRequest`, `gateButtonLabel` ("Approve pilot €120k · 90 days"). `cases.requestReview` writes
`platform.review_request` rows for WS4b's inbox; `economics.requestFinanceReview` also writes one
(`target_type 'model_review'`) and `economics.signFinanceReview` marks it responded.

**WS4b / G0.** `mandates.submitForG0` creates `MD-n-G0` (subject `mandate`, snapshot subject per D-036) and
reuses it on resubmission after a return (`resubmit`, old snapshot superseded). Deciding G0 is WS4b's: the
follow-on `mandate: 'approve' | 'return'` must set `me.mandate.status`; a case created by
`cases.createDirect` sits in `draft_mandate` with `workflow_case.mandate_id` → apply `g0_approved` to it.

## Decisions

1. **Shared helpers live in `me/cases/`.** Context: platform code is PE-owned and frozen for streams.
   Decision: case access (`authorizeOnCase` = visibility → `PolicyEngine.check` with `asOf` = tenant-local
   date), people, chips, rail and gate facts are in `me/cases/*` and imported by the other WS4a modules.
   Alternatives: a CR for `platform/` helpers. Consequences: WS4b can import them; a later move to
   `platform/` is mechanical.
2. **Blocked sizing is redacted in the serializer (D-033).** When `result.blocked`, the API returns ladder
   placeholders (`tam` 0/"0.00", `sam.available = false`, reachable 0, SOM `[]`) and strips values from
   calculated lineage nodes; the blocking checks (e.g. "SAM (2,000 sites) is larger than TAM (500 sites)")
   carry the explanation. The stored calculation keeps the engine output unchanged. `lineage.get` on a
   blocked sizing draft answers 422 `CALCULATION_BLOCKED`. See CR-WS4a-1.
3. **Draft inputs follow the register; commit pins.** Assumption-backed sizing inputs and economics
   drivers read the assumption's current version on every recalculation (live link) and are pinned
   (`assumption_version_id`) at commit, matching the snapshot's pinned versions. An economics driver whose
   value is edited in the draft becomes a draft-only override (`assumption_id` null, basis "Draft value ·
   not yet in the assumption register"). Every ledger input needs a source or an assumption (400).
4. **Engine input from rows; one stored result per hash.** The frozen `SizingInput`/`EconomicsInput` is
   rebuilt from version rows; results go to `platform.calculation_result` (reused by
   engine × version × input hash) and are linked to the version. Missing required inputs → 422
   `CALCULATION_BLOCKED` with a `MISSING_INPUT` check (no engine call, nothing shown as zero). Recalculation
   only touches the version row when the result id changes, so the draft ETag moves only on real edits.
5. **First sizing draft needs a boundary.** Without a committed version, `sizing.saveDraft` needs
   `boundary.{marketUnit, populationUnit, currency, priceYear}`; country, segment and product come from the
   mandate. Boundary edits insert a new immutable `me.market_boundary`. `includesOneTimeSpend` maps to
   `includes_replacement`.
6. **Materiality calls (rule 4).** `sizing.commit` / `economics.commit` (`model_version_changed`, previous
   committed id), `assumptions.update` (`decision_critical_assumption_changed`, previous version id, label
   from the input key: "adoption assumption", "price assumption", …), `thesis.commit` (`other` — no thesis
   change type exists; classifies uncertain → stale + escalate), `feasibility.sign` (`specialist_scope_changed`
   for EVERY earlier review version whose scope/position differs from the new one, because snapshots pin
   the version they read; re-signing the same scope is not a change).
7. **Comparisons.** Ratings are copied from the latest earlier comparison cells of each candidate when a
   comparison is created (ratings belong to the candidate, named reviewers set them); a new candidate has
   Unknown cells (`rating null`). Creating a comparison for a candidate set that already has one on the
   mandate (order-insensitive) returns the existing one (audit `comparison.reopened`). `ranking` is returned
   in the engine's order (rank order; never re-sorted). Default weights 40/30/30.
8. **Feasibility rows come from review requests.** `cases.requestReview` with `targetType
   'feasibility.<dimension>'` creates or reassigns that dimension's assessment (named reviewer, question,
   due date); `feasibility.sign` is only for the named reviewer (`review.sign`, *self*). A supporting
   sign-off that covers a gate resolves that dimension's open blockers for that gate with its scope text.
   Disagreements use `gate.record_position` roles.
9. **Case transitions.** Authorize = any of `case.edit | case.hold_resume | case.stop` in scope; the case
   machine decides (owner stop → 403 `FORBIDDEN` from `actor_is_sponsor_or_authorized`). `stop` also writes
   `platform.decision_record` (outcome `stop`) and `case_stopped` (`outcome: null` outside an outcome review).
   `resume` checks `approvalsStillEffective` from the latest gate behind the held stage.
10. **Members (D-037).** Human, active principals with a non-admin role reaching the case (BU or case scope)
    plus `case_participant` rows, plus owner and sponsor; agents, services and admin-only users excluded.
11. **Discovery health.** `opportunities.list.discoveryPartial` is true when the latest run on the mandate
    is `partial` or a connection used for discovery is not connected (Aster: Trade registry unavailable);
    `unavailableSources` lists those connections with their last success.
12. **Overview.** Decisions listed only when `PolicyEngine.approvalPanel().canDecide`; spend rows are gate
    budgets (`approved_budget` / `requested_budget`, `timeBasis 'budget'`), never totalled with annual
    figures; `spentToDate` is Unavailable (reason from the finance connection); no market totals.
13. **Thesis provenance.** Clients cannot set `origin`: unchanged text keeps its provenance, changed AI text
    becomes `ai_edited` (`editedBy` = editor), new text is `human`. Commit requires a proposition and a
    "No entry" alternative.
14. **Disputes.** `challenges.resolve` uses the policy (`challenge.resolve`, named reviewer = raiser): the
    disputing reviewer or the sponsor; for claim challenges the case owner too. Replies: raiser, owner,
    sponsor or roles that dispute/resolve/edit.
15. **Exports.** `economics.export?format=csv` returns `text/csv` with separate per-year and one-time
    sections, cash flow / payback "Not available" and lineage formulas. `xlsx` → 400 (no spreadsheet
    writer in the stack yet).

## Workflow updates

- **WF-01 (mandate → G0 request):** implemented. Submission lists every missing field together
  (`owner_set`, `currency_set`, …); G0 preconditions via `evaluateGate`; snapshot v(n) with subject mandate;
  `gate_submitted`. New failure paths: editing an awaiting/approved mandate → 409; returned mandate edits
  apply `revise` (owner only) and start a new draft version.
- **WF-02 (opportunity triage and conversion):** implemented (shortlist/dismiss/restore/merge/convert).
  Convert creates the case in Discovery with `allocateDisplayKey('ME')` (OPP-07 → ME-104 on aster-start).
- **WF-03/04 (sizing, economics, lineage):** implemented as described in decisions 2–6.
- **WF-06 (materiality from WS4a commits):** wired through `applyMateriality` (decision 6). Step 19 proven:
  a new Base adoption version on aster-demo makes G2 v3 stale ("adoption assumption changed on …") and also
  invalidates the G1 approval that pinned the old version (material, decision-critical); the case does not
  move (it is past Validation).

## Change requests

1. **CR-WS4a-1 (contracts, additive):** `SizingOutput.ladder.tam.available?: boolean` (and on
   `reachablePool`) like D-033's `sam.available`, so the redacted placeholders of a blocked result are
   flagged for every rung, not only SAM.
2. **CR-WS4a-2 (contracts, additive):** a material change type for thesis commits (e.g. `thesis_changed`)
   in `MaterialChangeType` and the default policy; today `other` → uncertain.
3. **CR-WS4a-3 (DB, additive):** `me.economics_driver.kind` (or an override flag) so a draft override does
   not need to drop the assumption link to be recognized.
4. **CR-WS4a-4 (contracts):** `opportunities.convertToCase` body has no title; titles are derived as
   "<candidate> — <product name>". Product may want an optional `title`.
5. **CR-WS4a-5 (export):** `economics.export` `xlsx` needs a spreadsheet writer dependency (PE decision).
6. **Note for the PE:** the fixture has no investment-committee person; the IC stop test grants Priya an
   IC role in test setup.

## Out-of-scope edits

- `apps/api/src/modules/index.ts` †: eleven one-line registrations.
- `apps/api/test/db/security/tenancy.test.ts`: new (WS4a-owned per WAVE3 §3).
- No edits to `platform/**`, `packages/**`, migrations or fixtures.

## Status

**Done.** All 64 WS4a endpoints (asserted by the tenancy suite). Tests (`pnpm test:db`, 23 files, 176
passing in the full run): opportunities 8, comparisons 6, cases 8, mandates 4, sizing 7, lineage 3,
economics 5, assumptions 5, thesis 4, feasibility 4, overview 3, tenancy 4 (every WS4a endpoint: another
tenant's refs → 404 `NOT_FOUND`; no session → 401; lists stay in-tenant). Acceptance steps proven: 2, 3, 4,
5, 6, 7, 8, 9, 15, 16, 19, 30, members, stop by sponsor/IC (owner refused). Every handler suite has a
cross-tenant 404 and an unauthorized-role attempt, and asserts audit actions and analytics events
(`opportunity_shortlisted`, `sizing_snapshot_created`, `assumption_changed`, `feasibility_review_recorded`,
`gate_submitted`, `mandate_created`, `case_stopped`, `approval_invalidated` via materiality).
`pnpm typecheck`, `lint`, `format:check`, `test` (1887) and `test:db` pass; API smoke passes on a seeded
`aster-demo`.

**Known gaps.** `economics.export` CSV only; `sizing.population` returns rows from `platform.site` (Aster
seeds no sites, so entitled viewers get an empty list); activity items have no deep links (`href: null`);
the overview `view` parameter returns the same payload for portfolio and operator; G3 facts treat
"capacity reviewed" as false until a capacity review record exists.
