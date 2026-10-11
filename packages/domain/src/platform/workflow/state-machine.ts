/**
 * Generic, deterministic state machine runtime (EXECUTION_PLAN §4.4 pattern).
 *
 * A machine is a frozen transition table plus named guards. `apply` is pure: it returns the new
 * state, the analytics events to emit, the audit action and the next required action, or a typed
 * rejection that lists EVERY failed guard as a business reason. The caller (an API command handler
 * or a worker job) writes the state change, audit event, analytics event and outbox rows in ONE
 * transaction. Agents never call `apply`; only validated commands from an authorized identity do.
 */
import { AnalyticsEventName, type DomainEventType, type ErrorCode } from '@growth-os/contracts';

export type Actor =
  | { kind: 'human'; userId: string; interactive: boolean }
  | { kind: 'service'; userId: string }
  | { kind: 'agent'; userId: string }
  | { kind: 'system'; reason: 'timer' | 'gate_decision' | 'material_change' | 'worker' };

export interface Transition<S extends string, C extends string> {
  from: S | readonly S[] | '*active*';
  command: C;
  /** 'held_from_stage' resumes an on-hold case; 'unchanged' records an event without a state change. */
  to: S | 'held_from_stage' | 'unchanged';
  /** Who may issue it. `system` transitions are only triggered by other domain events. */
  by: 'human' | 'system';
  /** Guard keys evaluated in order. All must pass. Names are part of the frozen contract. */
  guards: readonly string[];
  /** Analytics events (PRD §17) emitted on success. */
  emits?: readonly string[];
  note?: string;
}

/** Error codes a transition can be rejected with (subset of the frozen ErrorCode). */
export type TransitionErrorCode = Extract<
  ErrorCode,
  | 'INVALID_TRANSITION'
  | 'PRECONDITIONS_UNMET'
  | 'FORBIDDEN'
  | 'AGENT_IDENTITY_FORBIDDEN'
  | 'AUTHORITY_INSUFFICIENT'
  | 'SELF_APPROVAL_PROHIBITED'
  | 'CONFLICT_OF_INTEREST'
  | 'SNAPSHOT_STALE'
  | 'SNAPSHOT_HASH_MISMATCH'
  | 'APPROVAL_INVALIDATED'
  | 'APPROVAL_EXPIRED'
  | 'CONNECTOR_UNAVAILABLE'
  | 'BUDGET_EXHAUSTED'
>;

export interface GuardResult {
  ok: boolean;
  key: string;
  /** Business copy for the "Why?" list. Set on failure. */
  message?: string;
  /** Error code when this guard fails. Defaults to PRECONDITIONS_UNMET. */
  code?: TransitionErrorCode;
}

/** Who has to act next, and what they do (drives "Next decision" and empty states). */
export type NextActionOwner =
  'case_owner' | 'sponsor' | 'approver' | 'pilot_owner' | 'reviewer' | 'requester' | 'system';

export interface NextAction {
  key: string;
  label: string;
  /** null when the next step is to fix a failed guard (whoever can fix it). */
  owner: NextActionOwner | null;
}

export type ApplyResult<S extends string, C extends string = string> =
  | {
      ok: true;
      machine: string;
      command: C;
      from: S;
      to: S;
      /** false for 'unchanged' transitions (e.g. experiment amendment). */
      changed: boolean;
      /** Analytics events (PRD §17) to emit in the same transaction. */
      events: readonly AnalyticsEventName[];
      /** Audit `action`, e.g. "gate_request.approve". */
      auditAction: string;
      /** Domain event type to write (feeds projections and workers), when the machine declares one. */
      domainEvent: DomainEventType | null;
      /** What happens next in the new state. */
      nextAction: NextAction | null;
      /** Every guard that was evaluated (all passed). */
      guards: readonly GuardResult[];
    }
  | {
      ok: false;
      machine: string;
      command: C;
      from: S;
      code: TransitionErrorCode;
      /** Every failed guard, in table order (not only the first). */
      failed: GuardResult[];
      /** Business copy for each failure, same order as `failed`. */
      reasons: string[];
      /** First thing to fix. */
      nextAction: NextAction | null;
    };

