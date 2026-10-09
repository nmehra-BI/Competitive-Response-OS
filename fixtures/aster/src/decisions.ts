/**
 * ME-104 validation, gates, pilot and outcomes (PRD §6 "Pilot criteria and sample outcome").
 * Placeholders such as €[cap] and [hours per site] stay placeholders: the PRD sets no value.
 */
import { fid } from './ids';
import { people } from './org';

// ---------------------------------------------------------------------------
// Validation (S09) — G1 authorizes €15k validation only.
// ---------------------------------------------------------------------------

export const exp03 = {
  id: fid('experiment', 3),
  key: 'EXP-03',
  title: 'Validation outreach · 20 sites',
  ownerId: people.maya.id,
  fieldworkOwnerId: people.jonas.id,
  linkedAssumptionKeys: ['ASM-01', 'ASM-04'],
  lockedAt: '2026-10-16T15:02:00+02:00',
  originalPlan: {
    version: 1,
    hypothesis:
      'We believe that at least 4 of 20 selected sites will sign a paid pilot commitment, and that at least 8 will complete a discovery interview.',
    method: 'Partner-led outreach and discovery interviews',
    sampleText:
      '20 sites from the 500-site reachable pool, selected by size and process, via the approved partner channel',
    sampleSize: 20,
    selectionText: 'Selected by size and process from the reachable pool',
    nonresponseNote: 'Declines are recorded. Results describe responders only.',
    windowStart: '2026-10-19',
    windowEnd: '2026-11-13',
    budgetAmount: '15000.00',
    currency: 'EUR',
    budgetNote: '€15k · approved at G1 (validation only)',
    metrics: [
      {
        metricKey: 'completed_interviews',
        name: 'Completed discovery interviews',
        operator: 'gte',
        thresholdValue: '8',
        thresholdText: '≥ 8',
        unit: 'interviews',
      },
      {
        metricKey: 'paid_commitments',
        name: 'Paid pilot commitments',
        operator: 'gte',
        thresholdValue: '4',
        thresholdText: '≥ 4',
        unit: 'commitments',
      },
    ],
    decisionRules: [
      { condition: '≥ 4 commitments', action: 'prepare G2 pilot request' },
      { condition: '2–3 commitments', action: 'revise thesis and offer' },
      { condition: '< 2 commitments', action: 'stop or redesign' },
    ],
  },
  amendment1: {
    number: 1,
    at: '2026-11-02T10:00:00+01:00',
    authorId: people.maya.id,
    reason: 'Window extended by 7 days: two sites rescheduled. Thresholds unchanged. Original kept.',
    changedFields: ['windowEnd'],
    newWindowEnd: '2026-11-20',
    thresholdsChanged: false,
    afterResultsSeen: false,
  },
  result: {
    version: 1,
    observations: [
      { metricKey: 'completed_interviews', observed: '9', observedText: '9', result: 'met' },
      { metricKey: 'paid_commitments', observed: '4', observedText: '4', result: 'met' },
    ],
    periodStart: '2026-10-19',
    periodEnd: '2026-11-20',
    sourceText: 'partner log and signed commitments',
    interpretation: 'Thresholds met. Supports a bounded pilot request; does not establish 20% adoption.',
    limitations:
      'Interviews do not validate conversion or full-market demand. 20 selected sites are not a random sample.',
    recordedBy: people.maya.id,
    recordedAt: '2026-11-20T17:12:00+01:00',
  },
  decisionTaken: { text: 'Prepare G2 pilot request', by: people.maya.id, at: '2026-11-20T17:30:00+01:00' },
} as const;

