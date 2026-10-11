# Deployment — Vercel and Supabase

How the demo deployment of Market Expansion OS runs on Vercel (web, API, jobs) with Supabase Postgres
(system of record). Decisions: `decisions.md` D-160 … D-168. Workflow: `artifacts.md` WF-11.

All data in this deployment is the synthetic Aster tenant (illustrative). The deployment is behind
Vercel Authentication: only members of the owning Vercel team can open it.

## 1. Architecture

```
Browser ──HTTPS──▶ Vercel edge (Vercel Authentication, security headers, CSP)
                    ├── /assets/*, /index.html   static SPA (apps/web, Vite build)
                    ├── /api/v1/*                one Node 22 function (apps/vercel/src/handler.ts)
                    │                            = the Fastify app, every registry endpoint
                    ├── /api/internal/health     liveness + SELECT 1
                    └── /api/internal/jobs/run   bounded job drain (Bearer CRON_SECRET)
                                 │
            ┌────────────────────┴───────────────────────┐
            ▼ transaction pooler :6543 (me_app)          ▼ session pooler :5432 (me_worker, me_owner)
      Supabase Postgres 17 · schemas platform, me, sim, graphile_worker · RLS on, NOBYPASSRLS roles
```

- **One function** (Build Output API v3, `.vercel/output/functions/api.func`, region `sin1`, close to
  the database in ap-southeast-1). It is an esbuild bundle of the existing Fastify app; one app and one
  small pool (max 3) per warm instance. The SPA is static output with an `index.html` fallback.
- **Database roles** are the same three as locally (`me_owner` migrations, `me_app` API, `me_worker`
  jobs), all `NOSUPERUSER NOBYPASSRLS`. The API uses the **transaction pooler**: `withTenant()` sets
  `app.tenant_id` etc. with `set_config(…, true)` (transaction-local), no session `SET`, no
  `LISTEN`, no prepared statements. Jobs and migrations use the **session pooler**.
- **Pooler host:** `aws-0-ap-southeast-1.pooler.supabase.com`, user names `<role>.eqtqayemckaaatvajbez`.
  The cluster index cannot be derived from the region: a build against `aws-1-…` failed with
  "tenant/user me_owner.eqtqayemckaaatvajbez not found"; `aws-0-…` works. The Supabase dashboard
  (Connect) shows the host for a project.
- **TLS:** `DATABASE_SSL=require` (encrypted; chain not verified). For full verification set
  `DATABASE_SSL=verify` and `DATABASE_CA_CERT` to the Supabase CA (dashboard › Database › SSL).

## 2. Environment variables (names only)

Set in Vercel (project `market-expansion-os`) as **sensitive** for Production and Preview.

| Name | Purpose |
|---|---|
| `DATABASE_URL` | `me_app` via the transaction pooler (port 6543) |
| `DATABASE_WORKER_URL` | `me_worker` via the session pooler (port 5432) |
| `DATABASE_OWNER_URL` | `me_owner` via the session pooler (build only: migrations and seed) |
| `DATABASE_SSL` | `require` (or `verify` with `DATABASE_CA_CERT`) |
| `AUTH_MODE` | `dev` (persona picker) — only effective with `DEMO_MODE=1` on Vercel |
| `DEMO_MODE` | `1`: allows dev login, dev clock and simulator routes on a hosted runtime (illustrative tenants only) |
| `SESSION_SECRET` | reserved session secret (sessions are random tokens hashed in the database) |
| `CRON_SECRET` | Bearer token for `/api/internal/jobs/run`; Vercel Cron sends it automatically |
| `CONNECTOR_TOKEN_KEY` | AES-256-GCM key for stored connector tokens (base64, 32 bytes) |
| `ANALYSIS_PROVIDER` | `fixture` (no live model, D-120) |
| `TASK_CONNECTOR` | `simulated` (no Jira OAuth app yet) |
| `COOKIE_SECURE` | `true` |

Optional: `DB_POOL_MAX` (default 3), `DRAIN_BUDGET_MS` (20000), `CRON_DRAIN_BUDGET_MS` (45000),
`JOBS_CRON_SCHEDULE` (build time; default `17 3 * * *`), `MIGRATE_ON_BUILD=1` (migrate in a preview
build too), `OBJECT_STORE_DIR` (default `/tmp/growth-os-objects`).

## 3. One-time database bootstrap

`scripts/cloud-db-bootstrap.sql`, run once as the Supabase `postgres` user (SQL editor or the
Supabase MCP `execute_sql`) after replacing the three password placeholders with random values
(never commit the rendered file). It:

1. creates `me_owner`, `me_app`, `me_worker` (LOGIN, NOSUPERUSER, NOBYPASSRLS) and sets their passwords;
2. grants CONNECT to all three and CREATE on the database to `me_owner` (it creates the app schemas);
3. puts `extensions` (where Supabase installs pgcrypto) on the three roles' `search_path` and grants
   USAGE on it — the migrations do not call `digest()`, but SQL written for local Postgres does;
4. pre-creates `public.schema_migration` owned by `me_owner`, RLS on, no grants to Supabase's Data API
   roles, so `me_owner` needs no CREATE on `public` and the table is never exposed over REST.

Re-running it rotates the role passwords and re-applies the grants.

## 4. Build: migrations, seed, web

`pnpm vercel-build` (`apps/vercel/src/build.ts`) runs in the Vercel build container:

