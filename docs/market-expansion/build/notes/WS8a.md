# WS8a — Screens: portfolio and discovery · build notes

Branch: `worktree-agent-a5c0e17b7808ef14f` (built on WS7 `worktree-agent-a3827e28ef2e7ed16` @ c00e84c).

## What landed

| Route (registry id) | Screen | File | Prototype |
|---|---|---|---|
| `/me/overview` (`overview`) | S01 Portfolio / operator overview | `screens/overview/OverviewScreen.tsx` | Main |
| `/me/cases` (`cases`) | Case list | `screens/overview/CasesScreen.tsx` | Main (case table) |
| `/me/mandates` (`mandates`) | Mandate list | `screens/mandate/MandatesScreen.tsx` | — |
| `/me/mandates/new` (`mandateNew`) | New mandate | `screens/mandate/MandateNewScreen.tsx` | — |
| `/me/mandates/:mandateKey` (`mandate`) | S02 Mandate + G0 | `screens/mandate/MandateScreen.tsx` | Mandate |
| `/me/opportunities` (`opportunities`) | S03 Opportunities | `screens/opportunities/OpportunitiesScreen.tsx` | Opportunities |
| `/me/opportunities/compare` (`compare`) | S04 Compare | `screens/compare/CompareScreen.tsx` | Compare |
| `/my-work` (`myWork`) | My Work + "Brief for this task" | `screens/my-work/MyWorkScreen.tsx` | MyWork |
| `/reviews` (`reviews`) | Reviews inbox | `screens/reviews/ReviewsScreen.tsx` | (research §8.1–8.2) |

Nine one-line entries in `screens/registry.ts`. Shared helpers for these screens (page header,
breadcrumb, dates, case table, people list, styles, test utils) live in `screens/overview/shared.tsx`,
`screens/overview/screens.css` and `screens/overview/test-utils.tsx`; ARIA tabs in
`screens/my-work/WorkTabs.tsx`. UI is `@growth-os/ui` components and tokens only (no hex; the
`no-hex` test covers the new files). All data goes through `useApiQuery` / `useCommand` / `api()`
with frozen endpoint definitions, so the screens switch to WS4 with no code change.

Variant states (FRONTEND §7):

- **S01** empty ("No expansion cases yet" → Create a mandate); restricted scope label and a BU
  without access (`BU Air · no access`, disabled); finance source unavailable (warn banner with
  last refresh; "Spent to date: Not available — …", never 0); stale approval row (gate chip renders
  `invalidated` from the rail). Spend is a chart with a Table toggle and caption; one-time budgets
  only; market sizes are never totalled (the case note is rendered). `view` and `bu` deep links.
- **S02** missing owner / currency and incompatible horizon (server `validationErrors` → summary
  with links that focus the field, inline messages, open items in the G0 checklist, Submit disabled
  with the reason); returned with comment (rationale of the return decision from the G0 package);
  awaiting (the WS7 connected `ApprovalPanel`, bound to the snapshot id + hash on screen); approved
  (stamp, "No spend is authorized by G0", Go to opportunities); sponsor without authority (panel
  lock: "You have no G0 authority for BU Water. Request access from [Tenant administrator]."). The
  draft autosaves with If-Match (`useDraft`), publishes "Saving… / Saved" to the header, handles
  `VERSION_CONFLICT` (keep mine / take theirs). Committed versions are read-only ("Changes create vN+1").
- **S03** discovery partial (from `discoveryPartial` / `unavailableSources`); likely duplicate
  (`likelyDuplicateOfId`, merge keeps both records); empty (explains filters/sources, manual add);
  AI candidates show "Proposed · AI"; "n of m candidates · not an exhaustive search". Actions:
  Shortlist (`s`), Dismiss with a required reason (`d`; stays under "Dismissed · Duplicate"),
  Merge (`m`), Add manually, Convert to case (confirmation with a required owner, impact text).
  Shortcuts never fire while typing. Deep links `mandate`, `status`, `selected`, `product`, `geo`, `segment`.
- **S04** incomparable boundary blocks the ranking ("Exclude until normalized" / "Include again");
  Unknown cells as the dashed Unknown tag, never 0; "Not ranked — 1 input missing (channel access)";
  preview vs applied weights (pure `previewRanking`, "Total 110% — must be 100%", Apply creates
  weights vN+1, `weights=vN` deep link and a notice when a link names an older version). Score shows
  2 decimals ("Score 2.70 of 3") and the server's `formulaText` is shown. Select for assessment is
  not offered for an incomparable candidate.
- **My Work** tabs Tasks · Reviews · Approvals (WAI-ARIA tabs, arrow keys), brief (why, done looks
  like, stay inside, measured against, gate + sync text), "No approvals for you" with the server's
  `approvalsNotice`. Mark in progress / Mark done (`tasks.update` with If-Match), Report blocker.
- **Reviews** tabs Awaiting your decision · Assigned to you · Economics reviews · Done; gate
  decisions link to the package (S10) or the mandate (G0); the shared `ReviewPanelView` records
  Confirm / Dispute / Abstain with a required reason.
