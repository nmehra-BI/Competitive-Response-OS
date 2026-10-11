# Competitive Response OS — Engineering Execution Plan

**Source:** [PRD v1.0](./PRD.md) (9 October 2026) • **Author role:** Senior Staff Engineer • **Status:** Draft for review by product, design, and engineering leads • **Scope:** Clickable prototype and V1 paid-pilot MVP (PRD §14)

---

## 0. Summary

1. **Build the workflow before the AI.** The first runnable system is a manual, end-to-end case: manual signal → case → manual assessment → approval → internal task → outcome review. AI analysis then fills the same records. This satisfies the release gate "manual operation possible when AI fails" by construction, and it de-risks the schedule.
2. **The system of record is a relational database with an append-only event log.** The case state machine, approvals, and versioned snapshots live in Postgres. We do not use agent memory or a workflow product as the source of truth.
3. **Use one bounded analysis agent with versioned skills.** Skills are versioned prompt, schema, and evaluation bundles in the repository. No sub-agents in V1 (PRD §11).
4. **Deterministic code owns every number and every gate.** Exposure calculation, state transitions, approval checks, and external writes are plain, tested code. The model never calls a write tool and never supplies an approval.
5. **Plan for 2 weeks of Phase 0 plus 12 weeks of build.** The PRD estimate of 10–12 weeks is achievable only with the scope cuts in §9. Six decisions in §10 must close before week 1, or the dates move.

---

## 1. How I read the PRD: engineering-significant requirements

These requirements drive the architecture. If we get them wrong, a rewrite follows.

| # | Requirement (PRD ref) | Engineering consequence |
|---|---|---|
| R1 | Approval applies to an exact version; agent cannot approve (DEC-04/05, §6) | Immutable, content-hashed `DecisionPackage` snapshots. Approvals reference `(package_id, version, hash)`. The approval endpoint requires an interactive human session; service and agent identities are rejected. |
| R2 | Material change invalidates pending approvals; executed actions are preserved (§6) | Explicit "materiality" rules in code, evaluated on every write to scope, exposure, chosen response, or plan. Invalidation is an event, not a deletion. |
| R3 | Same snapshot and assumptions reproduce the same calculation (IMP-03) | Pure function `calculateExposure(snapshot, filters, formulaVersion)` with decimal arithmetic, golden tests, and stored input hashes. |
| R4 | Revenue and pipeline are never summed (IMP-03, §10) | Typed measures (`RecognizedRevenue`, `Pipeline`, `ScenarioRange`). The type system and API schema make addition across measure types impossible. |
| R5 | No duplicate external tasks under retries; never say "synced" before confirmation (ACT-04/06) | Transactional outbox, stable idempotency key per `(plan_version, task_id)`, reconcile-before-retry after an ambiguous timeout, separate internal and external status fields. |
| R6 | Revoked approval blocks unexecuted writes (ACT-04, §11) | The outbox worker re-checks current authorization at send time, not only at enqueue time. |
| R7 | Redacted rows do not leak through totals or tooltips (Screen 5, GOV-02) | Authorization is applied in the query layer before aggregation. Aggregates over partially visible sets show a scope label or are withheld (rule in §4.5). |
| R8 | Retrieved content is evidence, not instructions (§11) | Ingested text is sanitized, stored, and passed to the model only inside delimited, data-only context. The agent has no write tools. |
| R9 | AI text is editable; human edits are not overwritten (§8, §11) | Field-level provenance (`ai` / `human` / `ai_edited`) and a three-way merge on regeneration. A human-edited field is never replaced without explicit acceptance. |
| R10 | Failed analysis does not block manual work (§6) | Analysis status is a separate entity (`AgentRun`) from case state. All case screens work with zero AI output. |
| R11 | Publish, event, and ingestion dates stay distinct (SIG acceptance) | Three separate typed columns. No shared "date" field anywhere in the schema or the UI components. |
| R12 | Append-only audit (GOV-01) | `audit_event` table with `UPDATE`/`DELETE` revoked at the database role level. |

---

