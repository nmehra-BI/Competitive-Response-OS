# WS8d — Screens: execute, review and support · build notes

Branch: `worktree-agent-a2a2d0e9a51608526` (reset onto WS7 `worktree-agent-a3827e28ef2e7ed16`).

## What was built

| Route | Screen | File |
|---|---|---|
| `/me/cases/:caseKey/pilot` (`task`, `view=preview`) | S11 Pilot | `apps/web/src/screens/pilot/PilotScreen.tsx` |
| `/me/cases/:caseKey/outcomes` (`metric`) | S12 Outcomes | `apps/web/src/screens/outcomes/OutcomesScreen.tsx` |
| `/evidence`, `/evidence/:sourceKey` (`case`, `claim`, `passage`) | S13 Evidence | `apps/web/src/screens/evidence/EvidenceScreen.tsx` |
| `/admin/:section` (`run`) | S14 Administration | `apps/web/src/screens/admin/AdminScreen.tsx` |
| `/me/cases/:caseKey/history` (`object`, `id`) | History tab | `apps/web/src/screens/history/HistoryScreen.tsx` |

Six one-line entries appended to `screens/registry.ts`. Shared screen helpers (mine only):
`history/dates.ts` (Europe/Berlin date display; money stays in `@growth-os/ui` format),
`history/ws8d.css` (layout classes, tokens only), `pilot/test-utils.tsx`.

- **S11:** pinned baseline (G2 chip, snapshot v3 + fingerprint, ceiling, window, scope,
  pre-registered thresholds, C1/C2 condition items with "Mark C1 met"), budget meter
  (Approved · Committed · Spent · Remaining, `Unavailable` → "Not available — …"), task table with
  internal status and external sync in separate columns, activation blockers (missing owner banner,
  then C1 banner; the disabled button shows the first blocker), activate confirmation, dry-run preview
  (destination PIL, assignees, permissions, repeats), create → honest summary from the server
  (`summaryText`), "Retry N failed task(s)" sends only failed ids, polling every 2 s while any task is
  `sending/checking/retry_scheduled` (Checking → Confirmed), expired connector banner + "Export CSV
  instead" (downloads through `api(API.taskSync.exportCsv)`), approval-invalidated banner (sent kept,
  unsent paused), scope change / report blocker / edit-draft dialogs, message draft with
  "Draft — not authorized to send" and a disabled Send with its reason. Never "Synced".
- **S12:** decision lead ("Decision recorded: …", Key decision, What we learned / What changes next in
  Source Serif), baseline-versus-actuals table (actual with Actual kind tag + period + source, neutral
  `ResultGlyph` — never red), record-actual dialog, paid-use chart with Chart/Table toggle
  (`ChartTable`), readiness and causal limitations, recommendation card marked
  "RECOMMENDATION · NOT A DECISION", recommendation form (case owner), decision dialog (sponsor),
  "Request extension €[cap]" form (own cap, duration, owner, scope, authorizes / does not authorize),
  G3 card and "Request scale approval" disabled with
  "G3 preconditions unmet: demand threshold 3 of 4 (4 of 4 required); specialist scale-readiness review
  incomplete" (composed from `scaleGate.unmet`), key events.
