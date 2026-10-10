# Fixture scripts · bottom-up-sizing

Scripted turns for the deterministic fixture provider (`ANALYSIS_PROVIDER=fixture`, the default).
`default.json` is the Aster happy path; other scripts exercise failure paths and are selected with the
run's `focus.fixture`. A missing script is an error, never a silent fallback. Ids are written as
placeholders that resolve against what the run was given: `${id:key=OPP-07}`, `${passage:SRC-014}`,
`${json:subject.sizingInput}` (see `packages/ai/src/providers/fixture-provider.ts`).
