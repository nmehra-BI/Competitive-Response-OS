# Market Expansion OS — Product decisions for the design-partner pilot

**Date:** 9 October 2026 · **Owner:** Head of Product Management · **Source of record:** `decisions.md` D-109 to D-121

All open product questions (PQ-1 to PQ-20) and the three policy and contract items are decided. This brief groups
the decisions by when they must land, lists the engineering work they create, and names the questions that still need
a customer, Finance or Legal. No decision relaxes a never-rule (`CLAUDE.md`): the agent never approves, recurring and
one-time money are never summed, missing is never zero, and approvals stay bound to the snapshot the approver read.
All Aster values are illustrative.

## Before the pilot

| Topic | Decision | Record |
|---|---|---|
| Approval ceilings | Default matrix per tenant, editable in S14. Sponsor: G1 up to €50k, G2 up to €150k, extension up to €50k (pilot plus extensions within the G2 ceiling). Committee: G1 €250k, G2 €1m, extension €250k, G3 €2m. Grants come from a Finance-signed delegation of authority. | D-109 |
| Expiry of unused approvals | G1 30 days, G2 30 days, extension 14 days; G0 and G3 never expire in the MVP. | D-109 |
| Extension rule (PQ-2) | Up to 25% of the parent pilot budget, up to 50% of its window, one per pilot, same or narrower scope. Aster X1: **€30k · 45 days** (1 Mar – 14 Apr 2027). Real tenants must state a cap. | D-110 |
| `[hours per site]` | Aster: 16 hours assumed, 22 actual (Not met). Real cases need a number and unit. | D-110 |
| G3 message (PQ-1) | All four unmet preconditions stay. | D-111 |
| New-case data entry (PQ-17) | Five minimal editors: S09 assumptions, S06 sizing, S08 economics drivers, S07 review requests, S11 pilot plan. No assisted import. This is the pilot entry criterion. | D-112 |
| Stop rules and milestones (PQ-12) | Milestones live in the pilot plan. Stop rules are pre-registered on the G2 request (trigger, consequence, owner). A tripped rule asks the sponsor to review; it never acts alone. | D-112 |
| Validation tasks (PQ-13) | S09 "Validation tasks · Draft": edit title, owner, due date, deliverable; add or remove unsent tasks. Thresholds change only by amendment. | D-113 |
| Missing actions (PQ-11) | Ship the S14 task mapping editor and the S11 "Record spend" form. | D-114 |
| Labels and narrative (PQ-4, 6, 15, 19) | "Pending · G2" / "Blocker · G3"; "G2 · Snapshot v2"; retried task takes the next free key; MD-21 v1 "returned to change the owner and confirm EUR". | D-118, D-119 |
| Confirmed as built (PQ-3, 8, 9) | 30% upside adoption (Aster only); Maya owns the restricted site list; ladder values hidden while a blocking check is open. | D-118, D-119 |
| Evidence rights | Fail closed: an unconfirmed licence allows metadata only (no excerpt, model context, embeddings or export). | D-120 |
| Task connector | Jira Cloud, OAuth 2.0 (3LO) as a dedicated integration account with Browse, Create and Assign in the mapped projects only. Idempotency key stored on the issue; reconcile before retry. CSV export as fallback. | D-121 |

## During the pilot

| Topic | Decision | Record |
|---|---|---|
| G3 committee (PQ-14) | Three seats: chair, finance, operations. 2 of 3 approvals on the same snapshot, finance seat required. Author, case owner and the case's finance reviewer are excluded. Aster adds synthetic committee members; no G3 grant is seeded, so the authority gap stays visible. | D-109 |
| G3 investment note (PQ-10) | The scale-budget blocker names "€400k one-time scale-entry investment", never next to a /year figure. | D-111 |
| Pilot measures (PQ-20) | Each threshold has a measure type (Demand, Delivery effort, Buyer fit, Spend, Other). G3 reads the Demand type. Before the partner's first G2. | D-115 |
| AI claims (PQ-16) | One "Accept as fact" when the proposal is unedited and every citation opens; otherwise draft first. | D-116 |
| SAM "Used by" (PQ-18) | Reachable pool stays entered; a ≤ SAM check appears in lineage. | D-117 |
| Register order (PQ-7) | Keep sensitivity, then weakest evidence; test hypothesis H9 in usability sessions. | D-119 |
| Live AI provider | Off per tenant until the signed addendum is recorded and a manual eval run passes. | D-120 |

