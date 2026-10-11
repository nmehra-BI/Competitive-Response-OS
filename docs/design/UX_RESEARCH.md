# Competitive Response OS — UX/UI Research and Design Guidance

**Input for:** UX/UI designer (high-fidelity prototype, PRD §20) • **Based on:** [PRD v1.0](../PRD.md), [Engineering Execution Plan](../EXECUTION_PLAN.md) • **Author role:** Staff UX/UI Researcher • **Date:** 8 October 2026 • **Method:** Secondary research plus expert heuristics. No primary interviews were run.

## How to read this report

- **[S]** marks a finding backed by a cited public source. The URL is inline.
- **[H]** marks my expert hypothesis. Validate these in the test plan (§10).
- **→** marks the design implication. Every finding ends in one.
- Vendor surveys (Crayon, Klue, Sedulo) are self-selected samples run by vendors who sell to this market. Treat their numbers as directional, not as population facts.
- I quote no interview participants. All quotes below are from published documents.

---

## 1. Executive summary: top 10 design implications

1. **Lead every case screen with one "Next required action" bar.** The bar is driven by the case state machine and the viewer's role. When the viewer lacks the right, show the action disabled, with the reason and the person who can act ("Elena Fischer approves Diagnostics responses"). CI programs struggle most with timeliness and turning intel into action ([S] Crayon 2025: 40% cite timely intel gathering, 42% signal vs noise). The PRD's thesis is decisions, not reading. → The case header owns the next step. Agent machinery stays secondary.

