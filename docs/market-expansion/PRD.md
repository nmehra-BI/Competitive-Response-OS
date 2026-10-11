# Market Expansion OS
## Product requirements and prototype handoff

**Working tagline:** Turn market opportunities into validated expansion decisions and coordinated execution.

**Document version:** 0.1 · 9 October 2026

**Status:** Proposed 0→1 product; discovery and design specification. Market Expansion OS is a candidate first application on Growth OS, not a committed launch sequence. All organizations, people, scenarios, financial figures, prices, targets, and schedules below are illustrative hypotheses unless explicitly described as supplied context. This document specifies a product concept, not capabilities already available from MarketsandMarkets.

## 1. Product thesis and platform vision

Enterprises can discover a promising market and still struggle to decide whether they can win, test the underlying assumptions, secure investment, and coordinate entry. Market Expansion OS maintains the complete case from strategic mandate to evidence, validation, approved pilot, execution, and review. Its unit of work is an **expansion case**, not a research report or chat conversation.

Growth OS is the proposed umbrella platform. Market Expansion, Competitive Response, Account Growth, and Innovation are focused workflow applications. They share enterprise context, evidence, identity, approval primitives, work management, agent execution, integrations, and measurement. Each app retains its own analysis, domain objects, stage gates, and screens. A competitive withdrawal can seed an expansion case; an approved pilot can seed an account-growth play, while preserving source lineage and requiring a receiving owner to accept the handoff.

The long-term vision is an enterprise growth decision and execution layer informed by market intelligence. Build reusable foundations while proving one app. A general-purpose app builder, autonomous strategy executive, or universal agent marketplace is outside the initial scope.

### First-app selection

Market Expansion is a strong strategic-fit hypothesis given the supplied TAM expansion and GTM programs. Competitive Response may have a shorter feedback loop and more frequent triggers. Choose the first app through discovery rather than treating platform ambition as proof of demand.

| Selection gate | Evidence required | Consequence |
|---|---|---|
| Pain and ownership | Named buyer, recurring operating team, expensive current delays | No named accountable owner: narrow the segment or reject the hypothesis |
| Frequency | Multiple active cases or a recurring planning process | Infrequent annual use: reconsider packaging or start with Competitive Response |
| Data feasibility | Licensed evidence plus accessible product, customer, cost, and capacity inputs | Missing integrations: test with controlled upload; do not promise live data |
| Workflow willingness | Team will conduct decisions and pilots inside the product | Report-only demand: insufficient proof for a workflow app |
| Commercial commitment | Design partner commits resources and a credible paid-pilot path | Enthusiasm without commitment does not establish demand |
| Evaluation speed | Pilot can expose decision and execution value within a bounded period | Long investment horizon: measure intermediate value and compare alternatives |

Proposed discovery: interview 8–12 organizations, recruit 3–5 design partners, and retrospectively reconstruct 2–3 expansion decisions per partner. These counts are planning assumptions, not validated targets. Investigate cases abandoned, delayed, successful, and failed to avoid survivorship bias.

## 2. Initial customer and wedge

**Initial hypothesis:** Established B2B manufacturers evaluating an existing product in a new customer segment or geography, using a small cross-functional growth team. They have usable product economics and market evidence, but fragmented planning across presentations, spreadsheets, email, and task tools. Narrow to one industry and one expansion type after discovery.

The prototype uses an industrial water-monitoring supplier assessing an existing product for German food-processing plants. This is a fictional scenario and does not assert regulatory eligibility or actual market demand.

### Personas and authority

| Persona | Relationship | Primary job | Product authority |
|---|---|---|---|
| Chief Strategy Officer / business-unit leader | Economic buyer, sponsor | Allocate growth investment with defensible assumptions | Approves investment within delegated limits |
| Strategy / market intelligence lead | Primary daily operator, case owner | Build and maintain an evidence-backed expansion thesis | Edits case; requests gates; cannot self-approve unless policy permits |
| CMO / regional commercial leader | GTM contributor and pilot owner | Test routes to customers and execute positioning/channel plan | Owns pilot deliverables and commercial review |
| CRO / sales leader | Commercial reviewer | Validate demand, account access, buying process, and pipeline | Confirms commercial assumptions and sales capacity |
| Product / innovation lead | Feasibility contributor | Determine product fit, adaptations, and differentiation | Signs product-readiness assessment |
| Finance partner | Economics reviewer | Validate margins, cash requirement, and assumptions | Signs economic review; approval according to policy |
| Legal / regulatory specialist | Expert reviewer | Assess market-entry obligations and evidence gaps | Confirms or blocks readiness; AI cannot provide authorization |
| Tenant administrator | Administrator | Configure identity, sources, approval policies, and tools | No automatic business approval authority |

Executive buyers need portfolio exposure, decisions awaiting approval, and allocation visibility. Operating users need evidence, calculations, disagreements, experiments, owners, and deadlines. Read-only reviewers should be able to understand a decision without navigating every working artifact.