export interface CommandEvaluation<C extends string> {
  command: C;
  enabled: boolean;
  code: TransitionErrorCode | null;
  reasons: string[];
}

export interface StateMachine<S extends string, C extends string, Ctx> {
  readonly name: string;
  readonly transitions: readonly Transition<S, C>[];
  /** Commands available from a state for an actor (drives which buttons render enabled). */
  available(state: S, actor: Actor, ctx: Ctx): C[];
  /** Every command defined from a state, enabled or not, with reasons (drives disabled buttons). */
  evaluate(state: S, actor: Actor, ctx: Ctx): CommandEvaluation<C>[];
  /** Pure decision via table lookup + guard registry. */
  apply(state: S, command: C, actor: Actor, ctx: Ctx): ApplyResult<S, C>;
  /** Commands the table defines from a state, regardless of actor or guards. */
  commandsFrom(state: S): C[];
  /** The next required action while in a state. */
  nextActionFor(state: S): NextAction | null;
}

/** Guard implementations are registered by key; unknown keys fail closed. */
export type GuardFn<Ctx> = (ctx: Ctx, actor: Actor) => GuardResult;
export type GuardRegistry<Ctx> = Readonly<Record<string, GuardFn<Ctx>>>;

export interface MachineOptions<S extends string, C extends string, Ctx> {
  /** States that '*active*' expands to. */
  activeStates?: readonly S[];
  /** Resolves 'held_from_stage' (the stage stored when the case went on hold). */
  resolveHeldFrom?: (ctx: Ctx) => S | null;
  /** Next required action per state. */
  nextActions?: Partial<Record<S, NextAction>>;
  /** Domain event to write for a successful command. */
  domainEvent?: (command: C, from: S, to: S) => DomainEventType | null;
  /** Prefix for the audit action. Defaults to the machine name. */
  auditActionPrefix?: string;
}

const ANALYTICS_NAMES = new Set<string>(AnalyticsEventName.options);

function fromMatches<S extends string>(from: Transition<S, string>['from'], state: S, active: readonly S[]) {
  if (from === '*active*') return active.includes(state);
  if (typeof from === 'string') return from === state;
  return (from as readonly S[]).includes(state);
}

function actorCheck(t: Transition<string, string>, actor: Actor): GuardResult | null {
  if (actor.kind === 'agent') {
    return {
      ok: false,
      key: 'actor_kind',
      code: 'AGENT_IDENTITY_FORBIDDEN',
      message: 'Only a person can take this action. The analysis assistant makes proposals only.',
    };
  }
  if (t.by === 'system') {
    if (actor.kind === 'system') return null;
    return {
      ok: false,
      key: 'actor_kind',
      code: 'FORBIDDEN',
      message: 'This change is made by the system after a recorded decision or change, not directly.',
    };
  }
  // human transition
  if (actor.kind === 'system') {
    return {
      ok: false,
      key: 'actor_kind',
      code: 'FORBIDDEN',
      message: 'This action needs a person; the system cannot take it.',
    };
  }
  if (actor.kind === 'service' || !actor.interactive) {
    return {
      ok: false,
      key: 'actor_kind',
      code: 'AGENT_IDENTITY_FORBIDDEN',
      message: 'This action needs your own signed-in session.',
    };
  }
  return null;
}

