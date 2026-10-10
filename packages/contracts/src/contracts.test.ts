import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENT_COUNT_GUARD,
  ENDPOINTS,
  AnalyticsEventName,
  AnalyticsProps,
  Money,
  toFingerprint,
} from './test-exports';
import {
  API,
  APPROVAL_ROUTE_LABELS,
  ApprovalRoute,
  ASSIGNEE_MAPPING_STATUS_LABELS,
  AssigneeMappingStatus,
  BUDGET_ENTRY_KIND_LABELS,
  BudgetEntryKind,
  COMMITTEE_SEAT_LABELS,
  COMMITTEE_SEAT_STATE_LABELS,
  CommitteeSeat,
  CommitteeSeatState,
  GatePolicyBody,
  License,
  LICENSE_EXPIRY_ACTION_LABELS,
  LICENSE_RIGHTS_STATUS_LABELS,
  LicenseExpiryAction,
  LicenseRightsStatus,
  LINEAGE_RELATION_LABELS,
  LineageRelation,
  MEASURE_TYPE_LABELS,
  MeasureType,
  snapshotLabel,
  STOP_RULE_CONSEQUENCE_LABELS,
  STOP_RULE_STATUS_LABELS,
  STOP_RULE_TRIGGER_KIND_LABELS,
  StopRuleConsequence,
  StopRuleStatus,
  StopRuleTriggerKind,
  thesisBlockerLabel,
  GATE_REQUEST_STATUS_LABELS,
  GateRequestStatus,
  RankingRow,
  REVIEW_AREA_LABELS,
  ReviewArea,
  Tenant,
  THESIS_BLOCKER_STATUS_LABELS,
  ThesisBlockerStatus,
} from './index';

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

describe('Wave 2 additions are additive (D-068)', () => {
  it('label maps cover their enums exactly', () => {
    expect(Object.keys(REVIEW_AREA_LABELS).sort()).toEqual([...ReviewArea.options].sort());
    expect(Object.keys(GATE_REQUEST_STATUS_LABELS).sort()).toEqual([...GateRequestStatus.options].sort());
    expect(Object.keys(THESIS_BLOCKER_STATUS_LABELS).sort()).toEqual([...ThesisBlockerStatus.options].sort());
  });

  it('the new endpoints are reads with unique ids', () => {
    expect(API.directory.people).toMatchObject({ id: 'people.list', method: 'GET', path: '/people' });
    expect(API.directory.scopeOptions).toMatchObject({ id: 'catalogue.scopeOptions', method: 'GET' });
    expect(ENDPOINTS.filter((e) => e.id === 'people.list' || e.id === 'catalogue.scopeOptions')).toHaveLength(
      2,
    );
  });

  it('responses without the new optional fields still validate', () => {
    const row = {
      opportunityId: '00000000-0000-4000-8000-000000000001',
      ranked: false,
      score: null,
      reason: 'x',
    };
    expect(RankingRow.parse(row)).toEqual(row);
    expect(
      Tenant.parse({ id: row.opportunityId, slug: 'a', name: 'A', dataResidency: 'eu', illustrative: true }),
    ).not.toHaveProperty('timeZone');
  });

  it('an extension request may carry the PRD placeholder cap (null), and still a real one', () => {
    const body = {
      parentGateRequestId: '00000000-0000-4000-8000-000000000002',
      currency: 'EUR',
      ownerId: '00000000-0000-4000-8000-000000000003',
      scopeItems: ['Extend validation at the 4 pilot sites'],
    };
    expect(
      API.outcomes.requestExtension.body.safeParse({ ...body, spendCap: null, durationDays: null }).success,
    ).toBe(true);
    expect(
      API.outcomes.requestExtension.body.safeParse({ ...body, spendCap: '25000.00', durationDays: 60 })
        .success,
    ).toBe(true);
  });
});