export const validationTasks = [
  {
    ordinal: 1,
    title: 'Select 20 sites from the reachable pool',
    ownerId: people.maya.id,
    dueOn: '2026-10-19',
    function: 'strategy',
    deliverable: 'Site selection list',
    externalKey: 'VAL-1',
  },
  {
    ordinal: 2,
    title: 'Brief partner on outreach script',
    ownerId: people.jonas.id,
    dueOn: '2026-10-20',
    function: 'sales',
    deliverable: 'Partner briefed',
    externalKey: 'VAL-2',
  },
  {
    ordinal: 3,
    title: 'Run discovery interviews (target 8)',
    ownerId: people.jonas.id,
    dueOn: '2026-11-13',
    function: 'sales',
    deliverable: 'Interview notes',
    externalKey: 'VAL-3',
  },
  {
    ordinal: 4,
    title: 'Collect paid pilot commitments (target 4)',
    ownerId: people.jonas.id,
    dueOn: '2026-11-13',
    function: 'sales',
    deliverable: 'Signed commitments',
    externalKey: 'VAL-4',
  },
  {
    ordinal: 5,
    title: 'Record results and nonresponse',
    ownerId: people.maya.id,
    dueOn: '2026-11-13',
    function: 'strategy',
    deliverable: 'Result record',
    externalKey: 'VAL-5',
  },
] as const;

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export const gates = {
  g0: {
    id: fid('gateRequest', 1),
    key: 'MD-21-G0',
    gateCode: 'G0',
    subject: 'mandate',
    buttonLabel: 'Approve mandate (G0)',
    authorizes: ['Search and assessment within this scope', 'Owner Maya Rao · horizon 3 years · EUR'],
    doesNotAuthorize: ['No spend: validation (G1) and pilot (G2) are separate gates', 'No prospect outreach'],
    history: [
      {
        snapshotVersion: 1,
        disposition: 'return_for_revision',
        by: people.elena.id,
        at: '2026-10-03T09:40:00+02:00',
        rationale:
          'Name an accountable owner and state the currency. Add ‘no prospect outreach before G1’ to the exclusions.',
      },
      {
        snapshotVersion: 2,
        disposition: 'approve',
        by: people.elena.id,
        at: '2026-10-05T10:12:00+02:00',
        rationale: 'Scope v2 is bounded and owned.',
      },
    ],
  },
  g1: {
    id: fid('gateRequest', 2),
    key: 'ME-104-G1',
    gateCode: 'G1',
    amount: '15000.00',
    currency: 'EUR',
    buttonLabel: 'Approve validation €15k',
    authorizes: [
      'Validation outreach to 20 sites · up to €15k',
      'Discovery interviews and paid pilot commitments',
    ],
    doesNotAuthorize: ['Not a pilot', 'Not market entry or scale', 'No spend above €15k'],
    submittedAt: '2026-10-14T17:00:00+02:00',
    decision: {
      disposition: 'approve',
      by: people.elena.id,
      at: '2026-10-16T15:02:00+02:00',
      rationale: 'Bounded spend, clear thresholds, outcome changes the G2 decision.',
    },
    snapshotVersion: 1,
    prototypeFingerprint: '2B71·0E4D', // illustrative only; real fingerprints come from the hash
  },
  g2: {
    id: fid('gateRequest', 3),
    key: 'ME-104-G2',
    gateCode: 'G2',
    amount: '120000.00',
    currency: 'EUR',
    durationDays: 90,
    windowStart: '2026-12-01',
    windowEnd: '2027-02-28',
    maxSites: 4,
    pilotOwnerId: people.jonas.id,
    buttonLabel: 'Approve pilot €120k · 90 days',
    ask: 'Approve a 90-day paid pilot at up to 4 German food-processing sites, with a budget of up to €120k, owned by Jonas Klein. This is not market entry and not a scale decision.',
    authorizes: [
      'Pilot at up to 4 German food-processing sites',
      'Up to €120k · 90 days, 1 Dec 2026 – 28 Feb 2027',
      'Creating the approved pilot tasks',
    ],
    doesNotAuthorize: ['Not market entry', 'Not scale', 'Not prospect outreach', 'Not spend above €120k'],
    recommendation:
      'Approve the pilot with condition C1. Validation thresholds were met; adoption at scale remains unproven and is what the pilot tests.',
    alternatives: [
      {
        name: 'No entry.',
        meaning: 'Stop here; keep €120k. We would not learn deployment effort or renewal intent.',
        isNoEntry: true,
      },
      {
        name: 'Extend validation without a pilot.',
        meaning: 'Cheaper, but interviews do not show paid use.',
        isNoEntry: false,
      },
      { name: 'Partner resale only.', meaning: 'No deployment learning for Aster.', isNoEntry: false },
    ],
    stopRules: [
      'Approved budget ceiling €120k. Spend above it needs a scope-change request and a new authorization.',
      'Pause if a specialist condition is breached.',
      'Day-90 review against pre-registered thresholds: paid use and continuation at 4 of 4 pilot customers; deployment effort within the assumed [hours per site].',
    ],
    knownLimitations: [
      'Four sites cannot show market-wide adoption.',
      'Deployment effort is estimated, not measured.',
      'Specialist sign-off covers the pilot only.',
    ],
    snapshots: [
      {
        version: 2,
        createdAt: '2026-11-24T09:00:00+01:00',
        status: 'superseded',
        note: 'Superseded by v3 on 25 Nov · never decided',
      },
      {
        version: 3,
        createdAt: '2026-11-25T16:40:00+01:00',
        status: 'current',
        changesSinceV2: ['specialist sign-off added', 'stop rules added', 'condition C1 added'],
      },
    ],
    prototypeFingerprint: '7F3A·19C2', // illustrative only
    expiresAt: '2026-12-11T23:59:00+01:00',
    positions: [
      {
        reviewerId: people.daniel.id,
        area: 'finance',
        position: 'supports_with_conditions',
        scopeText: 'Margin definition · opex scope · EUR 2026. Not checked: ramp, cash timing.',
      },
      {
        reviewerId: people.lena.id,
        area: 'specialist',
        position: 'supports',
        scopeText: 'Signed for pilot only: up to 4 sites, 90 days · 23 Nov. Does not cover scale.',
      },
      {
        reviewerId: people.priya.id,
        area: 'product',
        position: 'supports',
        scopeText: 'Pilot workflow; adaptation list attached',
      },
      {
        reviewerId: people.jonas.id,
        area: 'pilot_owner',
        position: 'accepts_ownership',
        scopeText: 'Pilot plan, thresholds and budget',
      },
    ],
    dissent: {
      authorId: people.daniel.id,
      signedAt: '2026-11-24T17:05:00+01:00',
      statement:
        'I do not see comparable evidence for 20% adoption in this segment. Plan on 10% until the pilot shows paid use. I support the pilot because it tests exactly this.',
      scopeText: 'Scope: adoption assumption · signed on v3',
    },
    conditions: [
      {
        key: 'C1',
        text: 'Pilot limited to 4 sites as signed by the specialist',
        ownerId: people.jonas.id,
        dueOn: '2026-12-01',
        dueRule: null,
        blocksExecution: true,
      },
      {
        key: 'C2',
        text: 'Log deployment effort per site every week',
        ownerId: people.jonas.id,
        dueOn: null,
        dueRule: 'Weekly',
        blocksExecution: false,
      },
    ],
    decision: {
      disposition: 'approve_with_conditions',
      by: people.elena.id,
      at: '2026-11-27T09:14:00+01:00',
      rationale: 'Thresholds met; bounded pilot tests the disputed adoption assumption.',
    },
    staleVariant: {
      changedAt: '2026-11-26T12:00:00+01:00',
      reason: 'Adoption assumption changed on 26 Nov. Approval is disabled.',
    },
  },
  x1: {
    id: fid('gateRequest', 5),
    key: 'ME-104-X1',
    gateCode: 'X',
    parentKey: 'ME-104-G2',
    amount: null, // €[cap] · placeholder, confirm with PM. The PRD sets no amount.
    amountPlaceholder: '€[cap]',
    durationPlaceholder: '[duration] days',
    ownerId: people.jonas.id,
    submittedAt: '2027-03-05T14:05:00+01:00',
    authorizes: ['Extension work within €[cap] and the chosen scope', 'The existing 4 pilot sites'],
    doesNotAuthorize: ['Not scale', 'No new sites without a new gate', 'Does not unblock G3'],
  },
  g3: {
    gateCode: 'G3',
    buttonLabel: 'Authorize scale',
    blockedBy: [
      { key: 'pilot_actuals_vs_thresholds', message: 'Demand threshold · 3 of 4 met; 4 of 4 required' },
      { key: 'readiness_reassessment', message: 'Specialist scale-readiness review · incomplete' },
    ],
  },
} as const;

