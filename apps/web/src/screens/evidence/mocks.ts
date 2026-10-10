/**
 * S13 Evidence mocks (WS8d). Viewer access follows the fixture licence entitlements: the site census
 * shows excerpts to Maya, Daniel and Elena and aggregates only to the pilot owner; the vendor estimate
 * (SRC-030) is restricted for everyone and never returns an excerpt, fact or paraphrase; SRC-011 was
 * deleted by the provider and keeps its provenance; SRC-009 is superseded by SRC-014.
 */
import { API, type EntitlementAccess, type Source, type SourceDetail } from '@growth-os/contracts';
import {
  cases,
  licenses,
  people,
  roleAssignments,
  sourceEntitlements,
  sources,
} from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import type { z } from 'zod';
import { hashFor, mockId, P, personRef } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { at, audit, save, ws8d } from '../history/journey';

type In<S extends z.ZodTypeAny> = z.input<S>;
type Fx = (typeof sources)[number];

const ME104 = cases[0];
const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');
const EVIDENCE_MOMENT = '2026-10-13T09:00:00+02:00';

/** Content fingerprints (illustrative) kept as provenance, including for the deleted source. */
const CONTENT_FP: Record<string, string> = {
  'SRC-014': '5C21·8E0B',
  'SRC-009': '33AF·7D10',
  'SRC-021': 'B7E4·2A91',
  'SRC-030': 'E10D·64C3',
  'SRC-011': '91C0·4A7E',
  'SRC-040': '0D5A·F3B8',
};

/** Prototype copy for the fact / inference / assumption panel and linked uses (S13). */
const PANEL: Record<
  string,
  {
    fact: string | null;
    inferred: string | null;
    assumption: string | null;
    uses: { label: string; where: string; href: string }[];
    impact: string;
  }
> = {
  'SRC-014': {
    fact: 'About 5,000 sites operate a process-water treatment step.',
    inferred: 'Sites with a treatment step are candidates for continuous monitoring.',
    assumption: 'Each site spends about €20k per year on monitoring of this kind.',
    uses: [
      {
        label: 'TAM site count · 5,000',
        where: 'Sizing · ledger',
        href: '/me/cases/ME-104/sizing?input=tam-sites',
      },
      { label: 'Size-qualified cohort · 1,400', where: 'Sizing · cohorts', href: '/me/cases/ME-104/sizing' },
      {
        label: 'Thesis claim: 5,000 sites operate a treatment step',
        where: 'Thesis',
        href: '/me/cases/ME-104/thesis',
      },
    ],
    impact: 'TAM, SAM (via size cohort), G2 package v3',
  },
  'SRC-009': {
    fact: 'Sites are listed by region and size band.',
    inferred: 'The 2025 counts are no longer used.',
    assumption: null,
    uses: [
      {
        label: 'No current claims · moved to SRC-014',
        where: 'History',
        href: '/me/cases/ME-104/history?object=source',
      },
    ],
    impact: 'Sizing v1 only (superseded)',
  },
  'SRC-021': {
    fact: 'About 1,100 sites run the targeted water process.',
    inferred: 'Process-qualified sites overlap with large sites.',
    assumption: 'Overlap is measured by our own dedup, not by this survey.',
    uses: [
      {
        label: 'Process-qualified cohort · 1,100',
        where: 'Sizing · cohorts',
        href: '/me/cases/ME-104/sizing',
      },
    ],
    impact: 'SAM via process cohort',
  },
  'SRC-030': {
    fact: null,
    inferred: null,
    assumption: 'Top-down range in Sizing is an illustrative placeholder.',
    uses: [
      {
        label: 'Top-down cross-check · placeholder range',
        where: 'Sizing · cross-check',
        href: '/me/cases/ME-104/sizing',
      },
    ],
    impact: 'Sizing cross-check only',
  },
  'SRC-011': {
    fact: null,
    inferred: null,
    assumption: null,
    uses: [
      {
        label: 'Process-qualified cohort (Sizing v1) · replaced by SRC-021',
        where: 'History',
        href: '/me/cases/ME-104/history?object=source',
      },
    ],
    impact: 'Sizing v1 only. No current figure depends on it.',
  },
  'SRC-040': {
    fact: null,
    inferred: 'The approved partner channel covers German food plants.',
    assumption: 'Reachable pool is 500 sites through the partner.',
    uses: [{ label: 'Reachable pool · 500', where: 'Sizing · ledger', href: '/me/cases/ME-104/sizing' }],
    impact: 'Reachable pool',
  },
};

