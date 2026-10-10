/**
 * Aster Industrial Systems — tenant, people, roles, authority, policies, licences, connections.
 * Synthetic identities (PRD §6). Ceilings, expiry, the extension rule and the committee follow the
 * D-109 / D-110 default matrix (illustrative values; a real tenant's Finance confirms its own).
 */
import { fid } from './ids';

export const ILLUSTRATIVE_NOTICE =
  'Illustrative data — synthetic. Aster Industrial Systems sample workspace · fictional people and figures · no live systems connected';

export const tenant = {
  id: fid('tenant', 1),
  slug: 'aster-industrial',
  name: 'Aster Industrial Systems',
  dataResidency: 'eu',
  illustrative: true,
} as const;

export const businessUnits = [
  { id: fid('businessUnit', 1), key: 'water', name: 'BU Water' },
  { id: fid('businessUnit', 2), key: 'air', name: 'BU Air' }, // no Aster persona has access (S01 restricted state)
] as const;

export const products = [
  {
    id: fid('product', 1),
    key: 'water-monitoring',
    name: 'Water-monitoring system',
    description: 'Existing process-water monitoring solution',
  },
] as const;

export const segments = [
  { id: fid('segment', 1), key: 'food-processing', name: 'Food processing' },
  { id: fid('segment', 2), key: 'beverages', name: 'Beverages' },
] as const;

/** The six Aster personas offered by the dev login, plus the unnamed tenant administrator. */
export const people = {
  elena: {
    id: fid('user', 1),
    email: 'elena.fischer@aster.example',
    displayName: 'Elena Fischer',
    title: 'BU VP · Sponsor',
    initials: 'EF',
    kind: 'human',
    landing: '/reviews?tab=awaiting',
  },
  maya: {
    id: fid('user', 2),
    email: 'maya.rao@aster.example',
    displayName: 'Maya Rao',
    title: 'Strategy lead · Case owner',
    initials: 'MR',
    kind: 'human',
    landing: '/me/overview?view=operator',
  },
  daniel: {
    id: fid('user', 3),
    email: 'daniel.weber@aster.example',
    displayName: 'Daniel Weber',
    title: 'Finance partner',
    initials: 'DW',
    kind: 'human',
    landing: '/reviews?tab=economics',
  },
  jonas: {
    id: fid('user', 4),
    email: 'jonas.klein@aster.example',
    displayName: 'Jonas Klein',
    title: 'Regional commercial lead · Pilot owner',
    initials: 'JK',
    kind: 'human',
    landing: '/my-work',
  },
  priya: {
    id: fid('user', 5),
    email: 'priya.shah@aster.example',
    displayName: 'Priya Shah',
    title: 'Product lead',
    initials: 'PS',
    kind: 'human',
    landing: '/reviews?tab=assigned',
  },
  lena: {
    id: fid('user', 6),
    email: 'lena.hoffmann@aster.example',
    displayName: 'Lena Hoffmann',
    title: 'Legal/regulatory specialist',
    initials: 'LH',
    kind: 'human',
    landing: '/reviews?tab=assigned',
  },
  admin: {
    id: fid('user', 7),
    email: 'admin@aster.example',
    displayName: '[Tenant administrator]',
    title: 'Administrator',
    initials: 'TA',
    kind: 'human',
    landing: '/admin/health',
  },
  opsLead: {
    id: fid('user', 8),
    email: 'operations.lead@aster.example',
    displayName: '[Operations lead]',
    title: 'Operations',
    initials: 'OL',
    kind: 'human',
    landing: '/my-work',
  },
  analysisAgent: {
    id: fid('user', 9),
    email: 'analysis-agent@aster.example',
    displayName: 'Analysis assistant',
    title: 'Bounded analysis agent',
    initials: 'AI',
    kind: 'agent',
    landing: '/',
  },
  /** PQ-14 / D-109 §5: synthetic investment committee members (no G3 grant is seeded). */
  katrin: {
    id: fid('user', 10),
    email: 'katrin.vogel@aster.example',
    displayName: 'Katrin Vogel',
    title: 'CFO · Investment committee (finance seat)',
    initials: 'KV',
    kind: 'human',
    landing: '/reviews?tab=awaiting',
  },
  thomas: {
    id: fid('user', 11),
    email: 'thomas.berger@aster.example',
    displayName: 'Thomas Berger',
    title: 'COO · Investment committee (operations seat)',
    initials: 'TB',
    kind: 'human',
    landing: '/reviews?tab=awaiting',
  },
} as const;

