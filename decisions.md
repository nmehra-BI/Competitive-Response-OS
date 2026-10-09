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
