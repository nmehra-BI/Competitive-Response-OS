# Decision log — Growth OS · Market Expansion OS

A running, append-only log of key decisions. Each entry is an ADR with a stable ID (`D-001`, `D-002`, …).
Later stages append a new `## Stage: <name>` section and continue the numbering. Do not edit an accepted
entry; supersede it with a new entry that names the old ID ("Supersedes D-0xx") and set the old entry's
status line to `Superseded by D-0yy` (the only permitted edit).

**Status values:** `Proposed` · `Accepted` · `Frozen` (part of the architecture freeze; changes need a
change request, see D-031) · `Superseded by D-xxx`.

**Template**

```
### D-xxx — Title
- Date: YYYY-MM-DD · Stage: <stage> · Status: <status>
- Context: why a decision is needed
- Decision: what we decided
- Alternatives considered: options and why not
- Consequences: what follows, good and bad
```

---

## Stage: Architecture

### D-001 — Modular monolith in one pnpm TypeScript monorepo
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: PRD §16 asks for a modular application, a relational system of record, asynchronous jobs and
  no microservices, graph database or generic app builder. A small team must build several streams in
  parallel without stepping on each other.
- Decision: One repository, one database, three process types (`apps/web`, `apps/api`, `apps/worker`) and
  in-process packages (`contracts`, `domain`, `db`, `ui`, `ai`, `connectors`), plus `fixtures/aster`,
  `skills/`, `evals/`. Deviations from the suggested layout: `packages/connectors` is separate so the
  connector stream owns it and the agent package cannot reach it; `evals/` is a workspace package; the
  folder for Growth OS primitives is named `platform` everywhere.
- Alternatives considered: microservices per domain (operational cost, distributed transactions across
  approval + outbox); polyrepo (contract drift); Nx/Turborepo (unneeded at this size).
- Consequences: One deploy unit per process type; transactions span state, audit and outbox; boundaries
  rely on schemas, folders and lint rules rather than network calls.

### D-002 — TypeScript end to end on Node 22; packages ship source
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: UI, API, worker, engines and contracts must share one type system and runtime validation.
- Decision: TypeScript 5.7 strict, Node 22, pnpm 10. Internal packages export `src/index.ts` directly with
  `moduleResolution: Bundler`; apps run with `tsx` in dev and are bundled for production.
- Alternatives considered: Python backend (splits domain types, as the sister plan noted); per-package
  `tsc` builds with project references (slower inner loop).
- Consequences: Zero build step between packages; extensionless imports; production bundling is a WS1
  task.

### D-003 — PostgreSQL 16 is the system of record, multi-tenant with RLS
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: PRD §8 says the application database and event log are the system of record; ME-16 requires
  tenant isolation; the environment provides a local PostgreSQL 16.
- Decision: One Postgres database for state, audit, analytics, outbox and jobs. Shared multi-tenant
  pilot deployment in an EU region. RLS on every `platform`/`me` table keyed by `app.tenant_id` set per
  transaction (`SET LOCAL`). Roles: `me_owner` (migrations), `me_app` (API), `me_worker` (jobs), all
  `NOBYPASSRLS`. Cross-tenant worker scans only via two `SECURITY DEFINER` functions that return ids.
- Alternatives considered: single-tenant database per pilot (more ops; can still be done later with the
  same schema); document database (weak for versioned relational snapshots); app-only tenant filters
  (one bug leaks data).
- Consequences: Isolation holds even if a query forgets a filter; every request runs in a transaction.

### D-004 — Database schemas `platform`, `me`, `sim` are the module boundary
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: PRD §9/§16 split shared Growth OS primitives from app-specific objects.
- Decision: `platform` = shared primitives; `me` = Market Expansion; `sim` = simulated external task tool
  (no RLS, behaves like a remote system). `platform` DDL does not reference `me`, except the declared
  `workflow_case.mandate_id → me.mandate` FK added in the `me` section.
- Alternatives considered: one schema with prefixes (boundary invisible); separate databases (breaks
  transactions).
- Consequences: A second app adds its own schema and reuses `platform`.

### D-005 — SQL-first migrations, Kysely queries, generated row types
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: RLS, triggers, CHECKs and hash verification are core to correctness and must be first-class.
- Decision: Hand-written forward-only SQL migrations (`packages/db/migrations`), a tiny runner that
  refuses edited migrations, Kysely for typed queries, `kysely-codegen` to generate `DB` types.
- Alternatives considered: Prisma or Drizzle schema-first ORMs (RLS and triggers become second-class).
- Consequences: Schema review is SQL review; types regenerate with `pnpm db:codegen`.

### D-006 — Fastify API driven by a frozen Zod endpoint registry
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: Several engineers will build API handlers and screens at once; shapes must not drift.
- Decision: Every endpoint is declared once in `packages/contracts/src/api` with params, query, body and
  response schemas, screens, PRD references, auth level, and whether `Idempotency-Key`/`If-Match` are
  required. The API registers routes from the registry; the web client calls through the same objects;
  tests check the registry. 143 endpoints are frozen.
- Alternatives considered: NestJS (heavier); GraphQL (aggregate-level authorization harder; the sister plan
  rejected it); OpenAPI-first YAML (second source of truth).
- Consequences: Adding or changing an endpoint is a contract change request.

### D-007 — graphile-worker with transactional enqueue; no Temporal
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: Outbox sends, analysis runs, timers and ingestion need durable jobs and retries. Long approvals
  are rows, not running processes.
- Decision: graphile-worker on the same Postgres. Jobs are added with `graphile_worker.add_job` inside the
  business transaction. A cron sweep recovers leased outbox rows. The domain outbox table remains the
  source of truth for external-write status.
- Alternatives considered: Temporal (strong, but operational cost not justified for the MVP); custom
  SKIP LOCKED queue (re-implements retries and cron); pg-boss (similar; graphile's SQL `add_job` fits
  transactional enqueue best).
- Consequences: No extra infrastructure; revisit if workflows grow complex.

### D-008 — Growth OS shared primitives vs app modules, enforced by lint
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: PRD §16 lists shared primitives (tenant/identity, enterprise context, evidence/provenance,
  decisions/approvals, actions, outcome reviews, agent runs) and app-specific analyses.
- Decision: Every package and app separates `platform/` from `me/`. ESLint forbids `platform` code and
  `packages/connectors` from importing `me`; `contracts` and `domain` cannot import `pg`, `kysely`,
  `fastify` or provider SDKs; `packages/ai` cannot import `@growth-os/db` or `@growth-os/connectors`.
