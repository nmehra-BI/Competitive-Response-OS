/**
 * Deterministic fixture ids. Pattern: a57e<kind>-0000-4000-8000-<12-digit n>.
 * Pure string formatting so the fixture also loads in the browser (MSW mocks).
 */
const KINDS = {
  tenant: '0001',
  businessUnit: '0002',
  user: '0003',
  role: '0004',
  authority: '0005',
  policy: '0006',
  license: '0007',
  source: '0008',
  passage: '0009',
  claim: '000a',
  assumption: '000b',
  assumptionVersion: '000c',
  mandate: '000d',
  mandateVersion: '000e',
  opportunity: '000f',
  case: '0010',
  sizingVersion: '0011',
  cohort: '0012',
  economicsVersion: '0013',
  experiment: '0014',
  gateRequest: '0015',
  snapshot: '0016',
  condition: '0017',
  feasibility: '0018',
  task: '0019',
  connection: '001a',
  product: '001b',
  segment: '001c',
  outcomeTarget: '001d',
  observation: '001e',
  taskSet: '001f',
  milestone: '0020',
  challenge: '0021',
  decision: '0022',
  reviewRequest: '0023',
  comparison: '0024',
  boundary: '0025',
} as const;

export type FixtureKind = keyof typeof KINDS;

export function fid(kind: FixtureKind, n: number): string {
  return `a57e${KINDS[kind]}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}