/** Persona ids offered by the dev login picker, in display order. */
export const devPersonaOrder = [
  'elena',
  'maya',
  'daniel',
  'jonas',
  'priya',
  'lena',
  'katrin',
  'thomas',
] as const;

const BU = businessUnits[0].id;

export const roleAssignments = [
  { id: fid('role', 1), userId: people.elena.id, role: 'sponsor', businessUnitId: BU },
  { id: fid('role', 2), userId: people.maya.id, role: 'case_owner', businessUnitId: BU },
  { id: fid('role', 3), userId: people.daniel.id, role: 'finance_reviewer', businessUnitId: BU },
  { id: fid('role', 4), userId: people.jonas.id, role: 'pilot_owner', businessUnitId: BU },
  { id: fid('role', 5), userId: people.jonas.id, role: 'commercial_reviewer', businessUnitId: BU },
  { id: fid('role', 6), userId: people.priya.id, role: 'product_reviewer', businessUnitId: BU },
  { id: fid('role', 7), userId: people.lena.id, role: 'specialist_reviewer', businessUnitId: BU },
  { id: fid('role', 8), userId: people.admin.id, role: 'tenant_admin', businessUnitId: null },
  { id: fid('role', 9), userId: people.opsLead.id, role: 'read_only_reviewer', businessUnitId: BU },
  { id: fid('role', 10), userId: people.katrin.id, role: 'investment_committee', businessUnitId: BU },
  { id: fid('role', 11), userId: people.thomas.id, role: 'investment_committee', businessUnitId: BU },
] as const;

/** The Finance-signed delegation-of-authority document every Aster grant and seat comes from (D-109 §2). */
export const ASTER_DOA_REFERENCE = 'DoA-2026-01 · BU Water · illustrative';

/**
 * G3 committee for BU Water (D-109 §3, §5): Elena chairs; Katrin holds the finance seat and Thomas the
 * operations seat. Membership is not authority: no G3 grant is seeded, so S14 shows
 * "Committee named · G3 authority not granted" (step 29 authority gap stays visible).
 */
export const committeeMembers = [
  { id: fid('committeeMember', 1), userId: people.elena.id, seat: 'chair', businessUnitId: BU },
  { id: fid('committeeMember', 2), userId: people.katrin.id, seat: 'finance', businessUnitId: BU },
  { id: fid('committeeMember', 3), userId: people.thomas.id, seat: 'operations', businessUnitId: BU },
] as const;

/**
 * Delegated authority (S14 matrix, D-109 §1 default template). Elena Fischer, the BU Water sponsor,
 * holds G0, G1 up to €50k, G2 up to €150k and X up to €50k (they cover €15k, €120k and the €30k X1).
 * Grants come from the Finance-signed DoA document. Real grants default to 12 months' validity
 * (D-109 §2); the illustrative grants stay open-ended so the dated journey and tests never expire with
 * the calendar. There is deliberately no G3 grant: "Authority gap".
 */
export const SPONSOR_CEILINGS = { G1: '50000.00', G2: '150000.00', X: '50000.00' } as const;
export const COMMITTEE_CEILINGS = {
  G1: '250000.00',
  G2: '1000000.00',
  X: '250000.00',
  G3: '2000000.00',
} as const;
export const authorityGrants = [
  {
    id: fid('authority', 1),
    userId: people.elena.id,
    gateCode: 'G0',
    businessUnitId: BU,
    ceilingAmount: null,
    currency: null,
    validFrom: '2026-01-01',
    validTo: null,
    doaReference: ASTER_DOA_REFERENCE,
  },
  {
    id: fid('authority', 2),
    userId: people.elena.id,
    gateCode: 'G1',
    businessUnitId: BU,
    ceilingAmount: SPONSOR_CEILINGS.G1,
    currency: 'EUR',
    validFrom: '2026-01-01',
    validTo: null,
    doaReference: ASTER_DOA_REFERENCE,
  },
  {
    id: fid('authority', 3),
    userId: people.elena.id,
    gateCode: 'G2',
    businessUnitId: BU,
    ceilingAmount: SPONSOR_CEILINGS.G2,
    currency: 'EUR',
    validFrom: '2026-01-01',
    validTo: null,
    doaReference: ASTER_DOA_REFERENCE,
  },
  {
    id: fid('authority', 4),
    userId: people.elena.id,
    gateCode: 'X',
    businessUnitId: BU,
    ceilingAmount: SPONSOR_CEILINGS.X,
    currency: 'EUR',
    validFrom: '2026-01-01',
    validTo: null,
    doaReference: ASTER_DOA_REFERENCE,
  },
] as const;

