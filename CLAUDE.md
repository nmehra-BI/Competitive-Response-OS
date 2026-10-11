# CLAUDE.md — Growth OS · Market Expansion OS

Guidance for engineers and coding agents working in this repository. Read this first, then the docs it
points to. The architecture is **frozen** (decisions.md D-031): contracts change only through a change
request.

## What this is

Market Expansion OS is the first app on Growth OS: a workflow product that takes an expansion case from
mandate to evidence, validation, an approved pilot, execution and an outcome review. The unit of work is
an **expansion case**, not a report or a chat. All Aster Industrial Systems data is synthetic.

## Where things are

| Need | Go to |
|---|---|
| Product truth | `docs/market-expansion/PRD.md` |
| Labels, status grammars, number rules | `docs/market-expansion/design/UX_RESEARCH.md` §6–§10 |
| Approved screens | `design/market-expansion/prototype/*.dc.html` (generator in `design/market-expansion/generator/`) |
| Architecture | `docs/market-expansion/architecture/ARCHITECTURE.md` |
| Tables, RLS, guards | `docs/market-expansion/architecture/DATA_MODEL.md`, `packages/db/migrations/0001_init.sql` |
| Endpoints | `docs/market-expansion/architecture/API.md`, `packages/contracts/src/api/*` |
| Frontend | `docs/market-expansion/architecture/FRONTEND.md`, `apps/web/src/app/routes.ts` |
| Who builds what, milestones, acceptance script | `docs/market-expansion/architecture/BUILD_PLAN.md` |
| Why we decided things | `decisions.md` (append-only ADR log) |
| Key workflows with diagrams | `artifacts.md` (`WF-01`…) |

## Layout

```
apps/web          React SPA (Vite, React Router, TanStack Query)
apps/api          Fastify API; registers every endpoint in @growth-os/contracts
apps/worker       graphile-worker jobs: outbox, analysis runs, timers, ingestion, analytics
packages/contracts FROZEN Zod schemas: entities, enums + labels, engine IO, API registry, events
packages/domain   pure logic: state machines, policy, materiality, snapshot hashing, engines
packages/db       SQL migrations (RLS, guards), migration runner, withTenant(), generated types
packages/ai       bounded agent: provider adapter, tool gateway, harness (no write paths)
packages/connectors TaskConnector + simulated Jira with fault injection
packages/ui       tokens.css, number formatting rules, component prop contracts
fixtures/aster    canonical synthetic data and golden expectations (PRD §6)
skills/           10 skill bundles (skill.yaml, instructions, fixtures, evals)
evals/            evaluation suites and runner
```

Each package separates Growth OS shared primitives (`platform/`) from Market Expansion (`me/`). The
database mirrors this with schemas `platform`, `me` and `sim`.

## Commands

```bash
pnpm install                 # Node 22, pnpm 10
pnpm db:up                   # start local PostgreSQL 16 (cluster 16/main), create roles + database
pnpm db:migrate              # apply packages/db/migrations as me_owner
pnpm db:seed [aster-start|aster-demo]   # load fixtures/aster (WS1 implements)
pnpm db:codegen              # regenerate packages/db/src/generated/db.ts after a migration
pnpm db:reset                # dev only: drop schemas, migrate, seed
pnpm dev                     # api (4000) + worker + web (5173, proxies /api)
pnpm lint                    # ESLint incl. module-boundary rules
pnpm typecheck               # tsc in every workspace
pnpm test                    # unit tests (no database)
pnpm test:db                 # database guards, API integration, connector faults (needs db:up + db:migrate)
pnpm test:e2e                # Playwright journey, variants, a11y
pnpm evals:smoke             # eval suites with the deterministic fixture provider
pnpm format                  # Prettier
```

Environment: copy `.env.example` to `.env`. Defaults work locally: `AUTH_MODE=dev` (persona picker),
`ANALYSIS_PROVIDER=fixture`, `TASK_CONNECTOR=simulated`.