- Alternatives considered: separate platform service (premature, PRD §10 "platform APIs follow proven
  reuse"); convention only (erodes).
- Consequences: Boundary violations fail CI.

### D-009 — Enum codes in data, exact research labels in one map
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: The UX research fixes exact labels ("Pilot approval pending", "Paused — approval changed",
  "Stopped — your work is saved") and reserved words.
- Decision: API and database use stable snake_case codes; `packages/contracts/src/enums.ts` holds the
  exact labels (`*_LABELS`). Components render labels only from these maps. Server-composed business copy
  is returned in explicitly named fields (`buttonLabel`, `why`, `staleBanner`).
- Alternatives considered: storing labels as values (copy edits become data migrations; labels with
  dynamic parts do not fit).
- Consequences: One place to change copy; tests can assert exact strings.

### D-010 — Money as decimal strings with typed measures; recurring and one-time never summed
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: PRD §6 forbids adding recurring software to one-time spend and requires reproducible
  calculations; research §6.6 and §7.3 define five money measures.
- Decision: `numeric(18,2)` in Postgres, decimal strings in JSON, decimal.js in engines. `Money` carries
  `measure` and `timeBasis`; the schema rejects a measure with the wrong time basis. Engines expose no
  operation that combines `one_time` and `per_year`. Missing money is `Unavailable`, never 0.
- Alternatives considered: JS numbers (float drift); integer cents (awkward for rates and large sums).
- Consequences: Golden tests compare exact strings; display rounding happens only in `packages/ui/format`.

### D-011 — One mutable draft, immutable committed versions, enforced in the database
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: "Edit in draft. The approved snapshot never recalculates." (S08); human edits must survive.
- Decision: Versioned objects (mandate, thesis, sizing, economics, pilot plan) have at most one `draft`
  row and immutable `committed` rows; child rows are guarded by trigger; assumptions version on every
  value change; experiments have plan versions and append-only result versions.
- Alternatives considered: event sourcing everything (heavier); mutable rows with history tables (easy to
  bypass).
- Consequences: Commit is an explicit user action ("Create snapshot vN"); committed versions pin the
  exact assumption versions they used.

### D-012 — Decision snapshots are canonical JSON hashed with SHA-256 and verified by the database
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: ME-10/ME-11: only the correct snapshot can be approved; "You can never approve something
  different from what you read."
- Decision: `SnapshotContent` is canonicalized with an RFC 8785 subset (sorted keys, no whitespace,
  integers only, money as decimal strings) and hashed with SHA-256. Postgres stores `content_canonical`,
  checks `content_hash = sha256(content_canonical)`, and exposes `content` as generated `jsonb`. Approvals
  reference `(snapshot_id, snapshot_hash)` by composite FK. Fingerprint = first 8 hex chars, `XXXX·XXXX`.
  Snapshot versions are numbered per case.
- Alternatives considered: hashing `JSON.stringify` (key order not stable); storing only jsonb (Postgres
  normalizes jsonb, so the hashed bytes would be lost).
- Consequences: API and DB must agree byte for byte (tested); prototype fingerprints (`7F3A·19C2`) are
  illustrative and will differ from real hashes.

### D-013 — Materiality policy table; stale vs invalidated; uncertain escalates
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: PRD §4: material changes to geography, product, spend ceiling or assumptions invalidate
  affected approvals; policy defines materiality; uncertain cases escalate.
- Decision: A versioned tenant policy maps change types to `material`, `not_material` or `uncertain`
  (unlisted = uncertain). Only commits trigger evaluation. Material: current snapshots that pin the object
  become `stale` (approval disabled, "Refresh snapshot") and effective approvals are invalidated (unsent
  writes pause, case returns for review). Uncertain: snapshots go stale and the sponsor classifies;
  approvals are invalidated only if classified material. Approvals expire unused after a policy period
  (default 14 days).
- Alternatives considered: invalidate on any change (approval churn); never invalidate (stale approvals
  execute).
- Consequences: `snapshot_component` indexes pinned versions; effects run in the same transaction.

### D-014 — Case lifecycle and creation paths
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: PRD §4 lists case stages starting at Draft mandate, while the prototype converts an
  opportunity of an already approved mandate into a case in Discovery.
- Decision: G0 belongs to the mandate. Two creation paths: (a) convert a shortlisted opportunity of a
  G0-approved mandate → stage Discovery; (b) create a case with an inline new mandate → Draft mandate
  until G0. Gate events drive stage changes; task completion never does. On hold stores
  `held_from_stage`. Stop is a recorded decision with authority and rationale. Revise/extend after review
  returns the case to Validation.
- Alternatives considered: every case starts at Draft mandate (duplicates G0 per candidate); stage driven
  by task progress (PRD forbids).
- Consequences: The rail shows G0 approved for converted cases; transitions are a frozen table.

### D-015 — Gate requests with per-case snapshot versions; extension is gate X
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: S10 shows "G2 · Package v2 superseded by v3"; S12 requires "Extension request creates a new
  gate request with its own cap" and the scale gate stays blocked.
- Decision: A `gate_request` is one attempt at a gate with many snapshot versions; only the current
  snapshot can be decided. Gate codes are G0, G1, G2, G3 and X (extension, with a parent gate). Button
  labels always state scope and money. G3 has its own preconditions; an X approval never unblocks G3.
- Alternatives considered: one gate request per snapshot (history fragments); extension as a G2 edit
  (silently raises an approved budget, which research forbids).
- Consequences: Scope changes and extensions are new authorizations.

### D-016 — Authorization: roles, scope, delegated authority, invariants, database defence in depth
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: ME-11, ME-16, S14 ("Administrators cannot approve gates"), PRD §2 authority table.
- Decision: Roles × actions policy table (`ROLE_ACTIONS`), scope by business unit and case, delegated
  authority grants (gate × BU × ceiling × validity), named-reviewer checks, licence entitlements.
  Invariants: agents/services never decide or sign; admins never approve; package author and case owner
  never approve their own gate; task ownership never grants approval. The database refuses approvals that
  break these rules (human interactive session, current snapshot, hash, grant, not self).
- Alternatives considered: OPA/Cedar (more machinery than the rule set needs now); app-only checks (one
  bug becomes a bypass).
- Consequences: Exhaustive role × action tests; `guards.test.ts` covers the DB layer.

### D-017 — Pilot authentication: dev persona login behind `AUTH_MODE=dev`; OIDC later
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: The build and demos need to switch between the six Aster personas; SSO terms are undecided
  (PRD §13).
- Decision: `/auth/dev-personas` and `/auth/dev-login` exist only when `AUTH_MODE=dev`. Login creates an
  interactive `platform.session` with an httpOnly cookie (token hash stored). Production uses OIDC with the
  same session model.
- Alternatives considered: passwords for the pilot (more surface, no value in a synthetic workspace).
- Consequences: Dev routes are not registered in other modes (tested).

### D-018 — Analysis provider adapter: deterministic fixture by default, Claude by configuration
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: No model API key in the environment; CI and dev must be deterministic and offline.
- Decision: `AnalysisProvider` interface with a fixture provider (scripted turns from
  `skills/<skill>/fixtures`, default) and a Claude provider enabled by `ANALYSIS_PROVIDER=claude`,
  `ANTHROPIC_API_KEY` and `ANALYSIS_MODEL`. The model name is configuration, recorded per run, never in
  code or commits. Missing fixture or key is an error, never a silent fallback. Use zero data retention
  where available.
- Alternatives considered: agent frameworks with hidden state (conflicts with "agent memory is not a
  system of record"); live provider in CI (non-deterministic, needs secrets).
- Consequences: Evals smoke runs in CI; provider evals run manually or nightly.

### D-019 — One bounded agent with a read-only tool gateway; outputs are proposals
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: PRD §8: agents draft and assist; only validated commands from authorized identities commit.
- Decision: One agent, ten versioned skills, budgets and checkpoints. Tools are read-only or deterministic
  (`intelligence.search`, `evidence.get`, `portfolio.get_product`, `crm.get_authorized_accounts`,
  `sizing.calculate`, `economics.calculate`, `work.preview_tasks`). The PRD's `workflow.request_gate`,
  `work.create_approved_tasks` and `outcomes.record` are human commands, not agent tools. Output is
  validated, citations must come from this run, and results are stored as proposals that humans accept,
  edit or reject.
- Alternatives considered: specialist sub-agents (PRD: only when evals show improvement); agent with
  write tools behind approvals (larger blast radius).
- Consequences: Prompt injection cannot cause an action; the product works with AI disabled.

### D-020 — Task connector interface with a database-backed simulator and fault injection
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: Jira is not reachable; ME-13 and the release gate need proof of no duplicates under faults.
- Decision: `TaskConnector` (`health`, `preview`, `createTask` idempotent by key, `findByIdempotencyKey`)
  with typed errors. The simulator stores issues in `sim.external_issue` (unique per idempotency key),
  allocates Jira-like keys and supports fault rules: timeout-after-success, 5xx, permission failure,
  expired token, rate limit. A real Jira adapter implements the same interface later.
- Alternatives considered: in-memory mock (cannot survive worker restarts, so cannot test
  timeout-after-success with crash); recorded HTTP fixtures (no state).
- Consequences: The fault-injection suite runs in CI against Postgres.

### D-021 — Transactional outbox, stable idempotency keys, reconcile before retry, authz re-check at send
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: Sister-plan pattern R5/R6; ME-13; PRD §8 "ambiguous external-write timeouts enter
  reconciliation before retry".
- Decision: Send writes one `outbox_message` and one `external_task_link` per task in the business
  transaction. Key = `sha256(tenant | plan version | task | connection | project)`. The worker re-checks
  approval effectiveness and expiry, plan version, actor authority and connection status before each
  send. Timeout → `checking` → find by key → confirmed or retry with backoff (max 5) → failed. Permission
  failures fail the task only; token expiry pauses the connection. Retry re-sends only failed tasks with
  the same keys.
- Alternatives considered: direct API call in the request (no recovery); retry without reconcile
  (duplicates).
- Consequences: "Confirmed" always has an external key; partial success is visible per task.

### D-022 — Evidence licensing and visibility rules
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: ME-02, ME-16, S13: restricted sources must not leak through excerpts, searches, summaries or
  counts.
- Decision: Entitlements per licence and principal (`excerpt`, `aggregate_only`, `none`) are checked on
  every read: excerpts, search, exports and model context. Only permitted excerpts are stored in the
  database; originals sit in object storage. Restricted content shows no excerpt, summary or paraphrase.
  Aggregates are computed over visible rows only; hidden cases and sources are never counted. Resources
  the caller cannot see return 404.
- Alternatives considered: redact at render time (leaks through APIs and caches).
- Consequences: Entitlement tests are a release gate; the agent sees only what the requesting human may see.

### D-023 — Append-only audit; analytics with closed property whitelists in the same transaction
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: ME-17 and PRD §17 (events must not contain restricted text, account details or confidential
  financial inputs).
- Decision: `audit_event` insert-only by trigger and privilege, written in the state-changing transaction.
  Exactly the 20 PRD §17 analytics events, each with a strict Zod props schema, written to
  `analytics_event` in the same transaction and flushed by the worker.
- Alternatives considered: log-based audit (not transactional); free-form analytics payloads (leak risk).
- Consequences: Adding an analytics property is a contract change.

### D-024 — Sizing conventions
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: PRD §6 sizing rules: one market unit, unique sites, explicit overlap, no adding totals,
  top-down cross-checks not averaged, capacity-constrained SOM.
- Decision: The boundary declares unit, population unit, geography, segment, currency, price year,
  inclusions and annualization method. `aggregate_overlap` supports exactly two active cohorts with a
  declared overlap; more cohorts require `site_list_union` (dedup by site ID; parent company does not
  merge sites). SOM customers = min(floor(reachable × adoption), capacity), per scenario. Blocking
  checks: currency, price year, unit, negative overlap, overlap above the smaller cohort, SAM > TAM,
  reachable > SAM, rate range, duplicate cohort, missing annualization. The top-down cross-check returns
  within/outside range only.
- Alternatives considered: inclusion–exclusion over n cohorts from aggregates (needs all intersections;
  error-prone); rounding customers to nearest (overstates).
- Consequences: The Aster numbers reproduce exactly; ambiguous cohort sets must supply site lists.

### D-025 — Aster fixture rules
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: The fixture seeds dev, drives golden tests and the e2e journey; every PRD §6 number must be
  exact and nothing synthetic may read as real.
- Decision: All PRD §6 values are exact (TAM €100m/year, SAM €40m/year, 500 reachable sites, SOM €2m,
  economics €1.0m/€2.0m/€2.4m, €0.60m/€1.20m/€1.44m, €0/€600k/€840k, €400k one-time, €15k validation,
  €120k · 90 days pilot, 20 sites, ≥ 8 interviews, ≥ 4 commitments, results 9 and 4, pilot 3 of 4).
  Placeholders stay placeholders (`€[cap]`, `[duration]`, `[hours per site]`, `€[limit]`). Authority
  ceilings are placeholder policy values. One value is a fixture choice: upside adoption 30% (any value
  ≥ 24% reaches the 120 cap; 30% makes "unconstrained would be higher" true). Prototype fingerprints are
  illustrative.
- Alternatives considered: model upside as "customers = capacity" without adoption (breaks the uniform
  formula).
- Consequences: The fixture is the acceptance oracle; changing it needs a change request.

### D-026 — Polling for async status; no websockets in MVP
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: Analysis runs and task sync are asynchronous; pilot scale is small.
- Decision: TanStack Query polling (2 s while active, stop at terminal states). SSE may be added later
  without contract changes.
- Alternatives considered: websockets/SSE now (more infrastructure for little benefit at pilot scale).
- Consequences: Simple, testable; slight latency on status updates.

### D-027 — React SPA on Vite with TanStack Query; `/me/` routes and shared root routes
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: Dense, accessible enterprise workspaces; the API is a separate service; research §8 defines
  deep links and the Growth OS app switcher.
- Decision: React 18 SPA (Vite, React Router, TanStack Query/Table, Radix, lucide-react). App routes
  under `/me/…`; shared Growth OS routes (`/evidence`, `/reviews`, `/my-work`, `/admin`) at the root.
  Deep-link parameters are frozen in `apps/web/src/app/routes.ts`. Tokens ported one to one from the
  prototype into `packages/ui/tokens.css` (light and dark).
- Alternatives considered: Next.js (no SSR need, duplicates the API layer); heavy UI kits (fight the
  approved design).
- Consequences: MSW mocks let screen streams start before the API.

### D-028 — Error model and request headers
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: Clients need stable, actionable errors; decisions and external writes must not double-submit;
  drafts autosave concurrently.
- Decision: RFC 9457 problem details with a stable `code` enum, `blockers` and `checks`. 404 for hidden
  resources. `Idempotency-Key` required on creates, submissions, decisions, sends and retries (24 h,
  request-hash checked). `If-Match` row versions on draft writes (412 on conflict). `X-Correlation-Id`
  everywhere.
- Alternatives considered: ad-hoc error bodies; last-write-wins drafts.
- Consequences: Uniform UI error handling (`ProblemBanner`).

### D-029 — Testing strategy: release gates are named suites
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: PRD §10 release gates must be checkable.
- Decision: Vitest (unit; db against local Postgres), Playwright + axe (e2e, a11y), eval runner (fixture
  provider in CI). Each PRD §10 gate maps to a named suite (ARCHITECTURE.md §16). Golden tests in
  `packages/domain/src/me/golden.test.ts` are the acceptance criteria for the engines.
- Alternatives considered: testcontainers (Docker CLI exists but a local cluster is simpler here).
- Consequences: `pnpm test` stays DB-free; `pnpm test:db` needs `db:up` and `db:migrate`.

### D-030 — Cash flow and payback are unavailable in the MVP
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: PRD §6: operating cash flow and cumulative payback must remain unavailable until inputs support
  an explicit reproducible formula.
- Decision: The economics engine always returns `Unavailable` for cash flow and payback with the missing
  inputs listed (acquisition ramp, retention, cash timing, partner margin, FX and base-year policy). The
  input contract already has slots for them.
- Alternatives considered: a simple payback = investment ÷ contribution (sums one-time and recurring
  logic implicitly; PRD forbids).
- Consequences: A later stage adds a cash-flow engine by change request.

### D-031 — Architecture freeze
- Date: 2026-10-09 · Stage: Architecture · Status: Frozen
- Context: Several engineers and sub-agents will build in parallel; contracts must not move under them.
- Decision: The following are **frozen**:
  1. `packages/contracts/**` — all Zod schemas, enums and label maps, engine IO, the 143-endpoint registry
     (ids, methods, paths, schemas, auth, idempotency and If-Match flags), error codes, analytics events
     and domain events.
  2. `packages/db/migrations/0001_init.sql` — schemas, tables, columns, constraints, RLS, roles, grants,
     guard triggers, security-definer functions.
  3. Transition tables and guard names in `packages/domain/src/platform/workflow/machines.ts` and
     `packages/domain/src/me/lifecycle/machines.ts`; the policy table `ROLE_ACTIONS` and invariants;
     gate definitions `ME_GATES`; the canonical hashing algorithm.
  4. Interfaces: `StateMachine`, `PolicyEngine`, `MaterialityEvaluator`, `AuditWriter`, `SizingEngine`,
     `EconomicsEngine`, `RankingEngine`, `PreconditionEvaluator`, `AnalysisProvider`, `ToolGateway`,
     `AnalysisHarness`, `TaskConnector`, `externalTaskIdempotencyKey`, UI component prop contracts.
  5. `fixtures/aster/**` numbers and golden expectations; `packages/ui/src/format` rules; `tokens.css`
     values; the route table in `apps/web/src/app/routes.ts`; the job catalogue in
     `apps/worker/src/jobs/catalog.ts`.
  6. Decisions D-001 to D-030.
  Not frozen: implementations behind the interfaces, new migrations that only add indexes, internal
  helpers, UI composition inside a screen, skill instructions and eval cases.
- **Change request (CR) process after the freeze:**
  1. Open a CR as a new entry in this file under the current stage: `CR-nnn — title`, with the problem,
     the proposed change, affected contracts/tables/screens, compatibility impact and test impact.
  2. The Principal Architect (or delegate) reviews within one working day; the owners of affected streams
     must agree.
  3. If accepted: append a new decision `D-xxx` that supersedes the relevant entry; change contracts and
     add a **new** migration (never edit `0001_init.sql`); regenerate DB types and the DATA_MODEL
     appendix; update API/FRONTEND docs and `artifacts.md`; land it in one PR that keeps
     `lint`, `typecheck`, `test` and `test:db` green.
  4. Additive changes (new optional field, new endpoint, new index) use the same process but can be
     fast-tracked. Breaking changes (rename, remove, semantic change) need a migration path for every
     consumer in the same PR.
  5. Never-rules in `/CLAUDE.md` cannot be relaxed by a CR without product and security sign-off.
- Alternatives considered: no freeze (contract churn across 11 streams); freeze everything including
  implementations (blocks the build).
- Consequences: Streams can work in parallel with confidence; changes are visible and deliberate.

---

## Stage: Build — Wave 1 integration (2026-10-09)

Wave 1 merged WS2 (domain engines), WS3 (workflow and authorization), WS1 (platform, DB, identity) and
WS7 (frontend shell and design system) into `claude/zen-euler-ph3oag`. Stream notes are in
`docs/market-expansion/build/notes/WS{1,2,3,7}.md`. The entries below consolidate those notes, the Principal
Engineer's (PE) seam wiring and the change-request (CR) decisions. CRs follow D-031: additive changes are
fast-tracked by the PE and recorded here; nothing breaking was accepted.

### D-032 — Wave 1 integration order and build-stage change control
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: Four streams built in parallel worktrees from `4eebc3c`. They overlapped in shared registry files
  (`vitest.config.ts`, `apps/worker/src/main.ts`, `apps/api/src/modules/index.ts`, `pnpm-lock.yaml`) and left
  seams for each other (timers, materiality, seed engines).
- Decision: Merge with `--no-ff` in dependency order WS2 → WS3 → WS1 → WS7, never rewriting history.
  Conflicts are resolved by keeping both sides' lines; the lockfile is always regenerated with
  `pnpm install`, never hand-edited. The PE wires the seams in separate commits after the merges and
  decides CRs: additive contract or DB changes are accepted in the same integration (new optional fields,
  new endpoints, new transition rows, index-only migrations); anything breaking is deferred to the
  Principal Architect. Each decision is recorded below; each CR is listed in the register at the end.
- Alternatives considered: rebasing the stream branches (rewrites shared history); one squash commit per
  stream (loses the streams' logical commits).
- Consequences: Two conflicts in Wave 1 (`vitest.config.ts` db include glob; `pnpm-lock.yaml`). The
  integrated head passes install, typecheck, lint, format, unit, migrate, db, web build and the API smoke.

### D-033 — Uncomputable SAM is flagged, never a displayable zero (CR-WS2-1)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: The frozen `SizingOutput.ladder.sam` has required numeric fields. When SAM cannot be computed
  (wrong cohort count, missing overlap or site IDs) the engine had to write `0` there, which conflicts
  with never-rule 5 ("Missing is never zero"). WS2 proposed making `ladder.sam` nullable.
- Decision: Accept the additive form: `ladder.sam.available?: boolean` (absent = computed). The sizing
  engine always sets it; `false` means the numbers beside it are placeholders. Consumers render
  "Not available — <blocking check>" when `available === false`, and never render or commit ladder
  values while `blocked` is true (WS2-3). Nullable `sam` is rejected as breaking.
- Alternatives considered: nullable `sam` (breaks every consumer and stored output); the `blocked` flag
  alone (correct but implicit).
- Consequences: Contract stays backward compatible; golden and property tests assert the flag; the seed's
  golden check requires `available` true.

### D-034 — The investment committee may stop a case (CR-WS3-1)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: ARCHITECTURE.md §7.3 gives the investment committee "Outcome decision, stop case" and PRD §4
  lists "stop" as a G3 outcome for "investment committee / sponsor", but the frozen `ROLE_ACTIONS` lacked
  `case.stop` for `investment_committee`. The code disagreed with its own specification.
- Decision: Add `case.stop` to `ROLE_ACTIONS.investment_committee` (amends the frozen table, D-031 §3;
  D-016 stays in force). Scope rules are unchanged (the committee must be in scope for the case).
- Alternatives considered: correct the document instead (contradicts the PRD's G3 outcomes).
- Consequences: The role × action test matrix expects sponsor and investment committee for `case.stop`.

### D-035 — An expired G2 approval returns the case to Pilot approval pending (CR-WS3-3)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: Gate requests that expire are terminal. The frozen case table had no transition for an expired
  G2, so the case stayed `pilot_approved` with activation blocked by `APPROVAL_EXPIRED`, and a new G2 could
  never move it (`g2_submitted` starts from Validation): a dead end.
- Decision: Add the system transition `g2_expired: pilot_approved → pilot_approval_pending` (same target as
  `g2_invalidated`), map `followOnForGate('G2', 'expire')` to it, and apply it in `timers.approval_expiry`
  with a `case.stage_changed` audit event. Expiry is never applied to an executed approval, so
  `pilot_running` is not a source state. G1 expiry moves no stage (the case stays in Validation and a new
  G1 decision can be recorded there). WS4 rule: when a gate follow-on targets the stage the case is
  already in (a new G2 submitted while Pilot approval pending), skip the case move.
- Alternatives considered: `pilot_approved → validation` (consistent with "returned", but inconsistent
  with invalidation, which keeps the case in the approval stage); leave as is (dead end).
- Consequences: Planner unit test and timer DB test cover the move; the rail shows G2 Expired and the next
  action is a new G2 request.

### D-036 — Standalone G0 snapshots name the mandate as their subject (CR-WS1-2)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: `SnapshotContent.caseId/caseKey` are required, but a G0 on a mandate has no case.
- Decision: Add optional `SnapshotContent.subject: { type: 'case' | 'mandate', id, key }`. For a mandate
  subject, `caseId`/`caseKey` carry the mandate id and key for compatibility (documented in the schema).
  The seed sets `subject` on MD-21's G0 snapshots. Absent means the subject is the case.
- Alternatives considered: nullable `caseId` (breaking, and it changes the hashed shape of every snapshot).
- Consequences: Hashing is unchanged for existing content; WS4 sets `subject` on every new snapshot.

### D-037 — `cases.members` endpoint for owner pickers (WS7 request)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: `OwnerPickerProps` has no source of candidates; conditions, tasks and reviews need people who
  can work on the case. The data exists (`platform.case_participant`, case- and BU-scoped
  `role_assignment`).
- Decision: Add `GET /me/cases/:caseRef/members` (`cases.members`) returning `{ items: CaseMember[] }`,
  `CaseMember = PersonRef + roles[] + participantRoles[]`: human principals whose roles reach the case and
  case participants; no agents or services; tenant admins only if they also hold a case role. 404 when the
  case is hidden. The registry now has 144 endpoints. WS4a implements it.
- Alternatives considered: derive candidates from the gate package (what the connected panel does today;
  incomplete for pilot tasks); reuse `admin.roles` (admin-only).
- Consequences: The connected `ApprovalPanel` and S11 owner pickers switch to it when WS4a lands.

### D-038 — Migration 0003: indexes for the integrated seams
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: Materiality and the expiry timer look up outbox rows by `authorization_ref->>'gateRequestId'`;
  the expiry sweep scans approved gates by `expires_at`; `findPins` reads approvals by snapshot; members
  read participants by user.
- Decision: `0003_pe_wave1_indexes.sql` adds four indexes and nothing else (index-only migrations are
  outside the freeze, D-031).
- Consequences: No type regeneration needed; `db:migrate` applies it.

### D-039 — G3 "blocked" lists every unmet precondition (interim, PE)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: BUILD_PLAN §8 step 28 and `fixtures/aster gates.g3.blockedBy` show two blockers, but G3 also
  requires `updated_economics_and_capacity` and `approved_scale_budget`. With honest step-28 facts (no
  scale budget requested, economics not refreshed with actuals) four are unmet. Hiding two would tell the
  user they are closer to scale than they are.
- Decision: Interim until product decides (PQ-1): the evaluator and the API list every unmet precondition;
  the summary reads "G3 preconditions unmet: demand threshold 3 of 4 (4 of 4 required); specialist
  scale-readiness review incomplete; economics and capacity not updated after the pilot; no scale budget
  stated". The acceptance script step 28 is updated to this text and to four `blockers`. The frozen
  fixture keeps its two `blockedBy` entries (they remain the first two blockers, in order). Blocker copy
  follows the fixture's "<what> · <state>" pattern.
- Alternatives considered: treat the two extra facts as met in the seed (dishonest data); drop them from
  G3 (changes PRD §4 gate preconditions).
- Consequences: e2e step 28 asserts four blockers; if product chooses the two-blocker narrative, the seed
  adds a scale budget and refreshed economics instead and the script reverts.

### D-040 — Extension cap stays a placeholder; X1 can be requested but not approved (interim)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: The PRD gives no extension cap or duration (`€[cap]`, `[duration] days`), yet step 27 needs X1
  "Awaiting decision" and the X gate requires `extension_cap_set`.
- Decision: `XFacts.capPlaceholder: true` satisfies `extension_cap_set` for submission only. A spend gate
  with no amount is never approvable (D-045), so X1 cannot be approved until a real cap is set. The UI
  shows "€[cap]" verbatim and the approve button carries the policy reason. Open as PQ-2.
- Consequences: The journey reaches step 27 honestly; nobody can approve unbounded spend.

### D-041 — Upside adoption stays at the fixture's 30% (interim)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: D-025 chose 30% upside adoption (not in the PRD); any value ≥ 24% reaches the 120-customer
  capacity cap, so every displayed PRD figure is the same for any such value.
- Decision: Keep 30% until product confirms (PQ-3). It stays an assumption in the fixture (never
  evidence), and the upside row explains "Capped at 120 customers by capacity".
- Consequences: No engine or golden change if product picks any value ≥ 24%; a lower value changes the
  upside row and needs a fixture CR.

### D-042 — Command pipeline is the only write path
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: CLAUDE.md requires validate → policy → domain → state + audit + analytics + outbox in one
  transaction; four API-side streams build on it.
- Decision (WS1): handlers are built with `command()`/`query()` (`apps/api/src/platform/pipeline.ts`):
  session → Zod validation (400 with `errors[].path`) → interactive-human check for `auth: 'human'` →
  `If-Match` (428/412) and `Idempotency-Key` (428) → `withTenant()` → `load` → `authorize` → `handle` →
  a command that wrote no audit event is refused (500, rolled back) → response parsed by the endpoint
  schema (unknown fields stripped; a contract violation is a 500). `tools` give `tx`, `audit`,
  `analytics` (strict PRD §17 props), `enqueue` (graphile `add_job` in the transaction) and `emit`.
  Audit stores hashes of before/after and refuses content-like keys; hidden resources deny with
  `NOT_FOUND`. `systemTools()` gives the same writers to timers and seams. The audit writer lives in
  `packages/db` so API, worker and seed write identical rows.
- Consequences: WS4/5/6 never write outside `command()`; the pipeline tests cover each step.

### D-043 — Sessions, dev login and the 0002 RLS fix
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: Sessions are tenant-isolated but the tenant is unknown before the cookie resolves; every table
  has `FORCE ROW LEVEL SECURITY`, which also binds the owner, so the frozen `SECURITY DEFINER` functions
  (`list_tenant_ids`, `claim_outbox_batch`) saw no rows (a bug in 0001).
- Decision (WS1): migration `0002_ws1_platform_runtime.sql` adds owner-only policies (`TO me_owner`) on
  tenant, app_user, session and outbox_message so definer functions work while `me_app`/`me_worker` stay
  isolated; `platform.resolve_session(token_hash)` returns ids for live sessions only. The cookie
  (`gos_session`, httpOnly, SameSite=Lax, Secure) holds 32 random bytes; only SHA-256 is stored. Dev login
  answers only for `tenant.illustrative = true` and only in `AUTH_MODE=dev`; agents/services are refused;
  re-login revokes the previous session; login and logout are audited.
- Alternatives considered: a BYPASSRLS role (cannot be created locally; broader); tenant id in the cookie.
- Consequences: Timers and the outbox sweep work across tenants through ids only; a misconfigured
  production `AUTH_MODE=dev` still cannot enter a real tenant.

### D-044 — Idempotency semantics and per-intent key reuse
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: D-028 requires `Idempotency-Key` on creates, submissions, decisions, sends and retries; both
  server and client need a precise rule.
- Decision: Server (WS1): `begin` commits an `in_progress` row in its own short transaction per (tenant,
  user, key); the response is stored inside the business transaction; any failure releases the key
  (errors are not cached, so the same intent can be retried after fixing the cause); an `in_progress` row
  older than 2 minutes can be taken over; the request hash covers operation, params, query, body and file
  hashes; a different body with the same key is 422 `IDEMPOTENCY_KEY_REUSED`; a replay returns the stored
  response with `Idempotent-Replayed: true`. Client (WS7): one key per intent, keyed by the body
  fingerprint; transient failures (network, 5xx, `IDEMPOTENCY_IN_PROGRESS`, 429) retry with the same key;
  4xx never retry; a new key after success or a body change. Never-rule 9's connector key
  (`externalTaskIdempotencyKey`) is separate and unaffected.
- Alternatives considered: caching 4xx responses (forces a new key after every validation fix).
- Consequences: Double clicks and retries never double-decide; expired records are reused safely (a purge
  job is still to do).

### D-045 — Policy engine order, authority and invariants
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: D-016 fixes roles, scope, grants and invariants; the order of checks decides which error a user
  sees, and the domain cannot read the clock.
- Decision (WS3): `gate.decide` checks visibility (hidden → `NOT_FOUND`, never 403) → admin (any
  `tenant_admin` role blocks, even with a sponsor role and a grant) → self (package author, then case owner →
  `SELF_APPROVAL_PROHIBITED`) → conflict → deciding role → authority (gate × BU × amount ≤ ceiling × currency
  × `PolicySubject.asOf` within validity). Without `asOf` authority fails closed. A spend gate (G1/G2/G3/X)
  with no amount is never approvable; G0 needs a null-ceiling grant. Agents may only read case, source
  metadata and licensed excerpts in run scope; service principals nothing; non-interactive humans reads
  only. Specialist sign-off coverage is structural (`coversGates`, `maxSites`, `maxDays`): Lena's
  pilot-only sign-off covers G2, never G3. `approvalPanel()` lists exactly the dispositions allowed.
- Consequences: Maya forcing a G2 decision gets `SELF_APPROVAL_PROHIBITED` (step 18); 410 role × action
  cells are tested. WS1's `roleAllows()` helper uses the same table for non-gate actions.

### D-046 — State machine runtime contract
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: The frozen `StateMachine` stub returned too little for the API to explain refusals.
- Decision (WS3): `apply()` returns `{ ok, from, to, changed, events, auditAction, domainEvent, nextAction,
  guards }` or `{ ok: false, code, failed[], reasons[], nextAction }`; every failed guard is listed in table
  order and the first decides the code (stale beats hash mismatch beats self-approval, matching API.md
  §6.1). `evaluate()` lists every command with `enabled` and reasons for disabled buttons. Agents never
  apply anything; `human` rows need an interactive human; `system` rows only take a system actor; unknown or
  throwing guards fail closed. The result and `GuardResult.code` were extended additively in
  `packages/domain`; the frozen transition tables and guard names are unchanged except D-035.
  `followOnForGate()` names the case/mandate transitions a gate command triggers (X never moves the case).
- Consequences: WS4 maps `code` to problem+json and `failed` to `blockers`.

### D-047 — Materiality behaviour and the applied seam
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: D-013 defines material/uncertain/not-material; WS1 built `applyMateriality` against a stub and
  WS3 built the evaluator; marking a pinned source stale returned 500.
- Decision: The evaluator (WS3) classifies by the tenant policy (unlisted → uncertain; a non-critical
  assumption under a material rule → uncertain; undefined `decisionCritical` treated as critical; drafts do
  nothing). Material: current snapshots of gates awaiting decision go stale (`mark_stale`), effective
  approvals are invalidated (`invalidate`, pause unsent writes). Uncertain: snapshots stale, escalated to
  the policy owner, approvals untouched until `resolveEscalation('material')`; resolving as not material
  leaves stale snapshots stale (refresh needed). `MaterialityOutcome` gained `reasonShort`, `impacts`,
  `gateCommands`, `escalatedApprovalIds`, `escalateTo`, `pauseUnsentWrites`, and the interface gained
  `resolveEscalation` (additive). The PE wired `applyMateriality` to it: impacts as returned, gate and
  snapshot status through the machines with a system actor, pauses only when the outcome says so, the
  G1/G2 invalidation follow-on moves the case when the case machine allows, stale reasons carry the
  tenant-local date ("source SRC-014 changed on 26 Nov", Europe/Berlin until a tenant time-zone setting
  exists).
- Consequences: `evidence.markStale` and `evidence.replace` on a pinned source succeed (DB tests); the
  Aster default classifies source changes as uncertain, so G2 v3 goes stale and G1 stays approved.

### D-048 — Precondition evaluator and snapshot builder
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS3): `evaluateGate()` returns contract `Precondition[]`, problem `blockers`, counts and a
  one-line summary; unknown or wrong-gate keys fail closed; task completion is never an input; only targets
  with a numeric threshold gate G3 (placeholders such as `[hours per site]` and qualitative targets cannot);
  missing observations are unmet ("no data recorded"), never zero. `createSnapshot()` refuses drafts
  (`PRECONDITIONS_UNMET`), validates content and money, de-duplicates and sorts components, deep-freezes
  the result and hashes with the frozen canonical algorithm; `diffSnapshotContent()` backs "See what
  changed". A decision on an older snapshot id is `SNAPSHOT_STALE` even if that row still says current.
- Consequences: WS4 inserts `decision_snapshot` from the builder's canonical bytes and hash only.

### D-049 — Timer jobs and worker task registration
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: graphile-worker's crontab text grammar rejects the frozen dotted task names; WS3's timers needed
  registration in a file WS1 owned.
- Decision: The worker builds its task list in `apps/worker/src/tasks.ts` (`createTaskList`) and converts
  `CRONTAB` lines into structured cron items for registered tasks only (`schedule.ts`), so a job runs exactly
  when its handler exists. Timers (WS3): approval expiry every 15 min skips executed approvals ("executed" =
  G0/G3 always; pilot activated; locked experiment started; or an outbox row authorized by the gate that is
  sending/checking/confirmed/sent), writes `approval_invalidation(kind='expired')`, pauses pending outbox
  rows and their task links, audits `gate.approval_expired`, and applies D-035. Pilot window hourly moves
  `pilot_running → review_due` after the tenant-local window end (Europe/Berlin default); overdue
  experiments are counted, never changed. One transaction per tenant; a failing tenant does not block the
  others but fails the job for retry. `db:migrate` installs the graphile schema and grants; the API enqueues
  inside the business transaction.
- Consequences: WS5 and WS6 add their task maps to `createTaskList` (one line each).

### D-050 — Analytics flush and domain events (domain-event table deferred)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: The machines return `domainEvent` types but 0001 has no domain-event table (CR-WS3-4); analytics
  need delivery without leaking content.
- Decision: `platform.analytics_event` is itself the analytics outbox (`emitted_at` NULL until the
  `analytics.flush` job delivers and stamps it; only the worker may update). Domain events are validated by
  `DomainEvent` and collected per transaction (`auditWriter.emitted(tx)`), not stored; the audit event (its
  `action` carries the type) is the persisted record. A domain-event table is deferred until a consumer needs
  replay or subscriptions; outbox rows cover delivery to external systems.
- Consequences: No double-write; WS6's dispatcher never routes analytics.

### D-051 — Evidence entitlements, visibility, uploads and freshness
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS1): licence access resolves user rows › role rows › case member › `*` › none (fail closed),
  most permissive within a level; a restricted source reduces excerpt to aggregate-only, a deleted one to
  none; only `excerpt` returns passages and the quoted-fact panel. A source used only by cases the viewer
  cannot read is 404 and never listed, counted or searched; admins read no evidence. Uploads are
  `multipart/form-data` (`metadata` JSON part + one file); identical bytes return the existing source; the
  original goes to the content-addressed object store and ingestion is queued in the same transaction.
  Ingestion strips scripts, styles, comments, hidden elements and control/bidi characters, keeps at most 3
  passages cut to the licence's sentence limit, stores binaries without passages (`partial`) and never
  fabricates. Freshness ageing after 365 days (licensed), 30 (uploads, web), 90 (internal); the daily job
  only moves Current → Ageing (Stale and Superseded are human acts because they run materiality). Access
  requests are audit events (CR deferred, see register). The web client gains a multipart path for
  `evidence.upload` (CR-WS1-1 accepted, no contract change; WS8d with a one-function edit to the WS7 client).
- Consequences: Entitlement suites are release gates; thresholds become a tenant policy only by CR.

### D-052 — Administration invariants
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS1): admins cannot change their own roles or grants; `tenant_admin` cannot be combined with
  sponsor or investment committee; no authority grant to a tenant admin; only human principals hold roles
  or authority; publishing a policy retires the previous active version (kept); a gate policy cannot allow
  self-approval. Authority gaps are computed per BU × gate from grants effective today. Connection health is
  readable by case roles (S03, S11).
- Consequences: S14 "Authority gap" and "Admin cannot approve" are data-driven.

### D-053 — Seed runner runs the real engines and guards
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: WS1 seeded engine outputs from golden values (`+aster-golden`) until WS2 landed.
- Decision: The seed runs in one tenant transaction with RLS and all guard triggers on; seeded approvals go
  through the real approval guard with a short-lived approver session; history is `actor_kind 'system'`
  audit dated at the fixture moments; `isolated: true` remaps ids for independent test tenants; display-key
  counters make OPP-07's conversion yield ME-104. `aster-demo` now runs the WS2 sizing and economics
  engines and aborts if any golden value differs (`sizingGoldenMismatches`, `economicsGoldenMismatches`);
  the stand-in path is removed. Supersedes WS1 note decision 17.
- Consequences: Seeded calculation rows carry engine version `1.0.0`, full lineage and `sam.available`.

### D-054 — Typed money and decimal context in the engines
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS2): branded `PerYearAmount` and `OneTimeAmount` (`sizing/numeric.ts`); arithmetic exists only
  for per-year amounts and throws on currency or price-year mismatch; one-time amounts have no arithmetic; a
  `@ts-expect-error` test proves mixing does not compile. decimal.js is cloned with 50 significant digits and
  ROUND_HALF_EVEN; amounts serialize with 2–8 fraction digits; zero is `"0.00"`, never `-0.00`; ranking
  scores have 2 decimals. Engines never round for display; `formulaWithValues` shows exact grouped values.