- **Login picker content**: the WS7 picker already renders the persona list from
  `auth.listDevPersonas` with role summaries; checked by the journey spec (step 1). No change.

## Mocks

Every endpoint the screens call has a handler (built from `fixtures/aster` and prototype copy,
validated against the contract by `mock()`):

| File | Endpoints |
|---|---|
| `screens/mandate/mocks.ts` | `mandates.list/get/create/saveDraft/submitForG0`; `gates.get/package/decide` **scoped** to the G0 requests of mandates in its store |
| `screens/opportunities/mocks.ts` | `opportunities.list/get/createManual/shortlist/dismiss/restore/merge/convertToCase`; `cases.header` and `cases.activity` **scoped** to cases converted in this tab |
| `screens/compare/mocks.ts` | `comparisons.create/get/previewRanking/applyWeights/setExclusion/selectForAssessment` (WS2 ranking rules) |
| `screens/overview/mocks.ts` | `overview.portfolio`, `cases.list` (WS7 base + G0 decisions + converted cases) |
| `screens/my-work/mocks.ts` | `work.mine` (prototype briefs; task items carry the task id) |
| `screens/reviews/mocks.ts` | `reviews.inbox` (honours `tab`), `reviews.respond` |

- `screens/mandate/mock-kit.ts`: `persisted()` keeps a screen's mock state in sessionStorage so a
  journey survives the full page load of a persona switch (Maya submits → Elena returns → Maya
  resubmits → Elena approves); `scoped()` claims a shared endpoint only for the ids a screen owns
  and passes everything else to the next handler.
- Moments: discovery runs at **aster-start** (MD-21 approved; OPP-07/12/09/14/16 Detected; OPP-03
  Dismissed; trade registry unavailable) while the WS7 base stays at aster-demo (ME-104 at G2).
  Converting OPP-07 puts ME-104 in Discovery with G0 Approved (5 Oct) for the rest of the tab.
- Not mocked here: `pilot.get`, `pilot.updateTask`, `pilot.reportBlocker` (S11 owns them; WS8d).
  Until those mocks land, My Work's status buttons answer "Not mocked yet" in `dev:mock`; the
  component test registers them with `mockServer.use`.

## Tests

- Component / mock tests (Vitest, jsdom, against MSW): `mandate/MandateScreen.test.tsx` (5),
  `opportunities/OpportunitiesScreen.test.tsx` (6), `compare/CompareScreen.test.tsx` (3),
  `compare/compare-mocks.test.ts` (4, ranking rules), `overview/OverviewScreen.test.tsx` (4),
  `my-work/MyWorkScreen.test.tsx` (4, incl. reviews). 26 tests.
- Playwright + axe (`apps/web/e2e/`): `discovery-journey.spec.ts` (acceptance steps 1–5 with axe on
  every screen), `mandate.spec.ts` (G0 loop across personas; read-only approved mandate),
  `work-and-reviews.spec.ts` (Jonas, Elena, Daniel landings and actions). With the WS7 harness:
  11/11 pass, every route axe-clean (WCAG 2.0/2.1/2.2 A+AA).
- Local run: `E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome E2E_PORT=5291 pnpm --filter @growth-os/web test:e2e`.
  Use a free `E2E_PORT`: `reuseExistingServer` otherwise attaches to another worktree's Vite on 5174.

## Decisions

1. **Ranking order is the rank.**
   Context: `RankingRow` has `ranked`, `score`, `reason` but no rank number.
   Decision: the client shows "Rank i of n" from the order of ranked rows in `ranking` (the WS2
   engine returns rank order, ties keep input order); the score is displayed exactly as the server's
   decimal string ("2.70"). The client never recomputes a score.
   Alternatives: sort by score on the client (recomputation; ties ambiguous).
   Consequences: WS2/WS4 must keep `ranking` in rank order (the mock does). CR-5 asks for an explicit field.
2. **Comparison is created from the `ids` deep link.**
   Context: S04's frozen deep link is `ids=…&comparison=…&weights=…`; S03 links with `ids` only.
   Decision: without `comparison`, S04 reads the first candidate's mandate and calls
   `comparisons.create` (idempotent; the API returns the existing comparison for the same set), then
   writes `comparison=<id>` with `replace`. Commas in `ids` stay readable in the URL.
   Consequences: shared links work with either form; WS4's `create` should return the existing
   comparison for an identical candidate set (no duplicates on reload).
3. **Compare selection is explicit.** S03 rows carry a "Compare OPP-07 …" checkbox (max 4);
   "Compare selected (n)" is disabled with a reason below 2. The prototype's row button stays the
   detail selector (`selected` deep link). Alternative: compare all active candidates (implicit).
4. **G0 decides in the shared approval panel.** S02 renders the WS7 connected `ApprovalPanel`
   with the snapshot id and hash from the G0 package on screen; allowed dispositions come from the
   server (`approve`, `return_for_revision` for G0). The returned comment and approval stamp are
   read from the package's approvals, not stored on `Mandate`.