## Conventions

- **Contracts first.** Import schemas and types from `@growth-os/contracts`. Never redefine an enum, a
  label or a response shape locally. Render labels from the `*_LABELS` maps.
- **Every write** goes through the command pipeline inside `withTenant()`: validate → policy check →
  domain decision → write state + `audit_event` + analytics event + outbox rows in one transaction.
- **Money and rates** are decimal strings in JSON and `numeric` in Postgres; compute with decimal.js in
  `packages/domain`; display only with `packages/ui/src/format`.
- **Versions:** edit drafts; commit creates an immutable version. Never update a committed row (the
  database refuses).
- **Migrations are append-only.** Add `0002_*.sql`; never edit `0001_init.sql`. Regenerate types.
- **IDs:** UUIDs internally; display keys (`ME-104`, `OPP-07`, `SRC-014`) in URLs and UI.
- **Tests:** each handler test includes a cross-tenant attempt and an unauthorized-role attempt; each
  state change asserts its audit and analytics event.
- **Copy:** use the research label vocabulary exactly ("Approve pilot €120k · 90 days", "Return for
  revision", "Not met", "Confirmed · PIL-11", "Stopped — your work is saved"). Infrastructure words
  (agent, MCP, harness, tokens) only in Administration › Diagnostics.
- **Model names** are configuration (`ANALYSIS_MODEL`). Never write a model identifier in code, comments,
  docs or commit messages.
- **Commits:** small, logical, imperative subject. Do not commit `node_modules`, build output, `.env` or
  `__pycache__`.

## Never rules (release blockers)

1. **The agent never approves, decides, signs or records outcomes.** It has no write tools; it produces
   proposals. Agent and service identities are refused by the API and by the database.
2. **Approvals are bound to a snapshot hash.** A decision references `(snapshot_id, snapshot_hash)` of
   the current snapshot. Never approve, execute or display as approved anything that differs from what
   the approver read. Stale snapshots cannot be approved.
3. **Revenue and one-time money are never summed**, subtracted or compared. Recurring (`/year`) and
   one-time measures stay separate in engines, APIs, UI and exports. Cash flow and payback stay
   "Not available" in the MVP.
4. **Market measures are never totalled** across cases or added up the ladder (TAM, SAM, reachable pool,
   SOM are different questions). No "total opportunity".
5. **Missing is never zero.** Show "Unknown" or "Not available — reason". A true zero shows "€0k
   (break-even)".
6. **No self-approval, no admin approval.** The package author and the case owner cannot approve their
   own gate; tenant admins configure but never approve; task ownership never grants approval.
7. **Task completion never passes a gate.** Gates move only by an authorized human decision on a snapshot.
8. **Restricted content never leaks** — no excerpt, summary, paraphrase, search hit, export, model context
   or count of hidden items. Hidden resources return 404.
9. **"Confirmed" requires an external key.** Never report sync success before the connector returns it.
   Retries reuse the same idempotency key and only resend failed tasks; ambiguous timeouts reconcile first.
10. **Re-check authorization at send time.** An invalidated or expired approval pauses unsent external
    writes.
11. **AI output is never a fact until a human accepts it**, and regeneration never overwrites human edits.
12. **Pre-registered thresholds never move silently.** Changes are amendments with a reason; the original
    and every result stay visible.
13. **Audit is append-only.** Never update or delete audit, approvals, snapshots content or result
    versions.
14. **Never send prospect communications.** Message drafts stay drafts; there is no send endpoint.
15. **Never bypass RLS.** App roles are `NOBYPASSRLS`; all queries run inside `withTenant()`.

## When something is unclear

Check the PRD, then the UX research, then the prototype, then `decisions.md`. If a contract seems wrong,
do not work around it: open a change request entry in `decisions.md` (see D-031) and flag it to the
Principal Architect.