- Consequences: WS4/WS5 build money through these helpers and never do arithmetic on `Money.amount`.

### D-055 — Sizing engine semantics: blocked output and duplicate cohorts
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS2): when blocked, the engine still returns TAM and SAM from the raw inputs (so "SAM 2,000 >
  TAM 500" can be shown), SOM `[]` and cross-check `not_available`; when SAM cannot be computed, D-033
  applies. A cohort is a duplicate when marked `duplicate_candidate`, when two active cohorts share rule and
  source ref, or when both carry site IDs with Jaccard similarity ≥ 0.9 (a subset cohort is not flagged).
  New blocking checks: `TOO_MANY_COHORTS_FOR_AGGREGATE_METHOD`, `MISSING_INPUT` (overlap pair or site IDs),
  `ANNUALIZATION_METHOD_MISSING`, `REACHABLE_EXCEEDS_SAM`, cross-check currency/price-year mismatch;
  non-blocking `CAPACITY_CAP_APPLIED` and `CROSS_CHECK_OUTSIDE_RANGE`.

### D-056 — Lineage graph and "Used by" (CR-WS2-2 rejected)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS2): input nodes share `input.<inputKey>` so sizing and economics lineage merge into one graph;
  SAM has a sites node and a money node; the reachable pool takes SAM sites as input (SAM bounds it), so
  "Used by" from SAM leads to SOM and economics through the reachable pool, never by a false direct edge.
  `lineageView`, `usedByTransitive` and `dependsOnAssumptionCount` back the drawer. CR-WS2-2 (a stored
  `LineageNode.usedBy`) is rejected: `lineage.get` already returns `usedBy`, and storing a derived reverse
  edge in every node would duplicate data that can drift.
- Consequences: BUILD_PLAN step 8 "used by SOM, economics" holds through the reachable pool.

### D-057 — Ranking semantics
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS2): score = Σ(rating × weight) ÷ 100 on the 1–3 scale, explained as
  `3 × 40% + 3 × 30% + 2 × 30% = 2.70 of 3`; any non-excluded incomparable row blocks the whole set ("Not
  ranked — boundary conflict in set", matching the S04 "Aggregate ranking blocked" banner); excluded rows read
  "Excluded until normalized"; unknown inputs give "Not ranked — n input(s) missing (names)", never 0;
  weights must be whole numbers summing to 100; ranked rows by score with ties in input order, then unranked
  rows in input order. No market-size criterion while candidates are not sized on a common boundary.

### D-058 — Economics blocking scope
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS2): scenarios are suppressed and break-even is null only when a blocking check names a
  recurring input. A missing or invalid one-time investment blocks the run ("Recommendation incomplete") and
  makes `oneTimeInvestment` Unavailable, but per-year scenarios are still returned. Cash flow and payback are
  always Unavailable (D-030) with the missing inputs listed by their S08 labels.

### D-059 — Frontend composition: presentational UI, connected app components
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS7): `packages/ui` exports pure view components (`ApprovalPanelView`, `LineageDrawerView`, …)
  with glyph + text for every status; `apps/web/src/app` implements the frozen id-based props
  (`ApprovalPanel`, `LineageDrawer`, `CaseHeader`) on top of them; links are injected through
  `UiLinkContext`. The connected approval panel sends the snapshot id and hash the page rendered, never the
  latest fetched, and disables approval when they differ (never-rule 2). Query invalidation is a generated
  map (`INVALIDATES`) tested to cover every command; no optimistic updates for decisions, sends, activation
  or submissions. A unit test forbids raw hex outside tokens; Expired shares the Invalidated gate glyph;
  the design-system page is lazy-loaded.
- Consequences: Screens import connected components; `packages/ui` stays reusable by another Growth OS app.

### D-060 — MSW mocks mirror the API edges at the aster-demo moment
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS7): `dev:mock` serves MSW handlers that validate every response against the contract, enforce
  session (401), `Idempotency-Key`/`If-Match` (428), body validation (400), replay and key reuse, and gate
  decision rules (self-approval, admin, authority, hash, stale). Unmocked endpoints answer the skeleton's
  `500 INTERNAL`. Screen streams add `screens/<screen>/mocks.ts`, auto-collected by `import.meta.glob`, built
  from `@growth-os/fixtures-aster` only. Playwright + axe harness lives in `apps/web/e2e/support`.
- Consequences: WS8 switches endpoint by endpoint to the real API with the same client.

### Change-request register — Wave 1

| CR | From | Request | Decision | Record |
|---|---|---|---|---|
| CR-WS2-1 | WS2 | Nullable or flagged SAM | **Accepted** (additive `sam.available`) | D-033 |
| CR-WS2-2 | WS2 | `LineageNode.usedBy` | **Rejected** — API already returns `usedBy`; derived data would drift | D-056 |
| CR-WS3-1 | WS3 | Investment committee `case.stop` | **Accepted** | D-034 |
| CR-WS3-2 | WS3 | G3 message: 2 vs 4 blockers | **Interim (PE)**: list all unmet; product to confirm | D-039, PQ-1 |
| CR-WS3-3 | WS3 | Case transition on G2 expiry | **Accepted** (`g2_expired`) | D-035 |
| CR-WS3-4 | WS3 | Domain-event table | **Deferred** — audit is the record, outbox delivers; revisit for replay/subscribers | D-050 |
| CR-WS1-1 | WS1 | Web client multipart upload | **Accepted** (no contract change; WS8d) | D-051 |
| CR-WS1-2 | WS1 | G0 snapshot without a case | **Accepted** (additive `subject`) | D-036 |
| CR-WS1-3 | WS1 | MD-21 v1 incomplete vs DB completeness | **Rejected** (DB rule stays: committed versions are complete); seeded v1 = v2 values minus the outreach exclusion; narrative wording to product | PQ-4 |
| CR-WS1-4 | WS1 | Sizing/economics v1 in the fixture | **Deferred** — History shows v2 only; SRC-011 "Sizing v1 only" impact has no row until a fixture CR | PQ-5 |
| CR-WS1-5 | WS1 | `platform.access_request` table | **Deferred** — no endpoint lists requests; audit events suffice until a licence-owner inbox is specified | D-051 |
| CR-WS1-6 | WS1 | Freshness thresholds as tenant policy | **Deferred** — fixed thresholds until a customer needs different ones | D-051 |
| CR-WS7-1 | WS7 | Case members endpoint | **Accepted** (`cases.members`) | D-037 |

### Open product questions

- **PQ-1 — G3 acceptance message.** Should step 28 show only the demand and scale-readiness blockers (then
  the seed needs a requested scale budget and economics refreshed with actuals) or all four unmet
  preconditions? Interim: all four (D-039). Owner: PM.
- **PQ-2 — Extension cap and duration.** What cap (`€[cap]`) and duration (`[duration] days`) does X1
  request? Interim: placeholders; X1 can be requested, not approved (D-040). Owner: PM with finance.
- **PQ-3 — Upside adoption.** Confirm 30% (any value ≥ 24% gives identical displayed figures). Interim: 30%
  (D-041). Owner: PM.
- **PQ-4 — MD-21 v1 narrative.** The fixture says v1 was returned for a missing owner and currency, but
  submission requires both. Proposed wording: "returned to change the owner and confirm EUR". Owner: PM.
- **PQ-5 — Version history depth.** Does the History tab need sizing/economics v1 in the demo? If yes, the
  fixture needs v1 inputs (fixture CR). Owner: PM with design.
- **PQ-6 — Thesis blocker wording.** S05 shows an open item for the upcoming gate as "Pending" and one for a
  later gate as "Blocker" (prototype). With `ThesisView.blockers[].status` (D-068) the server decides; confirm
  the meaning of each word. Owner: PM with design.
- **PQ-7 — Assumption register order.** S09 sorts by sensitivity, then weakest evidence first, so "Specialist
  requirements (None)" leads Test first; the prototype lists it last (D-067). Owner: design.
- **PQ-8 — Restricted site list owner.** The prototype names Jonas Klein as data owner, but the fixture makes
  him aggregate-only; S06 names Maya Rao. Which is right? Owner: PM.
- **PQ-9 — SAM > TAM state.** The prototype still shows the ladder when sizing is blocked; the screens hide ladder
  values while a blocking check is open (D-066, WS2-3). Confirm with design.
- **PQ-10 — G3 note.** S12's scale reason omits the prototype's "€400k one-time scale-entry investment" clause:
  no view carries that number. Should the outcome review or the G3 preconditions name it? Owner: PM.
- **PQ-11 — Missing actions from the prototype.** "Suggested adjacent segments · AI draft" on S02, "Request
  normalization" on S04, budget entries on S11 (`budget.recordEntry`) and mapping edits on S14 have no UI (no data
  source or not built). Which are needed for the pilot? Owner: PM.
- **PQ-12 — G2 stop rules and milestones.** The S10 prepare form does not collect stop rules or milestones (not in
  `GateScope`); the snapshot takes them from committed versions. Confirm that is the intended source. Owner: PM.
- **PQ-13 — Who writes the validation tasks?** The G1 decision locks the experiment and creates its validation task
  set (D-086), but no endpoint authors the tasks in it (the pilot plan has `pilot.saveDraft`; an experiment plan has
  no task list). The seed carries VAL-1…5 and the step-12 joint test inserts them. Options: tasks in the experiment
  plan (contract change), or a task editor on S09. Owner: PM with design. (Wave 3, D-080.)
- **PQ-14 — Investment committee persona.** D-034 lets the committee stop a case, but the fixture has no committee
  member; tests grant Priya the role. Should Aster have a named committee member? Owner: PM. (Wave 3.)
- **PQ-15 — Retried task key in the narrative.** The fixture shows task 2 becoming PIL-12 after the retry; with honest
  sequential keys the retried issue gets the next free key (PIL-17 when the counter starts at 11). Tests assert
  `PIL-n` and exactly 6 issues. Change the narrative or reserve keys? Owner: PM. (Wave 3, D-084.)
