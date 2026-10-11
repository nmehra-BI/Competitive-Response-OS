# WS8b — Screens: assessment (S05 Thesis, S06 Sizing, S07 Feasibility, S08 Economics) · build notes

Base: `worktree-agent-a3827e28ef2e7ed16` (WS7 shell, components, MSW, Playwright harness).
WS2 engines read from `worktree-agent-aa0d31ef83422e2fc` @ `e0958a5` (not merged).

## What is where

| Path | Content |
|---|---|
| `apps/web/src/screens/thesis/ThesisScreen.tsx` | S05: analysis strip (`RunStatusTag`, polls while in flight, never a %), hero, claims with kind tags and AI badges (accept / discard / challenge), reasons to win, alternatives incl. **No entry**, critical assumptions, signed disagreements (`DissentItem`), blockers, recommendation (not a decision), edit thesis (autosave draft + commit), request analysis, assign reviewer |
| `apps/web/src/screens/sizing/SizingScreen.tsx`, `view.ts` | S06: measure ladder (TAM · SAM · Reachable pool "—" · SOM scenario, **no total row**), cohort table with signed overlap `−500`, formula row from the engine `(1,400 + 1,100 − 500) × €20,000`, input ledger → lineage drawer (WS7 connected `LineageDrawer`), cross-check (chart + table, never averaged), edit draft input, undo, duplicate-cohort resolution, restricted site list, compare versions, create snapshot |
| `apps/web/src/screens/feasibility/FeasibilityScreen.tsx` | S07: readiness checklist with named reviewers, scoped sign-off (`Signed · pilot scope`), specialist row "Pending — human review required" + "AI cannot provide this review", record disagreement, request review, reviewer-only "Record review", resolve blocker / restrict scope (disabled with reasons), competition list. No readiness score |
| `apps/web/src/screens/economics/EconomicsScreen.tsx`, `view.ts` | S08: editable drivers (autosave via `useDraft` + live local recompute), ▼●▲ scenario table with "Recalculated" cells, recurring vs one-time cards with the "Do not add" separator, cash flow / payback "Not available" + missing inputs, exclusions, what must be true, customers chart + table, finance review, dispute form and thread, Draft / Snapshot toggle |
| `apps/web/src/screens/{sizing,economics}/engine/` | Verbatim port of the WS2 engines + `adapter.ts` (see decision 1) |
| `apps/web/src/screens/*/mocks.ts`, `sizing/mock-state.ts`, `economics/mock-builders.ts` | MSW handlers (auto-collected) |
| `apps/web/src/screens/sizing/assessment.css` | Layout only, token variables only |
| `apps/web/e2e/assessment.spec.ts` | Playwright + axe: acceptance steps 6–9, variants |

Registry: four one-liners in `screens/registry.ts` (`caseThesis`, `caseSizing`, `caseFeasibility`, `caseEconomics`).

## Decisions

1. **Engines behind a thin adapter, ported until WS2 merges.**
   Context: S08 needs live recompute; mocks must return exactly what WS2 produces; `@growth-os/domain` still has stubs on this base.
   Decision: copy WS2 `numeric/checks/lineage/sizing/economics` and `platform/snapshot/canonical` verbatim (imports adjusted, header comment) into `screens/{sizing,economics}/engine/`. Screens and mocks import only `engine/adapter.ts`. Tests pin the WS2 input hashes for the fixture (`74cedbb3…`, `3b748b4d…`) and the golden values; a one-off script confirmed the port's outputs are byte-identical to WS2's.
   Swap: add `@growth-os/domain` to apps/web, change the import in the two `adapter.ts` files, delete the ported files.
   Alternatives: merge the WS2 branch (forbidden); hand-written mock JSON (drifts).
   Consequences: `decimal.js` added to apps/web dependencies. The economics engine ships in the S08 chunk (~15 kB).
2. **Live recompute is a preview; the server result wins.** Driver edits recompute locally through the adapter immediately; the debounced `PATCH economics/draft` (If-Match) returns the server result, which replaces the local one. Both run the same engine on the same input (`economicsInputFromDrivers`), asserted equal in tests. Committed snapshots are only ever read, never recomputed (FRONTEND §1.3 still holds: the client never *persists* computed money).
3. **Blocked sizing never shows ladder values.** When `result.blocked` the ladder is replaced by "Ladder values are hidden while a blocking check is open"; SAM count and formula result read "Paused"; the lineage mock nulls calculated node values ("Not available — resolve the blocking checks first"). This deviates from the prototype's SAM > TAM state (which still shows the ladder) on purpose, per WS2-3 and the brief.
4. **"Used by" is grouped by measure and follows the measure chain.** SAM value has no direct dependents in the WS2 graph (WS2-5). The lineage mock walks dependents transitively, treating `sizing.reachable_pool` ≡ `input.reachable_pool` and `input.annual_spend_per_site` ≡ `input.annual_price`, and groups them as TAM / SAM / Reachable pool / SOM / Economics. SAM → "Reachable pool, SOM, Economics" (step 8). Ledger `usedByCount` uses the same grouping.
5. **Undo edit is a session undo stack** (sessionStorage per case): the contracts carry no "previous value" on a ledger row. Undo PATCHes the previous value; the mock drops the edit when the value returns to the original.
6. **Mock moment is the assessment moment (13–14 Oct)**, while WS7's case header stays at aster-demo (26 Nov). Sizing starts as draft v2 (uncommitted) so step 8 "Commit sizing v2" works; economics v2 is committed with draft v3; the fixture dispute is open (switch off with `adoptionDisputed: false` for step 9).
7. **Variants via the shared WS7 scenario object** (no WS7 edit): `__growthOsMocks.setScenario({ sizingVariant: 'sam_exceeds_tam' | 'duplicate_cohort', adoptionDisputed: false, thesisRun: 'running'|'partial'|'completed', siteListRestricted: true })`. Read lazily per request. Vitest: `setAssessmentScenario`, reset with `resetAssessmentMocks` (in `test-utils.tsx`). E2E switches variants then navigates client-side (a reload resets mock state).
8. **Thesis blockers glyph rule.** `ThesisView.blockers` has no status: items blocking the upcoming G1 render "Pending", items blocking a later gate render "Blocker" (matches the prototype).
9. **Restricted site list**: aggregate-only viewers per fixture entitlements (Jonas as pilot owner, the operations lead as read-only reviewer). Data owner shown: Maya Rao (the prototype says Jonas, but Jonas is himself aggregate-only in the fixture).
10. **Specialist sign-off resolves its blocker** when a non-dissenting review covers the blocked gate (step 15); "Resolve blocker" stays available for other cases; "Restrict scope" is disabled (needs an approved gate scope restriction).