1. **Migrate** (production builds, or `MIGRATE_ON_BUILD=1`): `packages/db` migrations 0001–0008 as
   `me_owner`, then graphile-worker's schema and the job-queue grants. Append-only and checksummed:
   an edited applied migration fails the build.
2. **Seed** `aster-demo` only when the Aster tenant is absent (`AlreadySeededError` → skipped), so
   every deploy is idempotent.
3. **Web**: `vite build` of `apps/web`.
4. **Output**: `.vercel/output` — static SPA, the bundled function (with `skills/` copied beside it for
   the fixture analysis provider), routes (security headers, CSP, `/api/*` → function, SPA fallback)
   and the cron.

The build logs only host names and step results, never credentials.

## 5. How jobs run without a worker

- **After each command.** When a state-changing `/api/v1` request succeeds, the function calls
  `waitUntil(drain)`: graphile-worker runs with concurrency 1 until no job is due (or 20 s), then stops
  gracefully. One drain per instance at a time; a request during a drain asks for one more pass.
- **Periodic tasks** (`CRONTAB`: outbox sweep, analytics flush, approval expiry, pilot window, evidence
  freshness, licence expiry) are kept as one pending "next occurrence" job each (`job_key
  cron:<task>`, `preserve_run_at`). A missed occurrence runs at the next drain; missed occurrences
  collapse into one.
- **Safety net:** a Vercel Cron calls `/api/internal/jobs/run` once a day (Hobby limit). Operators can
  call it at any time: `curl -H "Authorization: Bearer $CRON_SECRET" <url>/api/internal/jobs/run`
  (through Vercel Authentication, e.g. with a protection-bypass token).
- **Wall-clock rules hold without timers.** Approval effectiveness is computed from `expires_at` at
  read and send time (never-rule 10); the outbox re-checks authorization at claim. A late timer only
  delays the status change people see (e.g. "Expired"), never what is authorized.
- The long-running worker (`pnpm --filter @growth-os/worker dev`) still works against the same
  database through the session pooler, e.g. for a load test.

## 6. Operations

**Rotate secrets.** Generate new values locally (`umask 077`), then:
- database passwords: re-run the bootstrap with new passwords, update the three `DATABASE_*_URL`
  variables in Vercel, redeploy;
- `CRON_SECRET`: update in Vercel and redeploy (Vercel Cron picks it up);
- `CONNECTOR_TOKEN_KEY`: set the old value as `CONNECTOR_TOKEN_KEY_PREVIOUS`, the new one as
  `CONNECTOR_TOKEN_KEY`, redeploy; tokens re-encrypt on refresh.

**Reseed** (demo only; destroys the demo data). As `postgres` in Supabase:
`DROP SCHEMA me CASCADE; DROP SCHEMA platform CASCADE; DROP SCHEMA sim CASCADE; DROP SCHEMA
graphile_worker CASCADE; TRUNCATE public.schema_migration;` then redeploy production — the build
migrates and seeds `aster-demo` again. Moving the dev clock forward is the only other way time moves.

**Logs.** Build logs: Vercel deployment › Build. Runtime: Vercel › Logs (`job drain:` lines show
drains). Database: Supabase › Logs. A `[core] ERROR: Error with notify listener … Connection terminated
unexpectedly` line can appear when a frozen instance resumes: graphile-worker's LISTEN connection from
the last drain was closed by the pooler; it reconnects and no job is affected.

**Supabase advisors** (security) report, for this project: `function_search_path_mutable` on the app's
guard functions and graphile-worker's functions (schemas not exposed over the Data API; pinning
`search_path` would need a new migration), `rls_enabled_no_policy` on `public.schema_migration`
(intended: only its owner reads it), and `public.rls_auto_enable()` executable by `anon` — a function
that existed before this deployment and was left untouched.

## 7. Turning on Jira Cloud later

1. In the Atlassian developer console, create an **OAuth 2.0 (3LO)** app; scopes as in
   `docs/market-expansion/JIRA_CLOUD.md`; callback `https://<production host>/admin/connections`.
2. Create the dedicated Jira integration user on the customer's site (D-121).
3. In Vercel set (sensitive): `TASK_CONNECTOR=jira`, `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`,
   `JIRA_REDIRECT_URI=https://<production host>/admin/connections`; keep `CONNECTOR_TOKEN_KEY`.
4. Redeploy, then connect from Administration › Connections (S14) as the tenant administrator.
   Simulated connections keep working.

The Atlassian MCP connection used by operators cannot stand in for the OAuth app.

## 8. Costs and limits

- **Vercel Hobby:** free; cron at most once a day; function max duration 60 s (set in
  `.vc-config.json`); one function region (`sin1`). Vercel Authentication protects all deployments.
  Pro is needed for minute-level cron, more regions, password protection or protection bypass for
  automation, and commercial use.
- **Supabase Free:** 500 MB database, shared pooler, pauses after a week without activity (resume in
  the dashboard). Pooler connections are capped by the project's pool size.
- **Object storage:** source uploads go to the function's `/tmp`, which is per instance and
  ephemeral. Uploading evidence works for the request and the drain that follows it, not durably;
  production needs a bucket behind the same `ObjectStore` interface (D-166).
- **Latency:** the first request after idle pays a cold start (bundle ≈ 15 MB) plus pooler
  connection set-up.