- **PQ-16 — Two acceptances for an AI claim.** Accepting a claim proposal adds an AI draft claim; a person then accepts
  it as a fact with `claims.accept` (D-076). Should S05 offer one action that does both (still a human act)?
  Owner: design. (Wave 3.)

**Updates at the Wave 3 integration (2026-10-09):** PQ-2 — the API now takes `spendCap: null` /
`durationDays: null` as the placeholder; `"0"` is refused (D-071). PQ-6 — the server sets the blocker status by the
S05 rule (D-081); the wording question stays open. PQ-11 — `budget.recordEntry` exists in the API (WS4b); the S11
UI for it is still open.

---

## Stage: Build — Wave 2 screen integration (2026-10-09)

Wave 2 merged the four screen streams into `claude/zen-euler-ph3oag` on top of the Wave 1 head `ca95231`:
WS8a (Overview, Cases, Mandate + G0, Opportunities, Compare, My Work, Reviews), WS8b (Thesis, Sizing,
Feasibility, Economics), WS8c (Validation, Decisions, decision brief) and WS8d (Pilot, Outcomes, Evidence,
History, Administration). Notes are in `docs/market-expansion/build/notes/WS8{a,b,c,d}.md`. The entries below
consolidate the streams' decisions, the PE's integration work and the change-request (CR) decisions. Every
accepted contract change is additive (D-031 §4) and listed for the API side in `WAVE3.md` §8, because the Wave 3
API streams build against the Wave 1 contracts in parallel.

### D-061 — Wave 2 integration order and mock handler precedence
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: All four streams branched from WS7's `c00e84c` and run against MSW mocks. Screen mocks load in folder
  order and the first matching handler wins, so a stream that answered a shared endpoint for every id silently
  shadowed the others: Decisions answered every `gates.get/package/decide` (breaking G0 on S02), every
  `gates.preconditions` (hiding WS8d's X) and every `cases.header` (hiding the converted ME-104 of the discovery
  journey); Pilot answered the VAL task set's `taskSync.*`; Economics answered the S09 register.
- Decision: Merge `--no-ff` in the order WS8a → WS8b → WS8c → WS8d (D-032 rules: keep both sides of
  `screens/registry.ts`; one value for the every-route axe timeout, 180 s; keep WS8b's animation wait in the axe
  helper; regenerate the lockfile). Shared endpoints are **claimed by id** with WS8a's `scoped()` (falls through
  when the predicate is false). The claim table lives in `mocks/handlers.ts` and `mocks/precedence.test.ts` pins
  it: `cases.header` → opportunities for cases converted in this tab, decisions for ME-104, else WS7;
  `gates.get/package/decide` → decisions for G1/G2, mandate for its G0 requests, else WS7; `gates.preconditions` →
  decisions for ME-104 G1/G2, outcomes for X, else WS7; `taskSync.*` → pilot for the PIL set, validation for the
  VAL set; `assumptions.list` → one register (validation) that merges WS8b's disputes; the fixture adoption
  dispute thread is WS8c journey state and every other challenge belongs to economics; `admin.connections` →
  admin (stateful, supersedes WS7); `lineage.get` → sizing for ME-104. Pilot adds `tasks.update` for My Work.
- Alternatives considered: an explicit precedence number per mock module (hides ownership; any reorder breaks a
  stream); one shared mock module for every shared endpoint (moves journey state away from the screens that own
  it). A shared module was used only for the assumption register, where two streams model the same rows.
- Consequences: Every stream's unit and e2e specs pass together (36/36 e2e). A new screen mock that answers an
  endpoint someone else answers must claim by id and extend the table and the test. WS8b's registry edit had also
  mangled the registry's example comment; the PE restored it.

### D-062 — Mock journey state persists per tab in sessionStorage
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: The acceptance steps switch persona with a full page load (Maya submits, Elena decides), and MSW keeps
  state in page memory.
- Decision (WS8a, WS8c, WS8d): each journey mirrors its mock state to `sessionStorage` (`growth-os:mock:*` via
  `persisted()`, `growth-os:ws8c-mock` with presets `start … expired` chosen by `growth-os:ws8c-preset`,
  `growth-os:ws8d-mocks` with `pilotVariant` / `outcomesMoment` seeds). State is bound to WS7's `state.scenario`
  so `resetMockState()` resets it; restore happens once per page load; a new tab starts fresh. WS8b's variants
  use the shared scenario object (`setScenario({ sizingVariant, adoptionDisputed, thesisRun, siteListRestricted })`)
  and switch client-side. Moments differ on purpose: discovery at aster-start, assessment at 13–14 Oct, the WS8c
  journey from `start` to `expired`, the pilot after the G2 approval; the case header follows the journey that
  owns ME-104 (D-061).
- Alternatives considered: extend WS7's `MockScenario` for every stream (one file edited by four streams);
  in-app navigation only (cannot switch persona).
- Consequences: e2e specs seed a moment and reload; Vitest resets all stores between tests. Against the real API
  the journeys need a fresh `aster-start` seed (the G0 spec assumes the next mandate is MD-22).

### D-063 — The web app runs the domain engines
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: S08 recomputes while the user types and the S06/S08 mocks must return exactly what the engines return.
  WS8b built against a stub domain and carried a verbatim copy of the WS2 engines behind `engine/adapter.ts`.
- Decision: `apps/web` depends on `@growth-os/domain`; the sizing and economics adapters re-export
  `createSizingEngine`, `createEconomicsEngine`, `CASH_FLOW_INPUT_LABELS` and the lineage helpers from it, and the
  copies are deleted. The fixture-hash tests (`74cedbb3…`, `3b748b4d…`) and golden values run against the domain
  engines. Live recompute is a **preview**: the debounced draft save returns the server result, which replaces
  the local one (same engine, same input, asserted equal); committed snapshots are only read, never recomputed;
  the client never persists computed money (FRONTEND §1.3).
- Alternatives considered: keep the copies (drift); recompute on the server only (no immediate feedback).
- Consequences: The S08/S06 chunks share one ~44 kB engine chunk; any engine change is one change for API, seed,
  worker and web.

### D-064 — Shared UI fixes from the screen streams
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: (1) `useFocusableScroll` moves from WS8c into `@growth-os/ui`; `DataTable` uses it so its scroll area
  is a named, keyboard-focusable region while it overflows (axe `scrollable-region-focusable`; always when
  overflow cannot be measured); screens with their own `.gos-table-scroll` call it on a container.
  (2) `ApprovalPanelView` gains an optional `lockBody` under the lock banner's policy reason (additive prop; the
  frozen `ApprovalPanelProps` is unchanged); S10's "Viewing as … Only Elena Fischer can decide G2 v3" moves there.
  (3) **The approvals in a package are those on its current snapshot**: `decidedNoteFor` (connected panel) and S10's
  `decidedNote` ignore approvals on earlier snapshots, so a decision on v1 never hides the actions after a return
  and resubmission (WS8a decision 5). WS4 lists earlier-snapshot decisions in `gateHistory` only.
- Consequences: Unit tests cover the region (with and without overflow), the lock body and the snapshot rule.

### D-065 — Multipart upload in the web client
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: D-051 accepted CR-WS1-1 (no contract change) and left the client path to WS8d, which did not build it.
- Decision: `api()` sends endpoints in `MULTIPART_ENDPOINT_IDS` (`evidence.upload`) as `multipart/form-data`: the
  body as the JSON `metadata` part, the file as the `file` part (named after the `File` or the body's
  `fileName`), with the Idempotency-Key header and no explicit Content-Type (the browser sets the boundary).
  A multipart endpoint without a file, or a file on a JSON endpoint, is a programming error. `useCommand` passes
  the file and includes its size and type in the intent fingerprint.
- Consequences: An S13 upload form can use it directly; no MSW upload mock yet (the WS1 API handler exists).

### D-066 — Honest display rules the screens added
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS8b, WS8d, WS8a):
  1. **Blocked sizing hides ladder values.** While `result.blocked`, S06 replaces the ladder with "Ladder values
     are hidden while a blocking check is open", SAM count and formula read "Paused", and lineage values read
     "Not available — resolve the blocking checks first" (D-033, WS2-3). Deliberately differs from the prototype's
     SAM > TAM state (PQ-9).
  2. **Negative outcomes are neutral.** S12 renders Not met / Inconclusive with the neutral `ResultGlyph` and an
     Actual kind tag with period and source — never red; a recorded result is a fact, not a failure.
  3. **Never "Synced".** S11's banner carries the server's `summaryText` ("5 of 6 tasks confirmed in Jira · 1 failed
     (permission)"); the polite status line describes the next action and never restates a count that can go
     stale. A timed-out task shows "Checking" until it reconciles (the mock keeps it there for at least one poll).
  4. **Placeholders stay placeholders.** The extension cap field shows "€[cap]" and "Placeholder · confirm with PM"
     (D-040); authority ceilings in an illustrative tenant read "up to €[limit]"; S12's scale reason is composed
     from the server's unmet G3 preconditions.
  5. **Unknown is never 0** on S04 (dashed Unknown tag; "Not ranked — 1 input missing (channel access)"); spend to
     date with a finance source down reads "Not available — …" on S01.
  6. **AI cannot review.** The specialist row on S07 stays "Pending — human review required"; no readiness score.
- Consequences: The release-blocker never-rules hold in the UI before the API lands.

### D-067 — Screen interaction decisions
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (stream notes, consolidated):
  1. **Rank** (WS8a): S04 shows "Rank i of n" from `RankingRow.rank` (D-068), falling back to the order of ranked
     rows; the score is the server's 2-decimal string, never recomputed. A comparison is created from the `ids`
     deep link (`comparisons.create` must return the existing comparison for an identical set) and selection for
     comparison is explicit (max 4).
  2. **One approval panel** (WS8a, WS8c): G0 decides in the shared connected `ApprovalPanel` bound to the package's
     snapshot id + hash. **Approving a package approves its proposed conditions**: S10 sends
     `approve_with_conditions` with the proposed conditions verbatim plus any the approver adds; the API treats
     identical text as the same condition. Stale or superseded versions disable every action with the reason;
     policy reasons lock the panel for everyone else.
  3. **Register order** (WS8c): Test first / Test next / Watch / Monitor from the API's `registerGroup`; within a
     group, sensitivity, then weakest evidence first, key as tie-break (PQ-7).
  4. **Drafts** (WS8a, WS8b): autosave with If-Match and a keep-mine / take-theirs conflict; committed versions are
     read-only ("Changes create vN+1"); S06 "Undo edit" is a session undo stack (no pre-edit value in the
     contract; CR-WS8b-5 deferred).
  5. **"Used by"** (WS8b): grouped by measure and walked along the measure chain (SAM → Reachable pool, SOM,
     Economics), never a false direct edge (D-056).
  6. **Interim sources** (WS8a, WS8d): owner pickers outside a case use the dev persona directory and admin names
     the persona list until `people.list` and `catalogue.scopeOptions` land (D-068); S02 scope fields stay
     read-only until then; My Work reads the task row version from the pilot plan only when the work item has none.
  7. **Dates** render in Europe/Berlin until `Tenant.timeZone` is served; ISO calendar dates never shift.
  8. **Brief and package** (WS8c): the brief sits inside the case layout and print CSS hides the chrome; package
     text is server text (nothing decision-relevant is computed in the browser).
  9. **Navigation** (WS8d): task titles are `?task=` deep links; Diagnostics opens a run trace only from `?run=`
     (no tenant-wide run list). The S02 "AI draft" box is omitted (no data source; PQ-11).
- Consequences: The screens switch to WS4 endpoint by endpoint with no code change beyond the D-068 fallbacks.

### D-068 — Contract additions from the screen streams (CR decisions)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: The four notes raised 25 change requests (register below). The Wave 3 API streams are building against the frozen
  contracts, so only additive, backward-compatible changes are accepted now; each is listed with its API-side
  wiring in `WAVE3.md` §8 for the Wave 3 integration.
- Decision: Accepted (additive): `OutcomeReviewView.rowVersion` and `.extensionRequest`; `MessageDraft.rowVersion`;
  `WorkItem.rowVersion` (and `WorkItem.id` documented as the task id for tasks); `RankingRow.rank` (set by the
  domain ranking engine; golden and property tests extended); `ComparisonCell.evidenceQuality`;
  `FeasibilityAssessment.questionDetail`; `ThesisView.blockers[].status` with `ThesisBlockerStatus` and its labels;
  `DecisionPackageView.changesSince { sinceVersion, viewedAt }`; `Tenant.timeZone` (the column is a migration at the
  Wave 3 integration); `outcomes.requestExtension` accepts `spendCap: null` / `durationDays: null` for the PRD
  placeholder (submittable, never approvable — consistent with D-040 and D-045); new reads `people.list`
  (`GET /people`) and `catalogue.scopeOptions` (`GET /me/scope-options`), 146 endpoints; label maps
  `REVIEW_AREA_LABELS` and `GATE_REQUEST_STATUS_LABELS`. API behaviour clarified without a contract change:
  identical proposed conditions are not duplicated by `gates.decide`; `assumptions.update` returns snapshot ids and
  approval ids as its field names say (the WS8c mock is corrected).
- Alternatives considered: wait for Wave 3 to land before changing contracts (the screens keep workarounds that
  read the wrong source of truth, e.g. sending the review version as a row version).
- Consequences: The web reads each new field with a fallback for an API that predates it; contract tests prove old
  responses still validate. The register below records each CR.

### D-069 — Change requests deferred or rejected in Wave 2
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: **Rejected:** a G0 decision summary on `Mandate` (CR-WS8a-4; the package is the record and a copy would
  drift); `LineageNode.usedBy` (CR-WS8b-3; D-056 stands). **Deferred:** the pre-edit value on `LedgerRow` / draft edit
  history (CR-WS8b-5; needs a draft-history design, the session undo stack suffices for the pilot). **Resolved by
  other means:** admin names (CR-WS8d-4) by `people.list` and `catalogue.scopeOptions` without changing the admin
  shapes; case people (CR-WS8d-5) by `cases.members` (D-037); the WS7 items (focusable table scroll, lock-banner
  body, axe timeout) by D-064 and D-070.
- Consequences: No breaking change entered Wave 2.

### D-070 — Test robustness for the integrated screens
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: With 23 real screens, the WS7 every-route axe crawl exceeded 30 s; S06's drawer fade-in made axe measure
  half-transparent text; the integration machine also runs the Wave 3 streams, so component tests timed out at
  Testing Library's 1 s wait; S11's reconcile could complete inside one refetch, so "Checking" was sometimes never
  painted; several worktrees run Vite on the default port.
- Decision: The axe crawl gets 180 s; `axeViolations` waits for finite animations first (WS8b); a Vitest setup gives
  Testing Library a 5 s async budget (no assertion changes); the S11 mock reconciles a timed-out task only on a read
  at least 1.5 s after the timeout (its unit test advances the clock explicitly); e2e runs use a unique
  `E2E_PORT` because `reuseExistingServer` would otherwise attach to another worktree's Vite.
- Consequences: Unit 2031/2031, DB 115/115 and e2e 36/36 pass on the integrated head; no test was skipped or
  weakened.

### Change-request register — Wave 2

| CR | From | Request | Decision | Record |
|---|---|---|---|---|
| CR-WS8a-1 | WS8a | People directory | **Accepted** (`people.list`) | D-068 |
| CR-WS8a-2 | WS8a | Product / segment / country catalogue | **Accepted** (`catalogue.scopeOptions`) | D-068 |
| CR-WS8a-3 | WS8a | `WorkItem.rowVersion` (+ task id) | **Accepted** (optional field; `id` is the task id) | D-068 |
| CR-WS8a-4 | WS8a | G0 summary on `Mandate` | **Rejected** — the package is the record | D-069 |
| CR-WS8a-5 | WS8a | `RankingRow.rank` | **Accepted** (engine sets it) | D-068 |
| CR-WS8a-6 | WS8a | `ComparisonCell.evidenceQuality` | **Accepted** | D-068 |
| CR-WS8b-1 | WS8b | Long specialist question | **Accepted** (`questionDetail`) | D-068 |
| CR-WS8b-2 | WS8b | `REVIEW_AREA_LABELS` | **Accepted** | D-068 |
| CR-WS8b-3 | WS8b | `LineageNode.usedBy` | **Rejected** (D-056) | D-069 |
| CR-WS8b-4 | WS8b | Status on thesis blockers | **Accepted** (`ThesisBlockerStatus`) | D-068, PQ-6 |
| CR-WS8b-5 | WS8b | Pre-edit value on `LedgerRow` | **Deferred** — needs draft history | D-069 |
| CR-WS8c-1 | WS8c | `GATE_REQUEST_STATUS_LABELS` | **Accepted** | D-068 |
| CR-WS8c-2 | WS8c | `REVIEW_AREA_LABELS` | **Accepted** (same as CR-WS8b-2) | D-068 |
| CR-WS8c-3 | WS8c | Since-version on package changes | **Accepted** (`changesSince`) | D-068 |
| CR-WS8c-4 | WS8c | `Tenant.timeZone` | **Accepted** (field now; column at Wave 3 integration) | D-068 |
| CR-WS8c-5 | WS8c | Focusable `DataTable` scroll | **Done** in `packages/ui` | D-064 |
| CR-WS8c-6 | WS8c | Lock-banner body | **Done** (`lockBody`) | D-064 |
| CR-WS8c-7 | WS8c | Axe crawl timeout | **Done** (180 s) | D-070 |
| CR-WS8c-8 | WS8c | Proposed-condition dedupe; id kinds in `assumptions.update` | **Clarified** (API behaviour, no contract change) | D-068 |
| CR-WS8d-1 | WS8d | `OutcomeReviewView.rowVersion` | **Accepted** | D-068 |
| CR-WS8d-2 | WS8d | `MessageDraft.rowVersion` | **Accepted** | D-068 |
| CR-WS8d-3 | WS8d | Nullable extension cap / duration | **Accepted** (request widened; placeholder never approvable) | D-068, D-040 |
| CR-WS8d-4 | WS8d | Names in admin responses | **Resolved** by `people.list` + `catalogue.scopeOptions` | D-069 |
| CR-WS8d-5 | WS8d | Case people for pickers | **Resolved** by `cases.members` | D-037 |
| CR-WS8d-6 | WS8d | X request on the outcome review | **Accepted** (`extensionRequest`) | D-068 |

New open product questions: PQ-6 to PQ-12 (see "Open product questions" above).


---

## Stage: Build — Wave 3 back-end integration (2026-10-09)

Wave 3 merged the four back-end streams into `claude/zen-euler-ph3oag` on top of the Wave 2 head `29e1f67`: WS4a
(discover and assess API, 64 endpoints), WS4b (decide, execute and review API, 38 endpoints), WS6 (simulated
connector, outbox worker, task sync and dev routes, 7 endpoints) and WS5 (analysis harness, providers, tool gateway,
ten skills, evals and 9 endpoints). Notes are in `docs/market-expansion/build/notes/WS{4a,4b,5,6}.md`. The entries
below consolidate the streams' decisions, the PE's deduplication, the D-068 contract wiring, the joint tests and
the change-request (CR) decisions (D-031 process: additive changes accepted now, the rest deferred with a reason).
All 146 registry endpoints now have handlers.

### D-071 — Wave 3 integration order, conflicts and one `extension_requested`
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: The four streams branched from `ca95231` and each added one-line registrations to shared files; WS4b emitted
  `extension_requested` twice per extension (the `outcome_revise_or_extend` transition and `outcomes.requestExtension`)
  and read a `"0"` cap as the €[cap] placeholder.
- Decision: Merge `--no-ff` in the order WS4a → WS4b → WS6 → WS5 (D-032 rules). Conflicts: `apps/api/src/modules/index.ts`
  three times (all registrations kept) and `apps/worker/src/tasks.ts` (WS6 outbox tasks + WS5 `analysis.run`);
  `schedule.test.ts`, `vitest.config.ts`, `.env.example`, the package files and the lockfile merged cleanly; the
  lockfile was regenerated with `pnpm install`. `extension_requested` is emitted **once**, by
  `outcomes.requestExtension`, when the X request exists (the event carries the X gate request); "Revise" alone
  requests nothing, so the case transition no longer emits it. `spendCap: null` / `durationDays: null` are the PRD
  placeholder (D-040, D-068): submittable, never approvable; a stated cap must be positive (`"0"` → 400, because zero
  never stands for missing).
- Alternatives considered: keep the transition's event (it would fire for "Revise" with no extension).
- Consequences: `outcomes.db.test.ts` asserts no event on the decision and exactly one with the X request.

### D-072 — One implementation of gate facts, gate read models and snapshot summaries
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: WS4a (`me/cases/gate-facts.ts`, `gate-read.ts`) and WS4b (`me/gates/lib/facts.ts`, `serialize.ts`,
  `snapshot.ts`) built the same helpers in parallel and they disagreed (G1 sources, finance sign-off binding, G3 targets,
  button labels, money copy).
- Decision: The gate library is `apps/api/src/modules/me/gates/lib/` (WS4b's, the superset: G0/X facts, the gate
  policy's precondition keys, targets from the approved G2 snapshot, finance sign-off bound to the committed economics
  version). `caseGateState(tx, case, gate)` is the single source of a gate's preconditions and display status;
  `gates.preconditions`, the case header rail (G1–G3, X), the outcome review's scale block and the overview all call
  it. `caseSourceIds` is one definition (originating opportunity sources + sizing inputs, cohorts and claims) for G1
  evidence, snapshot evidence and header freshness. WS4a's duplicates are deleted. Snapshot content takes the sizing
  and economics text from WS4a's `committedSizingSummary` / `committedEconomicsSummary` (now built with the frozen
  `packages/ui/src/format` rules, exported as `@growth-os/ui/format`, so it equals the fixture's `expectedDisplay`)
  and a first snapshot takes its recommendation and alternatives from `committedThesis`.
- Consequences: `me/gates/agreement.db.test.ts` proves the header rail and `gates.preconditions` agree for G1, G2, G3
  and X, and that a fresh snapshot's sizing/economics text equals the serializers and the seeded package.

### D-073 — Approval integrity: order of checks, error codes and conditions
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS4b): `gates.decide` checks AGENT (pipeline) → gate state → `SNAPSHOT_STALE` (stale gate, non-current
  snapshot or another snapshot id) → `SNAPSHOT_HASH_MISMATCH` → policy: for approve dispositions `gate.decide`
  (admin `FORBIDDEN` → `SELF_APPROVAL_PROHIBITED` → `CONFLICT_OF_INTEREST` → role → `AUTHORITY_INSUFFICIENT` on the
  tenant-local `asOf`), for other dispositions designated approver and not conflicted → `gateRequestMachine.apply` for
  sign-offs and condition owners (`PRECONDITIONS_UNMET`). The authorize hook checks visibility only, so admins reach
  the policy and get `FORBIDDEN`; the DB guard repeats the critical checks. Proposed conditions live in
  `gate_request.scope.proposedConditions` (contract reads strip the key); a condition repeated word for word
  (whitespace-normalized, same flag) keeps its proposal key (C1, C2), new ones get the next key. Package fields
  (`approvals`, `positions`, `panel`) describe the viewed snapshot only; `gateHistory` lists every decision. G3 is
  refused at `gates.createRequest` while any precondition is unmet (D-039 summary, all blockers). Text (rationale,
  dissent, blockers) never enters audit.
