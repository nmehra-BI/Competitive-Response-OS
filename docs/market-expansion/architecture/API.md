# Market Expansion OS — API Contract

**Status:** Frozen at the architecture stage (decisions.md D-031) · **Date:** 9 October 2026
**Source of truth:** `packages/contracts/src/api/*.ts`. Every endpoint below is an `endpoint({...})`
definition with Zod schemas for `params`, `query`, `body` and `response`, the screens that call it and
the PRD requirements it serves. The API registers routes from that registry (`apps/api/src/server.ts`), the
web client calls them through the same definitions (`apps/web/src/lib/api-client.ts`), and
`packages/contracts/src/contracts.test.ts` checks the registry (unique ids and paths, screen and PRD
coverage, idempotency on decisions and external writes). The endpoint tables in §9 are generated from the
registry.

---

## 1. Style

- **Resource-oriented REST + explicit commands.** Reads are `GET` on resources. State changes that are
  business decisions are `POST` on a command sub-resource (`/submit`, `/decisions`, `/activate`,
  `/sync`), never a generic `PATCH status`. Draft edits are `PATCH …/draft`.
- **Base path** `/api/v1`. App-specific resources are under `/me/…`; shared Growth OS resources
  (`/auth`, `/me` viewer, `/reviews`, `/my-work`, `/evidence`, `/search`, `/admin`) are at the root, so a
  second app can reuse them (research §8.3). Note: `GET /me` is the *viewer*; `/me/...` paths are the
  Market Expansion app.
- **References.** Path parameters named `caseRef` and `ref` accept a UUID **or** the per-tenant display
  key (`ME-104`, `OPP-07`, `SRC-014`, `MD-21`), so deep links work without a lookup call. `id` parameters
  are UUIDs.
- **JSON only**, UTF-8, camelCase fields. Timestamps are ISO 8601 with offset. Dates are `YYYY-MM-DD`.
- **Money and rates are decimal strings** (`"120000.00"`, `"0.20"`). Money objects carry `currency`,
  `measure` and `timeBasis`; the schema rejects a one-time measure labelled per-year. Missing values are
  `{ unavailable: true, reason, missingInputs }`, never `0`.
- **Labels.** Responses carry enum codes. The UI renders labels from the contracts label maps. Where the
  server composes business copy (scoped button labels like "Approve pilot €120k · 90 days", "Why?"
  blockers, stale banners), the field is explicitly named (`buttonLabel`, `why`, `staleBanner`).

## 2. Authentication and identity

- **Pilot (D-017):** `AUTH_MODE=dev` enables `GET /auth/dev-personas` and `POST /auth/dev-login`. The
  login picker offers the six Aster personas (Elena, Maya, Daniel, Jonas, Priya, Lena); the tenant
  administrator is also seedable for admin screens. Login creates a `platform.session` row and sets an
  `httpOnly`, `Secure`, `SameSite=Lax` cookie holding a random token; only its SHA-256 is stored.
- **Production:** OIDC (SSO) replaces the dev routes; they are not registered unless `AUTH_MODE=dev`.
- **`auth` levels on endpoints:** `session` (any signed-in principal), `human` (an interactive human
  session; service and agent principals get `403 AGENT_IDENTITY_FORBIDDEN`), `dev_only`.
- **CSRF:** state-changing requests require `Content-Type: application/json` and the `SameSite` cookie;
  the API rejects form posts.

## 3. Headers

| Header | Direction | Rule |
|---|---|---|
| `Idempotency-Key` | request | Required on every endpoint marked *Idempotency-Key* (all creates, submissions, decisions, sends, retries). A UUID chosen by the client **per user intent** (reuse it when retrying the same click). Stored per `(tenant, user, key)` for 24 h with the request hash. Same key + same body → the stored response is replayed. Same key + different body → `422 IDEMPOTENCY_KEY_REUSED`. Concurrent duplicate → `409 IDEMPOTENCY_IN_PROGRESS`. Missing → `428 PRECONDITION_REQUIRED`. |
| `If-Match` | request | Required on draft writes marked *If-Match*. Value is the quoted `rowVersion` from the last read (`"7"`). Mismatch → `412 VERSION_CONFLICT` with the current version in `detail`; the UI shows a conflict banner and merges. |
| `ETag` | response | Draft resources return `ETag: "<rowVersion>"`. |
| `X-Correlation-Id` | both | Optional on requests; always on responses. Propagated to audit events, jobs, connector calls and provider calls. |

## 4. Error model

All errors are RFC 9457 problem details with `Content-Type: application/problem+json`:

```json
{
  "type": "https://growth-os.example/problems/snapshot_stale",
  "title": "This snapshot is out of date: adoption assumption changed on 26 Nov. Approval is disabled.",
  "status": 409,
  "code": "SNAPSHOT_STALE",
  "correlationId": "1f6c…",
  "instance": "/api/v1/me/gate-requests/…/decisions",
  "blockers": [{ "key": "snapshot_current", "message": "Refresh snapshot (creates v4)" }]
}
```

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Zod validation of params, query or body failed; `errors[]` lists paths. |
| `UNAUTHENTICATED` | 401 | No, expired or revoked session. |
| `FORBIDDEN` | 403 | Visible resource; role does not allow the action. |
| `NOT_FOUND` | 404 | Missing **or not visible to the caller**. Hidden cases, sources and counts never leak through 403. |
| `AGENT_IDENTITY_FORBIDDEN` | 403 | Service/agent principal or non-interactive session on a `human` endpoint. |
| `AUTHORITY_INSUFFICIENT` | 403 | No delegated authority for gate, business unit or amount. |
| `SELF_APPROVAL_PROHIBITED` | 403 | Package author or case owner tried to approve. Copy: "You authored this package and cannot approve it." |
| `CONFLICT_OF_INTEREST` | 403 | Policy marks the reviewer conflicted. |
| `RESTRICTED_SOURCE` | 403 | Licence excludes the caller. The body contains no content, title fragments or counts. |
| `INVALID_TRANSITION` | 409 | State machine rejects the command in the current state. |
| `PRECONDITIONS_UNMET` | 409 | Gate, activation or scale preconditions unmet; `blockers[]` is the "Why?" list. |
| `SNAPSHOT_STALE` | 409 | The snapshot's inputs changed; refresh first. |
| `SNAPSHOT_HASH_MISMATCH` | 409 | `snapshotHash` in the decision body is not the current snapshot hash. |
| `APPROVAL_INVALIDATED` / `APPROVAL_EXPIRED` | 409 | Execution attempted on an approval that no longer applies. |
| `VERSION_CONFLICT` | 412 | `If-Match` mismatch. |
| `PRECONDITION_REQUIRED` | 428 | `If-Match` or `Idempotency-Key` missing. |
| `CALCULATION_BLOCKED` | 422 | Deterministic engine returned blocking checks (`checks[]`), e.g. SAM > TAM, negative overlap, mixed currency. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Key reused with a different body. |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | First request with the key still running. |
| `BUDGET_EXHAUSTED` | 409 | Analysis budget reached. |
| `CONNECTOR_UNAVAILABLE` | 503 | Task tool or source connection unusable (expired, missing permission, unavailable). |
| `RATE_LIMITED` | 429 | Per-user or per-tenant limits. |
| `INTERNAL` | 500 | Unexpected. Never leaks stack traces or restricted values. |

