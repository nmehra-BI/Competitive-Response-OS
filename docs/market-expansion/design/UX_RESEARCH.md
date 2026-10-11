# Market Expansion OS — UX/UI Research and Design Guidance

**Input for:** UX/UI designer (high-fidelity clickable prototype, PRD §15) • **Based on:** [Market Expansion OS PRD v0.1](../PRD.md) and the sister-app research [Competitive Response OS UX Research](../../design/UX_RESEARCH.md) (called "CR research" below) • **Author role:** Staff UX/UI Researcher • **Date:** 9 October 2026 • **Method:** Secondary research plus expert heuristics. No primary interviews were run.

## How to read this report

- **[S]** marks a finding backed by a cited public source. The URL is inline.
- **[H]** marks my expert hypothesis. The test plan in §11 validates it.
- **→** marks the design implication. Every finding ends in one.
- Some sources are vendor pages or secondary summaries. I say so where it matters. Treat vendor claims as descriptions of intent, not as proof of effect.
- I quote no interview participants. I invent no statistics. All numbers in the Aster examples come from PRD §6 and are synthetic.
- "CR research §x" points to the earlier report. Where a rule carries over unchanged, I point to it and do not repeat it.

---

## 1. Executive summary: top 10 design implications

1. **Make the gate, not the case, the unit of authority.** Each gate button names its exact scope and money: "Approve validation €15k (G1)", "Approve pilot €120k · 90 days (G2)", "Authorize scale (G3)". A bare "Approve" never appears. Stage-gate practice expects gates to end in Go, Kill, Hold, or Recycle against criteria set in advance ([S] [Mind Tools on Stage-Gate](https://prime.mindtools.com/pages/article/stage-gate-innovation.htm)). Discovery-driven planning releases money milestone by milestone as assumptions are tested ([S] [Christensen Institute summary of McGrath & MacMillan](https://www.christenseninstitute.org/blog/thursday-theory-tips-how-do-i-plan-my-new-venture/)). → The approval panel has a "What this authorizes" box and a "What this does not authorize" box. For G2 the second box says: "Not market entry. Not scale. Not prospect outreach."

2. **Show market measures as a nested funnel of populations, never as a stack of money to add.** TAM €100m/year, SAM €40m/year, reachable pool of 500 sites, and SOM €2.0m annual revenue at end of year 3 are four different questions. Show each with its unit, year, currency, and a one-line meaning ("Demand in the defined market. No claim of capture."). → Use a "measure ladder": rows that narrow by site count first (5,000 → 2,000 → 500 → 100 customers) and money second. Never use a stacked bar, a sum, or a "total opportunity". Sizes in concentric circles are banned because area reads as share. [H]

3. **Give every number a visible epistemic kind: Evidence, Assumption, Scenario, or Actual.** Each kind has its own line style, glyph, label, and tint. Evidence is solid with a document glyph. Assumption is dashed with a ruler-pencil glyph. Scenario is dotted with a branch glyph and always names its scenario ("Base"). Actual is a solid ink fill with a flag glyph and a measurement period. → A reader can tell "20% adoption (Assumption)" from "3 of 4 pilots met threshold (Actual)" without reading the column header. This extends CR research's claim-type tags (§6.1) into numbers.

4. **Put a formula-and-lineage ledger behind every computed figure, and let users trace it like Excel's "Trace precedents".** Excel shows precedent and dependent cells with arrows, one level per click ([S] [Microsoft Support](https://support.microsoft.com/office/display-the-relationships-between-formulas-and-cells-a59bef2b-3701-46bf-8ff1-d3518771d507)). → A click on "SAM €40m/year" opens a drawer: formula in words and symbols, each input with its kind, source, owner, and version, and a "Used by" list (SOM, economics, G2 package). The user never needs chat to understand a figure.

5. **Show the overlap adjustment as arithmetic, not as a Venn diagram alone.** "1,400 size-qualified + 1,100 process-qualified − 500 in both = 2,000 unique sites." → A cohort table with a signed "Overlap removed −500" row, a dedup rule ("unique by site ID; parent company does not merge sites"), and a blocking check when overlap is negative or larger than either cohort. A Venn sketch is optional and always sits next to the table.

6. **Rank assumptions by decision sensitivity × evidence quality, and tie each top assumption to a pre-registered experiment card.** Strategyzer's assumptions mapping tests first what is important and has little evidence ([S] [Strategyzer](https://www.strategyzer.com/library/how-assumptions-mapping-can-focus-your-teams-on-running-experiments-that-matter)). Eppo argues teams should decide what each outcome means before the experiment runs ([S] [Eppo](https://geteppo.com/blog/make-decisions-before-experimenting)). → The experiment card locks its threshold at approval ("≥ 4 paid commitments from 20 sites"). Edits after lock create an amendment. The original threshold and the original result stay visible in history.

7. **Treat negative outcomes as decisions, not errors.** "Revise and extend" and a blocked scale gate are the correct prototype ending. Stage-gate guidance warns that gates that never kill anything are a common failure ([S] [netguru stage-gate guide](https://www.netguru.com/blog/stage-gate-process-guide)). → Use neutral and amber for "Stopped", "Not approved", and "Blocked", never red. Red stays reserved for system failures and invalidated approvals. The outcome screen leads with "What we learned" and "Decision recorded", not with a failure banner.

8. **Keep five money measures apart, and never let one-time money join recurring money.** Annual market spend, annual revenue, gross contribution, contribution after opex, and one-time investment each get a labelled row with "/year" or "one-time". Budgets show "Approved €120k · Spent €x · Remaining €y". → No row, chart, or sentence adds €400k one-time to €600k/year. Payback and cash flow show "Not available — needs ramp, retention and cash-timing inputs" (PRD §6).

9. **One header, one next decision, one freshness signal.** The case header shows owner, stage, next required decision with its owner, and evidence freshness ("Evidence checked 3 days ago · 1 source stale"). → This carries over the CR "Next required action" block (CR research §7.3). Stale evidence or a changed scope disables approval with the reason and a "Refresh snapshot" action.

10. **One Growth OS visual family, with Geist replacing Inter.** Keep CR tokens: warm neutral canvas, one indigo accent, semantic hues for status only, violet for AI, a 4 px grid, and calm motion. Change the fonts to **Geist** (UI), **Source Serif 4** (reading), and **Geist Mono** (IDs, versions, ledger figures). Add an epistemic palette, an ordinal scenario ramp (petrol blue, no red or green), and gate diamonds. → Competitive Response and Market Expansion look like one product. Each app gets a small app glyph in the switcher, not a new color scheme.

---

## 2. What carries over, what changes, what is new

| Area | Carries over from CR research (reuse as is) | Changes for Market Expansion | New for Market Expansion |
|---|---|---|---|
| Evidence and citations | Claim-level chips, publisher labels, passage panel, "Passage 1 of 3", restricted/unavailable/missing states (CR §4.3, §5.4, §6.4) | Evidence now also feeds *numbers* (inputs), not only claims | Input-lineage ledger (§6.3). "Used by" impact lists |
| AI provenance | `AI draft` → `edited` → `Accepted by`. No pre-selection. Neutral copy (CR §5.11) | AI may *propose* assumptions and values. Proposal never becomes an input until a human accepts it | AI badge sits beside, never replaces, the epistemic kind |
| Status grammars | One grammar per dimension, fixed position, icon + text + color (CR §6.1) | Lifecycle becomes **case stage** with PRD labels. Priority glyph is not needed at case level | **Gate status** (diamond glyphs), **experiment result**, **assumption status**, **opportunity status**, **connector status** |
| Approval | Version-bound approval, fingerprint, "Changes since vN", materiality rule, chain list (CR §4.2, §5.8) | Approval is per gate and states money, duration, geography, segment | "Authorizes / Does not authorize" boxes. Conditions that block execution. Dissent panel |
| Honest sync | Two columns, "Confirmed · KEY", retry only failed, "Checking" after timeout (CR §5.9, Screen 8) | Same, for pilot tasks | Dry-run preview is mandatory before first write (ME-13) |
| Money | Typed measures, no totals, ranges with en dash, no "€0" for missing (CR §6.2) | Suffix changes from "M" to "m" ("€100m/year"). Recommend CR adopts it too | Five measures, recurring vs one-time split, budget vs spent, capacity caps, scenario ladder |
| Visual tokens | Neutral palette, semantic hues, spacing, radius, elevation, motion, Lucide icons (CR §9) | **Inter → Geist. IBM Plex Mono → Geist Mono** | Epistemic tokens, scenario ramp, categorical chart palette, gate glyphs, number rules |
| IA | Role-based landing, sticky header, rail + tabs, deep links, ⌘K, right context panel (CR §7) | Tabs follow PRD case nav (9 tabs). "Reviews" is global nav | Growth OS app switcher. Read-only "Decision brief" path for reviewers |
| Validation plan | Moderated 60-minute format, SEQ, ~5 users per round per segment (CR §10) | New journey (Aster) | Comprehension checks for measure ladder, scenarios, and gate scope |

---

## 3. Research context: what the evidence says

| Finding | Source | Design implication |
|---|---|---|
| [S] Stage-gate splits work into stages and gates. Gates use preset deliverables and criteria. Outcomes are Go, Kill, Hold, or Recycle. Gatekeepers are senior resource owners. | [Mind Tools](https://prime.mindtools.com/pages/article/stage-gate-innovation.htm); [Agile Brand Guide](https://agilebrandguide.com/wiki/models/stage-gate-process/) | → Gates G0–G3 each list their deliverables as a checklist. The decision set includes "Return for revision" (Recycle), "On hold", and "Stop", not only "Approve". |
| [S] A common stage-gate failure is gates that never kill anything. Decisions drift to momentum and politics. | [netguru](https://www.netguru.com/blog/stage-gate-process-guide); [Agile Brand Guide](https://agilebrandguide.com/wiki/models/stage-gate-process/) | → Make "Stop" and "Not approved" dignified, visible, and counted as decisions (PRD §12 north star). |
| [S] Planview's gated-project dashboard shows status, scoring, and financials by gate, with gate dates under each gate symbol. | [Planview Success Center](https://success.planview.com/Planview_Portfolios/Analytics_and_Reporting/FastTrack_Analytics_and_Dashboards/FastTrack_Dashboards/RPM_Dashboard_WRK101_-_Gated_Project_Detail) | → A gate rail with a glyph per gate and a date under each is a familiar pattern for this audience. Reuse it. |
| [S] Discovery-driven planning starts with the result the venture must deliver, works backward to required assumptions, keeps an assumptions checklist ranked with deal-killers first, and tests at milestones. | [Christensen Institute](https://www.christenseninstitute.org/blog/thursday-theory-tips-how-do-i-plan-my-new-venture/); [Burleson summary](https://scottburleson.substack.com/p/article-summary-discovery-driven) | → The Economics screen offers "What must be true?" from the contribution target back to adoption, price, and margin. The register sorts deal-killers first. |
| [S] Bain reports that only about one in four adjacency moves supports profitable growth, and that success ties to a strong core and repeatable formula. | [Bain, Hard Core Growth](https://www.bain.com/insights/hard-core-growth-bain-research-shows-how-smart-companies-profit-from-their-core-business-beyond/) | → Sponsors are right to be skeptical. The thesis must show "reasons to win" tied to the core product, plus "no entry" as an alternative. |
| [S] Planning suffers from optimism bias and strategic misrepresentation. Reference class forecasting checks the inside view against outcomes of similar past projects. | [PMI, Planning for the planning fallacy](https://www.pmi.org/learning/library/planning-fallacy-causes-solutions-project-expectations-6374); [Flyvbjerg 2006](https://risknet.de/fileadmin/eLibrary/Flyvbjerg-Nobel-PMJ2006.pdf) | → Top-down cross-checks and "comparable cases" are outside-view checks. Show them beside the bottom-up model. Never blend them. |
| [S] Kahneman, Lovallo & Sibony give a 12-question checklist for big decisions. It asks whether alternatives were explored, numbers are well grounded, and the team is overconfident or attached to past decisions. | [HBR store page](https://store.hbr.org/product/the-big-idea-before-you-make-that-big-decision/R1106B) | → The decision package has required sections for alternatives (including no entry), dissent, and known limitations. |
| [S] Lovallo & Sibony argue analysis is useless unless the decision process gives it a fair hearing, including stimulating debate. | [McKinsey Quarterly](https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/the-case-for-behavioral-strategy) | → Dissent is a first-class, signed section. Reviewers can record "Approve with dissent noted". |
| [S] A premortem asks the team to assume the project failed and list why. | [Wikipedia, Pre-mortem](https://en.wikipedia.org/wiki/Pre-mortem) (cites Klein, HBR 2007) | → Offer an optional "Premortem" prompt in Validation that seeds assumptions and stop rules. |
| [S] Showing numeric uncertainty lowers confidence in the number but did not reduce trust in the source in UK experiments. | [van der Bles et al., PNAS 2020](https://research.rug.nl/en/publications/the-effects-of-communicating-uncertainty-on-public-trust-in-facts/); [review, RSOS 2019](https://wrap.warwick.ac.uk/116193/) | → Ranges and "Assumption" labels do not cost credibility. Show them. |
| [S] Precise numbers anchor people more strongly than round ones. Later work links precision to perceived competence. | [Janiszewski & Uy 2008](https://pubmed.ncbi.nlm.nih.gov/18271859/); [Frech et al.](https://fis.leuphana.de/de/publications/how-attribution-of-competence-and-scale-granularity-explain-the-a/) | → False precision ("€2,013,447") over-anchors approvers. Round display values to the precision the evidence supports (§6.8). |
| [S] Finance business partners are expected to challenge assumptions and break questions into drivers. | [Gartner, finance business partnering](https://www.gartner.com/en/finance/insights/business-partnering); [Board FP&A guide](https://board.com/wp-content/uploads/2025/01/board_fpa-assessment_mini-guide_business-partneringcollaboration.pdf) | → Daniel (finance) needs driver-level inputs, editable in a sandbox, with a sign-off that lists what he checked and what he did not. |
| [S] Explanations alone can raise acceptance of AI output whether or not it is right. Cognitive forcing reduced over-reliance in one study. | [Summary of over-reliance research, arXiv 2402.07632](https://arxiv.org/abs/2402.07632v4); CR research §2 (automation bias) | → AI-proposed values never pre-fill a decision input. A human must accept each one. Show "What the analysis did not check". |

---

## 4. User behavior by persona

These profiles combine PRD §2 with the sources above. Lines tagged [H] need checking with design partners. Aster names are the prototype cast.

### 4.1 CSO / BU sponsor (Elena Fischer, BU VP). Economic buyer and approver.

| Dimension | Profile |
|---|---|
| How they plan entry today | [S] Gate meetings with preset criteria. Go/Kill/Hold/Recycle ([Mind Tools](https://prime.mindtools.com/pages/article/stage-gate-innovation.htm)). [H] Investment committee packs in PowerPoint, built by strategy, with a finance appendix in Excel. Decisions are often taken in the meeting and written up later. |
| Decision triggers | [H] A bounded ask (amount, duration, scope). A named owner. Stop rules. A clear "what we learn for this money". Fit with the BU growth target. |
| Trusts sizing when | [H] Market boundary is stated. Bottom-up is reconciled with a top-down check. Finance has signed. The adoption rate is called an assumption and has a test. |
| Distrusts when | [S] Optimism bias and strategic misrepresentation are known risks in business cases ([PMI](https://www.pmi.org/learning/library/planning-fallacy-causes-solutions-project-expectations-6374)). [H] A big TAM used as a selling point. Hockey-stick charts. A single-point forecast. Approval buttons that seem to commit more than the ask. |
| Attention and time | [H] 10–20 minute windows between meetings. Reads summary and ask, then spot-checks one or two figures. Reviews on laptop. Rarely opens working tabs. |
| **Design implications** | → Lands on "Awaiting your decision". → Decision Package in reading mode (Source Serif 4) with a sticky approval panel. → "What this authorizes / does not authorize" boxes. → Two-click path from any figure in the package to its ledger drawer. → "Changes since you last viewed" diff. |

### 4.2 Strategy / MI lead (Maya Rao). Daily operator and case owner.

| Dimension | Profile |
|---|---|
| How they plan today | [S] Analysts blend secondary research and spreadsheets (PRD §4). [S] Market data vendors mix top-down and bottom-up methods and publish definitions per market ([Statista methodology](https://www.ipleiria.pt/sdoc/wp-content/uploads/sites/10/2023/09/Market-Insights.pdf)). [H] Maya rebuilds TAM per deck, copies numbers into slides, and loses track of which version finance saw. |
| Decision triggers | [H] A mandate with clear boundaries. An opportunity that clears fit criteria with evidence. A reviewer challenge that needs an answer. |
| Trusts sizing when | [H] Every input links to a source or a named assumption. Units and years match. Dedup is explicit. The calculation is reproducible. |
| Distrusts when | [H] AI-generated market sizes with no boundary. Different vendors' numbers with different definitions. Silent recalculation after an edit. |
| Attention and time | [H] Long, deep work sessions on sizing and economics. Bursty requests from reviewers. Needs keyboard speed and stable layouts. |
| **Design implications** | → Lands on Overview (operator mode) with "Your cases" and "Reviews waiting on you". → Sizing workbench as an editable ledger with lineage. → Version compare. → "Request review" with section anchors. → Run status in an analysis strip, never in the header. |

### 4.3 CMO / regional commercial lead (Jonas Klein). Pilot owner.

| Dimension | Profile |
|---|---|
| How they work today | [H] Runs GTM plans in slides and task tools. Owns channel and positioning. Reports pilot progress in monthly reviews. |
| Decision triggers | [H] An approved pilot with budget, timeline, accounts, and success thresholds agreed up front. |
| Trusts when | [H] Thresholds were agreed before the pilot. Measurement windows are clear. Their field reality (deployment effort) is recorded, not overwritten. |
| Distrusts when | [H] Targets that move after the pilot. Being judged on revenue when the pilot tests learning. Duplicate tasks in their task tool. |
| Attention and time | [H] Task-driven. Weekly pulses. Arrives from notifications. |
| **Design implications** | → Lands on My Work › Pilot. → Pilot screen pins the approved baseline and thresholds. → Actuals entry shows period and source. → "Request scope change" is a first-class action, not an email. |

### 4.4 CRO / sales leader. Commercial reviewer.

| Dimension | Profile |
|---|---|
| How they work today | [H] Validates demand claims against CRM and team knowledge. Protects sales capacity. |
| Decision triggers | [H] Named accounts or site lists they recognise. Clear asks on capacity (people × weeks). |
| Trusts when | [H] Reachable pool matches their territory view. Restricted accounts are summarized, not leaked. |
| Distrusts when | [H] "500 reachable sites" without a list or channel definition. Pipeline mixed with revenue. |
| Attention and time | [H] Low tolerance for new tools. Short sessions from a review request. |
| **Design implications** | → Review request opens a focused review panel: the claims to confirm, the evidence, and Confirm / Dispute / Abstain with a reason. → No need to open the full case. |

### 4.5 Product / innovation lead (Priya Shah). Feasibility reviewer.

| Dimension | Profile |
|---|---|
| How they work today | [H] Product-fit memos, demo notes, engineering estimates in tickets. |
| Decision triggers | [H] A clear target workflow and list of required adaptations. |
| Trusts when | [H] Fit evidence comes from demos and trials, not desk research. Adaptation cost flows into economics. |
| Distrusts when | [H] "Fits" asserted by AI. Readiness turned green without their sign-off. |
| **Design implications** | → Feasibility row with "Signed by Priya Shah · v2 · 12 Oct" or "Pending — Priya Shah". → "Add adaptation cost" links straight to an economics input. |

### 4.6 Finance partner (Daniel Weber). Economics reviewer.

| Dimension | Profile |
|---|---|
| How they work today | [S] Expected to challenge assumptions and break questions into drivers ([Gartner](https://www.gartner.com/en/finance/insights/business-partnering)). [S] Often brought in after assumptions are set ([Board FP&A guide](https://board.com/wp-content/uploads/2025/01/board_fpa-assessment_mini-guide_business-partneringcollaboration.pdf)). [H] Rebuilds the model in their own spreadsheet to check it. |
| Decision triggers | [H] Inputs they can trace. Clear exclusions (tax, working capital, ramp). Separation of one-time and recurring. |
| Trusts when | [H] Formulas are visible and reproducible. Currency and base year are stated. Margin definition matches finance's (what is in COGS). |
| Distrusts when | [H] "Profit" used loosely. A cash-flow or payback figure without ramp and timing inputs. Contribution and investment summed. |
| Attention and time | [H] Careful, long sessions near gate deadlines. Wants export to Excel. |
| **Design implications** | → Economics screen as a driver table with formulas in words. → "Exclusions" box always visible. → Export with formulas and lineage. → Finance sign-off lists items checked ("Margin definition · Opex scope · Currency EUR 2026") and items not checked. |

### 4.7 Legal / regulatory specialist (Lena Hoffmann). Expert reviewer.

| Dimension | Profile |
|---|---|
| How they work today | [H] Written opinions and email. Scope-limited sign-offs ("for a bounded pilot only"). |
| Decision triggers | [H] A precise question with scope. Enough time. |
| Trusts when | [H] Their sign-off is scoped exactly as written. The product never paraphrases it into "approved". |
| Distrusts when | [H] AI summaries of legal positions. A pilot sign-off reused as a scale sign-off. |
| **Design implications** | → Specialist review records scope ("Pilot: up to 4 sites, 90 days"). → A G3 check reads that scope and shows "Pilot review does not cover scale". → AI may draft the question, never the answer. Show "AI cannot provide this review" where relevant. |

### 4.8 Tenant administrator

| Dimension | Profile |
|---|---|
| How they work today | [H] Configures SSO, roles, and integrations. Long, careful, rare sessions. |
| Trusts when | [H] Health rows show status, scope, last success, and a Test action (CR §8, Screen 12). |
| **Design implications** | → Reuse CR admin patterns. → Add a delegated-authority matrix (gate × BU × amount ceiling). → State "Admins configure approvers but cannot approve" (PRD §7 S14). |

---

## 5. Analogous product teardown

Evidence comes from public docs, help centers, and reviews. I had no hands-on access. [H] items need checking against current versions.

### 5.1 Strategy, portfolio, and stage-gate tools

| Product | What works | Borrow | Avoid |
|---|---|---|---|
| **Planview (gated work)** | [S] Gate symbols with dates, status, scoring, and financials by gate, driven by a governance lifecycle ([Planview](https://success.planview.com/Planview_Portfolios/Analytics_and_Reporting/FastTrack_Analytics_and_Dashboards/FastTrack_Dashboards/RPM_Dashboard_WRK101_-_Gated_Project_Detail)). [S] Users report gates configured as phases because docs are thin ([Planview community](https://community.planview.com/ask-the-community-67/stage-gates-536)). | → Gate glyph row with dates under each gate. → Gate status separate from stage. | [H] Scorecards that sum 1–10 ratings into one "gate score". It looks objective when inputs are subjective. |
| **Cascade** | [S] Objectives linked to initiatives that roll up to strategic themes ([Cascade OKRs](https://cascade.app/solutions/okr-software)). | → Show which mandate and growth objective a case serves, in the header. | [S] A reviewer notes it can feel heavy for small teams ([Tability comparison](https://www.tability.io/compare/platform/cascade)). → Keep strategy linkage to one line. |
| **Productboard** | [S] Drivers scored 0–5 and combined into a weighted score ([Productboard](https://www.productboard.com/prioritize-features)). | → S04 optional weighted ranking with visible weights. | [H] A score with missing inputs treated as zero. PRD ME-04 forbids this. Show "Not ranked — 2 inputs missing". |
| **Aha!** | [S] Scorecard equation is visible and editable, with a preview box. Changing the scorecard erases old scores ([Aha! scorecards](https://www.aha.io/support/roadmaps/strategic-roadmaps/customizations/create-aha-scorecards/content-only)). | → Show the ranking formula as text above the table. Preview a weight change before applying. | → Never erase history when weights change. Version the weights. |

### 5.2 Market sizing and intelligence tools

| Product | What works | Borrow | Avoid |
|---|---|---|---|
| **AlphaSense** | [S] Generative answers cite the exact snippet. A grid runs prompts across documents with a citation per cell ([AlphaSense](https://www.alpha-sense.com/solutions/market-intelligence-platform/)). Vendor page. | → Evidence chip per claim and per input. → S04 comparison cells each carry a chip. | [H] Research-first IA. ME is a decision workspace, not a search tool. |
| **Statista Market Insights** | [S] Publishes a methodology: combined top-down and bottom-up, per-market definitions of what revenue includes and excludes ([Statista methodology PDF](https://www.ipleiria.pt/sdoc/wp-content/uploads/sites/10/2023/09/Market-Insights.pdf)). | → A "Market boundary" card on every sizing: product boundary, unit, geography, year, currency, includes/excludes. | [H] Treating a vendor market size as TAM without matching its boundary to the mandate. Show "Boundary mismatch" when they differ. |
| **CB Insights** | [S] Market maps built from tagged company collections, sortable by funding and scores ([CB Insights](https://www.cbinsights.com/research/team-blog/market-map-maker-autobuild-is-here)). | → Competitor landscape inside Feasibility as a list with sources. | [H] Proprietary scores without method. Never show an unexplained score. |

### 5.3 Modelling and calculation UX

| Product | What works | Borrow | Avoid |
|---|---|---|---|
| **Excel / Sheets** | [S] Trace precedents and dependents with arrows, level by level ([Microsoft](https://support.microsoft.com/office/display-the-relationships-between-formulas-and-cells-a59bef2b-3701-46bf-8ff1-d3518771d507)). | → "Inputs" and "Used by" in the lineage drawer. One level at a time with "Show next level". | [H] Cell references (B7) as the only explanation. Use named inputs ("Adoption rate"). |
| **Causal** | [S] Inputs can be ranges, with simulation showing a spread of outputs ([Causal Scenarios listing](https://workspace.google.com/marketplace/app/causal_scenarios/383280853562)). [H] Named variables with plain-language formulas. | → Named-variable formulas: `SOM revenue = Reachable sites × Adoption × Annual price`. | → No Monte Carlo or probability bands in MVP. PRD says scenarios imply no probability. |
| **Pigment** | [S] Separates quick Scenarios (optimistic/realistic/pessimistic) from governed Versions used for budgets and actuals ([Pigment KB](https://kb.pigment.com/docs/versions-scenarios)). | → Same split: **Scenario** (Downside/Base/Upside) vs **Version** (v3, approved snapshot). Never mix the two words. | [S] Pigment cannot calculate across scenarios. → Do not offer a "scenario average". |
| **Observable** | [S] Reactive cells re-run when their inputs change, like a spreadsheet ([Future of Coding review](https://futureofcoding.org/catalog/observable.html)). | → When an assumption changes, mark dependents "Recalculated" with a brief highlight and a change list. | [H] Silent reactivity on approved snapshots. Approved versions never recalc. Edits create a draft. |

### 5.4 Experiment tracking

| Product | What works | Borrow | Avoid |
|---|---|---|---|
| **Strategyzer Test Card / Learning Card** | [S] Test card: belief, test, metric, success criterion. Learning card: observation, learning, decision ([Test Card](https://www.strategyzer.com/library/validate-your-ideas-with-the-test-card); [Learning Card](https://www.strategyzer.com/blog/posts/2015/3/9/capture-customer-insights-and-actions-with-the-learning-card)). | → Experiment card has a top half (plan, locked at approval) and a bottom half (result, interpretation, decision). | [H] Cards without owner, budget, or sample method. ME-09 needs these. |
| **Strategyzer assumptions mapping** | [S] 2×2 of importance × evidence. Test first what is important and has no evidence ([Strategyzer](https://www.strategyzer.com/library/how-assumptions-mapping-can-focus-your-teams-on-running-experiments-that-matter)). | → Assumption register sort and an optional 2×2 view. | [H] A 2×2 as the only view. It does not scale past ~15 items. Table first. |
| **Eppo** | [S] Decision pre-registration and protocols with guardrails and recommendations. Users record the final decision with a button and can ignore recommendations ([Eppo blog](https://geteppo.com/blog/make-decisions-before-experimenting); [Eppo protocols](https://docs.geteppo.com/experiment-analysis/configuration/protocols/)). | → Pre-registered decision table: "If ≥ 4 commitments → proceed to G2 request. If 2–3 → revise. If < 2 → stop or redesign." | → The product recommends. The human decides and records why. |
| **Statsig** | [S] Hypothesis and at least one primary metric are required before creation. Warns against reading early data ([Statsig docs](https://docs.statsig.com/experiments/create-new)). | → Required fields before approval: hypothesis, metric, threshold, sample, window. → "Too early to read" state before the window closes. | [H] Statistical language (p-values) for 20-site samples. Use counts and thresholds. |

### 5.5 Approvals and spend

| Product | What works | Borrow | Avoid |
|---|---|---|---|
| **GitHub PR review** | [S] Stale approvals can be dismissed on change (CR research §4.2). | → Approval binds to a snapshot fingerprint. Material change invalidates. | → Do not invalidate on comments or formatting (CR §4.2). |
| **Ramp** | [S] Conditional approval chains and separation of duties (CR research §4.2). | → Chain list with routing reason ("Above €100k requires BU VP"). | — |
| **Brex** | [S] Budgets with owners and spend limits with policies. Over-limit spend can route for approval ([Brex support](https://brex.com/support/how-do-i-update-a-budget)). | → Pilot budget shows Approved · Committed · Spent · Remaining. Over-cap spend requires a scope-change request. | [H] Budget increases that bypass the gate. A cap increase is a new authorization. |
| **Carta board consents** | [S] Select required signers, track who has approved, store the signed consent ([Carta](https://carta.com/product-updates/how-carta-does-board-consents/)). | → G3 investment-committee view: required approvers, who signed, who abstained, stored record. | [H] Mobile one-tap approval for large commitments. Keep G2/G3 on a full review surface. |

**Gap none of them fill [H]:** No product here links market sizing lineage, assumption tests, and gate authority to one versioned snapshot. → Make the link from a figure to its assumptions to its experiment to the gate the most polished interaction.

---

## 6. Domain patterns

### 6.1 TAM / SAM / reachable / SOM: the measure ladder

**Findings.** [S] Vendors define market revenue per market with explicit inclusions and exclusions ([Statista](https://www.ipleiria.pt/sdoc/wp-content/uploads/sites/10/2023/09/Market-Insights.pdf)). [S] The PRD says TAM is not capture, the reachable pool is not SOM, and SOM is a scenario, not a forecast (§6). [H] Nested circles invite reading area as share. Stacked bars invite adding.

**Pattern.**
- A vertical **ladder of four rows**. Each row has: measure name · definition (one line) · population (sites) · money (with "/year") · kind tag · lineage link.

| Row | Population | Money | Meaning line (exact copy) | Kind |
|---|---|---|---|---|
| TAM | 5,000 unique sites | €100m/year | Annual spend in the defined market. No claim of capture. | Evidence + Assumption (price) |
| SAM | 2,000 unique sites | €40m/year | Sites we could serve after eligibility and product-fit filters. | Evidence + Assumption |
| Reachable pool | 500 unique sites | — (not a money measure) | Sites inside current channel and service coverage. Not SOM. | Assumption (channel reach) |
| SOM · Base · Year 3 | 100 customers | €2.0m annual revenue at end of year 3 | Scenario for a stated horizon. Not a forecast. | Scenario |

- Connect rows with a **narrowing connector** that shows the filter applied ("× eligibility filters", "× channel coverage", "× 20% adoption (Assumption)").
- Header strip for the whole ladder: "Market unit: annual spend on water-monitoring solution · Germany · food processing · EUR · 2026".
- A small bar per row may show *site count* on a log-free linear scale. Do not show money bars across rows. The money column is text.

**→ Design implications.** No total row. No "opportunity" figure. Every money cell carries "/year" or "annual revenue at end of year 3". The reachable row shows "—" with tooltip "Reachable pool is a site count, not a market value."

### 6.2 Unique-site cohorts and overlap

**Pattern.** A cohort table in the Sizing workbench:

| Cohort | Rule | Sites | Source |
|---|---|---|---|
| Size-qualified | ≥ threshold employees or volume | 1,400 | [chip] |
| Process-qualified | Uses target water process | 1,100 | [chip] |
| Overlap removed (in both) | Same site ID in both cohorts | −500 | Dedup run v2 |
| **Unique eligible sites (SAM)** | | **2,000** | Calculated |

- Show the dedup rule in words: "Unique by site ID. Sites of one parent company stay separate when they buy separately."
- An optional two-circle diagram sits right of the table, labelled with counts, not areas to scale. [H]
- **Blocking checks** (inline error, submission disabled, reason given): overlap < 0; overlap > smaller cohort; SAM > TAM; units differ (sites vs companies); years differ.
- **Duplicate cohort** state: "Process-qualified (v1) and Process-qualified (imported) share 1,080 site IDs. Merge or keep one before calculating." Actions: [Compare] [Keep v1] [Keep imported].

**→ Design implication.** The arithmetic is the explanation. Show signed rows and a bold result, like an invoice.

### 6.3 Formula and input-lineage ledger

**Pattern.** A ledger table for each model (Sizing, Economics):

Columns: Input name · Value + unit · Kind (Evidence / Assumption / Calculated) · Basis (source chip or assumption owner) · Evidence quality · Version · Last changed · Used by (count).

- **Formula row** above the outputs, written with named inputs: `SAM = (Size-qualified + Process-qualified − Overlap) × Annual spend per site` → `(1,400 + 1,100 − 500) × €20,000 = €40m/year`.
- **Lineage drawer** (opens from any figure): Formula · Inputs (one level, with "Show next level") · Used by · History (who changed what, when, which version) · "Recalculate in draft" if the user has edit rights.
- **Deterministic badge:** "Calculated by sizing engine v1.2 · reproducible" (business copy, no infrastructure terms).
- Changed inputs highlight in the draft. Approved snapshots stay frozen with a lock glyph.

**→ Design implication.** The ledger is the primary surface. Charts are secondary and always have a table view.

### 6.4 Top-down vs bottom-up cross-check

**Findings.** [S] Outside-view checks reduce optimism ([PMI](https://www.pmi.org/learning/library/planning-fallacy-causes-solutions-project-expectations-6374)). [S] PRD: cross-check, never average.

**Pattern.** A two-row comparison under the ladder:

| Method | Value | Basis |
|---|---|---|
| Bottom-up (model) | €40m/year SAM | Cohorts × price |
| Top-down (cross-check) | e.g. €35–50m/year | Vendor segment estimate × share in scope [chip] |
| Result | "Within range" / "Outside range by x" | No average shown |

- Draw the top-down estimate as a **range bar** (hatched, neutral) and the bottom-up as a **single marker** (petrol). They share an axis.
- If outside range: amber note "Bottom-up is outside the top-down range. Explain the gap before G1." with [Add explanation].
- Never show a "blended" or "midpoint" value. [H] The top-down range in the prototype is a placeholder. The PRD gives no top-down figure. Mark it "Illustrative".

**→ Design implication.** The cross-check is a test with a pass/explain outcome, not a third estimate.

### 6.5 Downside / base / upside scenarios

**Findings.** [S] Pigment and similar tools treat scenarios as named alternatives, not probabilities ([Pigment](https://kb.pigment.com/docs/versions-scenarios)). [S] PRD: scenarios name changed variables and imply no probabilities.

**Pattern.** A scenario table, columns in fixed order Downside · Base · Upside:

| | Downside | Base | Upside |
|---|---|---|---|
| Customers (end of year 3) | 50 | 100 | 120 · capped by capacity |
| Annual revenue | €1.0m | €2.0m | €2.4m |
| Gross contribution (60% margin) | €0.60m | €1.20m | €1.44m |
| Annual incremental opex | €600k | €600k | €600k |
| Contribution after opex | €0k (break-even) | €600k | €840k |
| What changes vs base | Adoption 10% (50 of 500 sites) | — | 120 customers: capacity cap reached (unconstrained adoption would be higher) |

- A **"What changes"** row is required. It names the changed variables.
- One-time scale-entry investment €400k sits **outside** this table, in its own card.
- Copy rule: never "likely", "expected", "most probable", or percentages next to scenario names. Base means "reference assumptions", not "expected".
- Visuals: equal column widths. No bolding of Base beyond the column header. No green/red. Use the petrol ordinal ramp with marker shapes ▼ ● ▲ (§10.4).

**→ Design implication.** The three columns look equally weighted. Base is the reference, not the prediction.

> Note on "€0k": the downside after opex is a true calculated zero. That is different from missing data. Display "€0k (break-even)" so nobody reads it as "no data". [H]
>
> Format rule for this table: one format per row, and never more precision than the PRD fixture. Revenue in €m with one decimal; gross contribution in €m with two decimals (the PRD fixes €1.44m); opex and contribution after opex in €k (the PRD fixes €600k and €840k). Exact values live in the ledger.

### 6.6 Recurring contribution vs one-time investment

**Pattern.** Two cards with a visible gap and a labelled divider ("Different time bases. Do not add.").
- Card A: **Recurring · per year · steady state** — Revenue €2.0m/year · Gross contribution €1.2m/year · Contribution after opex €600k/year.
- Card B: **One-time** — Scale-entry investment €400k (one-time).
- Card C (disabled): **Cash flow and payback** — "Not available. Needs ramp, retention, cash timing and FX inputs." [See required inputs].
- Exclusions box (always visible): "Before taxes, working capital, ramp timing and financing. Constant price and margin."

**→ Design implication.** Payback appears only as a disabled card with its missing inputs listed. This tells finance the gap is known.

### 6.7 Capacity caps

**Pattern.** Capacity is an input row (Assumption, owner Operations) and a **cap line** on the scenario chart ("Capacity: 120 customers"). Any scenario that hits it shows "Capped at 120" with a lock-bar glyph. A tooltip explains: "Upside adoption would exceed installation and support capacity. Raising capacity is a scale decision (G3)."

**→ Design implication.** Caps explain why upside is not higher. They tie to a decision, not a bug.

### 6.8 Avoiding false precision

**Rules.**
1. Display values with the precision the weakest input supports. [H] Default: 2 significant figures when any input is an Assumption. Exact values live in the ledger.
2. Use one format per row or column in a comparison set so values align: €1.0m · €2.0m · €2.4m. Never add precision beyond the fixture (PRD §6 fixes €1.44m and €840k; show them as given). Use €100m and €40m for market sizes (no decimal) because their inputs are rounded counts.
3. Never show percentages with decimals for assumptions ("20%", not "20.0%").
4. Show ranges with an en dash and the unit once: "€35–50m/year".
5. Do not show computed confidence scores. "20% adoption" is an assumption, not an AI confidence (PRD §6).

**Finding.** [S] Precise numbers anchor more strongly ([Janiszewski & Uy](https://pubmed.ncbi.nlm.nih.gov/18271859/)). → Rounding protects approvers from over-anchoring.

### 6.9 Assumption register: sensitivity × evidence quality

**Pattern.** Table, sorted by a two-key priority (not a multiplied score):
- **Decision sensitivity:** High / Medium / Low. Definition: "If false, would the G2 or G3 decision change?" (CR-style one-line definitions in tooltips).
- **Evidence quality:** Strong / Some / Weak / None. Uses the shield family from CR (§6.1) mapped: Strong = Verified, Some = Partial, Weak = Unverified, Conflicting kept as is.
- Default sort: High sensitivity + Weak/None evidence first ("Test first"). Show the group label as a row header, not a score.
- Columns: Assumption (value + unit) · Owner · Sensitivity · Evidence · Validation method · Linked experiment · Due · Status · Consequence if false.
- Status values: Untested · Testing · Supported · Contradicted · Inconclusive · Retired (with reason).
- Optional 2×2 view (Strategyzer style), with the same items, as a secondary tab.
- **Disputed** flag: when a reviewer disputes an assumption, show a speech-bubble glyph and "Disputed by Daniel Weber". It stays until resolved with a reason.

Aster seed rows (PRD §6): €20k annual price · product fits workflow · channel reaches 500 sites · specialist requirements can be met · 120-customer capacity · 20% adoption (disputed — this is the prototype's "disputed adoption assumption").

**→ Design implication.** The register answers "what should we test next?" without a fake score.

### 6.10 Experiment cards with pre-registered thresholds

**Pattern.** Card in two halves.
- **Plan (locks on G1 approval):** Linked assumption · Hypothesis ("We believe that…") · Method · Sample and selection (20 sites via approved channel) · Nonresponse note · Metric · Threshold (8 interviews; 4 paid commitments) · Decision rule table · Window · Budget (part of €15k) · Owner.
- **Result:** Observed (9 interviews; 4 paid commitments) · Threshold outcome per metric: **Met / Not met / Inconclusive** · Interpretation · Limitations ("Interviews do not validate conversion") · Decision taken.
- **Amendments:** Any change after lock creates "Amendment 1" with reason, author, date. The original threshold shows struck through with the label "Original (pre-registered)". Nothing is deleted.
- Result glyphs: target with check (Met), target with dash (Not met), target with question mark (Inconclusive). Text always present.

**→ Design implication.** A failed threshold never disappears. History is visible from the card, not only in the History tab.

### 6.11 Stage-gate rail G0–G3

**Pattern.** A horizontal rail under the case header: stage segments with gate diamonds between them.

`Mandate ◆G0 Discovery · Assessment ◆G1 Validation ◆G2 Pilot · Review ◆G3 Scale`

- Diamond states (§7.2): outline (not reached), half-filled (submitted), filled + check (approved), filled + check + dot (approved with conditions), arrow-return (returned), bar (blocked), crossed outline in neutral (not approved / stopped), red ring (invalidated or expired).
- Under each diamond: gate scope and date ("G2 · Pilot €120k · 90 days · 14 Nov").
- The current stage pill uses PRD labels ("Pilot running").
- Off-path states (On hold, Stopped) appear as a flag on the current segment.
- Each gate button names its scope: "Approve validation €15k", "Approve pilot €120k · 90 days", "Approve extension €[cap]", "Authorize scale". Reject reads "Not approved", Return reads "Return for revision".

**→ Design implication.** Users see that G2 approval does not move the case past G3.

### 6.12 Dissent and conditions in decision packages

**Pattern.**
- **Reviewer positions** table: Reviewer · Role · Position (Supports / Supports with conditions / Dissents / Abstains / Not yet reviewed) · Scope of review · Signed version.
- **Dissent** section always rendered. Empty state: "No dissent recorded." Dissent shows the reviewer's own words, signed and dated.
- **Conditions** list: each condition has an owner, due date, and a flag: "Blocks execution until met" or "Monitor only". Execution actions show "Blocked by condition C2" until met.

**→ Design implication.** Approvers see disagreement before they decide. Conditions are actionable objects, not prose.

### 6.13 Stale snapshots

**Pattern.**
- Snapshot banner on the package: "Snapshot v3 · created 10 Nov · fingerprint 7F3A·19C2".
- **Stale** when: an input in the snapshot changed, a source was superseded, a connector expired, or the approval expiry passed.
- Stale state: amber banner "This snapshot is out of date: adoption assumption changed on 12 Nov. Approval is disabled." Actions: [See what changed] [Refresh snapshot (creates v4)].
- **Invalidated approval** (material change after approval): red ring on the gate diamond. "Approval for v3 no longer applies: spend ceiling changed. Pilot tasks paused."

**→ Design implication.** You can never approve something different from what you read.

### 6.14 Negative outcomes as first-class results

**Findings.** [S] Healthy stage-gate kills projects; weak gates rubber-stamp ([netguru](https://www.netguru.com/blog/stage-gate-process-guide)). [S] PRD counts a well-supported no-go as success (§3, §12).

**Pattern.**
- Outcome screen leads with **"Decision recorded: Revise and extend validation"**, with neutral styling and a document glyph, followed by "What we learned" (three bullets) and "What changes next".
- Threshold results shown honestly: "3 of 4 pilot customers met the paid-use threshold (target 4 of 4)" with the Not-met glyph.
- **Scale gate blocked**: amber bar diamond, "Blocked — 2 preconditions unmet: demand threshold, specialist scale-readiness review."
- Copy avoids "failed", "lost", "rejected". Use "Not met", "Not approved", "Stopped by decision".
- Activity timeline pins the decision as a key event.

**→ Design implication.** The product rewards learning. A stopped or extended case looks complete and respected.

---

## 7. Non-ambiguity rules

### 7.1 Epistemic kind: what kind of claim or number is this?

| Kind | Meaning | Label | Glyph (Lucide) | Line style | Token |
|---|---|---|---|---|---|
| Evidence | Sourced fact from a permitted source | `Evidence` + source chip | `file-text` | Solid 1 px border | `kind.evidence` |
| Assumption | Human-owned belief used as input | `Assumption · owner` | `pencil-ruler` | Dashed 1 px border | `kind.assumption` |
| Scenario | Output computed under named assumptions for a horizon | `Scenario · Base · Year 3` | `git-branch` | Dotted 1 px border | `kind.scenario` |
| Actual | Measured observation with period and source | `Actual · 1 Sep–30 Nov` | `flag` | Solid 2 px left rule | `kind.actual` |
| Inference · AI | Model-drafted interpretation, not yet accepted | `AI draft` (CR §5.11) | `sparkles` | Dashed left rule | `ai` |
| Unknown | Required but not available | `Unknown` | `circle-dashed` | Dashed gray | `neutral` |

Rules:
1. Every displayed number has a kind, either on the value or in the column header.
2. AI provenance is a separate badge. An AI-proposed assumption shows `Assumption` *and* `AI draft` until a human accepts it.
3. "Calculated" values inherit the weakest kind of their inputs for display. A SAM built on an assumed price shows "Calculated · depends on 1 assumption".
4. Never use "forecast", "expected", or "projected" for scenario outputs.

### 7.2 Status dimensions (extended from CR §6.1)

| Dimension | Answers | Values (exact labels) | Grammar | Position |
|---|---|---|---|---|
| **Case stage** | Where is the case in the business process? | Draft mandate · Discovery · Assessment · Validation · Pilot approval pending · Pilot approved · Pilot running · Review due · Scale approval pending · Scaling · Closed · flags: On hold · Stopped | Rail + filled pill, neutral or accent. On hold = amber pause flag. Stopped = neutral stop flag | Case header, table column |
| **Gate status** | What is the state of this gate decision? | Not started · Preconditions open (2 of 5 met) · Ready to submit · Awaiting decision · Approved · Approved with conditions · Returned for revision · Not approved · Blocked · Invalidated · Expired · Superseded | **Diamond** glyph family + text | Gate rail, Decisions tab, approval panel |
| **Decision outcome** | What did the decision-maker decide at review? | Proceed · Revise · Extend · Stop · Scale | Document glyph + text, neutral | Outcome card, timeline |
| **Experiment result** | Did the pre-registered threshold hold? | Planned · Running · Too early to read · Met · Not met · Inconclusive · Amended | **Target** glyph family | Experiment card, register |
| **Assumption status** | Where is this belief? | Untested · Testing · Supported · Contradicted · Inconclusive · Retired | Ruler-pencil + status dot + text | Register |
| **Opportunity status** | Candidate lifecycle | Detected · Shortlisted · Converted · Dismissed · Duplicate | Outlined tag | S03, S04 only |
| **Run status** | Is the analysis still working? | Business copy: Queued · Working: checking sources… · Needs your input · Partial results · Done (timestamp) · Stopped — your work is saved | Circular progress glyph in analysis strip | Analysis strip only |
| **External sync** | Did the task reach the external tool? | Not sent · In preview · Sending… · Confirmed · KEY · Failed · Retry · Checking · Paused — approval changed | Link glyph + destination key | Task table column |
| **Connector status** | Is the source/tool connection healthy? | Connected · Expired · Missing permission · Unavailable | Plug glyph family | Admin, evidence banners |
| **Evidence freshness** | How recent is the evidence? | Current · Ageing (x days) · Stale · Superseded | Clock glyph + text | Header, evidence rows |

Rules (carried from CR §6.1, plus additions):
1. Each dimension has a fixed position. Gate status lives on the rail and in Decisions. It never replaces the stage pill.
2. One hue never carries two meanings in the same row.
3. Labels always render. Icon-only status only in dense tables with header and accessible name.
4. Reserved words: "Approved" only for gates. "Met" only for thresholds. "Supported" only for assumptions. "Confirmed" only for external sync. "Verified" only for evidence strength. "Done" only for tasks.
5. Status changes use polite live regions (WCAG 4.1.3).

### 7.3 Money measures

| Measure | Exact label | Unit suffix | Example | Rules |
|---|---|---|---|---|
| Annual market spend | **Annual market spend** (TAM / SAM) | `/year` | €100m/year | Market measure. Never compared to company revenue in one chart. |
| Annual revenue | **Annual revenue · Scenario · end of year 3** | `annual revenue` | €2.0m annual revenue | Scenario. Always names scenario and horizon. |
| Gross contribution | **Gross contribution · 60% margin** | `/year` | €1.2m/year | Shows margin assumption. |
| Contribution after opex | **Contribution after incremental opex** | `/year` | €600k/year | Lists what opex includes. Never "profit". |
| One-time investment | **One-time scale-entry investment** | `one-time` | €400k one-time | Separate card. Never summed with /year values. |
| Approved budget | **Approved budget · G2 · v3** | — | €120k | Ties to a gate and version. |
| Committed / Spent / Remaining | **Spent to date · as of 30 Nov** | — | €84k of €120k | Spent never exceeds approved without a scope-change request. |

Rules: Currency and base year appear once per view header ("EUR · 2026 prices") and on every export. Mixed currencies block calculation until normalized. Missing money shows "Not available — [reason]", never €0.

### 7.4 Label vocabulary

| Use | Don't use | Why |
|---|---|---|
| Approve validation €15k · Approve pilot €120k · 90 days · Authorize scale | Approve, OK, Sign off, Go | Gate scope is explicit (PRD S10) |
| Return for revision · Not approved · On hold | Reject (alone), Kill, Fail | Neutral, process-aligned verbs |
| Stop case (decision) | Cancel, Delete, Kill | A stop is a recorded decision |
| Revise and extend · Extension €[cap] | Retry, Redo | Extension is a scoped authorization |
| Annual market spend (TAM) | Market opportunity, Revenue potential | Not capture |
| Reachable pool (sites) | Addressable customers, Pipeline | Operational subset, not SOM |
| SOM · Scenario · Year 3 | Forecast, Expected revenue, Target | A scenario, not a forecast |
| Downside · Base · Upside | Worst/best case, Likely, Pessimistic | No probability |
| Contribution after incremental opex | Profit, EBIT, Margin (alone) | Precise scope |
| One-time investment | Cost (alone), CapEx (unless finance confirms) | Separates time bases |
| Assumption · Evidence · Scenario · Actual | Data, Insight, Fact (for model inputs) | Epistemic kinds |
| Met · Not met · Inconclusive | Pass/Fail, Success/Failure | Neutral result language |
| Supported · Contradicted | Validated, Proven, True | Evidence never proves |
| Overlap removed | Duplicates deleted | Sites remain in data |
| Confirmed in [tool] · KEY | Synced | Honest sync (CR §6.5) |
| Snapshot v3 · Version | Scenario (for versions) | Pigment-style split |
| Dissent · Condition | Objection, Caveat | Formal decision objects |
| Illustrative data | Demo, Fake, Sample (alone) | CR §6.5 |

### 7.5 Color, icon, and text semantics (WCAG 2.2 AA)

| Meaning family | Hue token | Icons | Applies to |
|---|---|---|---|
| Positive / confirmed | success | check-circle, diamond-check, link-check | Approved, Met, Supported, Confirmed, Done |
| Caution / blocking / incomplete | warning | alert-triangle, diamond-bar, pause, clock | Blocked, Returned, Preconditions open, Stale, On hold, Expired connector |
| Problem / failure / invalidation | danger | x-circle, diamond-ring | Failed sync, Invalidated, Contradicted, Conflicting |
| In progress / informational | info | circle-progress, diamond-half | Awaiting decision, Running, Sending… |
| Neutral / decisions without valence | neutral | circle-dashed, square-stop, file-text | Not started, Not approved, Stopped, Not met (*), Closed |
| AI provenance | ai | sparkles | AI draft |
| Restricted | restricted | lock | Restricted values |
| Epistemic kinds | kind.* | see §7.1 | Evidence, Assumption, Scenario, Actual |

(*) "Not met" uses neutral text with the target-dash glyph. It is a learning result, not a fault. Use danger only for "Contradicted" when the evidence directly refutes a decision-critical assumption. [H] Test in §11.

Rules: All semantic text/background pairs meet ≥ 4.5:1 (computed below). Graphical marks meet ≥ 3:1 against the surface (WCAG 1.4.11). Never color alone (WCAG 1.4.1). Charts have tabular equivalents ([S] [W3C complex images tutorial](https://www.w3.org/WAI/tutorials/images/complex/)).

---

## 8. Information architecture and navigation

### 8.1 Validation of PRD §7

The PRD IA is sound. I recommend seven refinements.

1. **Global nav:** keep **Overview · Opportunities · Expansion Cases · My Work · Evidence · Reviews · Administration**. Rename the nav item "Expansion Cases" to **"Cases"** to scan faster; keep "Expansion case" in page titles (same reasoning as CR §7.1). [H]
2. **Merge "Reviews" into "My Work" as a tab, or keep it separate?** Keep it separate. In ME, reviews are a distinct job for six reviewer roles (finance, product, legal, sales, sponsor, committee), and many reviewers have no tasks. My Work holds tasks and experiments. Reviews holds review requests and gate decisions with counts "for you". [H]
3. **Case nav order:** Thesis · Sizing · Feasibility · Economics · Validation · Decisions · Pilot · Outcomes · History. This follows the lifecycle. Keep it. Show blocking counts ("Validation · 1 disputed"). Future-stage tabs stay enabled with teaching empty states (CR §7.4).
4. **Add a "Decision brief" read-only route** for reviewers: `/cases/ME-104/brief?gate=G2&version=3`. It renders the snapshot in reading mode with the approval or review panel. Reviewers never need to open working tabs. Links from figures open lineage drawers in place.
5. **Persistent case header** content (order matters):
   - Line 1: `ME-104` (mono) · **German food-processing plants · Water monitoring** · [Stage pill: Pilot running] · [Mandate: BU Water · Growth 2027]
   - Line 2: Owner Maya Rao · Sponsor Elena Fischer · Evidence: checked 3 days ago · 1 stale · Germany · EUR 2026
   - Right: **Next decision** block: "G3 Scale — Blocked (2 preconditions)" or a primary button ("Review pilot results"), with "Why?" listing preconditions.
   - Below: gate rail (§6.11). Compresses to one line on scroll.
6. **Right context panel** (`]`): Activity · Comments · Lineage. Lineage is new: it shows the selected figure's inputs without leaving the screen.
7. **Hide Administration** for non-admins, do not disable it (CR §7.1).

### 8.2 Role-based landing

| Role | Lands on | First thing visible |
|---|---|---|
| Sponsor (Elena) | Reviews › Awaiting your decision | "Approve pilot €120k · 90 days · ME-104" with due date |
| Operator (Maya) | Overview (operator) | Your cases · Reviews waiting on others · Disputed assumptions · Overdue experiments |
| Pilot owner (Jonas) | My Work › Pilot | Milestones due · Actuals to record · Blockers |
| Finance (Daniel) | Reviews › Economics reviews | Requests with "what to check" lists |
| Product / Legal / Sales reviewers | Reviews › Assigned to you | The focused review panel |
| Executive (portfolio) | Overview (portfolio) | Cases by stage · Decisions pending · Approved vs requested spend · Pilots needing review |
| Admin | Administration › Health | Connector status · Authority coverage gaps |

### 8.3 Growth OS app switcher

- A **switcher at the top of the sidebar**: product mark "Growth OS" + current app name ("Market Expansion"). Click opens a menu: Market Expansion (current) · Competitive Response (available or "Coming soon" when not licensed) · Settings for Growth OS.
- Each app has a small **monochrome glyph** (Market Expansion: compass or map-pin-plus; Competitive Response: shield-half or swords). No per-app color theme. [H]
- **Shared objects** (Evidence, Reviews, People, Admin) keep the same URLs and layout across apps. App-specific objects live under `/me/` and `/cr/`.
- Cross-app handoff (P1, ME-18) shows as a "Linked from CR-1042 · accepted by Maya Rao" chip in the case header. Source approval does not transfer. Say so.
- In the prototype, show Competitive Response as "Not enabled in this workspace" to avoid implying availability. (PRD §10: distinguish implemented from simulated.)

### 8.4 Deep links and search

Reuse CR §7.5–7.6. New patterns:
- `/me/cases/ME-104/sizing?input=adoption-rate&view=lineage`
- `/me/cases/ME-104/validation?experiment=EXP-03&amendment=1`
- `/me/cases/ME-104/decisions?gate=G2&version=3&compare=2`
- ⌘K finds cases, opportunities, assumptions, experiments, sources. Never offers Approve.

---

## 9. Per-screen recommendations (S01–S14)

Format: **Q** user question · **Layout** · **Actions** · **States** · **Pitfalls**.

### S01 — Portfolio / executive overview
- **Q:** "Which cases need a decision, and is money going where we agreed?"
- **Layout:** Attention lists first (CR §8 Screen 1): Decisions awaiting approval · Pilots needing review · Overdue validation · Blocked gates. Then a **spend panel**: approved vs requested vs spent by case (bars, with table toggle). Then a case table: case · market · owner · stage · next gate (diamond + scope) · blockers · evidence freshness · latest update.
- **Actions:** Primary: open case / open decision. Secondary: filter BU, create mandate.
- **States:** Empty ("Create a mandate · Explore the Aster example (Illustrative)"). Restricted (show only authorized cases; no hidden counts; scope label "Showing BU Water"). Data-source failure ("Spend last refreshed 08:10 · finance source unavailable"). Stale approval in a row (red-ring diamond + "Invalidated").
- **Pitfalls:** Summing TAM across cases. A "total opportunity" tile. Ranking cases by TAM. Mixing one-time and recurring in spend bars.

### S02 — Mandate creation and review
- **Q:** "What are we allowed to look for, under which constraints, and who owns it?"
- **Layout:** Two columns. Left: form (objective, product, segments, geographies, exclusions, horizon, investment constraint with currency, sources, owner, sponsor, success definition). Right: live **scope preview** written as a sentence ("Evaluate German food-processing plants for [product] over 3 years, with up to €120k pilot spend, owned by Maya Rao").
- **Actions:** Primary: Submit for G0. Sponsor: "Approve mandate (G0)" / "Return for revision" (comment required).
- **States:** Missing owner or currency blocks submit (inline, plus summary). Incompatible horizons ("Pilot 90 days exceeds mandate horizon"). Suggestions marked "AI draft · not validated". Sponsor without authority sees "Request access" with the authority owner's name.
- **Pitfalls:** Suggestions that look like approved opportunities. Free-text currency.

### S03 — Opportunity discovery
- **Q:** "Which candidate markets fit the mandate, and why?"
- **Layout:** Split view (CR §5.2). List: market · trigger · fit rationale (one line) · evidence coverage (shield + "3 sources") · unknowns count · last checked · status tag. Detail: fit to mandate criteria (checklist), evidence, unknowns, duplicates, actions.
- **Actions:** Shortlist · Dismiss (reason) · Merge duplicate · Add manually · Convert to case (from Shortlisted). Keys: `s` shortlist, `d` dismiss, `m` merge.
- **States:** Partial discovery banner ("1 of 3 sources unavailable. Results are not exhaustive."). Expired connector ("Market data connection expired · ask admin · upload instead"). Duplicate ("Likely duplicate of OPP-12 · German dairy plants"). Empty (explain filters/sources; manual entry).
- **Pitfalls:** "Top 10 markets" language implying exhaustive search. AI candidates looking accepted.

### S04 — Opportunity comparison
- **Q:** "Which of these up to four candidates deserves assessment?"
- **Layout:** Columns = candidates (categorical palette marker per column). Rows: market boundary · TAM and SAM (with year and unit) · growth evidence · product fit · channel access · investment need · readiness blockers · unknowns. Ranking strip above: "Ranking: Fit 40% · Access 30% · Size 30% [Edit weights]".
- **Actions:** Adjust weights (preview first) · Inspect evidence · Select for assessment.
- **States:** **Incomparable boundary** blocks ranking ("Candidate B uses 2024 prices and company counts. Normalize before ranking."). Missing cell shows `Unknown` (dashed circle), never 0. "Not ranked — 2 inputs missing".
- **Pitfalls:** A single composite score in large type. Comparing TAM across different units.

### S05 — Expansion case / thesis
- **Q:** "What do we believe, why could we win, and what would change our mind?"
- **Layout:** Reading column (Geist 14/20 UI; Source Serif for long prose) + right rail. Hero: proposition · intended customer · why now · next decision. Sections: claims (each with kind tag + chip) · reasons to win · alternatives (including **No entry**) · critical assumptions (top 5 from register) · disagreements · blockers · recommendation (marked as recommendation).
- **Actions:** Edit · Request analysis · Assign reviewer · Challenge claim · Submit gate.
- **States:** Analysis strip: "Working: checking sources (2 of 3)" — no fake percentage. Partial ("Competition section incomplete. Your edits are saved."). Claim without evidence shows `Unknown` or `Assumption`, never plain text.
- **Pitfalls:** Wall of AI prose. Recommendation pre-selected as the decision.

### S06 — Sizing workbench
- **Q:** "How big is this market, how do we know, and what did we assume?"
- **Layout:** Header strip (market unit · geography · currency · year · version). Left 60%: measure ladder (§6.1) above the cohort table (§6.2) above the input ledger (§6.3). Right 40%: lineage drawer for the selected figure, then the top-down cross-check (§6.4). Scenario selector for SOM with horizon and capacity line.
- **Actions:** Edit assumption · Inspect population · Attach source · Compare versions · Snapshot.
- **States:** Negative overlap or SAM > TAM (blocking inline error). Duplicate cohort (merge dialog). **Restricted account data**: "Aggregates shown under policy. Site list restricted." or "Unavailable under your access" (no counts leak). Stale source (clock glyph, "Source 2025 edition superseded").
- **Pitfalls:** Nested circles scaled by money. Averages of top-down and bottom-up. Showing €2.0m SOM next to €100m TAM as if comparable progress.

### S07 — Feasibility and ability to win
- **Q:** "Can we deliver and win, and who has signed?"
- **Layout:** Readiness table: dimension (product fit · differentiation · commercial access · operations · specialist review · channel · competition) · evidence · reviewer · status · scope of sign-off · due · blocker.
- **Actions:** Request review · Attach assessment · Record disagreement · Resolve blocker / Restrict scope.
- **States:** Pending review: "Pending — Lena Hoffmann · due 20 Nov" (never a green check). Scoped sign-off: "Signed for pilot only (4 sites, 90 days)". Blocker requires resolution or approved scope restriction.
- **Pitfalls:** A readiness percentage. AI drafting a specialist's conclusion.

### S08 — Economics and scenarios
- **Q:** "Under which assumptions does this pay, and what does it cost to enter?"
- **Layout:** Driver table (price €20k/year · adoption 20% · margin 60% · opex €600k/year · capacity 120 · one-time €400k), each with kind and owner. Scenario table (§6.5). Recurring vs one-time cards (§6.6). Exclusions box. Optional "What must be true?" panel (reverse from a target contribution).
- **Actions:** Request finance review · Revise in draft · Snapshot · Export (with formulas).
- **States:** Missing cost input ("Recommendation incomplete — opex scope missing"). Incompatible currency/year ("Normalize to EUR 2026"). Cash flow card disabled with listed inputs. Upside capped label.
- **Pitfalls:** "Profit". Payback without inputs. Summing €400k with €600k/year. Too many decimals.

### S09 — Assumptions and validation workspace
- **Q:** "Which assumptions could change the decision, and how are we testing them?"
- **Layout:** Split view. Left: register (§6.9), grouped "Test first / Test next / Monitor". Right: experiment card (§6.10) for the selected assumption.
- **Actions:** Approve plan (G1 bundle) · Assign work · Record result (Met / Not met / Inconclusive) · Amend (reason) · Revise thesis.
- **States:** Disputed adoption assumption (speech-bubble glyph, reviewer name, thread). Empty: example experiments with "Illustrative" tag. Too early to read. Amended threshold with original struck through. Partial task sync for validation tasks (§S11 rules).
- **Pitfalls:** Deleting a failed result. Statistical jargon for small samples. Hiding the nonresponse caveat.

### S10 — Decision and approval package
- **Q (approver):** "Exactly what am I authorizing, and is it sound?"
- **Layout:** Reading mode, ~720 px column, Source Serif 4 body. Sections: Ask · Scope · Recommendation · Alternatives (incl. No entry) · Evidence summary · Assumptions and validation results · Economics (from snapshot) · Readiness sign-offs · Budget and stop rules · Conditions · Dissent · Known limitations · Sources. Sticky right panel: version + fingerprint · "Your authority: up to €[limit] · BU Water" (limit is a policy placeholder; the PRD sets none) · **Authorizes** / **Does not authorize** boxes · chain · actions.
- **Actions:** "Approve pilot €120k · 90 days" · Return for revision · Not approved · Abstain · Delegate (policy). Each requires a rationale. Approve with conditions adds conditions inline.
- **States:** Stale snapshot (approval disabled, reason, Refresh). Unauthorized or conflicted (“You authored this package and cannot approve it.”). Waiting on second approver. Conditions blocking execution. Invalidated after approval.
- **Pitfalls:** Bare "Approve". Approving a different version than shown. Dissent hidden in comments.

### S11 — Pilot / GTM execution
- **Q:** "Who does what by when, within the approved scope, and did it reach their tools?"
- **Layout:** Pinned **approved baseline** card (G2 v3 · €120k · 90 days · thresholds). Budget meter (Approved · Committed · Spent · Remaining). Milestones and tasks table: task · owner · dependency · due · deliverable · internal status · external status.
- **Actions:** Activate approved plan · **Preview tasks** (dry run: destination, project, assignees, fields, permissions) → Create tasks · Update progress · Report blocker · Request scope change.
- **States:** Partial sync ("5 of 6 tasks confirmed in Jira. 1 failed (permission). [Retry 1 failed task]"). Ambiguous timeout ("Checking Jira before retrying"). Expired connector ("Jira connection expired · internal tasks still active · export CSV"). Missing owner blocks activation. Paused ("Approval changed · sending paused"). Draft outbound messages tagged "Draft — not authorized to send".
- **Pitfalls:** Global "Synced". Retrying all tasks. Task completion shown as gate progress.

### S12 — Outcome review and scale decision
- **Q:** "What happened against the thresholds we agreed, and what do we decide now?"
- **Layout:** Baseline vs actuals table: metric · pre-registered threshold · actual (period, source) · result glyph. Then deployment effort (assumed vs actual), spend (approved vs spent), readiness status, causal limitations (required), "What we learned". Recommendation card: **Revise and extend validation**. Gate rail shows G3 **Blocked**.
- **Actions:** Stop · Revise · Request extension (scoped, own cap) · Request scale approval (disabled with reasons).
- **States:** Missing actuals ("Review incomplete — 1 metric has no data for Oct"). Scale blocked by unmet threshold and incomplete specialist review. Extension request creates a new gate request with its own cap. The PRD gives no extension amount: the designer must use a clearly marked placeholder (for example "€[cap] · placeholder, confirm with PM") and must not invent a figure that reads as real.
- **Pitfalls:** Red failure styling. Revenue attribution claims. Moving targets after the fact.

### S13 — Evidence detail and history
- **Q:** "What exactly does this source say, may I use it, and what depends on it?"
- **Layout:** Reuse CR Evidence Workspace (CR §8 Screen 4): source pane with permitted excerpt, dates (published, retrieved), license boundary. Side panel separates **Quoted fact · Inferred claim · Human assumption**. New: "Used by" list of inputs and claims across cases (permission-checked).
- **Actions:** Challenge · Mark stale · Replace · Inspect impacted cases.
- **States:** Restricted (no excerpt; "Open in licensed tool"). Deleted/unavailable (prior provenance + impact: "Feeds SAM in 2 cases"). Superseded edition.
- **Pitfalls:** Generated excerpts leaking restricted text. Hiding contradicting sources.

### S14 — Administration and connections
- **Q:** "Is everything connected safely, and who may approve what?"
- **Layout:** Reuse CR Screen 12 health rows. Add: **delegated-authority matrix** (gate × BU × ceiling), gate policy editor (preconditions, materiality rules), run budget, retention. Model traces show structured outputs and tool events only.
- **States:** Connector Connected · Expired · Missing permission · Unavailable. Authority gap ("No G3 approver for BU Water above €[limit]" — placeholder).
- **Pitfalls:** Admin appearing able to approve. Infrastructure terms leaking into business screens.

---

## 10. Visual direction

**Tone:** quiet, precise, document-grade, same family as CR (CR §9). References: Linear (calm density), Stripe Dashboard (figures with definitions), Pigment and Causal (named-variable models), GitHub PR review (versioned approval), Planview (gate glyphs).

### 10.1 Typography (change: no Inter)

| Role | Font | Use |
|---|---|---|
| UI sans | **Geist** ([vercel/geist-font](https://github.com/vercel/geist-font), SIL OFL [S]) | All interface text, tables |
| Reading serif | **Source Serif 4** ([adobe-fonts/source-serif](https://github.com/adobe-fonts/source-serif)) | Decision package, thesis prose, evidence passages, exports |
| Mono | **Geist Mono** (same repo) | Case IDs, versions, fingerprints, task keys, formula rows, ledger value column |

- Numbers in tables: use `font-variant-numeric: tabular-nums` in Geist. [H] Verify Geist's `tnum` support in the version used; if absent, set numeric columns in Geist Mono.
- Type scale (unchanged from CR): 12/16 · 13/20 · 14/20 · 16/24 (serif 17/28) · 18/26 · 20/28 · 24/32 · 30/38. Weights 400/500/600.
- Formula rows: Geist Mono 13/20, named inputs in `text.primary`, operators in `text.secondary`.

### 10.2 Spacing, density, layout, radius, elevation, motion

Unchanged from CR §9.2, §9.4, §9.5: 4 px base scale (2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64). Rows 36 px compact / 44 px comfortable. Radius 4 · 6 · 8. Sidebar 240 (56 collapsed) · content max 1160 · right panel 360. Motion 120/180/240 ms, reduced-motion fallback.

### 10.3 Color tokens

**Base tokens: carried over from CR §9.3 unchanged.**

| Token | Light | Dark |
|---|---|---|
| `bg.canvas` | #F7F7F5 | #0F1012 |
| `bg.surface` | #FFFFFF | #17191C |
| `bg.sunken` / `bg.raised` | #F0F0EC | #1E2125 |
| `border.subtle` | #E4E4DF | #2A2E34 |
| `border.control` | #84888F | #6A707A |
| `text.primary` | #17181B | #ECEDEF |
| `text.secondary` | #4B4F57 | #B3B7BF |
| `text.tertiary` | #6A6E76 | #8B9099 |
| `accent` | #3049C9 | #8DA2F7 |
| `success.fg / bg` | #1B7046 / #E6F3EB | #5FCB93 / #12291D |
| `warning.fg / bg` | #8A5300 / #FBF0DA | #E9B651 / #2D2410 |
| `danger.fg / bg` | #B3261E / #FCEBEA | #F48A84 / #331817 |
| `info.fg / bg` | #2853B8 / #E9EEFA | #86A9F6 / #152039 |
| `neutral.fg / bg` | #4B4F57 / #EEEEEB | #B3B7BF / #24272C |
| `ai.fg / bg` | #6A3DB0 / #F1ECFA | #BBA0F4 / #251D3B |
| `restricted.fg / bg` | #3B4250 / #E8EAEE | #C3C8D1 / #262A31 |

**New: epistemic kind tokens.** Contrast computed with the WCAG relative-luminance formula (fg on its bg; and fg on surface).

| Token | Light fg / bg | Ratio (fg/bg · fg/surface) | Dark fg / bg | Ratio |
|---|---|---|---|---|
| `kind.evidence` | #0E6464 / #E3F1F0 | 5.98 · 6.94 | #6CCFCB / #10292A | 8.32 · 9.58 |
| `kind.assumption` | #8C2D6B / #F8E9F1 | 6.63 · 7.77 | #E79BC9 / #2E1726 | 7.84 · 8.33 |
| `kind.scenario` | #2F5F78 / #E6EEF3 | 5.91 · 6.93 | #8FC0DA / #14232C | 8.21 · 8.99 |
| `kind.actual` | #17181B / #ECECE8 | 14.99 · 17.75 | #ECEDEF / #24272C | 12.79 · 15.04 |

Note: assumption plum (#8C2D6B) and AI violet (#6A3DB0) are both purple-adjacent. They never appear without their glyph and label. Test the pair in the comprehension quiz (§11, H5).

**New: scenario ramp (ordinal, no good/bad hue).** Marker shapes are required: Downside ▼, Base ●, Upside ▲.

| Token | Light | vs surface | Dark | vs surface |
|---|---|---|---|---|
| `scenario.downside` | #5E8FA8 | 3.52 | #6E9DB5 | 6.00 |
| `scenario.base` | #2F5F78 | 6.93 | #9CC4D9 | 9.49 |
| `scenario.upside` | #163A4D | 12.02 | #D3E8F3 | 13.93 |

Adjacent scenario hues differ by only ~1.5–2:1, so shape, direct labels, and the table carry identity. Color is a third cue.

**New: chart reference lines.**

| Token | Light | Dark | Use |
|---|---|---|---|
| `chart.actual` | #17191B (solid, ■ marker) | #ECEDEF | Actuals |
| `chart.threshold` | #4B4F57 (dashed 4-2, label "Threshold (pre-registered)") | #B3B7BF | Thresholds |
| `chart.baseline` | #6A6E76 (dotted) | #8B9099 | Approved baseline |
| `chart.cap` | #8A5300 (solid 2 px + lock-bar label "Capacity 120") | #E9B651 | Capacity cap |
| `chart.topdown` | #6A6E76 hatched range bar | #8B9099 | Top-down cross-check |
| `chart.bottomup` | #2F5F78 marker | #9CC4D9 | Bottom-up value |

**New: categorical palette** for up to four opportunities (S04) or cohorts (S06). Derived from Okabe-Ito ([S] [NYU reference](https://siegal.bio.nyu.edu/color-palette/)), darkened in light mode for ≥ 3:1. Never used for status.

| Token | Light | vs surface | Dark | vs surface |
|---|---|---|---|---|
| `cat.1` | #0072B2 | 5.19 | #56B4E9 | 7.63 |
| `cat.2` | #B35A00 | 4.80 | #E69F00 | 7.82 |
| `cat.3` | #00866B | 4.54 | #3CC49E | 8.04 |
| `cat.4` | #A8508A | 5.02 | #D98BB8 | 6.99 |

### 10.4 Gate glyphs

Diamond (rotated square, 14 px in rail, 16 px in panels; 1.5 px stroke):

| State | Glyph | Color |
|---|---|---|
| Not started | Outline diamond | neutral |
| Preconditions open | Outline diamond + small count "2/5" | neutral text, warning count if overdue |
| Ready to submit | Outline diamond with accent stroke | accent |
| Awaiting decision | Half-filled diamond | info |
| Approved | Filled diamond + check | success |
| Approved with conditions | Filled diamond + check + dot | success, condition count in text |
| Returned for revision | Outline diamond + return arrow | warning |
| Blocked | Outline diamond + horizontal bar | warning |
| Not approved / Stopped | Outline diamond + diagonal stroke | neutral |
| Invalidated / Expired | Diamond with outer ring | danger |
| Superseded | Faded outline + "Superseded by v4" text | neutral tertiary |

### 10.5 Number formatting rules

| Rule | Example |
|---|---|
| Market sizes: lowercase m, no space, unit after slash | €100m/year · €40m/year |
| Company measures in comparison sets: one format per row; no more precision than the fixture | €1.0m · €2.0m · €2.4m; €0.60m · €1.20m · €1.44m |
| Thousands: k, no decimals unless needed | €120k · €15k · €600k |
| Scenario money always names scenario and horizon | €2.0m annual revenue · Base · end of year 3 |
| One-time money says so | €400k one-time |
| Ranges: en dash, unit once | €35–50m/year · 8–12 interviews |
| Counts: thousands separator | 5,000 sites · 2,000 unique sites |
| Signed adjustments | −500 (true minus sign U+2212) |
| Percentages: whole numbers for assumptions | 20% adoption · 60% margin |
| Ratios of thresholds: "x of y" | 3 of 4 pilots met threshold |
| True zero vs missing | €0k (break-even) vs "Not available — reason" |
| Exact value on demand | Ledger shows €40,000,000 |
| Currency/year once per view | "EUR · 2026 prices" in header |

[S] Numerals scan better than words on screen (NN/g, via [Hot Pepper summary](https://www.hotpepper.ca/blog/2016/03/14/how-to-write-numbers-for-the-web-numerals-not-words/)). [S] Some public style guides prefer "million" spelled out ([GOV.UK A–Z](https://www.gov.uk/guidance/style-guide/a-to-z)). → Use "m" in dense UI and charts. Spell out "million" in exported prose for the decision package. [H] **Growth OS harmonization:** CR research used "€24.0M". Recommend CR switches to lowercase "m" so both apps match.

### 10.6 Charts

- Every chart has a "Table" toggle and a visible caption with unit, year, and currency ([S] [W3C complex images](https://www.w3.org/WAI/tutorials/images/complex/)).
- Use position and length for quantities (CR §4.5 Exec). No pies. No 3D. No dual axes mixing money and counts.
- Direct labels on lines, not legends alone.
- Allowed charts: measure ladder bars (site counts), scenario dot plot (▼●▲ per metric, capacity line), actual vs threshold bars, budget meter, top-down range vs bottom-up marker.

### 10.7 Components (new or changed)

| Component | Anatomy |
|---|---|
| Measure ladder | Row: name · definition · sites · money with unit · kind tag · lineage link · narrowing connector |
| Cohort table | Cohort rows · signed overlap row · result row · dedup rule · blocking check |
| Input ledger row | name · value + unit · kind · basis chip · evidence quality · version · used by |
| Lineage drawer | formula · inputs (levelled) · used by · history · recalc in draft |
| Scenario table | Downside/Base/Upside columns · "What changes" row · cap labels |
| Money card pair | Recurring card · One-time card · divider "Do not add" · exclusions box |
| Assumption row | value · owner · sensitivity · evidence shield · method · experiment link · status · disputed flag |
| Experiment card | Plan (locked) · decision rule table · result · amendments |
| Gate rail | stage segments · diamonds · scope + date under each |
| Approval panel | version + fingerprint · authority · Authorizes / Does not authorize · chain · scoped buttons |
| Reviewer positions | reviewer · role · position · scope · version |
| Condition item | text · owner · due · "Blocks execution" flag |
| Budget meter | approved · committed · spent · remaining · gate link |
| App switcher | Growth OS mark · app name · app glyph · list |

---

## 11. Validation plan

### 11.1 Research questions

1. Do users read TAM, SAM, reachable pool, and SOM as different measures, and never add them?
2. Do users tell Evidence, Assumption, Scenario, and Actual apart without help?
3. Do users read Downside/Base/Upside as conditional cases, not likelihoods?
4. Do users keep recurring contribution and one-time investment apart?
5. Can the sponsor state exactly what a G2 approval authorizes and what it does not?
6. Do users notice and question the disputed 20% adoption assumption?
7. Do users understand that a failed threshold stays in history after amendment?
8. Do users tell case stage, gate status, run status, and sync status apart?
9. Do "Revise and extend" and "Scale blocked" feel like legitimate outcomes or like failures?
10. Can finance trace any economics figure to its inputs in under a minute?
11. Do reviewers complete a review from the Decision brief without opening working tabs?

### 11.2 60-minute usability script (Aster journey)

Format: moderated, remote, think-aloud, clickable prototype with fixture data. Run role-specific sessions. Small iterative rounds of about five users per segment ([S] [NN/g](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/)).

**Intro (5 min).** Consent. "We are testing the design, not you." Warm-up: "Tell me about the last market-entry or expansion decision you were part of. What did the decision pack look like?"

**Operator tasks (Maya role), 30 min**
1. *Shortlist (4 min).* "Find the opportunity you would take forward for this mandate and shortlist it." Success: shortlists German food-processing; can name one piece of evidence and one unknown.
2. *Read the sizing (6 min).* "How big is this market? What can you realistically win by year 3?" Success: states €100m/year TAM, €40m/year SAM, 500 reachable sites, €2.0m annual revenue Base SOM at end of year 3; says they must not be added; calls SOM a scenario. **Probe:** "What is the total opportunity?" Pass = declines to add.
3. *Overlap (3 min).* "Explain how we get 2,000 sites." Success: explains 1,400 + 1,100 − 500. **Variant:** duplicate cohort warning; participant resolves it.
4. *Disputed assumption (6 min).* "Daniel disputes something. Find it and decide what to do." Success: finds 20% adoption, sees it is an Assumption with weak evidence and high sensitivity, opens lineage, sees it drives SOM and economics, and links or creates a validation experiment.
5. *Validation tasks (5 min).* "Set up the test and create the tasks." Success: experiment card with threshold (8 interviews, 4 paid commitments, 20 sites); requests G1 for €15k; previews tasks before creating them. **Variant:** partial sync; retries only the failed task.
6. *Pilot request (6 min).* "Results are in. Prepare the pilot request." Success: notes 9 interviews and 4 commitments → Met; builds G2 package; fills stop rules; sees dissent section; submits "Pilot €120k · 90 days".

**Approver tasks (Elena role), 12 min**
7. *Understand the ask (4 min).* "What are you being asked to approve?" Success: says €120k, 90 days, German food-processing pilot, version v3; says it does not authorize scale or outreach.
8. *Stale snapshot (3 min).* Variant: an input changed. "Can you approve now?" Success: sees disabled approval with reason, requests refresh.
9. *Approve (5 min).* Success: clicks "Approve pilot €120k · 90 days", enters rationale, adds one condition, understands task creation is separate.

**Pilot owner tasks (Jonas role), 6 min**
10. *Task preview (3 min).* "Send the approved plan to the team's task tool." Success: reviews preview (destination, assignees), confirms. **Variant:** expired connector; uses export fallback.
11. *Record results (3 min).* Success: records 3 of 4 met paid-use threshold, deployment effort above assumption, with period and source.

**Review and decision (Elena or Maya), 5 min**
12. *Mixed results.* "What should happen next?" Success: chooses or accepts "Revise and extend"; requests a scoped extension with its own cap; explains why Scale is blocked (demand threshold not met; specialist scale review incomplete). **Probe:** "Did the project fail?" Listen for framing.

**Debrief (2 min).** SEQ after each task. "Which figure would you forward to your CFO as is? Which would you check first?"

### 11.3 Success metrics (targets are hypotheses)

| Metric | Target |
|---|---|
| Unassisted task success on core tasks | ≥ 80% per task |
| Measure-ladder comprehension (no adding; SOM called scenario) | 100%. Any failure is a blocker |
| Epistemic-kind quiz (screenshot, 8 values) | ≥ 90% correct |
| Scenario reading (no probability language used) | ≥ 90% |
| Recurring vs one-time kept separate | 100% |
| Approver states scope and what is not authorized | ≥ 90% |
| Disputed assumption found and traced unprompted | ≥ 70% [H: baseline unknown] |
| Partial-sync recovery without retrying confirmed tasks | ≥ 90% |
| Finance traces a figure to inputs | median ≤ 60 s |
| "Revise and extend" rated as a legitimate outcome (5-point) | median ≥ 4 |
| SEQ (7-point) | median ≥ 5.5 |

### 11.4 Recruiting criteria

- **Strategy / MI leads (5–6):** Built a market-entry or expansion business case in the past 18 months at a B2B company > 500 employees. At least 2 from industrial manufacturing.
- **Sponsors (4–5):** BU heads, VPs Strategy, GMs who approved or rejected expansion or pilot budgets in the past 18 months.
- **Finance partners (3–4):** Reviewed a growth or capex business case in the past 12 months.
- **Commercial pilot owners and sales leaders (3–4 each):** Ran or staffed a market pilot.
- **Product and legal/regulatory reviewers (2–3 each):** Signed readiness for a new segment or geography.
- **Admins (2):** Optional in round 1.
- **Mix:** DACH and other EU regions. Some users of Planview, Aha!, Productboard, or AlphaSense; some on decks and spreadsheets only. At least one participant using magnification or a screen reader.
- **Screen out:** Employees of strategy-software or market-research vendors. Anyone from earlier concept sessions.

---

## 12. Hypothesis register

| # | Hypothesis | How to test |
|---|---|---|
| H1 | A measure ladder (rows) prevents summing better than nested circles | A/B comprehension test, task 2 |
| H2 | Line style + glyph + label lets users identify epistemic kind at a glance | Screenshot quiz |
| H3 | Ordinal petrol scenarios with ▼●▲ avoid "base = expected" reading | Probe wording in task 2 and Economics |
| H4 | "Authorizes / Does not authorize" boxes raise scope recall at approval | Approver task 7, with and without |
| H5 | Plum assumption and violet AI are distinguishable with glyphs | Quiz pair; swap hue if < 90% |
| H6 | Neutral styling for Not met / Stopped makes negative outcomes feel legitimate | Task 12 rating, compare red variant |
| H7 | Reviewers finish from the Decision brief route | Path analysis |
| H8 | Separate Reviews nav beats a My Work tab for reviewers | First-click test |
| H9 | Two-key sort (sensitivity then evidence) is clearer than a numeric priority score | Task 4 time and explanation |
| H10 | Geist with tabular figures aligns ledger columns adequately | Visual QA; fall back to Geist Mono |

---

## 13. Sources

- PRD (this repo): ../PRD.md · CR research: ../../design/UX_RESEARCH.md
- Stage-gate: https://prime.mindtools.com/pages/article/stage-gate-innovation.htm · https://agilebrandguide.com/wiki/models/stage-gate-process/ · https://www.netguru.com/blog/stage-gate-process-guide
- Planview gated project dashboard: https://success.planview.com/Planview_Portfolios/Analytics_and_Reporting/FastTrack_Analytics_and_Dashboards/FastTrack_Dashboards/RPM_Dashboard_WRK101_-_Gated_Project_Detail · community: https://community.planview.com/ask-the-community-67/stage-gates-536
- Discovery-driven planning: https://www.christenseninstitute.org/blog/thursday-theory-tips-how-do-i-plan-my-new-venture/ · https://scottburleson.substack.com/p/article-summary-discovery-driven
- Bain, Hard Core Growth: https://www.bain.com/insights/hard-core-growth-bain-research-shows-how-smart-companies-profit-from-their-core-business-beyond/
- McKinsey, The case for behavioral strategy: https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/the-case-for-behavioral-strategy
- Kahneman, Lovallo & Sibony, Before You Make That Big Decision (HBR 2011): https://store.hbr.org/product/the-big-idea-before-you-make-that-big-decision/R1106B
- Pre-mortem: https://en.wikipedia.org/wiki/Pre-mortem
- Planning fallacy and reference class forecasting: https://www.pmi.org/learning/library/planning-fallacy-causes-solutions-project-expectations-6374 · https://risknet.de/fileadmin/eLibrary/Flyvbjerg-Nobel-PMJ2006.pdf
- Uncertainty communication: https://research.rug.nl/en/publications/the-effects-of-communicating-uncertainty-on-public-trust-in-facts/ · https://wrap.warwick.ac.uk/116193/
- Anchor precision: https://pubmed.ncbi.nlm.nih.gov/18271859/ · https://fis.leuphana.de/de/publications/how-attribution-of-competence-and-scale-granularity-explain-the-a/
- Finance partnering: https://www.gartner.com/en/finance/insights/business-partnering · https://board.com/wp-content/uploads/2025/01/board_fpa-assessment_mini-guide_business-partneringcollaboration.pdf
- AI over-reliance research: https://arxiv.org/abs/2402.07632v4
- Strategyzer: https://www.strategyzer.com/library/how-assumptions-mapping-can-focus-your-teams-on-running-experiments-that-matter · https://www.strategyzer.com/library/validate-your-ideas-with-the-test-card · https://www.strategyzer.com/blog/posts/2015/3/9/capture-customer-insights-and-actions-with-the-learning-card
- Eppo: https://geteppo.com/blog/make-decisions-before-experimenting · https://docs.geteppo.com/experiment-analysis/configuration/protocols/
- Statsig: https://docs.statsig.com/experiments/create-new
- Pigment: https://kb.pigment.com/docs/versions-scenarios
- Causal Scenarios: https://workspace.google.com/marketplace/app/causal_scenarios/383280853562
- Excel formula auditing: https://support.microsoft.com/office/display-the-relationships-between-formulas-and-cells-a59bef2b-3701-46bf-8ff1-d3518771d507
- Observable (review): https://futureofcoding.org/catalog/observable.html
- Productboard: https://www.productboard.com/prioritize-features · Aha!: https://www.aha.io/support/roadmaps/strategic-roadmaps/customizations/create-aha-scorecards/content-only
- Cascade: https://cascade.app/solutions/okr-software · https://www.tability.io/compare/platform/cascade
- AlphaSense: https://www.alpha-sense.com/solutions/market-intelligence-platform/
- Statista methodology: https://www.ipleiria.pt/sdoc/wp-content/uploads/sites/10/2023/09/Market-Insights.pdf
- CB Insights: https://www.cbinsights.com/research/team-blog/market-map-maker-autobuild-is-here
- Brex: https://brex.com/support/how-do-i-update-a-budget · Carta: https://carta.com/product-updates/how-carta-does-board-consents/
- GitHub, Ramp, Linear, NN/g, WCAG, Lucide, Source Serif: see CR research §12
- W3C complex images: https://www.w3.org/WAI/tutorials/images/complex/
- Okabe-Ito palette: https://siegal.bio.nyu.edu/color-palette/
- Geist fonts: https://github.com/vercel/geist-font
- Number style: https://www.gov.uk/guidance/style-guide/a-to-z · https://www.hotpepper.ca/blog/2016/03/14/how-to-write-numbers-for-the-web-numerals-not-words/
- NN/g testing with 5 users: https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/
