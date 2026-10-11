# WS5 — AI and analysis · build notes

Branch `worktree-agent-a7bdf4af9d42a9e63`, based on the integrated Wave 1 head `ca95231`.
Scope: WAVE3 §5 — harness, providers, tool gateway, the ten skills, the nine endpoints, the
`analysis.run` worker job and the eval smoke run. Database `growth_os_ws5`.

## Public API (for WS8 screens, WS4a/WS4b and the PE)

### Endpoints (`apps/api/src/modules/analysis`)

| Endpoint | Behaviour |
|---|---|
| `analysis.start` `POST /me/cases/:caseRef/analysis-runs` | Case skills only (a mandate skill → 400). Case visible (else 404), role `analysis.start` (case owner; else 403), people only (agents/services → 403 `AGENT_IDENTITY_FORBIDDEN`). Creates `agent_run` `queued` with the skill's version and budget, provider name and configured model name, audits `analysis_run.requested`, enqueues `analysis.run` in the same transaction → 202 `AnalysisRun`. `body.focus.fixture` picks a fixture script (fixture provider only). |
| `opportunities.requestDiscovery` `POST /me/mandates/:ref/discovery-runs` | `mandate-to-search-plan` on an approved mandate (else 409 `PRECONDITIONS_UNMET`). Same checks and job → 202 `{ runId }`. |
| `analysis.get` / `analysis.latestForCase` | Run + steps (structured summaries only); newest first, cursor paged. 404 when the subject is hidden. |
| `analysis.cancel` | `runMachine` `cancel`: requester or case owner (else 403); status `cancelled`, detail "Stopped — your work is saved". The worker stops at its next step and writes nothing more. |
| `analysis.resume` | `runMachine` `resume` from `partial`/`failed` (`checkpoint_exists`, `budget_available`) → `queued`, job enqueued → 202. A completed run → 409. |
| `analysis.provideInput` | `runMachine` `input_received` (requester only) → `running`, answer stored in the checkpoint, job enqueued → 202. |
| `analysis.proposals` `GET /me/cases/:caseRef/proposals` | Proposals of a case, **or of a mandate's discovery runs when `caseRef` is a mandate ref (`MD-21`)**. `status` defaults to `proposed`; `accepted` also returns `edited_and_accepted`. |
| `analysis.decideProposal` `POST /me/proposals/:id/decision` | People with `proposal.decide` (case owner). `reject` keeps the reason. `accept` (optionally `editedPayload`: same type, may drop but never add citations) writes the business record with provenance: `opportunity_candidate` → Detected opportunity (`origin ai`, `agent_run_id`, fit criteria, unknowns, sources, likely-duplicate link); `claim` → accepted claim (`origin ai`/`ai_edited`, citations as evidence links). Other types are adopted as drafts (no business write). A superseded or decided proposal → 409. |

Copy the screens can rely on: `statusLabel` from `RUN_STATUS_LABELS`; `statusDetail` such as
"1 source unavailable", "1 source not available to you", "analysis budget reached", "3 requests refused",
"Needs your input", "Stopped — your work is saved". Outcome recommendations start with
"Recommendation · not a decision." Turning analysis off (`ANALYSIS_ENABLED=false`) answers 503 with
"Analysis is turned off. Continue by hand; nothing depends on it."

### Packages

- `@growth-os/ai`: `createHarness`, `createToolGateway` (+ `AGENT_TOOLS`, `TOOL_ARGS`, `redactArgs`),
  `createFixtureProvider` / `createFileFixtureSource`, `createClaudeProvider`, `providerFromEnv`,
  `createFileSkillLoader`, `skillOutputSchema`, `checkOutput`, `wrapUntrusted`, `createMemoryRunStore`
  (tests/evals). No database or connector imports (lint).
- `apps/worker/src/jobs/analysis`: `analysisTasks` (`analysis.run`), `createAnalysisRunner`,
  `createPgRunStore`, `createToolHandlers`, `createScopeChecker`, `loadCaseContext`.
- Skills: `skills/<key>/{skill.yaml, instructions.md, output.schema.json, fixtures/*.json, evals/cases.json}`.
  Regenerate schemas with `pnpm --filter @growth-os/ai skills:schemas` (a unit test checks they are current).
- Evals: `pnpm evals:smoke` (CI already runs it) — 20 cases, 14 suites, all passing.