2. **Give each status dimension its own visual grammar.** There are five dimensions: priority, evidence strength, lifecycle state, analysis status, and sync status. Each one gets its own icon family, position, and vocabulary. They never share one generic "badge". Priority uses a monochrome bar glyph. Evidence uses a shield family. Lifecycle uses a rail plus a pill. Analysis status appears only in an analysis strip. Sync uses a split internal/external column. Carbon requires at least two of color, shape, and symbol, plus a text label ([S] [Carbon status indicators](https://carbondesignsystem.com/patterns/status-indicator-pattern/)). → A user should never ask "is this red because it is urgent or because it is unverified?"

3. **Put citations at the claim, label them by publisher, and open the exact passage in a side panel.** NN/g found that users rarely click citations. They also found that citations often fail to support the claim. NN/g recommends placing sources next to the claim, using meaningful labels, and linking to the relevant passage ([S] [NN/g, Explainable AI in Chat Interfaces](https://www.nngroup.com/articles/explainable-ai/)). → Show evidence strength inline, so it is visible without a click. One click opens the passage, retrieval time, and limitations.

4. **Treat all AI output as a reviewable draft with persistent provenance.** 79% of CI/PMM respondents do not trust AI output to go straight to sellers. 73% of those let down by AI said the answer "sounded confident but sources were weak" ([S] [Klue AI in CI Report 2026](https://klue.com/ai-in-competitive-intelligence-report-2026)). → AI content lands as "Draft · AI". It offers Accept, Edit, and Reject. The origin stays visible after editing ("AI draft, edited by Maya Patel"). Use neutral, non-anthropomorphic copy.

5. **Type the money, and never let it add up.** Revenue (€24M), pipeline (€6M), and scenario range (€1.2–3.6M) are three separate cards. Each has its own label, period, and snapshot date. Scenario values use a dashed "Assumption" treatment. Redacted rows never leak through totals, tooltips, or exports. → Exposure is the most quoted and most misusable number in the product. Its layout must make misreading hard.

6. **Make the decision a versioned document, reviewed like a pull request.** Approval binds to "Version 3", shown with a short fingerprint. A "Changes since v2" diff appears for re-reviewers. Material changes visibly invalidate pending approvals. This is GitHub's "dismiss stale approvals" model ([S] [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)). → Elena approves exactly what she read, and everyone can see that.

7. **Make the Signal Inbox a keyboard-first, split-view triage queue.** Linear's triage uses single-key actions (accept, duplicate, decline, snooze) inside a list/detail view ([S] [Linear Triage docs](https://linear.app/docs/triage)). → Maya clears noise fast, and every dismissal or override still records a reason through a quick-pick.

8. **Show sync state honestly, per task.** Show internal status and Jira status as two columns. Use "Sending…", "Confirmed · NSD-412", "Failed · Retry", and "Paused — approval changed". Never say "Synced" before confirmation. After partial success, offer "Retry 1 failed task" and leave confirmed tasks alone. → Users trust the product most at the moment an integration fails.

9. **Use role-shaped entry points and explicit handoffs.** The CI lead lands on attention queues. The approver lands on "Awaiting your decision". PMM and sales land on My Actions with case context. The executive lands on a scoped portfolio overview. Sellers already spend under 30% of their time selling ([S] [Salesforce State of Sales 2023](https://www.salesforce.com/news/stories/sales-research-2023/)). → Collaborators must finish their part in minutes, without learning the whole case workspace.

10. **Use a calm, dense, document-grade visual system.** Use a neutral canvas, one blue accent, and semantic hues reserved for status. Use Inter with tabular figures, plus Source Serif 4 for long evidence reading. Use a 4 px grid, borders before shadows, and 120–240 ms motion that respects `prefers-reduced-motion`. Keep the "Illustrative data" ribbon always visible. Reference tone: Linear, Stripe Dashboard, Attio, and GitHub's PR review. → Restraint signals trust, and it leaves visual "volume" for the few things that need attention.

---

## 2. Research context: what the evidence says about this market

| Finding | Source | Design implication |
|---|---|---|
| [S] 47% say marketing owns compete. 85% enable sales. Only 48% have an executive sponsor. | [Crayon 2025 State of CI](https://www.crayon.co/hubfs/Crayon%27s%202025%20State%20of%20CI%20Report.pdf) | → The CI lead is often a PMM-adjacent role without formal authority. The product must make *other people's* decisions and tasks easy, because the CI lead cannot command them. |
| [S] Top challenges: keeping content updated (#1), measuring success (43%), signal vs noise (42%), timely intel (40%). Only 44% have KPIs. | Crayon 2025 (same) | → Outcomes (Screen 10) and Overview must show *workflow* metrics (time to decision, completion, review discipline). This fills the KPI gap without fake revenue claims. |
| [S] 60% of CI pros use AI daily. 64% use it to analyze large volumes of competitor data. | Crayon 2025 | → Users are not AI novices. They do not need an explanation of what AI is. They need provenance and control. |
| [S] 76% had an AI output they "couldn't stand behind". Failure modes: weak or unverifiable sources (73%), too generic (60%), cannot tell a real threat from a passing mention (36%), outdated (28%), contradictory outputs (20%). | [Klue AI in CI Report 2026](https://klue.com/ai-in-competitive-intelligence-report-2026) (250+ CI/PMM respondents) | → Each failure maps to a UI requirement. Claim-level sources answer weak sources. Customer-specific "why it matters" answers generic. A relevance reason answers threat vs mention. Freshness and stale flags answer outdated. Conflict states answer contradictions. |
| [S] 53% have a manual review process before anything reaches sellers. 6% share AI outputs directly. | Klue 2026 | → Review is the norm. Design review as a fast, first-class step, not as friction. |
| [S] In life sciences, CI mainly supports strategic planning (64%) and portfolio/product decisions (63%). Real-time alerts are rated extremely or very effective by 66%. Reports and presentations are rated so by 69%. Quality and hallucination concerns top AI barriers (53%). | [Sedulo 2025 Life Sciences CI Survey](https://sedulogroup.com/blog-post/2025-ci-survey-findings/) (109 respondents) | → Med-device stakeholders still value a readable brief. The Decision Review should read like a document and export cleanly (GOV-04). Alerts help but do not replace the brief. |
| [S] In life sciences, 41% report CI plays a critical and consistent role in strategic planning. Higher-impact programs engage stakeholders more often. | [Sedulo early-warning article](https://sedulogroup.com/competitive-early-warning-system-life-sciences/) | → Plan for frequent, lightweight touchpoints (digests, mentions, My Actions) rather than rare, heavy ones. |
| [S] PMMs commonly carry CI. 65.2% list it as a responsibility. | [Product Marketing Alliance](https://www.productmarketingalliance.com/what-is-product-marketing/) | → Jonas (PMM) may also act as a CI lead in some tenants. Permissions are role assignments, not job titles. |
| [S] European medtech procurement is shifting toward value-based tenders, at different speeds by country and category. | [McKinsey, European public procurement in medtech](https://www.mckinsey.com.br/industries/life-sciences/our-insights/the-european-public-procurement-opportunity-delivering-value-in-medtech) | → Regional responses differ. Scope (geography, segment) must be explicit on every case and every number. |
| [S] German reimbursement runs on its own tracks (G-DRG, EBM, G-BA decisions), separate from conformity marking. | [AiM Reimbursement of Medical Devices in Germany 2024/25](https://aim.iges.com/sites/igesgroup/aim-germany.com/myzms/content/e207/citemtext/AIM-REI-Medial-Devices_2024_25_web_schreibschutz_eng.pdf) | → The PRD's rule matters: regulatory status ≠ availability ≠ reimbursement. The Evidence workspace must offer these as separate claim types, with the "not established" state visible. |
| [S] Automation bias produces two error types: omissions (missing what the system did not flag) and commissions (following a wrong suggestion). Workload and time pressure increase it. | [Goddard et al., JAMIA 2012](https://academic.oup.com/jamia/article/19/1/121/732254); [Parasuraman & Manzey 2010](https://journals.sagepub.com/doi/10.1177/0018720810376055) | → Do not pre-select the AI-recommended option. Show "what the analysis did not check" as a list. Make rejecting a suggestion as easy as accepting it. |
| [S] Showing a confidence value helped trust calibration in one study. Showing a local explanation did not. | [Zhang, Liao & Bellamy 2020](https://arxiv.org/abs/2001.02114) | → If confidence is ever shown, it needs calibration evidence (PRD §13). For V1, show evidence strength (rule-based) and source quality instead of a model "confidence %". |
| [S] Explanations should help users know when to rely on AI and when to rely on their own judgment. | [Google PAIR, Explainability + Trust](https://pair.withgoogle.com/chapter/explainability-trust/) | → Show limitations next to outputs ("Clinical-performance equivalence not assessed"), not in a help page. |
| [S] Microsoft's 18 Guidelines for Human-AI Interaction include: make clear what the system can do and how well, support efficient correction, scope services when in doubt, make clear why the system did what it did, and remember recent interactions. | [Amershi et al., CHI 2019](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/); [HAX Toolkit](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/) | → Use these as a heuristic checklist in design review (see §5.11). |

---

## 3. User behavior by persona

These profiles combine the PRD with the sources above. Lines marked [H] are hypotheses to test with design partners.

### 3.1 Competitive intelligence lead (Maya Patel). Daily champion.

| Dimension | Profile |
|---|---|
| How they work today | [S] They monitor alerts, news, and web changes, then curate summaries, battlecards, and digests for sales ([Crayon 2025](https://www.crayon.co/hubfs/Crayon%27s%202025%20State%20of%20CI%20Report.pdf); [Klue product](https://klue.com/product/create)). [H] In med-device firms they also track regulator databases, notified-body notices, congress abstracts, and tender portals, and they reconcile these by hand in spreadsheets. |
| Tools | [S] CI platforms (Klue, Crayon), AlphaSense-style research, general AI assistants, CRM, Slack/Teams. [H] Excel for product mapping. PowerPoint for leadership. Email for asks. |
| Attention pattern | [H] Bursty. A morning sweep of new items, then deep dives on one or two events. Frequent interruptions from stakeholder requests. They scan headlines and sources first and read in depth only for material events. |
| Decision triggers | [H] They escalate when a named competitor's event overlaps a monitored product and market, has a primary source, and has a near-term commercial effect (a tender, a key account, a launch window). |
| Trust triggers | [S] Primary sources, independent corroboration, the visible passage ([NN/g](https://www.nngroup.com/articles/explainable-ai/); [Klue 2026](https://klue.com/ai-in-competitive-intelligence-report-2026)). [H] Seeing that syndicated copies were *not* counted as corroboration. |
| Distrust triggers | [S] Confident tone with weak sources, generic output, stale info, contradictions (Klue 2026). [H] AI that silently overwrites their edits. Duplicates that inflate "source count". |
| Time pressure | [H] High in the first 24–72 hours after a material event, when leadership asks "what does this mean for us?" |
| **Design implications** | → A split-view inbox with single-key triage. → "Independent sources: 2 · Syndicated copies: 5" shown as separate counts. → Field-level provenance with no silent regeneration (R9). → A case-creation dialog prefilled from the signal, with every field editable. → The operator panel (run details) is available to Maya but collapsed by default. |

### 3.2 BU or strategy approver (Elena Fischer, Diagnostics BU Head)

| Dimension | Profile |
|---|---|
| How they work today | [S] Decisions are made in slides, email chains, and meetings (PRD §5). [H] They review on a laptop between meetings, often in 5–15 minute windows. They delegate preparation and expect a one-page answer. |
| Tools | [H] Email, Outlook/Teams, PowerPoint, the BI dashboards their team prepares, and the CRM through a delegate. |
| Attention pattern | [H] "Top-down then spot-check." They read the summary and the ask, then probe one or two numbers or claims they find surprising. They seldom read every source. |
| Decision triggers | [H] A clear ask (what, who, cost/effort, by when). A bounded downside. Disclosed uncertainty. A credible owner. |
| Trust triggers | [H] An exposure definition they can explain to their own boss. Seeing who verified what. Seeing what changed since they last looked. Their requested change being visibly addressed. |
| Distrust triggers | [H] A big single "at risk" number. Unexplained AI recommendations. Approval buttons that feel like they commit more than they read. Surprises after approval. |
| Time pressure | [H] Medium. They want to decide within days, but they are rarely blocked on this product alone. |
| **Design implications** | → A Decision Review "reading mode": one column, document typography, sticky approval panel. → A "What you are approving" box listing the exact version, responses, owners, resources, and constraints. → "Changes since v2" diff highlighting. → A request-changes flow that anchors comments to sections. → Show authority scope: "You can approve Diagnostics · Germany · positioning and account review." |

### 3.3 Product manager or product marketing lead (Jonas Weber)

| Dimension | Profile |
|---|---|
| How they work today | [S] They own battlecards and positioning. Keeping content updated is the #1 CI challenge ([Crayon 2025](https://www.crayon.co/hubfs/Crayon%27s%202025%20State%20of%20CI%20Report.pdf)). [S] PMMs commonly own CI tasks ([PMA](https://www.productmarketingalliance.com/what-is-product-marketing/)). |
| Tools | [H] Google Docs/Word, Confluence, Highspot/Seismic-style enablement libraries, Figma or Canva, Jira for product work. |
| Attention pattern | [H] Task-driven. They arrive from a notification and want the brief, the evidence for claims they will publish, and the due date. |
| Decision triggers | [H] An approved response with clear scope. Comparison limits stated, so they do not publish an unsupported claim. |
| Trust triggers | [H] Citations they can reuse in a battlecard. Clear "Do not claim" limitations (for example, clinical equivalence unresolved). |
| Distrust triggers | [H] Being asked to produce content from unverified claims. Moving deadlines with no trace. |
| Time pressure | [H] Days (positioning brief due Day 5). |
| **Design implications** | → My Actions task detail shows a "Brief for this task" panel: approved response, key verified claims with citations, limitations, and the deliverable spec. → "Copy claim with citation." → Attaching a deliverable makes the completion-evidence requirement visible. |

### 3.4 Regional sales leader (Sofia Klein)

| Dimension | Profile |
|---|---|
| How they work today | [S] Reps spend less than 30% of their time selling ([Salesforce 2023](https://www.salesforce.com/news/stories/sales-research-2023/)). [S] In European medtech, value-based tenders and hospital consolidation shape selling ([McKinsey](https://www.mckinsey.com.br/industries/life-sciences/our-insights/the-european-public-procurement-opportunity-delivering-value-in-medtech); [BCG](https://www.bcg.com/publications/2017/medical-devices-technology-marketing-sales-moving-beyond-milkman-model-medtech)). |
| Tools | [H] CRM (Salesforce or Dynamics), Excel account lists, Teams, mobile email. |
| Attention pattern | [H] Low tolerance for new tools. Acts from a notification. Wants a list of *their* accounts and what to do. |
| Decision triggers | [H] A named account with an upcoming tender or renewal. Clear talking points. |
| Trust triggers | [H] The account list matches their own CRM view. Restricted data is handled respectfully. |
| Distrust triggers | [H] Seeing accounts outside their territory, or totals that hint at others' data. Duplicate Jira tickets. |
| Time pressure | [H] Medium. Account review is due Day 10, alongside quota work. |
| **Design implications** | → My Actions is their home. One task opens a focused view with account rows they can access, a summary field, and Submit. → Restricted rows render as consistent placeholders, and totals are labeled by scope. → No case jargon on their surfaces ("Account review for Apex AX-Scan launch"). |

### 3.5 Executive sponsor

| Dimension | Profile |
|---|---|
| How they work today | [S] Only 48% of CI programs have an executive sponsor ([Crayon 2025](https://www.crayon.co/hubfs/Crayon%27s%202025%20State%20of%20CI%20Report.pdf)). [H] They consume portfolio summaries in QBRs and leadership meetings. |
| Attention pattern | [H] A glance, then a single drill-down. They want "what is material, what did we decide, is execution on track". |
| Trust triggers | [H] Workflow metrics with definitions. Scope labels on totals. No inflated "revenue saved" claims. |
| Distrust triggers | [S] Unsupported attribution (PRD Screen 10). [H] Vanity charts. |
| **Design implications** | → Overview in a "portfolio" mode: material cases, decisions pending, overdue actions, and reviews due. Every count shows its scope. → Use length and position (bars), not color, for quantities ([S] [NN/g dashboards](https://www.nngroup.com/articles/dashboards-preattentive/)). → An "Escalate" action, not an approve action, unless the role grants one. |

### 3.6 Workspace administrator

| Dimension | Profile |
|---|---|
| How they work today | [H] Configures SaaS tools from admin consoles. Cares about health, scopes, and audit. Works in long, careful sessions with low frequency. |
| Trust triggers | [H] An explicit read/write scope for each integration. "Test access" before activation. Visible last-sync and freshness. Audit history. |
| Distrust triggers | [H] Hidden permissions. Integrations that "just work" with no destination preview. |
| **Design implications** | → Settings uses Vercel/Stripe-style health rows (status + last success + scope + action). → Approver coverage matrix (BU × geography × response type) that flags gaps. → Make clear that admin ≠ approver. When an admin opens a decision, show "You can configure approvers but cannot approve responses." |

---

## 4. Competitive and analogous product teardown

Evidence for each product comes from public docs, help centers, or third-party reviews, as noted. I did not get hands-on product access. Items marked [H] are informed by general industry familiarity and need checking against current versions.

### 4.1 CI tools

| Product | What works | Borrow | Avoid |
|---|---|---|---|
| **Klue** | [S] Cards live on boards and are reused in battlecards and integrations, so one edit updates everywhere ([Klue product](https://klue.com/product/create)). [S] Editable email digests with curator commentary. | → Reusable, single-source claims. One EvidenceClaim is referenced from the signal, the case, the decision package, and the PMM task. Edits propagate with history. → A curator note field on digests and signals. | [S] No documented pre-publish approval gate was found. CR-OS must make the review gate explicit. [H] Board-centric IA suits enablement content, not decision workflows. |
| **Crayon** | [S] Sparks runs template or custom AI analyses on a schedule and suggests battlecard updates ([Crayon Sparks](https://crayon.co/sparks)). | → "Suggested update" framing: AI proposes, a human accepts. | [S] Users report a lot of junk output and ask for better priority ranking ([ZoomInfo review](https://pipeline.zoominfo.com/sales/crayon-review)). → Show a *reason* for every priority, and let users override it with a reason. |
| **Kompyte (Semrush)** | [H] Automated web-change tracking and win/loss integration, enablement-oriented. | → Show change diffs on source pages ("what changed on the competitor page"). | [H] Feed volume without materiality filtering. |
| **AlphaSense** | [S] Generative search returns summaries with citations linked to transcripts. A keyword-hits pane jumps to the relevant portion ([AlphaSense help](https://help.alpha-sense.com/en/articles/7225201-expert-transcripts-overview); [HBS library guide](https://www.library.hbs.edu/services/help-center/locating-expert-call-transcripts-in-alphasense)). | → "Jump to passage" hits inside long sources. → Save-to-case, like notebooks. | [H] A research-first IA. CR-OS must not become a search tool with a case attached. |

**Gap all four leave open [H]:** none of them model decision rights, versioned approval, execution authorization, or outcome review. → This is the differentiator. The prototype should make the decision-to-action handoff the most polished part.

### 4.2 Approval and governance UX

| Product | What works | Borrow | Avoid |
|---|---|---|---|
| **GitHub PR review** | [S] Approvals can be dismissed automatically when code changes after approval ([GitHub docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)). [H] "Files changed" diff, line-anchored comments, review states (Comment / Approve / Request changes), and a required-reviewers checklist. | → Version-bound approval. → A "changes since your last review" diff. → Section-anchored comments in Decision Review. → A required-approvers checklist ("1 of 2 approvals"). | [S] Users find dismissal frustrating when trivial edits wipe approvals ([GitHub community discussion](https://github.com/orgs/community/discussions/12876)). → Use the PRD's *materiality* rule. Comments and formatting do not invalidate. Explain every invalidation in plain words. |
| **Ramp approvals** | [S] Layered, conditional approval chains by amount, vendor, department, and so on. Approval and Notify step types. A full audit trail ([Ramp Bill Pay approvals](https://support.ramp.com/hc/en-us/articles/4417843897747-Bill-Pay-approvals)). [S] Separation of duties removes the creator from the chain ([Ramp Banking approvals](https://support.ramp.com/hc/en-us/articles/41025649662611-Ramp-Banking-Approvals)). | → Show the approval chain as a vertical list of steps with state (Done / Waiting / Not required) and the routing reason ("Requires commercial authority because the response touches pricing"). → Separate "Approve" from "Notify". | [H] Dense rule builders in the user-facing flow. Keep policy building in Settings. |
| **Vanta** | [S] Control status reflects mapped evidence. "Needs evidence" when tests or documents are missing or failing. The status explicitly says it is not an auditor's opinion ([Vanta Controls page](https://help.vanta.com/hc/en-us/articles/11750680642196-Controls-Page)). | → The "Ready for decision" checklist works like controls. Each guard is a row with Met / Missing and a link to fix it. → Disclaim scope honestly ("Readiness checks are workflow rules, not a judgment of the decision"). | [H] Pass/fail percentages that read like scores. |
| **Linear** | [S] Triage inbox with single-key actions (1 accept, 2 duplicate, 3 decline, H snooze) and ⌘K actions ([Linear Triage](https://linear.app/docs/triage)). [S] Recent refreshes cut visual noise, shrank and reduced icons, softened dividers, and dimmed navigation to keep density without overwhelm ([Linear redesign](https://linear.app/blog/how-we-redesigned-the-linear-ui); [design refresh](https://linear.app/now/behind-the-latest-design-refresh)). | → Inbox keyboard model. ⌘K. Calm density. Dimmed sidebar. | [H] Engineering-centric jargon and very low-contrast secondary text. Keep AA contrast. |
| **Jira** | [H] Universal task destination. Workflows vary by project. Required fields differ ([Execution Plan risk table](../EXECUTION_PLAN.md)). | → Destination preview that shows the exact Jira project, issue type, and field values before sending. | [H] Reproducing Jira's board inside CR-OS. Link out to Jira for execution detail. |

### 4.3 Evidence and citation UX

| Product | What works | Borrow | Avoid |
|---|---|---|---|
| **Perplexity** | [S] Publisher-domain chips at the end of claims with a "+N" count. Hover or tap popover previews. Deeper audit in a Sources tab ([AI UX Playground teardown](https://aiuxplayground.com/teardowns/perplexity/citations)). | → Publisher-labeled chips ("Apex press release", "BfArM notice"). Hover/focus preview. A full source list in the Evidence tab. | [S] A citation's presence implies reliability even when it is weak ([NN/g](https://www.nngroup.com/articles/explainable-ai/)). → Chips also carry evidence strength. |
| **Elicit** | [S] Each extracted value has a quote icon. Clicking opens a "Supporting quotes" panel, with the cited sentence highlighted in context and "Quote n of m" navigation. Metadata is not treated as evidence. When matching fails, the panel shows all retrieved excerpts instead of nothing ([Elicit help](https://support.elicit.com/en/articles/14758168-extracting-data-from-a-table-within-a-paper-in-column-answers)). | → The exact pattern for the Evidence Workspace right pane: highlighted passage, "Passage 1 of 3", and an honest fallback. → Label metadata ("Publisher", "Date") as context, not proof. | — |
| **NotebookLM** | [S] Hover shows the full quoted text. Click scrolls the source viewer to the quote ([NotebookLM help](https://support.google.com/notebooklm/answer/14276569?hl=en)). | → Hover = quote, click = source in context. | [S] Citations can be lost on copy-paste. → "Copy with citations" for PMM reuse, and GOV-04 exports that keep citations. |
| **Hebbia Matrix** | [S] Grid of documents × questions. Each cell holds a cited answer, and clicking shows the passage ([third-party review](https://www.datastudios.org/post/hebbia-ai-document-research-for-finance-matrix-workflows-and-pricing)). | → The product overlap comparison (Screen 5) as a matrix: attributes × products, each cell cited, with confirmation per row. | [H] Spreadsheet sprawl. Keep the matrix to the confirmed attributes. |
| **Harvey** | [S] Responses cite uploaded or vetted sources. Users can view the snippet or the full document. Vault "Review" produces tabular per-file answers ([Harvey help](https://help.harvey.ai/en/articles/10580373-getting-started-with-harvey); [Legaltech Hub](https://www.legaltechnologyhub.com/vendors/harvey)). | → "Snippet first, full document on demand", gated by entitlement (Screen 4). | [H] Implicit trust from professional branding. Show limitations even in polished output. |

### 4.4 Case and incident management

| Product | What works | Borrow | Avoid |
|---|---|---|---|
| **Zendesk Agent Workspace** | [S] A resizable context panel beside the ticket shows customer details, side conversations, and knowledge. The width persists across tickets ([Zendesk context panel](https://support.zendesk.com/hc/en-us/articles/4408836526362-Using-the-context-panel)). | → A right context panel in the case workspace (Evidence preview, Activity, Comments), with remembered width. | [H] Too many app icons in the rail. |
| **ServiceNow** | [H] Record header + related lists + activity stream. Strong audit. | → A durable record with an append-only activity stream. | [H] Form-heavy, field-dense layouts with weak hierarchy. |
| **incident.io** | [S] Severity levels with *descriptions* that help reporters choose under pressure ([incident.io severities](https://docs.incident.io/incidents/severities)). [H] A Slack-native timeline with pinned key events. | → Every priority level carries a one-line definition, shown in a tooltip and in the override dialog. → Pinned "key events" in the Activity timeline (submitted v2, approved v3, plan released). | — |
| **PagerDuty** | [S] Stakeholder roles get status updates without working the incident. Silent subscriptions avoid notification fatigue ([PagerDuty stakeholders](https://support.pagerduty.com/docs/communicate-with-stakeholders)). | → A "Follow case" mode for executives (read-only updates). → Notification settings that default to decisions and assignments, not every edit. | [H] Alert-storm UX. |

---

## 5. Design patterns (2025–2026) that fit this product

Each pattern lists why it fits these users, the rules, and what to avoid.

### 5.1 Command palette (⌘K / Ctrl+K)
- **Why it fits:** Maya and admins are expert, repeat users. [S] Accelerators should be extra routes, not required paths ([NN/g UI accelerators](https://www.nngroup.com/articles/ui-accelerators/)).
- **Rules:** Search cases, competitors, products, and permitted accounts. Offer contextual actions ("Create case from this signal", "Go to Evidence"). Show shortcut hints next to results. Results respect access scope, and restricted accounts never appear for unauthorized users. Esc closes.
- **Avoid:** Making the palette the only route to anything. Never offer consequential actions in the palette (Approve, Release plan). Those need their full confirmation surface.

### 5.2 Split view (list + detail)
- **Why it fits:** Signal triage and evidence review are "scan many, inspect one" tasks. [S] NN/g's four table tasks are find, compare, view/edit one row, and act ([NN/g data tables](https://www.nngroup.com/articles/data-tables/)).
- **Rules:** At 1440 px, the list is about 440 px and the detail is flexible. At 1280 px, the list is 380 px. Keep the selected row highlighted. j/k or ↑/↓ moves the selection. The detail pane URL is deep-linkable.
- **Avoid:** Three-pane layouts at 1280 px. Collapse the third pane into a drawer.

### 5.3 Side drawers vs modals vs pages
- **Rule:** Use a **drawer** to inspect or edit while keeping context (task drawer, claim source, calculation drill-down). Use a **modal** only for short, blocking confirmations with consequences (approve, release, dismiss with reason). Use a **page** for multi-step work (CSV import, decision reading).
- **Why:** Keeping context matters to PRD principle "Preserve visible context".

### 5.4 Inline citations with hover previews
- **Rules:** A chip sits after the claim and shows `[shield glyph] Publisher · date`. Hover or focus opens a preview with the quote, retrieval time, and limitation. Click pins the source in the right pane at the passage. The preview must be keyboard-reachable (focus opens it, Esc closes it). Provide a tap fallback. [S] Telerik and Neon document hover + focus + click behaviors ([Telerik citation](https://www.telerik.com/design-system/docs/components/citation/); [Neon inline citation](https://ui.neon.com/agent/inline-citation)).
- **Avoid:** Numeric footnotes only ("[3]"). Generic "Source" labels ([S] NN/g). Previews that render licensed text without entitlement.

### 5.5 Progressive disclosure
- **Why:** Elena needs the gist. Maya needs depth. [S] NN/g warns that more than two disclosure levels hurt usability ([NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)).
- **Rule:** Two levels only. Level 1 is the summary row or card. Level 2 is the drawer or pane with full detail. Agent run traces are a separate operator panel, not a third level in the business UI. Disclosure labels say what is behind them ("Show calculation: 18 accounts, 3 exclusions").

### 5.6 Status chips with labels
- **Rule:** Every chip = icon + text + color. Sentence case, short labels, and no all caps ([S] [Atlassian lozenge](https://atlassian.design/components/lozenge/usage)). Use lozenges (filled) only for *state*. Use tags (outlined) for *classification* such as event type and claim type.
- **Avoid:** [S] Status indicators where no action or meaning is significant (Carbon). Use plain text there.

### 5.7 Lifecycle rail vs stepper
- **Recommendation:** Use a **lifecycle rail** for the case. Use **steppers** only inside short, bounded, single-user flows.
- **Why:** The case is long-running, multi-actor, and non-linear (Needs information, reopen, invalidation). A wizard stepper implies one user moving forward in one session. [H] Users would misread "Step 5 of 10" as progress toward completion, and the case can go backward legitimately.
- **Rail design:** Six stage groups mapped to PRD §5: Verify → Assess → Decide → Execute → Monitor → Close. The current *state* is named in a pill under the rail ("Awaiting approval · v3"). Off-path states (Needs information, Deferred, Archived) appear as a flag on the current stage, not as extra steps. Reopen shows a loop marker with history.
- **Steppers:** Create case (2 steps), CSV import (Map → Validate → Preview → Snapshot), Authorize & release (Review tasks → Destination preview → Confirm).

### 5.8 Versioned document review with diff
- **Rules:** A version selector in the Decision tab ("v3 · Submitted 14 Oct 10:42 · Current"). "Compare with v2" shows inline insertions and deletions plus changed numbers ("Scenario high: 15% → 12%"). Submitted versions are read-only, with a lock icon and the text "Submitted versions can't be edited. Create v4 to amend." Superseded versions carry a banner linking to the current one.
- **Avoid:** Color-only diffs. Use underline for insertions and strikethrough for deletions, plus a "+ Added" / "− Removed" label for screen readers.

### 5.9 Optimistic UI with honest sync states
- **Rule:** Be optimistic for *internal, reversible* edits (rename, comment, reassign within CR-OS). Show a quiet "Saving… / Saved" and a rollback toast on failure. Be **never optimistic for external writes or authorizations.** Show pending states until the server confirms.
- **Why:** PRD ACT-06: never "synced" before confirmation. [S] Feedback is needed above 1 second, and time estimates or progress are needed above 10 seconds ([NN/g response times](https://www.nngroup.com/articles/response-times-3-important-limits/)).

### 5.10 Skeleton loading
- **Rule:** Use content-shaped skeletons for full-view loads of 2–10 seconds. Use spinners for single modules. Use progress with stages for anything over 10 seconds, such as analysis runs. Never use frame-only skeletons ([S] [NN/g skeleton screens](https://www.nngroup.com/articles/skeleton-screens/)). Analysis (often minutes, per PRD §17) uses a staged progress list ("Checking sources ✓ · Matching products … · Preparing impact assessment") with "You can keep working" copy.

### 5.11 AI-suggestion affordances
- **Origin badges** (field-level, R9). Use one consistent violet "AI" family and nothing else:
  - `AI draft`: generated, not reviewed. Has a dashed left border.
  - `AI draft · edited`: a human changed it, shown with editor and time on hover.
  - `Accepted by Maya Patel`: the reviewed state. The violet tint is removed, and a small origin glyph stays.
  - `Human`: authored by a person. No badge (the default).
- **Actions:** Accept · Edit · Reject (with reason) at the item level. Batch accept only for low-risk items such as entity tags, never for claims marked Fact.
- **Regeneration:** "Regenerate" never overwrites human-edited fields. Show a 3-way merge choice: "Keep your version / Use new draft / Compare".
- **Copy:** Neutral and source-based. "Draft based on 3 sources", not "I think…" ([S] NN/g advises against anthropomorphic language).
- **Do not pre-select** the recommended response option ([S] automation-bias literature above). Mark it "Recommended" with its reasoning, and require an explicit selection.
- **HAX checklist for design review** ([S] [Amershi et al.](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)): Is it clear what the analysis covered and how well? Is correcting it efficient? Is dismissing it efficient? Is it clear why? Does it respect the user's edits?

### 5.12 Keyboard-first triage
- **Keys (Signal Inbox):** `j/k` next/previous · `Enter` open · `c` create case · `l` link to existing case · `m` monitor · `d` dismiss (opens the reason quick-pick) · `p` change priority (reason required) · `x` select for bulk · `?` shortcut sheet · `g i` go to Inbox · `⌘K` palette.
- **Rules:** Show shortcuts in tooltips and in the palette. Never use single-key shortcuts while focus is in a text field. Make them configurable or disable-able (WCAG 2.1.4 Character Key Shortcuts).

### 5.13 Empty states that teach
- **Rule:** Each empty state says *why* it is empty, *what fills it*, and gives *one action*. Example (Signal Inbox, no watchlist): "No signals yet. Signals appear when a watchlist finds news about your competitors. [Set up a watchlist] · or [Explore sample case CR-1042]."
- **Distinguish** "nothing yet" from "nothing matches filters" ("No signals match 3 filters · Clear filters") and from "no access" ("You don't have access to signals for Cardiology").

---

## 6. Non-ambiguity system

This is the most important section for the designer. It defines one grammar per concept.

### 6.1 The five status dimensions

| Dimension | What it answers | Values (exact labels) | Visual grammar | Where it appears |
|---|---|---|---|---|
| **Priority** (business triage) | "How much attention should this get?" | High · Medium · Low | **Monochrome** 3/2/1 ascending-bar glyph + text. No hue. High uses medium-weight text. An override shows a small "Overridden" pencil marker. | Signal list, case header, case tables |
| **Evidence strength** | "How sure are we that it happened?" | Verified · Partial · Conflicting · Unverified | **Shield** icon family + semantic hue. Verified: green shield-check. Partial: amber half-shield. Conflicting: red shield with "!". Unverified: gray dashed-outline shield. | Signal list, claim rows, citation chips, case header (summary) |
| **Lifecycle state** (case) | "Where is the case in the business process?" | Draft · Assessing · Needs information · Ready for decision · Awaiting approval · Approved · Executing · Monitoring · Closed · Archived | **Rail + filled pill**, neutral or accent. Only "Needs information" uses amber, because it blocks. Approved uses a green check. | Case header only (plus a table column) |
| **Analysis status** (AI processing) | "Is the system still working on it?" | Queued · Running · Partial · Completed · Failed · Cancelled. Business copy: "Checking sources…", "Partial results", "Analysis stopped — your work is saved" | **Circular progress** glyph in info blue, in a slim *analysis strip* or section header. Never in the case header pill row. "Completed" collapses to a timestamp ("Updated 10:42"). | Analysis strip, section headers, operator panel |
| **Sync status** (internal vs external) | "Is the work recorded here and in Jira?" | Internal: Not started · In progress · Blocked · Submitted · Accepted · Done. External: Not sent · Sending… · Confirmed · Failed · Paused · Checking | **Two columns.** Internal uses a task-status circle glyph. External uses a **link** glyph + destination key ("Jira · NSD-412"). Failed is red with Retry. Paused is amber with the reason. "Checking" shows after an ambiguous timeout. | Action Plan, My Actions, task drawer |

**Rules**
1. Each dimension has a fixed **position**. Lifecycle sits in the header. Priority is in the first column after the title. Evidence sits next to claims. Analysis is in the strip. Sync is in its own column. Position is a second cue after the icon.
2. **One hue never carries two meanings in the same row.** For example, a "High" priority is never red next to a "Conflicting" red shield. Priority has no hue.
3. **Labels always render.** Icon-only status is allowed only in dense tables with a visible column header *and* an accessible name. Never use color alone ([S] WCAG 1.4.1 [Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)).
4. **Do not mix nouns.** The word "Verified" is reserved for evidence. Lifecycle never says "Verified". Tasks use "Done", never "Complete" or "Verified".
5. Mark status changes for assistive tech with polite live regions ([S] WCAG 4.1.3 [Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)).

**Claim type** (EVD-02) is a fifth label family. It classifies; it is not a status. Use **outlined tags**: `Fact`, `Inference · AI`, `Assumption`, `Unknown`. Glyphs: document, sparkle (violet), pencil-ruler, question-circle. A Fact without Verified evidence is not allowed. It downgrades to Inference or Unknown (Execution Plan §4.6).

**Approval states** (Decision tab): Awaiting your decision · Waiting on [second approver name] (only when policy requires two) · Approved v3 · Changes requested · Rejected · Deferred until 15 Nov 2026 · Superseded by v4 · Invalidated — evidence changed · Expired. Use a stamp-style badge on the version with actor and time.

### 6.2 Money: revenue vs pipeline vs scenario range

| Measure | Label (exact) | Visual treatment | Rules |
|---|---|---|---|
| Revenue | **Relevant annual revenue** · TTM to 30 Sep 2026 · EUR | Solid card. Large tabular figure "€24.0M". | Always shows period + currency + snapshot date. |
| Accounts | **Affected existing accounts** · distinct | Solid card. "18". | "Distinct" in the label. A drill-down lists accounts and dedup rules. |
| Pipeline | **Open pipeline** · current opportunities · EUR | Solid card, **separate card group** with a visible gap and a divider labeled "Not recognized revenue". | Never in the same chart, stack, or sentence with "+". |
| Scenario | **Scenario range (assumption)** · 5–15% assumed erosion over 12 months | **Dashed border**, "Assumption" tag, formula visible: "€24.0M × 5–15% = €1.2–3.6M". | Show the range only. No midpoint. Never use the words "loss", "at risk", or "impact" alone. Editable inputs show the editor's name. |

**Rules**
- No "Total at risk" anywhere. The type system forbids it (R4). The design must not create a slot for it.
- Use en-dash ranges with the unit once: "€1.2–3.6M".
- Use consistent rounding (one decimal in millions) and tabular figures. Use exact values in the drill-down ("€24,000,000").
- If data is missing, show "Exposure unavailable — no commercial data connected", with actions [Upload CSV] [Request access] [Continue qualitatively]. Never show "€0".

### 6.3 The three dates

| Date | Label | Icon | Default format |
|---|---|---|---|
| Event date | **Event date** ("when it happened") | calendar | Absolute: "7 Oct 2026". "Not stated" when unknown. |
| Publish date | **Published** | file-text | Absolute: "8 Oct 2026, 09:15 CET" |
| Ingestion date | **Added** ("when we found it") | inbox-arrow | Relative + absolute on hover: "2 h ago". |

**Rules**
- A date never appears without its label or a column header. There is no bare "Date" column (R11).
- Lists default to sorting by **Event date**, with the column visibly labeled.
- Show a gap warning when publish date − event date > 7 days ("Published 12 days after the event") [H: the threshold is a tenant setting].
- Time zone is stated once per view ("Times in CET").
- Use relative time only for activity and ingestion, never for event or publish dates.

### 6.4 Restricted and redacted data

- **Cell placeholder:** a lock glyph + "Restricted", fixed width. Do not use blur, asterisks matching the value length, or a partial reveal. These leak magnitude.
- **Totals:** follow Execution Plan §4.5. "Totals reflect 14 of 18 accounts you can access", or, when the count itself is sensitive, "Totals reflect your access scope." Never show a total next to a visible subtotal that lets the user derive hidden values.
- **Tooltips, exports, search, ⌘K, and notifications** follow the same rules. Restricted names never appear in the palette for unauthorized users.
- **Action:** [Request access] names the data owner. Explain the effect: "You can still complete this task. Restricted rows are summarised by their owner."
- **Restricted vs unavailable vs missing** are three different states:
  - *Restricted*: it exists, and you lack access. Lock glyph.
  - *Unavailable*: the source or license is not accessible. Cloud-off glyph.
  - *Missing*: not in the data. Dashed-circle glyph.

### 6.5 Recommended label vocabulary

| Use | Don't use | Why |
|---|---|---|
| Verified / Partial / Conflicting / Unverified | Confirmed, Validated, Trusted, "93% confidence" | One evidence vocabulary (PRD §13) |
| Scenario range (assumption) | Expected loss, Revenue at risk, Impact | PRD: not predicted loss |
| Open pipeline | Pipeline at risk | Not recognized revenue |
| Approve response · Request changes · Reject · Defer | Sign off, OK, Accept | Decision verbs match DEC-05 |
| Authorize and release plan | Sync, Push, Launch | Explicit authorization (ACT-02) |
| Confirmed in Jira | Synced | ACT-06 |
| AI draft · Accepted · Edited | Generated, Smart, Magic | Neutral provenance |
| Checking sources · Preparing impact assessment | Agent running, MCP call, Sub-agent | PRD §8 |
| Monitor (as a response) | Do nothing, Ignore | Monitor-only is a valid decision |
| Observed change · Not attributed | Revenue saved, ROI | OUT-03 |
| Dismiss (with reason) | Delete | History retained |
| Illustrative data | Demo, Fake | PRD §10 |

### 6.6 Color, icon, and text semantics (WCAG 2.2 AA)

The tokens are in §9.3. Contrast was computed with the WCAG relative-luminance formula. All semantic text/background pairs are ≥ 5.3:1 (light) and ≥ 6.8:1 (dark), which exceeds 4.5:1 for normal text ([S] [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)).

| Meaning family | Hue | Icons used | Applies to |
|---|---|---|---|
| Positive / confirmed | Green | shield-check, check-circle, link-check | Verified, Approved, Confirmed in Jira, Done |
| Caution / incomplete / blocking | Amber | half-shield, alert-triangle, pause | Partial, Needs information, Paused, Stale |
| Problem / contradiction / failure | Red | shield-alert, x-circle | Conflicting, Failed, Rejected, Invalidated |
| In progress / informational | Blue | circle-progress, info | Running, Sending…, Assessing, Executing |
| Neutral / not started / inactive | Gray | circle-dashed, archive | Draft, Unverified, Not sent, Closed, Archived |
| AI provenance | Violet | sparkle | AI draft, Inference · AI |
| Restricted | Slate | lock | Restricted values |

Rules:
- The tinted chip background is near-white (~1.15:1 vs surface). So the **text and icon carry the meaning**, and the chip needs no border to meet WCAG 1.4.11. Never rely on the chip fill alone.
- Focus ring: 2 px accent outline + 2 px offset, ≥ 3:1 against adjacent colors ([S] [WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)). Sticky headers and drawers must not hide the focused element ([S] WCAG 2.2 2.4.11 Focus Not Obscured, [What's new in 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)).
- Targets are ≥ 24×24 px (2.5.8). Kanban drag has a "Move to…" menu alternative (2.5.7). Help sits in a consistent location (3.2.6). Case-creation fields carry over from the signal so nothing is re-entered (3.3.7).

---

## 7. Information architecture and navigation

### 7.1 Validation of PRD §8

The PRD IA is sound. The case-as-workspace model matches the core thesis. I recommend six refinements:

1. **Rename "Response Cases" to "Cases"** in navigation. Keep "Response case" in page titles. Shorter labels scan faster in the sidebar. [H]
2. **Make My Actions role-aware with sub-tabs: Tasks · Approvals · Reviews.** Elena's approvals are her "actions". A separate Approvals nav item would duplicate this. Show a count badge only for items that need *the viewer*.
3. **Add a sitewide "Illustrative data" ribbon** (top, 28 px, not dismissible in the prototype).
4. **Collapse secondary navigation** (Watchlists, Portfolio, Integrations, Settings) under a "Workspace" group at the bottom of the sidebar. Hide items the role cannot use, and do not show them disabled.
5. **Add a right context panel** to the case workspace, toggled with `]`. It has three views: Activity, Comments, Source preview. It is collapsed by default for approvers and open for the CI lead. [H]
6. **Merge "Response Options" and "Decision"? No. Keep them separate**, but link them: options are *exploration*, and Decision is the *frozen package*. The Options tab ends with "Preview decision package". The Decision tab shows "Built from options v2".

### 7.2 Navigation model

- **Left sidebar** (240 px; collapses to 56 px icons): Overview · Signal Inbox · Cases · My Actions · Outcomes, then a divider, then Workspace (Watchlists, Portfolio, Integrations, Settings). The sidebar is dimmed relative to content (Linear pattern).
- **Global top bar** (48 px): search field that opens ⌘K, notifications, user menu with role and scope ("Maya Patel · CI Lead · Diagnostics"), and the "Illustrative data" ribbon above.
- **Case workspace:** case header (sticky) → lifecycle rail → tab bar (sticky) → content → optional right panel.

### 7.3 Persistent case header (content and order)

Line 1: `CR-1042` (mono) · **Apex AX-Scan Germany launch response** · [Lifecycle pill: Awaiting approval · v3] · [Priority: ▮▮▮ High]
Line 2: Apex Diagnostics · Germany · Diagnostics BU · Owner Maya Patel · Evidence: [Partial shield] · Updated 14 Oct, 10:42
Right side: **Next required action** block. It shows a primary button ("Review decision") *or* a waiting statement ("Waiting on Elena Fischer · since 2 days"), with a secondary "Why?" that lists the readiness guards.

- Add **evidence summary** to the header (the PRD omits it). Approvers asked "how sure are we" before anything else. [H]
- **Analysis strip** below the header appears only when analysis is Running, Partial, or Failed.
- The header compresses to one line on scroll (ID, title, lifecycle pill, next action).

### 7.4 Tab order

Summary · Evidence · Impact · Options · Decision · Action Plan · Outcomes · Activity. This keeps the PRD order, which follows the lifecycle.

- Tabs show **blocking counts** ("Evidence · 2 to review"). Use text plus a small count badge, never a dot alone.
- Tabs for future stages stay enabled and show a teaching empty state ("Action plan is drafted after a response is approved"). Hidden tabs break the mental model of the journey. [H]
- Keyboard: `1–8` switches tabs when focus is not in an input. Arrow keys work within the tablist (ARIA tabs pattern).

### 7.5 Deep linking

Every inspectable thing has a URL that restores the view:
- `/cases/CR-1042/evidence?claim=CLM-07&source=SRC-03&passage=2`
- `/cases/CR-1042/decision?version=3&compare=2`
- `/cases/CR-1042/plan?task=T-03`
- `/inbox?signal=SIG-881&filters=...`

Notifications and Jira back-links use these URLs. Opening a link to a superseded version shows the "Superseded" banner. Opening one without access shows "You don't have access to this case — owner Maya Patel" and never reveals the title when the case itself is restricted.

### 7.6 Global search

Scopes: Cases · Signals · Competitors · Products · Accounts (permitted only). Results show type, ID, lifecycle or evidence state, and scope. Recent items come first. Filters are expressed as tokens (`competitor:Apex market:DE`). [H]

### 7.7 "Next required action" placement

- In the case header (always).
- On Summary, a larger "Next step" card with guard checklist.
- On Overview and My Actions as list rows ("Approve response · CR-1042 · due in 2 days").
- The same string is used in all three places. It comes from the state machine (Execution Plan §4.4).

### 7.8 Role-based home views

| Role | Lands on | First thing visible |
|---|---|---|
| CI lead | Overview | Untriaged High-priority signals · Cases needing information · Overdue actions |
| Approver | My Actions › Approvals | "Awaiting your decision (1)" with the case, ask, and due date |
| PMM / Sales | My Actions › Tasks | Their tasks by due date with case context |
| Executive | Overview (portfolio mode) | Material cases, decisions pending, execution health, reviews due |
| Admin | Settings › Health | Integration health, approver coverage gaps |

---

## 8. Per-screen recommendations (PRD Screens 1–12)

### Screen 1 — Overview
- **Key question:** "What needs my attention now?"
- **Layout:** Top row of four **attention lists** (not KPI tiles): Awaiting decisions · High-priority untriaged signals · Overdue actions · Outcome reviews due. Each shows up to 3 rows plus "View all". Below is an **active cases table** (competitor, event, scope, owner, lifecycle, next step, age). A compact funnel (cases by stage) is optional; cut it first (Execution Plan §9).
- **Primary actions:** Review signals · Open pending decision · View my actions.
- **Critical states:** Empty ("Set up a watchlist" / "Explore sample case"). Skeleton with a stable layout. Partial data ("Signals last refreshed 08:10 — retrying"). Access-scoped totals ("Showing Diagnostics BU only").
- **Pitfalls:** Vanity metrics. Color-encoded quantities ([S] [NN/g dashboards](https://www.nngroup.com/articles/dashboards-preattentive/)). A full-page error when one widget fails.

### Screen 2 — Signal Inbox
- **Key question:** "Which of these matter, and is it real?"
- **Layout:** Filter bar (competitor, event type, market, verification, priority, date type + range, triage state). List rows (two lines): headline · competitor · market / Event date · source counts ("2 independent · 5 syndicated") · evidence shield · priority bars · relevance reason (one line, "Overlaps ND-200 in Germany"). Detail pane: What changed · Evidence (claims with chips) · Matched portfolio scope · Unknowns · Duplicates and linked items · Triage actions (sticky footer).
- **Primary:** Create response case. **Secondary:** Link existing case · Monitor · Dismiss.
- **Flows:** Case creation is a 2-step dialog (Scope & owner → Confirm) that carries all fields over. Dismiss and priority override require a reason (quick-pick plus optional text). Bulk archive appears only for authorized users, only for Low priority, with a count confirmation.
- **Critical states:** Unverified high-impact signal shows a banner: "Unverified — this can't be presented as a confirmed event. [Request verification]". The Create case action stays allowed but the case is marked Unverified. Duplicate detected: "Likely duplicate of SIG-870 · [Link] [Not a duplicate]". Source corrected or withdrawn reopens verification.
- **Pitfalls:** A source count that includes syndicated copies. A bare "Date". A relevance score with no reason.

### Screen 3 — Case Summary
- **Key question:** "What happened, why does it matter to us, and what happens next?"
- **Layout:** Two columns at 1440 px. Left (reading, about 680 px): What happened (with citation chips) · Why it matters (scope, products, accounts) · Open questions (Unknowns list) · Current decision. Right (about 360 px): Next step card with guard checklist · Evidence status summary · Exposure summary (three separate measures) · Recent key activity.
- **Primary CTA by state:** Start assessment · Resolve missing information · Submit for decision · Review decision · Release plan · Review outcomes. When not permitted, the button is disabled, with the reason and the name of who can act.
- **Critical states:** "Analysis incomplete — Impact assessment didn't finish. Your edits are saved. [Retry] [Continue manually]". Unverified case banner. Approval invalidated banner.
- **Pitfalls:** A wall of AI prose. Unlabeled numbers. A CTA that looks enabled but fails on click.

### Screen 4 — Evidence Workspace
- **Key question:** "Which claims are true, and how do we know?"
- **Layout:** Split view. Left: claim list grouped by claim type (Facts · Inferences · Assumptions · Unknowns), each with an evidence shield, supporting and contradicting counts, source date, reviewer, and a notes indicator. Right: source pane with publisher, the three dates, retrieval time, the highlighted passage ("Passage 1 of 3"), limitations, original link, and entity-match inspection ("AX-Scan → matched to 'AX-Scan 2' · Uncertain · [Confirm] [Change]").
- **Actions:** Accept · Correct · Exclude (with reason) · Request review. Keys: `a` / `e` / `x` / `r`.
- **Critical variants:** Unavailable source ("Licensed content — excerpt not permitted. [Open in licensed tool]"). Withdrawn claim (strikethrough + "Withdrawn 12 Oct by publisher"). Conflict (side-by-side passages). Stale ("Retrieved 94 days ago · [Recheck]"). No corroboration ("Single source"). Excluded evidence stays in history with an "Excluded — not used in current conclusion" label.
- **Med-device specific [H]:** Provide claim templates that separate *Regulatory status*, *Market availability*, *Reimbursement*, and *Clinical performance*. Default each to Unknown until evidence is attached. This makes the PRD's "regulatory status ≠ availability" rule visible.
- **Pitfalls:** Rendering full licensed text. Hiding contradictions under the supporting sources.

### Screen 5 — Impact Workspace
- **Key question:** "Where exactly does this touch our business, and how big is the exposure by each measure?"
- **Layout:** Three stacked sections.
  - (1) **Product overlap matrix**: attributes × (ND-200, AX-Scan) with per-cell citation and per-row "Confirmed / Pending review". There is no single similarity score.
  - (2) **Exposure**: three measure cards plus a scenario card (see §6.2), and a "Definition" panel (currency, period, snapshot date, filters, dedup, exclusions) with "Show calculation" drill-down to the 18 accounts.
  - (3) **Scenario assumptions**: editable low and high %, with formula, editor, and time.
- **Primary:** Confirm assessment. **Secondary:** Edit mappings · Update assumptions · Request data.
- **Critical states:** A low-confidence overlap blocks exposure: "Confirm overlap before exposure is calculated". Missing CRM shows [Upload CSV] [Continue qualitatively]. Restricted rows follow the §6.4 rules. Stale snapshot: "Snapshot 30 Sep 2026 · 8 days old".
- **Pitfalls:** A sum of revenue and pipeline. A midpoint of the scenario. A tooltip leaking a restricted value.

### Screen 6 — Response Options
- **Key question:** "What could we do, and what are the trade-offs?"
- **Layout:** Comparison table with options as columns (Monitor · Update positioning · Account review · Product assessment · + Add option). Rows: rationale, evidence, expected benefit (qualitative), effort, time, decision deadline, dependencies, risks, success measures. A "Recommended" marker with its reasoning is shown. **Nothing is pre-selected.** Use selection checkboxes with a compatibility check ("Positioning update + Account review are compatible").
- **Actions:** Add option · Edit option · Select response · Preview decision package.
- **Pitfalls:** Numeric ROI. Auto-selection based on exposure. Hiding Monitor as a second-class option.

### Screen 7 — Decision Review
- **Key question (approver):** "Exactly what am I authorizing, and is it sound?"
- **Layout:** Reading mode: one centered column of about 720 px, using Source Serif 4 for the body. Sections: Event · Confirmed facts · Exposure definition · Assumptions · Chosen responses · Alternatives considered · Resources · Owners · Success measures · Known limitations. On the right, a sticky **approval panel**: version and fingerprint, "Your authority: Diagnostics · DE · positioning, account review", approval chain (1 of 1), and actions.
- **Primary:** Approve response. **Alternatives:** Request changes · Reject · Defer. Every action opens a confirmation that requires a rationale and optional constraints. Section-anchored comments support "request one clarification".
- **Variants:** Waiting on another approver · Superseded version · Approval expired or invalidated (with what changed) · Role insufficient (an Escalate action) · Monitor-only approval (requires owner, trigger, review date).
- **Pitfalls:** The approve button visible above the fold before the content is seen [H: test whether a "read to end" affordance helps or annoys]. Editable content in a submitted version.

### Screen 8 — Action Plan
- **Key question:** "Who does what by when, and did it reach their system?"
- **Layout:** A "Draft plan" / "Released plan v1" toggle. Table columns: task, owner (accepted?), deliverable, due, dependency, internal status, external status, completion evidence. Task drawer for details. Kanban is optional; cut it first.
- **Primary:** Authorize and release plan. This opens a **preflight** page or stepper: tasks → destination preview (Jira project, issue type, exact field values per task) → notifications → authorization statement ("Authorizes plan v1 under approval v3") → Confirm.
- **States:** All confirmed. **Partial**: "3 of 4 tasks confirmed in Jira. 1 failed (timeout). [Retry 1 failed task]". Ambiguous: "Checking Jira before retrying". Revoked approval: "Sending paused — approval invalidated on 16 Oct". Disconnected integration: "Jira disconnected · Internal tasks still active".
- **Pitfalls:** "Generate plan" implying release. A global "Synced" indicator. Retrying all tasks.

### Screen 9 — My Actions
- **Key question:** "What do I owe, and what do I need to do it?"
- **Layout:** Tabs: Tasks · Approvals · Reviews. Rows are sorted by due date then priority, with case context (ID, short title), blockers, and missing deliverables. Selecting a row opens a focused task view with a "Brief for this task" panel (see §3.3).
- **Actions:** Accept assignment · Mark in progress · Attach deliverable · Submit completion · Flag blocker.
- **States:** Blocked by a dependency ("Waiting on T-01 · Validate claims"). Completion pending reviewer acceptance. Reassigned (with history).
- **Pitfalls:** Forcing collaborators into the full case workspace for simple tasks.

### Screen 10 — Outcomes
- **Key question:** "What changed, what can we honestly say about why, and what now?"
- **Layout:** Per case: baseline · review window · intended targets · action completion · observed indicators (each with evidence) · **limitations and confounders** (a required field) · recommendation. Use the "Observed change" vs "Attribution: not established" wording. Portfolio view: decision speed, action completion, and review discipline as bar charts with definitions.
- **Primary:** Record review → Close case · Continue monitoring · Reopen assessment (each with rationale).
- **States:** Missing baseline → "Unable to compare". Review overdue.
- **Pitfalls:** "Revenue saved" cards. Treating task completion as success.

### Screen 11 — Watchlists and Portfolio
- **Key question:** "Are we watching the right things, and is our product and account data sound?"
- **Layout:** Watchlist editor (competitors, products, markets, event types, routing owner, thresholds, digest). Preview "What would have been surfaced" with historical examples (cut third). Portfolio import is a stepper: Map fields → Validate (errors, missing values, duplicates) → Preview → Create dated snapshot. Snapshot history shows date, row count, and creator.
- **Pitfalls:** Activation without minimum scope and owner (ONB acceptance). Silent overwrites of an earlier snapshot.

### Screen 12 — Integrations and Settings
- **Key question:** "Is everything connected safely, and who can do what?"
- **Layout:** Health rows per integration (status, read/write scope, permissions, last successful sync, freshness, authorized destinations, [Test]). Roles: an approver coverage matrix highlighting gaps. Audit log with filters. Retention and analysis-policy controls.
- **Pitfalls:** Admins appearing to have approval rights. Hidden write scopes.

---

## 9. Visual direction

**Tone:** quiet, precise, document-grade. References: **Linear** (density, calm chrome, keyboard), **Stripe Dashboard** (number typography, definitions near figures), **Attio** (refined tables, restraint), **Vercel** (health and status rows), **GitHub PR review** (versioned review, diffs). Avoid the "AI product" aesthetic: gradients, glows, sparkle overload, chat-first layouts.

### 9.1 Typography

| Role | Font (open license) | Use |
|---|---|---|
| UI sans | **Inter** ([rsms.me/inter](https://rsms.me/inter/)), with `font-variant-numeric: tabular-nums` in tables and figures, and slashed zero for IDs | All interface text |
| Reading serif | **Source Serif 4** ([Adobe Fonts GitHub](https://github.com/adobe-fonts/source-serif)) | Decision Review body, evidence passages, exported brief |
| Mono | **IBM Plex Mono** ([IBM Plex](https://github.com/IBM/plex)) | Case IDs, version fingerprints, Jira keys |

Type scale (px / line-height): 12/16 caption · 13/20 table and dense UI · 14/20 body UI · 16/24 reading body (serif 17/28) · 18/26 section title · 20/28 page title · 24/32 case title · 30/38 KPI figure. Weights: 400, 500, 600. Avoid 700+ except in figures.

### 9.2 Spacing, density, layout

- **Spacing scale (4 px base):** 2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64.
- **Density:** Table rows are 36 px (compact, default for CI lead) or 44 px (comfortable, default for approver and exec). Use a user toggle.
- **Radius:** 4 (chips, inputs) · 6 (buttons, cards) · 8 (drawers, modals).
- **Layout at 1440:** sidebar 240 · content max 1160 · right panel 360. At 1280, the sidebar collapses to 56 and the right panel becomes an overlay drawer.
- **Reading measure:** 60–75 characters for evidence and decision text.

### 9.3 Color tokens (contrast-checked)

**Light theme**

| Token | Hex | Note |
|---|---|---|
| `bg.canvas` | #F7F7F5 | Warm neutral page |
| `bg.surface` | #FFFFFF | Cards, tables |
| `bg.sunken` | #F0F0EC | Wells, code |
| `border.subtle` | #E4E4DF | Dividers (decorative) |
| `border.control` | #84888F | Inputs, checkboxes (3.3:1 on canvas) |
| `text.primary` | #17181B | 16.6:1 |
| `text.secondary` | #4B4F57 | 7.7:1 |
| `text.tertiary` | #6A6E76 | 4.8:1 (minimum for small text) |
| `accent` | #3049C9 | Links, primary button, focus. White on accent 7.2:1 |
| `success.fg / bg` | #1B7046 / #E6F3EB | 5.3:1 |
| `warning.fg / bg` | #8A5300 / #FBF0DA | 5.6:1 |
| `danger.fg / bg` | #B3261E / #FCEBEA | 5.7:1 |
| `info.fg / bg` | #2853B8 / #E9EEFA | 6.0:1 |
| `neutral.fg / bg` | #4B4F57 / #EEEEEB | 7.1:1 |
| `ai.fg / bg` | #6A3DB0 / #F1ECFA | 6.2:1 |
| `restricted.fg / bg` | #3B4250 / #E8EAEE | 8.4:1 |

**Dark theme**

| Token | Hex | Note |
|---|---|---|
| `bg.canvas` | #0F1012 | |
| `bg.surface` | #17191C | |
| `bg.raised` | #1E2125 | Drawers, popovers |
| `border.subtle` | #2A2E34 | |
| `border.control` | #6A707A | 3.2–3.8:1 |
| `text.primary` | #ECEDEF | 15.0:1 on surface |
| `text.secondary` | #B3B7BF | 8.8:1 |
| `text.tertiary` | #8B9099 | 5.5:1 |
| `accent` | #8DA2F7 | Dark text on accent 7.8:1 |
| `success.fg / bg` | #5FCB93 / #12291D | 7.7:1 |
| `warning.fg / bg` | #E9B651 / #2D2410 | 8.2:1 |
| `danger.fg / bg` | #F48A84 / #331817 | 6.9:1 |
| `info.fg / bg` | #86A9F6 / #152039 | 7.0:1 |
| `neutral.fg / bg` | #B3B7BF / #24272C | 7.5:1 |
| `ai.fg / bg` | #BBA0F4 / #251D3B | 7.2:1 |
| `restricted.fg / bg` | #C3C8D1 / #262A31 | 8.6:1 |

Rules: Semantic hues are for status only, never for decoration or branding. The accent is for interaction only. Charts use the neutral scale plus the accent, with semantic hues only for status series.

### 9.4 Elevation

- Level 0: flat surfaces separated by `border.subtle`. This is the default.
- Level 1: popovers and hover cards. 1 px border + `0 4px 12px rgba(15,16,18,.08)`.
- Level 2: drawers. `0 8px 24px rgba(15,16,18,.12)`.
- Level 3: modals plus a 40% canvas scrim.
- In dark mode, raise with lighter surfaces (`bg.raised`), not shadows.

### 9.5 Motion

- Durations: 120 ms (hover, chips) · 180 ms (popover, tab) · 240 ms (drawer, modal). Easing `cubic-bezier(0.2, 0, 0, 1)` for enter and `cubic-bezier(0.4, 0, 1, 1)` for exit.
- Motion explains *where things came from* (drawer slides from its edge) or *what changed* (a 600 ms highlight fade on an updated value). It never decorates.
- No looping animation except the analysis progress glyph. It stops when the run ends.
- `prefers-reduced-motion: reduce` → replace slides with ≤ 80 ms opacity fades, disable highlight pulses, and use a static progress glyph with text ([S] [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)).

### 9.6 Iconography

- **Lucide** ([lucide.dev](https://lucide.dev/), ISC license). Use a 1.5 px stroke at 16 px (20 px in headers).
- Reserve icon families per meaning (see §6.6). Use fewer icons than you think you need. Linear's refresh reduced icon count and size to cut noise ([S] [Linear refresh](https://linear.app/now/behind-the-latest-design-refresh)).
- Every icon-only button has a visible tooltip and an accessible name.

### 9.7 Core components (PRD §20 list, plus specs)

| Component | Key anatomy |
|---|---|
| Source reference chip | shield glyph · publisher · date · (+N) · hover preview · click-to-pane |
| Verification tag | shield family · label · optional "by Maya · 12 Oct" |
| Uncertainty notice | amber left rule · "What we don't know" · list · action |
| Exposure summary | 3 measure cards + dashed scenario card + "Definition" link |
| Approval control | version and fingerprint · authority · chain · 4 actions · rationale modal |
| Version selector | dropdown with state stamps (Current, Superseded, Invalidated) + Compare |
| Task status | internal glyph and label + external link glyph and key/status |
| Activity item | actor avatar · verb · object/version · time · pinned flag |
| AI provenance badge | violet sparkle · "AI draft" / "edited" / accepted state |
| Restricted cell | lock · "Restricted" · fixed width · no tooltip value |
| Next-action block | primary button or waiting statement · "Why?" guard list |
| Illustrative-data ribbon | persistent, neutral, 28 px |

---

## 10. Validation plan

### 10.1 Research questions

1. Can each persona say what the case's next step is, and who owns it, within 10 seconds of opening it?
2. Do users correctly tell priority, evidence strength, lifecycle, analysis status, and sync status apart?
3. Do users understand that €24M, €6M, and €1.2–3.6M are different measures that must not be added?
4. Do users notice and question weak AI claims, or do they accept them (automation bias)?
5. Does the approver feel confident about *exactly* what they approved?
6. Can users recover from a partial Jira sync failure without creating duplicates or anxiety?
7. Do collaborators (PMM, sales) finish tasks without case-workspace training?
8. Is the rail-plus-tabs model clearer than alternatives for a non-linear lifecycle?
9. Is the redaction treatment understood, and does it feel respectful, not broken?
10. Which outcome wording do executives find credible?

### 10.2 Usability test script (CR-1042 journey)

Format: moderated, remote, 60 minutes, think-aloud, with the clickable prototype on fixture data. Run separate sessions per role. Use the [S] NN/g guidance on small iterative rounds of about 5 users per round per segment ([NN/g, test with 5 users](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/)).

**Intro (5 min).** Consent. "We are testing the design, not you." Role context: "Tell me about the last competitor event your team acted on."

**CI lead tasks (Maya), 35 min**
1. *Triage.* "Open the inbox. Find the item you'd act on first and explain why." Success: picks the Apex signal and cites priority and evidence separately.
2. *Verify.* "Is the regulatory status confirmed? Show me how you know." Success: opens the claim and passage, and states the limitation. **Planted check:** one AI inference with a weak, single syndicated source. Do they flag it?
3. *Duplicates.* "Two notices look the same. Handle that." Success: links the duplicate, and source counts update correctly.
4. *Create case.* Success: carries prefilled fields over, sets owner and scope.
5. *Impact.* "How much revenue is exposed? What about pipeline? What's the worst case?" Success: states the three figures separately, with labels, and calls the range an assumption. Then: "Change the high assumption to 12%."
6. *Options.* "Choose the response you'd propose." Success: selects two compatible options without the recommended one being pre-set. Previews the package.
7. *Plan and sync.* "Release the plan." After the forced failure: "What happened? Fix it." Success: says 3 tasks were created and 1 failed, and retries only the failed one.

**Approver tasks (Elena), 20 min**
1. "You got a notification. What are you being asked to approve?" Success: names the version, responses, owners, and constraints.
2. "Ask for one clarification." Then, on the revised v3: "What changed?" Success: uses the diff.
3. "Approve it." Success: enters a rationale and understands that the plan release is separate.
4. Variant: "Evidence changed after approval. What does that mean for you?"

**Collaborator tasks (Jonas or Sofia), 15 min**
1. "Find what you owe and finish it." Success: attaches the battlecard or submits the account summary.
2. Sofia: "How many accounts are affected in total?" (restricted rows present). Success: reads the scope label correctly and does not infer hidden values.

**Exec task, 10 min.** "Is execution on track for CR-1042? Did the response work?" Success: separates observed change from attribution.

**Debrief (5 min).** SEQ after each task. Trust questions: "Which parts would you forward to your boss as-is? Which would you check first?"

### 10.3 Prototype success metrics (targets are hypotheses)

| Metric | Target |
|---|---|
| Task success (unassisted) on core journey tasks | ≥ 80% per task |
| Status-dimension comprehension (5-dimension quiz on a screenshot) | ≥ 90% correct |
| Exposure comprehension (no summing; range called an assumption) | 100% of participants. Any failure is a blocker. |
| Planted weak-claim detection | ≥ 60% flag it unprompted [H: baseline unknown; use to compare variants] |
| Approver can state the exact approved version and scope | ≥ 90% |
| Sync recovery without retrying confirmed tasks | ≥ 90% |
| Single Ease Question (7-point) | median ≥ 5.5 |
| Time to identify next action on case open | median ≤ 10 s |
| PRD §20 acceptance walkthrough (6 items) by an unbriefed reviewer | 6 / 6 |

### 10.4 Recruiting criteria

- **CI leads (5–6):** Own competitive intelligence at a B2B company with more than 500 employees. Have led at least one competitive response in the past 12 months. At least 2 participants from med-device or diagnostics.
- **Approvers (4–5):** BU head, VP Strategy, or GM who approved a competitive or commercial response in the past 12 months.
- **PMMs (4–5)** and **regional sales leaders (4–5):** Received CI-driven tasks in the past 6 months. Mix of DACH and other EU regions.
- **Executives (2–3)** and **admins (2–3):** Optional in round 1.
- **Screen out:** Employees of CI vendors. People who joined a CR-OS concept session (to avoid priming).
- **Mix:** Some current users of Klue, Crayon, or AlphaSense, and some who use spreadsheets and email only. Include at least one participant who uses screen magnification or a screen reader for an accessibility pass.

---

## 11. Hypothesis register (validate before high-fidelity sign-off)

| # | Hypothesis | How to test |
|---|---|---|
| H1 | Approvers review in short windows and value a reading mode over a dashboard | Approver sessions, think-aloud |
| H2 | A monochrome priority glyph is understood without color | 5-dimension quiz |
| H3 | Evidence strength in the case header reduces approver probing time | A/B with and without |
| H4 | A lifecycle rail beats a stepper for a non-linear case | First-click and comprehension test |
| H5 | Not pre-selecting the recommended option increases weak-claim detection without slowing decisions too much | Compare variants |
| H6 | Collaborators complete tasks from My Actions without visiting case tabs | Path analysis in the prototype |
| H7 | The "Totals reflect your access scope" wording is understood and accepted | Sales sessions |
| H8 | Claim templates (regulatory / availability / reimbursement / clinical) fit med-device CI practice | Domain-analyst review + CI lead sessions |

---

## 12. Sources

- Crayon, 2025 State of Competitive Intelligence: https://www.crayon.co/hubfs/Crayon%27s%202025%20State%20of%20CI%20Report.pdf
- Klue, AI in Competitive Intelligence Report 2026: https://klue.com/ai-in-competitive-intelligence-report-2026
- Sedulo Group, 2025 Life Sciences CI Survey: https://sedulogroup.com/blog-post/2025-ci-survey-findings/ and https://sedulogroup.com/competitive-early-warning-system-life-sciences/
- Product Marketing Alliance: https://www.productmarketingalliance.com/what-is-product-marketing/
- Salesforce sales research 2023: https://www.salesforce.com/news/stories/sales-research-2023/
- McKinsey, European public procurement in medtech: https://www.mckinsey.com.br/industries/life-sciences/our-insights/the-european-public-procurement-opportunity-delivering-value-in-medtech
- BCG, Moving beyond the "milkman" model in medtech: https://www.bcg.com/publications/2017/medical-devices-technology-marketing-sales-moving-beyond-milkman-model-medtech
- AiM/IGES, Reimbursement of Medical Devices in Germany 2024/25: https://aim.iges.com/sites/igesgroup/aim-germany.com/myzms/content/e207/citemtext/AIM-REI-Medial-Devices_2024_25_web_schreibschutz_eng.pdf
- NN/g: https://www.nngroup.com/articles/explainable-ai/ · https://www.nngroup.com/articles/data-tables/ · https://www.nngroup.com/articles/skeleton-screens/ · https://www.nngroup.com/articles/progressive-disclosure/ · https://www.nngroup.com/articles/dashboards-preattentive/ · https://www.nngroup.com/articles/response-times-3-important-limits/ · https://www.nngroup.com/articles/ui-accelerators/ · https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/
- Amershi et al., Guidelines for Human-AI Interaction (CHI 2019): https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/ · HAX Toolkit: https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/
- Google PAIR, Explainability + Trust: https://pair.withgoogle.com/chapter/explainability-trust/
- Goddard, Roudsari & Wyatt, Automation bias (JAMIA 2012): https://academic.oup.com/jamia/article/19/1/121/732254
- Parasuraman & Manzey, Complacency and bias in human use of automation (2010): https://journals.sagepub.com/doi/10.1177/0018720810376055
- Zhang, Liao & Bellamy, Effect of confidence and explanation on trust calibration (2020): https://arxiv.org/abs/2001.02114
- Carbon status indicators: https://carbondesignsystem.com/patterns/status-indicator-pattern/
- Atlassian lozenge: https://atlassian.design/components/lozenge/usage
- W3C WCAG 2.2: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ · https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html · https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html · https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html · https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- MDN prefers-reduced-motion: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- Linear: https://linear.app/docs/triage · https://linear.app/blog/how-we-redesigned-the-linear-ui · https://linear.app/now/behind-the-latest-design-refresh
- GitHub protected branches: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches · discussion: https://github.com/orgs/community/discussions/12876
- Ramp: https://support.ramp.com/hc/en-us/articles/4417843897747-Bill-Pay-approvals · https://support.ramp.com/hc/en-us/articles/41025649662611-Ramp-Banking-Approvals
- Vanta Controls page: https://help.vanta.com/hc/en-us/articles/11750680642196-Controls-Page
- Klue product: https://klue.com/product/create · Crayon Sparks: https://crayon.co/sparks · ZoomInfo Crayon review: https://pipeline.zoominfo.com/sales/crayon-review
- AlphaSense: https://help.alpha-sense.com/en/articles/7225201-expert-transcripts-overview · https://www.library.hbs.edu/services/help-center/locating-expert-call-transcripts-in-alphasense
- Perplexity citation teardown: https://aiuxplayground.com/teardowns/perplexity/citations
- Elicit supporting quotes: https://support.elicit.com/en/articles/14758168-extracting-data-from-a-table-within-a-paper-in-column-answers
- NotebookLM help: https://support.google.com/notebooklm/answer/14276569?hl=en
- Hebbia (third-party review): https://www.datastudios.org/post/hebbia-ai-document-research-for-finance-matrix-workflows-and-pricing
- Harvey: https://help.harvey.ai/en/articles/10580373-getting-started-with-harvey · https://www.legaltechnologyhub.com/vendors/harvey
- Zendesk context panel: https://support.zendesk.com/hc/en-us/articles/4408836526362-Using-the-context-panel
- incident.io severities: https://docs.incident.io/incidents/severities
- PagerDuty stakeholder communication: https://support.pagerduty.com/docs/communicate-with-stakeholders
- Telerik citation component: https://www.telerik.com/design-system/docs/components/citation/ · Neon inline citation: https://ui.neon.com/agent/inline-citation
- Fonts and icons: https://rsms.me/inter/ · https://github.com/adobe-fonts/source-serif · https://github.com/IBM/plex · https://lucide.dev/