/**
 * Gate policies (D-109, D-110). Expiry of unused approvals: G1 and G2 30 days, X 14 days; G0 and G3 never
 * expire in the MVP. G3 needs 2 of 3 committee approvals on the same snapshot, the finance seat required.
 * `authority` is the default matrix row (one-time EUR per request); per-person ceilings stay on grants.
 */
export const gatePolicies = [
  {
    gateCode: 'G0',
    preconditionKeys: [
      'sponsor_set',
      'objective_set',
      'constraints_set',
      'owner_set',
      'currency_and_horizon_set',
    ],
    requiredApprovals: 1,
    requiredSignOffAreas: [],
    approvalExpiryDays: 14,
    approvalExpires: false,
  },
  {
    gateCode: 'G1',
    preconditionKeys: [
      'evidence_inventory',
      'comparable_sizing',
      'material_unknowns_listed',
      'feasibility_blockers_listed',
    ],
    requiredApprovals: 1,
    requiredSignOffAreas: [],
    approvalExpiryDays: 30,
    approvalExpires: true,
    authority: {
      sponsorCeiling: SPONSOR_CEILINGS.G1,
      committeeCeiling: COMMITTEE_CEILINGS.G1,
      currency: 'EUR',
    },
  },
  {
    gateCode: 'G2',
    preconditionKeys: [
      'validation_results',
      'finance_review',
      'specialist_sign_off',
      'budget_and_stop_rules',
      'accountable_pilot_owner',
    ],
    requiredApprovals: 1,
    requiredSignOffAreas: ['finance', 'specialist'],
    approvalExpiryDays: 30,
    approvalExpires: true,
    authority: {
      sponsorCeiling: SPONSOR_CEILINGS.G2,
      committeeCeiling: COMMITTEE_CEILINGS.G2,
      currency: 'EUR',
    },
  },
  {
    gateCode: 'G3',
    preconditionKeys: [
      'pilot_actuals_vs_thresholds',
      'readiness_reassessment',
      'updated_economics_and_capacity',
      'approved_scale_budget',
    ],
    requiredApprovals: 2,
    requiredSignOffAreas: ['finance', 'specialist'],
    approvalExpiryDays: 14,
    approvalExpires: false,
    committeeSeats: ['chair', 'finance', 'operations'],
    requiredSeats: ['finance'],
    authority: { sponsorCeiling: null, committeeCeiling: COMMITTEE_CEILINGS.G3, currency: 'EUR' },
  },
  {
    gateCode: 'X',
    preconditionKeys: ['parent_gate_reviewed', 'extension_cap_set', 'accountable_owner'],
    requiredApprovals: 1,
    requiredSignOffAreas: [],
    approvalExpiryDays: 14,
    approvalExpires: true,
    authority: {
      sponsorCeiling: SPONSOR_CEILINGS.X,
      committeeCeiling: COMMITTEE_CEILINGS.X,
      currency: 'EUR',
    },
    extension: {
      maxBudgetShare: '0.25',
      maxDurationShare: '0.50',
      minDurationDays: 14,
      maxPerParent: 1,
      cumulativeWithinSponsorCeiling: true,
      capRequiredInRealTenants: true,
    },
  },
] as const;

/** Default materiality rule table (PRD §4). Unlisted change types are `uncertain` → escalate to sponsor. */
export const materialityRules = [
  { changeType: 'geography_changed', classification: 'material' },
  { changeType: 'product_changed', classification: 'material' },
  { changeType: 'segment_changed', classification: 'material' },
  { changeType: 'spend_ceiling_changed', classification: 'material' },
  { changeType: 'decision_critical_assumption_changed', classification: 'material' },
  { changeType: 'model_version_changed', classification: 'material' },
  { changeType: 'source_superseded_or_deleted', classification: 'uncertain' },
  { changeType: 'specialist_scope_changed', classification: 'material' },
  { changeType: 'plan_tasks_changed', classification: 'material' },
  { changeType: 'plan_destination_changed', classification: 'material' },
  { changeType: 'comment_or_formatting', classification: 'not_material' },
] as const;

/**
 * Licences (D-120). Fail closed: a licence without a written confirmation allows metadata only. The two
 * licences that grant excerpts carry an illustrative confirmation; the vendor estimate has none.
 */