## 2. Delivery tracks

Two tracks run in parallel. They share one domain model and one fixture dataset.

| Track | Purpose | Output | Owner |
|---|---|---|---|
| **A. Prototype** (PRD §20) | Validate the journey with stakeholders and design partners | High-fidelity, clickable CR-1042 journey on fixture data, all required variant states | Design + 1 frontend engineer |
| **B. Pilot MVP** (PRD §14 V1) | Real cases for 3–5 design partners | Production-grade, single-segment, single-tenant-per-pilot deployment | Core engineering team |

**Rule:** The prototype uses the same frontend component library and the same TypeScript domain types as the MVP, with a fixture-backed API. This means prototype work is not thrown away, and the CR-1042 fixture becomes the seed data and the end-to-end test of the MVP.

---

## 3. Team and roles

| Role | FTE | Main ownership |
|---|---|---|
| Staff engineer / tech lead | 1 | Architecture, domain model, state machine, authorization, release gates |
| Backend engineers | 2 | API, workflow engine, ingestion, exposure, Jira integration, audit |
| Frontend engineers | 2 | Component library, case workspace, inbox, plan, prototype |
| AI engineer | 1 | Agent harness, skills, structured output, evaluation pipeline |
| Platform / security engineer | 0.5 | Infra, CI/CD, secrets, tenancy isolation, observability, security review |
| QA / test engineer | 0.5 | Scenario tests, release-gate suite, accessibility checks |
| Product designer | 1 | Prototype, design system, variant states |
| Domain analyst (med-device CI) | 0.5 | Evaluation labels, skill content, fixture realism |
| Product manager | 1 | Scope, discovery, pilot customers |

Total: about 8.5 engineering FTE. With fewer people, apply the cuts in §9 first, then extend the timeline. Do not cut tests or the release-gate suite.

---

## 4. Target architecture (V1)

### 4.1 Component view

```
┌───────────────────────────── Web app (React/Next.js, TypeScript) ─────────────────────────────┐
│ Overview · Signal Inbox · Case workspace (8 tabs) · My Actions · Outcomes · Settings           │
└───────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                │ HTTPS (session auth; typed API contract)
┌───────────────────────────────────────────────▼───────────────────────────────────────────────┐
│ API service (Node/TypeScript)                                                                  │
│  • AuthN/session  • Policy engine (RBAC + scope + field rules)  • Domain services              │
│  • Case state machine  • Versioning/snapshots  • Exposure calculator (pure)  • Audit writer    │
└──────┬──────────────────────┬──────────────────────────┬──────────────────────────┬────────────┘
       │                      │                          │                          │
┌──────▼───────┐   ┌──────────▼──────────┐   ┌───────────▼───────────┐   ┌──────────▼──────────┐
│ Postgres     │   │ Job worker          │   │ Analysis worker       │   │ Outbox worker       │
│ (RLS, tenant │   │ ingestion, dedup,   │   │ bounded agent +       │   │ Jira writes,        │
│ data, events,│   │ CSV import, digests │   │ skills + tool gateway │   │ reconcile, retry    │
│ outbox, jobs)│   │                     │   │ (read-only tools)     │   │ (authz re-check)    │
└──────────────┘   └─────────────────────┘   └───────────┬───────────┘   └──────────┬──────────┘
                                                         │                          │
                                              Model provider API              Jira Cloud API
       Object storage (source snapshots, attachments; encrypted)
```

### 4.2 Technology choices

