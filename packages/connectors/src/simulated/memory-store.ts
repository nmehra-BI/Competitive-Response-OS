/** In-memory SimStore for unit tests (same semantics as the Postgres store, no persistence). */
import type { ExternalTaskInput, ExternalTaskRef } from '../task-connector';
import {
  issueKeyPrefix,
  isStickyMode,
  ruleApplies,
  type SimFaultMatch,
  type StoredFaultRule,
} from './faults';
import { simIssueUrl, type SimFaultMode, type SimStore } from './simulated-connector';

export interface MemoryIssue {
  connectionId: string;
  key: string;
  project: string;
  title: string;
  assignee: string | null;
  idempotencyKey: string;
}

export interface MemorySimStore extends SimStore {
  issues: MemoryIssue[];
  calls: { connectionId: string; operation: string; idempotencyKey: string | null; outcome: string }[];
  addRule(connectionId: string, mode: SimFaultMode, match?: SimFaultMatch, times?: number): void;
  clearRules(connectionId: string): void;
  setMembers(connectionId: string, project: string, members: string[]): void;
}

export function createMemorySimStore(): MemorySimStore {
  const rules: (StoredFaultRule & { connectionId: string })[] = [];
  const counters = new Map<string, number>();
  const members = new Map<string, string[]>();
  const store: MemorySimStore = {
    issues: [],
    calls: [],
    addRule(connectionId, mode, match = {}, times = 1) {
      rules.push({ id: String(rules.length + 1), connectionId, mode, match, remaining: times });
    },
    clearRules(connectionId) {
      for (let i = rules.length - 1; i >= 0; i--)
        if (rules[i]!.connectionId === connectionId) rules.splice(i, 1);
    },
    setMembers(connectionId, project, list) {
      members.set(`${connectionId}|${project}`, list);
    },
    async findByKey(connectionId, idempotencyKey): Promise<ExternalTaskRef | null> {
      const i = store.issues.find(
        (x) => x.connectionId === connectionId && x.idempotencyKey === idempotencyKey,
      );
      return i ? { key: i.key, url: simIssueUrl(i.key) } : null;
    },
    async insertIssue(connectionId, input: ExternalTaskInput): Promise<ExternalTaskRef> {
      const existing = await store.findByKey(connectionId, input.idempotencyKey);
      if (existing) return existing;
      const counterKey = `${connectionId}|${input.project}`;
      const n = counters.get(counterKey) ?? 1;
      counters.set(counterKey, n + 1);
      const key = `${issueKeyPrefix(input.project)}-${n}`;
      store.issues.push({
        connectionId,
        key,
        project: input.project,
        title: input.title,
        assignee: input.assignee,
        idempotencyKey: input.idempotencyKey,
      });
      return { key, url: simIssueUrl(key) };
    },
    async nextFault(connectionId, input, operation) {
      const index =
        store.calls.filter((c) => c.connectionId === connectionId && c.operation === 'create').length + 1;
      for (const r of rules) {
        if (r.connectionId !== connectionId || !ruleApplies(r, input, operation, index)) continue;
        if (!isStickyMode(r.mode)) r.remaining -= 1;
        return r.mode;
      }
      return null;
    },
    async projectMembers(connectionId, project) {
      return members.get(`${connectionId}|${project}`) ?? [];
    },
    async logCall(connectionId, operation, idempotencyKey, outcome) {
      store.calls.push({ connectionId, operation, idempotencyKey, outcome });
    },
  };
  return store;
}
