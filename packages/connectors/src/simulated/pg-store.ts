/**
 * Postgres SimStore over the `sim` schema (outside tenancy and RLS: it plays a remote system).
 *
 * Every statement runs on its own (autocommit) through the given executor — pass a pool, never a
 * business transaction: a remote write must not roll back with the caller. The UNIQUE index
 * (connection_id, idempotency_key) is the last line of defence against duplicates; concurrent
 * creates for one key resolve to the same issue.
 *
 * `@growth-os/db` depends on this package (seed keys), so the store takes a minimal Kysely-shaped
 * executor instead of importing the typed client.
 */
import { CompiledQuery } from 'kysely';
import type { ExternalTaskInput, ExternalTaskRef } from '../task-connector';
import {
  isStickyMode,
  issueKeyPrefix,
  parseMatch,
  ruleApplies,
  type SimFaultMatch,
  type StoredFaultRule,
} from './faults';
import { simIssueUrl, type SimFaultMode, type SimStore } from './simulated-connector';

/** Anything that can execute a compiled query: a `Kysely` instance (pool). */
export interface SimExecutor {
  executeQuery<R>(query: CompiledQuery<R>): Promise<{ rows: R[] }>;
}

async function q<R>(exec: SimExecutor, text: string, params: readonly unknown[] = []): Promise<R[]> {
  const r = await exec.executeQuery<R>(CompiledQuery.raw(text, [...params]));
  return r.rows;
}

export interface SimFaultRuleInput {
  mode: SimFaultMode;
  match: SimFaultMatch;
  times: number;
}

export interface SimIssueRow {
  key: string;
  project: string;
  title: string;
  idempotencyKey: string;
  assignee: string | null;
  createdAt: string;
}

/** SimStore plus the dev/test controls behind `PUT /dev/simulator/faults` and `GET /dev/simulator/issues`. */
export interface PgSimStore extends SimStore {
  /** Replace every fault rule of the connection (an empty list "reconnects" an expired token). */
  setFaultRules(connectionId: string, rules: readonly SimFaultRuleInput[]): Promise<SimFaultRuleInput[]>;
  listIssues(connectionId: string): Promise<SimIssueRow[]>;
}

export function createPgSimStore(exec: SimExecutor): PgSimStore {
  const findByKey = async (connectionId: string, idempotencyKey: string): Promise<ExternalTaskRef | null> => {
    const rows = await q<{ key: string }>(
      exec,
      'SELECT key FROM sim.external_issue WHERE connection_id = $1 AND idempotency_key = $2',
      [connectionId, idempotencyKey],
    );
    return rows[0] ? { key: rows[0].key, url: simIssueUrl(rows[0].key) } : null;
  };

  return {
    findByKey,

    async insertIssue(connectionId, input: ExternalTaskInput): Promise<ExternalTaskRef> {
      const prefix = issueKeyPrefix(input.project);
      const fields = JSON.stringify({
        issueType: input.issueType,
        dueOn: input.dueOn,
        labels: input.labels,
        caseKey: input.links.caseKey,
        gate: input.links.gateLabel,
      });
      for (let i = 0; i < 1000; i++) {
        const existing = await findByKey(connectionId, input.idempotencyKey);
        if (existing) return existing;
        const [counter] = await q<{ n: number }>(
          exec,
          `INSERT INTO sim.project_counter (connection_id, project, next_value) VALUES ($1, $2, 2)
           ON CONFLICT (connection_id, project)
             DO UPDATE SET next_value = sim.project_counter.next_value + 1
           RETURNING next_value - 1 AS n`,
          [connectionId, input.project],
        );
        const key = `${prefix}-${counter!.n}`;
        // DO NOTHING covers both a concurrent create for the same idempotency key and a key that is
        // already taken (counter behind existing issues): the loop then re-reads or allocates again.
        const inserted = await q<{ key: string }>(
          exec,
          `INSERT INTO sim.external_issue (connection_id, key, project, title, assignee, fields, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
           ON CONFLICT DO NOTHING RETURNING key`,
          [connectionId, key, input.project, input.title, input.assignee, fields, input.idempotencyKey],
        );
        if (inserted[0]) return { key: inserted[0].key, url: simIssueUrl(inserted[0].key) };
      }
      throw new Error('simulator: could not allocate an issue key');
    },

    async nextFault(connectionId, input, operation) {
      const rules = await q<{ id: string; mode: SimFaultMode; match: unknown; remaining: number }>(
        exec,
        `SELECT id, mode, match, remaining FROM sim.fault_rule
          WHERE connection_id = $1 ORDER BY created_at, id`,
        [connectionId],
      );
      if (rules.length === 0) return null;
      let index = 0;
      if (operation === 'create') {
        const [c] = await q<{ n: number }>(
          exec,
          `SELECT count(*)::int AS n FROM sim.call_log WHERE connection_id = $1 AND operation = 'create'`,
          [connectionId],
        );
        index = (c?.n ?? 0) + 1;
      }
      for (const row of rules) {
        const rule: StoredFaultRule = {
          id: row.id,
          mode: row.mode,
          match: parseMatch(row.match),
          remaining: row.remaining,
        };
        if (!ruleApplies(rule, input, operation, index)) continue;
        if (isStickyMode(rule.mode)) return rule.mode;
        const hit = await q<{ mode: SimFaultMode }>(
          exec,
          'UPDATE sim.fault_rule SET remaining = remaining - 1 WHERE id = $1 AND remaining > 0 RETURNING mode',
          [rule.id],
        );
        if (hit[0]) return hit[0].mode;
      }
      return null;
    },

    // The simulator has no membership table: projects are open. Permission failures are injected
    // with `permission_denied` rules (e.g. matched on the assignee), as a real project would refuse.
    async projectMembers() {
      return [];
    },

    async logCall(connectionId, operation, idempotencyKey, outcome) {
      await q(
        exec,
        'INSERT INTO sim.call_log (connection_id, operation, idempotency_key, outcome) VALUES ($1, $2, $3, $4)',
        [connectionId, operation, idempotencyKey, outcome.slice(0, 200)],
      );
    },

    async setFaultRules(connectionId, rules) {
      await q(exec, 'DELETE FROM sim.fault_rule WHERE connection_id = $1', [connectionId]);
      for (const r of rules)
        await q(
          exec,
          'INSERT INTO sim.fault_rule (connection_id, mode, match, remaining) VALUES ($1, $2, $3::jsonb, $4)',
          [connectionId, r.mode, JSON.stringify(r.match), r.times],
        );
      return rules.map((r) => ({ mode: r.mode, match: { ...r.match }, times: r.times }));
    },

    async listIssues(connectionId) {
      const rows = await q<{
        key: string;
        project: string;
        title: string;
        idempotency_key: string;
        assignee: string | null;
        created_at: Date | string;
      }>(
        exec,
        `SELECT key, project, title, idempotency_key, assignee, created_at FROM sim.external_issue
          WHERE connection_id = $1 ORDER BY created_at, key`,
        [connectionId],
      );
      return rows.map((r) => ({
        key: r.key,
        project: r.project,
        title: r.title,
        idempotencyKey: r.idempotency_key,
        assignee: r.assignee,
        createdAt: (r.created_at instanceof Date ? r.created_at : new Date(r.created_at)).toISOString(),
      }));
    },
  };
}