| Concern | Recommendation | Why | Rejected alternative |
|---|---|---|---|
| Language | TypeScript end to end | One domain type set shared by UI, API, prototype, and schema validation | Python backend: splits domain types; keep Python only for evaluation notebooks if needed |
| Frontend | React + Next.js, a headless accessible component base (e.g. Radix), TanStack Table | Dense enterprise tables, WCAG 2.2 AA, keyboard support | Heavy UI kits: harder to meet the restrained, evidence-first design |
| API | Fastify or NestJS, schema-first (Zod → OpenAPI) | Runtime validation at every boundary; generated client | GraphQL: field-level authz on aggregates is harder to reason about |
| Database | Postgres 16, row-level security on `tenant_id` | Transactions across state, events, and outbox; RLS as a second isolation layer | Document DB: weak for versioned relational snapshots |
| Jobs and durable waits | Postgres-backed queue (Graphile Worker or pg-boss) | Long approvals are rows, not running processes; one less system to operate | Temporal: strong, but operational cost is not justified for V1. Revisit at V2 if workflows get more complex. |
| Workflow engine | In-house state machine module (explicit transition table + guards) | Rules are business logic that must be readable and tested | Generic BPMN engine: too much for 10 states |
| Policy | In-code policy module with a decision table, unit-tested per role × scope × action | Small rule set; fast; testable | OPA/Cedar: consider for V2 if customers need custom policies |
| AI | Claude API through a thin provider adapter; structured output via tool/JSON schemas | Strong long-context evidence reading; adapter keeps the provider swappable | Agent frameworks with hidden state: conflicts with "agent memory is not system of record" |
| Hosting | One cloud provider, EU region for the German pilot; managed Postgres; KMS; secrets manager | Data residency for EU customers; less ops | Multi-region: not needed for pilot |
| Observability | OpenTelemetry traces with correlation IDs from UI → API → worker → model → Jira | AuditEvent and AgentRun need correlation IDs (PRD §12) | — |

### 4.3 Domain model and versioning

Implement the PRD §12 entities as written, with these engineering rules:

- **Every entity** has `tenant_id`, `id` (UUIDv7), `created_at/by`, `updated_at/by`, and `scope` (business unit, geography).
- **Versioned entities** (`ImpactAssessment`, `ResponseOption`, `DecisionPackage`, `ActionPlan`, `Skill`, `Policy`, calculation formula) use an append-only `*_version` table. The parent row points to `current_version_id`. We never update a version row.
- **`DecisionPackage`** is a frozen JSON document plus a SHA-256 hash of its canonical form. It embeds references (with versions) to assessment, options, evidence claims, and exposure snapshot, and copies the human-readable values the approver saw.
- **`Approval`** stores `package_version_id`, `package_hash`, actor, authority scope at the time of decision, disposition, rationale, constraints, and timestamp. Approval and execution authorization are two separate records (PRD §6).
- **Field provenance:** text fields that AI can generate store `{value, origin: ai|human|ai_edited, agent_run_id?, edited_by?}`.
- **Many-to-many links** (`case_signal`, `claim_source`, `signal_claim`) carry their own audit metadata so shared evidence is not duplicated.

### 4.4 Case state machine

One module owns all transitions in PRD §6. Each transition is a function `(case, actor, input) → Result<NewState, Error>` that:

1. Checks the policy (role, scope, required checks).
2. Writes the new state, the domain change, the `audit_event`, the analytics event, and any outbox rows **in one database transaction**.
3. Returns the next required action, which the UI shows in the case header.

"Ready for decision" guards are explicit and listed in code: verified or explicitly accepted-as-unverified signal, confirmed product mappings (or recorded qualitative-only path), exposure snapshot or "Exposure unavailable" record, disclosed unknowns, at least one option. The UI renders guard failures as the "Resolve missing information" list.

**Materiality rule (R2), V1 version:** A change is material if it changes any of: case scope (BU, geography, product), confirmed mapping set, exposure snapshot ID or assumption inputs, selected options, or plan task set / owners / external destinations. Changes to comments, notes, or formatting are not material. When a material change occurs, pending approvals for affected versions move to `invalidated`, the outbox pauses unsent writes for that plan, and the case shows the "approval invalidated" variant.

### 4.5 Authorization and redaction