5. **Approvals in a package are those on its current snapshot.** The G0 mock lists decisions on
   earlier snapshots in `gateHistory` only. Reason: WS7's `decidedNoteFor` treats any effective
   approval as "decided", which hid the actions after a return-and-resubmit. WS4 should follow the
   same rule (or WS7 should filter by `snapshotId`).
6. **People come from the dev persona directory (interim).** Owner pickers (mandate owner, case
   owner on convert) use `auth.listDevPersonas` (available in the pilot's `AUTH_MODE=dev`). CR-1.
7. **Mandate scope fields are read-only in S02.** Product and segment are ids with no catalogue
   endpoint; geography renders with `Intl.DisplayNames`; names appear in the server's scope
   preview. A new mandate copies product, segment, geography and sponsor from an existing mandate
   ("Start from the scope of"). CR-2.
8. **My Work status changes read the task row version from the pilot plan.** `tasks.update`
   needs If-Match; `WorkItem` has no row version, so the client reads `pilot.get` (fresh) at click
   time and sends the task's `rowVersion`. CR-3.
9. **Mock state per tab.** Screen mock stores persist in sessionStorage (`growth-os:mock:*`) so a
   multi-persona journey works in one tab; a new tab starts fresh; Vitest resets them with
   `resetAllMocks()`.
10. **Mandate AI suggestions are omitted.** The prototype's "Suggested adjacent segments · AI
    draft" box has no data source (`analysis.proposals` is case-scoped). Nothing is shown rather
    than an empty AI box; the screen works with AI disabled.

## Workflow updates

- **WF (mandate → G0):** draft (autosave, If-Match) → submit (server validation; `VALIDATION_FAILED`
  lists fields) → G0 awaiting → sponsor returns with a comment (new draft vN+1 copied from vN) or
  approves. Owner cannot approve (`SELF_APPROVAL_PROHIBITED`), admin `FORBIDDEN`, others
  `AUTHORITY_INSUFFICIENT`; decision bound to snapshot id + hash (`SNAPSHOT_HASH_MISMATCH`).
- **WF (discovery):** Detected → Shortlisted (`s`) → Converted (owner required; mandate must be G0
  approved, else `PRECONDITIONS_UNMET` "Mandate G0 approval is required"); Detected/Shortlisted →
  Dismissed (reason required) or Duplicate (merge, both kept). New failure path surfaced:
  converting under an unapproved mandate shows the blocker.
- **WF (compare):** incomparable boundary blocks ranking until excluded; selection shortlists and
  never approves spend; selecting an incomparable candidate is refused (`INVALID_TRANSITION`).

## Change requests (frozen contracts — not edited)

- **CR-1 People directory.** `GET /me/people?businessUnitId=&role=` → `PersonRef[]` for owner and
  condition-owner pickers. Today only `auth.listDevPersonas` (dev only) lists people.
- **CR-2 Scope catalogue for S02.** `GET /me/scope-options?businessUnitId=` → products, segments and
  countries with names, so product / segment / geography are editable and labelled in the form.
- **CR-3 `WorkItem.rowVersion` (and `taskId` for kind `task`).** Lets My Work send If-Match without
  reading the pilot plan.
- **CR-4 (optional) G0 summary on `Mandate`.** `g0Decision: { disposition, rationale, by, at } | null`
  would avoid a package read for the returned / approved banners.
- **CR-5 `RankingRow.rank: number | null`.** Removes the reliance on array order (Decision 1).
- **CR-6 (optional) `ComparisonCell.evidenceQuality`.** Growth evidence uses `valueText` = the
  quality label today; the client maps it back to the enum to draw the shield.

## Out-of-scope edits

- `apps/web/e2e/support/harness.spec.ts` (WS7): `test.setTimeout(180_000)` in the axe crawl. With
  real screens one axe run per route takes 1–2 s, so 23 routes exceeded the 30 s default.
- `apps/web/src/screens/registry.ts` †: nine one-line entries (append-only, as designed).

## Status

Done: all WS8a screens with the prototype layout, copy and the FRONTEND §7 states; mocks for every
endpoint used (scoped where shared); 26 component/mock tests; 3 e2e specs (6 tests) covering
acceptance steps 1–5, the G0 loop, My Work and Reviews, all axe-clean. `pnpm typecheck`, `lint`,
`format:check`, `test` (124 passed, 13 todo) and `pnpm --filter @growth-os/web build` pass; mocks are
not in the production bundle.

Known gaps:
- CR-1/2/3 workarounds above (people from the dev directory, read-only scope fields, pilot-plan
  read for row versions).
- The ranking engine (WS2) is still a stub; the S04 mock implements its documented rules.
- Against the real API the journey spec needs a fresh `aster-start` seed; the G0 spec assumes the
  next mandate key is MD-22.
- My Work's status buttons depend on S11's `pilot.get` / `tasks.update` mocks (WS8d) in `dev:mock`.
- The "Request normalization" action from the prototype has no endpoint; S04 offers "Open candidate".
- Main bundle is still ~519 kB (WS7 note); every WS8a screen is its own lazy chunk (≤ 16 kB).