## 5. Pagination, filtering, sorting

- Cursor pagination on list endpoints: `?limit=50&cursor=<opaque>` → `{ items, nextCursor }`. `limit` is
  1–200. Cursors encode the sort key and id; they are tenant-bound and expire after 24 h.
- **No totals on filtered or access-scoped lists.** Where a scope matters, the response carries
  `scope: { label, partial }`, e.g. "Showing BU Water · cases you can access · hidden cases are not
  counted" (S01).
- Default sorts are fixed per resource (assumption register: sensitivity, then evidence quality; cases:
  latest update). Free-form sort parameters are not offered in MVP.

## 6. Command semantics that matter

### 6.1 Gate decision (`POST /me/gate-requests/:id/decisions`)

Body:

```json
{
  "snapshotId": "…",
  "snapshotHash": "<64 hex>",
  "disposition": "approve_with_conditions",
  "rationale": "Thresholds met; bounded pilot tests the disputed adoption assumption.",
  "note": null,
  "conditions": [
    { "text": "Pilot limited to 4 sites as signed by the specialist", "ownerId": "…", "dueOn": "2026-12-01", "dueRule": null, "flag": "blocks_execution" }
  ],
  "delegateToUserId": null
}
```

Checks in order, each with its error code: interactive human session → snapshot is the gate request's
current snapshot and `status = current` (`SNAPSHOT_STALE`) → `snapshotHash` equals the stored hash
(`SNAPSHOT_HASH_MISMATCH`) → policy: designated approver role, authority grant covering gate, business unit
and amount (`AUTHORITY_INSUFFICIENT`), not author/owner (`SELF_APPROVAL_PROHIBITED`), not conflicted →
required sign-offs present for approve dispositions (`PRECONDITIONS_UNMET`). The database repeats the
critical checks (DATA_MODEL §4). Response: the refreshed `DecisionPackageView`.

### 6.2 Task sync (`POST /me/task-sets/:id/previews` then `POST /me/task-sets/:id/sync`)

1. Preview is a dry run that returns `TaskSyncPreview { id, contentHash, destination, items, problems }`.
2. Send requires `{ previewId, previewHash }`. The server recomputes the preview content from the current
   plan version; a changed plan or expired preview → `409 PRECONDITIONS_UNMET` ("Preview again").
3. Send writes, in one transaction: per task an `external_task_link` (`sending`) and an `outbox_message`
   with idempotency key `sha256(tenant | plan version | task | connection | project)`, plus audit and
   graphile jobs. It returns `202` with the `TaskSet` (statuses `Sending…`).
4. The UI polls `GET /me/task-sets/:id` until no task is `sending`/`checking`.
5. Retry (`/retry`) re-enqueues only `failed` tasks with the **same** keys; confirmed tasks are never
   re-sent.

### 6.3 Drafts and calculation

`PATCH …/sizing/draft` and `PATCH …/economics/draft` store inputs and recalculate the draft with the
deterministic engine, returning blocking checks in the view. `POST …/commit` creates the immutable version
("Create snapshot v3") and fails with `422 CALCULATION_BLOCKED` while any blocking check remains.
Committed versions never recalculate.

### 6.4 Assumption change and materiality

`PATCH /me/assumptions/:id` with a value change creates a new immutable version and runs the materiality
evaluator in the same transaction. The response lists `staleSnapshotIds` (approval disabled until refresh)
and `invalidatedApprovalIds` (execution paused). See ARCHITECTURE.md §9.

### 6.5 Outcome decisions

`POST /me/cases/:caseRef/outcome-decisions` accepts `stop | revise | extend | proceed` only. Scale is
never a review decision: it needs a G3 gate request, which is refused with `PRECONDITIONS_UNMET` while
the demand threshold or specialist scale-readiness is unmet. `extend` is paired with an X gate request
(`/extension-requests`) that carries its own cap and does not unblock G3.

## 7. Async work

Analysis runs, ingestion and task sync return `202` immediately. Status is read by polling the resource
(TanStack Query `refetchInterval` 2 s while active, stop when terminal). Server-sent events are a later
optimization (D-026).

## 8. Response shapes

The Zod schemas are the specification; the main view models are:

| Schema (packages/contracts) | Used by | Notes |
|---|---|---|
| `Viewer` | `GET /me` | roles, authority grants, landing route, `isAdmin` |
| `PortfolioOverview` | S01 | access scope, cases by stage (accessible only), decisions awaiting viewer, spend rows (one-time budgets), data-source health, fixed note "Market sizes are not totalled across cases…" |
| `Mandate` | S02 | current + draft versions, live `scopePreview`, `validationErrors` |
| `Opportunity`, `Comparison`, `RankingRow` | S03, S04 | `Unknown` = `rating: null`, never 0; `incomparableWarnings`; versioned weights |
| `CaseHeader` | all case tabs | stage, rail nodes, next decision with `why[]`, freshness, tab counts |
| `ThesisView`, `Claim` | S05 | claims always carry a kind; AI drafts flagged by `origin` |
| `SizingView` → `SizingVersion` → `SizingOutput` | S06 | ladder, cohorts, overlap, ledger, checks, lineage, cross-check, restricted site list flag |
| `FeasibilityView` | S07 | named reviewers, scoped sign-offs, blockers, `humanOnly` |
| `EconomicsView` → `EconomicsOutput` | S08 | scenarios in fixed order; one-time separate; cash flow and payback `Unavailable` |
| `Assumption`, `Challenge` | S09 | register group, open dispute, used-by |
| `Experiment` | S09 | original + current plan, amendments, all result versions |
| `DecisionPackageView` | S10, brief | snapshot (content + fingerprint), approvals, positions, dissent, `panel` (what the viewer may do and why not), gate history, stale banner |
| `PilotPlanView`, `TaskSet`, `TaskSyncPreview` | S11 | pinned baseline, conditions, budget meter, internal vs external status |
| `OutcomeReviewView` | S12 | baseline vs actuals with history, causal limitations (required), scale-gate blockers |
| `SourceDetail` | S13 | `viewerAccess`; passages only for `excerpt`; impact lists accessible cases only |
| `AnalysisRun`, `Proposal`, `ToolCallRecord` | analysis strip, S14 diagnostics | business status labels; traces hold structured events only |

## 9. Endpoint catalogue (generated from the registry)

Columns: operation id · method and path (under `/api/v1`) · summary and success status · screens · PRD
requirements · required headers and session level. Screen ids: S01–S14 (PRD §7), `BRIEF` (read-only
decision brief), `MYWORK`, `REVIEWS`, `LOGIN`, `SHELL`, `SEARCH`.

### Auth and viewer

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `auth.listDevPersonas` | `GET /auth/dev-personas` | List the Aster personas for the dev login picker. Only when AUTH_MODE=dev. → 200 | LOGIN | ME-16 | dev only |
| `auth.devLogin` | `POST /auth/dev-login` | Start an interactive human session as the chosen persona. Sets an httpOnly session cookie. → 200 | LOGIN | ME-16 | dev only |
| `auth.logout` | `POST /auth/logout` | End the session. → 204 | SHELL | ME-16 | — |
| `auth.me` | `GET /me` | Viewer identity, roles, delegated authority and role-based landing route. → 200 | SHELL | ME-16 | — |

### Overview (S01) and case list

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `overview.portfolio` | `GET /me/overview` | Executive / operator overview. Only accessible cases; hidden cases are never counted. Never totals TAM. → 200 | S01 | S01, ME-16, ME-19 | — |
| `cases.list` | `GET /me/cases` | Expansion cases the viewer can access. → 200 | S01 | ME-16 | — |

### My Work and Reviews

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `work.mine` | `GET /my-work` | Tasks, experiments, conditions and review requests owned by the viewer, with the task brief. → 200 | MYWORK | ME-12, S11 | — |
| `reviews.inbox` | `GET /reviews` | Review requests and gate decisions for the viewer ("Awaiting your decision"). → 200 | REVIEWS | ME-06, ME-11 | — |
| `reviews.respond` | `POST /review-requests/:id/response` | Confirm / Dispute / Abstain with a reason. A dispute on an assumption opens a dispute thread. → 200 | REVIEWS, S07, S08 | ME-06, ME-15 | Idempotency-Key, human session |

### Search

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `search.query` | `GET /search` | Find cases, opportunities, assumptions, experiments and sources the viewer can access. Restricted source text is never searched. → 200 | SEARCH | ME-16 | — |

### Comments

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `comments.add` | `POST /me/cases/:caseRef/comments` | Comment on any case object. Comments are never material changes. → 201 | S05, S06, S07, S08, S09, S10, S11, S12 | ME-17 | — |

### Mandates (S02)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `mandates.list` | `GET /me/mandates` | Mandates the viewer can access. → 200 | S02 | ME-01 | — |
| `mandates.create` | `POST /me/mandates` | Create a mandate with an empty draft version (Draft mandate). → 201 | S01, S02 | ME-01 | Idempotency-Key |
| `mandates.get` | `GET /me/mandates/:ref` | Mandate with current and draft versions, live scope preview and validation errors. → 200 | S02, S03 | ME-01 | — |
| `mandates.saveDraft` | `PATCH /me/mandates/:ref/draft` | Autosave the draft. Partial fields allowed. Returns new ETag. → 200 | S02 | ME-01 | If-Match |
| `mandates.submitForG0` | `POST /me/mandates/:ref/submit` | Validate required fields (owner, currency, compatible horizons), commit the version and open the G0 gate request with a snapshot. → 201 | S02 | ME-01, ME-10 | Idempotency-Key, human session |