- **Model:** `RoleAssignment(user, role, scope{bu[], geo[], response_types[]}, approval_authority)`. Task ownership never grants approval. Admin role grants configuration only (PRD §4).
- **Enforcement points:** (1) Postgres RLS by tenant; (2) policy check in every service method; (3) field-level masking in the serializer for restricted commercial fields; (4) re-check at outbox send time.
- **Aggregate rule (R7):** An aggregate is computed only over rows the viewer can see. If any rows in the true set are hidden from the viewer, the UI shows "Totals reflect N of M accounts you can access" and does **not** show the full total or a difference that would let the viewer derive hidden values. If M itself is sensitive under tenant policy, show "Totals reflect your access scope" only.
- **Agent context:** The analysis agent receives account and revenue values only through the `exposure` tool result, scoped to the requesting user. Restricted values never enter prompts that are logged in general traces; traces store references and hashes.

### 4.6 AI subsystem

**Shape:** One bounded analysis agent per `AgentRun`. A run has a goal (e.g. "verify event", "propose mappings", "draft options", "draft plan"), a skill, a budget (tokens, tool calls, wall time, cost), and a checkpoint after each step.

**Skills** (PRD §11): `event-verification`, `competitive-product-overlap`, `revenue-exposure-analysis`, `response-option-assessment`, `execution-plan-drafting`, `outcome-review`. Each skill is a directory:

```
skills/<name>/
  skill.yaml        # version, owner, domain, required inputs, allowed tools, budgets
  instructions.md   # procedure
  output.schema.ts  # Zod schema; also exported as JSON Schema for the model
  examples/         # valid and invalid examples
  evals/            # labeled cases + scoring config
```

**Tool gateway:** Read-only tools only in V1 agent scope: `sources.get_event_evidence`, `portfolio.match_competing_products`, `exposure.get_snapshot`, `exposure.calculate_scenario`, and later `marketsandmarkets.search_market_intelligence` if access exists. **The agent has no write tools.** Jira and Teams writes are outbox operations triggered by human actions.

**Output handling:** Validate the model output against the schema. Reject or downgrade to `hypothesis` any claim without a valid evidence ID. Store the output as proposed records with `origin=ai` and `status=pending_review`. Nothing becomes a "verified fact" without a rule (e.g. two independent sources of required quality) or a human acceptance.

**Prompt-injection controls:** Source text is sanitized (strip scripts, hidden text, active content), stored as a snapshot, and passed in delimited data blocks with an instruction that it is untrusted evidence. Even if an injection succeeds, the agent cannot do anything consequential because it has no write tools, and its outputs are pending review.

**Model choice:** Default to the most capable current Claude model for verification and option reasoning. Use a smaller model for extraction and classification only if evaluations show equal quality. Make the model a per-skill configuration item recorded in `AgentRun`.

**Evaluation pipeline (from week 1, not week 10):**

- Domain analyst builds a labeled set of 40–60 historical or synthetic events covering PRD §17 categories (syndicated duplicates, contradictions, entity ambiguity, regulatory status changes, weak overlap, stale data, multilingual German/English, prompt injection, missing data). Hold out 30%.
- CI runs the evaluation suite on every skill or prompt change. Report verification precision, claim support rate, mapping quality, option feasibility (rubric), plan completeness, cost, and latency.
- Baselines: manual analyst output and a simple deterministic pipeline (rules + extraction only). The agent ships for a skill only if it beats the simple baseline on that skill.

### 4.7 Ingestion and signals

- **Inputs (V1):** curated RSS/Atom and HTTP feeds from an allowlist, URL submission, manual entry. Licensed MarketsandMarkets content only if programmatic access and entitlement are confirmed (open decision D3).
- **Pipeline:** fetch → sanitize → snapshot to object storage with content hash → extract (competitor, product, event type, geography, three dates, claims) → entity match against catalog with confidence and "uncertain" flag → cluster.
- **Clustering and syndication (SIG-03):** canonical URL + content hash for exact duplicates; near-duplicate text fingerprint (e.g. MinHash) for syndicated copies; publisher-origin metadata to separate "independent corroboration" from "syndicated copy". The agent can propose a cluster merge; merges that change verification state need a human.
- **Idempotency:** repeated intake of the same source (same canonical URL + hash) links to the existing `SourceDocument` and never creates a new case automatically.

### 4.8 Exposure calculation

