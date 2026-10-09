/**
 * S02 mandate mocks: mandates.* and the G0 gate (gates.get / package / decide), built from
 * fixtures/aster. MD-21 starts approved with its history (v1 returned on 3 Oct, v2 approved on
 * 5 Oct). New mandates (MD-22, …) run the whole G0 loop: draft → submit → return with comment →
 * resubmit → approve. State is persisted per tab so the loop survives a persona switch.
 *
 * gates.* are shared endpoints: they are claimed only for G0 requests this store owns (`scoped`).
 */
import {
  API,
  toFingerprint,
  type ApprovalPanelState,
  type DecisionPackageView,
  type GateDisposition,
  type GateRequest,
  type GateStatus,
  type Mandate,
  type MandateDraftFields,
  type MandateStatus,
} from '@growth-os/contracts';
import {
  authorityGrants,
  businessUnits,
  fid,
  gates,
  journeyMoments as J,
  mandate as MD21,
  people,
  products,
  segments,
} from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { personRef } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { mockHash, mockUuid, persisted, scoped } from './mock-kit';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface VersionRec {
  id: string;
  version: number;
  state: 'draft' | 'committed';
  fields: MandateDraftFields;
  committedAt: string | null;
  rowVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
interface DecisionRec {
  snapshotVersion: number;
  disposition: GateDisposition;
  rationale: string;
  note: string | null;
  by: string;
  at: string;
}
interface G0Rec {
  id: string;
  submittedBy: string | null;
  submittedAt: string | null;
  decisions: DecisionRec[];
}
export interface MandateRec {
  id: string;
  key: string;
  businessUnitId: string;
  title: string;
  status: MandateStatus;
  createdBy: string;
  versions: VersionRec[];
  g0: G0Rec | null;
}
interface Store {
  mandates: MandateRec[];
  seq: number;
}

const v2 = MD21.versions[1];
const MD21_V2_FIELDS: MandateDraftFields = {
  objective: v2.objective,
  productId: v2.productId,
  segmentIds: [...v2.segmentIds],
  geographyCodes: [...v2.geographyCodes],
  exclusions: [...v2.exclusions],
  horizonYears: v2.horizonYears,
  pilotDurationDays: v2.pilotDurationDays,
  investmentCeiling: v2.investmentCeiling,
  currency: v2.currency,
  evidenceSourceKinds: [...v2.evidenceSourceKinds],
  ownerId: v2.ownerId,
  sponsorId: v2.sponsorId,
  successDefinition: v2.successDefinition,
};

function initial(): Store {
  // v1 as returned on 3 Oct: no owner, no currency, outreach exclusion missing.
  const { ownerId: _o, currency: _c, ...v1Fields } = MD21_V2_FIELDS;
  return {
    seq: 0,
    mandates: [
      {
        id: MD21.id,
        key: MD21.key,
        businessUnitId: MD21.businessUnitId,
        title: MD21.title,
        status: 'approved',
        createdBy: people.maya.id,
        versions: [
          {
            id: MD21.versions[0].id,
            version: 1,
            state: 'committed',
            fields: { ...v1Fields, exclusions: ['No spend outside approved gates'] },
            committedAt: '2026-10-02T16:00:00+02:00',
            rowVersion: 4,
            createdBy: people.maya.id,
            createdAt: J.mandateDrafted,
            updatedAt: '2026-10-02T16:00:00+02:00',
          },
          {
            id: v2.id,
            version: 2,
            state: 'committed',
            fields: MD21_V2_FIELDS,
            committedAt: v2.submittedAt,
            rowVersion: 3,
            createdBy: people.maya.id,
            createdAt: '2026-10-03T10:00:00+02:00',
            updatedAt: v2.submittedAt,
          },
        ],
        g0: {
          id: gates.g0.id,
          submittedBy: people.maya.id,
          submittedAt: v2.submittedAt,
          decisions: gates.g0.history.map((h) => ({
            snapshotVersion: h.snapshotVersion,
            disposition: h.disposition,
            rationale: h.rationale,
            note: null,
            by: h.by,
            at: h.at,
          })),
        },
      },
    ],
  };
}

export const mandateStore = persisted<Store>('mandates', initial);

export function findMandate(ref: string): MandateRec | null {
  return mandateStore.get().mandates.find((m) => m.key === ref || m.id === ref) ?? null;
}
function byG0(id: string): MandateRec | null {
  return mandateStore.get().mandates.find((m) => m.g0?.id === id) ?? null;
}
const latestCommitted = (m: MandateRec) => [...m.versions].reverse().find((v) => v.state === 'committed');
const draftOf = (m: MandateRec) => m.versions.find((v) => v.state === 'draft');
const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Server-side rules the API implements (validation, scope preview)
// ---------------------------------------------------------------------------

const nameOf = (id: string | undefined) =>
  id ? (Object.values(people).find((p) => p.id === id)?.displayName ?? null) : null;
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const horizonText = (y: number) => (y === 1 ? '12 months' : `${y} years`);

function moneyText(amount: string | null | undefined, currency: string | undefined): string {
  if (!amount) return '[spend ceiling missing]';
  const n = Number(amount).toLocaleString('en-GB', { maximumFractionDigits: 0 });
  if (!currency) return `${n} [currency missing]`;
  return currency === 'EUR' ? `€${n}` : `${currency} ${n}`;
}

export function validationErrors(f: MandateDraftFields): { field: string; message: string }[] {
  const e: { field: string; message: string }[] = [];
  if (!f.objective?.trim()) e.push({ field: 'objective', message: 'State the objective.' });
  if (!f.productId || !f.segmentIds?.length || !f.geographyCodes?.length)
    e.push({ field: 'scope', message: 'Product, segment and geography are required.' });
  if (!f.ownerId) e.push({ field: 'ownerId', message: 'Name an accountable owner.' });
  if (!f.currency) e.push({ field: 'currency', message: 'Choose the currency for the spend ceiling.' });
  if (!f.horizonYears) e.push({ field: 'horizonYears', message: 'Choose the mandate horizon.' });
  else {
    const year = /end of year (\d+)/i.exec(f.successDefinition ?? '');
    if (year && Number(year[1]) > f.horizonYears)
      e.push({
        field: 'horizonYears',
        message: `Success is stated for end of year ${year[1]}, but the mandate horizon is ${horizonText(f.horizonYears)}. Align them.`,
      });
    else if (f.pilotDurationDays && f.pilotDurationDays > f.horizonYears * 365)
      e.push({
        field: 'horizonYears',
        message: `Pilot ${f.pilotDurationDays} days exceeds the mandate horizon.`,
      });
  }
  if (!f.successDefinition?.trim())
    e.push({ field: 'successDefinition', message: 'State how success will be decided.' });
  return e;
}

export function scopePreview(f: MandateDraftFields): string {
  const seg = (f.segmentIds ?? [])
    .map((id) =>
      segments
        .find((s) => s.id === id)
        ?.name.toLowerCase()
        .replace(/\s+/g, '-'),
    )
    .filter(Boolean)
    .join(' and ');
  const geo = (f.geographyCodes ?? []).map((c) => regionNames.of(c) ?? c).join(', ');
  const product = products.find((p) => p.id === f.productId)?.name.toLowerCase() ?? '[product missing]';
  const days = f.pilotDurationDays ? `a ${f.pilotDurationDays}-day pilot` : 'a pilot of [duration]';
  const exclusions = f.exclusions?.length ? ` Excludes: ${f.exclusions.join(' · ')}.` : '';
  return (
    `Evaluate ${seg ? `${seg} plants` : '[segment missing]'} in ${geo || '[geography missing]'} for the existing ` +
    `${product} over ${f.horizonYears ? horizonText(f.horizonYears) : '[horizon missing]'}, with up to ` +
    `${moneyText(f.investmentCeiling, f.currency)} pilot spend in ${days}, owned by ` +
    `${nameOf(f.ownerId) ?? '[owner missing]'}. Sponsor ${nameOf(f.sponsorId) ?? '[sponsor missing]'} ` +
    `approves this scope at G0. A later scale decision is separate.${exclusions}`
  );
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

function versionView(m: MandateRec, v: VersionRec) {
  return { ...v, mandateId: m.id, fields: { ...v.fields } };
}

export function mandateView(m: MandateRec): Mandate {
  const current = latestCommitted(m) ?? null;
  const draft = draftOf(m) ?? null;
  const shown = draft ?? current;
  return {
    id: m.id,
    key: m.key,
    businessUnitId: m.businessUnitId,
    title: m.title,
    status: m.status,
    currentVersion: current ? versionView(m, current) : null,
    draftVersion: draft ? versionView(m, draft) : null,
    g0GateRequestId: m.g0?.id ?? null,
    scopePreview: shown ? scopePreview(shown.fields) : '',
    validationErrors: draft ? validationErrors(draft.fields) : [],
  };
}

function snapshotIdFor(m: MandateRec, version: number): string {
  if (m.key === 'MD-21') return fid('snapshot', 19 + version); // v2 → snapshot 21 (WS7 base)
  return mockUuid(3, mandateStore.get().mandates.indexOf(m) * 100 + version);
}
const hashFor = (m: MandateRec, version: number) => mockHash(`${m.key}:G0:v${version}`);

function g0Status(m: MandateRec): GateStatus {
  if (m.status === 'approved') return 'approved';
  if (m.status === 'awaiting_decision') return 'awaiting_decision';
  if (m.status === 'returned') return 'returned_for_revision';
  return 'not_started';
}

function g0Scope(m: MandateRec) {
  const f = (latestCommitted(m) ?? draftOf(m))!.fields;
  return {
    amount: null,
    currency: f.currency ?? null,
    durationDays: null,
    windowStart: null,
    windowEnd: null,
    countryCodes: [...(f.geographyCodes ?? [])],
    segmentLabel: segments.find((s) => s.id === f.segmentIds?.[0])?.name ?? null,
    maxSites: null,
    milestones: [],
    ownerId: f.ownerId ?? null,
    authorizes: [
      'Search and assessment within this scope',
      `Owner ${nameOf(f.ownerId) ?? '[owner missing]'} · horizon ${f.horizonYears ? horizonText(f.horizonYears) : '[horizon missing]'} · ${f.currency ?? '[currency missing]'}`,
    ],
    doesNotAuthorize: [...gates.g0.doesNotAuthorize],
  };
}

export function g0Request(m: MandateRec): GateRequest {
  const g0 = m.g0!;
  const cur = latestCommitted(m)!;
  const status = g0Status(m);
  const last = g0.decisions.at(-1);
  return {
    id: g0.id,
    key: `${m.key}-G0`,
    caseId: null,
    mandateId: m.id,
    gateCode: 'G0',
    status:
      status === 'approved'
        ? 'approved'
        : status === 'returned_for_revision'
          ? 'returned_for_revision'
          : 'awaiting_decision',
    displayStatus: status,
    scope: g0Scope(m),
    buttonLabel: gates.g0.buttonLabel,
    parentGateRequestId: null,
    submittedBy: g0.submittedBy ? personRef(g0.submittedBy) : null,
    submittedAt: g0.submittedAt,
    decidedAt: status !== 'awaiting_decision' && last ? last.at : null,
    expiresAt: null,
    currentSnapshotId: snapshotIdFor(m, cur.version),
    conditions: [],
    rowVersion: 1 + g0.decisions.length * 2,
  };
}

const hasG0Authority = (userId: string | null, buId: string) =>
  authorityGrants.some(
    (a) => a.userId === userId && a.gateCode === 'G0' && (a.businessUnitId === buId || !a.businessUnitId),
  );
const buName = (id: string) => businessUnits.find((b) => b.id === id)?.name ?? 'this business unit';

function panelFor(m: MandateRec, viewerId: string | null): ApprovalPanelState {
  const f = latestCommitted(m)!.fields;
  const sponsorId = f.sponsorId ?? people.elena.id;
  const sponsor = personRef(sponsorId);
  const awaiting = m.status === 'awaiting_decision';
  const base = {
    chain: [
      {
        approver: sponsor,
        routingReason: `Mandate scope in ${buName(m.businessUnitId)} routes to the sponsor`,
        state: awaiting ? ('waiting' as const) : ('decided' as const),
        isViewer: viewerId === sponsorId,
      },
    ],
    requiredApprovals: 1,
    receivedApprovals: m.status === 'approved' ? 1 : 0,
  };
  const authorityText = hasG0Authority(viewerId, m.businessUnitId)
    ? `G0 · ${buName(m.businessUnitId)} · mandate scope`
    : null;
  if (!awaiting)
    return {
      ...base,
      canDecide: false,
      allowedDispositions: [],
      cannotDecideReason: null,
      viewerAuthorityText: authorityText,
    };
  let reason: string | null = null;
  if (viewerId === f.ownerId || viewerId === m.g0?.submittedBy)
    reason = 'You own this mandate and cannot approve its G0.';
  else if (viewerId === people.admin.id) reason = 'Administrators configure policy and never approve gates.';
  else if (viewerId === sponsorId && !hasG0Authority(viewerId, m.businessUnitId))
    reason = `You have no G0 authority for ${buName(m.businessUnitId)}. Request access from ${people.admin.displayName}.`;
  else if (viewerId !== sponsorId) reason = `Only ${sponsor.displayName} can decide G0 for this mandate.`;
  return {
    ...base,
    canDecide: reason === null,
    allowedDispositions: reason === null ? ['approve', 'return_for_revision'] : [],
    cannotDecideReason: reason,
    viewerAuthorityText: authorityText,
  };
}

export function g0Package(m: MandateRec, viewerId: string | null): DecisionPackageView {
  const g0 = m.g0!;
  const cur = latestCommitted(m)!;
  const req = g0Request(m);
  const hash = hashFor(m, cur.version);
  return {
    gateRequest: req,
    snapshot: {
      id: snapshotIdFor(m, cur.version),
      gateRequestId: g0.id,
      caseId: null,
      version: cur.version,
      status: 'current',
      staleReason: null,
      staleAt: null,
      supersededBySnapshotId: null,
      contentHash: hash,
      fingerprint: toFingerprint(hash),
      createdBy: personRef(g0.submittedBy ?? m.createdBy),
      createdAt: cur.committedAt ?? cur.updatedAt,
      content: {
        schemaVersion: 1,
        caseId: m.id,
        caseKey: m.key,
        gateCode: 'G0',
        ask: `Approve mandate ${m.key} scope v${cur.version} for search and assessment. No spend.`,
        scope: req.scope,
        recommendation: scopePreview(cur.fields),
        alternatives: [],
        evidenceSummary: [],
        assumptions: [],
        validationResults: [],
        economics: null,
        sizing: null,
        signOffs: [],
        budgetAndStopRules: [],
        conditionsProposed: [],
        dissent: [],
        knownLimitations: [],
        blockers: [],
        outcomeTargets: [],
        components: [{ type: 'mandate_version', id: cur.id, version: cur.version }],
      },
    },
    approvals: g0.decisions.map((d, i) => ({
      id: mockUuid(4, mandateStore.get().mandates.indexOf(m) * 100 + i),
      gateRequestId: g0.id,
      snapshotId: snapshotIdFor(m, d.snapshotVersion),
      snapshotHash: hashFor(m, d.snapshotVersion),
      approver: personRef(d.by),
      approverRole: 'sponsor',
      authorityGrantId: authorityGrants[0].id,
      disposition: d.disposition,
      rationale: d.rationale,
      note: d.note,
      delegatedTo: null,
      decidedAt: d.at,
      effective: true,
      invalidation: null,
    })),
    dissent: [],
    positions: [],
    panel: panelFor(m, viewerId),
    changesSinceViewerLastSaw: [],
    staleBanner: null,
    gateHistory: g0.decisions.map((d) => ({
      gateRequestId: g0.id,
      gateCode: 'G0' as const,
      label: `G0 · ${gates.g0.buttonLabel} · v${d.snapshotVersion}`,
      status: (d.disposition === 'approve' ? 'approved' : 'returned_for_revision') as GateStatus,
      snapshotVersion: d.snapshotVersion,
      fingerprint: toFingerprint(hashFor(m, d.snapshotVersion)),
      rationale: d.rationale,
      decidedAt: d.at,
    })),
  };
}

/** "Awaiting your decision" rows for the reviews inbox and the overview. */
export function g0DecisionsFor(viewerId: string | null) {
  return mandateStore
    .get()
    .mandates.filter((m) => m.status === 'awaiting_decision' && m.g0)
    .filter((m) => latestCommitted(m)?.fields.sponsorId === viewerId)
    .map((m) => ({
      gateRequestId: m.g0!.id,
      caseKey: m.key,
      buttonLabel: gates.g0.buttonLabel,
      snapshotVersion: latestCommitted(m)!.version,
      dueText: `Mandate v${latestCommitted(m)!.version} · submitted by ${nameOf(m.g0!.submittedBy ?? undefined) ?? 'the owner'}`,
      href: `/me/mandates/${m.key}`,
    }));
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const ownsG0 = (p: Record<string, string>) => !!p.id && byG0(p.id) !== null;

export const handlers: HttpHandler[] = [
  mock(API.mandates.list, () => ({
    items: mandateStore.get().mandates.map(mandateView),
    nextCursor: null,
  })),
  mock(API.mandates.get, ({ params }) => {
    const m = findMandate(params.ref);
    if (!m) throw notFound();
    return mandateView(m);
  }),
  mock(API.mandates.create, ({ body, viewerId }) => {
    let created: MandateRec | null = null;
    mandateStore.update((s) => {
      s.seq += 1;
      const at = now();
      created = {
        id: mockUuid(1, s.seq),
        key: `MD-${21 + s.seq}`,
        businessUnitId: body.businessUnitId,
        title: body.title,
        status: 'draft',
        createdBy: viewerId!,
        versions: [
          {
            id: mockUuid(5, s.seq * 100 + 1),
            version: 1,
            state: 'draft',
            fields: body.fields,
            committedAt: null,
            rowVersion: 1,
            createdBy: viewerId!,
            createdAt: at,
            updatedAt: at,
          },
        ],
        g0: null,
      };
      s.mandates.push(created);
    });
    return mandateView(created!);
  }),
  mock(API.mandates.saveDraft, ({ params, body, ifMatch }) => {
    const m = findMandate(params.ref);
    if (!m) throw notFound();
    const d = draftOf(m);
    if (!d) throw new MockProblem('INVALID_TRANSITION', 'Submitted versions are read-only.');
    if (ifMatch !== d.rowVersion)
      throw new MockProblem('VERSION_CONFLICT', 'Someone saved a newer version of this draft.');
    mandateStore.update(() => {
      d.fields = { ...d.fields, ...body.fields };
      d.rowVersion += 1;
      d.updatedAt = now();
    });
    return mandateView(m);
  }),
  mock(API.mandates.submit, ({ params, viewerId }) => {
    const m = findMandate(params.ref);
    if (!m) throw notFound();
    const d = draftOf(m);
    if (!d) throw new MockProblem('INVALID_TRANSITION', 'This version is already submitted.');
    const errors = validationErrors(d.fields);
    if (errors.length)
      throw new MockProblem('VALIDATION_FAILED', 'Fix the highlighted items to submit.', {
        errors: errors.map((e) => ({ path: e.field, code: 'required', message: e.message })),
      });
    mandateStore.update((s) => {
      const at = now();
      d.state = 'committed';
      d.committedAt = at;
      m.status = 'awaiting_decision';
      m.g0 = m.g0 ?? {
        id: mockUuid(2, s.mandates.indexOf(m)),
        submittedBy: null,
        submittedAt: null,
        decisions: [],
      };
      m.g0.submittedBy = viewerId;
      m.g0.submittedAt = at;
    });
    return { mandate: mandateView(m), gateRequest: g0Request(m) };
  }),

  // G0 on mandates this store owns. Other gate requests fall through.
  scoped(
    API.gates.get,
    ownsG0,
    mock(API.gates.get, ({ params }) => g0Request(byG0(params.id)!)),
  ),
  scoped(
    API.gates.package,
    ownsG0,
    mock(API.gates.package, ({ params, viewerId }) => g0Package(byG0(params.id)!, viewerId)),
  ),
  scoped(
    API.gates.decide,
    ownsG0,
    mock(API.gates.decide, ({ params, body, viewerId }) => {
      const m = byG0(params.id)!;
      const panel = panelFor(m, viewerId);
      if (m.status !== 'awaiting_decision')
        throw new MockProblem('INVALID_TRANSITION', 'This gate has already been decided.');
      if (!panel.canDecide) {
        const code =
          viewerId === people.admin.id
            ? 'FORBIDDEN'
            : panel.cannotDecideReason?.startsWith('You own')
              ? 'SELF_APPROVAL_PROHIBITED'
              : 'AUTHORITY_INSUFFICIENT';
        throw new MockProblem(code, panel.cannotDecideReason ?? 'You cannot decide this gate.');
      }
      const cur = latestCommitted(m)!;
      if (body.snapshotId !== snapshotIdFor(m, cur.version) || body.snapshotHash !== hashFor(m, cur.version))
        throw new MockProblem('SNAPSHOT_HASH_MISMATCH', 'The snapshot you read is not the current one.');
      if (!panel.allowedDispositions.includes(body.disposition))
        throw new MockProblem('VALIDATION_FAILED', 'G0 is approved or returned for revision.');
      mandateStore.update(() => {
        const at = now();
        m.g0!.decisions.push({
          snapshotVersion: cur.version,
          disposition: body.disposition,
          rationale: body.rationale,
          note: body.note,
          by: viewerId!,
          at,
        });
        if (body.disposition === 'approve') m.status = 'approved';
        else {
          m.status = 'returned';
          m.versions.push({
            ...cur,
            id: mockUuid(5, mandateStore.get().mandates.indexOf(m) * 100 + cur.version + 1),
            version: cur.version + 1,
            state: 'draft',
            fields: { ...cur.fields },
            committedAt: null,
            rowVersion: 1,
            createdAt: at,
            updatedAt: at,
          });
        }
      });
      return g0Package(m, viewerId);
    }),
  ),
];