### Opportunities (S03)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `opportunities.list` | `GET /me/opportunities` | Candidates for a mandate with filters. Includes a partial-discovery flag when a source is unavailable. → 200 | S03 | ME-03 | — |
| `opportunities.get` | `GET /me/opportunities/:ref` | One candidate with fit criteria, evidence, unknowns and duplicate hint. → 200 | S03 | ME-03 | — |
| `opportunities.createManual` | `POST /me/opportunities` | Add a candidate manually. Starts as Detected with no evidence. → 201 | S03 | ME-03 | Idempotency-Key |
| `opportunities.shortlist` | `POST /me/opportunities/:ref/shortlist` | Detected → Shortlisted. → 200 | S03 | ME-03 | Idempotency-Key, human session |
| `opportunities.dismiss` | `POST /me/opportunities/:ref/dismiss` | Dismiss with a required reason. Stays visible under the Dismissed filter. → 200 | S03 | ME-03 | Idempotency-Key, human session |
| `opportunities.merge` | `POST /me/opportunities/:ref/merge` | Mark as Duplicate of a target. Both records are kept and linked. → 200 | S03 | ME-03 | Idempotency-Key, human session |
| `opportunities.restore` | `POST /me/opportunities/:ref/restore` | Dismissed → Detected with a reason. → 200 | S03 | ME-03 | Idempotency-Key, human session |
| `opportunities.convertToCase` | `POST /me/opportunities/:ref/convert` | Shortlisted → Converted. Creates an expansion case in Discovery (mandate must be G0-approved). Keeps evidence and origin. → 201 | S03, S04 | ME-03, ME-01 | Idempotency-Key, human session |
| `opportunities.requestDiscovery` | `POST /me/mandates/:ref/discovery-runs` | Start a bounded analysis run (mandate-to-search-plan) that proposes candidates. Results stay "Proposed · AI". → 202 | S03 | ME-03, ME-02 | Idempotency-Key |

### Comparison (S04)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `comparisons.create` | `POST /me/comparisons` | Compare up to four candidates on a common unit and horizon. → 201 | S03, S04 | ME-04 | Idempotency-Key |
| `comparisons.get` | `GET /me/comparisons/:id` | Comparison with cells (Unknown never 0), incomparable warnings, weights and ranking. → 200 | S04 | ME-04 | — |
| `comparisons.previewRanking` | `POST /me/comparisons/:id/ranking-preview` | Preview a weight change without applying it. Pure; writes nothing. → 200 | S04 | ME-04 | — |
| `comparisons.applyWeights` | `POST /me/comparisons/:id/weights` | Apply weights as a new version; earlier versions are kept. → 201 | S04 | ME-04 | Idempotency-Key |
| `comparisons.setExclusion` | `PUT /me/comparisons/:id/exclusions/:opportunityId` | Exclude or include a candidate in the ranking (e.g. until its boundary is normalized). It stays in the table. → 200 | S04 | ME-04 | — |
| `comparisons.selectForAssessment` | `POST /me/comparisons/:id/select` | Select a candidate for assessment (shortlists it). Does not approve spend. → 200 | S04 | ME-04 | Idempotency-Key, human session |

### Case envelope

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `cases.createDirect` | `POST /me/cases` | Create a case with a new inline mandate. Stage Draft mandate until G0. → 201 | S01, S02 | ME-01 | Idempotency-Key |
| `cases.header` | `GET /me/cases/:caseRef` | Persistent case header: owner, stage, next decision, freshness, gate rail, tab counts. → 200 | S05, S06, S07, S08, S09, S10, S11, S12, BRIEF | §7, ME-11 | — |
| `cases.transition` | `POST /me/cases/:caseRef/transitions` | Owner/sponsor commands outside gates: start assessment, hold, resume, stop (decision), close. Stop needs authority and rationale. → 200 | S05, S12 | §4, ME-17 | Idempotency-Key, human session |
| `cases.activity` | `GET /me/cases/:caseRef/activity` | Activity timeline (shared component); key decisions pinned. → 200 | S05, S12, S01 | ME-17 | — |
| `cases.history` | `GET /me/cases/:caseRef/history` | History tab: audit events for this case, filterable by object. → 200 | S13 | ME-17 | — |
| `cases.requestReview` | `POST /me/cases/:caseRef/review-requests` | Assign a reviewer with a focused question and "what to check" list. → 201 | S05, S07, S08 | ME-06 | Idempotency-Key |

### Thesis and claims (S05)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `thesis.get` | `GET /me/cases/:caseRef/thesis` | Thesis (current + draft), claims with kinds, top 5 assumptions, disagreements, blockers, reviewers. → 200 | S05 | ME-15, S05 | — |
| `thesis.saveDraft` | `PATCH /me/cases/:caseRef/thesis/draft` | Autosave thesis draft. Editing an AI field flips its origin to ai_edited. → 200 | S05 | ME-15 | If-Match |
| `thesis.commit` | `POST /me/cases/:caseRef/thesis/commit` | Commit the draft as an immutable thesis version. → 201 | S05 | ME-15 | Idempotency-Key, human session |
| `claims.create` | `POST /me/cases/:caseRef/claims` | Add a claim. Every claim has a kind; evidence claims need at least one source link. → 201 | S05 | ME-15, ME-02 | Idempotency-Key |
| `claims.accept` | `POST /me/claims/:id/accept` | Accept an AI-draft claim, optionally as an assumption owned by the viewer. → 200 | S05, S13 | ME-15 | Idempotency-Key, human session |
| `claims.discard` | `POST /me/claims/:id/discard` | Discard a proposed claim. Kept in history. → 200 | S05 | ME-15 | Idempotency-Key, human session |
| `claims.challenge` | `POST /me/claims/:id/challenges` | Challenge a claim (required statement). Sent to the claim owner. → 201 | S05 | ME-15 | Idempotency-Key, human session |

### Sizing (S06)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `sizing.get` | `GET /me/cases/:caseRef/sizing` | Measure ladder, cohorts, input ledger and cross-check for current and draft versions. → 200 | S06 | ME-05 | — |
| `sizing.saveDraft` | `PATCH /me/cases/:caseRef/sizing/draft` | Edit the sizing draft (creates the draft from current if absent). Recalculates the draft. → 200 | S06 | ME-05, ME-15 | If-Match |
| `sizing.calculateDraft` | `POST /me/cases/:caseRef/sizing/draft/calculate` | Run the deterministic sizing engine on the draft. Returns blocking checks; writes the draft result only. → 200 | S06 | ME-05 | — |
| `sizing.resolveDuplicateCohort` | `POST /me/cases/:caseRef/sizing/draft/duplicate-cohorts/resolve` | Keep one of two duplicate cohorts (the other is excluded, not deleted). → 200 | S06 | ME-05 | If-Match |
| `sizing.commit` | `POST /me/cases/:caseRef/sizing/commit` | Create snapshot vN: commit the draft as an immutable version. Rejected with CALCULATION_BLOCKED when checks fail. → 201 | S06 | ME-05 | Idempotency-Key, human session |
| `sizing.getVersion` | `GET /me/cases/:caseRef/sizing/versions/:version` | A committed sizing version (frozen; never recalculates). → 200 | S06, S10 | ME-05 | — |
| `sizing.compareVersions` | `GET /me/cases/:caseRef/sizing/compare` | Field-by-field difference between two sizing versions (or a version and the draft). → 200 | S06 | ME-05 | — |
| `sizing.population` | `GET /me/cases/:caseRef/sizing/cohorts/:cohortId/population` | Inspect population. Returns site rows only when policy allows; otherwise aggregates or 403 RESTRICTED_SOURCE without counts. → 200 | S06 | ME-16 | — |