export const ASTER_LICENSE_CONFIRMATION = {
  documentRef: 'Licence confirmation · illustrative · synthetic',
  confirmedOn: '2026-01-15',
} as const;
export const licenses = [
  {
    id: fid('license', 1),
    key: 'site-census',
    name: 'Site census · [Publisher]',
    boundaryText: 'Internal use · excerpts up to 2 sentences · no redistribution of site lists',
    maxExcerptSentences: 2,
    allowModelContext: true,
    allowEmbeddings: false,
    allowExport: false,
    rightsConfirmation: ASTER_LICENSE_CONFIRMATION,
    termEndsOn: '2027-12-31',
    onExpiry: 'remove_content_keep_metadata',
  },
  {
    id: fid('license', 2),
    key: 'vendor-estimate',
    name: 'Vendor market estimate',
    boundaryText: 'Not licensed in this workspace',
    maxExcerptSentences: 0,
    allowModelContext: false,
    allowEmbeddings: false,
    allowExport: false,
    rightsConfirmation: null,
    termEndsOn: null,
    onExpiry: 'remove_content_keep_metadata',
  },
  {
    id: fid('license', 3),
    key: 'authorized-upload',
    name: 'Authorized uploads',
    boundaryText: 'Internal use · quote with attribution',
    maxExcerptSentences: 2,
    allowModelContext: true,
    allowEmbeddings: false,
    allowExport: true,
    rightsConfirmation: ASTER_LICENSE_CONFIRMATION,
    termEndsOn: null,
    onExpiry: 'remove_content_keep_metadata',
  },
] as const;

export const sourceEntitlements = [
  { licenseId: licenses[0].id, principalType: 'user', principal: people.maya.id, access: 'excerpt' },
  { licenseId: licenses[0].id, principalType: 'user', principal: people.daniel.id, access: 'excerpt' },
  { licenseId: licenses[0].id, principalType: 'user', principal: people.elena.id, access: 'excerpt' },
  {
    licenseId: licenses[0].id,
    principalType: 'role',
    principal: 'read_only_reviewer',
    access: 'aggregate_only',
  },
  { licenseId: licenses[0].id, principalType: 'role', principal: 'pilot_owner', access: 'aggregate_only' },
  { licenseId: licenses[1].id, principalType: 'role', principal: '*', access: 'none' },
  { licenseId: licenses[2].id, principalType: 'role', principal: 'case_member', access: 'excerpt' },
] as const;

export const connections = [
  {
    id: fid('connection', 1),
    kind: 'market_data',
    provider: 'upload',
    name: 'Market data portal',
    scopeText: 'Read · licensed sources',
    status: 'connected',
    lastSuccessAt: '2026-10-09T08:00:00+02:00',
    usedFor: 'Evidence, discovery',
  },
  {
    id: fid('connection', 2),
    kind: 'task_tool',
    provider: 'jira_simulated',
    name: 'Jira · projects PIL, ME-VAL',
    scopeText: 'Create and assign issues',
    status: 'connected',
    lastSuccessAt: '2026-10-09T07:45:00+02:00',
    usedFor: 'Validation and pilot tasks',
  },
  {
    id: fid('connection', 3),
    kind: 'finance',
    provider: 'upload',
    name: 'Finance export',
    scopeText: 'Read spend by cost centre',
    status: 'expired',
    lastSuccessAt: '2026-10-01T06:00:00+02:00',
    usedFor: 'Spent-to-date figures',
  },
  {
    id: fid('connection', 4),
    kind: 'crm',
    provider: 'none',
    name: 'CRM accounts',
    scopeText: 'Read authorized accounts',
    status: 'missing_permission',
    lastSuccessAt: null,
    usedFor: 'Reachable pool checks',
  },
  {
    id: fid('connection', 5),
    kind: 'trade_registry',
    provider: 'upload',
    name: 'Trade registry',
    scopeText: 'Read · company and site records',
    status: 'unavailable',
    lastSuccessAt: '2026-10-05T22:10:00+02:00',
    usedFor: 'Opportunity discovery',
  },
] as const;

export const connectorMappings = [
  {
    connectionId: connections[1].id,
    purpose: 'validation_tasks',
    destinationProject: 'ME-VAL',
    issueType: 'Task',
  },
  { connectionId: connections[1].id, purpose: 'pilot_tasks', destinationProject: 'PIL', issueType: 'Task' },
] as const;
