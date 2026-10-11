import { describe, expect, it } from 'vitest';
import { CRONTAB, JOBS } from './jobs/catalog';
import { nextOccurrence, periodicItems } from './drain';

const item = (task: string) => periodicItems(Object.values(JOBS), CRONTAB).find((i) => i.task === task)!;

describe('nextOccurrence (drain-driven periodic jobs, D-162)', () => {
  it('rounds up to the next whole minute for an every-minute task', () => {
    expect(nextOccurrence(item(JOBS.outboxSweep), new Date('2026-10-11T10:00:20Z'))?.toISOString()).toBe(
      '2026-10-11T10:01:00.000Z',
    );
  });

  it('keeps an exact match', () => {
    expect(nextOccurrence(item(JOBS.outboxSweep), new Date('2026-10-11T10:05:00Z'))?.toISOString()).toBe(
      '2026-10-11T10:05:00.000Z',
    );
  });

  it('finds the next quarter hour and the next daily slot in UTC', () => {
    expect(
      nextOccurrence(item(JOBS.timersApprovalExpiry), new Date('2026-10-11T10:01:00Z'))?.toISOString(),
    ).toBe('2026-10-11T10:15:00.000Z');
    expect(
      nextOccurrence(item(JOBS.timersLicenseExpiry), new Date('2026-10-11T03:00:00Z'))?.toISOString(),
    ).toBe('2026-10-12T02:15:00.000Z');
  });

  it('schedules only registered tasks', () => {
    expect(periodicItems([JOBS.outboxSweep]).map((i) => i.task)).toEqual([JOBS.outboxSweep]);
  });
});
