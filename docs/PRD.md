# Competitive Response OS

## Product requirements and prototype handoff

**Product promise:** Turn competitive intelligence into coordinated business actions.

**Version:** 1.0 • **Date:** 9 October 2026 • **Status:** Proposed product for interview discussion and prototype design • **Audience:** CPO, product, design, engineering, and enterprise pilot stakeholders.

This PRD defines an enterprise SaaS product that helps teams detect a competitive development, understand its relevance to their business, agree on a response, coordinate execution, and review results. Design the entire response journey around a durable response case. The prototype should demonstrate business work being completed, with AI supporting analysis and planning inside that workflow.

The supplied conversation establishes the concept and agent architecture. Some earlier brainstorming and the detailed case study were not included in the available transcript. This document consolidates the visible decisions and fills the remaining design requirements with explicit proposals. Personas, financial examples, pricing, targets, timelines, and integrations below are hypotheses to validate, not existing MarketsandMarkets capabilities or customer commitments.

## 1 Product rationale and strategic fit

MarketsandMarkets publicly presents KnowledgeStore as a growth intelligence platform, GrowthIQ as AI-powered strategic intelligence producing strategy documents, and SalesPlay as an AI sales platform. Its website also describes growth programs such as market share gain, TAM expansion, and GTM strategy to execution. Source: https://www.marketsandmarkets.com/ — reviewed 8 October 2026 UTC.

**Product thesis:** Competitive information becomes commercially useful when it changes a decision and produces accountable action. Competitive Response OS would connect market evidence to customer-specific exposure, decision rights, execution systems, and outcome reviews.

The proposed differentiation is the response case and its complete evidence-to-outcome history. Existing research can supply context; the new product owns the coordinated response process. Potential MarketsandMarkets advantages are domain intelligence, connected market context, analyst expertise, and enterprise distribution. Data freshness, coverage, licensing, programmatic access, customer entitlements, and product overlap must be validated before treating those assets as a technical moat.

Two packaging paths remain viable:

- **Standalone SaaS:** An enterprise competitive response workspace using authorized MarketsandMarkets intelligence, public sources, and customer data.
- **Existing platform extension:** A workflow module entered from a KnowledgeStore or GrowthIQ insight, creating a response case with source provenance and entitlement checks preserved.

Use the same case model for both. Validate a narrow workflow before investing in a shared Growth Workflow Agent Platform. Shared infrastructure could later support Market Expansion OS and other growth workflows.

## 2 Problem and desired outcome

Teams discover competitor launches, regulatory developments, pricing changes, partnerships, acquisitions, and market entries through scattered sources. Analysts summarize the news, business teams debate relevance, and leaders request actions over email or meetings. Ownership, evidence, assumptions, and follow-up become disconnected.

The customer needs to answer five questions:

1. What changed, and how do we know?
2. Where does it affect our products, accounts, markets, or opportunities?
3. What responses are reasonable, with what trade-offs?
4. Who approved what, and who will execute it by when?
5. What happened, and should we reassess the decision?

**Desired outcome:** A verified material event moves to an evidence-backed decision and owned action plan faster, with fewer coordination failures and an auditable record.

### Goals

- Reduce time from material signal detection to an approved response.
- Improve relevance and evidence quality of escalated competitive developments.
- Increase action ownership, completion, and timely outcome reviews.
- Connect external market context to authorized internal commercial exposure.
- Make uncertainty, human judgment, and authorization visible throughout.

### Non-goals for the MVP

- Autonomous pricing, commercial offers, customer outreach, or public communications.
- Replacing CRM, Jira, BI, market research, or enterprise planning tools.
- Predicting exact revenue loss or claiming causal revenue protection.
- Broad surveillance of every competitor and every industry.
- A general-purpose agent builder, chat assistant, or five-agent platform before workflow value is demonstrated.

## 3 Initial customer and market wedge

**Proposed initial segment:** Mid-sized and large B2B medical-device companies with a dedicated competitive intelligence or strategy owner, several product lines, and geographically distributed commercial teams.

**Initial workflow wedge:** A competitor announces a diagnostic-device launch or a verified change in regulatory status affecting a monitored European market. A team reviews product overlap and account exposure, then coordinates a positioning update and account review.

This segment is an illustrative starting hypothesis chosen for meaningful product attributes, geographic differences, and cross-functional responses. It requires discovery on source availability, regulatory interpretation, buyer urgency, and willingness to pay. A regulatory status change must not be interpreted as proof of availability, reimbursement, clinical superiority, or sales impact.

Adjacent segments include industrial equipment, enterprise technology, and specialty materials. Expand only after proving one repeatable response workflow. Keep the underlying model industry-neutral and domain procedures versioned.

## 4 Personas and decision rights

| Persona | Job to be done | Main workspace | Proposed authority |
|---|---|---|---|
| Competitive intelligence lead | Filter noise, verify developments, prepare a response case | Signal Inbox and case evidence | Triage signals, edit analyses, propose responses |
| Business unit or strategy leader | Decide whether and how to respond | Decision review | Approve responses within assigned business scope |
| Product manager or product marketing lead | Understand overlap and update positioning or product assessment | Impact and action plan | Review mappings, own assigned deliverables |
| Regional sales leader | Identify affected accounts and coordinate commercial work | Exposure and My Actions | Review scoped accounts and complete assigned actions |
| Executive sponsor | Understand material developments and execution health | Overview and Outcomes | View authorized portfolio summaries; escalate decisions |
| Workspace administrator | Configure data, permissions, sources, policies, and integrations | Settings | Manage configuration; no automatic business approval authority |