- Input: one `ExposureSnapshot` (dated, imported from CSV in V1), confirmed product mappings, filters (segment, geography, period, currency), exclusions, deduplication key (account ID), formula version.
- Output: separate typed measures — relevant annual revenue, distinct affected accounts, open pipeline — plus scenario range = revenue × [low%, high%] with the formula shown.
- Decimal arithmetic only. No implicit currency conversion: if records have mixed currencies, the calculation fails with a clear error unless the user selects an explicit, dated conversion table (P1).
- **Golden test:** the CR-1042 fixture must produce €24,000,000 / 18 accounts / €6,000,000 pipeline / €1,200,000–€3,600,000 at 5–15%. Overlapping products for one account count that account once.

### 4.9 Jira integration (ACT-04)

1. Human selects "Authorize and release plan". Preflight shows the destination project, issue type, and exact field values for each task.
2. On authorization, one transaction writes `ExecutionAuthorization`, task rows with `external_status=pending`, and one outbox row per task with `idempotency_key = hash(tenant, plan_version_id, task_id)`.
3. Outbox worker, per row: re-check authorization (approval still valid, plan version still current, integration connected, actor still authorized) → create the Jira issue with the idempotency key stored in an issue property and label → on success, store the external key and set `external_status=confirmed`.
4. On ambiguous timeout: search Jira by the issue property before retrying. If found, record it; if not, retry with backoff. After N attempts, set `failed` and show "Retry" in the UI.
5. Partial success: each task has its own status. Retrying the plan only re-sends rows that are not `confirmed`.
6. Contract tests run against a Jira Cloud sandbox; fault-injection tests simulate timeout after success, 5xx, rate limits, and revoked tokens.

### 4.10 Audit, analytics, and observability

- `audit_event`: actor, event type, object type/ID/version, timestamp, authorization context, correlation ID. Insert-only.
- Analytics events (PRD §16 list) are emitted from the same transaction via the outbox to an analytics sink. Payloads contain IDs, versions, roles, and timestamps; never raw evidence or commercial values.
- Operator panel (secondary UI): `AgentRun` details, tool calls, timings, cost, schema validation errors. Main copy uses business language ("Checking sources").

### 4.11 Security baseline

Tenant isolation tests in CI (cross-tenant read/write attempts on every endpoint); encryption in transit and at rest; managed secrets; least-privilege service identities (analysis worker cannot read the Jira token; outbox worker cannot call the model); SSRF protection on URL fetch (allowlist, no private IP ranges); dependency and container scanning; model provider set to zero data retention where available. External security review before a live Jira connection at a pilot customer.

---

## 5. Phase plan

### Phase 0 — Discovery spikes and prototype (2 weeks, before build week 1)

| Item | Owner | Exit |
|---|---|---|
| Close open decisions D1–D6 (§10) | PM + tech lead | Written decisions |
| Domain model and state machine RFC | Tech lead | Reviewed RFC; ERD; transition table |
| Fixture dataset CR-1042 as code (JSON/SQL seed) | Domain analyst + backend | Seed matches PRD §10 numbers; labeled "Illustrative data" |
| Design system tokens and core components | Design + frontend | Source reference, verification tag, uncertainty notice, exposure summary, approval control, version selector, task status, activity item |
| Clickable prototype, Screens 2–8 and 10 | Design + 1 frontend | Reviewer can walk the 8-step journey (PRD §10) on fixture data |
| Jira Cloud sandbox spike | Backend | Create issue with property, search by property, measure rate limits |
| Evaluation set v0 (20 cases) | Domain analyst + AI engineer | Labeled, stored with provenance |
| Infra skeleton: repos, CI, environments, EU region | Platform | Empty app deploys to dev and staging from `main` |

### Phase 1 — Build (12 weeks, 5 milestones)

Each milestone ends with a demo of a slice of the CR-1042 journey on staging and a passing release-gate subset.

#### M1 — Walking skeleton (weeks 1–3)

Goal: a manual case goes end to end with no AI.

