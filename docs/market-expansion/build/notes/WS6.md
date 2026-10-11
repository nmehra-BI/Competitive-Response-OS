# WS6 — Connector and outbox · build notes

Branch `worktree-agent-ac26949b0da76c23a`, based on the integrated Wave 1 head `ca95231`.
Scope: WAVE3 §6. That covers the simulated task connector, the transactional outbox worker
(dispatch, reconcile, sweep), the 7 task-sync and dev endpoints, and the connector fault suite.
It covers acceptance steps 12 and 22–24 and their variants.

## What was built

| Area | Files |
|---|---|
| Simulated connector (D-020) | `packages/connectors/src/simulated/{simulated-connector,faults,memory-store,pg-store}.ts`, `factory.ts` |
| Outbox jobs (D-021) | `apps/worker/src/jobs/outbox/{dispatch,sweep,facts,policy,index}.ts`, registered in `apps/worker/src/tasks.ts` |
| Task-sync API | `apps/api/src/modules/tasksync/{index,store,text,dev}.ts`, registered in `apps/api/src/modules/index.ts` |
| Tests | `packages/connectors/src/simulated/simulated-connector.test.ts`, `apps/worker/src/jobs/outbox/policy.test.ts`, `apps/api/src/modules/tasksync/{text.test,tasksync.db.test}.ts`, `apps/api/test/connector-faults/*.test.ts` (+ `support.ts`) |

### Usage for other streams

```ts
// Any API code that needs a TaskConnector (preview only; the API never creates tasks):
import { createConnectorFactory } from '@growth-os/connectors';
const connector = createConnectorFactory({ sim: ctx.deps.db })({ id: conn.id, provider: conn.provider });

// Worker (already registered): createOutboxTasks(db) → outbox.dispatch | outbox.reconcile | outbox.sweep
// Tests: processOutboxMessage(deps, tenantId, messageId) and sweepOutbox(deps, { tenantIds })
// from apps/worker/src/jobs/outbox, with deps = { db: workerDb, connectors, backoffMs: () => 0 }.
```

### Endpoints

| Id | Who | Notes |
|---|---|---|
| `taskSync.get` | case readers (404 otherwise) | Per-task `sync` from `external_task_link`. `summaryText` reads like "5 of 6 tasks confirmed in Jira · 1 failed (permission)". |
| `taskSync.preview` | `task_sync.preview` (pilot owner), 403 otherwise | Dry run through `connector.preview`. Needs an effective approval (machine `preview` guard). Stores `task_sync_preview` (TTL 30 min, sha256 of the canonical content) and moves the links to `in_preview`. |
| `taskSync.send` | `task_sync.send`, human only | `syncMachine.enqueue`. Guards: preview current (id + hash + recomputed content hash), approval effective, blocking conditions met, owners set. Then the plan must be current. Writes one link + one outbox row per task in one transaction and enqueues `outbox.dispatch` (`jobKey outbox:<id>`). Answers 202. |
| `taskSync.retry` | `task_sync.send`, human only | `syncMachine.manual_retry` for failed links only, with the same keys. Rebuilds the payload from the current mapping (the "fix mapping" path) but keeps the original project. 409 `INVALID_TRANSITION` when nothing has failed. 503 `CONNECTOR_UNAVAILABLE` while the connection is expired. |
| `taskSync.exportCsv` | `task_sync.preview` or `task.update` | `text/csv` with an attachment filename and one row per task. Each row includes a "Reference" column holding the idempotency key, and formula injection is neutralised. Works during an outage. |
| `dev.setConnectorFaults` / `dev.simulatedIssues` | any human in an **illustrative** tenant, own connection only (404 for others) | Registered only when `AUTH_MODE=dev` (server rule). An empty rule list "reconnects" an expired token in the simulator. |

## Decisions

1. **Three-step dispatch: claim, then call, then record.**
   - *Context:* A worker can die between the remote write and recording it (D-020, D-021).
   - *Decision:* There are three separate transactions.
     - The first locks the row and re-checks authorization. It then sets the row to `sending` with a lease (`locked_until`) and increments `attempts`.
     - The connector call runs outside any transaction.
     - A last transaction records the outcome through `syncMachine` (system actor `worker`), with audit and analytics.
   - *Alternatives:* Calling the connector inside the transaction (holds locks for the remote latency, and a crash after the commit point is still ambiguous).
   - *Consequences:* A crash leaves `sending` with an expired lease, and the sweep recovers it.