**Economic buyer hypothesis:** Head of Strategy, business unit leader, or head of competitive intelligence with cross-functional budget support. **Daily champion:** CI lead. **Collaborators:** Product marketing and regional sales.

An approver's role is scoped by business unit, geography, and response type. Sensitive commercial data remains restricted even when the containing case is shared. Task ownership does not confer approval rights. An admin configuring integrations cannot authorize a commercial response solely because they are an admin.

## 5 Current and future workflow

| Stage | Current workflow | Proposed workflow | Human contribution |
|---|---|---|---|
| Detect | Alerts, research reports, manual browsing | Watchlists and intake create clustered candidate signals | Configure monitoring scope |
| Verify | Search and manually reconcile sources | Evidence, timestamps, contradictions, and verification checklist | Resolve ambiguity and validate material claims |
| Assess | Spreadsheet mapping and stakeholder requests | Product overlap and scoped commercial exposure in one case | Confirm mappings and assumptions |
| Decide | Slides, email chains, meetings | Compare response options and submit a versioned decision package | Select response, rationale, owner, and constraints |
| Execute | Manual handoff to many teams | Approved action plan with internal tasks and controlled external sync | Accept ownership and perform work |
| Review | Ad hoc retrospective | Scheduled outcome review against baseline and measures | Interpret results and decide whether to reopen |

**Canonical journey:** Watchlist → candidate signal → verified signal → response case → impact assessment → response options → decision approval → execution authorization → action plan → outcome review.

Signals and cases are separate: many source items may describe one event, several signals may support one case, and a signal need not become a case. One case may involve several business units; use explicit scoped reviewers rather than duplicating the response without links.

## 6 Core objects and lifecycle

### Signal lifecycle

Candidate → Verifying → Verified, Needs review, or Rejected. A verified signal can be Converted to case, Linked to existing case, or Archived. Duplicate items link to the canonical signal with provenance retained. A source correction can reopen verification and flag dependent cases.

### Response case lifecycle

| State | Entry condition | Available next steps |
|---|---|---|
| Draft | Case owner and signal linked | Start analysis, edit scope, archive |
| Assessing | Analysis requested | Complete assessment or enter Needs information |
| Needs information | Missing evidence, mappings, or data | Add information and resume; defer with review date |
| Ready for decision | Required checks complete; uncertainties disclosed | Submit decision package |
| Awaiting approval | Immutable package version submitted | Approve, request changes, reject, or defer |
| Approved | Authorized approver selects a response | Finalize execution plan or record monitor-only decision |
| Executing | Approved plan released to owners | Track actions, amend through review, pause |
| Monitoring | Plan completed or monitor-only decision scheduled | Review outcomes or reopen assessment |
| Closed | Outcome review recorded with rationale | Reopen with new evidence |
| Archived | Out of scope or duplicate | Restore with history retained |

Decision approval and execution authorization are separate records. For a low-risk internal plan they may occur in a single user flow, but the persisted authorizations remain explicit. External writes require an approved response and an approved plan version. A materially changed scope, exposure assumption, chosen response, or plan invalidates affected pending approvals; previously executed actions are preserved.

AI analysis status is independent of case state: Queued, Running, Partial, Completed, Failed, or Cancelled. A failed analysis must not erase the draft or block manual work.

## 7 Functional requirements

Priorities: **P0** required for first paid-pilot workflow; **P1** next release; **P2** later capability.

### 7.1 Onboarding and monitored scope

- **ONB-01 P0:** Configure business units, product catalog, competitors, geographic markets, owners, and source watchlists.
- **ONB-02 P0:** Import product and exposure CSVs using mapping, validation, duplicate detection, preview, and a dated snapshot. Support manual completion without CRM access.
- **ONB-03 P0:** Connect authorized intelligence and curated public sources. Show availability, freshness, and licensing restrictions.
- **ONB-04 P0:** Assign approvers and execution permissions; test access before activation.
- **ONB-05 P1:** Read-only CRM integration and reusable domain taxonomies.

Acceptance: An admin can activate a watchlist after minimum scope and ownership are configured. Missing commercial data produces “Exposure unavailable” rather than an invented estimate. User can complete a sample case before connecting production data.

### 7.2 Signal intake and triage

- **SIG-01 P0:** Ingest curated feeds, URLs, or manually entered events; preserve original source and observation time.
- **SIG-02 P0:** Extract competitor, product, event type, geography, event date, and claims; flag uncertain entity matches.
- **SIG-03 P0:** Cluster duplicate sources and distinguish independent corroboration from syndicated copies.
- **SIG-04 P0:** Display verification state, source quality, relevance, urgency, and reason for prioritization as distinct attributes.
- **SIG-05 P0:** Triage to dismiss, monitor, create case, or link existing case, recording reason.
- **SIG-06 P1:** Configurable digest and material-event notification rules.

Acceptance: Repeated intake of the same source cannot create duplicate cases automatically. A high-impact rumor remains unverified. Priority can be overridden with a reason. Publish date, event date, and ingestion date remain distinct.