- Tenancy, auth (email + password or magic link for pilot; SSO is P1), roles and scopes, RLS.
- Core entities, versioning tables, audit table, state machine with all PRD §6 states and guards.
- Onboarding: business units, product catalog, competitors, markets, owners, approvers (ONB-01, ONB-04).
- Manual signal entry (SIG-01 partial), triage actions with reasons (SIG-05).
- Case creation, case header, Summary tab, Activity tab, comments and mentions (GOV-01).
- Manual decision package → approve / request changes / reject / defer (DEC-04, DEC-05).
- Internal tasks and My Actions (ACT-01 manual, ACT-03 basic).
- **Demo:** Maya creates CR-1042 from a manual signal, Elena approves, Jonas completes a task. All events in audit.

#### M2 — Evidence and impact (weeks 3–6)

- Feed and URL ingestion, sanitization, snapshots, three dates (SIG-01).
- Extraction + entity match skill v1 (SIG-02); clustering and syndication (SIG-03); inbox with distinct verification, quality, relevance, urgency (SIG-04).
- Evidence workspace: claims, provenance, accept/correct/exclude, conflict/stale/withdrawn variants, entitlement-aware excerpts (EVD-01–04).
- CSV import with mapping, validation, duplicates, preview, dated snapshot (ONB-02).
- Product mapping proposals + reviewer confirmation (IMP-01); affected scope (IMP-02).
- Exposure calculator + scenario controls + drill-down (IMP-03–05). Redaction rule (R7).
- `event-verification` and `competitive-product-overlap` skills with evaluation scores published.
- **Demo:** Journey steps 1–2. Golden exposure test passes. Missing-CRM and low-confidence-overlap variants work.

#### M3 — Options and decisions (weeks 6–8)

- `response-option-assessment` skill; option comparison UI; human-created and edited options; multiple compatible options (DEC-01–03).
- Decision package snapshot with hash; versioned Decision Review screen; multi-approver policy; escalation when scope exceeds authority (DEC-06).
- Materiality rule and approval invalidation (R2); superseded / expired / role-insufficient / monitor-only variants.
- Field provenance and safe regeneration (R9).
- **Demo:** Journey steps 3–4, including "request changes" and the revised approval. Changed-evidence-after-approval variant.

#### M4 — Execution (weeks 8–10)

- `execution-plan-drafting` skill; plan editor with owners, dates, dependencies (cycle rejection), deliverables, completion criteria (ACT-01, ACT-02).
- Draft vs Released plan; preflight panel; execution authorization record.
- Outbox, Jira integration, reconcile-before-retry, per-task external status, retry UI (ACT-04, ACT-06).
- Authorization re-check at send time; revoked approval blocks unsent writes (R6).
- Task board, overdue view, reassignment history, attachments; completion with reviewer acceptance (ACT-03, Screen 9).
- **Demo:** Journey steps 5–7, including one forced Jira failure and a safe retry. Zero duplicates in the fault-injection suite.

#### M5 — Outcomes, governance, hardening (weeks 10–12)

- Outcome definition before execution (OUT-01); manual indicators with evidence (OUT-02); `outcome-review` skill with non-causal language checks (OUT-03); close / extend / reopen (OUT-04).
- Overview screen, Outcomes portfolio view, Watchlist and Integrations settings screens.
- Decision brief export (PDF) with citations and uncertainty (GOV-04).
- Full release-gate suite (§7), accessibility audit, load test to target p95, backup/restore drill, security review, runbooks.
- Pilot onboarding kit: CSV templates, sample case, admin guide.
- **Demo:** Full 8-step journey plus all PRD §10 alternative flows. Go/no-go for pilot.

### Phase 2 — Pilot operation (weeks 13–24, outside this plan's build scope)

Weekly evaluation review, on-call rota, support for 3–5 design partners, instrumentation dashboards for PRD §16 metrics, V2 backlog based on evidence (read-only CRM, Teams, specialist agents only if evaluations justify them).

---

## 6. Requirement traceability (P0 → milestone)

