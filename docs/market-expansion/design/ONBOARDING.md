# Market Expansion OS — First-run onboarding: live guide and explainer

**Status:** Accepted for build (decisions.md D-190 … D-199) · **Date:** 11 October 2026 · **Owner:** Principal UX
**Inputs:** [PRD](../PRD.md) §2 (personas), §6 (Aster story), §7 (IA); [UX research](./UX_RESEARCH.md) §7 (labels,
status grammars), §8.2 (role landing), §10 (tokens, type, motion); [FRONTEND](../architecture/FRONTEND.md) §1, §8;
`artifacts.md` (journey map, WF-12).
**Code:** `apps/web/src/onboarding/**` (guide, coach marks, welcome, explainer player),
`packages/domain/src/platform/onboarding/guide.ts` (role paths, step catalogue, state rules),
`packages/contracts/src/api/onboarding.ts` (CR-ONB-1), `apps/api/src/modules/platform/onboarding/`,
`packages/db/migrations/0008_onboarding.sql`.

Claims are tagged **[S]** (sourced, link given) or **[H]** (hypothesis to test in research §11). No statistics are
quoted: the vendor statistics found during research could not be traced to primary sources, so none are used.

---

## 1. Research summary

| # | Finding | Tag | Implication for us |
|---|---|---|---|
| R1 | Up-front tutorials interrupt people, do not reliably improve task performance and are quickly forgotten; help shown in context, when the user signals a need ("pull revelation"), avoids those costs. ([NN/g, Onboarding tutorials vs contextual help](https://www.nngroup.com/articles/onboarding-tutorials/)) | [S] | No forced multi-step tour. The explainer is opt-in from a welcome dialog; coach marks appear only when the user asks "Show me". |
| R2 | Coach marks are dismissed quickly and read superficially; keep them short, one at a time, visually distinct from the UI. ([NN/g, Instructional overlays and coach marks](https://www.nngroup.com/articles/mobile-instructional-overlay/)) | [S] | One coach mark at a time, ≤ 2 sentences, a distinct surface with a pointer; never a stack of hotspots. |
| R3 | Empty states are a teaching surface: system status, a learning cue and a direct path to the first task. ([NN/g, Empty states in complex applications](https://www.nngroup.com/articles/empty-state-interface-design/)) | [S] | `GuideEmptyState` block: "what this place is for", "what to do next" and one link, using the user's actual next step. |
| R4 | Linear points new users to a demo workspace, a video walkthrough and live sessions rather than an in-product tour; teardowns describe a near tour-free, learn-by-doing first run with the command menu introduced early. ([Linear Start Guide](https://linear.app/docs/start-guide); [Candu teardown](https://www.candu.ai/blog/linear-onboarding-teardown); [Supademo](https://supademo.com/user-flow-examples/linear)) | [S] | Our illustrative Aster workspace plays the "demo workspace" role; ⌘K reaches the guide ("Guide"); the video is separate and short. |
| R5 | Notion's Getting Started is a working checklist of hands-on tasks, not a slideshow. ([Appcues GoodUX on Notion](https://goodux.appcues.com/blog/notions-lightweight-onboarding); [Notion help](https://www.notion.com/help/guides/first-steps-introduce-notion-teammate)) | [S] | The checklist items are real tasks in the real workspace; progress comes from real state. |
| R6 | Attio shows an in-product onboarding checklist and a help drawer with shortcuts; a reviewer criticised that core features came late in the list. ([Userpilot review](https://userpilot.com/blog/wp-json/wp/v2/posts/17312); [Attio Academy](https://attio.com/help/academy/attio-for-product-led-growth/onboarding-your-team)) | [S] | Put each role's core job first (Elena: the decision waiting, not settings). Keep the guide in a drawer the user opens. |
| R7 | Stripe separates a go-live checklist from day-to-day use and keeps a test environment. ([Stripe account checklist](https://docs.stripe.com/checklist); [Stripe account set-up](https://docs.stripe.com/get-started/account/set-up)) | [S] | Admin path is a short configuration checklist, separate from business roles; "Reset onboarding" exists only in the illustrative (demo) workspace. |
| R8 | Onboarding vendors recommend role-segmented paths (admins configure, end users do daily work) and judging onboarding by activation, not by completion rates. ([Appcues](https://appcues.com/blog/customer-onboarding-checklist); [Pendo whitepaper](https://go.pendo.io/rs/185-LQW-370/images/Pendo_Whitepaper_2020_OnboardingForProductAndCustomerSuccess_2020.pdf)) | [S] (vendor sources) | Five role paths; success measured by "first real step done", not "tour watched" (§9). |
| R9 | APG: a modal dialog has `role="dialog"`, `aria-modal="true"`, a name, traps focus, closes on Escape and returns focus to the trigger; a tooltip never takes focus — content with controls belongs in a non-modal dialog. ([APG dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/); [APG tooltip](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)) | [S] | Welcome and explainer: modal dialog. Coach mark: **non-modal dialog** (it has buttons), not `role="tooltip"`. |
| R10 | WCAG 2.2.2 Pause, Stop, Hide: moving content that starts automatically and lasts > 5 s needs a pause/stop/hide mechanism. ([WCAG 2.2.2 summary](https://tabnav.com/academy/wcag/success-criterion-2.2.2)); honouring `prefers-reduced-motion` should be checked at run time, and is a complement to, not a substitute for, a pause control. ([Hidde de Vries](https://hidde.blog/meeting-2-22-pause-stop-hide-with-prefers-reduced-motion/)) | [S] | The explainer never starts on its own; it has pause; with reduced motion it renders a still storyboard. |
| R11 | Chrome allows muted autoplay; sound needs a user gesture; best practice is an explicit play control. ([Chrome autoplay policy](https://developer.chrome.com/blog/autoplay)) | [S] | Captions-only (no audio track) and a "Play the 90-second tour" button: nothing autoplays before a click. |
| R12 | Enterprise approvers with little time learn best from the real item waiting for them, not from a generic tour. | [H] | Elena's guide leads with "You have a G2 decision waiting" from her real inbox. Test with the §11 script. |
| R13 | A short motion explainer of the *model* (kinds, ladder, gates) reduces the most expensive misreadings (summing measures, assuming approval is automatic). | [H] | Test comprehension quiz items H5/H6 of research §11 with and without the explainer. |

## 2. Principles

1. **Calm and opt-in.** One welcome dialog on the first sign-in, then nothing appears unasked. The guide lives in a
   drawer opened from the top bar ("Guide · 2 of 5") or ⌘K → "Guide".
2. **Never in the way.** No coach mark or panel covers a required action; the guide never disables, pre-fills or
   triggers anything. Skip and Escape work everywhere. Closing the welcome dialog lands the user exactly where they
   would have landed.
3. **State, not clicks.** A step is done when the workspace says so (an opportunity is Shortlisted, the viewer
   submitted G2, one of the viewer's tasks is "Confirmed · PIL-11"). Only "find your way" steps (open Reviews, read a
   package) complete by visiting the place.
4. **Honest copy.** The guide uses research §7.4 vocabulary. It never calls AI output a fact, never implies an
   approval happens by itself, never says "Synced" (only "Confirmed · KEY"), never totals measures.
5. **No leaks.** The guide derives progress only from the viewer's own records and from views the viewer can already
   read (`reviews.inbox`, `work.mine`). It never shows a count or name of anything hidden.
6. **Server is the truth.** First-run state is stored per user on the server (it follows people across devices) and
   every change goes through the command pipeline with an audit event.

## 3. Role paths

Path selection follows research §8.2 landing order (first matching role wins): sponsor / investment committee →
**Decide**; case owner → **Build**; pilot owner → **Run**; finance, product, specialist, commercial, read-only reviewer
→ **Review**; tenant admin → **Configure**. (Daniel is a finance reviewer; Jonas holds pilot owner first.)

| Path | Persona | Steps (in order) | Done when (derivation) |
|---|---|---|---|
| **Build** (operator) | Maya Rao | 1 Shortlist an opportunity · 2 Open your expansion case · 3 Size the market · 4 Plan validation · 5 Submit G2 for a decision | 1 an opportunity in a mandate the viewer owns (or converted into a case the viewer owns) is Shortlisted or Converted · 2 the viewer owns a case · 3 a committed sizing version on a case the viewer owns · 4 an experiment on a case the viewer owns · 5 a G2 request on a case the viewer owns has been submitted |
| **Decide** (sponsor) | Elena Fischer, committee members | 1 Open Reviews · 2 Read the decision package · 3 Decide within your authority | 1 visited `/reviews` · 2 visited a Decisions tab or a decision brief · 3 the viewer recorded a decision (an `approval` row with the viewer as approver, any disposition) |
| **Run** (pilot owner) | Jonas Klein | 1 Open My Work · 2 Review the pilot plan · 3 Check what reached Jira · 4 Record actuals | 1 visited `/my-work` · 2 visited a Pilot tab · 3 one of the viewer's tasks is Confirmed with an external key · 4 the viewer recorded an outcome observation |
| **Review** (reviewers) | Daniel Weber, Priya Shah, Lena Hoffmann | 1 Open your review requests · 2 Respond with a reason · 3 Read a decision brief | 1 visited `/reviews` · 2 a review request addressed to the viewer has a response · 3 visited a decision brief or Decisions tab |
| **Configure** (admin) | Tenant administrator | 1 Check connections · 2 Check authority coverage · 3 Review policies | 1 visited `/admin/connections` · 2 visited `/admin/authority` · 3 visited `/admin/policies` |

The **next** line at the top of the guide follows real state, in this order: a gate decision waiting for the viewer
("You have a G2 decision waiting · Approve pilot €120k · 90 days · ME-104", from `reviews.inbox`, which only lists what
the viewer may decide) → an open review request for the viewer → the first incomplete step → "You're set up".
The text always says the person decides: "Nothing is approved until you choose an action and give a rationale."

## 4. Components

### 4.1 Welcome dialog (first sign-in only)
Modal dialog (`role="dialog"`, `aria-modal`, named by its heading, focus on the primary button, Escape = "Skip for
now", focus returns to the page). Content: "Welcome to Market Expansion, {first name}", one sentence on the expansion
case, the role line ("You decide pilot and scale investments within your authority."), an "Illustrative data" note,
and three actions: **Play the 90-second tour** (primary) · **Show me around** (opens the guide) · **Skip for now**.
Any action records `welcomeSeen`. It shows only when the server says `welcomeSeen = false`, so a second sign-in (any
device) never shows it again.

### 4.2 "Getting started" guide (drawer)
A non-modal complementary panel on the right (360 px, research §10.2 panel width), opened by the top-bar **Guide**
button (`aria-expanded`, `aria-controls`, progress "2 of 5" in text) or ⌘K "Guide". Contents: path name, progress
meter (text + bar), the **Next** card, the ordered checklist (each item: status glyph + text "Complete"/"To do" — "Done" is reserved for tasks, research §7.2 rule 4; title,
one-line why, "Show me" button and a link), **Play the tour again**, **Skip guide** / **Resume guide**, and, in the
illustrative workspace only, **Reset onboarding (demo)**. Escape closes and returns focus to the Guide button.
Resumable: it reopens where the user left off because the state is on the server.

### 4.3 Coach marks
Non-modal dialog (`role="dialog"`, `aria-modal="false"`) anchored to a real element. Each step lists anchors from most
to least specific: an existing screen landmark (`[aria-label="Opportunity candidates"]`, the case tab
`nav[aria-label="Case sections"] a[href*="/sizing"]`, `[aria-label="Approval panel"]`, …), then the page heading
`#main h1`, then a `data-guide="nav-…"` hook on the shell navigation. The search starts only once the page the step
names is on screen, accepts only visible elements, and gives each less specific anchor 0.7 s more, so a loading screen
does not make it settle for the navigation. One at a time; title + ≤ 2 sentences; **Next** (the next incomplete step,
following real state), **Close for now** / **Got it**, close (×). Focus moves to its heading when it opens and returns
to the anchor (or the Guide button) on close; Escape closes. If no anchor appears within 3 s it docks under the top
bar with a "Go to it" link — it never points at nothing. It never covers its anchor (placed below/above with a 12 px
gap, flips to stay in the viewport) and has no backdrop, so the page stays usable. The anchor gets a focus-ring
outline while the mark is open. Dismissed coach marks are stored (`coachMarksDismissed`).

### 4.4 Teaching empty state
`GuideEmptyState` renders "What this place is for · What to do next" with the viewer's real next step and a link. It
is offered to screens as a component; this stage mounts it in the guide panel's "all done / nothing waiting" state.
Screen streams may adopt it for their empty states (FRONTEND §3 "teaching empty states").

### 4.5 Replay and skip
User menu: **Replay the tour** · **Open the guide**. Guide: **Play the tour again**, **Skip guide** (hides the top-bar
progress, keeps a plain "Guide" button), **Resume guide**. Replaying never resets checklist progress.

### 4.6 Reset onboarding (demo only)
Visible only when the server says `canReset` (AUTH_MODE=dev, an illustrative tenant and, on a hosted runtime,
DEMO_MODE=1 — D-165). `POST /dev/onboarding/reset` clears the viewer's own row; audited.

## 5. Explainer — storyboard and script (84 s, 8 chapters, captions only)

Visual language: tokens only (no raw colours), Geist for UI text, Source Serif 4 for the chapter statements, Geist
Mono for keys and versions, semantic colours with glyph + text, ▼●▲ scenario shapes, gate diamonds of research §10.4,
kind line styles of research §7.1. Every frame carries **Illustrative data · Aster Industrial Systems (fictional)**.
Motion: 180–240 ms ease-out entrances, no parallax, no flashing, nothing faster than 3 changes per second.

| # | Chapter | Time | Frame | Caption (exact) |
|---|---|---|---|---|
| 1 | Scattered decisions | 0:00–0:09 | Four drifting cards: a slide deck "Germany_v7_final.pptx", a spreadsheet "SOM (2).xlsx", an email "Re: Re: approved?", a task list. Thin links between them break. | "Expansion decisions usually live in slides, spreadsheets, email threads and task tools." · "Numbers drift, approvals get lost, and no one can say exactly what was agreed." |
| 2 | One expansion case | 0:09–0:19 | The cards fly into one case card: `ME-104` · German food-processing plants — monitoring · stage pill · Owner Maya Rao · Sponsor Elena Fischer; the nine case tabs fade in below. | "Market Expansion keeps one expansion case per decision — here ME-104, German food-processing plants." · "Mandate, evidence, sizing, validation, approvals, pilot and outcome stay together, with an owner and a stage." |
| 3 | Four kinds of claim | 0:19–0:31 | Four tags appear in turn with their line styles: Evidence (solid) · Assumption · Daniel Weber (dashed) · Scenario · Base · Year 3 (dotted) · Actual · 1 Dec–28 Feb (2 px rule). Then "Assumption" gains an "AI draft" badge beside it. | "Every number says what kind of claim it is." · "Evidence is sourced. An assumption is a person's belief, with an owner. A scenario is calculated under named assumptions. An actual is measured." · "An AI draft stays a draft until a person accepts it." |
| 4 | The measure ladder | 0:31–0:43 | Site-count bars narrow: TAM 5,000 sites · €100m/year → SAM 2,000 unique sites · €40m/year → Reachable pool 500 unique sites → SOM · Scenario · Year 3 · 100 customers · €2.0m annual revenue. A row "TAM + SAM + pool + SOM = ?" is struck through with the chip "No total — different questions". Scenario line: ▼ €1.0m · ● €2.0m · ▲ €2.4m annual revenue. | "TAM: 5,000 sites, €100m/year. SAM: 2,000 unique sites, €40m/year." · "Reachable pool: 500 unique sites. SOM, a scenario for year 3: €2.0m annual revenue." · "Each rung answers a different question. They are never added up." |
| 5 | Gates G0–G3 | 0:43–0:56 | The gate rail: Mandate ◆G0 Discovery · Assessment ◆G1 Validation ◆G2 Pilot · Review ◆G3 Scale. G0, G1 fill (Approved); G2 half-fills (Awaiting decision). An approval card: Snapshot v3 · "Approve pilot €120k · 90 days" · "Authorizes: the 90-day pilot · Does not authorize: market entry or scale". Then the card shows "Stale — snapshot changed" and the button disables. | "Four gates: G0 scope, G1 validate, G2 pilot, G3 scale." · "A person with authority decides — for example "Approve pilot €120k · 90 days" — on the exact snapshot they read." · "If the case changes, the snapshot is stale and must be decided again. Nothing passes a gate on its own." |
| 6 | Pilot and task sync | 0:56–1:06 | Task rows: "Confirm 4 pilot sites and contacts" Sending… → Confirmed · PIL-11; "Install monitoring at 4 sites" Failed · Retry → Confirmed · PIL-17. A "Done" task next to the G3 diamond, which stays unchanged. | "An approved pilot becomes owned tasks sent to your task tool." · "A task shows "Confirmed · PIL-11" only after Jira returns the key. A failed task is retried without duplicates." · "Finishing tasks never passes a gate." |
| 7 | Outcomes | 1:06–1:16 | Actual vs threshold bars: Paid use and continuation 3 of 4 (threshold 4 of 4) — Not met; Deployment effort 22 hours per site (within 16) — Not met; Buyer fit Mixed — Inconclusive. Decision card "Revise and extend validation" · Extension €30k · 45 days. G3 diamond with bar: Blocked. | "At the review, actuals are compared with thresholds set before the pilot." · "A negative result is still a result. Here the decision is "Revise and extend validation", with its own cap: €30k · 45 days." · "G3 Scale stays blocked until its own preconditions are met." |
| 8 | Your role | 1:16–1:24 | The viewer's avatar and path name; three role steps; the call to action button. | Role line (below) · "Illustrative data: Aster Industrial Systems and its people are fictional." |

Role lines and calls to action (chapter 8):

| Path | Caption | Button |
|---|---|---|
| Build | "You build the case: shortlist, size, validate, then submit G2 for a decision." | Start with Opportunities |
| Decide | "You decide within your authority. Read the package, then choose a scoped action — nothing is approved until you do." | Open Reviews |
| Run | "You run the pilot: your tasks, the plan, and what reached Jira." | Open My Work |
| Review | "You review what you are asked to: confirm, dispute or abstain, always with a reason." | Open review requests |
| Configure | "You set up connections, roles and policies. Administrators configure; they never approve." | Open Administration |

All figures are the fixture's (fixtures/aster `expectedDisplay`, `pilotTasks`, `outcomeObservations`,
`expectedExtension`): €100m/year, €40m/year, 500 unique sites, €2.0m annual revenue, "Approve pilot €120k · 90 days",
PIL-11, PIL-17, 3 of 4, 22 hours per site, €30k · 45 days.

### 5.1 Player
In-app React + SVG motion graphics (no video dependency, D-193): the scene is a pure function of time, so pausing,
scrubbing and chapter jumps are exact and the MP4 is a recording of the same component. Controls: Play/Pause (Space
or K), previous/next chapter (← →), a chapter list (buttons, `aria-current`), a time slider (`input type=range`, value
text "0:31 of 1:24 · Chapter 4 of 8"), Captions on/off (on by default), Transcript (full text, always available),
Skip tour. There is no audio track, so there is no mute control; the player says "Captions only — no sound". With
`prefers-reduced-motion: reduce` (checked live) it shows the **storyboard**: each chapter's final frame as a still
with its captions, and the same chapter navigation.

## 6. State model

```
signed-in ──(welcomeSeen = false and no automation opt-out)──▶ Welcome
Welcome ──Play──▶ Explainer ──end──▶ explainer=completed ──▶ Guide closed (Next on the Guide button)
Welcome ──Show me around──▶ Guide open
Welcome ──Skip for now / Escape──▶ idle (welcomeSeen = true)
Explainer ──Skip tour / Escape──▶ explainer=skipped
Guide ──Show me──▶ Coach mark (anchored) ──Next──▶ next incomplete step's coach mark (navigates)
Coach mark ──Got it / × / Escape──▶ idle, focus to the anchor or the Guide button (coachMarksDismissed += key)
Guide ──Skip guide──▶ dismissed = true (Guide button without progress) ──Resume──▶ dismissed = false
any ──Replay the tour──▶ Explainer (progress kept)
demo ──Reset onboarding──▶ row deleted → Welcome on next load
```

Client-side machine: `apps/web/src/onboarding/machine.ts` (pure reducer, unit tested). Server state:
`platform.user_onboarding` (one row per tenant + user; RLS; human principals only; audited updates).

**Automation opt-out (D-196).** `localStorage["gos.onboarding.autostart"] = "off"` stops the welcome from opening by
itself in that browser; nothing else changes (Guide, replay, coach marks all work). Only automation sets it: the
Playwright fixture for every journey spec (onboarding specs opt back in with `onboardingAutostart: true`) and the
unit-test setup (the onboarding component tests clear it).

## 7. Accessibility (WCAG 2.2 AA)

- Dialog and non-modal dialog roles per APG (R9); every dialog has a visible heading as its name.
- Focus: welcome → primary button; explainer → Play/Pause; guide → its heading; coach mark → its heading; all restore
  focus on close. Escape closes the top-most layer only.
- The guide button exposes progress in text ("Guide, 2 of 5 done"); status changes ("Step done: Size the market")
  announce through one polite live region.
- Targets ≥ 24 px (2.5.8); focus visible with the token ring; coach marks never obscure the focused anchor (2.4.11).
- Motion: nothing moves before a click; pause always available (2.2.2); reduced motion → storyboard; coach-mark
  entrance is a 120 ms fade only, removed under reduced motion.
- Colour never alone: progress, step status and gate states carry text and glyphs.

## 8. Never-rule compliance

| Rule | How the guide and explainer comply |
|---|---|
| 1, 6, 7 | Copy says a person with authority decides; "Approve pilot €120k · 90 days" is shown as a scoped human action. The guide has no write path into the workflow and never completes a gate. |
| 2 | Explainer chapter 5 shows the snapshot-bound approval and the stale state. |
| 3, 4, 5 | Ladder chapter shows each rung separately and a struck "No total"; one-time money is not shown next to /year money. |
| 8 | Progress derives from the viewer's own rows and views they can already read; no hidden counts. |
| 9 | "Confirmed · PIL-11" appears only after the simulated key; the copy says the key comes from Jira. |
| 11 | "An AI draft stays a draft until a person accepts it." |
| 14 | No step asks the user to contact prospects. |
| 15 | `user_onboarding` has RLS (`FORCE`), app role `NOBYPASSRLS`, all access inside `withTenant()`. |

## 9. Measuring it (hypotheses)

[H] Primary: share of first-week users who complete their path's first state-derived step. Secondary: explainer
completed vs skipped, guide reopened, coach marks dismissed. These need PRD §17 analytics names; this stage records
audit only and proposes the events as CR-ONB-2 (D-197).

## 10. MP4 rendition

`market-expansion-tour-1440x900.mp4` (H.264, 1440×900, 88 s including a short hold on the welcome and the end card,
captions burned in as on screen, no audio) is a recording of the in-app player: Chromium (Playwright) on the mock-mode
app, captured with a CDP screencast, assembled with ffmpeg from the frame timestamps. It lives at
`design/market-expansion/onboarding/` (1.4 MB, under the 5 MB limit). Re-record after any scene change; the app's
player is the source of truth, the MP4 is for decks and email.

## 11. Test plan

Unit: domain guide rules (paths, derivation merge, next step, patch rules); web reducer; coach-mark focus and
Escape; reduced-motion storyboard; first-login trigger. DB/API: GET/PATCH/reset, audit, cross-tenant isolation,
unauthorized and agent refusals, database guard for non-human principals. E2E (mock and real stack, axe): fresh login
shows the welcome dialog; the tour plays and can be skipped; the checklist shows the role steps; coach marks anchor
to existing elements; a second login shows no dialog; replay works.
