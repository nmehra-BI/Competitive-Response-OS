import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '@growth-os/contracts';
import { csvCell, dependsOnLabel, summarize, summaryText, tasksCsv, toolLabel } from './text';

const rows = (...s: [SyncStatus, string | null][]) =>
  s.map(([status, lastErrorCode]) => ({ status, lastErrorCode }));

describe('summaryText (honest sync)', () => {
  it('partial success names the failure reason', () => {
    const r = rows(
      ['confirmed', null],
      ['failed', 'permission_denied'],
      ['confirmed', null],
      ['confirmed', null],
      ['confirmed', null],
      ['confirmed', null],
    );
    expect(summaryText(r, 'Jira')).toBe('5 of 6 tasks confirmed in Jira · 1 failed (permission)');
    expect(summarize(r)).toEqual({ total: 6, confirmed: 5, failed: 1, pending: 0, paused: 0 });
  });

  it('lists every group and never calls anything synced without keys', () => {
    expect(
      summaryText(
        rows(
          ['sending', null],
          ['checking', 'timeout'],
          ['paused_approval_changed', null],
          ['paused_connector', null],
          ['failed', 'permission_denied'],
          ['failed', 'http_5xx'],
          ['not_sent', null],
        ),
        'Jira',
      ),
    ).toBe(
      '0 of 7 tasks confirmed in Jira · 2 failed · 1 sending · 1 checking · 1 paused — approval changed · 1 paused — connection expired · 1 not sent',
    );
    expect(summaryText(rows(['in_preview', null], ['not_sent', null]), 'Jira')).toBe(
      '2 tasks not sent to Jira',
    );
    expect(summaryText(rows(['confirmed', null]), 'Jira')).toBe('1 of 1 task confirmed in Jira');
    expect(summaryText([], 'Jira')).toBe('No tasks');
  });

  it('labels', () => {
    expect(toolLabel('jira_simulated', 'Jira · projects PIL')).toBe('Jira');
    expect(toolLabel('asana', 'Asana')).toBe('Asana');
    expect(dependsOnLabel([])).toBe('—');
    expect(dependsOnLabel([1])).toBe('Task 1');
    expect(dependsOnLabel([5, 4])).toBe('Tasks 4, 5');
  });
});

describe('CSV export', () => {
  it('quotes per RFC 4180 and neutralises spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell(null)).toBe('');
  });

  it('writes one row per task with labels, key and reference', () => {
    const csv = tasksCsv([
      {
        ordinal: 1,
        title: 'Confirm 4 pilot sites and contacts',
        milestone: 'M1 · Kick-off · weeks 1–2',
        function: 'sales',
        owner: 'Jonas Klein',
        assignee: 'jonas.klein@aster.example',
        dueOn: '2026-12-04',
        dueRule: null,
        deliverable: 'Signed site list',
        dependsOn: '',
        conditionKey: null,
        status: 'not_started',
        syncStatus: 'confirmed',
        externalKey: 'PIL-11',
        reference: 'a'.repeat(64),
      },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(
      `Task 1,Confirm 4 pilot sites and contacts,M1 · Kick-off · weeks 1–2,sales,Jonas Klein,jonas.klein@aster.example,2026-12-04,,Signed site list,,,Not started,Confirmed,PIL-11,${'a'.repeat(64)}`,
    );
    expect(lines).toHaveLength(3); // header, row, trailing newline
  });
});