### Jobs-to-be-done

1. When leadership sets a growth objective, translate it into bounded search criteria and an accountable expansion mandate.
2. When attractive markets emerge, compare their attractiveness and our ability to win using comparable evidence.
3. When a thesis depends on uncertain assumptions, design validation work that can change the decision.
4. When requesting investment, present a versioned business case with alternatives, limitations, and resource needs.
5. When a pilot is approved, coordinate product, sales, marketing, finance, and specialist work without losing decision context.
6. When results arrive, compare them with the approved baseline and decide to stop, revise, extend, or scale.

## 3. Outcomes and scope boundaries

Success means teams make more timely, evidence-backed decisions and complete meaningful validation and pilot work. The system must also support a well-supported **no-go**; expansion volume alone is a poor success metric.

In scope: mandate definition; opportunity discovery and comparison; evidence-backed sizing; fit and feasibility; scenario economics; experiments; gates; pilot planning; task handoff; outcome reviews. Out of scope for MVP: purchasing media, contacting prospects, launching campaigns, entering contracts, changing prices, autonomous capital allocation, production ERP integration, legal opinions, and acquisition execution.

KnowledgeStore, GrowthIQ, and SalesPlay are potential adjacent offerings based on discussion context. Before implementation, establish actual product boundaries, entitlements, data rights, and integration contracts. Do not assume any published API or invent intelligence coverage. Prefer extending a proven workflow gap over duplicating an existing offering.

## 4. Current and future workflow

| Stage | Current workflow hypothesis | Future workflow | Decision artifact |
|---|---|---|---|
| Mandate | Growth target discussed; constraints implicit | Sponsor approves scope, constraints, owner, and success definition | Mandate |
| Discovery | Analysts combine research and spreadsheets | Candidate opportunities linked to evidence and search criteria | Opportunity shortlist |
| Assessment | Inconsistent TAM slides and subjective ranking | Transparent sizing, fit, feasibility, economics, and uncertainty | Expansion thesis |
| Validation | Assumptions remain untested or interviews disconnected | Experiments linked to decision-critical assumptions | Validation plan and results |
| Investment | Presentation and approvals scattered | Versioned pilot request with budget, conditions, dissent, and stop rules | Approved pilot baseline |
| Pilot / GTM | Action list loses link to thesis | Owners execute linked deliverables; milestone reviews collect evidence | Pilot plan and progress |
| Review | Results selectively reported | Actuals versus baseline with attribution limitations | Stop / revise / extend / scale decision |

### Lifecycle and stage gates

Opportunity candidates: **Detected → Shortlisted → Converted**, or **Dismissed / Duplicate**. These are separate from expansion-case status.

Expansion cases: **Draft mandate → Discovery → Assessment → Validation → Pilot approval pending → Pilot approved → Pilot running → Review due → Scale approval pending → Scaling → Closed**. Cases can enter **On hold** from active states and **Stopped** through an authorized decision. An approved pilot is authorization for its stated scope and budget only; it is not market-entry or scale approval.

| Gate | Preconditions | Decision owner | Output |
|---|---|---|---|
| G0: Scope approved | Sponsor, objective, constraints, owner, scope | Sponsor | Approved mandate |
| G1: Validate thesis | Evidence inventory, comparable sizing, material unknowns, feasibility blockers | Case owner + designated reviewers | Validation plan approval |
| G2: Pilot investment | Validation results, finance review, readiness, budget, stop rules, accountable pilot owner | Authorized investment approver | Approved pilot snapshot or revision / no-go |
| G3: Scale / enter market | Pilot actuals, readiness reassessment, updated economics, capacity, approved scale budget | Authorized investment committee / sponsor | Scale authorization, extension, or stop |

Gate decisions capture approver identity, scope (budget, geography, segment and milestones), owner, expiry, version, rationale, conditions, timestamp, and delegated authority. Material changes to geography, product, spend ceiling, or assumptions invalidate affected approvals and return the case for review. Completing tasks does not automatically pass a gate. Policy defines what counts as material; uncertain cases escalate.

## 5. Functional requirements and acceptance criteria