2. **Reconcile before every re-send, not only after timeouts.**
   - *Decision:* The worker searches by idempotency key before creating whenever `attempts > 0` or the row is `checking`.
   - *Alternatives:* Reconcile only after `timeout_ambiguous`.
   - *Consequences:* A 5xx that actually created the issue, a crash, a manual retry or a resume never duplicates. It costs one extra search per retry.
3. **Crash recovery in the sweep.**
   - *Context:* `claim_outbox_batch` claims only `pending`/`checking` rows.
   - *Decision:* Per tenant, the sweep first moves `sending` rows with an expired lease to `checking` (`send_timeout`, audit "Checking (worker restarted mid-send)"). Then it claims due rows across tenants and processes each with `claimed: true`.
   - *Consequences:* Leases protect in-flight rows from enqueued jobs and other sweeps. Default lease 60 s.
4. **Send-time re-check order.**
   - *Order:* connection (→ `pause_connector`), then approval effectiveness and plan current (→ `pause_approval_changed` with code `approval_invalidated` / `approval_expired` / `plan_changed`), then sender still authorized (→ `failed`, retryable, code `actor_not_authorized`).
   - *Reconcile:* Reconcile needs only a usable connection. A search writes nothing, and it must be allowed to show a write that already happened.
   - *Approval effectiveness:* Read from `gate_request.status`, `approval`, `approval_invalidation` and `expires_at`. An approval past its expiry that was never used counts as expired even before `timers.approval_expiry` runs (fail closed). "Used" uses the timer's definition.
   - *Sender check:* The sender check is "still holds an unrevoked role whose `ROLE_ACTIONS` include `task_sync.send` in the case's scope".
5. **An executed write is always recorded.**
   - *Context:* `applyMateriality` pauses links that are still `sending` while their outbox row is in flight.
   - *Decision:* If the tool returned a key, the worker writes Confirmed even when the row was paused or reclaimed meanwhile. The machine is applied as `sending → send_ok` (`external_key_returned` guard).
   - *Consequences:* "Sent preserved" holds under the race. Never-rule 9 still holds (a key is required). See CR-WS6-1.
6. **Paused ambiguous writes are searched once.**
   - *Context:* Materiality also pauses `checking` rows, so the issue may already exist.
   - *Decision:* The sweep searches each such row once (`reconcilePausedWrite`). If found, the row becomes Confirmed and preserved. If not, the outbox `last_error.code` is set to `paused_checked` so the row is not searched again.
7. **Resume after reconnect.**
   - *Context:* `admin.reconnect` deliberately does not resume (WS1).
   - *Decision:* The sweep resumes `paused_connector` rows once the connection is `connected` and the approval and plan still hold (`resume` → `retry_scheduled`). It keeps `attempts`, so the dispatcher reconciles first, and it raises `max_attempts`.
   - *Consequences:* `paused_approval_changed` rows never resume. A new approval means a new task set.
8. **Expired token is connection-level.**
   - *Decision:* The connection is set to `expired` (audit `connection.status_changed`). All `pending`/`checking` rows for it and the current row pause (`paused_connector`). Internal tasks are untouched.
   - *Consequences:* Preview reports `connectionStatus: 'expired'` with a blocker. Retry answers 503 until reconnected. CSV export always works.
9. **Simulator semantics.**
   - *Storage:* The simulator stores everything in `sim.*` and runs on the pool (autocommit), never inside the caller's business transaction, because it plays a remote system.
   - *Idempotent create:* `createTask` returns the existing issue for a key it has already seen. The UNIQUE index is the last line of defence.
   - *Fault rules:* `token_expired` is sticky and connection-level for every operation until the rules are replaced. The other modes apply to `create` only and consume `remaining`. `nthCall` counts create calls from `sim.call_log`.
   - *Keys:* Keys are `<last segment of project>-n` (`ME-VAL` → `VAL-1`), from `sim.project_counter`.
   - *Membership:* There is no project-membership table, so projects are open. Permission failures are injected with `permission_denied` rules (e.g. matched on the assignee).
   - *Package dependency:* `@growth-os/db` depends on `@growth-os/connectors`, so the Postgres store takes a Kysely executor (raw compiled queries). `kysely` was added to the connectors package.
