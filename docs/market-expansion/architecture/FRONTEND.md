# Market Expansion OS — Frontend Architecture

**Status:** Frozen at the architecture stage (decisions.md D-031) · **Date:** 9 October 2026
**Inputs:** approved prototype (`design/market-expansion/prototype/*.dc.html`, generator
`design/market-expansion/generator/common.py`, `components.py`), [UX research](../design/UX_RESEARCH.md)
§6–§10, [API](./API.md).
**Code:** `apps/web` (SPA), `packages/ui` (tokens, format rules, components), routes in
`apps/web/src/app/routes.ts`, typed client in `apps/web/src/lib/api-client.ts`.

---

## 1. Principles

1. **The prototype is the spec.** Layout, copy, states and tokens come from the 16 approved artboards.
   Business copy is exact (for example "Approve pilot €120k · 90 days", "Not available — needs ramp,
   retention and cash-timing inputs"). Infrastructure words (agent, MCP, harness, tokens) appear only in
   Administration › Diagnostics.
2. **Workspaces, ledgers and decision panels, not chat.** The AI copilot is contextual (analysis strip and
   proposals inside a workspace), never the navigation model.
3. **Server state is the truth.** Views render API view models; the client never recomputes money,
   stages or permissions. It renders labels from the contracts label maps and numbers with
   `packages/ui/format`.
4. **Every status has text, glyph and colour**, in a fixed position per dimension (research §7.2).
5. **Accessible by default:** WCAG 2.2 AA, keyboard paths for every action, tables behind every chart,
   polite live regions for status changes.

## 2. App structure

```
apps/web/src/
  main.tsx                 router + QueryClient + tokens.css
  app/
    routes.ts              FROZEN route table (ids, paths, deep-link params, owner stream)
    shell/                 AppShell, nav, app switcher, illustrative-data bar, ⌘K search   (WS7)
    auth/                  dev persona picker, session guard, role landing redirect          (WS7)
    case/                  CaseLayout: header, gate rail, tabs, right context panel         (WS7)
  lib/
    api-client.ts          typed client over contracts ENDPOINTS                            (WS7)
    query.ts               query keys, invalidation map, polling helpers                    (WS7)
    drafts.ts              autosave hook with If-Match and conflict handling                (WS7)
    idempotency.ts         per-intent Idempotency-Key helper                                (WS7)
  mocks/                   MSW handlers built from fixtures/aster (dev without API)         (WS7)
  screens/
    overview/  mandate/  opportunities/  compare/  my-work/  reviews/                       (WS8a)
    thesis/  sizing/  feasibility/  economics/                                              (WS8b)
    validation/  decisions/  brief/                                                         (WS8c)
    pilot/  outcomes/  evidence/  history/  admin/                                          (WS8d)
  e2e/                     Playwright specs (aster-journey, variants, a11y, ai-down)        (WS8*, WS7 harness)
packages/ui/src/
  tokens/tokens.css        light + dark tokens (ported)                                     (WS7)
  format/format.ts         number rules (implemented + tested)                              (WS7)
  components/contracts.ts  FROZEN props for shared components                               (WS7)
  components/*.tsx         implementations                                                  (WS7)
```

## 3. Routing and deep links

App-specific objects live under `/me/`; shared Growth OS objects keep root URLs (research §8.3).
Deep-link parameters are part of the contract: a screen must read them on load and write them when the
user selects something, so any view is shareable.

| Route | Screen | Deep-link params |
|---|---|---|
| `/login` | Dev persona picker | `next` |
| `/` | Role landing redirect (research §8.2) | — |
| `/me/overview` | S01 Portfolio / operator overview | `view=portfolio\|operator`, `bu` |
| `/me/mandates`, `/me/mandates/new`, `/me/mandates/:mandateKey` | S02 Mandate | `version` |
| `/me/opportunities` | S03 Discovery | `mandate`, `status`, `selected=OPP-07`, `product`, `geo`, `segment` |
| `/me/opportunities/compare` | S04 Compare | `ids=OPP-07,OPP-14,…`, `comparison`, `weights=v2` |
| `/me/cases` | Case list | `stage`, `owner`, `bu` |
| `/me/cases/:caseKey/thesis` | S05 Thesis | `claim`, `run` |
| `/me/cases/:caseKey/sizing` | S06 Sizing | `input=adoption-rate`, `view=lineage`, `version=2`, `compare=1`, `scenario` |
| `/me/cases/:caseKey/feasibility` | S07 Feasibility | `dimension` |
| `/me/cases/:caseKey/economics` | S08 Economics | `input`, `view`, `version`, `scenario` |
| `/me/cases/:caseKey/validation` | S09 Validation | `assumption`, `experiment=EXP-03`, `amendment=1`, `view=register\|matrix` |
| `/me/cases/:caseKey/decisions` | S10 Decisions | `gate=G2`, `version=3`, `compare=2` |
| `/me/cases/:caseKey/brief` | Read-only decision brief | `gate`, `version` |
| `/me/cases/:caseKey/pilot` | S11 Pilot | `task=PIL-11`, `view=preview` |
| `/me/cases/:caseKey/outcomes` | S12 Outcomes | `metric` |
| `/me/cases/:caseKey/history` | History tab (audit) | `object`, `id` |
| `/my-work` | My Work | `tab`, `item` |
| `/reviews` | Reviews inbox | `tab=awaiting\|assigned\|economics`, `request` |
| `/evidence`, `/evidence/:sourceKey` | S13 Evidence | `case`, `claim`, `passage` |
| `/admin/:section` | S14 Administration | `run` (diagnostics) |
| `/design-system` | DesignSystem artboard (living reference) | — |

`/me/cases/:caseKey` redirects to `thesis`. Case keys (`ME-104`), source keys (`SRC-014`), opportunity
keys and experiment keys are used in URLs; the API accepts them directly. The research examples
(`/me/cases/ME-104/sizing?input=adoption-rate&view=lineage`,
`/me/cases/ME-104/decisions?gate=G2&version=3&compare=2`) work as written.

**Navigation:** global nav Overview · Opportunities · Cases · My Work · Evidence · Reviews ·
Administration (hidden for non-admins, not disabled). Case tabs Thesis · Sizing · Feasibility · Economics
· Validation · Decisions · Pilot · Outcomes · History, with blocking counts ("Validation · 1 disputed").
Future-stage tabs stay enabled with teaching empty states. The Growth OS app switcher shows Competitive
Response as "Not enabled in this workspace".

## 4. Data fetching, caching and polling

- **TanStack Query** for all server state. Query key = `[operationId, params, query]` (`queryKey()`).
- `staleTime` 30 s by default; `refetchOnWindowFocus` on. Case header and decision package use 10 s.
- **Polling** while something is in flight: analysis runs (`queued`, `running`) and task sync (`sending`,
  `checking`, `retry_scheduled`) poll every 2 s and stop at a terminal status. No websockets in MVP (D-026).
- **Invalidation map** (`lib/query.ts`): every mutation declares which keys it invalidates. Any
  case-scoped mutation invalidates `cases.header` for that case (stage, next decision, rail and tab counts
  change together). Gate decisions also invalidate `overview.portfolio` and `reviews.inbox`.
- **No optimistic updates for decisions, submissions, sends, activation or outcome decisions.** The UI
  waits for the server and then shows the recorded result. Optimistic updates are allowed only for draft
  fields and comments.
- **Errors:** `ApiProblem` carries the problem-details body. A shared `ProblemBanner` maps codes to copy:
  `SNAPSHOT_STALE` → stale banner with "See what changed" and "Refresh snapshot (creates vN+1)";
  `PRECONDITIONS_UNMET` → "Why?" list from `blockers`; `NOT_FOUND` → generic not-found (never "no access to
  case X"); `VERSION_CONFLICT` → draft conflict banner.
- **Idempotency:** `useIntent()` creates one `Idempotency-Key` per user intent (button press) and reuses
  it for automatic retries of that request, so a double click or network retry cannot double-submit.
- **Dev without the API:** MSW handlers in `src/mocks` serve fixture-based responses that satisfy the
  contracts schemas, so screen streams start before the API exists. CI runs e2e against the real API.

## 5. Design tokens and component port

### 5.1 Tokens

`packages/ui/src/tokens/tokens.css` is a one-to-one port of the generator's `T` map (light) and research
§10.3 (dark): base palette, semantic status colours, AI violet, restricted, epistemic kinds, scenario ramp,
chart reference lines, categorical palette, type scale, spacing, radius, layout widths, motion. Dark mode
follows `prefers-color-scheme` unless `data-theme` is set. Components reference variables only; a lint
check (stylelint `color-no-hex` in `apps/web` and `packages/ui/src/components`) will forbid raw hex values
outside `tokens.css` (WS7 adds this check in week 1). Fonts: Geist (UI), Source Serif 4 (reading: decision package, thesis prose,
evidence excerpts, exports), Geist Mono (IDs, versions, fingerprints, task keys, formula rows, ledger
figures); `font-variant-numeric: tabular-nums` on tables. The dev build loads Google Fonts like the
prototype; production self-hosts the font files (WS7 task).

### 5.2 Port mapping (prototype helper → component)

| Prototype helper (`common.py` / `components.py`) | Component (`packages/ui`) | Notes |
|---|---|---|
| `kind()` | `KindTag` | Evidence solid · Assumption dashed · Scenario dotted · Actual bold · Unknown dashed grey · Calculated |
| `ai()`, `proposed()` | `AiBadge` | beside, never instead of, the kind |
| `diamond()`, `gate_chip()` | `GateDiamond`, `GateChip` | 11 states (research §10.4) |
| `stage()`, `pill()` | `StagePill`, `Pill` | On hold = warning pause, Stopped/Closed = neutral stop |
| `result()` | `ResultGlyph` | Met / Not met (neutral) / Inconclusive / Too early / Amended |
| `astatus()` | `AssumptionStatus` | ruler-pencil + dot + text |
| `sync()` | `SyncStatus` | "Confirmed · PIL-11" only with key |
| `conn()` | `ConnectorStatus` | Connected / Expired / Missing permission / Unavailable |
| `fresh()` | `Freshness` | Current / Ageing / Stale / Superseded |
| `run()` | `RunStatus` | role=status, business copy |
| `review()` | `ReviewStatus` | Signed, Signed · pilot scope, Pending, In review, Blocker, Disagreement |
| `evq()` | `EvidenceQuality` | shield family |
| `sens()` | `Sensitivity` | three bars + text |
| `opp()` | `OpportunityTag` | outlined tag |
| `src()` | `SourceChip` | links to S13; restricted variant shows lock |
| `sc_mark()`, `cat_mark()` | `ScenarioMark`, `CategoricalMark` | ▼ ● ▲ shapes required |
| `avatar()`, `person()` | `Avatar`, `Person` | |
| `btn()`, `ibtn()` | `Button`, `IconButton` | disabled buttons always render a reason |
| `card()`, `h2()`, `eyebrow()` | `Card`, `SectionHeader`, `Eyebrow` | |
| `banner()` | `Banner` | warn / danger / info / ok / neutral / lock; role=status |
| `table()` | `DataTable` (TanStack Table) | numeric columns right-aligned, tabular |
| `seg()` | `SegmentedControl` | |
| `shell()`, `navitem()`, `app_switcher()` | `AppShell`, `NavItem`, `AppSwitcher`, `IllustrativeDataBar` | |
| `case_header()`, `rail()`, `gate_node()`, `next_block()` | `CaseHeader`, `GateRail`, `NextDecision` | rail compresses on scroll |
| `auth_boxes()` | `AuthBoxes` | "What this authorizes / does not authorize" |
| `condition()` | `ConditionItem` | "Blocks execution until met" vs "Monitor only" |
| S10 sticky panel | `ApprovalPanel` | version + fingerprint, authority, boxes, chain, scoped actions, rationale required |
| S06 sections | `MeasureLadder`, `CohortTable`, `InputLedger`, `LineageDrawer`, `CrossCheck` | no total row, no money bars |
| S08 sections | `ScenarioTable`, `MoneyCardPair`, `WhatMustBeTrue`, `ExclusionsBox` | "Do not add" divider |
| S09 sections | `AssumptionRegister`, `AssumptionMatrix`, `DisputeThread`, `ExperimentCard` | original threshold struck through |
| S11 sections | `BaselineCard`, `BudgetMeter`, `TaskTable`, `SyncPreview`, `MessageDraftCard` | |
| Shared (PRD §7) | `EvidenceDrawer`, `OwnerPicker`, `ReviewPanel`, `ActivityTimeline`, `AnalysisStrip`, `AutosaveStatus` | |

Props for all of these are frozen in `packages/ui/src/components/contracts.ts`.

### 5.3 Number and label rules

`packages/ui/src/format/format.ts` implements research §10.5 and is tested against the Aster fixture:
`€100m/year`, `€40m/year`, `€2.0m annual revenue`, scenario rows (€1.0m · €2.0m · €2.4m; €0.60m ·
€1.20m · €1.44m; €600k; €0k (break-even) · €600k · €840k), `€400k one-time`, `5,000`, `−500` (U+2212),
`20%`, `€35–50m/year`, exact `€40,000,000`, `Not available — reason`. Components never format money
themselves. Labels come from `*_LABELS` in contracts; reserved words follow research §7.2 rule 4.

### 5.4 Charts

Allowed charts (research §10.6): measure ladder site-count bars, scenario dot plot with capacity line,
actual vs threshold bars, budget meter, top-down range vs bottom-up marker. Every chart has a Table toggle
and a caption with unit, year and currency. Hand-rolled SVG (small, accessible); no charting library in
MVP.

## 6. Drafts and autosave

- Draft resources (mandate, thesis, sizing, economics, pilot plan, experiment draft, outcome review,
  message draft) use `useDraft(endpointGet, endpointPatch)`:
  - field edits update local state immediately;
  - a debounced save (800 ms after the last change, and on blur and route change) sends a `PATCH` with
    `If-Match: "<rowVersion>"`;
  - status in the header: "Saving…", "Saved · 2 min ago", "Unsaved changes — retry", "Changed elsewhere";
  - unsent edits are mirrored to `sessionStorage` keyed by tenant + resource + version, restored after a
    reload and cleared after a successful save;
  - `412 VERSION_CONFLICT` shows a conflict banner with "Review changes" (field-level diff of mine vs
    theirs) — never a silent overwrite.
- Drafts recalculate on the server (engines are server-side); changed cells get the "Recalculated"
  highlight from `changedInDraft` flags. Committed versions are read-only with a lock glyph.
- Destructive or consequential actions (submit, decide, send, activate, stop, retire, dismiss) use a
  confirmation dialog that states the impact and requires the rationale field where the API requires it.

## 7. State handling per screen

Each screen implements the prototype's states. The table lists the non-happy states that must exist,
with the API signal that drives them.

| Screen | States (all designed in the prototype) | Driven by |
|---|---|---|
| S01 | empty; restricted scope label; finance source unavailable; stale approval row | `scope`, `dataSources`, rail `invalidated` |
| S02 | missing owner/currency; incompatible horizon; returned with comment; awaiting; approved; sponsor without authority | `validationErrors`, `panel.cannotDecideReason` |
| S03 | discovery partial; expired connector; likely duplicate; empty | `discoveryPartial`, `unavailableSources`, `likelyDuplicateOfId` |
| S04 | incomparable boundary; Unknown cells; not ranked; preview vs applied weights | `incomparableWarnings`, `rating: null`, `ranking.reason` |
| S05 | run working / partial / done; claim without evidence; AI draft; challenge open | `AnalysisRun.status`, `Claim.kind/origin` |
| S06 | SAM > TAM blocked; duplicate cohort; restricted site list; stale source | `result.checks`, `duplicateCohorts`, `siteListRestricted` |
| S07 | pending (never green); scoped sign-off; blocker; AI cannot review | `status`, `scope`, `humanOnly` |
| S08 | recommendation incomplete; currency/year mismatch; cash flow unavailable; capped upside | `incompleteReasons`, checks, `Unavailable` |
| S09 | disputed assumption; too early to read; amended threshold; partial task sync; illustrative examples | `openDispute`, `displayResult`, `amendments`, `TaskSet.summary` |
| S10 | stale snapshot; author cannot approve; waiting on second approver; conditions; invalidated after approval | `staleBanner`, `panel`, `approvals` |
| S11 | missing owner blocks activation; partial sync; checking; expired connector; paused; draft not authorized to send | `activationBlockers`, `sync.status`, `connectorBanner` |
| S12 | review incomplete; scale blocked; extension request with placeholder cap | `incompleteReasons`, `scaleGate.unmet` |
| S13 | restricted; deleted with provenance; superseded edition | `viewerAccess`, `availability`, `freshness` |
| S14 | connector states; authority gap; admins cannot approve | `admin.connections`, `admin.authority.gaps` |

Loading uses skeletons that keep layout stable; long work shows run status, never invented percentages.

## 8. Accessibility

- WCAG 2.2 AA. All interactive elements reachable and operable by keyboard; visible `:focus-visible`
  ring from tokens; skip link to main.
- Status text always renders with colour and glyph (research §7.5); icon-only status only in dense tables
  with column header and accessible name.
- Status changes (autosave, run status, sync status, gate decisions) announce through polite live regions.
- Tables have `scope="col"`/`scope="row"`, captions or `aria-label`; charts have a table equivalent.
- Dialogs (Radix) trap focus and restore it; destructive confirmations describe impact.
- Keyboard shortcuts: `⌘K` search (never offers Approve), `s`/`d`/`m` on S03, `]` context panel, `?` help.
- `prefers-reduced-motion` disables transitions. Minimum target size 24 px (WCAG 2.5.8).
- Playwright + axe run on every route in CI; a screen-reader smoke script covers the approval and sync
  journeys.

## 9. Security in the browser

- Session cookie is httpOnly; the SPA never sees tokens. All requests are same-origin via the Vite proxy
  in dev and the reverse proxy in production.
- No restricted content is cached beyond the query cache lifetime; the cache is cleared on logout and on
  persona switch.
- Exports and copy actions go through API endpoints that apply licence rules; the client never builds an
  export from cached excerpts.