## Workflow updates

- Sizing (WF for S06): edit draft input → recalc → blocking checks → commit `CALCULATION_BLOCKED` when blocked; duplicate cohort keep v1 / keep imported (excluded, kept in history; keeping the import yields the engine's honest `MISSING_INPUT` for the missing overlap).
- Economics: draft autosave with `VERSION_CONFLICT` banner (Take theirs / Keep mine); commit disabled with reason when unchanged or blocked.
- Disputes: owner cannot dispute their own assumption (`FORBIDDEN`), one open dispute per assumption (`INVALID_TRANSITION`), only disputer or sponsor resolves.
- Feasibility: only the named reviewer can record a review (`FORBIDDEN` otherwise).

## Change requests

- **CR-WS8b-1:** `FeasibilityAssessment` has no long-form question text; S07's specialist section shows the short question + evidence text instead of the prototype's full question (`specialistQuestion` in the fixture).
- **CR-WS8b-2:** add `REVIEW_AREA_LABELS` to contracts (Assign reviewer humanizes the enum for now).
- **CR-WS8b-3 (supports CR-WS2-2):** `LineageNode.usedBy` would remove the measure-chain derivation in decision 4 from the API.
- **CR-WS8b-4:** `ThesisView.blockers[]` could carry a status so decision 8 is data, not a rule.
- **CR-WS8b-5:** `LedgerRow` could carry the pre-edit value (or the API exposes draft edit history) so "Undo edit" survives a new session.

## Out-of-scope edits

- `apps/web/package.json`, `pnpm-lock.yaml`: `decimal.js` dependency (engine adapter, field conversion).
- `apps/web/src/mocks/mocks.test.ts` (WS7): the "unmocked endpoints answer like the skeleton API" case used `sizing.get`, which is now mocked; it uses `dev.simulatedIssues` instead (same assertion).
- `apps/web/src/screens/registry.ts` †: four one-liners.
- `apps/web/e2e/support/harness.spec.ts` (WS7): the axe crawl of every route gets `test.setTimeout(120_000)`; with real screens it takes ~35 s (one full page load per route) and hit the 30 s default. Assertions unchanged.
- `apps/web/e2e/support/fixtures.ts` (WS7): `axeViolations` first waits for finite running animations to finish. The S06 deep link opens the lineage drawer, whose 240 ms fade-in made axe report colour-contrast on half-transparent text (a race, not a real violation).

## Status

Done: S05–S08 with every FRONTEND §7 state for these screens (S05 run working/partial/done, claim without evidence (Unknown), AI draft, challenge open; S06 SAM > TAM blocked, duplicate cohort, restricted site list; S07 pending never green, scoped sign-off, blocker, AI cannot review; S08 recommendation incomplete, cash flow unavailable, capped upside). Tests: engine port 5, adapter 3, mocks 11, screens 20 (Vitest, jsdom); Playwright 11 WS8b specs incl. axe on every screen and variant, plus the WS7 harness (16/16 pass with `E2E_PORT=5291 E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). Lint, typecheck, format, unit tests and the web build pass.

Known gaps:
- Use a free `E2E_PORT` when several worktrees run Playwright: the harness reuses an existing server on 5174 outside CI and would test another stream's app.
- "Submit for G1 · validation €15k" links to S10 (`decisions?gate=G1`, WS8c owns gate submission).
- "Export with formulas" is a plain download link to `economics.export`; not mocked (needs the API).
- Mocks for `assumptions.list/dispute`, `challenges.reply/resolve`, `cases.requestReview`, `analysis.*` and `evidence.requestAccess` live here; WS8c (S09) and WS8d (S13) should reuse or replace them (first matching screen handler wins).
- `currency/year mismatch` on S08 renders through the generic "Recommendation incomplete" banner (engine check messages); no fixture variant drives it yet.
- Economics shows only the latest committed snapshot (the view carries `current` only).