| Area | P0 IDs | Milestone |
|---|---|---|
| Onboarding | ONB-01, ONB-04 | M1 |
| | ONB-02, ONB-03 | M2 |
| Signals | SIG-01 (manual), SIG-05 | M1 |
| | SIG-01 (feeds/URL), SIG-02, SIG-03, SIG-04 | M2 |
| Evidence | EVD-01, EVD-02, EVD-03, EVD-04 | M2 |
| Impact | IMP-01, IMP-02, IMP-03, IMP-04, IMP-05 | M2 |
| Decisions | DEC-04, DEC-05 (manual) | M1 |
| | DEC-01, DEC-02, DEC-03, DEC-06 | M3 |
| Actions | ACT-01 (manual), ACT-03 (basic) | M1 |
| | ACT-01 (AI draft), ACT-02, ACT-03, ACT-04, ACT-06 | M4 |
| Outcomes | OUT-01, OUT-02, OUT-03, OUT-04 | M5 |
| Governance | GOV-01, GOV-02, GOV-03 | M1 (foundation), extended each milestone |
| | GOV-04 | M5 |

P1 items (ONB-05, SIG-06, EVD-05, IMP-06, ACT-05, OUT-05, GOV-05) are out of the 12-week scope. SSO (GOV-05) moves into scope only if a pilot contract requires it; budget 1 week.

---

## 7. Release gates as automated tests

Each PRD §17 release gate becomes a named test suite that runs in CI. The pilot release requires all suites green.

| Gate | Suite | Examples |
|---|---|---|
| Scenario tests pass | `e2e/journey` | Playwright: full CR-1042 journey; each PRD §10 alternative flow |
| No approval bypass | `security/approval` | Agent identity cannot approve; approval of stale version rejected; task owner cannot approve; admin cannot approve; out-of-scope approver escalates |
| Reproducible calculations | `domain/exposure` | Golden fixture; property tests (determinism, no double count, no cross-measure sum, currency mismatch fails) |
| No duplicate tasks under retries | `integration/jira-faults` | Timeout after success, 5xx, 429, worker crash mid-send, concurrent retry clicks |
| Evidence traceability | `domain/evidence` | Every fact in a package has ≥1 valid evidence ID; excluded evidence absent from current conclusion but present in history |
| Scoped access verified | `security/tenancy`, `security/redaction` | Cross-tenant attempts on all endpoints; aggregate leakage tests; tooltip/export leakage tests |
| Missing-data paths usable | `e2e/missing-data` | No CRM, no baseline ("Unable to compare"), no evidence ("missing evidence") |
| Manual operation when AI fails | `e2e/ai-down` | Model provider stubbed to fail; full journey completes manually |
| Security review for live integrations | Manual sign-off | External review report, findings closed or accepted |

AI quality gates (from the evaluation pipeline): claim support ≥ 95% on the holdout set; 100% of facts have provenance or an explicit unknown label; zero successful prompt-injection actions (trivially true by design, but tested).

---

## 8. Engineering risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Licensed intelligence not available programmatically | High | Medium | V1 works on curated public feeds + manual entry. MnM content is an adapter added when access exists. |
| Pilot customer cannot share commercial data | Medium | High | CSV snapshot and qualitative path are P0 and tested. |
| AI quality below bar for verification | Medium | High | Bounded scope, human acceptance required, simple baseline comparison; ship skills individually. |
| Redaction leakage through aggregates or exports | Medium | High | Single aggregation service with authz before aggregation; dedicated leakage test suite. |
| Jira customer configurations vary (required fields, workflows) | High | Medium | Destination preview validates against Jira field metadata; per-destination field mapping config. |
| 12 weeks too short | High | Medium | Walking skeleton first; cut list in §9 agreed before week 1. |
| Materiality rule too strict or too loose | Medium | Medium | Rule table in code, reviewed with pilot users; versioned policy. |
| Scope creep toward "chat assistant" or more agents | Medium | Medium | PRD non-goals enforced in review; case-scoped Q&A stays out of V1. |
| Model cost per case unclear | Medium | Low | Budgets per run; cost reported in evaluation and per-case analytics. |