/** Entitlement for a viewer on a licence (role grants, user grants, case members). */
export function accessFor(viewerId: string | null, licenseId: string | null): EntitlementAccess {
  if (!viewerId || !licenseId) return 'none';
  const roles = roleAssignments.filter((r) => r.userId === viewerId).map((r) => r.role as string);
  const isMember = roles.some((r) => r !== 'tenant_admin');
  const grants = sourceEntitlements.filter((e) => e.licenseId === licenseId);
  const order: EntitlementAccess[] = ['excerpt', 'aggregate_only', 'none'];
  let best: EntitlementAccess = 'none';
  for (const g of grants) {
    const applies =
      (g.principalType === 'user' && g.principal === viewerId) ||
      (g.principalType === 'role' &&
        (g.principal === '*' || roles.includes(g.principal) || (g.principal === 'case_member' && isMember)));
    if (applies && order.indexOf(g.access) < order.indexOf(best)) best = g.access;
  }
  return best;
}

function byKey(ref: string): Fx | undefined {
  return sources.find((s) => s.key === ref || s.id === ref);
}

export function source(fx: Fx): In<typeof Source> {
  const st = ws8d().evidence;
  const replacement = st.replacedBy[fx.key];
  const superseded = replacement ?? ('supersededBy' in fx ? fx.supersededBy : undefined);
  const supersededId = superseded ? (byKey(superseded)?.id ?? null) : null;
  const stale = st.stale[fx.key];
  return {
    id: fx.id,
    key: fx.key,
    title: fx.title,
    publisher: fx.publisher,
    originKind: fx.originKind,
    originText: fx.originText,
    uri: null,
    contentSha256: hashFor(CONTENT_FP[fx.key] ?? '0000·0000'),
    publishedOn: fx.publishedOn,
    retrievedAt: fx.retrievedAt,
    licenseId: fx.licenseId,
    ingestionStatus: 'ingested',
    availability: fx.availability,
    freshness: replacement ? 'superseded' : stale ? 'stale' : fx.freshness,
    ageingDays: 'ageingDays' in fx ? fx.ageingDays : null,
    supersededBySourceId: supersededId,
    staleReason: stale ?? null,
    deletedAt: 'deletedAt' in fx ? fx.deletedAt : null,
    createdAt: fx.retrievedAt ?? '2026-10-01T09:00:00+02:00',
    createdBy: people.maya.id,
  };
}

export function sourceDetail(fx: Fx, viewerId: string | null): In<typeof SourceDetail> {
  const lic = licenses.find((l) => l.id === fx.licenseId) ?? null;
  const available = fx.availability === 'available';
  const access = available ? accessFor(viewerId, fx.licenseId) : 'none';
  const canQuote = access === 'excerpt';
  const p = PANEL[fx.key] ?? { fact: null, inferred: null, assumption: null, uses: [], impact: '' };
  const challenges = ws8d().evidence.challenges[fx.key] ?? [];
  return {
    source: source(fx),
    license: lic ? { ...lic } : null,
    viewerAccess: access,
    passages: canQuote
      ? fx.passages.map((x) => ({
          id: x.id,
          sourceId: fx.id,
          locator: x.locator,
          excerpt: x.excerpt,
          excerptSha256: hashFor(CONTENT_FP[fx.key] ?? '0000·0000', 1),
        }))
      : [],
    // Restricted and aggregate-only viewers get no quoted fact and no paraphrase (never-rule 8).
    quotedFact: canQuote ? p.fact : null,
    inferredClaim: canQuote && p.inferred ? { text: p.inferred, acceptedBy: P('maya') } : null,
    humanAssumption: p.assumption ? { text: p.assumption, owner: P('maya') } : null,
    linkedUses: p.uses,
    impact: viewerId === people.admin.id ? [] : [{ caseId: ME104.id, caseKey: ME104.key, what: p.impact }],
    challenges: challenges.map((c) => ({
      id: c.id,
      kind: 'challenge' as const,
      targetType: 'source' as const,
      targetId: fx.id,
      caseId: ME104.id,
      raisedBy: personRef(c.raisedBy),
      statement: c.statement,
      proposedValue: null,
      status: 'open' as const,
      resolution: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: c.createdAt,
      replies: [],
    })),
  };
}

