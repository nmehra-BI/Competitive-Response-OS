# WS8c — Screens: validate and decide · build notes

Branch based on `worktree-agent-a3827e28ef2e7ed16` (WS7 shell, components, MSW, Playwright/axe harness).
Scope: BUILD_PLAN §2 WS8c — S09 Validation, S10 Decisions, decision brief. Copy and states follow the
WS3 policy, precondition and materiality rules (read from `worktree-agent-aee8afa0414210776`, not merged).

## What was built

| Route | Screen | Files |
|---|---|---|
| `/me/cases/:caseKey/validation` (`?assumption`, `?experiment`, `?view=table\|2x2`) | S09 | `apps/web/src/screens/validation/**` |
| `/me/cases/:caseKey/decisions` (`?gate`, `?version`, `?compare`) | S10 | `apps/web/src/screens/decisions/**` |
| `/me/cases/:caseKey/brief` (`?gate`, `?version`) | Decision brief | `apps/web/src/screens/brief/**` |

**S09 Validation** (`Validation.dc.html`)
- Assumption register: Test first / Test next / Watch / Monitor, sorted by sensitivity then evidence
  (weakest first, `register.ts`), no combined score. Table and 2×2 views (`?view=2x2`).
- Disputed 20% adoption: "Disputed by Daniel Weber" opens the dispute thread with his words as signed
  dissent, replies, and "Resolve with reason" (enabled only for the disputing reviewer or the sponsor;
  disabled with the reason otherwise).
- EXP-03 card: hypothesis, method, 20-site sample, nonresponse, window, €15k budget, owners, decision
  rule (pre-registered), "Plan locked at G1 · 16 Oct", thresholds table (Threshold (pre-registered) /
  Observed / Result), Amendment 1 with `<del>19 Oct – 13 Nov</del> Original (pre-registered) → 19 Oct –
  20 Nov Amendment 1`, results "Met · 9 of 8", "Met · 4 of 4", Measured (Actual · period · source),
  interpretation, limitations, decision taken; earlier result versions stay listed (append-only).
- Actions for the experiment owner / fieldwork owner: Amend plan (new window + required reason),
  Record results (observed per metric, period, source, interpretation, limitations), Record decision taken.
- Empty state with an illustrative example and "Create experiment" (case owner); G1 card with the
  deterministic preconditions and "Submit G1 · Approve validation €15k" (create + submit → snapshot v1
  and fingerprint shown).
- Validation tasks: "Preview tasks" (dry run, writes nothing) → "Create 5 tasks in Jira" → "Sending…"
  then "Confirmed · VAL-n" (polls while in flight; never "Confirmed" without a key).
- "Next: G2 pilot request" with the open G2 preconditions and "Prepare pilot package".

**S10 Decisions** (`Decisions.dc.html`)
- Read-only versioned package (`PackageArticle.tsx`): meta line (case, gate, Snapshot vN, fingerprint,
  Read-only, submitted by), title, changes since last view / `?compare`, THE ASK, then numbered sections
  Scope · Recommendation · Alternatives · Validation results · Critical assumptions · Economics from
  snapshot · Sign-offs · Budget and stop rules · Conditions (blocking or monitor) · Dissent · Known
  limitations · Sources. Decision-relevant content comes from the frozen `snapshot.content`.
- Elena's panel (`DecisionPanel.tsx` over WS7 `ApprovalPanelView`): "Approve pilot €120k · 90 days" /
  Return for revision / Not approved / Abstain, rationale required, Authorizes / Does not authorize,
  authority, chain, expiry "If unused by 11 Dec 2026". States awaiting → "Approved with conditions ·
  2 conditions · <time>" with "Open pilot plan".