Priority P0 means MVP required; P1 means next validated increment.

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| ME-01 | P0 | Create mandate with objective, product, segment, geography, budget constraints, owner, horizon | Required fields validated; scope saved as a version; reviewer can approve or return with reasons |
| ME-02 | P0 | Ingest licensed market evidence and authorized uploads | Each source retains origin, date, permission scope, and ingestion status; unavailable content is never fabricated |
| ME-03 | P0 | Generate and manually create opportunity candidates | Each recommendation explains mandate fit and supporting evidence; operator can dismiss, merge duplicates, or shortlist |
| ME-04 | P0 | Compare opportunities consistently | Comparison uses common units and time horizon; missing values visibly missing; ranking formula and weights inspectable |
| ME-05 | P0 | Build versioned TAM/SAM/SOM | Inputs link to evidence or assumptions; units and population overlap validated; deterministic calculation output reproducible |
| ME-06 | P0 | Assess ability to win and readiness | Product fit, competition, access, channel, capacity, and legal readiness have named reviewers; unresolved blockers remain visible |
| ME-07 | P0 | Model unit economics and scenarios | Base/upside/downside assumptions editable; formulas reproducible; recurring contribution and one-time spend shown separately |
| ME-08 | P0 | Maintain assumption register | Assumption has owner, confidence basis, decision sensitivity, validation method, due date, and status |
| ME-09 | P0 | Run validation work | Experiment links to assumption, threshold, sample method, budget and results; failed or inconclusive evidence can change thesis |
| ME-10 | P0 | Prepare investment decision package | Snapshot includes alternatives, evidence, assumptions, economics, blockers, validation, budget, and dissent |
| ME-11 | P0 | Enforce approvals and authority | Only authorized identity can approve correct snapshot; expired or changed case cannot execute against stale approval |
| ME-12 | P0 | Generate coordinated pilot plan | Tasks have accountable owner, dependency, due date, deliverable and case reference; missing owner prevents activation |
| ME-13 | P0 | Export / create approved tasks in one integration | Dry-run preview and idempotency prevent duplicate tasks; failed writes show retryable status without falsely reporting success |
| ME-14 | P0 | Capture results and review | Actuals compared with baseline; source and measurement period visible; sponsor records stop/revise/extend/scale decision |
| ME-15 | P0 | Explain analysis and allow correction | User can inspect evidence and calculation lineage, dispute output, edit assumptions and regenerate dependent analyses |
| ME-16 | P0 | Maintain role and tenant access | Unauthorized sources/fields not sent to models, returned in searches, or exposed through summaries |
| ME-17 | P0 | Maintain audit trail | Every state change, evidence correction, approval and external write attributable and timestamped |
| ME-18 | P1 | Cross-app handoff | Receiving app creates a draft with origin ID and permission checks for destination viewers; source approval does not transfer; rejected handoff leaves original intact |
| ME-19 | P1 | Portfolio allocation view | Compare approved budgets, pipeline of cases, risks and actuals without equating incompatible market estimates |
| ME-20 | P1 | Monitor material changes | New evidence flags affected assumptions; triggers reassessment rather than silently rewriting approved baseline |

## 6. Illustrative sizing, economics and prototype story

### Fictional organization and cast

**Aster Industrial Systems**, supplier of water-monitoring systems. Sponsor: Elena Fischer, business-unit VP. Operator: Maya Rao, strategy lead. Finance reviewer: Daniel Weber. Pilot owner: Jonas Klein, regional commercial lead. Product reviewer: Priya Shah. Specialist reviewer: Lena Hoffmann. These are synthetic identities.

Mandate: evaluate German food-processing plants for an existing monitoring solution, with a 90-day pilot, up to €120,000 pilot spend, and a separate later scale decision. Proposed account pool is synthetic, not a factual market estimate.

### Sizing rules

Define a consistent market unit: annual spend on the specified monitoring solution, for unique eligible sites, in one geography and reference year. Store currency, year, product boundary, unit, and whether estimates include hardware, software, services, or replacement cycles. Do not add annual recurring software to one-time equipment spend without an explicit annualization method.

| Measure | Illustrative calculation | Interpretation |
|---|---|---|
| TAM | 5,000 unique sites × €20,000 annual spend = **€100m/year** | Demand in the defined overall market; no claim of capture |
| SAM | 1,400 size-qualified sites + 1,100 process-qualified sites − 500 overlapping sites = 2,000 unique sites; × €20,000 = **€40m/year** | Serviceable population after explicit eligibility and product-fit filters |
| Reachable pool | 500 unique sites within current channel/service coverage | Operational subset of SAM; not automatically SOM |
| Three-year SOM | 500 reachable sites × 20% assumed adoption = 100 customers; × €20,000 = **€2m annual revenue at end of year 3** | Capacity-constrained scenario; 100 customers also below assumed installation/support capacity of 120 |

The 20% adoption assumption must be validated; it is not an AI confidence score. Account lists deduplicate by site identity and parent company relations; different sites remain distinct only if buying/spend units are genuinely separate. Country/segment totals cannot be added without checking overlap. Top-down estimates cross-check the bottom-up model; they are not averaged automatically. SOM is a scenario for an explicit horizon, not a guaranteed forecast.

### Economics scenario

At 100 customers: €2m annual revenue; 60% assumed gross margin gives €1.2m gross contribution. €600k assumed annual incremental sales and administrative operating cost, excluding delivery/COGS already deducted in gross margin, gives €600k contribution after those costs. €400k one-time scale-entry investment remains separate. This is a steady-state scenario before taxes, working capital, ramp timing and financing, not a year-one profit or cash-flow forecast.