### Lineage drawer

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `lineage.get` | `GET /me/cases/:caseRef/lineage` | Formula, inputs (one level), used-by and history for a figure. Same data in drafts and frozen versions. → 200 | S06, S08, S10, BRIEF | ME-15, ME-05, ME-07 | — |

### Feasibility (S07)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `feasibility.get` | `GET /me/cases/:caseRef/feasibility` | Readiness table with named reviewers. No readiness score. → 200 | S07 | ME-06 | — |
| `feasibility.sign` | `POST /me/cases/:caseRef/feasibility/:dimension/reviews` | Named reviewer records a scoped position. Human only; the agent cannot sign. → 201 | S07, REVIEWS | ME-06 | Idempotency-Key, human session |
| `feasibility.recordDisagreement` | `POST /me/cases/:caseRef/feasibility/:dimension/disagreements` | Record a signed disagreement; it is carried into G1/G2 packages. → 201 | S07 | ME-06, ME-10 | Idempotency-Key, human session |
| `feasibility.resolveBlocker` | `POST /me/blockers/:id/resolution` | Resolve a blocker with a reason, or restrict scope (which needs an approved gate scope restriction). → 200 | S07 | ME-06 | Idempotency-Key, human session |

### Economics (S08)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `economics.get` | `GET /me/cases/:caseRef/economics` | Drivers, scenario table, recurring vs one-time cards, unavailable cash flow/payback, finance review. → 200 | S08 | ME-07 | — |
| `economics.saveDraft` | `PATCH /me/cases/:caseRef/economics/draft` | Edit drivers in draft. The approved snapshot never recalculates. → 200 | S08 | ME-07, ME-15 | If-Match |
| `economics.calculateDraft` | `POST /me/cases/:caseRef/economics/draft/calculate` | Run the deterministic economics engine on the draft. → 200 | S08 | ME-07 | — |
| `economics.whatMustBeTrue` | `GET /me/cases/:caseRef/economics/what-must-be-true` | Work back from a target contribution after opex to required customers. Pure. → 200 | S08 | ME-07 | — |
| `economics.commit` | `POST /me/cases/:caseRef/economics/commit` | Create snapshot vN of economics (immutable). → 201 | S08 | ME-07 | Idempotency-Key, human session |
| `economics.requestFinanceReview` | `POST /me/cases/:caseRef/economics/finance-reviews` | Ask the finance partner to review a committed economics version. → 201 | S08 | ME-07, ME-06 | Idempotency-Key |
| `economics.signFinanceReview` | `POST /me/model-reviews/:id/sign` | Finance sign-off listing items checked and not checked. → 200 | S08, REVIEWS | ME-07 | Idempotency-Key, human session |
| `economics.export` | `GET /me/cases/:caseRef/economics/export` | Export with formulas and lineage. Inherits access and licence rules. → 200 | S08 | ME-07, §13 | — |

### Assumptions and disputes (S09 register)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `assumptions.list` | `GET /me/cases/:caseRef/assumptions` | Register sorted by decision sensitivity, then evidence quality. Groups: Test first / Test next / Monitor. → 200 | S09, S05 | ME-08 | — |
| `assumptions.create` | `POST /me/cases/:caseRef/assumptions` | Add an assumption with owner, value/unit, basis, sensitivity, method and due date. → 201 | S09 | ME-08 | Idempotency-Key |
| `assumptions.update` | `PATCH /me/assumptions/:id` | Change value or metadata. A value change creates a new immutable version and runs the materiality check. → 200 | S06, S08, S09 | ME-08, ME-11, ME-15 | If-Match, human session |
| `assumptions.versions` | `GET /me/assumptions/:id/versions` | All versions of an assumption. → 200 | S09, S06 | ME-08, ME-17 | — |
| `assumptions.retire` | `POST /me/assumptions/:id/retire` | Retire with a reason. → 200 | S09 | ME-08 | Idempotency-Key, human session |
| `assumptions.dispute` | `POST /me/assumptions/:id/disputes` | Open a dispute (reviewer dissent) with a proposed value. Stays until resolved with a reason. → 201 | S09, S08 | ME-08, ME-15 | Idempotency-Key, human session |
| `challenges.reply` | `POST /me/challenges/:id/replies` | Reply in a dispute or challenge thread. → 201 | S09, S05, S13 | ME-15 | Idempotency-Key |
| `challenges.resolve` | `POST /me/challenges/:id/resolve` | Resolve with a reason. For disputes, only the disputing reviewer or the sponsor may resolve. → 200 | S09, S05, S13 | ME-15 | Idempotency-Key, human session |