### 7.3 Evidence and verification

- **EVD-01 P0:** Every material factual claim has claim-level provenance, including document location or source excerpt where permitted.
- **EVD-02 P0:** Separate verified facts, AI inferences, human assumptions, and unknowns.
- **EVD-03 P0:** Show contradictory or withdrawn evidence and stale source warnings.
- **EVD-04 P0:** Permit reviewer acceptance, correction, exclusion, and analyst notes, with history.
- **EVD-05 P1:** Analyst escalation for unresolved domain interpretation.

Acceptance: Opening a claim reveals the source, retrieval time, supporting passage, and limitations. No valid evidence produces a missing-evidence state. Excluded evidence stays in history but does not silently support the current conclusion.

### 7.4 Business impact

- **IMP-01 P0:** Propose competitor-to-customer product mappings with comparable attributes and a reviewer confirmation step.
- **IMP-02 P0:** Identify affected geography, segments, business units, and authorized account or revenue records.
- **IMP-03 P0:** Calculate exposure deterministically from selected data snapshots, exclusions, currency, period, and deduplication rules.
- **IMP-04 P0:** Support explicitly assumed scenarios with editable inputs, formulas, and sensitivity ranges.
- **IMP-05 P0:** Show missing data and uncertainty separately from priority and urgency.
- **IMP-06 P1:** Live CRM opportunity exposure and change monitoring.

Acceptance: The same data snapshot and assumptions reproduce the same calculation. Users cannot sum annual revenue and pipeline into an unlabeled “at risk” total. Accounts associated with overlapping products are counted once within the chosen measure. An inferred overlap is marked pending review.

### 7.5 Response options and decisions

- **DEC-01 P0:** Generate evidence-linked options including monitor, positioning update, account review, and product assessment.
- **DEC-02 P0:** Compare expected benefit, effort, time, dependencies, risks, and confidence in assumptions. Avoid unsupported numerical ROI.
- **DEC-03 P0:** Allow a human-created option, option edits, or multiple compatible responses.
- **DEC-04 P0:** Submit a snapshot of scope, evidence, exposure, assumptions, selected response, and proposed measures.
- **DEC-05 P0:** Support approval, changes requested, rejection, and deferral with rationale.
- **DEC-06 P0:** Escalate when the requested response exceeds policy or approval scope.

Acceptance: Approval applies to an exact version, records identity and time, and cannot be supplied by the agent. Pricing-related recommendations require the designated commercial authority and remain assessments rather than automatic execution.

### 7.6 Action planning and execution

- **ACT-01 P0:** Propose editable tasks with owner, due date, dependency, deliverable, completion criteria, and case link.
- **ACT-02 P0:** Require confirmed owners and an authorized plan before release.
- **ACT-03 P0:** Provide an internal task board, overdue view, reassignment history, and deliverable attachments.
- **ACT-04 P0:** Implement one controlled Jira write integration for the pilot, with destination preview, external reference, idempotency, and retry state.
- **ACT-05 P1:** Teams notifications after explicit execution authorization; additional task systems and CRM writes later.
- **ACT-06 P0:** Track internal and external status separately when sync is delayed or disputed.

Acceptance: Retrying a task creation request does not create a duplicate external task. Partial success shows which tasks were created and which failed. The product never says “synced” before confirmation. Revoked approval blocks unexecuted writes. Dependency cycles are rejected.

### 7.7 Outcomes and review

- **OUT-01 P0:** Define baseline, measurement window, review date, metric owner, and intended success before execution.
- **OUT-02 P0:** Collect task completion and manually entered commercial indicators with supporting evidence.
- **OUT-03 P0:** Produce a review summary distinguishing observed change from causal attribution.
- **OUT-04 P0:** Close, extend monitoring, or reopen the case with rationale.
- **OUT-05 P1:** Automated read-only outcome collection and matched comparison analyses where valid.

Acceptance: A completed task is not automatically a successful business outcome. Missing baseline shows “Unable to compare.” Reopening retains the original decision and review history.

### 7.8 Collaboration and governance

- **GOV-01 P0:** Case comments, mentions, assignments, and an append-only activity history.
- **GOV-02 P0:** Tenant, business-unit, case, and field-level access controls.
- **GOV-03 P0:** Versioned analysis, decisions, plans, policies, skills, and calculation inputs.
- **GOV-04 P0:** Export an authorized decision brief with citations and uncertainty preserved.
- **GOV-05 P1:** SSO, provisioning, enterprise retention controls, and customer-controlled deletion policies as required by pilot contracts.

## 8 Information architecture and design principles

Desktop enterprise web application first. Prioritize analysis at 1440px and usable layouts at 1280px. Tablet review can be responsive; mobile authoring is outside initial scope.

**Primary navigation:** Overview, Signal Inbox, Response Cases, My Actions, Outcomes. **Secondary navigation:** Watchlists, Portfolio, Integrations, Settings. Use a global search for cases, competitors, products, and permitted accounts.

**Persistent case header:** Case ID and title, competitor, market, owner, priority, lifecycle state, last updated time, and next required action.

**Case tabs:** Summary, Evidence, Impact, Response Options, Decision, Action Plan, Outcomes, Activity.

Design principles:

- Lead with the next business decision or action, not agent machinery.
- Make evidence and assumptions easy to inspect without overwhelming the main page.
- Keep business priority, evidence strength, and processing status visually distinct.
- Preserve visible context across case tabs and deep links.
- Use semantic labels and accessible colors; never rely on color alone.
- AI text is editable and attributable. Human edits are not silently overwritten.
- Use a structured workspace as the primary interface; optional case-scoped questions can help inspect sources and assumptions.
- Technical run details belong in a secondary panel for operators. Main copy should say “Checking sources” or “Preparing impact assessment.”

## 9 Screen specifications

### Screen 1 Overview

**User:** CI lead or business leader. **Question:** What needs attention now?

Show awaiting decisions, high-priority untriaged signals, overdue actions, and due outcome reviews. Include an active-case table with competitor, event, business scope, owner, state, next step, and age. Add a compact workflow funnel and workload view only where useful. Primary actions: Review signals, Open pending decision, View my actions.

Empty state: Set up watchlist or explore sample case. Loading: Skeletons with stable layout. Error: Partial-data warning with last successful refresh; do not replace all content with a generic error page. Access-limited totals must indicate their scope.

### Screen 2 Signal Inbox

Use a list with a detail panel. Filters: competitor, event type, market, verification, priority, date, and triage state. Each item shows headline, event date, competitor, market, source count, verification status, and relevance reason. Detail includes what changed, source evidence, matched portfolio scope, unknowns, and duplicate links.

Primary CTA: Create response case. Secondary: Link existing case, Monitor, Dismiss. Case creation asks for owner and scope; prefilled fields remain editable. Require a reason for dismissal and overrides. Provide bulk archive only for authorized low-impact triage actions.

### Screen 3 Case Summary

Present “What happened,” “Why it matters,” affected business scope, evidence status, exposure summary, open questions, current decision, and next required action. Include a lifecycle indicator and concise activity timeline. Display “Analysis incomplete” prominently when applicable.

Primary CTA depends on state: Start assessment, Resolve missing information, Submit for decision, Review decision, Release plan, or Review outcomes. A static button must not imply an action is permitted when the user lacks the role.

### Screen 4 Evidence Workspace

Claim list on the left; selected source or permitted excerpt on the right. Each claim has type, verification state, supporting and contradicting sources, source date, reviewer, and notes. Enable accept, correct, exclude, and request review. Provide entity-match inspection and original-source links.

Do not render paywalled or licensed full text without entitlement. Show unavailable source, withdrawn claim, conflict, stale evidence, and no-corroboration variants.

### Screen 5 Impact Workspace

Show product overlap comparison, affected segments and accounts, annual revenue exposure, pipeline separately, data freshness, and scenario assumptions. Product comparison displays application, customer segment, attributes, geography, and limitations rather than a single unexplained similarity score.

Exposure panel contains definition, currency, period, snapshot date, filters, deduplication, exclusions, and calculation drill-down. Scenario controls are optional assumptions, not predictive model output. Allow manual upload, request access, or proceed with qualitative analysis when data is absent.

Primary CTA: Confirm assessment. Secondary: Edit mappings, Update assumptions, Request data. Redacted account rows must not leak restricted values through totals or tooltips.

### Screen 6 Response Options

Compare Monitor, Update positioning, Account review, and Product assessment. Each option includes rationale, evidence, expected benefit, effort, decision deadline, dependencies, risks, and proposed success measures. Clearly mark the recommended option and its reasoning, while allowing users to select another option or combine compatible options.

Provide Add option, Edit option, Select response, and Preview decision package. No automatic option selection based solely on financial exposure.

### Screen 7 Decision Review

A readable versioned brief includes event, confirmed facts, exposure definition, assumptions, chosen responses, alternatives, requested resources, owners, and success measures. Approver sees scope and authorization level.

Primary CTA: Approve response. Alternatives: Request changes, Reject, Defer. Confirmation captures rationale and any constraints. Show who else must approve if policy requires multiple approvers. Submitted snapshots remain immutable; amendments create a new version.

Design variants: Waiting on another approver, superseded version, approval expired or invalidated, role insufficient, and monitor-only approval.

### Screen 8 Action Plan

Default table with task, owner, deliverable, due date, dependency, status, external reference, and completion evidence. Optional Kanban view. Task drawer supports edit, comments, reassignment, and attachments.

Separate Draft plan from Released plan. Primary CTA: Authorize and release plan. A preflight panel previews external task destination, exact records, notifications, and authorization. Show success, partial creation, retry, revoked approval, and disconnected integration. “Generate plan” creates drafts only.

### Screen 9 My Actions

Owned work sorted by due date and priority. Show blocked dependencies, missing deliverables, and case context. Actions: Accept assignment, Mark in progress, Attach deliverable, Submit completion, Flag blocker. Completion may require reviewer acceptance according to task policy.

### Screen 10 Outcomes

For each case show baseline, review period, intended targets, action completion, observed commercial indicators, evidence, limitations, and review recommendation. Primary CTA: Record review. Options: Close case, Continue monitoring, Reopen assessment.

Portfolio view emphasizes decision speed, action completion, and review discipline. Avoid unsupported “Revenue saved by AI” cards.

### Screen 11 Watchlists and Portfolio

Configure monitored competitors, product mappings, markets, event types, routing owner, thresholds, and digest preferences. Portfolio import supports field mapping, validation errors, missing values, duplicate records, and snapshot history. Preview “What would have been surfaced” using permitted historical examples.