Downside: 50 customers → €1m revenue → €600k gross contribution → €0 after the same €600k annual incremental operating costs. Upside: 120 customers → €2.4m revenue → €1.44m gross contribution → €840k after those costs. The upside is capped by the illustrative 120-customer capacity assumption. All figures depend on constant price/margin assumptions and must expose those simplifications. A detailed cash-flow forecast is later scope unless essential for design partners. Its input contract includes acquisition ramp, retention, delivery/COGS, partner margin, incremental operating cost, upfront investment, FX/base year and cash timing. Operating cash flow and cumulative payback must remain unavailable until those inputs support an explicit reproducible formula. CAC/LTV appear only where the business model and cohort evidence justify them. Low/base/high scenarios identify changed variables and do not imply probabilities.

### Pilot criteria and sample outcome

Pre-pilot validation: approve a separate illustrative €15,000 validation budget at G1, approach 20 selected sites through an approved channel, and seek 8 completed discovery interviews and 4 paid pilot commitments. G1 authorizes this validation only; G2 separately authorizes the €120,000 90-day pilot. The pilot seeks deployment-effort, buyer-fit, paid-use and willingness-to-renew evidence, with thresholds and measurement windows approved before activation. These are sample thresholds, not recommended market benchmarks. Define sample selection and nonresponse bias; interviews alone do not validate sales conversion or full-market demand.

Prototype pre-pilot results: 9 interviews completed and 4 paid commitments meet the G1 validation thresholds; required specialist pilot review signs off on the bounded pilot. G2 then approves the €120,000 pilot. At the 90-day pilot review, only 3 of 4 customers meet the pre-agreed paid-use/continuation threshold, deployment effort exceeds assumption, and broader scale-readiness specialist review remains incomplete. Product recommendation: **revise and extend validation**, not scale. Sponsor authorizes a scoped extension with its own spend cap; the original scale gate remains blocked. This demonstrates learning and a negative decision rather than a guaranteed happy path.

### Decision-critical assumptions

| Assumption | Validation | Consequence if false |
|---|---|---|
| Customers pay €20k annually | Paid pilot offer and buyer interviews | Revise pricing and contribution model |
| Existing product fits target workflow | Product demonstrations and deployment trial | Add adaptation cost or stop |
| Channel reaches 500 unique sites | Partner list verification and capacity review | Reduce reachable pool and SOM |
| Specialist requirements can be met | Qualified legal/regulatory review | Block pilot or constrain scope |
| 120-customer service capacity | Operations capacity model | Cap SOM and scale budget |

## 7. Information architecture and screen specifications

Global navigation: **Overview · Opportunities · Expansion Cases · My Work · Evidence · Reviews · Administration**. Case navigation: **Thesis · Sizing · Feasibility · Economics · Validation · Decisions · Pilot · Outcomes · History**. Display case owner, current stage, next required decision and evidence freshness persistently. Business terms lead the UI; infrastructure terms such as MCP, harness and model tokens belong in administrative diagnostics.

### S01 — Portfolio / executive overview

Audience: sponsor and program lead. Cards show active cases by stage, decisions awaiting approval, approved versus requested spend, overdue validation, and pilots requiring review. Case table includes owner, market, next gate, blockers and latest update. Actions: open case, filter business unit, create mandate. Avoid adding TAM values into a meaningless total. Empty state: create first mandate or view example. Restricted state: show only authorized cases, never hidden-case counts. Error: last refreshed timestamp and failed data-source indicator.

### S02 — Mandate creation and review

Fields: objective, existing product, target segments/geographies, exclusions, horizon, investment constraint, evidence sources, owner, sponsor, success definition. Editable form plus scope preview. Submit routes to G0; return requires comment. Empty suggestions cannot imply validated opportunity. Validation blocks missing ownership, incompatible horizons and unspecified currency. Restricted sponsor role gets request-access explanation, not an active approval button.

### S03 — Opportunity discovery

Candidate cards/table: market, trigger, relevance rationale, evidence coverage, unknowns and last checked. Filters: product, geography, segment, stage. Actions: inspect, dismiss with reason, merge duplicate, shortlist, manually add, convert to case. AI-generated candidate remains visibly proposed. Empty: explain filters or missing sources and allow manual entry. Source failure: mark discovery partial; do not claim exhaustive search.

### S04 — Opportunity comparison

Compare up to four candidates with TAM/SAM definitions, growth evidence, product fit, channel access, investment, readiness blockers and uncertainty. Transparent optional weighted ranking; no objective-looking score when data missing. Actions: adjust weights, inspect evidence, select for assessment. Incomparable market boundaries show warning and require correction before aggregate ranking. Missing evidence appears as unknown, never zero.

### S05 — Expansion case / thesis

