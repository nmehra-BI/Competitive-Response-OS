# WS7 — Frontend shell and design system · build notes

Branch: `worktree-agent-a3827e28ef2e7ed16` (rebased onto `claude/zen-euler-ph3oag` @ 4eebc3c).

## Component catalogue (`@growth-os/ui`)

Import styles once: `import '@growth-os/ui/tokens.css'; import '@growth-os/ui/components.css';`.
Every status renders **glyph + text** (colour is the third cue); labels come from the contracts
`*_LABELS` maps. The living reference is the `/design-system` route.

| Area | Components (file) | Notes |
|---|---|---|
| Icons, links | `Icon`, `UiLink`, `UiLinkContext` (`components/Icon.tsx`) | Paths ported 1:1 from the generator. The app injects react-router links through `UiLinkContext`, so `packages/ui` has no router dependency. |
| Epistemic kinds | `KindTag`, `AiBadge` (`status.tsx`) | Evidence solid · Assumption dashed · Scenario dotted · Actual bold · Unknown dashed grey · Calculated · AI draft. |
| Status vocabularies | `StagePill`, `Pill`, `GateChip`, `GateDiamond`, `ResultGlyph`, `AssumptionStatusTag`, `SyncStatusTag`, `ConnectorStatusTag`, `Freshness`, `RunStatusTag`, `ReviewStatusTag`, `EvidenceQualityTag`, `SensitivityTag`, `OpportunityTag`, `SourceChip`, `ConditionFlagTag`, `ConditionStatusTag`, `ReviewerPositionTag`, `TaskStatusTag`, `CrossCheckTag` (`status.tsx`) | `SyncStatusTag` never shows "Confirmed" without an external key (renders "Checking"). `RunStatusTag` is a polite live region. Gate diamonds cover all 12 `GateStatus` values (Expired shares the Invalidated ring, per research §10.4). |
| Scenario marks | `ScenarioMark` (▼ ● ▲, decorative), `ScenarioLabel` (mark + name), `CategoricalMark` | |
| Primitives | `Button` (variants primary/secondary/ghost/decision; `disabledReason` always rendered and linked via `aria-describedby`; a bare "Approve" decision label throws), `IconButton`, `Card`, `SectionHeader`, `Eyebrow`, `Kbd`, `Mono`, `Banner` (warn/danger/info/ok/neutral/lock), `IllustrativeDataBar`, `RestrictedValue` (takes no value prop by design), `AutosaveStatus`, `SegmentedControl`, `DataTable`, `ChartTable` (chart/table toggle + caption), `TextAreaField`, `EmptyState`, `Skeleton`, `Avatar`, `Person` (`primitives.tsx`) | |
| Gates | `GateRail`, `AuthBoxes`, `ConditionItem`, `DissentItem`, `ReviewerPositions`, `ApprovalPanelView` (`gates.tsx`) | `ApprovalPanelView` is presentational: scoped approve button, Return / Not approved / Abstain, rationale required, conditions editor (approve with conditions), cannot-decide lock banner, disabled reason (stale). Only renders dispositions in `panel.allowedDispositions`. |
| Ledger family | `FormulaRow`, `MeasureLadderRow`, `LadderConnector`, `InputLedgerTable`, `LineageDrawerView`, `formatLineageValue` (`ledger.tsx`) | Drawer is a modal dialog (focus trap, Escape, focus restore). No total rows. |
| Shared objects | `EvidenceItem` (no excerpt when restricted), `AssumptionChip`, `OwnerPicker` (combobox + listbox, keyboard), `ReviewPanelView`, `ActivityItem`, `ActivityTimelineView` (`shared.tsx`) | |
| Tokens | `tokens.css` (light + dark), `SWATCH_GROUPS` (`tokens/swatches.ts`) | Dark mode: `prefers-color-scheme` unless `<html data-theme>` is set; user menu offers Light / Dark / Match system. |

Connected components (fetch through the typed client) live in `apps/web/src/app/`:
`ApprovalPanel` (frozen `ApprovalPanelProps`; decisions are bound to the snapshot id + hash the page
read — a different/stale/superseded snapshot disables approval), `LineageDrawer` (frozen
`LineageDrawerProps`), `CaseHeader` / `CaseLayout` (frozen `CaseHeaderProps`), `AppShell`
(implements `AppShellProps` plus `viewer`), `ProblemBanner` (problem code → copy; NOT_FOUND is
always generic).

## Using the shell from a screen (WS8)

1. Add one line to `apps/web/src/screens/registry.ts`: `caseSizing: lazy(() => import('./sizing/SizingScreen')),`.
2. Screens default-export a prop-less component; read params with `useParams()` and deep links with
   `useSearchParams()`. Case screens render under `CaseLayout`, which owns the `<h1>`: start at `<h2>`.
