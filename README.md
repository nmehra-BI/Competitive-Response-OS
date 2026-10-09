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