Hero: proposition, intended customer, why now, next decision. Sections: evidence-backed claims, reasons to win, alternatives including no entry, critical assumptions, disagreements, blockers and recommendation. Every substantive claim links to evidence or assumption. Actions: edit, request analysis, assign reviewer, challenge claim, submit gate. Loading shows queued/running/needs input rather than invented completion percentage.

### S06 — Sizing workbench

Input ledger and deterministic formula view, unique-site cohort breakdown, overlap adjustment, year/currency labels, top-down cross-check, TAM/SAM/SOM distinction. Scenario selector shows horizon and capacity constraints. Actions: edit assumption, inspect population, attach source, compare versions. Invalid negative overlap or SAM > TAM blocks submission with explanation. Restricted account data displays authorized aggregates only when policy allows; otherwise unavailable.

### S07 — Feasibility and ability to win

Readiness checklist: product fit, differentiation, commercial access, operations, specialist review, channel and competition. Each row has evidence, reviewer, status, due date and blocker. Actions: request review, attach assessment, record disagreement. Specialist work is human-owned. Missing review shows pending; agent cannot substitute a green check. Blocker requires explicit resolution or approved scope restriction.

### S08 — Economics and scenarios

Editable price, adoption, margin, annual incremental costs, capacity and one-time investment. Compare downside/base/upside with formula explanations and exclusions. Show steady-state annual contribution separately from launch cash requirements. Actions: finance review, revise, snapshot. Missing cost inputs keep recommendation incomplete; incompatible currency/year requires normalization. Never display false precision from uncertain inputs.

### S09 — Assumptions and validation workspace

Register prioritizes assumptions by decision sensitivity and evidence quality. Experiment panel: hypothesis, method, sample, success threshold, budget, owner, due date, evidence, result and interpretation. Actions: approve plan, assign work, record inconclusive/failure, revise thesis. Empty state offers example experiments clearly marked synthetic. A failed threshold does not disappear when result is edited; history retains original.

### S10 — Decision and approval package

Read-only proposed snapshot with scope, recommendation, alternatives, finance/specialist sign-offs, pilot budget, stop rules, outstanding conditions, dissent and source links. Actions: approve within authority, return, reject, abstain, delegate via policy. Approval labels explicitly say “Approve pilot €120k” or “Approve scale”; never ambiguous “Approve.” Stale snapshot disables approval until refreshed. Unauthorized or conflicted reviewer cannot approve. Conditions show whether execution is blocked until satisfied.

### S11 — Pilot / GTM execution

Milestones and tasks across product, sales, marketing, operations and review; owners, dependencies, deliverables, budgets and evidence. Approved baseline pinned. Integration preview shows proposed external tasks, destination, assignees and permissions. Actions: activate approved plan, create tasks, update progress, report blocker, request scope change. Partial sync shows which tasks succeeded and provides idempotent retry. Draft outbound messages remain drafts; task authorization does not authorize sending prospect communications.

### S12 — Outcome review and scale decision

Baseline versus actuals, target thresholds, expense, demand evidence, deployment effort, unresolved readiness, causal limitations and recommended next action. Actions: stop, revise, request extension, request scale approval. Synthetic results above default to extension recommendation. Missing outcome data shows review incomplete. Scale gate remains blocked by unresolved required readiness or absent authority.

### S13 — Evidence detail and history

Source viewer with permitted excerpt, source URL/file, publication and retrieval dates, license/access boundary, linked claims and superseded status. Side panel separates quoted fact, inferred claim and human assumption. Actions: challenge, mark stale, replace, inspect impacted cases. Restricted source cannot leak through generated excerpts. Deleted/unavailable source shows prior provenance and invalidation impact under retention policy.

### S14 — Administration and connections

Configure roles, delegated authority, gate policies, source entitlements, retention, integration mapping, allowed tools and run budget. Connection states: connected, expired, missing permission, unavailable. Audit access scoped. Model traces expose structured outputs and tool events, not hidden chain-of-thought. Administrators cannot bypass approval policy simply by configuring tools.

### Shared interaction requirements

Autosave drafts with visible saved/unsaved status; destructive changes confirmed with impact; accessible keyboard navigation; status text alongside color; charts have tabular equivalents; users can inspect calculations without opening chat. Evidence drawer, assumption editor, owner picker, review panel and activity timeline are shared design components. AI copilot is contextual assistance inside workspaces, not the primary navigation model.

## 8. Agentic architecture and autonomy

The harness manages context, tools, skills, budgets, checkpoints, model versions and evaluation. The durable workflow engine owns business state, gates, authorization, retries, timers and approvals. The application database and event log are the system of record; agent memory is not. An agent may recommend a transition; only a validated command with an authorized identity can commit it.

