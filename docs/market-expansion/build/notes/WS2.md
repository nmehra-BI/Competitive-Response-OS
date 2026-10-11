# WS2 Domain engines — build notes

Scope: `packages/domain/src/me/{sizing,economics,comparison}/**` and `packages/domain/src/me/golden.test.ts`.
Every engine is a pure function: no I/O, no clock and no randomness. All arithmetic uses decimal.js.

## Decisions

### WS2-1: Typed per-year and one-time money in the domain
- Context: CLAUDE.md rule 3 and the economics stub require a type-level guard against summing recurring and one-time money.
- Decision: `sizing/numeric.ts` defines branded `PerYearAmount` and `OneTimeAmount` types. Arithmetic (`addPerYear`, `subtractPerYear`, `scalePerYear`) accepts only `PerYearAmount`. `OneTimeAmount` has no arithmetic at all. The per-year functions also throw at runtime when the currency or price year differ. A `@ts-expect-error` test proves that mixing the two does not compile.
- Alternatives: a runtime-only check on `Money.timeBasis` (too late, because the error only shows at run time).
- Consequences: WS4 and WS5 calc tools should build money through these helpers and should never do arithmetic on `Money.amount` strings themselves.

### WS2-2: Decimal context and output precision
- Context: D-010 requires decimal strings.
- Decision: decimal.js is cloned with 50 significant digits and ROUND_HALF_EVEN. Money amounts are serialized with at least 2 and at most 8 fraction digits, for example `"40000000.00"`. A true zero is `"0.00"` and never `-0.00`. Ranking scores are fixed at 2 decimals.
- Alternatives: the decimal.js default of 20 digits, which can overflow for 18+8-digit inputs.
- Consequences: engines never do display rounding. Lineage `formulaWithValues` shows exact grouped values, such as `(1,400 + 1,100 − 500) × €20,000 = €40,000,000/year`.

### WS2-3: Blocked sizing output
- Context: the frozen `SizingOutput` requires numeric ladder fields, even when the inputs are invalid.
- Decision: when `blocked` is true, the engine still returns TAM and SAM computed from the raw inputs, so the UI can show for example "SAM 2,000 > TAM 500". `ladder.som` is `[]`, and the cross-check is `not_available`. When SAM cannot be computed at all (wrong cohort count, missing overlap, missing site IDs), `sam.population`, `cohortSum` and `overlapRemoved` are `0`, and the amount is `"0.00"`.
- Consequences: **consumers must not display or commit ladder values when `blocked` is true**. They must show the blocking checks instead. This is the only place where a 0 can stand for "not computed". The `blocked` flag disambiguates it. (See change request CR-WS2-1.)

### WS2-4: Duplicate-cohort detection
- Context: ARCHITECTURE §10.1 says "same rule and source, or high shared-ID ratio".
- Decision: a cohort is a duplicate when it has `status: duplicate_candidate`, when two active cohorts have the same rule and the same `ref` (type + id), or when both carry site IDs and their Jaccard similarity is ≥ 0.9. Jaccard is used rather than "shared ÷ smaller cohort", so a legitimate subset cohort is not flagged.
- Consequences: the fixture variant (1,080 of 1,100 shared) is flagged. A small cohort that sits fully inside a large one is not.

### WS2-5: Lineage graph keys and "Used by"
- Decision: input nodes use the shared key `input.<inputKey>`, so `mergeLineage(sizing.lineage, economics.lineage)` gives a single graph. In that graph, "Used by" for the reachable-pool input lists both SOM and economics.
  - SAM has two nodes. `sizing.sam.population` holds the sites, and `sizing.sam.value` holds the money.
  - The reachable pool node takes the SAM-sites node as an input, because SAM bounds the reachable pool. Following "Used by" from SAM sites therefore leads to reachable pool and then to SOM.
  - The overlap is a calculated node with a signed value (`"-500"`).
- Helpers:
  - `lineageView(nodes, key)` returns the node, its inputs one level, and the nodes that use it one level.
  - `usedByTransitive(nodes, key, depth)` backs "Show next level".
  - `dependsOnAssumptionCount` counts distinct assumption precedents, followed through every level. For SAM on the fixture the count is 1.