---

## 9. Scope cut list (agreed in advance)

If M2 or M3 slips by more than one week, apply cuts in this order:

1. Kanban view of the action plan (keep table).
2. Overview workflow funnel and workload view (keep attention lists and active-case table).
3. "What would have been surfaced" historical preview on Watchlists.
4. Syndication detection reduced to exact and near-duplicate only; independence marked manually.
5. Decision brief export as HTML/print instead of a designed PDF.
6. Multi-approver policies reduced to one approver plus optional second approver.

Never cut: approval integrity, idempotent writes, redaction, audit, exposure determinism, the manual path, or the evaluation pipeline.

---

## 10. Decisions required before build week 1

| # | Decision | Default if not decided | Needed from |
|---|---|---|---|
| D1 | Pilot hosting model and data residency (EU single-tenant deployment per pilot vs shared multi-tenant) | Shared multi-tenant in EU region, RLS + per-tenant encryption keys | CPO, security, pilot customer |
| D2 | Model provider and data-handling terms (retention, training opt-out, region) | Claude API with zero data retention; EU processing where available | Legal, security |
| D3 | MarketsandMarkets content access: API, entitlement checks, licensing limits on excerpts | No licensed content in V1; adapter stub | Data/licensing owner |
| D4 | Jira edition (Cloud vs Data Center) and auth model (OAuth 2.0 3LO vs service account) | Jira Cloud, OAuth 2.0 3LO, execution identity = authorizing user | First pilot customer |
| D5 | Auth for pilot: SSO required by contract? | No SSO; email + MFA | Pilot contracts |
| D6 | Approval policy defaults: single vs multiple approvers per response type; pricing-related escalation authority | Single approver per BU; pricing-related options require named commercial authority | Product + pilot customer |

---

## 11. Ambiguities in the PRD to resolve with product

1. **"Verified" definition.** The PRD gives a verification checklist but no rule. Proposal: verified = at least one primary source (manufacturer, regulator) plus no unresolved contradiction, or explicit human acceptance with a reason.
2. **Materiality.** §4.4 gives a proposed rule. Product must confirm.
3. **Execution authorization for low-risk plans.** PRD allows one combined user flow. We need a written definition of "low-risk internal plan" (proposal: no external writes and no pricing-related tasks).
4. **Approval expiry.** Screen 7 lists "approval expired". The PRD does not give a duration. Proposal: tenant policy, default 14 days before plan release.
5. **Reopen semantics.** Proposal: reopen creates a new assessment version on the same case; prior decisions stay linked and read-only.
6. **Task completion with reviewer acceptance.** Which task policies need it? Proposal: tasks with a deliverable require acceptance by the case owner.
7. **Restricted counts.** Is the count of hidden accounts itself sensitive? Affects the R7 display rule.

---

## 12. Definition of done (per feature)

- Domain logic unit-tested; state transitions and policy checks covered for every role.
- API schema validated; generated client used by UI.
- Audit and analytics events emitted and asserted in tests.
- Empty, loading, partial, failed, restricted, stale, and conflicting states designed and implemented where relevant.
- Keyboard and screen-reader checks pass for new components.
- No restricted values in logs (log-scrubbing test).
- Feature works with AI disabled.
- Demo on staging with the CR-1042 fixture.

---

## 13. First two weeks: concrete tasks

1. Create the monorepo: `apps/web`, `apps/api`, `apps/worker`, `packages/domain` (types, state machine, exposure, policy), `packages/ui`, `skills/`, `evals/`, `fixtures/cr-1042/`.
2. Write the domain model and state machine RFC; review with product and design.
3. Implement `packages/domain/exposure` with the golden test first.
4. Implement the state machine transition table and policy table with exhaustive tests.
5. Encode the CR-1042 fixture; label it "Illustrative data" in the UI shell.
6. Stand up CI (lint, typecheck, unit, evaluation smoke) and dev/staging environments.
7. Jira sandbox spike; write findings into the integration RFC.
8. Start the evaluation set with the domain analyst.