- Variants: stale (WS3 banner "This snapshot is out of date: adoption assumption changed on 26 Nov.
  Approval is disabled.", "See what changed" diff, "Refresh snapshot (creates v4)", approve disabled with
  reason); self-approval ("You authored this package and cannot approve it." + "Viewing as …" + Withdraw
  v3 with a reason); unauthorized reviewer ("Your role does not decide gates."); G1 history (`?gate=G1`:
  Gate history with "G1 · Approve validation €15k", rationale, fingerprint, boxes, G2 v2 superseded);
  superseded (`?version=3` after v4: read-only banner + "Open v4", approve disabled); invalidated (WS3
  `invalidationNotice`: "Approval for v4 no longer applies: adoption assumption changed. Pilot tasks
  paused."); expired ("The approval for v4 expired unused on 11 Dec 2026."); withdrawn.
- Preparing a request: G2 prepare form (budget, duration, window, sites, countries, segment, pilot owner,
  authorizes / does not authorize, proposed conditions) → draft view with preconditions → "Submit for
  decision" (freezes v3).

**Decision brief**: the same article plus a "Decision record" (disposition, approver, time, rationale,
snapshot fingerprint, effectiveness), "Print decision brief" and "Open in Decisions". `@media print`
hides navigation, header, case header and actions; the illustrative-data notice stays.

## MSW mocks

`screens/validation/mocks.ts` and `screens/decisions/mocks.ts` (auto-collected, take precedence over
WS7 base handlers). Shared state and builders: `decisions/mock-state.ts`, `decisions/mock-data.ts`,
`validation/mock-data.ts`. All responses are validated against the contracts by `mock()`.

Endpoints added or overridden: `cases.header`, `gates.preconditions`, `gates.get`, `gates.package`
(`version`, `compareTo`), `gates.createRequest`, `gates.submit`, `gates.refreshSnapshot`, `gates.withdraw`,
`gates.snapshotDiff`, `gates.decide`, `assumptions.list`, `assumptions.update` (materiality: stale or
invalidate), `challenges.reply`, `challenges.resolve`, `experiments.list/create/start/amend/recordResult/
recordDecision`, `taskSync.get/preview/send`.

Journey presets (`WS8C_PRESETS`): `start`, `g1_approved`, `g2_prep`, `demo` (default, 26 Nov), `stale`,
`v4`, `approved`, `invalidated`, `expired`.
- Vitest: `setScenario({ ws8cPreset: 'stale' } as never)`.
- Browser / e2e: `sessionStorage.setItem('growth-os:ws8c-preset', 'start')` before loading the app. The
  journey state is persisted in sessionStorage after each command, so persona switches (full page loads)
  continue the same journey (Maya submits → Elena decides).

## Tests

- Vitest: `validation/register.test.ts` (3), `validation/ValidationScreen.test.tsx` (6),
  `decisions/DecisionsScreen.test.tsx` (13, incl. brief), `decisions/mocks.test.ts` (11: every preset ×
  persona on contract; stale / superseded / hash mismatch / admin / non-decider refused; invalidation).
- Playwright + axe: `apps/web/e2e/validate-decide.spec.ts` (7) — steps 10–11, 13–14 (+ tasks), 17–18,
  19–20, dispute/2×2/order, all S10 variants, printable brief; axe on every state.
  Run: `E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm --filter @growth-os/web test:e2e validate-decide`
  (7/7 pass locally, against `vite` dev and against a `VITE_MSW=on` production preview).

## Decisions

1. **Approving a package approves its proposed conditions.**
   Context: G2 v3 proposes C1 (blocking) and C2 (monitor); acceptance step 20 expects "Approved with
   conditions" with C1 and C2, while `ApprovalPanelView` only collects conditions added at approval.
   Decision: the S10 panel sends `approve_with_conditions` with the proposed conditions verbatim plus any
   added by the approver (plain `approve` only when there are none).
   Alternatives: let the server attach proposed conditions on `approve`; make the approver re-enter them.
   Consequences: WS4 `gates.decide` must treat body conditions equal to proposed ones as the same
   conditions (no duplicates); the mock dedupes by text.
2. **Stale/superseded disable approval in the panel, policy reasons lock it.** The approver (chain
   `isViewer`) sees the disabled scoped button with the snapshot reason; everyone else sees the policy
   `cannotDecideReason` (WS3 copy). Return / Not approved / Abstain are also unavailable on a stale
   version (prototype). The decision always carries the id + hash of the version rendered.
3. **Register order: sensitivity, then evidence weakest first** (`none < weak < conflicting < some <
   strong`), key as tie-break. The prototype listed "Specialist requirements (None)" last in Test first;
   we show it first because it is the least evidenced. Groups come from the API (`registerGroup`).
4. **Persisted mock journey.** Mock state survives full page loads through sessionStorage so e2e
   journeys can switch personas; restore happens once per page load (never after `resetMockState()`).
5. **Dates** render in Europe/Berlin (tenant zone; the contract has none yet); ISO calendar dates never
   shift.
6. **Brief route sits inside CaseLayout**; print CSS hides chrome rather than a separate layout.
7. **Package text is server text.** Title is "<gate kind>: <case title>"; validation results are parsed
   from the frozen summary into result glyphs; nothing in the package is computed in the browser.

## Workflow updates

- **WF-05 (experiments):** create → G1 submit → G1 approve locks the plan → amend (reason, original
  struck through) → append results (failed thresholds stay visible, e.g. "Not met · 3 of 4") → decision
  taken. New UI failure path: amendments only after lock; drafts are edited directly.
- **WF-06 (gate decision):** prepare G2 → draft with preconditions → submit (v3) → material change
  (adoption) → v3 stale, decision refused `SNAPSHOT_STALE` → refresh → v4 current, v3 superseded (a
  decision on v3's id is refused `SNAPSHOT_STALE`) → approve with conditions → invalidated by a later
  material change (`assumptions.update` returns `invalidatedApprovalIds`) or expired unused.
- **WF-07 (task sync, validation tasks):** preview (dry run) → send with preview id + hash → Sending… →
  Confirmed · VAL-n. A stale preview is refused `PRECONDITIONS_UNMET` ("Preview again").

## Change requests

1. `GateStatus` has no "Withdrawn" and there is no `GATE_REQUEST_STATUS_LABELS`; S10 shows "Withdrawn"
   from the request status. Proposal: add `GATE_REQUEST_STATUS_LABELS` to contracts.
2. No `REVIEW_AREA_LABELS` in contracts; `PackageArticle.REVIEW_AREA_ROLE` maps areas to role names.
   Proposal: add the label map.
3. `DecisionPackageView.changesSinceViewerLastSaw` has no "since version / viewed at"; the prototype says
   "Changes since v2, which you viewed on 24 Nov". Proposal: add `{ sinceVersion, viewedAt }`.
4. No tenant time zone in `Tenant`; screens assume Europe/Berlin. Proposal: `Tenant.timeZone`.
5. WS7 (non-frozen): `DataTable`'s `.gos-table-scroll` is not keyboard focusable (axe
   `scrollable-region-focusable` when a table overflows). WS8c works around it with
   `decisions/useFocusableScroll.ts`; better fixed in `DataTable`.
6. WS7 (non-frozen): `ApprovalPanelView`'s lock banner has no body; the "Viewing as … Only Elena Fischer
   can decide G2 v3" line is passed through `secondaryAction`.
7. WS7 harness: the "every route passes axe" crawl does 23 routes × axe inside the default 30 s test
   timeout. With real screens replacing placeholders it measured ~40 s locally (no violations on any
   route, including S09/S10/brief); it needs `test.setTimeout(...)`.
8. WS4: `gates.decide` should accept conditions identical to the proposed ones (decision 1);
   `assumptions.update` should return `staleSnapshotIds` as **gate request ids or snapshot ids**
   consistently — the mock returns the G2 request id; the contract says snapshot ids. The screens do not
   depend on either.

## Out-of-scope edits

- `apps/web/src/screens/registry.ts` (shared, append-only): three one-line entries
  (`caseValidation`, `caseDecisions`, `caseBrief`).

## Status

Done: S09, S10 (all FRONTEND §7 variants listed above), decision brief, mocks with presets, 33 Vitest
tests, 7 Playwright specs with axe. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`
(15 files, 131 passed, 13 todo) and `pnpm --filter @growth-os/web build` pass.

Known gaps:
- "Waiting on second approver" (FRONTEND §7 S10) renders through the chain from the server
  (`requiredApprovals`/`receivedApprovals`), but no mock moment has two approvers.
- Partial task sync on S09 (failed task + "Retry 1 failed task") is not mocked for validation tasks;
  the status tags support it (WS8d owns the pilot flow).
- The G2 prepare form does not collect stop rules or milestones (not in `GateScope`); the snapshot
  builder takes them from committed versions.
- The WS7 axe crawl timeout (change request 7).