## Decisions (for the PE to turn into D-0xx)

1. **The provider request is rebuilt from persisted context every turn.**
   Context: resume after a crash must not depend on process memory. Decision: the checkpoint holds the
   context blocks (instructions, case context, tool calls, results, untrusted passages, answers, repair
   requests) and `turn` (provider calls completed); the fixture provider replays turn `turn`; the Claude
   provider maps the blocks to messages. Alternatives: provider-side conversation state (lost on crash).
   Consequences: deterministic resume; permitted excerpts are stored in `agent_run.checkpoint` (internal,
   never returned by the API); restricted content never enters it.

2. **Every step commits atomically with the checkpoint.**
   Context: crash between a step row and its checkpoint duplicated sequence numbers. Decision:
   `RunStore.commit` locks the run, refuses if its status changed (cancelled), and writes the transition
   (+ system audit), steps, tool-call record, proposals, usage and checkpoint in one transaction.
   Consequences: a crash loses at most the step in flight; graphile-worker retries the job and the
   harness continues; cancellation wins every race.

3. **Committed tool results are reused by tool + args hash.** Resume never re-executes a successful
   call. Resuming a `partial` run (which already produced proposals) regenerates from turn 0 with the
   successful results reused and the failed calls retried; the new proposals supersede the pending ones.

