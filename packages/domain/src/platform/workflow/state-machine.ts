/**
 * Generic, deterministic state machine contract (EXECUTION_PLAN §4.4 pattern).
 *
 * A machine is a frozen transition table plus named guards. `apply` is pure: it returns the new
 * state and the events to write, or a typed rejection. The caller (an API command handler) writes
 * the state change, audit event, analytics event and outbox rows in ONE transaction.
 * Agents never call `apply`; only validated commands from an authorized identity do.
 */

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

export interface GuardResult {
  ok: boolean;
  key: string;
  message?: string;
}

export type ApplyResult<S extends string> =
  | { ok: true; from: S; to: S; events: readonly string[] }
  | {
      ok: false;
      code: 'INVALID_TRANSITION' | 'PRECONDITIONS_UNMET' | 'FORBIDDEN' | 'AGENT_IDENTITY_FORBIDDEN';
      failed: GuardResult[];
    };

export interface StateMachine<S extends string, C extends string, Ctx> {
  readonly name: string;
  readonly transitions: readonly Transition<S, C>[];
  /** Commands available from a state for an actor (drives which buttons render). */
  available(state: S, actor: Actor, ctx: Ctx): C[];
  /** Pure decision. TODO(WS3): implement via table lookup + guard registry. */
  apply(state: S, command: C, actor: Actor, ctx: Ctx): ApplyResult<S>;
}

/** Guard implementations are registered by key; unknown keys fail closed. */
export type GuardFn<Ctx> = (ctx: Ctx, actor: Actor) => GuardResult;
export type GuardRegistry<Ctx> = Readonly<Record<string, GuardFn<Ctx>>>;

/**
 * Table-driven machine factory. TODO(WS3 workflow/authz): implement `available` and `apply`.
 * Rules: unknown command → INVALID_TRANSITION; agent actor on a human transition →
 * AGENT_IDENTITY_FORBIDDEN; human without interactive session → AGENT_IDENTITY_FORBIDDEN;
 * any failed guard → PRECONDITIONS_UNMET with every failed guard listed (not only the first).
 */
export function createStateMachine<S extends string, C extends string, Ctx>(
  name: string,
  transitions: readonly Transition<S, C>[],
  _guards: GuardRegistry<Ctx>,
): StateMachine<S, C, Ctx> {
  return {
    name,
    transitions,
    available: () => {
      throw new Error(`TODO(WS3): ${name}.available`);
    },
    apply: () => {
      throw new Error(`TODO(WS3): ${name}.apply`);
    },
  };
}