- Consequences: steps 18 and 29 in `apps/api/test/db/security/approval.test.ts`; step 19–20 in `gates.db.test.ts`.

### D-074 — AI-down: nothing depends on analysis runs
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: WS5's guard test (no module outside `analysis/` and admin Diagnostics reads runs or proposals) failed after
  the merge: WS4a's opportunity list read the latest discovery run's status for `discoveryPartial`.
- Decision: `discoveryPartial` and `unavailableSources` come from discovery connection health only; the run's own
  status and detail are on the analysis panel. `ANALYSIS_ENABLED=false` refuses start, discovery and resume with 503
  `CONNECTOR_UNAVAILABLE` ("Analysis is turned off. Continue by hand; nothing depends on it."); a failing provider ends
  the run `failed` with "Stopped — your work is saved". The guard test stays as written.
- Alternatives considered: whitelist the opportunity list in the test (weakens the guarantee).
- Consequences: Aster still shows "1 source unavailable" (the trade registry connection is down).

### D-075 — One approval-effectiveness rule for API, worker and timer (CR-WS6-5)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: `packages/db/src/approval.ts` holds `APPROVAL_EXECUTED_SQL` ("used": G0/G3 always; pilot activated; a
  locked experiment started; a task write it authorized left the outbox — sent, sending, checking or confirmed),
  `loadApprovalGateFacts`, the pure `approvalEffectivenessOf` and `approvalEffectivenessFor(tx, gate, now)`. An
  approval past `expires_at` that was never used is `expired` before the timer runs (fail closed). Task-sync preview and
  send, the worker's send-time re-check, the expiry timer's candidate query, and WS4b's activation, budget and
  experiment-start checks all use it.
- Consequences: the three copies (WS6 API, WS6 worker, WS4b) are gone; WS6's policy unit tests exercise the shared rule.

### D-076 — Accepted proposals write through WS4a's record writers (CR-WS5-3)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: `analysis.decideProposal` calls `createOpportunityFromProposal` and `createClaimFromProposal` inside its
  pipeline; WS5's stand-ins are deleted. A candidate becomes a Detected opportunity (`origin ai`, `agent_run_id`, fit
  criteria, unknowns, cited sources, likely duplicate only on the same mandate; audit
  `opportunity.created_from_proposal` with proposal and run ids). A claim becomes an **AI draft** claim (`status
  proposed`, kind from the proposal — never scenario/actual; an evidence claim without a citation becomes unknown;
  `ai_edited` when the person edited it); it becomes a fact only through `claims.accept` (never-rule 11). Cited passage
  ids are mapped to source ids before the writer validates them. Other proposal types are adopted as drafts with no
  business write (CR-WS5-6 deferred).
- Alternatives considered: WS5's stand-in that accepted the claim directly (one step, but two writers and a second
  acceptance rule).
- Consequences: WS5's claim test now proves the two-step acceptance; PQ-16 asks whether S05 should combine them.

### D-077 — Tenant time zone (migration 0004, D-068 §10)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: `0004_pe_wave3_integration.sql` adds `platform.tenant.time_zone text NOT NULL DEFAULT 'Europe/Berlin'`.
  `auth.me` returns it (`Tenant.timeZone`); authority `asOf` dates (WS4a `authorizeOnCase`, WS4b `subjectOf`, overview,
  pilot), materiality stale/invalidation reasons and both timer jobs (read per tenant, the option is only the fallback)
  use it. Display-only helpers that format a past timestamp without an identity (`shortDate`) still default to
  Europe/Berlin.
- Consequences: DB tests prove a 23:30 Berlin change reads "26 Nov" for an Auckland tenant and that the expiry reason
  follows the tenant's calendar.

### D-078 — Package read receipts and `changesSince` (D-068 §9)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: `platform.gate_request_view (gate_request_id, user_id, snapshot_version, viewed_at)` (0004, RLS) records the
  current version a person opened; `gates.package` reads the previous receipt, returns it as `changesSince` and
  measures `changesSinceViewerLastSaw` against that version (none when it is the version shown; a first-time viewer
  sees the changes from the superseded snapshot; `compareTo` still wins), then upserts the receipt. Opening an older
  version on purpose never moves it back. A receipt is not business state: never audited, never in a snapshot,
  humans only.
- Alternatives considered: audit events as receipts (audit must not carry reads; queries cannot write audit).
- Consequences: `me/gates/package-views.db.test.ts` (with the real WS4a assumption commit and WS4b refresh).

### D-079 — Directory reads `people.list` and `catalogue.scopeOptions` (D-068 §12–13)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: `people.list` (`modules/platform/directory`) lists active human principals with ≥ 1 unrevoked role, sorted
  by name, with their roles and business-unit scopes (empty = tenant-wide); agents and services never appear; a tenant
  administrator appears with the admin role only. `catalogue.scopeOptions` (`modules/me/catalogue`) lists the business
  units the viewer's roles reach (all for a tenant-wide role), the product and segment catalogue, and the countries of
  the tenant's mandates and opportunities. Both are readable by any person with a role; agents → 403
  `AGENT_IDENTITY_FORBIDDEN`, a person without a role → 403, another tenant's or a hidden business unit → 404, no
  session → 401. MSW mocks mirror the same rules.
- Consequences: the S02/S03/S14 interim persona-directory fallbacks (D-067 §6) can switch to these endpoints.

### D-080 — Joint tests across the streams
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: Four DB suites in `apps/api/test/db/joint/` drive the real endpoints and the real worker code:
  `pilot-to-simulator.test.ts` (steps 21–23 with no stand-ins: G2 decided through `gates.decide`, activation blockers
  listed together, `pilot.activate`, preview/send, permission fault, mapping fix, retry → exactly 6 simulator issues,
  same keys); `g1-to-validation-send.test.ts` (step 12 from `aster-start`: WS4a assessment → G1 submitted and approved
  → plan locked, validation task set → VAL-1…5 confirmed only after keys return; the five tasks are inserted because no
  endpoint authors them, PQ-13); `proposal-to-records.test.ts` (WS5 acceptance → WS4a writers, provenance, then WS4a
  commands on the new records); `assumption-pauses-writes.test.ts` (a decision-critical `assumptions.update` invalidates
  the active G2, pauses the four unsent writes, keeps the two confirmed, and the worker sends nothing more).
- Consequences: the seams WAVE3 §7 named are each proven once end to end.

### D-081 — Wave 3 change requests accepted (additive)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: **CR-WS4a-1** `SizingOutput.ladder.tam.available` and `reachablePool.available` (optional; the API's
  redacted blocked result sets every rung false). **CR-WS4a-4** optional `title` on `opportunities.convertToCase`
  (default "<candidate> — <product>"). **CR-WS4b-3** nullable extension cap — done by D-068/D-071. **CR-WS4b-4**
  optional `result` on `outcomes.recordObservation`, used only where the threshold has no number (placeholder or
  qualitative); for a numeric threshold a contradicting result is 400 (never-rule 12). **CR-WS5-2**
  `AnalysisRun.output { summary, unknowns, notChecked }` served from the run checkpoint. **CR-WS5-3** writers swapped
  (D-076). **CR-WS5-5** `analysis.proposals` accepts a mandate ref for discovery proposals — documented as the
  behaviour, no new endpoint. **CR-WS5-7** `ANALYSIS_RUN_WALL_TIME_MS` removed from `.env.example` (budgets come from
  skill manifests). **CR-WS6-1** `send_ok` / `reconcile_found` also from `paused_approval_changed` and
  `paused_connector` (new transition rows; the worker applies the machine from the link's real state). **CR-WS6-3**
  the expiry timer also pauses the links of queued tasks whose rows it paused. **CR-WS6-5** shared
  approval-effectiveness helper (D-075). WS4b's decisions under review: proposed conditions in the scope JSON —
  accepted (proposals never block activation); the activation-time `snapshot_component (pilot_plan_version)` row on the
  approved G2 snapshot — accepted as the convention (CR-WS4b-2); `spendCap "0"` — superseded by null; the outcome result
  read from the value's wording — kept only as the fallback when no stated result is given. The thesis blocker status
  (D-068) follows the S05 rule: the next gate still to approve is "Pending", a later gate "Blocker"; resolved blockers
  are omitted.
- Consequences: every change is optional on the wire; old clients and stored rows still validate.

### D-082 — Wave 3 change requests deferred or rejected
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: **Deferred:** CR-WS4a-2 (`thesis_changed` change type — needs an enum and default-policy change; `other`
  already classifies as uncertain → stale + escalate, which is safe); CR-WS4a-3 (economics driver kind — the null
  assumption link works and is tested); CR-WS4a-5 (xlsx export — no new spreadsheet dependency before a customer needs
  it; CSV keeps per-year and one-time apart); CR-WS4b-1 (`applyResolution` in `platform/materiality.ts` — WS4b's local
  `applyInvalidations` is correct and tested; move when a second caller appears); CR-WS4b-6 (domain budget helper —
  the integer-cent guard sums one-time money of one gate only); CR-WS5-1 (shared access helpers for the worker —
  security-relevant move of `effectiveAccess`; the worker restatement is covered by the gateway entitlement tests;
  schedule with a parity test); CR-WS5-4 (`agent_run.focus` column — only the fixture selection uses it; the
  checkpoint holds it); CR-WS5-6 (writers for adopted drafts — each owning screen needs its own design); CR-WS6-2 (a
  named "sender not authorized" transition — the audit already carries `actor_not_authorized`); CR-WS6-4
  (`sim.project_member` — permission failures surface at send time). **Rejected:** CR-WS4b-5 (nullable
  `MaterialChange.actor` — breaking for consumers; the nil-UUID "System" person stays and is documented).
- Consequences: no breaking change entered Wave 3.

### D-083 — Outbox dispatch: lease, reconcile before retry, re-check at claim
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS6): three steps per row — claim (lock, re-check, `sending` with a 60 s lease, attempts + 1), the connector
  call outside any transaction, then record the outcome through `syncMachine` with the system actor. The re-check at
  claim runs connection (→ `pause_connector`), then approval effectiveness and plan current (→
  `pause_approval_changed`: `approval_invalidated` / `approval_expired` / `plan_changed`), then "sender still holds a
  role with `task_sync.send` in scope" (→ failed, retryable, `actor_not_authorized`). The worker searches by
  idempotency key before **every** re-send (attempts > 0 or Checking), not only after timeouts; a search needs only a
  usable connection. A key returned by the tool is always recorded as Confirmed, even if a pause landed meanwhile
  (CR-WS6-1). The sweep (every minute) moves expired leases to Checking, claims due rows across tenants, searches each
  paused-while-Checking row once, aligns paused links, and resumes `paused_connector` rows after reconnect when the
  approval and plan still hold. Backoff 30 s × 2^(n−1), ≤ 15 min, never before Retry-After, 5 attempts; a manual retry
  or resume grants 5 more. The preview (30 min TTL) binds the send by content hash; send and retry lock the task set.
- Consequences: crash, timeout, concurrent-retry, expired-token and invalidation suites in `apps/api/test/connector-faults/`.

### D-084 — Simulated connector semantics
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS6): the simulator lives in `sim.*` and runs on the pool (autocommit), never inside the caller's business
  transaction. `createTask` is idempotent per key (the UNIQUE index is the last defence). Keys are `<last segment of the
  project>-n` (`PIL-n`, `ME-VAL` → `VAL-n`) from `sim.project_counter`, so a retried task takes the next free key.
  `token_expired` is sticky and connection-level until the rules are replaced; other faults apply to creates and consume
  `remaining`; projects are open (no membership table), permission failures are injected rules. The task key is
  computed once at preview with `externalTaskIdempotencyKey` (pilot: owning plan version; experiment: the
  pre-registered original plan version) and reused forever. Dev routes exist only with `AUTH_MODE=dev`, in
  illustrative tenants, for the caller's own connection.
- Consequences: PQ-15 (PIL-12 in the narrative vs the next free key).

### D-085 — Snapshots: content, refresh and expiry periods
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS4b + D-072): data fields (assumptions at current versions, sizing, economics, validation results, dissent,
  components) are rebuilt from committed rows; narrative fields (ask, recommendation, alternatives, limitations, stop
  rules, sign-offs) carry over on refresh and resubmit, with positions recorded on the previous snapshot merged into the
  sign-offs; unchanged sizing/economics blocks carry over so the diff shows real changes; pre-registered outcome
  targets are copied to the new snapshot (thresholds never move). G1 pins the draft plans it authorizes; G2 and later
  pin result versions and signed feasibility reviews; activation adds the plan version as a component of the approved
  G2 snapshot (insert-only; the hash is unchanged) so a scope change reaches the approval. Approvals of G1, G2 and X
  expire `decided_at + approvalExpiryDays` (gate policy, default 14); G0 and G3 never expire.
- Consequences: step 19 refresh v3 → v4 shows only the adoption change.

### D-086 — Experiments: lock, amendments, results
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS4b): an experiment is locked only by the G1 follow-on, which marks the pinned plan as the original and
  creates the validation task set (`owner_type 'experiment'`, authorizing G1, validation mapping) — empty, see PQ-13.
  Locked plans refuse edits (`INVALID_TRANSITION`); an amendment is a new plan version with a reason and the original
  stays visible ("Original (pre-registered)"); results are append-only versions with period and source ("Too early to
  read" counts as recorded). Amendments and new result versions call materiality (`other` → uncertain → escalate).
- Consequences: steps 10–11, 13–14.

### D-087 — Pilot activation preconditions and hand-off
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS4b): `pilot.activate` needs an effective G2 approval (D-075), every task owned and every blocking
  condition met; the blockers are listed together in server order (unowned tasks with ordinal and title, then open
  conditions with key and text). Activation commits the plan version, sets it current, locks the task set
  (`owner_type 'pilot_plan_version'`, `owner_id` = that version, authorizing G2), moves the case to Pilot running, opens
  outcome review v1 and emits `pilot_activated {tasks}`; WS4b never sends. WS6 treats "plan current" as
  `pilot_plan.current_version_id = task_set.owner_id`. A scope change commits a new version and calls materiality
  (`spend_ceiling_changed` / `plan_tasks_changed`).
- Consequences: steps 21–22 and the WS6 hand-off (D-080).

