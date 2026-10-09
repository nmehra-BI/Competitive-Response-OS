import { describe, expect, it } from 'vitest';
import { createStateMachine, type Actor, type GuardRegistry, type Transition } from './state-machine';

type S = 'a' | 'b' | 'c' | 'held' | 'parked';
type C = 'go' | 'auto' | 'note' | 'park' | 'unpark' | 'jump';
interface Ctx {
  okOne?: boolean;
  okTwo?: boolean;
  parkedFrom?: S | null;
}

const T: readonly Transition<S, C>[] = [
  { from: 'a', command: 'go', to: 'b', by: 'human', guards: ['one', 'two'], emits: ['gate_submitted'] },
  { from: 'b', command: 'auto', to: 'c', by: 'system', guards: [] },
  { from: ['a', 'b'], command: 'note', to: 'unchanged', by: 'human', guards: [] },
  { from: '*active*', command: 'park', to: 'parked', by: 'human', guards: [] },
  { from: 'parked', command: 'unpark', to: 'held_from_stage', by: 'human', guards: [] },
  { from: 'c', command: 'jump', to: 'a', by: 'human', guards: ['missing_guard'] },
];

const G: GuardRegistry<Ctx> = {
  one: (ctx) => ({ ok: ctx.okOne === true, key: 'one', message: 'One is missing', code: 'FORBIDDEN' }),
  two: (ctx) => ({ ok: ctx.okTwo === true, key: 'two', message: 'Two is missing' }),
};

const m = createStateMachine<S, C, Ctx>('toy', T, G, {
  activeStates: ['a', 'b', 'c'],
  resolveHeldFrom: (ctx) => ctx.parkedFrom ?? null,
  nextActions: { b: { key: 'wait', label: 'Waiting', owner: 'system' } },
  auditActionPrefix: 'toy',
});

const human: Actor = { kind: 'human', userId: 'u1', interactive: true };
const nonInteractive: Actor = { kind: 'human', userId: 'u1', interactive: false };
const agent: Actor = { kind: 'agent', userId: 'ag' };
const service: Actor = { kind: 'service', userId: 'svc' };
const system: Actor = { kind: 'system', reason: 'gate_decision' };

describe('createStateMachine runtime', () => {
  it('applies an allowed transition with events, audit action and next action', () => {
    const r = m.apply('a', 'go', human, { okOne: true, okTwo: true });
    expect(r).toMatchObject({
      ok: true,
      from: 'a',
      to: 'b',
      changed: true,
      events: ['gate_submitted'],
      auditAction: 'toy.go',
      nextAction: { key: 'wait' },
    });
  });

  it('rejects a command that is not defined from the current state', () => {
    const r = m.apply('c', 'go', human, {});
    expect(r).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('lists every failed guard, not only the first, and uses the first failure code', () => {
    const r = m.apply('a', 'go', human, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('FORBIDDEN');
    expect(r.failed.map((f) => f.key)).toEqual(['one', 'two']);
    expect(r.reasons).toEqual(['One is missing', 'Two is missing']);
    expect(r.nextAction).toMatchObject({ key: 'one', label: 'One is missing' });
  });

  it('defaults a failed guard without a code to PRECONDITIONS_UNMET', () => {
    const r = m.apply('a', 'go', human, { okOne: true });
    expect(r).toMatchObject({ ok: false, code: 'PRECONDITIONS_UNMET' });
  });

  it('unknown guard keys fail closed', () => {
    const r = m.apply('c', 'jump', human, {});
    expect(r).toMatchObject({ ok: false, code: 'PRECONDITIONS_UNMET' });
    if (!r.ok) expect(r.failed[0]?.key).toBe('missing_guard');
  });

  it('a guard that throws fails closed', () => {
    const throwing = createStateMachine<S, C, Ctx>('t', T, {
      ...G,
      one: () => {
        throw new Error('boom');
      },
    });
    const r = throwing.apply('a', 'go', human, { okTwo: true });
    expect(r.ok).toBe(false);
  });

  it('agents never apply any transition', () => {
    expect(m.apply('a', 'go', agent, { okOne: true, okTwo: true })).toMatchObject({
      ok: false,
      code: 'AGENT_IDENTITY_FORBIDDEN',
    });
    expect(m.apply('b', 'auto', agent, {})).toMatchObject({ ok: false, code: 'AGENT_IDENTITY_FORBIDDEN' });
  });

  it('service principals and non-interactive humans cannot take human transitions', () => {
    expect(m.apply('a', 'go', service, { okOne: true, okTwo: true })).toMatchObject({
      ok: false,
      code: 'AGENT_IDENTITY_FORBIDDEN',
    });
    expect(m.apply('a', 'go', nonInteractive, { okOne: true, okTwo: true })).toMatchObject({
      ok: false,
      code: 'AGENT_IDENTITY_FORBIDDEN',
    });
  });

  it('system transitions are refused to people and applied for system actors', () => {
    expect(m.apply('b', 'auto', human, {})).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(m.apply('b', 'auto', system, {})).toMatchObject({ ok: true, to: 'c' });
    expect(m.apply('a', 'go', system, { okOne: true, okTwo: true })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
  });

  it("'unchanged' records an event without a state change", () => {
    expect(m.apply('b', 'note', human, {})).toMatchObject({ ok: true, from: 'b', to: 'b', changed: false });
  });

  it("'*active*' expands to the active states", () => {
    expect(m.apply('c', 'park', human, {})).toMatchObject({ ok: true, to: 'parked' });
    expect(m.apply('parked', 'park', human, {})).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it("'held_from_stage' resumes to the stored stage, and fails closed when unknown", () => {
    expect(m.apply('parked', 'unpark', human, { parkedFrom: 'b' })).toMatchObject({ ok: true, to: 'b' });
    expect(m.apply('parked', 'unpark', human, {})).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('available lists only commands that would succeed; evaluate explains the rest', () => {
    expect(m.available('a', human, {}).sort()).toEqual(['note', 'park']);
    expect(m.available('a', human, { okOne: true, okTwo: true }).sort()).toEqual(['go', 'note', 'park']);
    const ev = m.evaluate('a', human, { okOne: true });
    const go = ev.find((e) => e.command === 'go');
    expect(go).toMatchObject({ enabled: false, code: 'PRECONDITIONS_UNMET', reasons: ['Two is missing'] });
  });

  it('refuses unknown analytics event names at construction', () => {
    expect(() =>
      createStateMachine<S, C, Ctx>(
        'bad',
        [{ from: 'a', command: 'go', to: 'b', by: 'human', guards: [], emits: ['not_an_event'] }],
        {},
      ),
    ).toThrow(/not_an_event/);
  });

  it('commandsFrom and states describe the table', () => {
    expect(m.commandsFrom('a').sort()).toEqual(['go', 'note', 'park']);
    expect(m.nextActionFor('b')).toMatchObject({ key: 'wait' });
    expect(m.nextActionFor('a')).toBeNull();
  });
});