- **S13:** source list, viewer (key, kind, status, dates, licence boundary, status line incl.
  "supersedes" / "Superseded by" / deleted with fingerprint kept), permitted excerpt in Source Serif 4,
  restricted (no excerpt anywhere; "Not shown — restricted."; Request access), aggregate-only, deleted
  with provenance, superseded with "Open SRC-014", stale; fact / inference / assumption panel;
  Challenge, Mark stale, Replace, Inspect impacted cases ("Cases you cannot access are not listed or
  counted.").
- **S14:** "Administrators cannot approve gates." banner, authority matrix with `up to €[limit]`
  placeholders and the G3 authority-gap banner + row, roles, gate policies, materiality / expiry /
  retention, source entitlements, connections (all four states; Test / Reconnect / Retry), run budget
  (business copy), Diagnostics (the only section with agent / MCP / harness / token terms; run trace via
  `?run=`). Non-admins get a lock banner and no admin requests are made.
- **History:** audit table in `seq` order with actor + role, summary, object and version; object filter
  written to the URL.

## Mocks (`screens/*/mocks.ts`, all through `mock()` so every response is contract-validated)

Endpoints added: `pilot.get/saveDraft/activate/messageDrafts/updateMessageDraft/requestScopeChange`,
`tasks.reportBlocker`, `conditions.markMet` (C1/C2), `taskSync.get/preview/send/retry/exportCsv`,
`outcomes.get/recordObservation/saveReviewDraft/decide/requestExtension`, `gates.preconditions` for
`X` only (other gates fall through to WS7), `evidence.list/get/challenge/markStale/replace/requestAccess`,
`admin.roles/authority/policies/entitlements/connections/testConnection/reconnect/runDiagnostics`,
`cases.history`. Role rules: pilot owner operates the pilot; case owner drafts the recommendation and
the extension; only the sponsor decides; admins get `FORBIDDEN` on every business action; other cases
404. Cross-tenant / unauthorized attempts are covered in `pilot/mocks.test.ts` and the screen tests.

Journey state (`screens/history/journey.ts`) is bound to WS7's `state.scenario`, so
`resetMockState()` resets it, and it is mirrored to `sessionStorage['growth-os:ws8d-mocks']` so a full
page load in Playwright keeps the journey. Seed a variant before navigating:
`sessionStorage.setItem('growth-os:ws8d-mocks', JSON.stringify({ seed: { pilotVariant: 'expired' } }))`
— `pilotVariant`: `normal | timeout | expired | invalidated`; `outcomesMoment`:
`pilot_ended | recommended | decided`. In the browser: `window.__ws8dMocks.seed({...})`.
Vitest: `seedWs8d({...})`.

## Tests

- Unit/component (Vitest + MSW, 27 tests): `pilot/mocks.test.ts` (8, API level incl. no duplicates,
  stale preview, variants), `pilot/PilotScreen.test.tsx` (5), `outcomes/OutcomesScreen.test.tsx` (4),
  `evidence/EvidenceScreen.test.tsx` (5), `admin/AdminScreen.test.tsx` (5 incl. History and the
  "infrastructure terms only in Diagnostics" check).
- Playwright + axe: `apps/web/e2e/ws8d-execute-review.spec.ts` (7 specs, steps 21–30 and variants, axe on
  every state). Full e2e run: 12/12 passed with
  `E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm --filter @growth-os/web test:e2e`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (125 passed, 13 todo),
  `pnpm --filter @growth-os/web build` pass.

## Decisions

1. **Mock journey state lives with the WS8d screens and survives page loads.**
   Context: MSW state is page memory; the acceptance steps span personas and full navigations.
   Decision: a WS8d state object keyed to WS7's `state.scenario` (reset together) and mirrored to
   sessionStorage, with seeds for variants. Alternatives: extend WS7's `MockScenario` (WS7-owned file);
   in-app navigation only (cannot switch persona). Consequences: e2e specs can seed and reload; nothing in
   WS7 paths changed.
2. **Status line never restates the sync summary.** The banner carries the server's `summaryText`; the
   polite status line describes the next action, so it never shows an outdated "1 checking".
3. **Spend cap and duration are entered, not invented.** The frozen body requires a decimal
   `spendCap`. The field shows "€[cap]" as its placeholder with "Placeholder · confirm with PM. The PRD
   sets no amount." and submit stays disabled until a value is entered; the X1 chip shows the entered
   cap (or "€[cap]" when only the status is known after a reload). See change request 3.
4. **Authority ceilings render as `up to €[limit]` in an illustrative tenant**, otherwise the formatted
   ceiling. Fixture ceilings are placeholder policy values and must not read as company policy.
5. **Scale request reason is composed from `scaleGate.unmet`** ("G3 preconditions unmet: a; b"); mock
   blocker messages carry the lower-case phrases.
6. **Task titles are deep links (`?task=PIL-11`)**; this also gives the scrollable table focusable
   content (axe `scrollable-region-focusable`; `DataTable`'s scroll wrapper has no tabindex).
7. **Diagnostics opens a trace only from `?run=`** (the frozen deep link); there is no tenant-wide run
   list endpoint.

## Workflow updates

- WF pilot activation / task sync (S11): client side implemented as in BUILD_PLAN M4 — blockers in
  server order (owner, then C1), preview id + hash bound to create, retry with failed ids only, polling
  while in flight, CSV fallback, paused on invalidated approval. No optimistic updates.
- WF outcome review (S12): actuals (period + source) → recommendation (not a decision) → sponsor
  decision → extension X request; scale only via a G3 request (button disabled with reasons).
- Evidence corrections (S13): challenge, mark stale (materiality check on the server), replace (drafts
  re-linked only).

## Change requests (frozen contracts not edited)

1. `OutcomeReviewView` has no `rowVersion`, yet `outcomes.saveReviewDraft` requires If-Match. The
   client sends `version`; the mock only checks presence. Add `rowVersion`.
2. `MessageDraft` has no `rowVersion`, yet `pilot.updateMessageDraft` requires If-Match (client sends 0).
   Add `rowVersion`.
3. `outcomes.requestExtension.spendCap` / `durationDays` cannot carry the PRD placeholders. Allow
   `spendCap: DecimalString.nullable()` (+ `durationDays` nullable) so X1 can be submitted as "€[cap]"
   until policy sets it.
4. Admin responses carry user and business-unit ids only (`RoleAssignment`, `AuthorityGrant`, gaps).
   Add `PersonRef` / BU name. Today names come from `auth.listDevPersonas` (dev login only) and BU names
   from `overview.portfolio`; otherwise short ids are shown.
5. No case-people endpoint for owner pickers (same as WS7): S11/S12 derive candidates from the plan /
   review, so "[Operations lead]" cannot be re-assigned when unowned.
6. `OutcomeReviewView` does not include the X request; the extension card after a reload uses
   `gates.preconditions` for `X` (status only). Add the extension request (key, cap, approver).

## Out-of-scope edits

- `apps/web/e2e/support/harness.spec.ts` (WS7): `test.setTimeout(120_000)` on the every-route axe
  crawl. With real screens the 23 axe scans exceed the 30 s default; every route is axe-clean.

## Status

Done: S11, S12, S13, S14 and History with all FRONTEND §7 variants, mocks, component tests and
Playwright/axe specs for steps 21–30.

Known gaps:
- The case header (WS7 mock) stays at the aster-demo moment ("Pilot approval pending") while the WS8d
  pilot mock starts after the fixture's G2 approval (27 Nov). The real API will be consistent.
- Budget entries (`budget.recordEntry`) have no UI; the meter only displays server values.
- "Fix mapping" (step 23) is modelled as a one-shot permission fault in the mock; mapping edits in S14
  (`admin.setMapping`) are not built.
- `claim` deep link on S13 is read but not highlighted (linked uses carry no ids).
- G3 note drops the prototype's "€400k one-time scale-entry investment" clause (no source in this view).
