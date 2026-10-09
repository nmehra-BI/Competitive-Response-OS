# fixtures/aster — canonical Aster Industrial Systems data

Synthetic, illustrative data for Market Expansion OS (PRD §6, §15). It seeds development, drives the
golden engine tests and the end-to-end acceptance journey, and backs the web app's MSW mocks.
**Frozen** (decisions.md D-025, D-031): change only through a change request.

| File | Contents |
|---|---|
| `src/org.ts` | tenant, business units, products, segments, the six personas (+ admin, ops lead, agent principal), roles, authority grants (placeholder ceilings), gate policies, materiality rules, licences, entitlements, connections, connector mappings |
| `src/discovery.ts` | sources SRC-009/011/014/021/030/040, mandate MD-21 (v1 returned, v2 approved), opportunities OPP-03/07/09/12/14/16, comparison, cases ME-097/102/104/105 |
| `src/assessment.ts` | assumption register ASM-01…11, Daniel's dispute, sizing v2 and economics v2 engine inputs, feasibility rows, specialist question and scoped sign-off |
| `src/decisions.ts` | EXP-03 (plan, amendment 1, results), validation tasks, gates G0/G1/G2/X1/G3, pilot milestones and tasks, preview text, budget, outbound draft, outcome targets, actuals, review and decision |
| `src/expected.ts` | golden engine outputs, display strings, blocking variants |
| `src/journey.ts` | journey moments (timestamps with offsets) |

## Seed profiles (implemented by WS1 in `packages/db/src/cli/seed.ts`)

- `aster-start` — the PRD §15 journey start: org, people, roles, authority, policies, licences, sources,
  connections, approved MD-21, detected opportunities. The e2e journey runs from here.
- `aster-demo` — full history up to 26 Nov 2026 (G2 v3 awaiting Elena's decision) for demos and screens.

## Rules

- Every PRD §6 number is exact. Placeholders (`€[cap]`, `[duration] days`, `[hours per site]`,
  `€[limit]`) stay placeholders.
- One fixture choice: upside adoption 30% (any value ≥ 24% reaches the 120-customer cap).
- Prototype fingerprints (`7F3A·19C2`, `2B71·0E4D`) are illustrative; real fingerprints come from hashes.