// ---------------------------------------------------------------------------
// Pilot (S11)
// ---------------------------------------------------------------------------

export const pilotMilestones = [
  { id: fid('milestone', 1), ordinal: 1, name: 'M1 · Kick-off', windowText: 'weeks 1–2' },
  { id: fid('milestone', 2), ordinal: 2, name: 'M2 · Run and measure', windowText: 'weeks 3–12' },
  { id: fid('milestone', 3), ordinal: 3, name: 'M3 · Review', windowText: 'week 13' },
] as const;

export const pilotTasks = [
  {
    id: fid('task', 1),
    ordinal: 1,
    title: 'Confirm 4 pilot sites and contacts',
    milestone: 1,
    function: 'sales',
    ownerId: people.jonas.id,
    dependsOn: [],
    dueOn: '2026-12-04',
    dueRule: null,
    deliverable: 'Signed site list',
    externalKey: 'PIL-11',
  },
  {
    id: fid('task', 2),
    ordinal: 2,
    title: 'Install monitoring at 4 sites',
    milestone: 1,
    function: 'operations',
    ownerId: people.opsLead.id,
    dependsOn: [1],
    dueOn: '2026-12-18',
    dueRule: null,
    deliverable: 'Install reports',
    externalKey: 'PIL-12',
    variants: {
      noOwner: 'Unassigned',
      permissionFailure: 'assignee [Operations lead] is not a member of project PIL',
    },
  },
  {
    id: fid('task', 3),
    ordinal: 3,
    title: 'Adapt dashboards for food-processing workflow',
    milestone: 1,
    function: 'product',
    ownerId: people.priya.id,
    dependsOn: [],
    dueOn: '2026-12-11',
    dueRule: null,
    deliverable: 'Adaptation list v1',
    externalKey: 'PIL-13',
  },
  {
    id: fid('task', 4),
    ordinal: 4,
    title: 'Weekly deployment-effort log (C2)',
    milestone: 2,
    function: 'operations',
    ownerId: people.jonas.id,
    dependsOn: [2],
    dueOn: '2026-12-07',
    dueRule: 'Weekly',
    deliverable: 'Effort log per site',
    conditionKey: 'C2',
    externalKey: 'PIL-14',
  },
  {
    id: fid('task', 5),
    ordinal: 5,
    title: 'Customer check-ins and renewal-intent interviews',
    milestone: 2,
    function: 'marketing',
    ownerId: people.jonas.id,
    dependsOn: [2],
    dueOn: '2027-02-12',
    dueRule: null,
    deliverable: 'Interview notes',
    externalKey: 'PIL-15',
  },
  {
    id: fid('task', 6),
    ordinal: 6,
    title: 'Day-90 review pack against thresholds',
    milestone: 3,
    function: 'strategy',
    ownerId: people.maya.id,
    dependsOn: [4, 5],
    dueOn: '2027-03-03',
    dueRule: null,
    deliverable: 'Review pack',
    externalKey: 'PIL-16',
  },
] as const;

