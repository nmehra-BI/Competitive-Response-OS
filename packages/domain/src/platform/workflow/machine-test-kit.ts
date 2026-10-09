/**
 * Test kit: exhaustive transition checks for a table-driven machine. Used by the domain tests only.
 *
 * Given a hand-written list of every ALLOWED (from, command, to, by), it asserts that:
 *  - each allowed transition succeeds for the right actor kind and emits the table's events;
 *  - every other state × command pair is rejected with INVALID_TRANSITION;
 *  - each guard of each allowed transition, failing on its own, rejects the command and is listed;
 *  - agents never apply anything; people cannot fire system transitions and vice versa.
 */
import { describe, expect, it } from 'vitest';
import type { Actor, StateMachine } from './state-machine';

export type AllowedTransition<S extends string, C extends string> = readonly [
  from: S,
  command: C,
  to: S,
  by: 'human' | 'system',
];

export interface MachineSpec<S extends string, C extends string, F> {
  machine: StateMachine<S, C, F>;
  states: readonly S[];
  commands: readonly C[];
  allowed: readonly AllowedTransition<S, C>[];
  /** Facts under which every guard passes (the acting human is `KIT_USER`). */
  passFacts: F;
  /** Per guard key: the fact overrides that make only that guard fail. */
  failFacts: Readonly<Record<string, Partial<F>>>;
  /** Guards that can only fail through the actor (covered by the actor checks). */
  actorOnlyGuards?: readonly string[];
}

export const KIT_USER = 'u-actor';
export const KIT_HUMAN: Actor = { kind: 'human', userId: KIT_USER, interactive: true };
export const KIT_SYSTEM: Actor = { kind: 'system', reason: 'worker' };
const AGENT: Actor = { kind: 'agent', userId: 'agent' };
const SERVICE: Actor = { kind: 'service', userId: 'svc' };
const NON_INTERACTIVE: Actor = { kind: 'human', userId: KIT_USER, interactive: false };

export function describeMachine<S extends string, C extends string, F>(spec: MachineSpec<S, C, F>): void {
  const { machine, states, commands, allowed, passFacts, failFacts } = spec;
  const actorFor = (by: 'human' | 'system') => (by === 'human' ? KIT_HUMAN : KIT_SYSTEM);
  const key = (s: S, c: C) => `${s}|${c}`;
  const allowedMap = new Map(allowed.map((a) => [key(a[0], a[1]), a]));

  describe(`${machine.name}: every state × command`, () => {
    for (const s of states) {
      for (const c of commands) {
        const a = allowedMap.get(key(s, c));
        if (a) {
          it(`${s} --${c}--> ${a[2]} (${a[3]})`, () => {
            const r = machine.apply(s, c, actorFor(a[3]), passFacts);
            expect(r, JSON.stringify(r)).toMatchObject({ ok: true, from: s, to: a[2] });
            const t = machine.transitions.find(
              (x) =>
                x.command === c &&
                (x.from === s || (Array.isArray(x.from) && x.from.includes(s)) || x.from === '*active*'),
            );
            if (r.ok) expect([...r.events]).toEqual([...(t?.emits ?? [])]);
          });
        } else {
          it(`${s} --${c}--> forbidden`, () => {
            for (const actor of [KIT_HUMAN, KIT_SYSTEM]) {
              const r = machine.apply(s, c, actor, passFacts);
              expect(r).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
            }
          });
        }
      }
    }

    it('the table defines no transition outside the allowed list', () => {
      for (const s of states) {
        const fromTable = machine.commandsFrom(s).sort();
        const fromSpec = allowed
          .filter((a) => a[0] === s)
          .map((a) => a[1])
          .sort();
        expect(fromTable, s).toEqual(fromSpec);
      }
    });
  });

  describe(`${machine.name}: guards and actors on allowed transitions`, () => {
    for (const [s, c, , by] of allowed) {
      const t = machine.transitions.find(
        (x) =>
          x.command === c &&
          (x.from === s || (Array.isArray(x.from) && x.from.includes(s)) || x.from === '*active*'),
      );
      for (const g of t?.guards ?? []) {
        if (spec.actorOnlyGuards?.includes(g)) continue;
        it(`${s} --${c}: fails when ${g} fails`, () => {
          const override = failFacts[g];
          expect(override, `no failure fixture for guard ${g}`).toBeDefined();
          const r = machine.apply(s, c, actorFor(by), { ...passFacts, ...override });
          expect(r.ok).toBe(false);
          if (!r.ok) {
            expect(r.failed.map((f) => f.key)).toContain(g);
            expect(r.reasons.every((m) => m.length > 0)).toBe(true);
          }
        });
      }

      it(`${s} --${c}: agents never apply it`, () => {
        expect(machine.apply(s, c, AGENT, passFacts)).toMatchObject({
          ok: false,
          code: 'AGENT_IDENTITY_FORBIDDEN',
        });
      });

      if (by === 'human') {
        it(`${s} --${c}: needs an interactive person`, () => {
          expect(machine.apply(s, c, SERVICE, passFacts)).toMatchObject({
            ok: false,
            code: 'AGENT_IDENTITY_FORBIDDEN',
          });
          expect(machine.apply(s, c, NON_INTERACTIVE, passFacts)).toMatchObject({
            ok: false,
            code: 'AGENT_IDENTITY_FORBIDDEN',
          });
          expect(machine.apply(s, c, KIT_SYSTEM, passFacts)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
        });
      } else {
        it(`${s} --${c}: is never issued by a person`, () => {
          expect(machine.apply(s, c, KIT_HUMAN, passFacts)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
        });
      }
    }
  });
}
