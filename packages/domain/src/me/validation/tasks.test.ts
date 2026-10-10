import { describe, expect, it } from 'vitest';
import { checkValidationTaskDraft, draftValidationTasks, isDraftTask, nextTaskOrdinal } from './tasks';

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

describe('validation task drafts (D-113, D-128)', () => {
  const window = { windowStart: '2026-10-19', windowEnd: '2026-11-13', ownerIsActivePerson: true };
  const ok = { title: 'Call 5 sites', ownerId: 'maya', dueOn: '2026-11-13', deliverable: 'Call notes' };

  it('only never-sent and previewed tasks are drafts', () => {
    expect(isDraftTask(undefined)).toBe(true);
    expect(isDraftTask('not_sent')).toBe(true);
    expect(isDraftTask('in_preview')).toBe(true);
    for (const s of [
      'sending',
      'confirmed',
      'failed',
      'checking',
      'retry_scheduled',
      'paused_approval_changed',
    ])
      expect(isDraftTask(s)).toBe(false);
  });

  it('accepts a task inside the window (inclusive) and without a due date', () => {
    expect(checkValidationTaskDraft(ok, window)).toEqual([]);
    expect(checkValidationTaskDraft({ ...ok, dueOn: '2026-10-19' }, window)).toEqual([]);
    expect(checkValidationTaskDraft({ ...ok, dueOn: null }, window)).toEqual([]);
  });

  it('refuses a due date outside the window, a blank title or deliverable and an unknown owner', () => {
    const problems = checkValidationTaskDraft(
      { ...ok, title: ' ', dueOn: '2026-11-14', deliverable: '' },
      { ...window, ownerIsActivePerson: false },
    );
    expect(problems.map((p) => p.field)).toEqual(['title', 'ownerId', 'dueOn', 'deliverable']);
    expect(problems[2]!.message).toBe(
      'The due date must be inside the experiment window (2026-10-19 to 2026-11-13).',
    );
    expect(checkValidationTaskDraft({ ...ok, dueOn: '2026-10-18' }, window)).toHaveLength(1);
  });

  it('an added task takes the next ordinal after every task, removed ones included', () => {
    expect(nextTaskOrdinal([1, 2, 3, 4, 5])).toBe(6);
    expect(nextTaskOrdinal([])).toBe(1);
    expect(nextTaskOrdinal([2, 7, 3])).toBe(8);
  });
});