### Screen 12 Integrations and Settings

Show connection status, read/write scope, granted permissions, last successful sync, freshness, and authorized destinations. Role configuration includes approver coverage and escalation rules. Expose audit history, retention, and analysis-policy controls to permitted admins.

## 10 Prototype narrative and fixture data

All names, sources, events, figures, and dates in this section are fictional. The prototype must visibly label its dataset as illustrative. Do not imply an actual regulatory approval.

**Customer:** Northstar Diagnostics. **Competitor:** Apex Diagnostics. **Customer product:** ND-200. **Competitor product:** AX-Scan. **Case:** CR-1042, “Apex AX-Scan Germany launch response.” **CI lead:** Maya Patel. **Approver:** Elena Fischer, Diagnostics Business Unit Head. **Product marketing owner:** Jonas Weber. **Regional sales owner:** Sofia Klein.

Use a simulated manufacturer launch notice with a separate regulatory-status source requiring verification. The workflow must verify the precise status rather than infer it from the launch announcement. The analyst confirms overlap in one use case, with clinical-performance equivalence unresolved.

### Consistent exposure fixture

| Measure | Illustrative value | Definition |
|---|---|---|
| Relevant annual revenue | €24 million | Trailing 12-month ND-200 revenue in the selected German segment |
| Affected existing accounts | 18 | Distinct accounts matching confirmed product and segment scope |
| Open pipeline | €6 million | Current opportunity amount; separate from recognized revenue |
| Scenario assumption | 5–15% | User-assumed erosion of relevant annual revenue over a future 12-month period |
| Scenario range | €1.2–3.6 million | €24 million multiplied by assumed erosion; not predicted loss |
| Recommended review | 30 days | Observe task completion and account-review findings |

Never add €24 million revenue and €6 million pipeline into a single risk estimate. Display date, data coverage, and attribution limitations. Use a fixed fictional snapshot throughout the prototype.

### Main demonstration journey

1. Maya opens a high-priority signal, inspects evidence, verifies event scope, and links duplicate notices.
2. She creates CR-1042, confirms product overlap, sees 18 accounts and separate exposure measures, and edits an assumption.
3. AI proposes four response options. Maya chooses positioning update plus account review and previews the decision package.
4. Elena reviews evidence and uncertainty, requests one clarification, then approves the revised response.
5. Maya finalizes owners and deadlines, authorizes a plan, and creates internal and Jira tasks using a destination preview.
6. One task sync fails. The workspace retains successful external references and safely retries only the failed task.
7. Jonas attaches a reviewed battlecard; Sofia records account-review completion. The case moves to Monitoring.
8. At day 30, Maya records observed results and limitations; Elena chooses continued monitoring or closes the case.

### Proposed tasks

| Task | Owner | Due | Completion evidence |
|---|---|---|---|
| Validate competitor claims and comparison limits | Product manager | Day 2 | Reviewed comparison with citations |
| Update Germany positioning brief | Jonas | Day 5 | Approved document |
| Review 18 affected accounts | Sofia | Day 10 | Account review summary with restricted details |
| Review early response outcomes | Maya | Day 30 | Baseline comparison and recommendation |

### Required alternative prototype flows

- Unverified high-impact signal: cannot be presented as a confirmed event; route to review.
- Missing CRM data: use qualitative assessment or dated CSV import.
- Low-confidence overlap: human confirmation before exposure calculation.
- Changed evidence after approval: warn, pause unexecuted writes, and require reassessment.
- No response warranted: approve monitor-only with owner, trigger, and review date.
- Restricted account access: meaningful redaction without information leakage.
- Rejected response: preserve rationale and permit a revised package.
- Partial analysis or external sync failure: retain work and show recovery steps.

## 11 AI and agent architecture

### Architecture responsibilities

| Layer | Responsibility |
|---|---|
| Application | Signal Inbox, Impact Workspace, Decisions, Actions, Outcomes |
| Agent harness | Context assembly, lifecycle, tool permissions, memory reconstruction, budgets, tracing, evaluations, checkpoints, and guardrails |
| Bounded supervisor | Plan analysis, delegate when justified, consolidate findings, and request decisions |
| Domain skills | Reusable validated procedures for verification, overlap, exposure, options, and planning |
| Tool gateway and MCP adapters | Authorized structured access to intelligence and enterprise tools |
| Deterministic workflow engine | State transitions, approval gates, durable waits, retries, business rules, and event history |
| System of record | Tenant-scoped cases, evidence, versions, decisions, plans, actions, and outcomes |

The harness governs how agents reason and use tools. The workflow engine governs the authoritative business process. Agent memory is not the system of record; relevant context is reconstructed from durable authorized state.

### Conceptual specialized agents

| Agent | Responsibility | Boundaries |
|---|---|---|
| Signal Intelligence | Classify, deduplicate, verify, and resolve entities | Cannot certify unsupported claims or write commercial records |
| Business Impact | Map products and affected business scope | Deterministic tools calculate exposure; humans confirm uncertain mappings |
| Response Strategy | Propose options and trade-offs | Cannot approve or commit commercial changes |
| Execution Planning | Draft tasks, owners, dependencies, and milestones | Execution occurs only through authorized tools after approval |
| Supervisor | Coordinate bounded analysis and assemble the package | Cannot bypass policy or invent missing evidence |