function requireSource(ref: string): Fx {
  const fx = byKey(ref);
  if (!fx) throw notFound();
  return fx;
}

function requireHuman(viewerId: string | null) {
  if (viewerId === people.admin.id)
    throw new MockProblem('FORBIDDEN', 'Administrators configure licences and do not correct evidence.');
}

const caseKeys = new Set([ME104.key, ME104.id]);

export const handlers: HttpHandler[] = [
  mock(API.evidence.list, ({ query }) => {
    if (query.caseRef && !caseKeys.has(query.caseRef)) return { items: [], nextCursor: null };
    const order = ['SRC-014', 'SRC-021', 'SRC-009', 'SRC-030', 'SRC-011', 'SRC-040'];
    const items = order.map((k) => source(byKey(k)!));
    return { items: items.slice(0, query.limit), nextCursor: null };
  }),

  mock(API.evidence.get, ({ params, viewerId }) => sourceDetail(requireSource(params.ref), viewerId)),

  mock(API.evidence.challenge, ({ params, body, viewerId }) => {
    const fx = requireSource(params.ref);
    requireHuman(viewerId);
    const st = ws8d().evidence;
    const list = (st.challenges[fx.key] ??= []);
    const c = {
      id: mockId(4000 + list.length + 1),
      statement: body.statement,
      raisedBy: viewerId!,
      createdAt: at(EVIDENCE_MOMENT),
    };
    list.push(c);
    audit({
      at: c.createdAt,
      actorId: viewerId,
      actorKind: 'human',
      actorRole: null,
      action: 'source.challenged',
      objectType: 'source',
      objectId: fx.id,
      objectVersion: null,
      summary: `Challenged ${fx.key}`,
      rule: 'evidence.challenge',
    });
    save();
    return sourceDetail(fx, viewerId).challenges.at(-1)!;
  }),

  mock(API.evidence.markStale, ({ params, body, viewerId }) => {
    const fx = requireSource(params.ref);
    requireHuman(viewerId);
    ws8d().evidence.stale[fx.key] = body.reason;
    audit({
      at: at(EVIDENCE_MOMENT),
      actorId: viewerId,
      actorKind: 'human',
      actorRole: null,
      action: 'source.marked_stale',
      objectType: 'source',
      objectId: fx.id,
      objectVersion: null,
      summary: `Marked ${fx.key} stale · materiality check run`,
      rule: 'evidence.mark_stale',
    });
    save();
    return sourceDetail(fx, viewerId);
  }),

  mock(API.evidence.replace, ({ params, body, viewerId }) => {
    const fx = requireSource(params.ref);
    requireHuman(viewerId);
    const repl = sources.find((s) => s.id === body.replacementSourceId);
    if (!repl || repl.id === fx.id) throw new MockProblem('VALIDATION_FAILED', 'Choose a different source.');
    ws8d().evidence.replacedBy[fx.key] = repl.key;
    audit({
      at: at(EVIDENCE_MOMENT),
      actorId: viewerId,
      actorKind: 'human',
      actorRole: null,
      action: 'source.replaced',
      objectType: 'source',
      objectId: fx.id,
      objectVersion: null,
      summary: `Replaced ${fx.key} with ${repl.key} · drafts re-linked; approved snapshots keep the original`,
      rule: 'evidence.replace',
    });
    save();
    return sourceDetail(fx, viewerId);
  }),

  mock(API.evidence.requestAccess, ({ params }) => {
    requireSource(params.ref);
    return { requested: true as const };
  }),
];
