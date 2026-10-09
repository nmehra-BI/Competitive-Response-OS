import { describe, expect, it } from 'vitest';
import { parseCronItems } from 'graphile-worker';
import { CRONTAB, JOBS } from './jobs/catalog';
import { cronItemsFrom } from './schedule';

describe('cronItemsFrom', () => {
  it('turns the frozen crontab into cron items for registered tasks only', () => {
    const items = cronItemsFrom(CRONTAB, [JOBS.evidenceFreshness, JOBS.analyticsFlush]);
    expect(items).toEqual([
      { match: '30 3 * * *', task: 'evidence.freshness', identifier: 'evidence.freshness' },
      { match: '*/1 * * * *', task: 'analytics.flush', identifier: 'analytics.flush' },
    ]);
    // graphile-worker accepts dotted task names in structured items.
    expect(() => parseCronItems(items)).not.toThrow();
  });
});