**MVP implementation:** One bounded analysis agent with several skills and deterministic services. Introduce specialist sub-agents only when evaluations show better accuracy, reliability, latency, or cost. The conceptual target architecture does not require five separate agents at launch.

### Skill contracts

- **event-verification:** source hierarchy, event classification, date interpretation, independent corroboration, contradictory evidence, structured claims.
- **competitive-product-overlap:** industry attributes, comparison procedure, regulatory interpretation limits, evidence requirements, valid and invalid examples.
- **revenue-exposure-analysis:** permitted retrieval, denominator definition, period/currency checks, missing data handling, deduplication, deterministic calculation invocation.
- **response-option-assessment:** feasible response types, alternatives including monitor, effort and dependency checks, uncertainty, escalation boundaries.
- **execution-plan-drafting:** task templates, roles, dependency checks, completion criteria, approved-scope checks.
- **outcome-review:** baseline comparison, evidence collection, confounders, non-causal language, review recommendation.

Each skill includes version, owner, supported domain, required inputs, allowed tools, output schema, examples, and evaluation cases. Skills provide procedures; MCP tools provide access. Neither replaces access controls or approval rules.

### Structured analysis output

Return event summary, claims with evidence IDs, entity matches, proposed product mappings, affected scope, exposure calculation references, assumptions, unknowns, options, proposed tasks, and required human checks. Validate schemas before storage. Unsupported statements are rejected or explicitly marked as hypotheses; they cannot silently appear as facts.

### Proposed MCP and tool interfaces

These are proposed contracts, not existing MarketsandMarkets APIs.

| Tool | Access | Required controls |
|---|---|---|
| marketsandmarkets.search_market_intelligence | Read | Tenant entitlement, licensed content limits, provenance |
| sources.get_event_evidence | Read | Approved source scope, safe retrieval, source metadata |
| portfolio.match_competing_products | Read | Tenant isolation, attribute evidence, candidate matches |
| crm.get_revenue_exposure | Read | Authorized fields and scope, snapshot and currency metadata |
| exposure.calculate_scenario | Compute | Validated deterministic inputs and formula version |
| jira.create_response_tasks | Write | Approved case and plan versions, execution identity, destination, idempotency |
| teams.send_case_notification | Write | Approved recipients/destination and content, scoped authorization |

MCP is a useful standardized integration mechanism; existing APIs and scheduled ingestion may be preferable for some operations. Customer integrations are not assumed to exist merely because tool names are specified.

### Harness requirements

Agent and skill registry; context management; tool gateway; tenant-scoped permissions; model/tool/time/cost budgets; checkpointing; traces; evaluations; human review; audit; versioned policy. Optional signed approval artifacts can be explored for higher-assurance enterprise requirements. Cryptographic signing must not be marketed as proving correctness, human intent, or compliant authorization by itself.

### Security and reliability

External websites and documents are untrusted evidence, never instructions. Strip or isolate active content; deny privilege changes originating in retrieval. Apply least privilege per agent and tenant. The research agent has no CRM write access. Every consequential tool call is checked against current authorization at execution time.

Store append-only workflow events alongside transactional application state. Use an outbox and stable idempotency keys for external side effects. After ambiguous timeouts, reconcile external state before retrying. Resume durable workflows after long approvals without relying on a live model session. Do not overwrite reviewer edits during regeneration.

## 12 Data model

All entities carry tenant ID, ID, creation/update metadata, and applicable authorization scope. Avoid putting restricted commercial values into unrestricted logs or agent context.

| Entity | Key fields and relationships |
|---|---|
| Tenant and BusinessUnit | Policy, locale, currency, units, membership |
| User and RoleAssignment | Identity, role, scope, approval authority |
| Competitor | Name, aliases, entity identifiers, products |
| Product | Customer or competitor ownership, attributes, segments, geographies |
| Watchlist | Competitors, products, markets, event types, owner, routing rules |
| SourceDocument | URL/reference, publisher, event/publish/ingestion dates, hash, entitlement, permitted snapshot |
| EvidenceClaim | Statement, fact/inference/assumption, verification, supporting/contradicting documents, reviewer |
| Signal | Event type, entities, geography, claims, verification, duplicate links, triage |
| ResponseCase | Signals, scope, owner, priority, state, current assessment and plan versions |
| ProductMapping | Product pair, attribute comparison, evidence, reviewer decision |
| ExposureSnapshot | Source records, period, currency, filters, coverage, snapshot time |
| ImpactAssessment | Mappings, exposure snapshot, calculation references, assumptions, unknowns, version |
| ResponseOption | Rationale, benefit, effort, risks, dependencies, measures, evidence |
| DecisionPackage | Immutable selected assessment/options/scope version submitted for approval |
| Approval | Actor, authority, package version, disposition, rationale, time, constraints |
| ActionPlan | Approved decision reference, version, owners, dependencies, release authorization |
| ActionTask | Deliverable, due date, owner, status, evidence, external refs and sync state |
| OutcomeReview | Baseline, measures, window, observations, evidence, limits, disposition |
| AgentRun | Version, inputs/context refs, skill/tool versions, outputs, budget, trace, review status |
| IntegrationConnection | Provider, scopes, destination, secret reference, health, sync cursor |
| AuditEvent | Actor, event type, object/version, timestamp, authorization and correlation IDs |