3. Data: `useApiQuery(API.x.y, { params, query })` and `useCommand(API.x.z)` from `lib/query.ts`.
   Commands get a per-intent Idempotency-Key automatically and run the invalidation map
   (`INVALIDATES`). No optimistic updates for decisions, sends, activation, submissions.
4. Drafts: `useDraft({ storageKey, server, save, reload })` from `lib/drafts.ts`, then
   `usePublishAutosave(draft.status)` so the header shows "Saving…" / "Saved · 2 min ago".
   Call `draft.flush()` on blur. 412 → `draft.conflict` + `resolveConflict('mine' | 'theirs')`.
5. Errors: `<ProblemBanner error={err} />`. Polling: `refetchInterval: pollWhile((d) => RUN_IN_FLIGHT.has(d.status))`.

## MSW mocks (dev without the API)

- `pnpm --filter @growth-os/web dev:mock` (sets `VITE_MSW=on`). Sign in through the persona picker.
  The mock sits at the **aster-demo** moment: ME-104, G2 v3 awaiting Elena's decision.
- Every response is validated against the contract schema (mock drift fails loudly); the api client
  also parses responses in DEV. Mocks enforce session (401), Idempotency-Key / If-Match (428), body
  validation (400), idempotent replay and `IDEMPOTENCY_KEY_REUSED`.
- Mocked now (24): `auth.*` (4), `search.query`, `overview.portfolio`, `cases.list`, `reviews.inbox`,
  `reviews.respond`, `work.mine`, `cases.header`, `cases.activity`, `mandates.list/get`,
  `opportunities.list/get/shortlist/dismiss`, `gates.preconditions/get/package/decide`,
  `lineage.get` (sizing nodes), `admin.connections`. `gates.decide` enforces no self-approval
  (Maya → `SELF_APPROVAL_PROHIBITED`), admin `FORBIDDEN`, others `AUTHORITY_INSUFFICIENT`,
  hash binding (`SNAPSHOT_HASH_MISMATCH`) and stale (`SNAPSHOT_STALE`).
- Everything else answers `500 INTERNAL "Not mocked yet: …"`, exactly like the skeleton API.
- **Adding mocks (WS8):** create `apps/web/src/screens/<screen>/mocks.ts` exporting
  `handlers = [mock(API.sizing.get, ({ params, viewerId }) => …)]` using `mock` / `MockProblem` from
  `src/mocks/define.ts` and builders/state from `src/mocks/data.ts` and `state.ts`. They are picked up
  automatically (`import.meta.glob`) and take precedence over base handlers. Build view models from
  `@growth-os/fixtures-aster` — never invent numbers.
- Variants: `window.__growthOsMocks.setScenario({ g2Stale: true })` in the browser,
  `setScenario` / `resetMockState` / `session.signIn(id)` from `src/mocks/node.ts` in Vitest
  (`mockServer.listen()` in `beforeAll`).

## Playwright + axe harness (`apps/web/e2e/support`)

`import { test, expect } from './support/fixtures'` gives `loginAs(persona, next?)`,
`expectAccessible(opts?)` (axe, WCAG 2.0/2.1/2.2 A+AA tags) and `mockScenario(...)`.
`ROUTE_SAMPLES` has one deep-link URL per frozen route. `pnpm test:e2e` runs
`e2e/support/playwright.config.ts`: `E2E_BASE_URL` targets a running app (CI: real API);
otherwise Vite starts on 5174 with MSW (`E2E_MOCKS=0` disables mocks). `E2E_CHROMIUM_PATH`
overrides the browser binary. `harness.spec.ts` self-tests login, landing, deep links, ⌘K, case
tabs and an axe crawl of every route (5/5 pass locally).

## Decisions

1. **Presentational UI package, connected components in the app.**
   Context: frozen props such as `ApprovalPanelProps`, `LineageDrawerProps`, `CaseHeaderProps` are id-based (they imply fetching), but `packages/ui` has no query client or router.
   Decision: `packages/ui` exports pure view components (`ApprovalPanelView`, `LineageDrawerView`, …); `apps/web/src/app/{connected,case,shell}` implements the frozen id-based props on top of them. Links go through `UiLinkContext`.
   Alternatives: put TanStack Query and react-router into `packages/ui`.
   Consequences: ui stays reusable by Competitive Response; screens import connected components from `apps/web/src/app/connected`.
