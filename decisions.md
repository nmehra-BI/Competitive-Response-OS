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

