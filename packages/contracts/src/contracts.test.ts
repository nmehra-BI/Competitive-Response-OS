import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENT_COUNT_GUARD,
  ENDPOINTS,
  AnalyticsEventName,
  AnalyticsProps,
  Money,
  toFingerprint,
} from './test-exports';

describe('API registry', () => {
  it('has unique operation ids', () => {
    const ids = ENDPOINTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique method + path pairs', () => {
    const keys = ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it('maps every endpoint to a screen and a PRD reference', () => {
    for (const e of ENDPOINTS) {
      expect(e.screens.length, e.id).toBeGreaterThan(0);
      expect(e.prd.length, e.id).toBeGreaterThan(0);
    }
  });

  it('requires an Idempotency-Key on every gate decision and external write', () => {
    const mustBeIdempotent = [
      'gates.decide',
      'taskSync.send',
      'taskSync.retry',
      'gates.submit',
      'pilot.activate',
    ];
    for (const id of mustBeIdempotent) {
      const e = ENDPOINTS.find((x) => x.id === id);
      expect(e?.idempotent, id).toBe(true);
      expect(e?.auth, id).toBe('human');
    }
  });

  it('has no endpoint that sends prospect communications', () => {
    expect(ENDPOINTS.some((e) => /message-drafts\/.*\/send/.test(e.path))).toBe(false);
  });
});

describe('analytics events', () => {
  it('declares exactly the PRD §17 event list with a closed property schema each', () => {
    expect(AnalyticsEventName.options.length).toBe(ANALYTICS_EVENT_COUNT_GUARD);
    for (const name of AnalyticsEventName.options) {
      expect(AnalyticsProps[name], name).toBeDefined();
    }
  });
});

describe('typed money', () => {
  it('rejects a one-time measure labelled per-year', () => {
    const r = Money.safeParse({
      amount: '400000.00',
      currency: 'EUR',
      measure: 'one_time_investment',
      timeBasis: 'per_year',
    });
    expect(r.success).toBe(false);
  });

  it('accepts a correctly typed recurring measure', () => {
    const r = Money.safeParse({
      amount: '600000.00',
      currency: 'EUR',
      measure: 'contribution_after_opex',
      timeBasis: 'per_year',
    });
    expect(r.success).toBe(true);
  });
});

describe('fingerprint', () => {
  it('formats the first 8 hex chars as XXXX·XXXX', () => {
    expect(toFingerprint('7f3a19c2' + '0'.repeat(56))).toBe('7F3A·19C2');
  });
});
