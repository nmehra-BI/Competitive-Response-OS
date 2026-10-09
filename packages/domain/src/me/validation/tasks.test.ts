import { describe, expect, it } from 'vitest';
import { draftValidationTasks } from './tasks';

const plan = {
  sampleSize: 20,
  windowStart: '2026-10-19',
  windowEnd: '2026-11-13',
  metrics: [
    { name: 'Completed discovery interviews', thresholdText: '≥ 8', unit: 'interviews' },
    { name: 'Paid pilot commitments', thresholdText: '≥ 4', unit: 'commitments' },
  ],
};

describe('draftValidationTasks (D-090, PQ-13 interim)', () => {
  it('drafts EXP-03 as five tasks with owners and due dates from the plan', () => {
    const tasks = draftValidationTasks(plan, { ownerUserId: 'maya', fieldworkOwnerUserId: 'jonas' });
    expect(tasks.map((t) => [t.ordinal, t.title, t.ownerUserId, t.dueOn])).toEqual([
      [1, 'Select 20 sites for the sample', 'maya', '2026-10-19'],
      [2, 'Brief fieldwork on the method and outreach script', 'jonas', '2026-10-20'],
      [3, 'Completed discovery interviews (target 8)', 'jonas', '2026-11-13'],
      [4, 'Paid pilot commitments (target 4)', 'jonas', '2026-11-13'],
      [5, 'Record results and nonresponse', 'maya', '2026-11-13'],
    ]);
  });

  it('falls back to the experiment owner without a fieldwork owner and never dates past the window', () => {
    const tasks = draftValidationTasks(
      { ...plan, sampleSize: null, windowEnd: '2026-10-19', metrics: [] },
      { ownerUserId: 'maya', fieldworkOwnerUserId: null },
    );
    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.title).toBe('Select the sample');
    expect(tasks.every((t) => t.ownerUserId === 'maya' && t.dueOn <= '2026-10-19')).toBe(true);
  });
});