4. **Budgets.** Wall time and tool calls are per attempt; tokens and cost per run (`resume` requires
   cost below the cap). Tool budget reached → remaining calls are refused (recorded, `budget` check
   false, not counted) and the provider finishes with what it has → `partial` ("analysis budget
   reached"). Time, cost or token budget, or 24 provider turns in one attempt → `failed`,
   `BUDGET_EXHAUSTED`, "Stopped — your work is saved", resumable. Alternatives: fail on any budget hit
   (loses useful partial output).

5. **`partial` means some tool step failed**: source unavailable, content withheld, budget, or a refused
   request (unknown tool, not allowed, invalid arguments). The detail names them in business words.

6. **`analysis.proposals` serves mandate discovery runs through the same path.** The frozen path is
   case-scoped but discovery proposals belong to a mandate (`proposal.case_id` null). `caseRef` resolves
   a case first, then a mandate (`MD-21`). Alternative: a new endpoint (contract change; CR-WS5-5).

7. **Unsupported claims become `unknown`.** The brief's "downgraded to hypotheses" is implemented as
   ARCHITECTURE §12.4 states it: an `evidence` claim whose citations were not returned in the run, or any
   claim with a precise figure (≥ 3 significant digits or decimals, not a year) that no engine result,
   returned passage or case context contains, is stored as `unknown`; the figure is listed under the
   run's unknowns. Citations not returned in the run are removed. AI never stores `scenario`/`actual`.

8. **Accepting a proposal of another type adopts it as a draft.** Only claims and opportunity
   candidates have business-record writers (WAVE3 §7). Others (`search_plan`, `market_boundary`,
   `assumption_value`, `cohort_dedup`, `feasibility_question`, `assumption_priority`,
   `experiment_design`, `pilot_task`, `message_draft`, `outcome_review_draft`) are marked accepted with no
   target; the owning screen applies them through its own human command (e.g. `assumptions.update` with
   origin `ai_edited`). An outcome recommendation is never a decision: no decision record, outcome,
   approval or stage change (tested), and its rationale is prefixed "Recommendation · not a decision.".

9. **Edits cannot add citations or change the proposal type**; an edited `evidence` claim without a
   citation is refused (mark it assumption or unknown instead).

10. **Commands on runs are for people only.** `analysis.start`, discovery, cancel, resume and answers
    refuse agents and services with `AGENT_IDENTITY_FORBIDDEN` before anything is read;
    `decideProposal` is `auth: 'human'` in the contract.

11. **Analysis off switch.** `ANALYSIS_ENABLED=false` refuses start, discovery and resume with 503
    `CONNECTOR_UNAVAILABLE` ("Continue by hand"). Alternative: a new error code `ANALYSIS_UNAVAILABLE`
    (contract change, not needed). No other module reads runs or proposals (a test scans the modules;
    only the admin Diagnostics page reads traces).

12. **Tool gateway order and recording.** Allowlist → budget → tenant + identity (run belongs to the
    tenant, acts for its requester, who is an active person who can still read the case or mandate) →
    strict argument schema → handler (entitlements). Unknown tool names cannot be stored in `tool_call`
    (DB CHECK); they appear as failed steps "refused · not an available tool". Args are stored redacted
    (ids, keys, codes, numbers kept; free text replaced by `[text:n]`) with a SHA-256 of the full args.

13. **Entitlements in the worker.** Excerpts reach the model only with `excerpt` access **and** a licence
    that allows model context; otherwise the source returns metadata only ("aggregate only · no
    excerpts") and no citable ids. Restricted or unentitled sources: "denied · not summarised", and they
    are excluded from search before ranking (never listed or counted). Sources used only by cases the
    requester cannot read are "not found". The worker restates the API's rules (CR-WS5-1).

14. **Trade registry and CRM.** `intelligence.search` with `connection: "trade_registry"` answers
    `connector_unavailable` while that connection is not connected (Aster: unavailable → discovery is
    `partial`, "1 source unavailable"). `crm.get_authorized_accounts` is always unavailable in the MVP.

15. **Run identity and audit.** Worker transitions are audited as the system (`actor_kind 'system'`,
    rule `system:worker`) with the machine's audit action (`analysis_run.start`, `.complete`,
    `.complete_partial`, `.fail`, `.ask_input`); proposal batches as `proposal.created`; human commands
    as the person (`analysis_run.cancel`, `.resume`, `.input_received`, `proposal.accepted|…`).
    `analysis_run.status_changed` and `proposal.decided` domain events are emitted. No PRD §17 analytics
    event exists for analysis, so none is written. `agent_principal_id` is the tenant's agent user.

16. **Concurrency.** At most 4 running runs per tenant; a queued run without capacity fails its job
    attempt so graphile-worker retries it with backoff.

17. **Skill versions are pinned per run.** A run whose skill version changed before it started fails
    with `SKILL_VERSION_CHANGED`. Skill manifests gained `status: active`, `subject` (case | mandate) and
    `budget.max_cost_micros`; each bundle ships a generated `output.schema.json` (SkillOutput narrowed to
    its allowed proposal types, strict envelope).

18. **Fixture scripts reference ids through placeholders** (`${id:key=OPP-07}`, `${passage:SRC-014}`,
    `${json:subject.sizingInput}`) resolved against the context the run was given, so one script works
    for every isolated seed. An unresolvable placeholder becomes a deterministic made-up UUID, which the
    harness treats like a hallucinated citation.

19. **Claude provider.** Official SDK; the model name comes only from `ANALYSIS_MODEL`; tool names mapped
    to API-safe names (`evidence.get` ↔ `evidence_get`); the final output through a `submit_output` tool
    whose schema is the skill's output schema, questions through `ask_requester`; the untrusted-data rule
    is always in the system prompt; evidence goes inside escaped `<evidence … trust="untrusted">` blocks;
    no thinking settings are sent (model-specific; leave to configuration); SDK errors map to provider
    errors, never synthetic output. Cost uses configured prices (`ANALYSIS_INPUT_MICROS_PER_MTOK`,
    `ANALYSIS_OUTPUT_MICROS_PER_MTOK`, default 0, so token caps still bound a run). Tested with a mocked
    client only (no key here); a live run should be checked manually or nightly.

20. **Eval smoke uses deterministic proxies for expert suites** and reports them as "expert review
    pending"; security, provenance and recovery suites require zero failures.

## Workflow updates

- **WF-09 (analysis run lifecycle)** — implemented end to end: request (202, transactional enqueue) →
  `analysis.run` → `queued → running → completed | partial | failed | waiting_for_input`, cancel by the
  requester or case owner, resume from the last checkpoint, answers by the requester. New failure paths:
  tool budget reached → partial; time/cost budget → failed "Stopped — your work is saved"; malformed
  output after one repair → failed `malformed_output`; skill changed → failed `SKILL_VERSION_CHANGED`;
  no tenant capacity → stays queued, job retried; cancellation during a step → the worker's commit is
  refused and nothing more is written.
- **WF-02 (discovery)** — `opportunities.requestDiscovery` → partial run ("1 source unavailable") →
  candidates as proposals ("Proposed · AI", likely duplicates flagged) → accept creates a Detected
  opportunity with provenance (`OPP-17` on `aster-start`); regeneration supersedes pending candidates.
- **WF-08 (outcome review)** — the `outcome-review` draft is a proposal; accepting it never records the
  decision (that stays `outcomes.decide`, WS4b).
- **AI down** — any workflow completes without analysis; tested with a failing provider and with
  `ANALYSIS_ENABLED=false` (comments and evidence challenges still work; no module depends on runs).

## Change requests

- **CR-WS5-1 — Shared access helpers.** `canReadCase`, `resolveEntitlement`, `effectiveAccess` and the
  source-use query live in `apps/api/src/platform`; the worker cannot import the API, so
  `apps/worker/src/jobs/analysis/access.ts` restates them. Proposal: move them to a shared module
  (e.g. `packages/db/src/access.ts`) used by both.
- **CR-WS5-2 — Run output envelope on `AnalysisRun` (additive).** SkillOutput's `summary`, `unknowns` and
  `notChecked` ("What the analysis did not check") have no field in the frozen contract. They are kept
  in the run checkpoint (`outputMeta`). Proposal: optional
  `AnalysisRun.output: { summary, unknowns[], notChecked[] } | null`.
- **CR-WS5-3 — Swap the stand-in writers.** `apps/api/src/modules/analysis/writers.ts` implements
  `createOpportunityFromProposal` and `createClaimFromProposal` with the WAVE3 §7 signatures because
  WS4a lands in parallel. At integration, import WS4a's from `me/opportunities/writers.ts` and
  `me/thesis/writers.ts` and delete the stand-ins (the DB tests stay).
- **CR-WS5-4 — `agent_run.focus` (additive, 0004).** The run's focus (e.g. fixture name) has no column and
  is kept inside `checkpoint` (`{ focus }` before the first commit, the harness checkpoint `v: 1` after).
- **CR-WS5-5 — Mandate proposals path.** Either document that `analysis.proposals` accepts a mandate ref
  (current behaviour) or add `GET /me/mandates/:ref/proposals`.
- **CR-WS5-6 — Writers for adopted drafts.** WS4a/WS4b to expose writers so accepted `assumption_value`,
  `experiment_design`, `pilot_task`, `market_boundary` and `outcome_review_draft` proposals can pre-fill
  their drafts with `origin ai`/`ai_edited` (today they are adopted without a business write).
- **CR-WS5-7 — `ANALYSIS_RUN_WALL_TIME_MS`** in `.env.example` is not read; budgets come from each
  skill manifest. Either drop it or make it a global cap.

## Out-of-scope edits

- `apps/worker/src/schedule.test.ts` (WS1): added `JOBS.analysisRun` to the exact list of registered
  tasks (the test asserts the full set; WS6 will add its outbox jobs the same way).
- `.env.example`: documented `ANALYSIS_ENABLED`, `ANALYSIS_REQUEST_TIMEOUT_MS`,
  `ANALYSIS_INPUT_MICROS_PER_MTOK`, `ANALYSIS_OUTPUT_MICROS_PER_MTOK`.
- `apps/api/package.json`: dependency on `@growth-os/ai` (skill loader, hashing).
- Shared registry lines: `apps/api/src/modules/index.ts` (`...analysisHandlers`),
  `apps/worker/src/tasks.ts` (`...analysisTasks({ db })`).
- API DB tests import the worker's runner (`apps/api/src/modules/analysis/testing.ts`) to execute jobs
  in-process; production code never crosses apps.

## Status

Done: harness (lifecycle, atomic checkpoints, crash resume with result reuse, budgets, repair, citation
and precision checks, proposals with supersede), gateway (7 read-only tools, all checks, redaction,
untrusted wrapping), fixture and Claude providers, ten active skills with fixtures, schemas and eval
cases, nine endpoints, `analysis.run` job registered, 14 eval suites in the smoke run.

Tests: `pnpm test` 1944 passed (57 in `packages/ai`); `pnpm test:db` 147 passed (32 WS5: discovery 7,
analysis 9, proposals 4, worker run 6, gateway 6); `pnpm evals:smoke` 20 cases, 14/14 suites passed;
`typecheck`, `lint`, `format:check` clean.

Known gaps: the Claude provider is verified only against a mocked client; expert-scored suites need
human scoring; adopted drafts other than claims and candidates have no business write yet (CR-WS5-6);
per-case monthly cost cap is not implemented (only per-run caps and tenant concurrency); no
`awaiting_approval` path is used (no skill asks for more budget).