### D-088 — Analysis harness
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS5): the provider request is rebuilt every turn from the persisted checkpoint (context blocks, tool calls
  and results, untrusted passages, answers); every step commits atomically with the checkpoint and refuses if the run
  was cancelled; committed tool results are reused by tool + argument hash on resume. Budgets: wall time and tool
  calls per attempt, tokens and cost per run; a tool budget reached → remaining calls refused → `partial`; time, cost,
  token budget or 24 turns → `failed` `BUDGET_EXHAUSTED`, resumable. The trace stores structured step summaries and
  redacted arguments with a hash, never the model's reasoning (no thinking settings are sent). Evidence reaches the
  model only inside escaped untrusted-data blocks with a standing instruction to treat it as data; the gateway order is
  allowlist → budget → tenant and identity (the requester's current access) → strict schema → entitlements
  (restricted → "denied · not summarised", never listed or counted). Output is proposals only; uncited or unsupported
  precise claims become unknown. The fixture provider is the default; a missing fixture or key is an error, never a
  fallback. At most 4 running runs per tenant; skill versions are pinned per run; the model name is configuration only.
- Consequences: WF-09 tests in `apps/worker/src/jobs/analysis/{run,gateway}.db.test.ts`.

### D-089 — Evaluation graders
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision (WS5): `pnpm evals:smoke` runs the deterministic suites with the fixture provider; security, provenance and
  recovery suites require zero failures (citation validity 100%, provenance 100%, 0 injections, 0 restricted leakage);
  expert-scored suites run deterministic proxies and report "expert review pending" until people score them.
- Consequences: CI runs the smoke set on every change; live-provider runs are manual.

### Change-request register — Wave 3

| CR | From | Request | Decision | Record |
|---|---|---|---|---|
| CR-WS4a-1 | WS4a | `available` on TAM and reachable pool | **Accepted** (optional) | D-081 |
| CR-WS4a-2 | WS4a | `thesis_changed` material change type | **Deferred** — `other` is uncertain → stale + escalate | D-082 |
| CR-WS4a-3 | WS4a | Economics driver kind / override flag | **Deferred** — current model works | D-082 |
| CR-WS4a-4 | WS4a | Optional title on convert | **Accepted** (optional) | D-081 |
| CR-WS4a-5 | WS4a | xlsx export | **Deferred** — CSV only | D-082 |
| CR-WS4b-1 | WS4b | `applyResolution` platform helper | **Deferred** — local helper correct and tested | D-082 |
| CR-WS4b-2 | WS4b | G2 pins the pilot plan | **Accepted** as the activation-time component convention | D-081, D-085 |
| CR-WS4b-3 | WS4b | Nullable extension cap | **Accepted** (D-068) | D-071 |
| CR-WS4b-4 | WS4b | Human result for non-numeric targets | **Accepted** (optional; never overrides a number) | D-081 |
| CR-WS4b-5 | WS4b | Nullable `MaterialChange.actor` | **Rejected** — breaking; "System" person stays | D-082 |
| CR-WS4b-6 | WS4b | Domain budget helper | **Deferred** | D-082 |
| CR-WS5-1 | WS5 | Shared access helpers for the worker | **Deferred** — needs a parity test | D-082 |
| CR-WS5-2 | WS5 | `AnalysisRun.output` | **Accepted** (optional) | D-081 |
| CR-WS5-3 | WS5 | Swap stand-in writers | **Done** | D-076 |
| CR-WS5-4 | WS5 | `agent_run.focus` column | **Deferred** — checkpoint holds it | D-082 |
| CR-WS5-5 | WS5 | Mandate proposals path | **Accepted** as documented behaviour | D-081 |
| CR-WS5-6 | WS5 | Writers for adopted drafts | **Deferred** — per-screen design | D-082 |
| CR-WS5-7 | WS5 | Unread wall-time setting | **Done** (removed) | D-081 |
| CR-WS6-1 | WS6 | Confirm from paused states | **Accepted** (transition rows) | D-081, D-083 |
| CR-WS6-2 | WS6 | Named "sender not authorized" transition | **Deferred** — audit code suffices | D-082 |
| CR-WS6-3 | WS6 | Timer pauses queued links | **Done** | D-081 |
| CR-WS6-4 | WS6 | `sim.project_member` | **Deferred** | D-082 |
| CR-WS6-5 | WS6 | Shared approval-effectiveness helper | **Done** | D-075 |

New open product questions: PQ-13 to PQ-16, and updates to PQ-2, PQ-6 and PQ-11 (see "Open product questions").

---

## Stage: Build — End-to-end and release readiness (2026-10-09)

The Principal Engineer ran the web app against the real stack for the first time: API, worker and a seeded
Postgres, with the simulated Jira connector and the fixture analysis provider, MSW off. The full 30-step Aster
journey (BUILD_PLAN §8) and every alternate path now pass in Playwright with axe, twice (with analysis on and
with `ANALYSIS_ENABLED=false`). Walking the journey for real found blockers the per-stream suites could not
see: some endpoints existed with no screen, some screens called endpoints that nothing populated, and a few
copies of the same rule disagreed. The entries below record each blocker decision, the harness, the release-gate
mapping and the fixes of note. Additive contract changes follow the D-031 process (accepted here, listed in
D-108). New open product questions: PQ-17 to PQ-20.

### D-090 — Validation tasks are drafted from the locked plan at G1 (PQ-13 interim)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: PQ-13: G1 locked the experiment and created an empty validation task set, but no endpoint authored the
  tasks, so step 12 ("create 5 tasks in Jira (ME-VAL)") could not happen without a database insert.
- Decision: The G1 decision (`gates.decide`, inside its command pipeline: policy, audit, one transaction) drafts
  the validation tasks from the pre-registered plan with the pure `draftValidationTasks` (packages/domain): select
  the sample (experiment owner, window start), brief fieldwork (fieldwork owner, window start + 1 day), one task
  per pre-registered metric with its target (fieldwork owner, window end), record results and nonresponse
  (experiment owner, window end). The set keeps the WS6 shape (owner `experiment`, authorizing G1, validation
  mapping); nothing is sent; audit `task_set.drafted`. EXP-03 yields exactly five tasks → VAL-1…VAL-5.
- Alternatives considered: an additive `validation.tasks.create` endpoint (needs a task editor on S09 that the
  design does not have); tasks inside the experiment plan (contract change and a second editor).
- Consequences: task titles are derived ("Completed discovery interviews (target 8)") rather than the fixture's
  free text; editing draft validation tasks before sending stays open under PQ-13 (owner PM with design). The
  step-12 joint test no longer inserts tasks.

### D-091 — Dev clock (dev-only, illustrative tenants, audited, forward only)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: Steps 25–27 need the pilot window to end (90 days) and approval expiry must be walkable live; the only
  transition to Review due is the pilot-window timer.
- Decision: Migration 0005 adds `platform.dev_clock (tenant_id, offset_ms ≥ 0, set_by, set_at)` with RLS and a
  guard trigger that refuses rows for non-illustrative tenants and any smaller offset. `dev.clock` /
  `dev.setClock` (`auth: 'dev_only'`, registered only with `AUTH_MODE=dev`, people only, illustrative tenants
  only) read and move it by `to` or `advanceDays`; moving it is audited (`dev.clock_set`) and enqueues the
  pilot-window and approval-expiry timers. Business time comes from one helper, `businessNow()`
  (packages/db/clock.ts), used by the API pipeline (`ctx.now`), the timers (per tenant) and the outbox send-time
  re-check and sweep; it applies only when `AUTH_MODE=dev`, `NODE_ENV≠production` and the tenant is
  illustrative. Sessions, leases, idempotency TTLs and audit timestamps stay real time.
- Alternatives considered: a seed profile at the Review-due moment (cheaper, but the window end and expiry could
  never be walked live, and the journey would have to jump seeds mid-run).
- Consequences: the journey runs at the fixture moments (20 Nov results, 26 Nov G2, 1 Mar 2027 review). Going back
  needs a reseed. Production code paths read no offset.

### D-092 — Real-stack e2e harness
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: `apps/web/e2e/support/playwright.real.config.ts` (projects `real` and `real-ai-down`) starts the API
  (4710), a second API with `ANALYSIS_ENABLED=false` (4711), the worker, and two Vite servers (5710, 5711) with MSW
  off and `/api` proxied — unique ports, so `pnpm dev` and other processes keep theirs. It runs serially on one
  worker against a dedicated database (`growth_os_pe` locally, `growth_os_e2e` in CI). Each spec file resets and
  seeds it in `beforeAll` through the test-only `packages/db/src/cli/e2e-reset.ts` (drops the app schemas,
  re-migrates, empties the job queue, seeds `aster-start` or `aster-demo`, optionally an isolated second
  tenant); the CLI refuses unless `E2E_DB_RESET=1`, outside production, on a database named `*_pe` or `*e2e*`.
  Helpers (`support/real.ts`) read audit and analytics rows as the owner inside the tenant context (RLS on) and
  call the API with the page's session. The mock project ignores the real specs and is unchanged.
- Consequences: `pnpm test:e2e:real`; CI installs Chromium and runs both projects (D-108).

### D-093 — aster-start carries the reviewers' comparison ratings
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: Step 4 expects OPP-09's incomparable boundary and OPP-14 "1 input missing", but from aster-start no
  rating existed and no endpoint records one; comparisons copy ratings from earlier comparisons.
- Decision: aster-start seeds the fixture comparison of OPP-07/14/09/16 (weights v1, ratings by Priya, Jonas and
  Maya, Unknown where nobody rated, OPP-09's boundary cell) without the exclusion; S04 reopens it in step 4 and
  the exclusion is Maya's act. aster-demo adds the selection and the exclusion.
- Consequences: the "new comparison has only Unknown cells" DB test now proves ratings carry over and the missing
  rating stays Unknown.

### D-094 — Pickers use the tenant directory
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: `usePeople()` (apps/web/src/lib/people.ts) reads `people.list` and offers everyone who can own work
  (a person whose only role is tenant administrator is left out); Administration names people and business units
  from `people.list` and `catalogue.scopeOptions`; the S02 geography, product and segment fields are pickers over
  `catalogue.scopeOptions` for the mandate's business unit. Owner pickers on S10 (conditions), S11 (task owners)
  and the decision package also include the directory, so the pilot owner and the operations lead can be chosen.
- Consequences: the persona directory is used only by the login page.

### D-095 — First models and plans are entered through the API in the journey (PQ-17 interim)
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: The approved design has no data-entry screen for a new case's assumption register, sizing model
  (boundary, cohorts, overlap), economics model, feasibility dimensions or pilot task list; AI-proposed drafts have
  no writers yet (CR-WS5-6). The acceptance script assumes they exist.
- Decision: The journey enters exactly this data through the real endpoints as Maya and Jonas
  (`support/journey.ts`: `assumptions.create`, `sizing.saveDraft` + commit v1, `economics.saveDraft` + commit
  v1, `cases.requestReview` for three feasibility dimensions, `pilot.saveDraft` for the six PRD tasks) — the same
  writers, policy, audit and engines as any other write. Everything the script names is done in the UI. The
  duplicate-cohort spec adds its imported cohort the same way.
- Consequences: a design-partner pilot needs either these screens or an assisted import (PQ-17, owner PM with
  design). This is the largest gap between "the workflow works" and "an operator can start a case alone".

### D-096 — A dispute emits `assumption_changed`
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: `assumptions.dispute` emits `assumption_changed {decisionCritical, origin: 'human'}` (step 9): the
  assumption's standing changed. The analytics envelope carries no statement text.

### D-097 — Finance review is requested from and signed by a named reviewer on S08
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: S08's "Request finance review" sent the request to the viewer; `economics.signFinanceReview` had no UI,
  so step 16 could not be done.
- Decision: The request form picks a finance reviewer from `people.list` (`role=finance_reviewer`) and an optional
  due date; the named reviewer signs on S08 with position, checked items, not-checked items and a statement. The
  API's own rules (named reviewer only, bound to the committed economics version) are unchanged.

### D-098 — The experiment owner may preview and send its validation tasks
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: Step 12 has Maya create the validation tasks, but `task_sync.preview/send` belonged to the pilot owner
  only, so the API refused her.
- Decision: For a validation task set only, the experiment's owner may preview, send and retry while they hold
  `experiment.edit` in the case's scope; the worker repeats the same rule at send time (`actorMayStillSend`).
  The role matrix is unchanged; pilot tasks stay the pilot owner's.

### D-099 — Screen actions the script needs and the API already had
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: "Start assessment" in the case header for the owner in Discovery (`cases.transition`, step 6);
  "Start fieldwork" on a locked experiment (`experiments.start`, which re-checks the G1 approval — results are
  recorded on a running experiment); causal limitations on the S12 recommendation form (required before a
  decision, step 26); the S12 extension form accepts the €[cap] / [duration] placeholders (PQ-2, D-071).

### D-100 — Change an assumption value on S09
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: The case owner changes a value from the register ("Change value · <assumption>", rates in %, reason
  required) through `assumptions.update` with If-Match. It is the step-19 trigger: a new immutable version, the
  materiality check, a stale package.

### D-101 — Dissent is signed by its author; proposed conditions are listed for the approver
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: The disputing reviewer can "Sign as dissent" from the S09 dispute thread (`gates.recordDissent`, the
  statement verbatim), so the next package carries it (step 17). The S10 approval panel lists the author's
  proposed conditions (snapshot `conditionsProposed`) as pre-filled conditions the approver keeps or removes
  (`ApprovalPanelView.initialConditions`, additive); kept word for word they keep their key (C1, D-073). The
  expiry date is shown with the approval.

### D-102 — A G2 request drafts its pilot plan and pre-registers the pilot thresholds
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Context: Nothing but the seed created `me.pilot_plan`, and outcome targets were only copied between snapshots,
  so from aster-start there was no pilot to activate and nothing to measure actuals against.
- Decision: `gates.createRequest` for G2 drafts the pilot plan (version 1 with the requested ceiling, window,
  scope and thresholds text) and its empty pilot task set (owner the draft version, authorizing this G2, pilot
  mapping); audit `pilot_plan.drafted`. It takes an additive optional `outcomeTargets` (G2 only, one per measure),
  stored with the request and inserted as immutable `outcome_target` rows of the first G2 snapshot; later
  snapshots copy them (thresholds never move). S10's prepare form collects them ("Pilot thresholds ·
  pre-registered"). The G3 demand clause recognizes the measure key S10 derives from the PRD name
  (`paid_use_and_continuation`).
- Consequences: PQ-12 (stop rules and milestones) stays open; PQ-20 asks whether measures need a catalogue.

### D-103 — The outcome review carries the G3 sentence
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: Additive optional `OutcomeReviewView.scaleGate.summary` carries the evaluator's one-line D-039
  sentence; S12 shows it as the disabled reason of "Request scale approval" (step 28), all four blockers.

### D-104 — A connection failure seen at preview is recorded
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: When the preview dry run gets a connection-level error (`token_expired`, unavailable), the API marks
  the connection (audited `connection.status_changed`) as the worker does on send; S11 then shows "Jira
  connection expired" with "Export CSV instead", and internal task status continues (`tasks.update`).

### D-105 — Log scrubbing
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: Request logs keep method, path and request id only — the query string is dropped (a search term can
  quote restricted text); bodies, cookies and auth headers were already never logged. The release-gate suite
  `apps/api/test/db/security/log-scrub.test.ts` plants canaries in a restricted passage and a confidential
  financial input, drives reads, searches (for the canary itself), accepted, refused and malformed writes and a
  dispute, and proves neither canary appears in the captured server log, in audit rows or in analytics rows.

### D-106 — Release-gate mapping (PRD §10, ARCHITECTURE testing strategy)

| Release gate | Suite(s) | Runs in | Result |
|---|---|---|---|
| Evidence rights | `platform/evidence/evidence.db.test.ts`, `worker jobs/analysis/gateway.db.test.ts`, evals security suites, `e2e/real/restricted-evidence.spec.ts` | test:db, evals:smoke, e2e real | pass |
| Approval bypass | `test/db/security/approval.test.ts`, `gates.db.test.ts`; journey steps 18, 29; `e2e/real/stale-approval.spec.ts` | test:db, e2e real | pass |
| Calculations vs fixtures | `packages/domain/src/me/golden.test.ts`, sizing and economics property tests; journey steps 6 and 9 | test, e2e real | pass |
| Tenant adversarial | `test/db/security/tenancy.test.ts`, per-handler cross-tenant tests, `e2e/real/cross-tenant.spec.ts` | test:db, e2e real | pass |
| No duplicate tasks under retries | `test/connector-faults/*.test.ts` (crash, timeout, concurrent retry, partial, expired token, invalidated), joint `pilot-to-simulator`; journey steps 22–24; `e2e/real/pilot-sync.spec.ts` | test:db, e2e real | pass |
| Operators complete the primary workflow | `e2e/aster-journey.spec.ts` (30 steps, real stack) | e2e real | pass (with PQ-17 setup, D-095) |
| AI-down | project `real-ai-down` (whole journey with `ANALYSIS_ENABLED=false`), `e2e/real/ai-down.spec.ts`, D-074 guard test in `analysis.db.test.ts` | e2e real, test:db | pass |
| Log scrubbing | `test/db/security/log-scrub.test.ts` (new, D-105) | test:db | pass |
| Performance p95 ≤ 2 s | `e2e/real/performance.spec.ts` (new): 20 seeded reads × 20 requests; worst p95 95 ms locally (`/me/overview`) | e2e real | pass |
| Accessibility | axe in every journey step and `e2e/real/a11y.spec.ts` (every route + admin sections) | e2e real, e2e mock | pass |

### D-107 — Fixes of note found by the real journey
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: (1) S06 edits kept the input's source (`sourceId` was sent as null, so the API refused every edit of
  an evidence input). (2) Reviews-inbox links name the gate code (`?gate=G2`) the screen reads, not the request
  id. (3) The G0 rail caption reads "Mandate · 5 Oct" (prototype). (4) "What changed" lists an assumption change
  once (name, old → new) instead of repeating it as component ids. (5) The pilot view and the task-sync API share
  one summary rule ("5 of 6 tasks confirmed in Jira · 1 failed (permission)"). (6) S11 reads the activation
  blocker keys the API sends (`all_tasks_owned`, `blocking_conditions_met`). (7) S11 keeps showing the plan's
  latest task set after a scope change, so sent tasks stay visible and unsent ones read "Paused — approval
  changed"; a scope change can state a new budget ceiling. (8) The lineage drawer always shows "Used by" (with
  an honest empty state, PQ-18) and formats history dates. (9) Snapshot versions are numbered per case: G1 is
  v1, so a fresh journey's first G2 snapshot is v2 and the refresh after step 19 is v3 (the fixture narrative's
  v3 → v4 is walked on aster-demo by the stale-approval spec; PQ-19).

### D-108 — CI and change requests of this stage
- Date: 2026-10-09 · Stage: Build · Status: Accepted
- Decision: `.github/workflows/ci.yml` (60 min) installs Chromium, runs the mock e2e, creates and migrates
  `growth_os_e2e`, runs `pnpm test:e2e:real` and uploads the reports on failure; all other steps unchanged. Additive
  contract changes accepted under D-031: `dev.clock` / `dev.setClock` (+ `DevClock`), `gates.createRequest.outcomeTargets`
  (+ `OutcomeTargetInput`), `OutcomeReviewView.scaleGate.summary`, `ApprovalPanelViewProps.initialConditions`.
  Migration 0005 (`platform.dev_clock`). Registry: 148 endpoints.