### Experiments (S09)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `experiments.list` | `GET /me/cases/:caseRef/experiments` | Experiments with plan (original + current), amendments and all result versions. → 200 | S09 | ME-09 | — |
| `experiments.create` | `POST /me/cases/:caseRef/experiments` | Create a draft experiment linked to assumptions. → 201 | S09 | ME-09 | Idempotency-Key |
| `experiments.updateDraft` | `PATCH /me/experiments/:id` | Edit a draft experiment. Rejected with INVALID_TRANSITION once locked — use amendments. → 200 | S09 | ME-09 | If-Match |
| `experiments.amend` | `POST /me/experiments/:id/amendments` | Amend a locked plan with a reason. Creates "Amendment n"; the pre-registered original stays visible. → 201 | S09 | ME-09 | Idempotency-Key, human session |
| `experiments.start` | `POST /me/experiments/:id/start` | Locked → Running. Requires the authorizing gate (G1) approved. → 200 | S09 | ME-09 | Idempotency-Key, human session |
| `experiments.recordResult` | `POST /me/experiments/:id/results` | Append a result version (Met / Not met / Inconclusive per metric) with period and source. Never overwrites. → 201 | S09 | ME-09, ME-14 | Idempotency-Key, human session |
| `experiments.recordDecision` | `POST /me/experiments/:id/decision` | Record the decision taken per the pre-registered rule (human decides; product recommends). → 201 | S09 | ME-09 | Idempotency-Key, human session |

### Gates, snapshots and approvals (S10, brief, G0, G3, X)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `gates.preconditions` | `GET /me/cases/:caseRef/gates/:gateCode/preconditions` | Deterministic precondition check for a gate (the "Why?" list). → 200 | S05, S09, S10, S12 | §4, ME-11 | — |
| `gates.createRequest` | `POST /me/cases/:caseRef/gate-requests` | Open a draft gate request with its requested scope (G1, G2, G3 or X extension with its own cap). → 201 | S05, S09, S12 | ME-10, §4 | Idempotency-Key, human session |
| `gates.get` | `GET /me/gate-requests/:id` | Gate request with current snapshot id, status and conditions. → 200 | S10, BRIEF | ME-10 | — |
| `gates.submit` | `POST /me/gate-requests/:id/submit` | Check preconditions, freeze a new snapshot (canonical JSON + SHA-256) from committed versions and submit. Prior snapshot becomes Superseded. → 200 | S05, S09, S10, S12 | ME-10, ME-11 | Idempotency-Key, human session |
| `gates.refreshSnapshot` | `POST /me/gate-requests/:id/refresh` | Refresh a stale snapshot: creates vN+1 from current committed inputs; the stale one is Superseded. → 200 | S10 | ME-11 | Idempotency-Key, human session |
| `gates.withdraw` | `POST /me/gate-requests/:id/withdraw` | Package author withdraws an undecided request. → 200 | S10 | ME-10 | Idempotency-Key, human session |
| `gates.package` | `GET /me/gate-requests/:id/package` | Decision package (S10) / decision brief: snapshot, positions, dissent, conditions, approval panel state for the viewer. → 200 | S10, BRIEF, S02 | ME-10, ME-11 | — |
| `gates.snapshotDiff` | `GET /me/snapshots/:id/diff` | "See what changed": differences between this snapshot and another, or the current committed inputs. → 200 | S10 | ME-11 | — |
| `gates.decide` | `POST /me/gate-requests/:id/decisions` | Record a decision on an exact snapshot. Requires interactive human session, authority grant for gate/BU/amount, not author/owner, snapshot current and hash equal. Approve adds conditions. → 201 | S10, BRIEF, S02 | ME-11, ME-10, §4 | Idempotency-Key, human session |
| `gates.recordPosition` | `POST /me/snapshots/:id/positions` | Reviewer signs a position (supports / supports with conditions / dissents / abstains) on a snapshot version. → 201 | S10, REVIEWS | ME-10, ME-06 | Idempotency-Key, human session |
| `gates.recordDissent` | `POST /me/cases/:caseRef/dissent` | Signed dissent in the reviewer's own words. Carried into every later package. → 201 | S09, S10 | ME-10 | Idempotency-Key, human session |
| `conditions.markMet` | `POST /me/conditions/:id/met` | Mark a condition met with evidence. Blocking conditions gate execution until met. → 200 | S11, MYWORK | ME-11, ME-12 | Idempotency-Key, human session |
| `gates.materialChanges` | `GET /me/cases/:caseRef/material-changes` | Material-change log with affected snapshots and approvals; uncertain items await escalation. → 200 | S10, S13 | §4, ME-11, ME-20 | — |
| `gates.resolveMateriality` | `POST /me/material-changes/:id/resolution` | Escalation owner classifies an uncertain change as material or not material. → 200 | S10 | §4 | Idempotency-Key, human session |

### Pilot plan and tasks (S11)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `pilot.get` | `GET /me/cases/:caseRef/pilot-plan` | Pinned approved baseline, conditions, budget meter, milestones/tasks with internal and external status, activation blockers. → 200 | S11 | ME-12, ME-13 | — |
| `pilot.saveDraft` | `PATCH /me/cases/:caseRef/pilot-plan/draft` | Edit milestones and tasks in the plan draft. Dependency cycles are rejected. → 200 | S11 | ME-12 | If-Match |
| `pilot.activate` | `POST /me/cases/:caseRef/pilot-plan/activate` | Activate the approved plan: G2 approval effective and unexpired, blocking conditions met, every task has an owner. Commits the plan version and moves the case to Pilot running. → 200 | S11 | ME-12, ME-11 | Idempotency-Key, human session |
| `tasks.update` | `PATCH /me/tasks/:id` | Update internal status/progress. Never changes external sync status. Never passes a gate. → 200 | S11, MYWORK | ME-12 | If-Match |
| `tasks.reportBlocker` | `POST /me/tasks/:id/blockers` | Report a blocker on a task (sets status Blocked, notifies the case owner). → 201 | S11, MYWORK | ME-12 | Idempotency-Key |
| `pilot.requestScopeChange` | `POST /me/cases/:caseRef/scope-change-requests` | Changing budget, sites or dates needs a new authorization; this opens one. → 201 | S11 | ME-11, §4 | Idempotency-Key, human session |
| `pilot.messageDrafts` | `GET /me/cases/:caseRef/message-drafts` | Outbound message drafts. There is no send endpoint in MVP. → 200 | S11 | §3, S11 | — |
| `pilot.updateMessageDraft` | `PATCH /me/message-drafts/:id` | Edit a draft. Stays a draft. → 200 | S11 | S11 | If-Match |