MVP: one bounded analysis agent with validated skills and deterministic calculations. Proposed future specialized workers: opportunity discovery, market sizing, feasibility synthesis, validation design, and execution planning. Introduce specialization only when evaluation demonstrates improvement. A supervisor may coordinate bounded analysis; it never acquires broader write authority through delegation.

| Activity | Autonomous allowance | Required boundary |
|---|---|---|
| Retrieve permitted evidence; identify duplicates | Allowed within source, cost and tenant limits | Provenance and permission validation |
| Draft hypotheses, comparisons and plans | Allowed as proposals | Explicit facts/inferences/assumptions separation |
| Compute sizing/economics | Deterministic tool with validated inputs | Unit, overlap, currency and capacity checks |
| Change approved scope or budget | Propose only | New authorization and versioned gate |
| Approve pilot / market entry / scale | Never autonomous | Authorized human decision |
| Create external tasks | Only approved plan and authorized execution identity | Tool policy, dry run, idempotency and audit |
| Contact prospects, sign contracts, spend money | Out of MVP | Separate future authorization model |

Reusable skills: `mandate-to-search-plan`, `market-boundary-definition`, `bottom-up-sizing`, `cohort-deduplication`, `ability-to-win-assessment`, `scenario-economics`, `assumption-prioritization`, `validation-experiment-design`, `pilot-plan`, and `outcome-review`. Skills package procedures, schemas, validation, examples and versioned evaluation fixtures. They confer no permissions.

Illustrative tools, not existing APIs: `intelligence.search`, `evidence.get`, `portfolio.get_product`, `crm.get_authorized_accounts`, `sizing.calculate`, `economics.calculate`, `workflow.request_gate`, `work.preview_tasks`, `work.create_approved_tasks`, `outcomes.record`. MCP can expose appropriate enterprise tools but is optional; direct APIs may be simpler. A tenant-aware gateway validates identity, resource access, schema, approval version and budgets on every call. External source text is untrusted evidence and cannot issue instructions.

Run states: queued, running, waiting for input, awaiting approval, completed, partial, failed, cancelled. Keep these separate from expansion-case business state. Resume runs from persisted checkpoints and committed results; external writes use idempotency keys. Tool errors surface as errors, not synthetic evidence. Ambiguous external-write timeouts enter reconciliation before retry; persist pending/succeeded/failed status and external ID. Human edits survive regeneration, which creates a new proposal rather than overwriting approved content. Explicit error treatments cover conflicting sources, expired approvals, exhausted analysis budget and malformed agent outputs.

## 9. Data model and contracts

| Object | Shared / app-specific | Key fields and relationships |
|---|---|---|
| Tenant, User, Role, Policy | Shared | Tenant, identity, resource scope, delegated authority |
| Company, Product, Market, Geography, Segment, Account/Site | Shared | Stable identity, parent relations, versioned attributes |
| Source, Evidence, Claim | Shared | Origin, rights, timestamps, supporting/contradicting links, fact/inference type |
| Assumption | Shared primitive | Owner, value/unit, basis, uncertainty, status, validation links |
| WorkflowCase | Shared envelope | App type, owner, participants, version, business status, authorized resource links |
| Mandate, Opportunity, ExpansionThesis | App-specific | Scope, objective, candidate origin, thesis versions and case |
| MarketBoundary, SizingModel, Cohort | App-specific | Units/year/currency, dedup rules, TAM/SAM, horizon, capacity, input lineage |
| FeasibilityAssessment, EconomicsScenario | App-specific | Reviewer, blockers, formulas, recurring/one-time costs, scenario assumptions |
| ValidationExperiment | App-specific | Assumption, method, sample, threshold, budget, result and evidence |
| GateRequest, Approval, Decision | Shared primitives; app gate definitions | Snapshot hash/version, authority, scope, conditions and rationale |
| PilotPlan, PilotMetric | App-specific | Baseline, approved budget, targets, milestones, actuals |
| Task, Deliverable, OutcomeObservation | Shared | Owner, dependencies, case, external mapping, source and period |
| AgentRun, ToolCall, AuditEvent | Shared | Version, access scope, checkpoint, cost, event and execution result |
| AppHandoff | Shared | Origin/receiving case, accepted scope, permission-aware evidence references |

Relationships: mandate owns opportunities; shortlisted opportunity creates a case; case has versioned thesis, sizing/economics, assessments, experiments and plans; gate approval references one immutable snapshot; tasks reference approved plan; outcome observations reference target definitions and baseline. Evidence may support multiple claims, with access rechecked at retrieval. Tenant ID and authorization scope apply to all objects. Store source facts and model-produced interpretations distinctly.

## 10. MVP, roadmap and release gates

MVP supports one industry, one expansion type, one sizing convention, permissioned intelligence retrieval/uploads, manual enterprise inputs, one bounded analysis agent, deterministic sizing/economics, validation register, G0–G3 decisions, one implemented pilot task connector with export as outage fallback, and manual outcome entry. Prototype may display later screens but clearly distinguish implemented functionality from simulated data.