### Open product questions (new)

- **PQ-17 — Data entry for a new case.** The design has no screen to register assumptions, define the sizing model
  (boundary, cohorts, overlap), set economics drivers, add feasibility dimensions or author pilot tasks; AI drafts
  have no writers (CR-WS5-6). Interim: entered through the API (D-095). Owner: PM with design.
- **PQ-18 — "Used by" for SAM.** The engine computes SOM from the reachable pool (an operational subset of SAM,
  entered), so no figure is calculated from SAM; the script expects "used by SOM, economics". Interim: the drawer
  says honestly that no other figure uses SAM. Should the reachable pool be modelled as derived from SAM? Owner:
  PM with eng.
- **PQ-19 — Snapshot numbering.** Versions are per case (G1 v1, G2 v2…), so a fresh journey shows G2 v2/v3 where
  the narrative shows v3/v4. Interim: per case, as built. Owner: PM.
- **PQ-20 — Pilot measures.** Thresholds are typed on S10; the G3 demand clause recognizes the measure by key.
  Should measures come from a catalogue? Owner: PM.

**Updates:** PQ-13 — tasks are now drafted at G1 from the plan (D-090); editing them before sending is still
open. PQ-2 — the S12 form now submits the placeholders. PQ-11 — mapping edits still have no S14 UI; the journey
fixes the mapping through `admin.setMapping` (step 23). PQ-15 — tests assert `PIL-n` and exactly six issues.

### Release readiness summary

**Done.** All 148 registry endpoints have handlers. The web app runs on the real stack (API, worker, Postgres, MSW
off). The 30-step Aster journey passes end to end from `aster-start` with UI, API, audit, analytics and axe
assertions, with analysis on and off. Every alternate path passes on the real stack: missing data, restricted
evidence, expired connector, duplicate cohort, stale approval → v4, partial task sync with zero duplicates,
approval invalidated after activation, AI down, cross-tenant 404, every screen axe-clean. Every release-gate
suite exists and passes (D-106), including the new log-scrubbing and p95 checks.

**Full CI on `growth_os_pe` (2026-10-09).** install, typecheck, lint and format pass; unit 60 files / 2,127
tests; db:migrate; test:db 53 files / 345 tests; evals:smoke 14 suites pass; web build; API smoke OK; mock e2e 36
passed; real e2e 54 passed (journey with analysis on, alternate paths, axe, p95, and the journey again with
analysis off). No test is skipped or marked `fixme`.

**Simulated.** Jira is the simulated connector (`sim.*`, fault injection); a real Jira adapter, its auth (OAuth 3LO
or service account) and project membership checks are not built. Analysis uses the deterministic fixture
provider; a live provider needs signed data terms and a manual eval run. Dev login stands in for SSO; the dev
clock and simulator routes exist only with `AUTH_MODE=dev`.

**Before a design-partner pilot.** Close PQ-17 (or run an assisted import), decide the policy placeholders
(€[limit], €[cap], [duration], [hours per site]), add the S14 mapping editor (PQ-11), and settle hosting,
residency, SSO/SCIM, backups and a pen test (PRD §13).

| PQ | Question | Interim behaviour | Owner |
|---|---|---|---|
| PQ-1 | G3 message: two or four blockers | All four unmet preconditions (D-039, D-103) | PM |
| PQ-2 | Extension cap and duration | €[cap] / [duration] days placeholders: submittable, never approvable | PM with Finance |
| PQ-3 | Upside adoption | 30% | PM |
| PQ-4 | MD-21 v1 narrative wording | Seeded v1 = v2 minus the outreach exclusion | PM |
| PQ-5 | Sizing/economics v1 in History | History shows committed versions only | PM |
| PQ-6 | Thesis blocker wording | Next gate "Pending", later gate "Blocker" | PM |
| PQ-7 | Assumption register order | Sensitivity, then weakest evidence | PM (design) |
| PQ-8 | Restricted site-list owner | Maya Rao named; Jonas aggregate-only | PM |
| PQ-9 | SAM > TAM state | Ladder values hidden while blocked | PM (design) |
| PQ-10 | G3 note on the €400k investment | Not named in the G3 reason | PM |
| PQ-11 | Missing prototype actions (mapping editor, budget entries, …) | Mapping fixed through `admin.setMapping` | PM |
| PQ-12 | G2 stop rules and milestones | Taken from committed versions; thresholds on S10 (D-102) | PM |
| PQ-13 | Who writes validation tasks | Drafted at G1 from the plan (D-090); no editor | PM (design) |
| PQ-14 | Investment committee persona | None; tests grant the role | PM |
| PQ-15 | Retried task key | Next free `PIL-n`; exactly six issues | PM |
| PQ-16 | Two acceptances for an AI claim | Two steps (proposal → draft → accepted fact) | PM (design) |
| PQ-17 | Data entry for a new case | API entry (D-095) | PM (design) |
| PQ-18 | SAM "Used by" | Honest empty "Used by" | PM with Eng |
| PQ-19 | Snapshot numbering | Per case | PM |
| PQ-20 | Pilot measure catalogue | Free text with derived keys | PM |
| — | Approval ceilings, committees, expiry days | Policy placeholders (€[limit], 14 days) editable in S14 | Finance |
| — | Licensed intelligence rights, model provider data terms | Uploads + licence table; fixture provider | Legal |
| — | Real Jira edition and auth | Simulated connector | Eng |

**Status of these questions (2026-10-09, Head of PM).** Every PQ above and the three policy and contract items are
now decided in the stage "Product decisions — open questions resolved" below. PQ-1 → D-111 · PQ-2 → D-110 ·
PQ-3 → D-118 · PQ-4 → D-118 · PQ-5 → D-118 · PQ-6 → D-119 · PQ-7 → D-119 · PQ-8 → D-119 · PQ-9 → D-119 ·
PQ-10 → D-111 · PQ-11 → D-114 · PQ-12 → D-112 · PQ-13 → D-113 · PQ-14 → D-109 · PQ-15 → D-118 · PQ-16 → D-116 ·
PQ-17 → D-112 · PQ-18 → D-117 · PQ-19 → D-118 · PQ-20 → D-115 · Approval ceilings, committees, expiry → D-109 ·
Licensed intelligence rights and model-provider terms → D-120 · Real Jira edition and auth → D-121. The interim
behaviour in the table stays in force until each follow-up ticket lands.

---

## Stage: Product decisions — open questions resolved (2026-10-09)

The Head of Product Management decided every open product question (PQ-1 to PQ-20) and the three policy and
contract items from the release readiness summary. Each entry names the decision, why, what we rejected, the impact,
the owner and the timing. Where a real value needs a customer, Finance or Legal, the entry sets a **pilot default**
and the **exact question** to ask. None of these decisions relaxes a never-rule in `CLAUDE.md`. Contract, fixture
and policy-schema changes still go through the D-031 change-request process; the change requests these decisions
open are listed after the summary table. The stakeholder brief is `docs/market-expansion/PRODUCT_DECISIONS.md`.

### D-109 — Approval policy defaults: ceilings, the G3 committee and expiry (policy item; PQ-14)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Context: PRD §2 says the sponsor "approves investment within delegated limits"; PRD §4 gives G3 to an "authorized
  investment committee / sponsor". The PRD sets no amounts, so the fixture uses `€[limit]` (D-025) with a 250k
  placeholder grant. Every gate policy has `requiredApprovals: 1`, so a committee is not enforced. Approvals expire
  after 14 days (D-013, D-085), which is short for an enterprise pilot to assign owners, meet blocking conditions and
  set up Jira. Aster has no committee member, and tests grant Priya the role (PQ-14). UX research §4.8 and §9 S14 ask
  for a delegated-authority matrix (gate × BU × ceiling).
- Decision:
  1. **Default delegated-authority template.** Every new tenant starts with this matrix. Tenant administrators edit it
     in S14 › Authority; each edit is a new policy version with an audit event. Amounts are one-time EUR per request,
     excluding VAT. A ceiling is compared only with the one-time amount the gate requests. Recurring money is never
     added to it.

     | Gate | Sponsor (BU leader) | Investment committee | Above the committee |
     |---|---|---|---|
     | G0 Scope | Approves (no spend) | — | — |
     | G1 Validation | up to €50k | up to €250k | Authority gap |
     | G2 Pilot | up to €150k | up to €1m | Authority gap |
     | X Extension | up to €50k per request, and the parent G2 plus all its extensions ≤ the sponsor's G2 ceiling | up to €250k | Authority gap |
     | G3 Scale | none | up to €2m one-time scale budget, with the quorum below | Authority gap (board decision, outside the product) |

     The X cumulative rule stops a pilot being split into small asks. It adds one-time pilot money to one-time
     extension money of the same pilot only (never-rule 3 is about recurring and one-time money; it is not touched).
  2. **Grants come from Finance.** An administrator records each grant from a Finance-signed delegation-of-authority
     (DoA) document. A grant stores the DoA reference, the validity (12 months by default) and who entered it. An
     administrator never holds approval authority (never-rule 6). An expired grant fails closed (D-045).
  3. **G3 committee.** Three named seats: **chair** (the BU sponsor or the CSO), **finance** (the CFO or a delegated
     finance director), **operations** (the COO or the head of operations who owns delivery capacity). A G3 approval
     needs **2 of 3 approvals on the same snapshot hash, and one of them must be the finance seat**. The request ends as
     "Not approved" when quorum can no longer be reached (the finance seat records Not approved, or two seats do).
     Abstain does not count toward quorum. Excluded from any seat on that case: the package author, the case owner, the
     finance reviewer who signed this case's economics review (four eyes), and anyone with a recorded conflict. If the
     snapshot goes stale between approvals, the approvals already given lapse, and the refreshed snapshot needs fresh
     approvals (never-rule 2). The same quorum applies when a G1, G2 or X request is above the sponsor's ceiling and
     routes to the committee. The panel shows "Waiting on second approver · finance seat" (UX research §9 S10).
  4. **Expiry of unused approvals** ("used" as in D-075): G0 none; **G1 30 days**; **G2 30 days**; **X 14 days**; G3 none
     in the MVP (D-085). Thirty days fits a monthly operating cadence and still makes a cold approval go back to the
     approver. An extension continues a running pilot, so it must start quickly or be asked again.
  5. **Aster (illustrative).** Elena Fischer holds G0, G1 €50k, G2 €150k and X €50k grants (they cover €15k, €120k and
     the €30k extension of D-110). **PQ-14:** the fixture adds two synthetic committee members, Katrin Vogel (CFO,
     finance seat) and Thomas Berger (COO, operations seat), with Elena as chair. No G3 grant is seeded, so step 29
     still shows the S14 "Authority gap" honestly ("Committee named · G3 authority not granted"). Tests stop granting
     Priya the committee role.
- Alternatives considered: one approver for every gate (PRD §4 asks for a committee at G3); unanimous committee (one
  absence blocks a decision for weeks); simple majority with no required finance seat (scale money without Finance);
  per-gate ceilings with no cumulative rule (pilot splitting); keep 14 days (forces re-approval of sound pilots and
  trains users to rubber-stamp).
- Consequences: **Policy/legal action:** the customer CFO office confirms the values (question below). **Engineering
  (M):** enforce `requiredApprovals` with a required seat, lapse approvals on stale snapshots, the X cumulative check,
  per-gate expiry defaults, the DoA reference on grants. Affected: `gates.decide`, `approvalPanel()`,
  `security/approval.test.ts`, `gates.db.test.ts`, the S10 panel ("Your authority: up to €150k · BU Water"), S14
  Authority, the step-20 expiry date assertion. **Fixture CR (S):** grants, gate policies and the two personas.
  Owner: Head of PM with the customer Finance lead; Eng for the build. Timing: values, expiry and grants **before the
  pilot**; G3 quorum **during the pilot**, before the first G3 request (day 90 at the earliest).
- Pilot default and question for the customer CFO office: use the table above. Ask: "Does your delegation of
  authority let the BU leader approve up to €50k for validation, €150k for a pilot and €50k for an extension, with a
  three-seat committee (chair, finance, operations; 2 of 3 including finance) for scale up to €2m? Who sits on each
  seat for the pilot BU, and is 30 days the right life for an unused pilot approval?"

### D-110 — Extension cap, duration and the extension rule (PQ-2; placeholders)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Context: PRD §6: "Sponsor authorizes a scoped extension with its own spend cap". The PRD sets no amount or duration,
  so X1 carries `€[cap]` / `[duration] days`: submittable, never approvable (D-040, D-071). The deployment-effort
  threshold also carries `[hours per site]` (D-025).
- Decision:
  1. **Rule for every case.** An extension asks for **at most 25% of the parent G2 approved budget** and **at most 50% of
     the parent pilot window** (at least 14 days). There is **one extension per parent G2**. Its scope is a subset of the
     parent scope: the same or fewer sites, the same geography, segment and product, no new sites and no prospect
     outreach. It names the unmet or inconclusive thresholds it will re-test, and those thresholds are pre-registered
     with the request. A bigger ask or a second extension is a new G2 with a full package and finance review. The
     sponsor approves within the X ceiling and the cumulative rule of D-109.
  2. **Aster X1 (illustrative): €30k · 45 days**, 1 Mar – 14 Apr 2027, owner Jonas Klein, scope "the 4 pilot sites
     only". It re-tests paid use and continuation (4 of 4) and deployment effort per site, and gives time to complete
     the specialist scale-readiness review. The button reads "Approve extension €30k · 45 days". Elena can approve it
     (€120k + €30k = €150k, her G2 ceiling).
  3. **Placeholders.** In an illustrative tenant a null cap stays a submittable, never-approvable placeholder (training
     use). In a real tenant a null cap or duration is refused at request ("State the extension cap and duration"). Zero
     is never a placeholder (D-071).
  4. **`[hours per site]` (Aster, illustrative):** assumed 16 installation and support hours per site; actual 22 hours
     per site → Not met. In real cases the deployment-effort threshold needs a number and a unit.
- Rationale: discovery-driven planning releases money in tranches as assumptions are tested (UX research §1, item 1). An
  extension buys answers to named open questions on existing sites; it is not a smaller scale decision. A quarter of
  the pilot budget covers continued support and the extra deployment effort on four installed sites with no new
  hardware rollout. It stays visibly smaller than a new pilot. Forty-five days covers one monthly billing cycle and the
  fourth customer's continuation decision, and it sets a hard date so the case cannot drift (PRD §1 "bounded period").
  Both sides of the share are one-time pilot money (never-rule 3 holds).
- Alternatives considered: a fixed euro cap for every tenant (does not scale with pilot size); 50% of budget (reads as a
  second pilot); no duration cap (open-ended pilots); let the sponsor choose freely (no guard against splitting).
- Consequences: **Engineering (M):** X preconditions check share, duration, one per parent and scope subset; a null
  cap is refused in real tenants; the S12 form shows the limits ("Up to €30k (25% of €120k) · up to 45 days"). **Fixture
  CR (S):** X1 values and the hours. The e2e step 27 assertion changes from `€[cap]` to €30k · 45 days; X1 stays
  "Awaiting decision" in the journey and is now approvable. Owner: Head of PM; Finance confirms the 25% share; Eng.
  Timing: **before the pilot**.
- Question for the customer Finance lead: "Can the BU sponsor approve one extension of up to 25% of an approved pilot
  budget and up to half its duration, inside the sponsor's pilot ceiling, or must every extension go back to the
  committee?"

### D-111 — The G3 message lists all four blockers and names the one-time scale investment (PQ-1, PQ-10)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Context: The fixture and prototype show two G3 blockers; with honest step-28 facts four are unmet (D-039). The
  prototype's G3 note mentions the "€400k one-time scale-entry investment", but no view carries it (PQ-10).
- Decision: Keep all four unmet preconditions, in the D-039 order (demand, specialist, economics and capacity, scale
  budget). D-039 is final. The fourth blocker names the committed one-time figure: "No scale budget requested ·
  economics v2 carries €400k one-time scale-entry investment". It is labelled one-time, never next to a /year figure
  in the same sentence, and it is omitted when the viewer cannot read the committed economics. UX research §6.14
  ("2 preconditions unmet") is superseded for the product; the frozen fixture keeps its two `blockedBy` entries as the
  first two blockers.
- Rationale: hiding two blockers would tell the sponsor the case is closer to scale than it is (PRD §3 honest no-go;
  UX research §6.14). Naming the investment answers the approver's first question, "how much would scale cost?",
  without inviting a sum with recurring contribution.
- Alternatives considered: two blockers with a seeded scale budget and refreshed economics (dishonest data); a total
  "cost to scale" figure (would mix time bases).
- Consequences: PQ-1 keeps the current interim. PQ-10 is an **engineering change (S)**: the G3 precondition summary
  reads the committed economics' one-time investment; `OutcomeReviewView.scaleGate.summary`, S12, `gates.db.test.ts`
  step 28 and the journey step-28 text change. Owner: Eng. Timing: **during the pilot**, before day 90.

### D-112 — Data entry for a new case, and where milestones and stop rules live (PQ-17, PQ-12)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Context: An operator cannot start a case alone: there is no screen to register assumptions, build the sizing model,
  set economics drivers, add feasibility dimensions or write pilot tasks. The journey enters them through the API
  (D-095). The S10 prepare form does not collect stop rules or milestones (PQ-12).
