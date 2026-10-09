# Key workflows — Growth OS · Market Expansion OS

A catalogue of the key workflows. Each has a stable ID (`WF-01`, `WF-02`, …), a diagram, and a short
narrative naming actors, components, state changes, events and failure paths. Later stages append new
workflows (`WF-11`, …) or add a dated "Update" note under an existing one; never renumber.

**Conventions.** Actors are the synthetic Aster personas (PRD §6). Components: **Web** (`apps/web`),
**API** (`apps/api` command pipeline), **Policy** (`PolicyEngine`), **Domain** (state machines and
engines in `packages/domain`), **DB** (Postgres with RLS and guard triggers), **Worker**
(`apps/worker`), **Gateway** (agent tool gateway), **Provider** (analysis provider, fixture by default),
**Connector** (`TaskConnector`, simulated Jira). Every state change writes an `audit_event` in the same
transaction; analytics events are the PRD §17 names. Architecture references: ARCHITECTURE.md §8–§14.

| ID | Workflow | Main PRD refs |
|---|---|---|
| WF-01 | Mandate → G0 | ME-01, ME-10, ME-11, S02 |
| WF-02 | Opportunity discovery → shortlist → convert | ME-02, ME-03, ME-04, S03, S04 |
| WF-03 | Sizing calculation and lineage | ME-05, ME-15, S06 |
| WF-04 | Economics scenario recompute (draft vs snapshot) | ME-07, ME-15, S08 |
| WF-05 | Assumption dispute and validation experiment (threshold lock and amendment) | ME-08, ME-09, S09 |
| WF-06 | Gate request → snapshot → approval, and invalidation on material change | ME-10, ME-11, §4, S10 |
| WF-07 | Pilot activation → outbox → connector, partial failure and idempotent retry | ME-12, ME-13, S11 |
| WF-08 | Outcome review → revise/extend, scale gate blocked | ME-14, §6, S12 |
| WF-09 | Analysis run lifecycle with checkpoint and resume | §8, ME-15, ME-16 |
| WF-10 | Evidence challenge and restricted-source handling | ME-02, ME-15, ME-16, S13 |

---

## Stage: Architecture (2026-10-09)

### WF-01 — Mandate → G0

```mermaid
sequenceDiagram
  autonumber
  actor Maya as Maya Rao (case owner)
  actor Elena as Elena Fischer (sponsor)
  participant Web
  participant API
  participant Policy
  participant Domain
  participant DB
  Maya->>Web: Create mandate MD-21, edit fields
  Web->>API: PATCH /me/mandates/MD-21/draft (If-Match), autosave every 800 ms
  API->>DB: update draft mandate_version, row_version+1
  Maya->>Web: Submit for G0
  Web->>API: POST /me/mandates/MD-21/submit (Idempotency-Key)
  API->>Domain: validate MandateFields (owner, currency, compatible horizons)
  alt missing owner or currency
    Domain-->>API: errors
    API-->>Web: 400 VALIDATION_FAILED, inline errors and summary
  else valid
    API->>DB: commit mandate_version v1, gate_request G0 awaiting_decision
    API->>DB: decision_snapshot v1 (canonical JSON + SHA-256, DB re-checks hash)
    API->>DB: audit gate.submitted, analytics mandate_created + gate_submitted
    API-->>Web: Mandate awaiting decision
  end
  Elena->>Web: Open G0 package
  Web->>API: GET /me/gate-requests/:id/package
  API->>Policy: allowedActions(Elena, G0)
  API-->>Web: snapshot, authorizes / does not authorize, panel state
  Elena->>Web: Return for revision with required comment
  Web->>API: POST decisions {disposition return_for_revision, snapshotHash, rationale}
  API->>DB: approval row (return), gate_request returned_for_revision, mandate returned
  API->>DB: audit, analytics gate_returned
  Maya->>Web: Fix owner and currency, resubmit
  Web->>API: POST submit (new Idempotency-Key)
  API->>DB: mandate_version v2 committed, snapshot v2, gate awaiting_decision
  Elena->>Web: Approve mandate (G0) with rationale
  Web->>API: POST decisions {approve, snapshotId v2, snapshotHash}
  API->>Policy: check gate.decide (grant G0, BU Water, not author, not owner)
  API->>DB: approval (DB guard re-checks session, snapshot current, hash, grant)
  API->>DB: gate approved, mandate approved, draft_mandate cases to discovery
  API->>DB: audit gate.decided, analytics gate_approved + mandate_approved
  API-->>Web: "Mandate approved (G0) · No spend is authorized by G0"
```

