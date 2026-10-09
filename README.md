# Growth OS · Market Expansion OS

Market Expansion OS turns market opportunities into validated expansion decisions and coordinated
execution. It is the first app on the proposed Growth OS platform. All Aster Industrial Systems data in
this repository is synthetic.

- Start with [`CLAUDE.md`](./CLAUDE.md) (conventions, commands, never-rules).
- Product: [`docs/market-expansion/PRD.md`](./docs/market-expansion/PRD.md) · UX research:
  [`docs/market-expansion/design/UX_RESEARCH.md`](./docs/market-expansion/design/UX_RESEARCH.md)
- Architecture: [`docs/market-expansion/architecture/`](./docs/market-expansion/architecture/) —
  ARCHITECTURE, DATA_MODEL, API, FRONTEND, BUILD_PLAN
- Decisions: [`decisions.md`](./decisions.md) · Key workflows: [`artifacts.md`](./artifacts.md)
- Sister app material (Competitive Response): [`docs/PRD.md`](./docs/PRD.md),
  [`docs/EXECUTION_PLAN.md`](./docs/EXECUTION_PLAN.md)

```bash
pnpm install && pnpm db:up && pnpm db:migrate
pnpm typecheck && pnpm lint && pnpm test && pnpm test:db
```

## Run it locally

Node 22, pnpm 10 and a local PostgreSQL 16 (cluster `16/main`).

```bash
pnpm install
pnpm db:up                      # start Postgres, create roles + database growth_os
pnpm db:migrate                 # apply packages/db/migrations (incl. the job queue schema)
pnpm db:seed aster-start        # journey start: approved MD-21, candidates, people, policies
#   or: pnpm db:seed aster-demo # history to 26 Nov 2026: G2 v3 awaiting Elena's decision
#   reseed from scratch: pnpm db:reset
pnpm dev                        # API :4000 + worker + web :5173 (Vite proxies /api)
```

Open http://localhost:5173 and pick a persona on the login page (dev login exists only with
`AUTH_MODE=dev`, the default, and only for the illustrative Aster tenant): Maya Rao (case owner), Elena
Fischer (sponsor), Daniel Weber (finance), Jonas Klein (pilot owner), Lena Hoffmann (specialist), Priya
Shah (product) or the tenant administrator. `pnpm --filter @growth-os/web dev:mock` runs the screens on
MSW fixtures without an API.

**Inject connector faults** (simulated Jira, dev only): sign in from the shell, then

```bash
curl localhost:5173/api/v1/auth/dev-personas                         # persona user ids
curl -c cookies.txt -H 'content-type: application/json' \
  -d '{"userId":"a57e0003-0000-4000-8000-000000000005"}' localhost:5173/api/v1/auth/dev-login   # Jonas
# connection id: GET /api/v1/admin/connections as the administrator, or the task set's connectionId
curl -X PUT localhost:5173/api/v1/dev/simulator/faults -b cookies.txt -H 'content-type: application/json' \
  -d '{"connectionId":"<id>","rules":[{"mode":"permission_denied","match":{"assignee":"operations.lead@aster.example"},"times":1}]}'
curl "localhost:5173/api/v1/dev/simulator/issues?connectionId=<id>" -b cookies.txt   # what Jira holds
```

Modes: `permission_denied`, `http_5xx`, `rate_limited`, `timeout_after_success`, `token_expired` (sticky
until the rules are replaced; `"rules": []` clears them). Match on `titleContains`, `assignee` or `nthCall`.

**Dev clock** (walk the pilot window and approval expiry live; `AUTH_MODE=dev`, illustrative tenant only,
audited, forward only — reseed to go back):

```bash
curl localhost:5173/api/v1/dev/clock -b cookies.txt                                   # business time
curl -X PUT localhost:5173/api/v1/dev/clock -b cookies.txt -H 'content-type: application/json' \
  -d '{"to":"2027-03-01T09:00:00+01:00"}'                                             # or {"advanceDays":14}
```

Moving the clock runs the pilot-window and approval-expiry timers at once.

**Tests**

| Suite | Command | Needs |
|---|---|---|
| Unit (no database) | `pnpm test` | — |
| Database, API integration, security, connector faults, log scrubbing | `pnpm test:db` | `db:up` + `db:migrate` |
| Evaluation suites (fixture provider) | `pnpm evals:smoke` | — |
| API smoke on a seeded database | `bash scripts/smoke-api.sh` | `db:seed aster-demo` |
| E2E on MSW mocks | `pnpm test:e2e` | Playwright Chromium |
| E2E on the real stack (journey, alternate paths, AI-down, a11y, p95) | `pnpm test:e2e:real` | a migrated `growth_os_pe` (or `E2E_DB_NAME=…_e2e`) |
| Static checks | `pnpm typecheck && pnpm lint && pnpm format:check` | — |

The real-stack project starts its own API, AI-down API, worker and Vite on ports 4710/4711/5710/5711 and
resets + seeds the e2e database before each spec file. Set `E2E_CHROMIUM_PATH` to use a preinstalled
Chromium; otherwise run `pnpm --filter @growth-os/web exec playwright install chromium` once.