/** Table-driven machine factory. */
export function createStateMachine<S extends string, C extends string, Ctx>(
  name: string,
  transitions: readonly Transition<S, C>[],
  guards: GuardRegistry<Ctx>,
  options: MachineOptions<S, C, Ctx> = {},
): StateMachine<S, C, Ctx> {
  for (const t of transitions) {
    for (const e of t.emits ?? []) {
      if (!ANALYTICS_NAMES.has(e)) throw new Error(`${name}: unknown analytics event "${e}" on ${t.command}`);
    }
  }
  const active = options.activeStates ?? [];
  const prefix = options.auditActionPrefix ?? name;

  const find = (state: S, command: C) =>
    transitions.find((t) => t.command === command && fromMatches(t.from, state, active));

  const runGuard = (key: string, ctx: Ctx, actor: Actor): GuardResult => {
    const fn = Object.prototype.hasOwnProperty.call(guards, key) ? guards[key] : undefined;
    if (!fn) return { ok: false, key, message: `Check "${key}" is not available, so this is blocked.` };
    try {
      const r = fn(ctx, actor);
      return { ...r, key };
    } catch {
      return { ok: false, key, message: `Check "${key}" could not be completed, so this is blocked.` };
    }
  };

  const reject = (
    state: S,
    command: C,
    code: TransitionErrorCode,
    failed: GuardResult[],
  ): ApplyResult<S, C> => {
    const reasons = failed.map((f) => f.message ?? f.key);
    const first = failed[0];
    return {
      ok: false,
      machine: name,
      command,
      from: state,
      code,
      failed,
      reasons,
      nextAction: first ? { key: first.key, label: first.message ?? first.key, owner: null } : null,
    };
  };

  const apply = (state: S, command: C, actor: Actor, ctx: Ctx): ApplyResult<S, C> => {
    const t = find(state, command);
    if (!t) {
      return reject(state, command, 'INVALID_TRANSITION', [
        {
          ok: false,
          key: 'transition_exists',
          code: 'INVALID_TRANSITION',
          message: `"${command}" is not possible from "${state}".`,
        },
      ]);
    }
    const actorFailure = actorCheck(t, actor);
    if (actorFailure) return reject(state, command, actorFailure.code ?? 'FORBIDDEN', [actorFailure]);

    const results = t.guards.map((g) => runGuard(g, ctx, actor));
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      return reject(state, command, failed[0]?.code ?? 'PRECONDITIONS_UNMET', failed);
    }

    let to: S;
    if (t.to === 'unchanged') to = state;
    else if (t.to === 'held_from_stage') {
      const held = options.resolveHeldFrom?.(ctx) ?? null;
      if (!held) {
        return reject(state, command, 'INVALID_TRANSITION', [
          {
            ok: false,
            key: 'held_from_stage_known',
            code: 'INVALID_TRANSITION',
            message: 'The stage to resume is not recorded.',
          },
        ]);
      }
      to = held;
    } else to = t.to;

    return {
      ok: true,
      machine: name,
      command,
      from: state,
      to,
      changed: to !== state,
      events: (t.emits ?? []) as readonly AnalyticsEventName[],
      auditAction: `${prefix}.${command}`,
      domainEvent: options.domainEvent?.(command, state, to) ?? null,
      nextAction: options.nextActions?.[to] ?? null,
      guards: results,
    };
  };

  const commandsFrom = (state: S): C[] => {
    const seen: C[] = [];
    for (const t of transitions) {
      if (fromMatches(t.from, state, active) && !seen.includes(t.command)) seen.push(t.command);
    }
    return seen;
  };

  const evaluate = (state: S, actor: Actor, ctx: Ctx): CommandEvaluation<C>[] =>
    commandsFrom(state).map((command) => {
      const r = apply(state, command, actor, ctx);
      return r.ok
        ? { command, enabled: true, code: null, reasons: [] }
        : { command, enabled: false, code: r.code, reasons: r.reasons };
    });

  return {
    name,
    transitions,
    apply,
    evaluate,
    commandsFrom,
    available: (state, actor, ctx) =>
      evaluate(state, actor, ctx)
        .filter((e) => e.enabled)
        .map((e) => e.command),
    nextActionFor: (state) => options.nextActions?.[state] ?? null,
  };
}