Relationship summary: sources support claims; claims support signals; signals link to cases; cases have versioned assessments and options; decision packages snapshot those versions; approvals authorize selected responses; plans carry execution authorization; tasks link to plans and external records; reviews evaluate cases over time. Many-to-many case-to-signal and claim-to-source links preserve shared evidence without duplicating it.

## 13 Prioritization and uncertainty

For the prototype use explainable High, Medium, and Low priority, based on affected business scope, time sensitivity, and strategic importance. Display evidence strength separately as Verified, Partial, Conflicting, or Unverified. Allow overrides with rationale.

Do not present a generated “confidence 93%” as calibrated probability. If numerical scoring is later adopted, validate calibration and publish its interpretation. Priority is a triage aid; approval eligibility depends on explicit required checks and policy, not a score alone.

## 14 MVP and phased roadmap

| Phase | Included | Exit criterion |
|---|---|---|
| Discovery and concierge validation | Interviews, past-case reconstruction, manual end-to-end trials, data/licensing assessment | Repeated workflow pain, identifiable buyer, usable evidence and data |
| V1 paid-pilot MVP | One segment and event family; watchlists; curated/manual intake; evidence; CSV exposure; bounded agent; options; approval; internal tasks; one Jira write path; manual outcome review | Teams complete real cases and demonstrate repeatable workflow benefit |
| V2 specialization | Read-only CRM, stronger ingestion, domain skill library, specialist agents where justified, Teams, richer monitoring | Measurable quality or efficiency gains over V1 |
| V3 policy-controlled autonomy | Auto-refresh evidence, draft follow-ups, low-risk internal actions under explicit policies | Sustained evaluations, recoverability, security, and operational evidence |

Autonomy expands first for reversible analysis and draft creation. Pricing, customer communication, and consequential commercial changes retain explicit human authorization.

**Proposed planning assumption:** 10–12 weeks for a narrowly integrated pilot after discovery and access approval. This is an estimate requiring engineering sizing. Suggested sequence: discovery and data validation; case/evidence foundation; assessment/decision flow; execution integration; outcome review and hardening.

## 15 Monetization and go-to-market

**Value metric hypothesis:** Business units and monitored competitive scope, with collaborators included to encourage execution. Avoid charging per AI answer or creating incentives for unnecessary agent activity.

Proposed commercial model: annual platform subscription covering a defined business unit, monitored competitors/markets, core workflow, and analysis allowance; optional enterprise integration/governance package; separately transparent intelligence entitlements and analyst services. Avoid double-charging existing subscribers for the same licensed content.

**Illustrative willingness-to-pay tests:** Paid design-partner pilot at US$10,000–20,000 for 8–12 weeks; initial annual package at US$40,000–80,000 for one business unit; enterprise expansion priced by scope and integrations. These are interview hypotheses, not established prices, benchmarks, or forecasts.

Start with existing MarketsandMarkets customers who already perform recurring competitive reviews and have a named execution owner. Run 3–5 design partnerships around recent real cases. Sell the reduction in decision and coordination friction; validate intelligence entitlements and willingness to pay separately. Expand into additional business units after a repeatable response loop. Self-service broad-market acquisition is later.

## 16 Success metrics and instrumentation

**North star:** Monthly material response cases reaching a documented decision and an owned plan, with a scheduled outcome review. Report monitor-only decisions separately so the measure does not reward unnecessary execution.

| Metric | Definition | Proposed pilot target |
|---|---|---|
| Time to approved decision | Median elapsed time from verified material signal to approved response | 30% below matched historical baseline |
| Time to first useful case | Setup completion to first reviewer-accepted decision-ready case | Within 7 days |
| Escalated signal relevance | Expert-labeled relevant signals / reviewed escalated signals | At least 80% |
| Supported material claims | Claims passing expert evidence review / sampled material claims | At least 95%; 100% require provenance or explicit unknown label |
| Action ownership | Released tasks with accepted accountable owner and due date / released tasks | At least 95% |
| On-time completion | Tasks completed with required evidence by due date / due tasks | At least 80% |
| Outcome review discipline | Cases reviewed by agreed date / cases due for review | At least 75% |
| Unauthorized writes | External writes lacking current authorization | Zero |
| Duplicate side effects | Duplicate external tasks from retries | Zero |
| Recurring workflow adoption | Pilot teams completing at least two real response cycles | At least 3 of 5 teams |

Targets are validation hypotheses and need baseline adjustment. Track estimated analyst time saved, active multi-role collaboration, case reopening, overrides, edits, and abandonment. Estimate signal recall through a curated historical event set, since production recall cannot be measured from surfaced signals alone.

Instrument signal_created, signal_verified, signal_dismissed, case_created, analysis_started/completed/failed, evidence_reviewed, mapping_confirmed, assessment_confirmed, option_selected, decision_submitted, approval_recorded, plan_authorized, external_write_confirmed/failed, task_completed, outcome_reviewed, and case_reopened. Include tenant-scoped identifiers, versions, timestamps, and permitted role metadata. Do not log raw restricted evidence in general analytics.

Commercial measures: pilot-to-paid conversion, annual recurring revenue, scope expansion, renewal, analysis cost per completed case, onboarding effort, and gross margin. Revenue movements are observed outcomes unless a defensible causal evaluation establishes attribution.