**Narrative.** Maya drafts mandate MD-21 with autosave (`If-Match` row versions). Submitting validates the
required fields (owner, currency from a fixed list, horizons), commits the mandate version, opens the G0
gate request and freezes snapshot v1. Elena sees the scoped panel ("What this authorizes: search and
assessment within this scope · What this does not authorize: no spend, no prospect outreach"). She returns
v1 with a required comment; the comment stays in history. Maya resubmits v2; Elena approves exactly v2.
**State changes:** `mandate.status` draft → awaiting_decision → returned → draft → awaiting_decision →
approved; `gate_request` draft → awaiting_decision → returned_for_revision → awaiting_decision → approved;
cases created with an inline mandate move draft_mandate → discovery. **Events:** `mandate_created`,
`gate_submitted`, `gate_returned`, `gate_approved`, `mandate_approved`. **Failure paths:** missing
owner/currency/incompatible horizon → 400 with inline errors; sponsor without a G0 grant → panel shows
"Request access" and the API returns `AUTHORITY_INSUFFICIENT`; Maya cannot approve
(`SELF_APPROVAL_PROHIBITED`); a decision against v1 after v2 exists → `SNAPSHOT_STALE`/hash mismatch;
double click → same `Idempotency-Key` replays the first response.

---

### WF-02 — Opportunity discovery → shortlist → convert

```mermaid
sequenceDiagram
  autonumber
  actor Maya as Maya Rao
  participant Web
  participant API
  participant Worker
  participant Gateway
  participant DB
  Maya->>Web: Request discovery for MD-21
  Web->>API: POST /me/mandates/MD-21/discovery-runs
  API->>DB: agent_run queued (skill mandate-to-search-plan), job enqueued in same tx
  API-->>Web: 202 runId, analysis strip "Queued"
  Worker->>Gateway: intelligence.search (tenant, Maya's access, licences)
  Gateway-->>Worker: permitted results, trade registry unavailable
  Worker->>DB: proposals (opportunity_candidate), run partial, reason source unavailable
  Web->>API: GET /me/opportunities?mandateId=MD-21
  API-->>Web: candidates "Proposed · AI", discoveryPartial true
  Maya->>Web: Accept proposals (become Detected), add OPP-14 manually
  Maya->>Web: Merge OPP-12 into OPP-07 (likely duplicate)
  Web->>API: POST /me/opportunities/OPP-12/merge
  API->>DB: OPP-12 duplicate, linked, both kept
  Maya->>Web: Compare OPP-07, OPP-14, OPP-09, OPP-16
  Web->>API: POST /me/comparisons
  API-->>Web: cells (Unknown = null), OPP-09 incomparable boundary, ranking blocked
  Maya->>Web: Exclude OPP-09 until normalized, preview then apply weights v2
  Maya->>Web: Shortlist OPP-07, then Convert to case
  Web->>API: POST /me/opportunities/OPP-07/shortlist, then /convert {ownerId Maya}
  API->>DB: OPP-07 shortlisted then converted, workflow_case ME-104 stage discovery
  API->>DB: audit, analytics opportunity_shortlisted
  API-->>Web: "Converted to case ME-104 · Owner Maya Rao · stage Discovery"
```

**Narrative.** Discovery is a bounded analysis run; its candidates are proposals shown as "Proposed · AI"
until Maya accepts them (Detected). A missing source makes the run `partial` and the list shows
"Discovery partial — 1 source unavailable. Results are not exhaustive." Maya merges the likely duplicate
(both records kept and linked), compares up to four candidates on a common unit (missing values are
Unknown, never 0; an incomparable boundary blocks ranking until excluded or normalized; weights are
versioned), shortlists OPP-07 and converts it. **State changes:** opportunity detected → shortlisted →
converted; OPP-12 detected → duplicate; dismissals need a reason. A new `workflow_case` starts in
Discovery because MD-21 is G0-approved. **Events:** `opportunity_shortlisted`. **Failure paths:** expired
market-data connection → banner "ask admin · upload instead"; convert before G0 → `PRECONDITIONS_UNMET`;
AI down → manual add still works; merge into a candidate of another mandate → `INVALID_TRANSITION`.

---

### WF-03 — Sizing calculation and lineage

```mermaid
sequenceDiagram
  autonumber
  actor Maya as Maya Rao
  participant Web
  participant API
  participant Domain as SizingEngine
  participant DB
  Maya->>Web: Edit cohort or input in Sizing draft
  Web->>API: PATCH /me/cases/ME-104/sizing/draft (If-Match)
  API->>DB: upsert draft sizing_version children (guard allows: parent is draft)
  API->>Domain: calculate(SizingInput) with decimal.js
  Domain->>Domain: checks (currency, year, unit, overlap, SAM vs TAM, reachable vs SAM, duplicates)
  Domain-->>API: SizingOutput {ladder, checks, lineage, inputHash}
  API->>DB: calculation_result (engine, version, inputHash) idempotent insert
  API-->>Web: SizingView, blocking checks inline
  alt blocking check (SAM 2,000 > TAM 500)
    Web-->>Maya: "Blocking: SAM is larger than TAM", snapshot disabled, Undo edit
  else no blocking checks
    Maya->>Web: Create snapshot v2
    Web->>API: POST /me/cases/ME-104/sizing/commit (Idempotency-Key)
    API->>DB: sizing_version state committed (CHECK needs calculation_result_id)
    API->>DB: pin assumption_version ids, audit, analytics sizing_snapshot_created
    API->>DB: materiality check for snapshots pinning the previous version
  end
  Maya->>Web: Click "SAM €40m/year"
  Web->>API: GET /me/cases/ME-104/lineage?node=sizing.sam.value&model=sizing&version=2
  API-->>Web: formula, inputs one level, used by, history, exact €40,000,000
```

**Narrative.** All arithmetic is in the deterministic engine; the browser never computes money. The
draft recalculates on every save and shows blocking checks inline. Commit ("Create snapshot v2") is
possible only with an unblocked calculation result, enforced by a database CHECK; committed versions and
their children are immutable. The ladder narrows by sites then money: TAM 5,000 sites · €100m/year, SAM
(1,400 + 1,100 − 500) = 2,000 sites · €40m/year, reachable pool 500 sites (no money), SOM Base Year 3 100
customers · €2.0m annual revenue; upside capped at 120. Lineage opens on any figure. **State changes:**
sizing_version draft → committed. **Events:** `sizing_snapshot_created`; `assumption_changed` when an
input assumption is edited. **Failure paths:** duplicate cohort → calculation paused with Keep v1 / Keep
imported; restricted site list → aggregates only or "Unavailable under your access", no counts; mixed
currency/year/unit → blocking check; concurrent edit → 412 conflict banner; top-down outside range →
amber "Explain the gap before G1", never averaged.

---

### WF-04 — Economics scenario recompute (draft vs snapshot)

```mermaid
stateDiagram-v2
  [*] --> Committed_v2: economics v2 committed (frozen, pinned by snapshots)
  Committed_v2 --> Draft: edit any driver (draft created from v2)
  Draft --> Draft: PATCH draft, engine recalculates, changed cells "Recalculated"
  Draft --> Committed_v2: Reset to v2 (discard draft)
  Draft --> Committed_v3: Create snapshot v3 (no blocking checks)
  Committed_v3 --> MaterialityCheck: commit triggers evaluation
  MaterialityCheck --> SnapshotsStale: G2 snapshot pins v2 and change is material
  MaterialityCheck --> NoEffect: nothing pins v2
  SnapshotsStale --> [*]
  NoEffect --> [*]
```

**Narrative.** Daniel or Maya edits price, adoption, margin, opex, capacity or one-time investment in a
draft. The engine recalculates the draft per scenario in fixed order (Downside · Base · Upside):
customers = min(floor(500 × adoption), 120) → revenue → gross contribution (× 60%) → contribution after
€600k opex. The approved snapshot never recalculates: S10 shows the frozen v2/v3 table. The €400k one-time
investment is a separate card ("Different time bases. Do not add."); cash flow and payback are "Not
available" with the missing inputs listed. "What must be true?" computes break-even customers (50).
Committing creates v3 and runs materiality: if a current G2 snapshot pins v2, that snapshot goes stale.
**Events:** `assumption_changed` (driver assumptions), none for drafts. **Failure paths:** missing opex
→ "Recommendation incomplete — opex scope missing" (commit blocked); currency/year mismatch → "Normalize
to EUR 2026"; finance review only lists what was checked and not checked; editing a committed version is
refused by the database.

---

### WF-05 — Assumption dispute and validation experiment (threshold lock and amendment)

```mermaid
sequenceDiagram
  autonumber
  actor Daniel as Daniel Weber (finance)
  actor Maya as Maya Rao
  actor Elena as Elena Fischer
  actor Jonas as Jonas Klein
  participant API
  participant Domain
  participant DB
  Daniel->>API: POST /me/assumptions/ASM-01/disputes {statement, proposed 10%}
  API->>DB: challenge kind dispute open, audit
  Maya->>API: POST /me/challenges/:id/replies "Keep 20% Base, add 10% Downside"
  Maya->>API: POST /me/cases/ME-104/assumptions (Downside 10%, owner Daniel)
  Maya->>API: POST /me/cases/ME-104/experiments EXP-03 (20 sites, interviews >= 8, commitments >= 4, 15k)
  API->>DB: experiment draft, plan v1, metrics, linked ASM-01 and ASM-04
  Maya->>API: create and submit G1 request (snapshot pins EXP-03 plan v1)
  Elena->>API: POST decisions approve "Approve validation 15k"
  API->>Domain: G1 approved, experiment lock
  API->>DB: EXP-03 locked (plan v1 is_original), case stage validation
  API->>DB: analytics validation_authorized, gate_approved
  Jonas->>API: task sync for 5 validation tasks (see WF-07)
  Maya->>API: POST /me/experiments/EXP-03/amendments {reason, windowEnd 20 Nov}
  API->>DB: plan v2, amendment 1 (thresholdsChanged false, afterResultsSeen false)
  Maya->>API: POST /me/experiments/EXP-03/results {9 interviews, 4 commitments, period, source}
  API->>Domain: compare to locked thresholds
  API->>DB: result version 1 (Met, Met), lifecycle result_recorded, analytics experiment_completed
  Maya->>API: POST decision "Prepare G2 pilot request"
  Daniel-->>API: dispute stays open until he or the sponsor resolves it with a reason
```

**Narrative.** A reviewer dispute is a first-class object ("Disputed by Daniel Weber"), not a comment. It
stays open until the disputing reviewer or the sponsor resolves it with a reason, and the dissent travels
into every later package. The experiment card's plan locks when G1 approves the snapshot containing it;
the locked plan is the pre-registered original. Any later change is an amendment with a reason, creating a
new plan version; the original threshold stays visible ("Original (pre-registered)"). Results are
append-only versions compared with the locked thresholds: 9 of 8 → Met, 4 of 4 → Met, with limitations
("Interviews do not validate conversion…"). **State changes:** challenge open; experiment draft → locked
→ running → result_recorded; assumption statuses Testing → Supported/Inconclusive by human update.
**Events:** `assumption_changed`, `validation_authorized`, `gate_approved`, `experiment_completed`.
**Failure paths:** editing a locked plan → `INVALID_TRANSITION` ("create an amendment"); amendment after
results seen is flagged on the card; result without period or source → 400; a failed threshold can never be
deleted (database refuses updates to result versions); before the window closes the result shows "Too
early to read".

---

### WF-06 — Gate request → snapshot → approval, and invalidation on material change

```mermaid
sequenceDiagram
  autonumber
  actor Maya as Maya Rao
  actor Elena as Elena Fischer
  participant Web
  participant API
  participant Policy
  participant Domain
  participant DB
  Maya->>API: POST /me/cases/ME-104/gate-requests {G2, 120k, 90 days, max 4 sites}
  Maya->>API: POST /me/gate-requests/:id/submit
  API->>Domain: preconditions (validation results, finance review, specialist sign-off, budget and stop rules, pilot owner)
  API->>Domain: build SnapshotContent from committed versions, canonicalize, SHA-256
  API->>DB: decision_snapshot v3 + snapshot_component rows, v2 superseded, case pilot_approval_pending
  Note over Maya,DB: Variant - Maya commits a new Base adoption value
  Maya->>API: PATCH /me/assumptions/ASM-01 {value, changeReason}
  API->>Domain: materiality(decision_critical_assumption_changed) is material
  API->>DB: assumption_version v3, material_change, snapshot v3 stale "adoption assumption changed on 26 Nov"
  Elena->>Web: Open package v3
  Web-->>Elena: amber stale banner, approval disabled, See what changed
  Maya->>API: POST /me/gate-requests/:id/refresh
  API->>DB: snapshot v4 current, v3 superseded
  Elena->>API: POST decisions {approve_with_conditions, snapshot v4 id and hash, C1 blocks execution, C2 monitor}
  API->>Policy: grant G2 BU Water ceiling, not author, not owner, interactive session
  API->>DB: approval (DB guard), conditions C1 C2, gate approved_with_conditions, expires_at
  API->>DB: case pilot_approved, analytics gate_approved
  Note over Maya,DB: Later - spend ceiling raised after approval
  Maya->>API: change requested amount (scope change)
  API->>Domain: materiality(spend_ceiling_changed) is material
  API->>DB: approval_invalidation, gate invalidated, outbox rows paused, case pilot_approval_pending
  API->>DB: analytics approval_invalidated
```

**Narrative.** Submitting freezes a snapshot from committed versions only, with a canonical hash the
database verifies, and indexes every pinned version. The approver sees exactly that snapshot with its
fingerprint, the authorizes/does-not-authorize boxes, reviewer positions, conditions and signed dissent.
A material change to anything pinned makes the snapshot stale before a decision (approval disabled until
"Refresh snapshot (creates v4)") or invalidates the approval after a decision (red ring on the rail,
"Approval for v4 no longer applies: spend ceiling changed. Pilot tasks paused."). Uncertain changes
escalate to the sponsor. Approvals unused by `expires_at` expire through a timer. **State changes:**
gate_request draft → awaiting_decision → stale → awaiting_decision → approved_with_conditions →
invalidated; snapshots current → stale/superseded; case validation → pilot_approval_pending →
pilot_approved → pilot_approval_pending. **Events:** `gate_submitted`, `gate_approved`,
`approval_invalidated`. **Failure paths:** author/owner approves → `SELF_APPROVAL_PROHIBITED` (UI: "You
authored this package and cannot approve it."); agent or service identity → `AGENT_IDENTITY_FORBIDDEN`;
amount above ceiling or no grant → `AUTHORITY_INSUFFICIENT` with routing reason; hash mismatch →
`SNAPSHOT_HASH_MISMATCH`; missing specialist sign-off → `PRECONDITIONS_UNMET` with "Why?" list; the
database refuses any of these even if the API were wrong.

---

### WF-07 — Pilot activation → outbox → connector, partial failure and idempotent retry

```mermaid
sequenceDiagram
  autonumber
  actor Jonas as Jonas Klein (pilot owner)
  participant Web
  participant API
  participant DB
  participant Worker
  participant Conn as Connector (simulated Jira)
  Jonas->>API: POST /me/cases/ME-104/pilot-plan/activate
  API-->>Jonas: 409 PRECONDITIONS_UNMET (task 2 has no owner, C1 open)
  Jonas->>API: assign owner, POST /me/conditions/C1/met, activate again
  API->>DB: plan version committed, pilot active, case pilot_running, analytics pilot_activated
  Jonas->>API: POST /me/task-sets/:id/previews
  API->>Conn: preview(6 items) no writes
  API-->>Web: destination PIL, assignees, permissions, previewId and hash
  Jonas->>API: POST /me/task-sets/:id/sync {previewId, previewHash} (Idempotency-Key)
  API->>DB: 6 external_task_link sending + 6 outbox rows (key per task) + jobs, one tx
  API-->>Web: 202, "Sending…"
  loop each outbox row
    Worker->>DB: lock row, set tenant, re-check approval, plan version, actor, connection
    Worker->>Conn: createTask(key)
  end
  Conn-->>Worker: 5 created (PIL-11, PIL-13 to PIL-16)
  Conn-->>Worker: task 2 permission_denied (assignee not in project PIL)
  Worker->>DB: 5 confirmed, task 2 failed (retryable after fix), analytics external_task_failed
  Web-->>Jonas: "5 of 6 tasks confirmed in Jira · 1 failed"
  Jonas->>API: fix mapping, POST /me/task-sets/:id/retry (failed only, same key)
  Worker->>Conn: createTask(same key)
  alt timeout after success
    Conn--xWorker: timeout (issue was created)
    Worker->>DB: task 2 checking, enqueue reconcile
    Worker->>Conn: findByIdempotencyKey(key)
    Conn-->>Worker: PIL-12
  else success
    Conn-->>Worker: PIL-12
  end
  Worker->>DB: task 2 confirmed, analytics external_task_confirmed
  Web-->>Jonas: "6 of 6 tasks confirmed in Jira"
```

**Narrative.** Activation requires an effective, unexpired G2 approval, every blocking condition met and
every task owned. The dry-run preview is mandatory before the first write and binds the send to the plan
content by hash. One transaction writes the per-task sync rows, outbox rows with stable idempotency keys,
jobs and audit. The worker re-checks authorization at send time and records each task's outcome
separately; "Confirmed · PIL-11" only appears with a returned key. Retry sends only failed tasks with the
same keys; an ambiguous timeout is reconciled by searching for the key before any retry, so the simulator
never holds two issues for one key. **State changes:** pilot plan draft → active; case pilot_approved →
pilot_running; sync not_sent → in_preview → sending → confirmed / failed / checking / retry_scheduled.
**Events:** `pilot_activated`, `external_task_confirmed`, `external_task_failed`. **Failure paths:** expired
token → connection Expired, all unsent rows `paused_connector`, internal tasks continue, "Export CSV
instead"; approval invalidated → unsent rows "Paused — approval changed", confirmed tasks preserved; 5xx →
backoff up to 5 attempts then Failed with Retry; worker crash mid-send → sweep reclaims the leased row and
reconciles; double click on Create → same Idempotency-Key replays. Outbound prospect messages stay drafts:
there is no send endpoint.

---

### WF-08 — Outcome review → revise/extend, scale gate blocked

```mermaid
sequenceDiagram
  autonumber
  actor Jonas as Jonas Klein
  actor Maya as Maya Rao
  actor Elena as Elena Fischer
  participant API
  participant Domain
  participant DB
  Note over API,DB: Timer at window end (28 Feb 2027) moves case pilot_running to review_due
  Jonas->>API: POST outcome-observations (paid use 3 of 4, 1 Dec to 28 Feb, billing records)
  Jonas->>API: POST outcome-observations (effort above assumption, effort log C2)
  Jonas->>API: POST outcome-observations (buyer fit mixed, Feb interviews)
  API->>Domain: compare with targets pre-registered in G2 snapshot
  API->>DB: observations (append-only) Not met, Not met, Inconclusive, analytics outcome_recorded
  Maya->>API: PATCH outcome-review (learned, changes next, causal limitations, recommendation extend)
  Elena->>API: POST outcome-decisions {extend, "Revise and extend validation", rationale}
  API->>Domain: case review_due to validation (decision recorded, causal limitations present)
  API->>DB: decision_record, outcome_review decided, case stage validation
  Maya->>API: POST extension-requests {parent G2, cap placeholder, duration, owner Jonas, scope}
  API->>DB: gate_request X1 awaiting_decision with own cap, analytics extension_requested
  Maya->>API: GET gates/G3/preconditions
  API->>Domain: pilot actuals vs thresholds 3 of 4 (needs 4 of 4), specialist scale review incomplete
  API-->>Maya: G3 Blocked, 2 preconditions unmet
  Maya->>API: POST gate-requests {G3} (forced)
  API-->>Maya: 409 PRECONDITIONS_UNMET with both blockers
```

**Narrative.** Actuals carry a measurement period and source and are compared with the thresholds that
were pre-registered in the approved G2 snapshot (they cannot move). Corrections append a new version.
The review needs causal limitations before a decision. Elena records "Revise and extend validation"; the
case returns to Validation. The extension is a new gate request (X1) with its own cap (a placeholder,
because the PRD sets no amount) and never unblocks G3. The scale gate is blocked by two unmet
preconditions and the €400k one-time scale investment is not requested. Neutral styling: "Not met" is a
learning result, not a failure. **State changes:** case pilot_running → review_due → validation;
outcome_review incomplete → ready → decided; X1 draft → awaiting_decision. **Events:** `outcome_recorded`,
`extension_requested`; `scale_requested` only if G3 is ever submitted; `case_stopped` if Stop is chosen.
**Failure paths:** missing actuals → "Review incomplete — 1 metric has no data for Oct"; "scale" as a
review outcome → 400 (scale needs G3); G3 request → `PRECONDITIONS_UNMET`; no G3 approver configured →
"Authority gap" in S14.

---

### WF-09 — Analysis run lifecycle with checkpoint and resume

```mermaid
sequenceDiagram
  autonumber
  actor Maya as Maya Rao
  participant API
  participant DB
  participant Worker as Worker harness
  participant Prov as Provider (fixture or Claude)
  participant GW as Tool gateway
  Maya->>API: POST /me/cases/ME-104/analysis-runs {skill ability-to-win-assessment}
  API->>DB: agent_run queued (budget, input snapshot hash, requested_by Maya) + job
  API-->>Maya: 202, strip "Queued"
  Worker->>DB: status running, step 0 checkpoint
  Worker->>Prov: generate(instructions, permitted case context)
  Prov-->>Worker: tool_calls [intelligence.search, evidence.get SRC-030]
  Worker->>GW: intelligence.search (tenant, Maya's access, licence, schema, budget)
  GW->>DB: tool_call ok, 3 documents
  Worker->>GW: evidence.get SRC-030
  GW->>DB: tool_call denied, not summarised
  Worker->>DB: step 1 checkpoint (tool results stored by id and hash)
  Note over Worker,Prov: Worker restarts here
  Worker->>DB: resume from last_checkpoint_seq 1 (no tool re-execution)
  Worker->>Prov: generate(context plus stored tool results)
  Prov-->>Worker: final SkillOutput
  Worker->>Worker: validate schema, check cited ids were returned in this run
  Worker->>DB: proposals (claims, feasibility questions) status proposed, run completed
  Maya->>API: POST /me/proposals/:id/decision {accept, edited text}
  API->>DB: claim origin ai_edited accepted_by Maya, proposal edited_and_accepted
```

**Narrative.** Runs are asynchronous, bounded (5 minutes, 40 tool calls, token and cost caps) and act
with the requesting human's access, never more. Every step is checkpointed; a restart resumes from the last
checkpoint and reuses stored tool results. Restricted sources are denied by the gateway and never reach
the provider; the trace says "denied · not summarised". Output must validate against `SkillOutput`; a claim
citing an id that was not returned in this run is downgraded to Unknown. Proposals never overwrite human
edits; accepting writes the business record with provenance. **State changes:** run queued → running →
completed (or waiting_for_input, partial, failed, cancelled; partial/failed → queued on resume).
**Events:** none of the PRD §17 business events; run cost, time and errors are recorded separately
(`agent_run.usage`). **Failure paths:** provider error or missing fixture → failed with "Stopped — your work
is saved"; malformed output → one repair attempt then failed; budget exhausted → partial; injected
instructions in evidence → treated as data, no write tools exist; AI disabled → every screen still works
manually; the agent can never sign a review or decide a gate (database refuses agent identities).

---

### WF-10 — Evidence challenge and restricted-source handling

```mermaid
sequenceDiagram
  autonumber
  actor Maya as Maya Rao
  actor Jonas as Jonas Klein
  participant Web
  participant API
  participant Policy
  participant Domain
  participant DB
  Maya->>API: GET /evidence/sources/SRC-014
  API->>Policy: entitlement(site-census licence, Maya) is excerpt
  API-->>Web: metadata, permitted excerpt (2 sentences max), quoted fact vs inferred claim vs assumption, impact (accessible cases)
  Jonas->>API: GET /evidence/sources/SRC-030
  API->>Policy: entitlement(vendor-estimate licence, Jonas) is none
  API-->>Web: restricted banner, no excerpt, summary or paraphrase, "Open in licensed tool"
  Jonas->>API: GET /me/cases/ME-104/sizing/cohorts/:id/population
  API->>Policy: site list aggregate_only for pilot_owner
  API-->>Web: "Aggregates are shown under policy. Site list restricted." (no IDs)
  Maya->>API: POST /evidence/sources/SRC-021/challenges {statement}
  API->>DB: challenge open, audit, analytics evidence_reviewed
  Maya->>API: POST /evidence/sources/SRC-021/stale {reason}
  API->>Domain: materiality(source_superseded_or_deleted) is uncertain
  API->>DB: source freshness stale, snapshots pinning it stale (escalated to sponsor)
  Maya->>API: POST /evidence/sources/SRC-009/replace {SRC-014}
  API->>DB: drafts re-linked, approved snapshots keep SRC-009, SRC-009 superseded
  Note over API,DB: Provider deletes SRC-011, metadata and fingerprint kept, impact "Sizing v1 only"
```

**Narrative.** Every read of source content checks the licence entitlement for the viewer: `excerpt`
shows permitted passages only; `aggregate_only` shows aggregates without identifying rows or counts that
reveal hidden data; `none` shows a restricted banner with no excerpt, summary or paraphrase anywhere —
including search results, exports, generated text and agent context. The S13 side panel separates quoted
fact, inferred claim (AI draft accepted by a human) and human assumption. Challenges are tracked to
resolution. Marking stale or replacing a source runs materiality: drafts re-link, approved snapshots keep
the original source, and pinned snapshots go stale pending the sponsor's classification. Deleted sources
keep provenance and impact under the retention policy. **State changes:** source freshness current →
stale / superseded; availability available → deleted_by_provider; challenge open → resolved.
**Events:** `evidence_reviewed`. **Failure paths:** request for a source in a case the viewer cannot see →
404 (no existence leak); impact lists only accessible cases ("Cases you cannot access are not listed or
counted"); upload with a duplicate hash links to the existing source; ingestion failure → "ingestion
failed" status, never fabricated content.