10. **Stable keys.**
    - *Decision:* The key is `externalTaskIdempotencyKey(tenant, planVersion, task, connection, project)`, computed once at preview or send time. It is stored on the link and reused forever (retry, resume, reconcile).
    - *Plan version:* For a pilot set the plan version is the owning pilot plan version. For an experiment set it is the experiment's pre-registered (original) plan version, which matches the seed.
    - *Consequences:* Amendments do not change keys.
11. **Preview binds the send.**
    - *Decision:* The send needs the preview id, the exact `contentHash`, a preview that has not expired, and an unchanged recomputed content hash for the previewed tasks (title, owner, assignee, due date, deliverable, milestone, key).
    - *Consequences:* A change after preview gives `PRECONDITIONS_UNMET` ("The plan changed or the preview expired. Preview again.").
12. **Concurrency.**
    - *Decision:* Send and retry lock the `task_set` row `FOR UPDATE` before reading the links. A concurrent click waits, then finds nothing left to do (409 `INVALID_TRANSITION`). Same-key double clicks replay through the pipeline. Racing workers are stopped by the claim's status and lease checks.
    - *Consequences:* The fault suite asserts all three layers.
13. **Copy.**
    - *Decision:* `summaryText` is "`<confirmed> of <total> tasks confirmed in <tool>`" plus one clause per non-zero group: failed with a reason when all failures share one, sending, checking, paused — approval changed, paused — connection expired, and not sent. "6 tasks not sent to Jira" appears before anything is sent.
    - *Consequences:* "Synced" never appears. `lastErrorCode` values follow the contract comment (`permission_denied`, `timeout`, `token_expired`, `http_5xx`), plus `rate_limited`, `validation`, `unavailable`, `attempts_exhausted` and the re-check codes.
14. **Backoff.**
    - *Decision:* 30 s × 2^(attempts−1), capped at 15 min, and never sooner than Retry-After. At most 5 attempts per send. A manual retry or resume grants 5 more.
    - *Consequences:* The dispatcher enqueues `outbox.dispatch` at `next_attempt_at`, and the sweep catches anything missed.

## Workflow updates (WF-07)

- **Implemented:** the simulator, preview → send → dispatch → confirm / fail / checking → reconcile, retry of failed tasks only, expired-token pause with CSV fallback and resume, crash recovery, pause on invalidation, expiry, plan change and sender revocation, and the 7 endpoints.
- **Flow changes:**
  - The preview creates the `external_task_link` rows (`in_preview`) with their stable key, so the key exists before the first send.
  - Retry rebuilds the payload from the current mapping, which is how "fix mapping → retry" works. The key and project are unchanged.
- **New failure paths:**
  - `actor_not_authorized`: the sender lost the role. The task fails and stays retryable by an authorized person.
  - `plan_changed`: the pilot plan version was replaced. Unsent tasks pause.
  - A row paused while Checking is searched once, and shown Confirmed if the issue exists.
  - `attempts_exhausted` after 5 transient failures.
- **Narrative mismatch:** the fixture shows task 2 becoming `PIL-12` after the retry. With honest sequential keys the retried task gets the next free key (`PIL-17` when the project counter starts at 11). The tests assert `PIL-n` and exactly 6 issues, not specific numbers. The product copy is unaffected.

## WS4b → WS6 hand-off (conventions relied on)

- `pilot.activate` must create or lock the `platform.task_set` with:
  - `owner_type 'pilot_plan_version'`
  - `owner_id` = the activated, committed plan version
  - `authorizing_gate_request_id` = G2
  - `connection_id` and `mapping_id` (purpose `pilot_tasks`)
- It must also set `me.pilot_plan.current_version_id` to that version. WS6 treats "plan current" as `pilot_plan.current_version_id = task_set.owner_id`.
- Conditions decided with the gate must exist in `platform.condition` (`blocks_execution`). Open blocking conditions refuse send and retry.
- A scope change that commits a new plan version will pause unsent rows twice over: materiality (G2 invalidated) and the worker's `plan_changed` check.
- Outbox rows written by WS6 carry `authorization_ref = { gateRequestId, approvalId, snapshotHash, planVersionId, previewId }`, `aggregate_type 'external_task_link'` and `aggregate_id` = link id.
- The fault suite does not import WS4b code. `apps/api/test/connector-faults/support.ts` builds the activated state directly:
  - G2 v3 approved by Elena through the real approval guard, with her own interactive session and grant
  - C1/C2 recorded, with C1 met
  - plan version committed and current
  - case `pilot_running`