### Task sync via outbox (S09, S11)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `taskSync.get` | `GET /me/task-sets/:id` | Per-task external sync status ("5 of 6 tasks confirmed in Jira · 1 failed"). → 200 | S09, S11 | ME-13 | — |
| `taskSync.preview` | `POST /me/task-sets/:id/previews` | Dry run: destination, project, assignees, fields, permissions. Writes nothing external. → 201 | S09, S11 | ME-13 | Idempotency-Key |
| `taskSync.send` | `POST /me/task-sets/:id/sync` | Create the approved tasks from a current preview. Writes one outbox row per task with a stable idempotency key, in one transaction. Returns immediately (202). → 202 | S09, S11 | ME-13, ME-11 | Idempotency-Key, human session |
| `taskSync.retry` | `POST /me/task-sets/:id/retry` | Retry only failed tasks (same idempotency keys). Confirmed tasks are never re-sent. → 202 | S09, S11 | ME-13 | Idempotency-Key, human session |
| `taskSync.exportCsv` | `GET /me/task-sets/:id/export.csv` | Outage fallback: export the approved tasks as CSV (PRD §10). → 200 | S11 | ME-13, §10 | — |

### Budget (S11)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `budget.recordEntry` | `POST /me/cases/:caseRef/budget-entries` | Manual committed/spent entry against an approved gate budget. Over-cap spend is rejected; use a scope change. → 201 | S11 | ME-14 | Idempotency-Key, human session |

### Outcomes and review decisions (S12)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `outcomes.get` | `GET /me/cases/:caseRef/outcome-review` | Baseline vs actuals, limitations, readiness, recommendation, decision and scale-gate blockers. → 200 | S12 | ME-14 | — |
| `outcomes.recordObservation` | `POST /me/cases/:caseRef/outcome-observations` | Record an actual with period and source. Edits append a new version (supersedesId). → 201 | S12, MYWORK | ME-14 | Idempotency-Key, human session |
| `outcomes.saveReviewDraft` | `PATCH /me/cases/:caseRef/outcome-review` | Edit learned / changes next / causal limitations / recommendation (recommendation is not a decision). → 200 | S12 | ME-14 | If-Match |
| `outcomes.decide` | `POST /me/cases/:caseRef/outcome-decisions` | Sponsor records stop / revise / extend / proceed. "scale" is not accepted here: scale needs a G3 gate request. Extend requires an X gate request with its own cap. → 201 | S12 | ME-14, §4 | Idempotency-Key, human session |
| `outcomes.requestExtension` | `POST /me/cases/:caseRef/extension-requests` | Convenience: create and submit an X gate request with its own spend cap and scope. Does not unblock G3. → 201 | S12 | ME-14, §6 | Idempotency-Key, human session |

### Evidence (S13)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `evidence.list` | `GET /evidence/sources` | Sources the viewer can see (metadata), optionally for one case. → 200 | S13 | ME-02, ME-16 | — |
| `evidence.get` | `GET /evidence/sources/:ref` | Source detail with permitted excerpt only; restricted shows no excerpt, summary or paraphrase. Impact lists accessible cases only. → 200 | S13 | ME-02, ME-16, S13 | — |
| `evidence.upload` | `POST /evidence/sources` | Register an authorized upload (multipart: metadata + file). Ingestion runs asynchronously. → 202 | S13, S03, S06 | ME-02 | Idempotency-Key |
| `evidence.challenge` | `POST /evidence/sources/:ref/challenges` | Challenge a source (required statement). → 201 | S13 | ME-15 | Idempotency-Key, human session |
| `evidence.markStale` | `POST /evidence/sources/:ref/stale` | Mark stale with a reason. Runs the materiality check for snapshots that use it. → 200 | S13 | ME-15, ME-20 | Idempotency-Key, human session |
| `evidence.replace` | `POST /evidence/sources/:ref/replace` | Replace with a newer source. Re-links claims in drafts only; approved snapshots keep the original. → 200 | S13 | ME-15 | Idempotency-Key, human session |
| `evidence.requestAccess` | `POST /evidence/sources/:ref/access-requests` | Ask the licence owner for access. Reveals nothing. → 201 | S13, S06 | ME-16 | Idempotency-Key |

### Analysis runs and proposals

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `analysis.start` | `POST /me/cases/:caseRef/analysis-runs` | Request analysis with a skill. Immediate acknowledgement; runs asynchronously within budget. → 202 | S05, S06, S07, S08, S09, S11, S12 | §8, ME-15 | Idempotency-Key |
| `analysis.get` | `GET /me/analysis-runs/:id` | Run status for the analysis strip (poll while queued/running). → 200 | S05, S03 | §8 | — |
| `analysis.latestForCase` | `GET /me/cases/:caseRef/analysis-runs` | Recent runs for a case. → 200 | S05 | §8 | — |
| `analysis.cancel` | `POST /me/analysis-runs/:id/cancel` | Cancel. Committed results and human edits are kept. → 200 | S05 | §8 | Idempotency-Key |
| `analysis.resume` | `POST /me/analysis-runs/:id/resume` | Resume a partial/failed run from its last checkpoint. → 202 | S05 | §8 | Idempotency-Key |
| `analysis.provideInput` | `POST /me/analysis-runs/:id/input` | Answer a "Needs your input" question. → 202 | S05 | §8 | Idempotency-Key |
| `analysis.proposals` | `GET /me/cases/:caseRef/proposals` | Pending AI proposals for a case. → 200 | S05, S03, S06, S09, S11, S12 | §8, ME-15 | — |
| `analysis.decideProposal` | `POST /me/proposals/:id/decision` | Accept (optionally edited) or reject a proposal. Accepting writes the business record with origin ai or ai_edited. → 200 | S05, S03, S06, S09, S11, S12 | §8, ME-15 | Idempotency-Key, human session |