export const pilotPreview = {
  destination: { tool: 'Jira', project: 'PIL', projectName: 'Aster Pilots' },
  willCreate: 6,
  linkText: 'each linked to ME-104 · G2 v3',
  assigneesText: 'Matched by directory: Jonas Klein, Priya Shah, Maya Rao, [Operations lead]',
  permissionsText: 'Create and assign issues · as Jonas Klein',
  repeatsText: 'Each task has a fixed reference; retrying never duplicates',
} as const;

export const pilotBudget = {
  approved: '120000.00',
  committed: '0.00',
  spent: '0.00',
  currency: 'EUR',
  asOf: '2026-12-01',
} as const;

export const outboundDraft = {
  title: 'Welcome note to the 4 pilot site contacts',
  body: 'Thank you for joining the 90-day monitoring pilot. Your site lead will contact you to schedule installation…',
  origin: 'ai',
} as const;

// ---------------------------------------------------------------------------
// Outcomes (S12) — mixed results; scale blocked; revise and extend.
// ---------------------------------------------------------------------------

export const outcomeTargets = [
  {
    id: fid('outcomeTarget', 1),
    metricKey: 'paid_use_continuation',
    name: 'Paid use and continuation',
    thresholdText: '4 of 4 pilot customers',
    operator: 'gte',
    thresholdValue: '4',
    unit: 'customers',
    windowText: '1 Dec 2026 – 28 Feb 2027',
  },
  {
    id: fid('outcomeTarget', 2),
    metricKey: 'deployment_effort',
    name: 'Deployment effort per site',
    thresholdText: 'Within [hours per site] assumed',
    operator: 'lte',
    thresholdValue: null,
    unit: 'hours_per_site',
    windowText: 'weekly log',
  },
  {
    id: fid('outcomeTarget', 3),
    metricKey: 'buyer_fit',
    name: 'Buyer fit',
    thresholdText: 'Qualitative · interview notes',
    operator: 'qualitative',
    thresholdValue: null,
    unit: 'text',
    windowText: 'Feb interviews',
  },
] as const;