- Decision: Build **five minimal editors** on the existing endpoints before the pilot. There is no assisted import:
  data written for a customer by someone else would carry the wrong author in audit. Each editor autosaves a draft
  with If-Match and commits an immutable version (CLAUDE.md "Versions").
  1. **S09 Add assumption:** statement; value and unit; owner; confidence basis (Evidence link or "Assumption — no
     evidence"); decision sensitivity (High · Medium · Low); decision-critical yes/no; validation method; due date.
  2. **S06 Sizing draft editor:** market unit, currency, reference year, product boundary text, what the spend
     includes (hardware · software · services · replacement); TAM site count and annual spend per site; cohort rows
     (name, site count, rule, source); overlap row (count, dedup rule); reachable pool (site count, channel
     definition, source); adoption, horizon and capacity as links to assumptions. Each input is Evidence or
     Assumption; a blank stays Unknown, never 0.
  3. **S08 Economics driver editor:** price per year, gross margin %, annual incremental opex with a scope note,
     capacity, adoption per scenario; and, in a separate block, one-time investment. Currency and base year once in the
     header. Cash flow and payback stay "Not available" (D-030).
  4. **S07 Add dimension / Request review:** dimension (fixed list from PRD S07), named reviewer, due date, the
     question and the scope of review. AI may draft the question, never the answer.
  5. **S11 Pilot plan editor:** tasks (title, owner, dependency, due date, deliverable, optional budget line) and
     milestones (name, date, evidence expected). Milestones live in the pilot plan version and reach G2 through it.
  - **PQ-12 stop rules:** the S10 G2 prepare form gets a structured "Stop rules · pre-registered" list next to
    "Pilot thresholds · pre-registered" (D-102). Fields: trigger (a measure and threshold, or an event), consequence
    ("Pause tasks and request a sponsor review" or "Recommend stop"), owner. They are stored with the request,
    inserted into the first G2 snapshot and copied forward like thresholds; they never move silently (never-rule 12).
    `budget_and_stop_rules` needs at least one. A tripped stop rule creates a review item for the sponsor; it never
    stops a case or passes a gate by itself (never-rule 7).
- Alternatives considered: assisted import by customer success (wrong author, no review); a spreadsheet upload first
  (needs a mapping UI and validation as large as the editors); wait for AI-drafted models (CR-WS5-6; AI output is not
  a fact until accepted, so the editors are needed anyway).
- Consequences: **Engineering (L)**, split into five tickets (S06 M, S08 M, S09 S, S07 S, S11 M) plus stop rules (S,
  additive `stopRules` on `gates.createRequest`, CR). The journey drops `support/journey.ts` API entry for these steps
  and walks them in the UI; D-095 is retired when all five land. Owner: Head of PM with design (field specs), Eng.
  Timing: **before the pilot**. This is the pilot entry criterion: "an operator can start a case alone".

### D-113 — Validation tasks: a draft task editor on S09 (PQ-13)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Context: G1 drafts five validation tasks from the locked plan (D-090), but nobody can edit them before they are sent.
- Decision: S09's experiment card gets a **"Validation tasks · Draft"** section after G1 approval. The experiment owner
  and the case owner can edit title, owner (directory picker), due date (inside the experiment window) and deliverable;
  add a task; or remove an unsent draft task. Tasks never carry threshold, sample or budget: those change only by an
  amendment with a reason (D-086). Draft edits are not material, because G1 authorizes the experiment and its budget,
  not task wording; each edit is audited (`task.updated`). A sent task is read-only here and shows its external key. A
  task added after sending is unsent until it is previewed and sent. "Preview tasks" stays the step before sending
  (D-098).
- Alternatives considered: tasks inside the experiment plan (makes wording edits look like amendments and needs a
  second editor); no edits (derived titles do not match how teams brief fieldwork).
- Consequences: **Engineering (M):** additive draft-task endpoints (add, update, remove on an unsent validation task
  set; CR), the S09 section, DB tests with a cross-tenant and an unauthorized-role attempt. Owner: Head of PM with
  design; Eng. Timing: **before the pilot**.

### D-114 — Missing prototype actions: which ship for the pilot (PQ-11)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Decision:
  1. **S14 Task mapping editor — before the pilot (S).** S14 › Connections › Jira row › "Task mapping", with one tab for
     Validation tasks and one for Pilot tasks. Fields: destination project, issue type, and an assignee table (person ·
     role · Jira account · Mapped / Unmapped / Not found). "Check with Jira" runs a dry lookup; Save writes
     `admin.setMapping`. Changing project or issue type on a mapping used by an approved, unsent task set is a
     `plan_destination_changed` (material by default): the dialog shows the impact ("Approval G2 v3 needs re-approval ·
     unsent tasks pause") before saving. Assignee edits are not material.
  2. **S11 Record spend — before the pilot (S).** Under the budget meter: kind (Committed · Spent), amount (EUR,
     one-time), date, description, reference (PO or invoice number), optional task link. Entries are append-only; a
     correction is a reversing entry with a reason. Spend above the remaining approved amount is refused with "Request
     scope change" (UX research §7.3). Spending starts at activation, so the pilot needs it.
  3. **S02 "Suggested adjacent segments · AI draft" — post-pilot.** No data source and no writer (CR-WS5-6).
  4. **S04 "Request normalization" — post-pilot.** The blocking message already names what differs; the operator edits
     the candidate boundary.
- Alternatives considered: ship all four (two have no data source); ship none (the journey edits the mapping through
  the API, and Jonas cannot record spend).
- Consequences: Engineering S + S; the journey step 23 uses the S14 editor. Owner: Head of PM; Eng. Timing as above.

### D-115 — Pilot measures: a short list of measure types, not a catalogue (PQ-20)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Context: Thresholds are free text on S10; the G3 demand clause recognizes the measure by a key derived from its name.
- Decision: Each pre-registered threshold picks a **measure type**: Demand (paid use and continuation), Delivery effort
  (per site), Buyer fit (qualitative), Spend against budget, or Other. Required fields: measure type, name, operator and
  target with unit (or "Qualitative"), measurement window, data source. The G3 demand clause reads the Demand type,
  not the name. A tenant-managed catalogue waits until partners show repeated measures.
- Alternatives considered: a tenant catalogue now (admin work before any data); keep free text (a renamed measure
  silently drops out of the G3 check).
- Consequences: **Engineering (S):** additive `measureType` on `OutcomeTargetInput` (CR), S10 form, G3 precondition
  test. Owner: Head of PM; Eng. Timing: **during the pilot**, before the partner's first G2.

### D-116 — One action to accept an AI claim as fact, when it is unedited and cited (PQ-16)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Context: Accepting a claim proposal creates an AI draft claim; a person then accepts it as fact (D-076). Two clicks
  for the same intent.
- Decision: S05 offers **"Accept as fact"** on a proposal when it is unedited and every evidence citation opens for the
  viewer. One human act runs both steps in one transaction and writes both audit events. The confirm dialog shows the
  claim, its kind and its citations. When the person edits the text, or a citation is missing, only "Add as draft" is
  offered and acceptance stays a second step. Uncited evidence still becomes Unknown (D-088).
- Rationale: never-rule 11 needs a human acceptance, not two. The explicit label and the citation check keep the act
  deliberate (UX research §4.5: "Fits asserted by AI" erodes trust).
- Alternatives considered: keep two steps (friction with no trust gain for cited claims); one step always (would
  accept uncited text).
- Consequences: **Engineering (S):** additive `acceptAsFact` on `analysis.decideProposal` (CR), S05, the WS5 claim test.
  Owner: design; Eng. Timing: **during the pilot**.

### D-117 — "Used by" for SAM: keep the reachable pool entered, add an upper-bound check (PQ-18)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Decision: The reachable pool stays an entered number: PRD §6 defines it by channel and service coverage, not as a
  share of SAM. The engine adds a check that the reachable pool is no more than SAM sites; a breach blocks like SAM >
  TAM. Lineage records the check, so SAM's drawer reads "Used by: Reachable pool (upper-bound check: 500 ≤ 2,000
  sites)". The acceptance script's "used by SOM, economics" is corrected to the honest chain.
- Alternatives considered: derive the pool as SAM × coverage % (invents a precision the PRD does not have); keep the
  empty "Used by" (true, but hides a real dependency).
- Consequences: **Engineering (S):** sizing check, lineage edge kind "checked against", golden test. Owner: Eng.
  Timing: **during the pilot**.

### D-118 — Aster narrative and demo data confirmations (PQ-3, PQ-4, PQ-5, PQ-15, PQ-19)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Decision:
  - **PQ-3:** upside adoption 30% is confirmed for Aster (D-041). It stays an Assumption. Real tenants enter their own;
    there is no product default. Keep current interim.
  - **PQ-4:** MD-21 v1 reads "Returned to change the owner and confirm EUR". Copy change in the fixture narrative
    (fixture CR, S). Before the pilot (the demo tenant is used in onboarding).
  - **PQ-5:** History shows committed versions only; no sizing or economics v1 in the demo. Keep current interim;
    revisit post-pilot if partners ask for version compare.
  - **PQ-15:** the narrative changes, not the keys. A retried task takes the next free key ("PIL-17"), because Jira
    cannot reserve keys and we never report a key the connector did not return (never-rule 9). Docs and fixture
    narrative copy only. Before the pilot.
  - **PQ-19:** snapshot versions stay numbered per case. Every label pairs the gate with the version ("G2 · Snapshot
    v2") so per-case numbers never read as per-gate. Narrative updated to v2/v3 for a fresh journey (aster-demo keeps
    v3 → v4). Copy change (S). Before the pilot.
- Alternatives considered: per-gate numbering (three different "v1"s on one case); reserving Jira keys (not possible).
- Owner: Head of PM; Eng for the fixture copy.

### D-119 — Display confirmations (PQ-6, PQ-7, PQ-8, PQ-9)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Decision:
  - **PQ-6:** keep the server rule (D-081) and put the gate in the label: **"Pending · G2"** means needed for the next
    gate and in progress; **"Blocker · G3"** means unresolved for a later gate and does not stop the next one. A
    tooltip defines both. Copy change (S). Before the pilot.
  - **PQ-7:** keep sensitivity first, then weakest evidence (D-067). Design updates the prototype and tests H9 in the
    pilot usability sessions. Keep current interim.
  - **PQ-8:** Maya Rao is the data owner of the restricted site list; Jonas Klein sees aggregates only. A data owner
    must be able to see the data they answer for. Design fixes the prototype. Keep current interim.
  - **PQ-9:** keep hiding ladder values while a blocking check is open (D-066). The ledger keeps the two conflicting
    inputs visible and editable, so the user can fix them. Design updates the prototype. Keep current interim.
- Owner: design (PQ-6 copy with Eng). Timing: before the pilot (PQ-7 test during the pilot).

### D-120 — Licensed intelligence rights and model-provider data terms (policy and contract item)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Context: PRD §3, §13 and §14: intelligence rights and API availability are unknown; source licensing applies to
  ingestion, display, embeddings, model context and exports. The licence table already carries
  `maxExcerptSentences`, `allowModelContext`, `allowEmbeddings` and `allowExport`. Analysis runs on the fixture
  provider; a live provider needs signed terms (BUILD_PLAN §9).
- Decision:
  1. **Evidence for the pilot** comes from customer uploads and the customer's existing intelligence subscriptions. We
     build no licensed-intelligence API adapter until rights and an API are confirmed in writing.
  2. **Fail closed.** A licence with no written confirmation defaults to: metadata only, 0 excerpt sentences, no model
     context, no embeddings, no export. Each licence row adds a term end date and an on-expiry action (remove excerpts
     and embeddings, keep provenance metadata for audit; PRD S13).
  3. **Minimum terms before any live AI provider** for a tenant. All must be in signed documents:
     - a data processing agreement (GDPR Art. 28) with a named sub-processor list and change notice;
     - no training or fine-tuning on customer inputs or outputs;
     - zero data retention, or retention of 30 days or less for abuse monitoring only, with deletion after;
     - processing in the EU, or an approved transfer mechanism (SCCs) with a transfer impact assessment;
     - an independent security attestation (SOC 2 Type II or ISO 27001) and breach notice within 72 hours;
     - customer ownership of inputs and outputs; no provider claim on them;
     - for each licensed source the tenant uses with AI, the licence permits processing by a third-party AI service
       under these terms (`allowModelContext` is set only then).
  4. **Enablement.** Live analysis is off per tenant by default. A tenant administrator turns it on only after the
     signed addendum is recorded (document reference and date), and only after a manual eval run passes on that
     provider. Enabling is audited. The model name stays configuration (`ANALYSIS_MODEL`).
- Alternatives considered: live provider in the pilot under standard consumer terms (fails PRD §13); block AI for the
  whole pilot (the AI-down journey works, but we would learn nothing about the bounded agent).
- Consequences: **Policy/legal action** (Legal drafts the addendum; the customer confirms source rights). **Engineering
  (M):** licence term end and on-expiry action (CR), a tenant "Live analysis" setting with document reference (CR),
  S14 display. Owner: Legal with the Head of PM; Eng. Timing: fail-closed defaults **before the pilot**; live provider
  **during the pilot**, only when the terms are signed.
- Pilot default: fixture provider; uploads with fail-closed licences. Questions:
  - To Legal: "Will our model provider sign a DPA with no training, zero (or ≤ 30-day abuse-only) retention, EU
    processing or SCCs, SOC 2 Type II or ISO 27001, and 72-hour breach notice? Who signs the customer addendum?"
  - To the customer's licence owner: "For each intelligence source you will use, does your licence allow us to (a)
    store a copy in your tenant, (b) show excerpts of up to N sentences to licensed users, (c) index or embed it, (d)
    send excerpts to an AI provider under these terms, (e) include derived figures in exports? When does it end, and
    what must be deleted then?"

### D-121 — First task connector: Jira Cloud with OAuth 2.0 (3LO) as a dedicated integration user (policy and contract item)
- Date: 2026-10-09 · Stage: Product decisions · Status: Accepted (Head of PM)
- Context: The connector is simulated (D-020, D-084). The edition and auth were open (BUILD_PLAN §9).
- Decision:
  1. **Edition:** Jira Cloud only for the pilot. Data Center waits for a customer that needs it.
  2. **Auth:** OAuth 2.0 (3LO). The customer's Jira admin creates a **dedicated integration account** ("Growth OS
     integration") and authorizes our app as that account. Scopes: read and write Jira work, read users, offline access
     (refresh tokens). The account gets Browse, Create and Assign only in the mapped projects. Tokens are stored
     encrypted; an expired or revoked token shows "Jira connection expired" (D-104).
  3. **Attribution:** Jira shows the integration account as reporter. Each issue body states the case, the approving
     gate and snapshot ("ME-104 · approved under G2 · Snapshot v3"), and who requested the send. Authorization stays
     ours: the send-time re-check (never-rule 10) decides, not Jira permissions.
  4. **Idempotency:** our key is written as a Jira issue entity property at create; reconcile searches the mapped
     project by that property before any retry (never-rule 9). "Confirmed · PIL-n" only after Jira returns the key.
  5. **Data we keep:** issue key, URL and status only. We read nothing outside the mapped projects.
- Alternatives considered: personal API tokens (tied to one person, broad scope, break when they leave); per-user 3LO
  (good attribution, but retries fail when one user's token lapses and a send could run as someone who lost access);
  a Forge app first (more review work before we know the pilot needs it).
- Consequences: **Engineering (L):** Jira Cloud adapter behind `TaskConnector`, OAuth flow and token storage, entity
  property idempotency, reconcile search, a sandbox fault suite matching `connector-faults/*`. **Customer action:**
  the Jira admin installs the app and creates the account. Owner: Eng with the customer IT lead; Head of PM. Timing:
  **before the pilot**; CSV export stays the outage fallback (PRD §10).
- Pilot default: Jira Cloud, 3LO as an integration account. Question for the customer IT lead: "Do you run Jira Cloud?
  Will your Jira admin install our OAuth app and create an integration account with Browse, Create and Assign in the
  pilot projects only? Which project keys and issue types should validation and pilot tasks use?"

### Product decision summary

| PQ | Decision (short) | Impact | Owner | Timing | Follow-up ticket title |
|---|---|---|---|---|---|
| PQ-1 | Four G3 blockers stay; D-039 final (D-111) | Keep current interim | Head of PM | Before pilot | — |
| PQ-2 | Extension ≤ 25% of parent budget, ≤ 50% of window, one per G2; Aster X1 €30k · 45 days (D-110) | Engineering M + fixture CR | Head of PM, Finance, Eng | Before pilot | Enforce the extension rule and real extension caps |
| PQ-3 | 30% upside adoption confirmed for Aster (D-118) | Keep current interim | Head of PM | Before pilot | — |
| PQ-4 | "Returned to change the owner and confirm EUR" (D-118) | Copy change | Head of PM, Eng | Before pilot | Fixture narrative copy fixes |
| PQ-5 | History shows committed versions only (D-118) | Keep current interim | Head of PM | Post-pilot review | — |
| PQ-6 | "Pending · G2" / "Blocker · G3" with tooltip (D-119) | Copy change (S) | Design, Eng | Before pilot | Thesis blocker labels name the gate |
| PQ-7 | Sensitivity, then weakest evidence; test H9 (D-119) | Keep current interim | Design | During pilot | — |
| PQ-8 | Maya owns the restricted site list (D-119) | Keep current interim | Design | Before pilot | — |
| PQ-9 | Hide ladder values while blocked; inputs stay editable (D-119) | Keep current interim | Design | Before pilot | — |
| PQ-10 | G3 blocker names €400k one-time scale investment (D-111) | Engineering S | Eng | During pilot | G3 blocker names the one-time scale investment |
| PQ-11 | Mapping editor and Record spend now; AI segments and normalization later (D-114) | Engineering S + S | Head of PM, Eng | Before pilot / post-pilot | S14 task mapping editor; S11 record spend form |
| PQ-12 | Milestones in pilot plan; structured stop rules on S10 (D-112) | Engineering S | Head of PM, Eng | Before pilot | Pre-registered stop rules on the G2 request |
| PQ-13 | Draft validation task editor on S09 (D-113) | Engineering M | Head of PM, design, Eng | Before pilot | S09 validation task draft editor |
| PQ-14 | Committee personas added; no G3 grant in demo (D-109) | Fixture CR (S) | Head of PM | During pilot | Aster policy values and committee personas |
| PQ-15 | Narrative uses the next free key (D-118) | Copy change | Head of PM | Before pilot | Fixture narrative copy fixes |
| PQ-16 | One "Accept as fact" when unedited and cited (D-116) | Engineering S | Design, Eng | During pilot | One-step accept for cited AI claims |
| PQ-17 | Five minimal editors; no assisted import (D-112) | Engineering L | Head of PM, design, Eng | Before pilot | Case data-entry editors (S06, S08, S09, S07, S11) |
| PQ-18 | Reachable pool stays entered; ≤ SAM check in lineage (D-117) | Engineering S | Eng | During pilot | Reachable pool upper-bound check |
| PQ-19 | Per-case numbering; labels pair gate and version (D-118) | Copy change (S) | Head of PM | Before pilot | Gate + version snapshot labels |
| PQ-20 | Measure types; G3 reads Demand type (D-115) | Engineering S | Head of PM, Eng | During pilot (before first G2) | Outcome measure types |
| Policy | Ceilings, G3 committee 2 of 3 with finance, expiry 30/30/14 (D-109) | Policy action + Engineering M | Head of PM, customer Finance, Eng | Before pilot (quorum during) | G3 committee quorum and approval policy defaults |
| Rights | Fail-closed licences; minimum provider terms; tenant opt-in (D-120) | Legal action + Engineering M | Legal, Head of PM, Eng | Before pilot / during pilot | Licence term end and live-analysis enablement |
| Jira | Jira Cloud, OAuth 3LO as integration account (D-121) | Engineering L + customer action | Eng, customer IT | Before pilot | Jira Cloud adapter |

**Change requests these decisions open (D-031, Proposed, for the Principal Architect):** CR-PD-1 `GatePolicyBody`
required seats and X limits (share, duration share, one per parent); CR-PD-2 `AuthorityGrant.doaReference`; CR-PD-3
Aster fixture values (grants, expiry, X1 €30k · 45 days, 16/22 hours per site, committee personas, narrative copy);
CR-PD-4 `OutcomeTargetInput.measureType`; CR-PD-5 `stopRules` on `gates.createRequest`; CR-PD-6 draft validation task
endpoints; CR-PD-7 `License` term end and on-expiry action; CR-PD-8 tenant live-analysis setting; CR-PD-9
`acceptAsFact` on `analysis.decideProposal`. All are additive.