## Post-pilot

- S02 "Suggested adjacent segments · AI draft" and S04 "Request normalization" (D-114).
- Sizing and economics v1 in History, if partners ask for version compare (D-118, PQ-5).
- A tenant-managed measure catalogue, once partners repeat measures (D-115).
- Jira Data Center and a licensed-intelligence API adapter, once a customer needs them and rights are confirmed (D-120, D-121).

## Engineering backlog

| # | Ticket | Size | Timing |
|---|---|---|---|
| 1 | Case data-entry editors: S06 sizing (M), S08 economics (M), S11 pilot plan with milestones (M), S09 add assumption (S), S07 request review (S) | L | Before pilot |
| 2 | Jira Cloud adapter: OAuth 3LO integration account, entity-property idempotency, reconcile search, sandbox fault suite | L | Before pilot |
| 3 | G3 committee quorum and approval policy defaults: required finance seat, approvals lapse on stale snapshot, X cumulative check, per-gate expiry, DoA reference on grants | M | Defaults before pilot; quorum during |
| 4 | Enforce the extension rule and real extension caps (share, duration, one per parent, scope subset; null cap refused in real tenants) | M | Before pilot |
| 5 | S09 validation task draft editor (additive draft-task endpoints) | M | Before pilot |
| 6 | Licence term end and on-expiry action; tenant "Live analysis" setting with document reference | M | Before pilot / during |
| 7 | Pre-registered stop rules on the G2 request | S | Before pilot |
| 8 | S14 task mapping editor (project, issue type, assignee map, material-change warning) | S | Before pilot |
| 9 | S11 "Record spend" form (append-only, reversing entries) | S | Before pilot |
| 10 | Aster policy values, committee personas and narrative copy (fixture CR) | S | Before pilot |
| 11 | Thesis blocker labels name the gate; gate + version snapshot labels | S | Before pilot |
| 12 | Outcome measure types (`measureType`) | S | During pilot |
| 13 | G3 blocker names the one-time scale investment | S | During pilot |
| 14 | One-step "Accept as fact" for cited AI claims | S | During pilot |
| 15 | Reachable pool upper-bound check and lineage edge | S | During pilot |

Contract and fixture changes go through the D-031 change-request process (CR-PD-1 to CR-PD-9 in `decisions.md`). All are additive.

## Questions that still need an external party

| To | Exact question | Pilot default until answered |
|---|---|---|
| Customer CFO office | Does your delegation of authority let the BU leader approve up to €50k for validation, €150k for a pilot and €50k for an extension, with a three-seat committee (chair, finance, operations; 2 of 3 including finance) for scale up to €2m? Who sits on each seat for the pilot BU? Is 30 days right for an unused pilot approval? | The D-109 matrix and expiry |
| Customer Finance lead | Can the BU sponsor approve one extension of up to 25% of an approved pilot budget and up to half its duration, inside the sponsor's pilot ceiling, or must every extension go to the committee? | Sponsor approves within the D-110 rule |
| Legal | Will our model provider sign a DPA with no training, zero (or ≤ 30-day abuse-only) retention, EU processing or SCCs, SOC 2 Type II or ISO 27001, and 72-hour breach notice? Who signs the customer addendum? | Fixture provider only; no live AI |
| Customer licence owner | For each intelligence source you will use, may we (a) store a copy in your tenant, (b) show excerpts of up to N sentences to licensed users, (c) index or embed it, (d) send excerpts to an AI provider under those terms, (e) include derived figures in exports? When does the licence end, and what must be deleted then? | Metadata only: no excerpt, model context, embeddings or export |
| Customer IT lead | Do you run Jira Cloud? Will your Jira admin install our OAuth app and create an integration account with Browse, Create and Assign in the pilot projects only? Which project keys and issue types should validation and pilot tasks use? | Simulated Jira in demo; CSV export for the partner until connected |

Still open from PRD §13 and outside this brief: hosting and data residency, SSO/SCIM, backups and restore objectives, and a penetration test. These need architecture and security decisions before production contracting.