## Change requests

- **CR-WS6-1 (sync machine, additive):** Allow `send_ok` (and `reconcile_found`) from `paused_approval_changed` and `paused_connector`.
  - *Reason:* A write that was in flight or ambiguous when the pause landed must be recordable as Confirmed (decisions 5 and 6).
  - *Workaround:* The worker currently applies the machine from `sending`.
- **CR-WS6-2 (sync machine, additive):** Add a system transition `sending → failed` for "sender no longer authorized", or name it.
  - *Reason:* The worker uses `send_failed_permanent` with code `actor_not_authorized`, and a named command would make the audit clearer.
- **CR-WS6-3 (timer alignment, WS3/PE):**
  - *Problem:* `timers.approval_expiry` pauses outbox rows only when `pending`, and links only in `not_sent/in_preview/retry_scheduled`. A queued task whose link is `sending` keeps showing "Sending…".
  - *Workaround:* The sweep's `alignPausedLinks` corrects this within a minute.
  - *Proposed fix:* Pause `sending` links whose outbox row was paused in the same statement, as `applyMateriality` does.
- **CR-WS6-4 (optional, migration):** Add a `sim.project_member` table.
  - *Reason:* `preview` could then report "assignee … is not a member of project PIL" before sending.
  - *Today:* That only surfaces at send time through an injected `permission_denied` rule.
- **CR-WS6-5 (shared helper, PE):**
  - *Problem:* The request-time approval-effectiveness query exists twice: `apps/api/src/modules/tasksync/store.ts#loadGateContext` and `apps/worker/src/jobs/outbox/facts.ts#loadGateFacts`. This is because apps cannot import each other.
  - *Proposal:* A shared `packages/db` helper (`approvalEffectivenessFor(tx, gateRequestId, now)`) would remove the duplication.

## Out-of-scope edits

- `apps/worker/src/schedule.test.ts`: the exact task-list expectation now includes `outbox.dispatch`, `outbox.reconcile` and `outbox.sweep`, and asserts that `outbox.sweep` is scheduled. The test was extended, not weakened.
- `pnpm-lock.yaml`: regenerated by `pnpm install` after adding `kysely` to `@growth-os/connectors`.
- `vitest.config.ts`: one include line for `apps/api/test/connector-faults/**/*.test.ts` (allowed by WAVE3 §2.7).
- Test files under `apps/api` import worker code by relative path (`../../../worker/src/jobs/outbox`) to drive the real dispatcher. There is no runtime dependency between the apps.

## Status

- **Done, all green on `growth_os_ws6`:**
  - `pnpm typecheck`, `pnpm lint`, `pnpm format:check`
  - `pnpm test`: 30 files, 1906 tests
  - `pnpm db:migrate`
  - `pnpm test:db`: 18 files, 150 tests, including the 7 WS6 files with 35 tests
- **Acceptance coverage:**
  - Step 12: `tasksync.db.test.ts` (preview text, Sending… with no key, VAL-1…VAL-5 only after the worker).
  - Steps 22–23: `connector-faults/partial.test.ts` ("5 of 6 tasks confirmed in Jira · 1 failed (permission)", fix mapping, retry, 6 of 6, exactly 6 issues, same keys).
  - Step 24: `connector-faults/timeout.test.ts` (Checking → reconcile → Confirmed, one create and one search).
- **Variants:**
  - `expired-token.test.ts`: pause, CSV, 503 on retry, reconnect and resume.
  - `crash.test.ts`: lease, sweep recovery, no duplicate.
  - `concurrent-retry.test.ts`: same-key and different-key clicks, racing workers, double send.
  - `invalidated.test.ts`: material change via the real `applyMateriality`; invalidation and expiry caught at send time; paused-while-Checking search; plan replaced; sender revoked; stale preview, open C1 or inactive plan refused.
  - The 5xx, rate-limit and exhausted-attempts paths are in `timeout.test.ts`.
- **Known gaps:**
  - No live `health()` probe from `admin.testConnection` (WS1 owns it; the connector's `health()` is ready).
  - No purge of old previews.
  - Analytics for preview and send do not exist in PRD §17, so only audit is recorded for them.
  - The S11 screen (WS8) still has to switch from MSW to these endpoints.