### Administration (S14)

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `admin.roles` | `GET /admin/role-assignments` | Roles table (S14). → 200 | S14 | ME-16 | — |
| `admin.setRole` | `PUT /admin/role-assignments/:id` | Grant or revoke a role. Admins configure but never gain approval authority. → 200 | S14 | ME-16, S14 | Idempotency-Key, human session |
| `admin.authority` | `GET /admin/authority-grants` | Delegated authority matrix (gate × BU × ceiling) and authority gaps. → 200 | S14 | ME-11, S14 | — |
| `admin.setAuthority` | `PUT /admin/authority-grants/:id` | Create/replace/revoke a grant. Grantee must not be a tenant admin acting for themselves. → 200 | S14 | ME-11 | Idempotency-Key, human session |
| `admin.policies` | `GET /admin/policies` | Gate policies, materiality rule, approval expiry, retention, run budget (active versions). → 200 | S14 | §4, S14 | — |
| `admin.publishPolicy` | `POST /admin/policies` | Publish a new policy version. Policies are versioned; old versions are kept. Cannot disable self-approval checks. → 201 | S14 | §4, S14 | Idempotency-Key, human session |
| `admin.entitlements` | `GET /admin/source-entitlements` | Licences and who sees excerpts / aggregates / nothing. → 200 | S14 | ME-16, ME-02 | — |
| `admin.connections` | `GET /admin/connections` | Connection health rows: status, scope, last success, used for. → 200 | S14, S03, S11 | ME-13, S14 | — |
| `admin.testConnection` | `POST /admin/connections/:id/test` | Health check through the connector interface. → 200 | S14 | ME-13 | Idempotency-Key |
| `admin.reconnect` | `POST /admin/connections/:id/reconnect` | Re-authorize a connection (simulated in dev). Paused sync resumes only after re-check. → 200 | S14, S11 | ME-13 | Idempotency-Key, human session |
| `admin.setMapping` | `PUT /admin/connector-mappings/:id` | Destination project, issue type and assignee map. → 200 | S14 | ME-13 | Idempotency-Key, human session |
| `admin.runDiagnostics` | `GET /admin/diagnostics/runs/:id` | Admin-only trace: structured outputs and tool events, never hidden reasoning. → 200 | S14 | S14, §13 | — |
| `admin.audit` | `GET /admin/audit` | Scoped audit search. → 200 | S14 | ME-17 | — |

### Dev-only simulator controls

| Operation | Method and path | Request → response | Screens | PRD | Headers |
|---|---|---|---|---|---|
| `dev.setConnectorFaults` | `PUT /dev/simulator/faults` | Configure fault injection on the simulated task connector. → 200 | S14 | ME-13, §10 | dev only |
| `dev.simulatedIssues` | `GET /dev/simulator/issues` | Inspect issues in the simulated tool (used by duplicate-write tests). → 200 | S14 | ME-13 | dev only |

## 10. Screen coverage check

Every prototype action has an endpoint. Summary by screen (see the catalogue for detail):

| Screen | Actions in the prototype | Endpoints |
|---|---|---|
| S01 Overview | open case, open decision, filter BU, create mandate, empty/restricted/error states | `overview.portfolio`, `cases.list`, `mandates.create`, `cases.createDirect` |
| S02 Mandate | autosave, submit for G0, approve / return with comment, request access | `mandates.*`, `gates.package`, `gates.decide` |
| S03 Opportunities | filter, shortlist, dismiss with reason, merge, add manually, convert, partial discovery, upload instead | `opportunities.*`, `evidence.upload`, `admin.connections` |
| S04 Compare | preview / apply weights, exclude until normalized, inspect evidence, select | `comparisons.*`, `evidence.get` |
| S05 Thesis | edit, request analysis, assign reviewer, challenge claim, accept AI draft, submit G1 | `thesis.*`, `claims.*`, `analysis.start`, `cases.requestReview`, `gates.createRequest`, `gates.submit` |
| S06 Sizing | edit assumption, inspect population, attach source, compare versions, lineage, resolve duplicate cohort, snapshot | `sizing.*`, `lineage.get`, `assumptions.update`, `evidence.upload` |
| S07 Feasibility | request review, attach assessment, record disagreement, resolve blocker / restrict scope | `feasibility.*`, `cases.requestReview` |
| S08 Economics | edit drivers in draft, what must be true, finance review, snapshot, export | `economics.*`, `lineage.get` |
| S09 Validation | dispute thread, resolve with reason, approve plan (G1), amend, record result, preview / create / retry tasks | `assumptions.*`, `challenges.*`, `experiments.*`, `gates.*`, `taskSync.*` |
| S10 Decisions / brief | approve within authority, return, not approved, abstain, delegate, conditions, see what changed, refresh, withdraw | `gates.package`, `gates.decide`, `gates.snapshotDiff`, `gates.refreshSnapshot`, `gates.withdraw`, `gates.recordPosition` |
| S11 Pilot | activate, preview, create tasks, retry failed, export CSV, update progress, report blocker, scope change, edit draft message (no send) | `pilot.*`, `tasks.*`, `taskSync.*`, `conditions.markMet`, `budget.recordEntry` |
| S12 Outcomes | record actuals, stop, revise, request extension with own cap, scale request disabled with reasons | `outcomes.*`, `gates.preconditions` (G3) |
| S13 Evidence | challenge, mark stale, replace, inspect impacted cases, request access | `evidence.*` |
| S14 Admin | roles, delegated authority, gate policies, materiality, entitlements, connections test/reconnect, run budget, diagnostics, audit | `admin.*`, `dev.*` (dev only) |
| My Work | tasks, brief, mark in progress / done, report blocker, record actuals | `work.mine`, `tasks.*`, `outcomes.recordObservation` |
| Reviews | awaiting decision, assigned reviews, confirm / dispute / abstain | `reviews.inbox`, `reviews.respond`, `feasibility.sign`, `economics.signFinanceReview` |