- Consequences: the BUILD_PLAN §8 step 8 wording "used by SOM, economics" holds through the reachable pool, not as a direct edge. A direct SAM-value → SOM edge would be false, because SOM revenue is customers × price.

### WS2-6: Ranking semantics
- Decision:
  - The score is (Σ rating × weight) ÷ 100, on the 1–3 scale (`"2.70"`). The inspectable text comes from `explainScore()`: `3 × 40% + 3 × 30% + 2 × 30% = 2.70 of 3`.
  - Any non-excluded `incomparable` row blocks the whole set. Every row then reads "Not ranked — boundary conflict in set", and `valid` is false. Excluding the row lifts the block. This matches the S04 prototype.
  - Excluded rows read "Excluded until normalized".
  - Unknown inputs give "Not ranked — n input(s) missing (names)".
  - Weights that are not whole numbers 0–100 summing to 100 make `valid` false ("Weights must total 100%").
  - Output order: ranked rows by score, highest first, with ties kept in input order. Unranked rows follow in input order.
- Alternatives: the stub comment's reading, where an incomparable row is only excluded and the rest still rank. That contradicts the prototype banner "Aggregate ranking blocked".

### WS2-7: Economics blocking scope
- Decision: scenarios are suppressed (`[]`) and break-even is `null` only when a blocking check names a recurring input. A missing or invalid one-time investment blocks the run (`MISSING_INPUT`, "Recommendation incomplete") and makes `oneTimeInvestment` `Unavailable`. The per-year scenarios are still returned, because they do not depend on it.
- Cash flow and payback are always `Unavailable` (D-030). `missingInputs` lists whichever of the 5 inputs are null, using the S08 labels. If all 5 are present, the reason says the figure is not calculated in this release.

## Workflow updates
- Implemented the engine steps of the sizing, economics and comparison workflows: the S06 sizing ladder, S08 economics and S04 compare ranking. The flow itself is unchanged.
- New failure paths that surface as blocking checks:
  - `TOO_MANY_COHORTS_FOR_AGGREGATE_METHOD` (≠ 2 active cohorts)
  - `MISSING_INPUT` for a missing overlap pair or missing site IDs (union method)
  - `ANNUALIZATION_METHOD_MISSING`
  - `REACHABLE_EXCEEDS_SAM`
  - a currency or price-year mismatch on the top-down cross-check range
- Non-blocking checks: `CAPACITY_CAP_APPLIED` (one per capped scenario) and `CROSS_CHECK_OUTSIDE_RANGE`.

## Change requests
- **CR-WS2-1 (proposed, additive):** make `SizingOutput.ladder.sam` nullable, or add `available: boolean`, so that a SAM that cannot be computed is not encoded as `0` (CLAUDE.md rule 5). For now the `blocked` flag is the guard (WS2-3).
- **CR-WS2-2 (proposed, additive):** add an optional `usedBy: string[]` to `LineageNode`. Callers could then read it from the data instead of deriving it with `lineageView()`. Not required, because the helper covers it.

## Out-of-scope edits
- None. New public helpers are re-exported through `me/sizing/engine.ts`, so `packages/domain/src/index.ts` is unchanged.
- The branch was reset onto `claude/zen-euler-ph3oag`, because the worktree had been created from the empty initial commit. That branch itself was not modified.

## Status
- Done:
  - `SizingEngine`, `EconomicsEngine` and `RankingEngine`
  - lineage builder and views
  - typed money guard
- Tests:
  - Golden tests are on: 21 tests against `fixtures/aster` exact values, covering sizing, economics, ranking and lineage.
  - Property tests run on seeded generators, with no new dependency:
    - determinism
    - no cross-measure sum or total
    - measure independence
    - every blocking check
    - site-list union arithmetic
    - capacity-cap monotonicity (in capacity and in adoption)
    - break-even tightness
    - ranking: Unknown never 0, conflict blocks, tie order
- Files:
  - `sizing/property-gen.ts` is test support. It imports the fixture, which is a devDependency of domain. It is not exported from the package.
- Known gaps:
  - The ranking has no market-size criterion. Size is not used while candidates are not sized on a common boundary.
  - Cross-currency normalization is out of scope. Mismatches block with "Normalize to EUR 2026".
