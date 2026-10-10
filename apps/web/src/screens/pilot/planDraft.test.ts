import { describe, expect, it } from 'vitest';
import type { PilotPlanView } from '@growth-os/contracts';
import { newMilestone, newTask, parseOrdinals, patchFrom, problemsOf, rowsFrom } from './planDraft';

const M1 = '00000000-0000-4000-8000-000000000001';
const T1 = '00000000-0000-4000-8000-0000000000a1';
const T2 = '00000000-0000-4000-8000-0000000000a2';

const sync = { status: 'not_sent', attempts: 0 } as const;
const view = {
  draft: {
    milestones: [{ id: M1, name: 'M1 · Kick-off', windowText: 'weeks 1–2', ordinal: 1, dueOn: '2027-01-08' }],
  },
  taskSet: {
    tasks: [
      {
        id: T1,
        ordinal: 1,
        title: 'Confirm sites',
        milestoneId: M1,
        function: 'operations',
        owner: { id: 'u1' },
        dependsOnTaskIds: [],
        dueOn: null,
        dueRule: 'Weekly',
        deliverable: 'Site list',
        conditionKey: 'C1',
        budgetLine: null,
        sync,
      },
      {
        id: T2,
        ordinal: 2,
        title: 'Install',
        milestoneId: null,
        function: 'operations',
        owner: null,
        dependsOnTaskIds: [T1],
        dueOn: '2027-01-20',
        dueRule: null,
        deliverable: 'Installed',
        conditionKey: null,
        budgetLine: { amount: '8000.00', currency: 'EUR', note: 'Kits' },
        sync: { status: 'confirmed', attempts: 1 },
      },
    ],
  },
} as unknown as PilotPlanView;

describe('plan editor model', () => {
  it('reads rows from the view: milestone numbers, dependency numbers, budget lines, sent tasks locked', () => {
    const r = rowsFrom(view);
    expect(r.milestones[0]).toMatchObject({ id: M1, dueOn: '2027-01-08', evidenceExpected: '' });
    expect(r.tasks.map((t) => [t.milestone, t.dependsOn, t.budgetAmount, t.locked])).toEqual([
      [1, '', '', false],
      [0, '1', '8000.00', true],
    ]);
  });

  it('new rows reference each other by ordinal; a blank budget line is no line (never 0)', () => {
    const r = rowsFrom(view);
    r.milestones.push({ ...newMilestone(2), name: 'M2 · Run', dueOn: '2027-02-01', evidenceExpected: 'Log' });
    r.tasks[1]!.budgetAmount = '';
    r.tasks.push({
      ...newTask(),
      title: 'Renewal call',
      milestone: 2,
      dependsOn: '2, 1',
      deliverable: 'Intent',
      budgetAmount: '8,000',
    });
    const p = patchFrom(r, 'EUR');
    expect(p.milestones![1]).toEqual({
      id: null,
      name: 'M2 · Run',
      windowText: '',
      ordinal: 2,
      dueOn: '2027-02-01',
      evidenceExpected: 'Log',
    });
    expect(p.tasks![1]!.budgetLine).toBeNull();
    expect(p.tasks![2]).toMatchObject({
      id: null,
      milestoneId: null,
      milestoneOrdinal: 2,
      dependsOnTaskIds: [],
      dependsOnOrdinals: [2, 1],
      budgetLine: { amount: '8000.00', currency: 'EUR', note: null },
    });
    expect(p.tasks![0]).toMatchObject({
      milestoneId: M1,
      milestoneOrdinal: null,
      dueRule: 'Weekly',
      conditionKey: 'C1',
    });
  });

  it('flags missing titles, bad dependency lists, self-dependencies and unreadable amounts', () => {
    const r = rowsFrom(view);
    r.tasks.push({ ...newTask(), dependsOn: '3', budgetAmount: 'eight' });
    r.tasks[0]!.dependsOn = '4, x';
    expect(problemsOf(r).map((p) => p.field)).toEqual([
      't0.dependsOn',
      't2.title',
      't2.deliverable',
      't2.dependsOn',
      't2.budget',
    ]);
    expect(parseOrdinals(' 4,5 ')).toEqual([4, 5]);
    expect(parseOrdinals('0')).toBeNull();
  });
});