P1: improved CRM inputs, change monitoring, portfolio allocation and one cross-app handoff. P2: additional expansion types, evaluated specialist agents, richer cash-flow models and connected campaign/account workflows. Broad reusable platform APIs follow proven reuse rather than preceding it.

Release gates: evidence rights confirmed; approval bypass tests pass; calculations verified against fixtures; tenant access adversarial tests pass; task retries cause no duplicates; operators can complete primary workflow; design partners demonstrate repeat use and credible paid commitment. Dates require engineering estimation and discovery; do not portray a roadmap hypothesis as a delivery promise.

## 11. Commercial model and distribution hypotheses

Buyer pays for a workspace enabling cross-functional decisions, not research queries alone. Test annual platform subscription with included operator seats, reviewer access and bounded analysis usage; incremental app packs may follow. Avoid seat pricing that discourages essential reviewers. Premium connectors, enterprise governance and additional intelligence rights may be priced separately only after actual packaging constraints are known.

Illustrative pricing test bands: €25k–€60k annual single-app contract for one team; €60k–€150k for multiple teams/governance. These are interview hypotheses, not willingness-to-pay evidence or company pricing. Test against consulting/project alternatives, existing intelligence subscriptions, internal analyst cost and value of avoided wasted investment. Intelligence licensing and marginal inference cost must be included in gross-margin analysis. Paid pilot fees should credit into annual contracts if commercially justified.

Potential distribution: expand into existing intelligence relationships, partner with strategy/innovation teams, and use a bounded expansion decision as onboarding. Measure whether workflow adoption increases retained value; avoid assuming an existing subscriber automatically wants this app.

## 12. Metrics and evaluation

North-star candidate: **qualified expansion decisions completed with evidence, accountable follow-through and an outcome review**. Count no-go decisions when required evidence and rationale are present. Do not count button clicks or AI-generated theses as success.

| Dimension | Measures | Interpretation |
|---|---|---|
| Adoption | Active case owners, cross-functional reviewers, repeat cases, stage progression | Denominator is teams with active eligible work; annual cadence affects retention interpretation |
| Decision quality | Material assumptions validated, unsupported claim rate, reviewer corrections, decision-package completeness | Quality rubric independent of whether decision is go/no-go |
| Efficiency | Median mandate-to-thesis, gate waiting time, analyst effort per case | Compare similar cases; do not equate speed with correctness |
| Execution | Approved pilots activated, milestone completion, overdue blockers, review completion | Separate external-sync failures from business delays |
| Commercial | Paid-pilot conversion, renewal, app expansion, service effort, gross margin | Forecasts remain hypotheses until cohorts mature |
| Business outcomes | Pilot demand evidence, budget adherence, eventual revenue and contribution | Track alongside external causes; avoid attributing all growth to software |

Proposed pilot targets to calibrate with partners: 30% reduction in preparation effort; 100% material claims carrying provenance or an explicit unsupported/unknown label; at least 95% expert-valid citations among cited claims; 80% critical assumptions assigned a validation owner; 100% approvals tied to the executed version. These are hypotheses; security and authorization require zero known bypasses rather than acceptable average rates.

Evaluation suite: source-faithfulness and citation validity; discovery relevance/recall against curated cases; duplicate population handling; sizing/economics arithmetic; unsupported precision; identifying material unknowns; experiments that could falsify thesis; feasibility blocker handling; approval/version enforcement; tenant isolation; prompt injection; interrupted-run recovery; duplicate-write prevention. Human experts score decision usefulness and material omissions; calibrated model graders supplement, never replace, expert evaluation. Keep industry- and source-specific datasets, adversarial cases and regression history.

## 13. Nonfunctional requirements and operational design

Tenant isolation, resource-level access checks, encryption in transit/at rest, configurable retention and model-provider data controls require security review. Source licensing applies to ingestion, display, embeddings and generated output; exports inherit access and entitlement rules. Provide deletion and retention procedures compatible with required approval history.

Prototype accessibility target: WCAG 2.2 AA principles; enterprise production target subject to formal validation. Interactive reads should generally return within 2 seconds at expected pilot scale; analysis shows immediate acknowledgement and asynchronous status, with proposed 5-minute budget for a bounded initial brief. These are engineering planning targets, not measured SLAs. Tool outages degrade to visible partial evidence, uploads or queued retry. Do not approve irreversible actions on stale authorization during outages.

Track model/tool versions, input snapshots, structured rationale, evidence IDs and calculation versions. Maintain per-run time/token/cost budgets, concurrency limits and tenant quotas. Avoid displaying private chain-of-thought. Backups, restore objectives, hosting/data residency, SSO/SCIM, penetration testing and uptime commitments require architecture/security decisions before production contracting.

## 14. Risks and open decisions