describe('Wave 4 additions are additive (D-122 onward)', () => {
  it('label maps cover their enums exactly', () => {
    const pairs: [{ options: readonly string[] }, Record<string, string>][] = [
      [CommitteeSeat, COMMITTEE_SEAT_LABELS],
      [CommitteeSeatState, COMMITTEE_SEAT_STATE_LABELS],
      [ApprovalRoute, APPROVAL_ROUTE_LABELS],
      [MeasureType, MEASURE_TYPE_LABELS],
      [StopRuleTriggerKind, STOP_RULE_TRIGGER_KIND_LABELS],
      [StopRuleConsequence, STOP_RULE_CONSEQUENCE_LABELS],
      [StopRuleStatus, STOP_RULE_STATUS_LABELS],
      [LicenseRightsStatus, LICENSE_RIGHTS_STATUS_LABELS],
      [LicenseExpiryAction, LICENSE_EXPIRY_ACTION_LABELS],
      [AssigneeMappingStatus, ASSIGNEE_MAPPING_STATUS_LABELS],
      [LineageRelation, LINEAGE_RELATION_LABELS],
      [BudgetEntryKind, BUDGET_ENTRY_KIND_LABELS],
    ];
    for (const [e, l] of pairs) expect(Object.keys(l).sort()).toEqual([...e.options].sort());
  });

  it('labels pair the gate with the status and the snapshot version (D-118, D-119)', () => {
    expect(thesisBlockerLabel('pending', 'G2')).toBe('Pending · G2');
    expect(thesisBlockerLabel('blocker', 'G3')).toBe('Blocker · G3');
    expect(thesisBlockerLabel('resolved', 'G3')).toBe('Resolved');
    expect(snapshotLabel('G2', 2)).toBe('G2 · Snapshot v2');
  });

  it('registers the new endpoints once, with human sessions and idempotency on every write', () => {
    const added = [
      'feasibility.addDimension',
      'pilot.tripStopRule',
      'tasks.addDraft',
      'tasks.editDraft',
      'tasks.removeDraft',
      'budget.listEntries',
      'budget.reverseEntry',
      'admin.committee',
      'admin.setCommitteeMember',
      'admin.licenses',
      'admin.setLicense',
      'admin.liveAnalysis',
      'admin.setLiveAnalysis',
      'admin.checkMapping',
      'admin.createConnection',
      'admin.authorizeConnection',
      'admin.completeAuthorization',
    ];
    for (const id of added) {
      const e = ENDPOINTS.filter((x) => x.id === id);
      expect(e, id).toHaveLength(1);
      if (e[0]!.method !== 'GET') expect(e[0]!.auth, id).toBe('human');
      if (e[0]!.method === 'POST' && id !== 'admin.checkMapping') expect(e[0]!.idempotent, id).toBe(true);
    }
    expect(ENDPOINTS).toHaveLength(165);
  });

  it('old request bodies and responses still validate without the new optional fields', () => {
    const scope = {
      amount: '120000.00',
      currency: 'EUR',
      durationDays: 90,
      windowStart: null,
      windowEnd: null,
      countryCodes: ['DE'],
      segmentLabel: null,
      maxSites: 4,
      milestones: [],
      ownerId: null,
      authorizes: ['Pilot'],
      doesNotAuthorize: ['Scale'],
    };
    const body = { gateCode: 'G2', scope, parentGateRequestId: null, proposedConditions: [] };
    expect(API.gates.createRequest.body.safeParse(body).success).toBe(true);
    expect(
      API.gates.createRequest.body.safeParse({
        ...body,
        stopRules: [
          {
            trigger: { kind: 'event', metricKey: null, text: 'A specialist condition is breached' },
            consequence: 'pause_and_request_review',
            ownerId: '00000000-0000-4000-8000-000000000003',
          },
        ],
      }).success,
    ).toBe(true);
    expect(API.analysis.decideProposal.body.safeParse({ decision: 'accept', reason: null }).success).toBe(
      true,
    );
    expect(GatePolicyBody.parse({ gateCode: 'G1', preconditionKeys: [] })).not.toHaveProperty(
      'committeeSeats',
    );
    expect(
      License.safeParse({
        id: '00000000-0000-4000-8000-000000000001',
        key: 'k',
        name: 'n',
        boundaryText: 'b',
        maxExcerptSentences: 0,
        allowModelContext: false,
        allowEmbeddings: false,
        allowExport: false,
      }).success,
    ).toBe(true);
  });
});