2. **Approval binds to the snapshot the page read.** The connected panel sends the `snapshotId`/`snapshotHash` props (from the rendered package), not the latest fetched ones, and disables approval if they differ. Alternative: always send the latest hash — rejected (could approve unseen content; never-rule 2).
3. **Idempotency keys per intent, keyed by body fingerprint.** Same body → same key across retries and "Try again"; a new key after success or when the body changes. Transient failures (network, 5xx, `IDEMPOTENCY_IN_PROGRESS`, 429) retry with the same key; 4xx never retry.
4. **Invalidation by operation id set.** `INVALIDATES` is generated from the registry: same-group GETs + explicit cross-group effects + case header/activity/history/list for every case-scoped command; login/logout clear the cache. A unit test asserts every command has an entry and only targets GETs.
5. **MSW mocks validate responses against the contract and behave like the API edges**; unmocked endpoints return the skeleton's `500 INTERNAL` so screens see the same failure mode either way. Screen-owned mocks are auto-collected from `screens/*/mocks.ts` so WS8 streams never need to edit WS7 paths.
6. **Expired gate glyph = invalidated ring** (research §10.4 lists them together; the prototype had no Expired).
7. **No raw hex outside tokens.** A unit test (`packages/ui/src/no-hex.test.ts`) replaces the planned stylelint `color-no-hex` and also covers TSX. Swatch hex values for the design-system page live in `packages/ui/src/tokens/swatches.ts`.
8. **Design-system page is code-split** (lazy route) to keep it out of the main bundle.

## Workflow updates

- WF for gate decisions (S10): client side implemented — scoped label, rationale required,
  conditions at approval, panel lists only server-allowed dispositions, stale / changed snapshot
  disables approval, author sees "You authored this package and cannot approve it." New failure
  path surfaced in the UI: `SNAPSHOT_HASH_MISMATCH` → "The package changed since you opened it".
- Dev login (persona picker) → role landing; `next` deep link kept (only same-app relative paths
  are followed); cache cleared on persona switch.

## Change requests

- None to frozen contracts. Nice-to-have for WS4: a `GET /me/cases/:caseRef/people` (case members)
  endpoint. `OwnerPickerProps` has no options source; the connected approval panel currently derives
  condition-owner candidates from the package (reviewers, chain, owners).

## Out-of-scope edits

- `vitest.config.ts`: unit project includes `packages/*/src/**/*.test.tsx` and `apps/*/src/**/*.test.tsx` (jsdom via per-file docblock).
- `package.json` (root): devDependency `jsdom` (vitest resolves the environment from the root).
- `apps/web/package.json`: deps (msw, @playwright/test, @axe-core/playwright, testing-library, fixtures-aster), scripts `dev:mock`, `test:e2e`, typecheck of `e2e/support`, `msw.workerDirectory`.
- `apps/web/public/mockServiceWorker.js` (generated by `msw init`), ignored in `.prettierignore` and `eslint.config.js`.
- `apps/web/src/lib/api-client.ts` improvements (absolute URL in Node, non-JSON and malformed problem handling, `buildPath`, typed helpers) — owned by WS7 per FRONTEND §2.

## Status

Done: all components listed above with tests (50 ui tests: text + glyph for every value of every
vocabulary, shapes of gate diamonds, approval panel behaviour, ledger, shared objects); shell, login,
CaseLayout with deep links, design-system page; client helpers with tests (8); MSW mocks with tests
(13) and shell/approval integration tests (6); Playwright + axe harness (5/5 pass against mocks,
axe-clean on every route). `pnpm install / typecheck / lint / format:check / test` and
`pnpm --filter @growth-os/web build` pass.

Left / known gaps:
- Browsers: `cdn.playwright.dev` is blocked here, so `npx playwright install` fails; local runs used
  an npm-distributed Chromium via `E2E_CHROMIUM_PATH`. CI (WS1) must install Playwright browsers.
- Fonts load from Google Fonts like the prototype; self-hosting for production is not done.
- Gate rail does not yet compress on scroll; right context panel (`]`) is not built (screen-level).
- Remaining contract components without a WS7 implementation (screen-specific, data-bound):
  `CohortTable`, `ScenarioTable`, `MoneyCardPair`, `ExperimentCard`, `BudgetMeter`,
  `AnalysisStrip`, `EvidenceDrawer`, connected `MeasureLadder` / `InputLedger` /
  `ActivityTimeline` / `ReviewPanel` — the presentational building blocks exist; WS8 streams own
  the screens that bind them.
- Mocks cover the shell, M1 and S10 endpoints; other GETs answer "Not mocked yet" until a screen
  adds `screens/<screen>/mocks.ts`.
- Main bundle is ~509 kB (zod + contracts); route-level code splitting arrives as screens are lazy.