## 17 Evaluation and release requirements

### AI evaluations

Use an expert-labeled test set covering real or authorized historical events, syndicated duplicates, contradictory sources, entity ambiguity, changing regulatory status, weak product overlap, stale commercial data, multilingual evidence, prompt injection, and missing data. Hold out cases for evaluation and preserve dataset provenance.

Evaluate verification precision, missed material signals, claim support, product-match quality, exposure reproducibility, option feasibility, plan completeness, correction rate, cost, and latency. Compare the bounded agent against manual and simpler deterministic approaches before adding sub-agents.

### Reliability and nonfunctional targets

Proposed pilot service targets: 99.5% application availability excluding agreed maintenance; ordinary navigation p95 under 2 seconds excluding external dependency delays; bounded analysis usually under 5 minutes with progress and partial results; resumable processing after failure. These targets require sizing and are not guarantees.

Enforce tenant isolation server-side, encrypt data in transit and at rest, use managed secrets, retain only authorized content, and establish pilot-specific residency, retention, backup, recovery, and model-provider data policies. Target WCAG 2.2 AA interaction patterns. Support keyboard navigation, readable evidence, accessible tables, and status labels. Avoid mixing currencies or dates without explicit interpretation.

Release gates: scenario tests pass; no approval bypass; reproducible calculations; no duplicate tasks under retries; evidence traceability; scoped access verified; missing-data paths usable; manual operation possible when AI fails; security review completed for live integrations.

## 18 Risks and product trade-offs

| Risk | Product response | Evidence needed |
|---|---|---|
| Becomes another alert feed | Own decisions, assignments, and reviews | Real cases reaching action and review |
| Customer declines internal data access | CSV and qualitative path with limitations | Useful cases without live CRM |
| Weak freshness or event coverage | Curated narrow scope and source metadata | Historical coverage assessment |
| Overstates financial impact | Separate exposure from assumed loss | Reviewer trust and reproducible formulas |
| Existing products already meet the need | Validate boundaries and shared entry points | Customer workflow interviews and portfolio review |
| Jira already coordinates tasks | Own evidence and decision context; sync execution | Measurable reduction in handoff friction |
| Agents add cost and variability | Start bounded; split only with evaluation gains | Quality, latency, and cost comparisons |
| Recommendations are too generic | Industry skills and customer-specific mappings | Reviewer acceptance and edit rates |
| Approval friction slows response | Scope-aware policy and low-risk combined flows | Faster decisions without authority bypass |
| Commercial impact is hard to attribute | Measure workflow first, disclose confounders | Baselines and credible comparison design |

**Key trade-off:** Narrow domain depth over broad coverage for V1. The product must earn trust on a complete workflow before promising autonomous response across industries.

## 19 Discovery questions and unresolved decisions

1. Which buyer owns competitive response budget and cross-functional authority?
2. What event types repeatedly lead to business action rather than interesting reading?
3. How many material cases occur per team each month, and what delays them today?
4. Which intelligence assets are current, licensed, and accessible programmatically?
5. Does the proposed workflow overlap with GrowthIQ or SalesPlay, and where should a case start?
6. Which internal product and commercial data can pilot customers share?
7. Which responses need separate legal, regulatory, or commercial approval?
8. Which task system and notification destinations should the first connector support?
9. Is analyst review required as a service or only optional escalation?
10. What pricing unit aligns with value without limiting collaboration?

Prototype work may proceed using the stated fixture, default roles, and proposed policies. Production implementation depends on discovery and customer authorization.

## 20 Design agent handoff instructions

Create a coherent enterprise desktop prototype demonstrating the complete CR-1042 journey. Prioritize Screens 2–8 and 10. Include Overview, My Actions, Watchlists, Portfolio import, and Integrations as navigable supporting views.

Deliver:

- A sitemap and the primary journey with role handoffs.
- High-fidelity screens using one consistent case and dataset.
- Working interactions for signal triage, evidence inspection, assumption editing, option selection, approval with changes, plan release, partial sync recovery, task completion, and outcome review.
- A component set for source references, verification tags, uncertainty notices, exposure summaries, approval controls, version selectors, task status, and activity history.
- Empty, loading, partial, failed, restricted, stale, conflicting, and approval-invalidated states.
- Clear distinction between V1 implemented workflow and future concepts. Do not imply that live APIs or autonomous commercial execution exist.

Use a restrained visual style, strong typography, clear tables, and generous evidence-reading space. Status colors should be semantic and supplemented by labels. Keep the fictional-data indicator visible. Display user-facing business progress rather than harness, MCP, or sub-agent terminology.

**Prototype acceptance:** A reviewer can follow the event to evidence, explain the exposure calculation, identify who made the decision, see exactly what was authorized and assigned, recover a failed task sync, and understand the limits of the outcome claim without needing a separate verbal explanation.

**Suggested opening design prompt:** “Design Competitive Response OS using this PRD as the product specification. Build the fictional Northstar Diagnostics CR-1042 journey from signal verification through impact, approval, coordinated actions, and outcome review. Preserve the stated numbers, human authorization boundaries, evidence provenance, lifecycle states, and failure paths. Make the response case the primary workspace and AI analysis a supporting capability.”