Primary risks: intelligence coverage mistaken for execution readiness; weak recurring use; duplicating existing products; unsupported market sizing; optimistic adoption assumptions; restrictive data licenses; insufficient specialist reviews; fragmented ownership; slow procurement; long outcome attribution horizons; high customization or human-services cost; premature platform complexity.

Open decisions: which segment and expansion type is first; what existing products already solve; intelligence access rights and API availability; depth of customer input data; gate authority model; whether cash-flow forecasting is essential; first task connector; commercial packaging; hosting/residency; managed analyst assistance; preferred platform naming. Assign discovery owner and decision date to each before build commitment.

## 15. Design-agent handoff

Design an enterprise desktop-first prototype for Aster Industrial Systems. Use S01–S14, with S03–S12 as the core interactive sequence. Maintain consistent synthetic values: TAM €100m, SAM €40m, reachable sites 500, 3-year base SOM €2m annual revenue, pilot €120k. Let Maya shortlist the German food-processing opportunity, inspect a disputed adoption assumption, create validation tasks, request pilot approval, let Elena approve the exact pilot scope, preview task creation, record mixed results, and request a scoped extension. Show a blocked scale decision because demand threshold and specialist readiness are unmet.

Include alternate paths for missing data, restricted evidence, expired connector, duplicate cohort, stale approval and partial task sync. Evidence, assumptions, predictions and actuals must be visually distinct. Favor workspaces, comparison tables, editable ledgers and decision panels over a chatbot home screen. Show human owner and next action on each case. Expose business rationale and source lineage without infrastructure jargon. Avoid synthetic data appearing as a verified company capability.

Required prototype deliverables: navigation map; executive overview; operator journey; approval journey; annotated component/state inventory; desktop screens with representative content; accessible status/error treatments; clear MVP versus later scope; interaction annotations for gates and version changes.

## 16. Product–architecture alignment record

Principal Product Manager and Chief Architect directly aligned on these decisions: Market Expansion is the first-app hypothesis, not a predetermined sequence; Growth OS provides shared primitives; specialist analyses remain app-specific; deterministic workflow owns authority; agents draft and assist; pilot and scale approvals are distinct; future handoffs preserve lineage and acceptance.


**Agreed implementation approach:** Begin with a modular application, relational system of record, evidence object storage, indexed search, asynchronous jobs, durable orchestration, one bounded analysis agent and deterministic calculation tools. Avoid an upfront generic app builder, microservices decomposition or graph database. Shared platform primitives are tenant/identity, enterprise context references, evidence/provenance, decisions/approvals, actions, outcome reviews and agent runs; market definitions, entry theses, sizing, experiments and pilots are app-specific. Cross-app handoff creates a linked draft with selected authorized context, explicit receiving-owner acceptance and independent gates. Neither research coverage nor market size proves customer demand. These alignment decisions are proposed architecture, subject to actual source contracts, enterprise requirements and engineering validation.

## 17. Instrumentation and delivery checkpoints

Instrument mandate_created, mandate_approved, opportunity_shortlisted, evidence_reviewed, sizing_snapshot_created, assumption_changed, feasibility_review_recorded, validation_authorized, experiment_completed, gate_submitted, gate_returned, gate_approved, approval_invalidated, pilot_activated, external_task_confirmed, external_task_failed, outcome_recorded, extension_requested, scale_requested, and case_stopped. Event envelopes carry tenant-scoped case ID, actor role, object version, timestamp, stage, and correlation ID. General analytics must not contain raw restricted source text, account details, or confidential financial inputs. Record run cost, elapsed time, errors, and reviewer corrections separately from business outcomes.

Measure mandate-to-thesis from approved G0 to the first reviewer-accepted thesis; measure gate waiting time from valid submission to disposition, distinguishing withdrawn or invalidated submissions. Capture preparation effort with a lightweight operator diary and comparable historical cases. Report median and distribution, sample size, expansion type, and missing-data rates; small pilot samples cannot establish causal revenue impact.

Delivery checkpoints are dependency gates rather than committed dates: (1) discovery and source-rights feasibility; (2) permissioned case/evidence foundation and sizing fixtures; (3) assessment, validation and versioned gates; (4) pilot planning and implemented connector recovery; (5) outcomes, accessibility and security hardening; (6) design-partner release review. Product owns workflow and acceptance; architecture owns authority boundaries and reliability; domain reviewers own evidence and feasibility rubrics; design owns usable role journeys; engineering estimates sequencing after source contracts and customer access are confirmed.

**Design prompt:** Design Market Expansion OS as a workflow app in Growth OS using this PRD. Build the Aster case from approved mandate through evidence-backed assessment, separately authorized €15k validation, €120k pilot approval, execution, mixed results and a blocked scale gate. Preserve the illustrative numbers, human authority, source provenance, versioning and failure paths. Make enterprise workspaces and next decisions central; keep agent infrastructure secondary.