export const outcomeObservations = [
  {
    id: fid('observation', 1),
    targetKey: 'paid_use_continuation',
    valueText: '3 of 4',
    value: '3',
    unit: 'customers',
    periodStart: '2026-12-01',
    periodEnd: '2027-02-28',
    sourceText: 'Source: billing records',
    result: 'not_met',
    recordedBy: people.jonas.id,
    recordedAt: '2027-03-04T16:10:00+01:00',
  },
  {
    id: fid('observation', 2),
    targetKey: 'deployment_effort',
    valueText: 'Above assumption · [actual hours per site]',
    value: null,
    unit: 'hours_per_site',
    periodStart: '2026-12-01',
    periodEnd: '2027-02-28',
    sourceText: 'Source: effort log (C2)',
    result: 'not_met',
    recordedBy: people.jonas.id,
    recordedAt: '2027-03-04T16:10:00+01:00',
  },
  {
    id: fid('observation', 3),
    targetKey: 'buyer_fit',
    valueText: 'Mixed',
    value: null,
    unit: 'text',
    periodStart: '2027-02-01',
    periodEnd: '2027-02-28',
    sourceText: 'Source: interview notes',
    result: 'inconclusive',
    recordedBy: people.jonas.id,
    recordedAt: '2027-03-04T16:10:00+01:00',
  },
] as const;

export const outcomeReview = {
  whatWeLearned: [
    'Three of four pilot customers met the paid-use and continuation threshold; one did not.',
    'Deployment effort per site was above the assumption. Installation needs more operations time than planned.',
    'The specialist sign-off covered the pilot only. Scale readiness has not been reviewed.',
  ],
  whatChangesNext: [
    'A scoped extension with its own spend cap tests deployment effort and the fourth site.',
    'Lena Hoffmann scopes a scale-readiness review.',
    'Daniel Weber re-checks the adoption assumption (condition C3).',
  ],
  causalLimitations: [
    '4 sites, no comparison group.',
    'Winter production period only.',
    'Results describe these sites, not the 500-site pool.',
    'No revenue is attributed to the pilot beyond its own billing.',
  ],
  recommendation: {
    outcome: 'extend',
    label: 'Revise and extend validation',
    text: 'Not scale. Test deployment effort and the fourth site under a scoped extension before any G3 request.',
    by: people.maya.id,
  },
  decision: {
    outcome: 'extend',
    label: 'Revise and extend validation',
    decidedBy: people.elena.id,
    decidedAt: '2027-03-05T11:20:00+01:00',
    rationale: 'On Maya Rao’s recommendation · pilot review v1 · rationale attached',
  },
  stageAfterDecision: 'validation',
} as const;
