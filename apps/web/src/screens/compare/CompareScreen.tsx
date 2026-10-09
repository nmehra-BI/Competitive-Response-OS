/**
 * S04 Compare (prototype: Compare.dc.html). Up to four candidates side by side on a common unit.
 * Missing values show as Unknown (dashed circle), never 0. The optional weighted ranking is
 * computed by the server (WS2 engine): the formula is shown, scores have two decimals, any Unknown
 * input reads "Not ranked — n input missing", and an incomparable market boundary blocks the
 * whole ranking until that candidate is excluded. Weight changes are previewed (pure endpoint)
 * before they are applied as a new version.
 *
 * Deep links: ids=OPP-07,OPP-14,…, comparison=<id>, weights=v2.
 */
import {
  API,
  EVIDENCE_QUALITY_LABELS,
  type Comparison,
  type ComparisonAttribute,
  type ComparisonCell,
  type EvidenceQuality,
  type Opportunity,
  type RankingRow,
  type RankingWeights,
} from '@growth-os/contracts';
import {
  Banner,
  Button,
  CategoricalMark,
  EmptyState,
  EvidenceQualityTag,
  Icon,
  KindTag,
  Mono,
  SensitivityTag,
  SourceChip,
} from '@growth-os/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { api, queryKey } from '../../lib/api-client';
import { useApiQuery, useCommand } from '../../lib/query';
import { Breadcrumb, ErrorPage, LoadingPage, PageHeader, useDocumentTitle } from '../overview/shared';

type Weights = Omit<RankingWeights, 'version'>;
const ROWS: { attr: ComparisonAttribute; label: string }[] = [
  { attr: 'market_boundary', label: 'Market boundary' },
  { attr: 'tam', label: 'TAM · annual market spend' },
  { attr: 'sam', label: 'SAM · annual market spend' },
  { attr: 'growth_evidence', label: 'Growth evidence' },
  { attr: 'product_fit', label: 'Product fit' },
  { attr: 'channel_access', label: 'Channel access' },
  { attr: 'evidence_coverage', label: 'Evidence coverage' },
  { attr: 'investment_need', label: 'Investment need' },
  { attr: 'readiness_blockers', label: 'Readiness blockers' },
  { attr: 'unknowns', label: 'Unknowns' },
];
const STEPS: { key: keyof Weights; label: string }[] = [
  { key: 'productFit', label: 'Product fit' },
  { key: 'channelAccess', label: 'Channel access' },
  { key: 'evidenceCoverage', label: 'Evidence coverage' },
];
const QUALITY_BY_LABEL = Object.fromEntries(
  Object.entries(EVIDENCE_QUALITY_LABELS).map(([k, v]) => [v, k as EvidenceQuality]),
) as Record<string, EvidenceQuality>;

const weightsText = (w: Weights) =>
  `Fit ${w.productFit}% · Access ${w.channelAccess}% · Evidence ${w.evidenceCoverage}%`;
const strip = (w: RankingWeights): Weights => ({
  productFit: w.productFit,
  channelAccess: w.channelAccess,
  evidenceCoverage: w.evidenceCoverage,
});
/** Keep `ids=OPP-07,OPP-14` readable in shared links (URLSearchParams would encode the commas). */
function useReplaceSearch() {
  const navigate = useNavigate();
  return (next: URLSearchParams) =>
    navigate({ search: `?${next.toString().replace(/%2C/g, ',')}` }, { replace: true });
}

const same = (a: Weights, b: Weights) =>
  a.productFit === b.productFit &&
  a.channelAccess === b.channelAccess &&
  a.evidenceCoverage === b.evidenceCoverage;

export default function CompareScreen() {
  useDocumentTitle('Compare');
  const [params] = useSearchParams();
  const replaceSearch = useReplaceSearch();
  const ids = (params.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const comparisonId = params.get('comparison');
  if (comparisonId) return <ComparisonView id={comparisonId} />;
  if (ids.length < 2 || ids.length > 4)
    return (
      <div className="app-page dx-page">
        <PageHeader
          breadcrumb={
            <Breadcrumb
              items={[{ label: 'Opportunities', href: '/me/opportunities' }, { label: 'Compare' }]}
            />
          }
          title="Compare candidates"
        />
        <EmptyState
          title="Choose 2 to 4 candidates"
          action={
            <Button variant="secondary" href="/me/opportunities">
              Open opportunities
            </Button>
          }
        >
          Select the candidates to compare in Opportunities. A comparison holds up to four.
        </EmptyState>
      </div>
    );
  return (
    <CreateComparison
      refs={ids}
      onCreated={(id) => {
        const next = new URLSearchParams(params);
        next.set('comparison', id);
        replaceSearch(next);
      }}
    />
  );
}

/** Opens the comparison for the candidates in `ids` (the API returns the existing one for the same set). */
function CreateComparison({ refs, onCreated }: { refs: string[]; onCreated: (id: string) => void }) {
  const first = useApiQuery(API.opportunities.get, { params: { ref: refs[0]! } });
  const create = useCommand(API.comparisons.create, { onSuccess: (c) => onCreated(c.id) });
  const mandateId = first.data?.mandateId;
  const sig = refs.join(',');
  useEffect(() => {
    if (mandateId) create.mutate({ body: { mandateId, opportunityRefs: sig.split(',') } });
    // Re-run only when the candidate set changes; a repeat for the same set reuses the intent's key.
  }, [mandateId, sig]);
  if (first.error) return <ErrorPage title="Compare candidates" error={first.error} />;
  if (create.error) return <ErrorPage title="Compare candidates" error={create.error} />;
  return <LoadingPage label="Compare candidates" />;
}

function CellView({ cell }: { cell: ComparisonCell | undefined }) {
  if (!cell) return <KindTag kind="unknown" small />;
  const detail = cell.detailText ? (
    <div className="dx-small dx-muted" style={{ marginTop: 3 }}>
      {cell.detailText}
    </div>
  ) : null;
  const chips = cell.sources.length ? (
    <div className="dx-row" style={{ gap: 4, marginTop: 4 }}>
      {cell.sources.map((s) => (
        <SourceChip
          key={s.sourceId}
          label={s.label}
          quality={s.quality}
          restricted={s.restricted}
          href={`/evidence/${s.key}`}
        />
      ))}
    </div>
  ) : null;
  if (cell.incomparable && cell.attribute === 'market_boundary')
    return (
      <span className="dx-inline" style={{ alignItems: 'flex-start' }}>
        <span className="dx-glyph-warn" style={{ marginTop: 2 }}>
          <Icon name="alert" size={14} />
        </span>
        <span>
          <span className="gos-sr-only">Incomparable boundary: </span>
          {cell.valueText}
        </span>
      </span>
    );
  if (cell.incomparable)
    return <span className="dx-muted">{cell.detailText ?? cell.valueText ?? 'Not comparable'}</span>;
  if (cell.unknown)
    return (
      <div>
        <KindTag kind="unknown" small />
        {detail}
      </div>
    );
  if (cell.rating !== null && cell.ratingLabel)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span className="dx-inline" style={{ fontWeight: 500 }}>
          <SensitivityTag level={cell.ratingLabel.toLowerCase() as 'high' | 'medium' | 'low'} />
          <Mono size={12}>{cell.rating}/3</Mono>
        </span>
        {cell.detailText ? <span className="dx-small dx-muted">{cell.detailText}</span> : null}
      </div>
    );
  // `evidenceQuality` (D-068); an API that predates it only sends the label as valueText.
  const quality =
    cell.attribute === 'growth_evidence'
      ? (cell.evidenceQuality ?? (cell.valueText ? QUALITY_BY_LABEL[cell.valueText] : undefined))
      : undefined;
  if (quality)
    return (
      <div>
        <EvidenceQualityTag quality={quality} />
        {detail}
      </div>
    );
  const strong = cell.attribute === 'tam' || cell.attribute === 'sam';
  return (
    <div>
      {strong ? <b style={{ fontWeight: 600 }}>{cell.valueText}</b> : cell.valueText}
      {detail}
      {chips}
    </div>
  );
}

function RankCell({ row, ranked }: { row: RankingRow | undefined; ranked: RankingRow[] }) {
  if (!row) return <span className="dx-muted">—</span>;
  if (!row.ranked)
    return (
      <span className="dx-inline dx-muted" style={{ alignItems: 'flex-start', fontSize: 12.5 }}>
        <span style={{ marginTop: 2, display: 'inline-flex' }}>
          <Icon name="dashcircle" size={13} />
        </span>
        <span>{row.reason}</span>
      </span>
    );
  // `rank` (D-068); an API that predates it returns ranked rows in rank order.
  const rank = row.rank ?? ranked.findIndex((r) => r.opportunityId === row.opportunityId) + 1;
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <b style={{ fontWeight: 600, fontSize: 14 }}>
        Rank {rank} of {ranked.length}
      </b>
      <Mono size={12}>Score {row.score} of 3</Mono>
    </span>
  );
}

function ComparisonView({ id }: { id: string }) {
  const [params] = useSearchParams();
  const replaceSearch = useReplaceSearch();
  const cmp = useApiQuery(API.comparisons.get, { params: { id } });
  const opps = useApiQuery(
    API.opportunities.list,
    { query: { mandateId: cmp.data?.mandateId ?? '' } },
    { enabled: !!cmp.data },
  );
  if (cmp.isPending || (cmp.data && opps.isPending)) return <LoadingPage label="Compare candidates" />;
  if (cmp.error) return <ErrorPage title="Compare candidates" error={cmp.error} />;
  if (opps.error) return <ErrorPage title="Compare candidates" error={opps.error} />;
  return (
    <Loaded
      c={cmp.data}
      opps={opps.data!.items}
      weightsParam={params.get('weights')}
      onApplied={(v) => {
        const next = new URLSearchParams(params);
        next.set('weights', `v${v}`);
        replaceSearch(next);
      }}
    />
  );
}

function Loaded({
  c,
  opps,
  weightsParam,
  onApplied,
}: {
  c: Comparison;
  opps: Opportunity[];
  weightsParam: string | null;
  onApplied: (version: number) => void;
}) {
  const applied = strip(c.weights);
  const [draft, setDraft] = useState<Weights>(applied);
  const previewing = !same(draft, applied);
  const total = draft.productFit + draft.channelAccess + draft.evidenceCoverage;
  const preview = useQuery({
    queryKey: queryKey(API.comparisons.previewRanking, { id: c.id }, draft),
    queryFn: () => api(API.comparisons.previewRanking, { params: { id: c.id }, body: draft }),
    enabled: previewing,
    staleTime: 60_000,
  });
  const apply = useCommand(API.comparisons.applyWeights, {
    onSuccess: (res) => {
      setDraft(strip(res.weights));
      onApplied(res.weights.version);
    },
  });
  const exclusion = useCommand(API.comparisons.setExclusion);
  const select = useCommand(API.comparisons.select);
  const headId = useId();

  const byId = new Map(opps.map((o) => [o.id, o]));
  const cols = c.opportunityIds.map((oid, i) => ({ id: oid, o: byId.get(oid), i }));
  const nameOf = (oid: string) => byId.get(oid)?.name ?? 'Candidate';
  const cell = (oid: string, attr: ComparisonAttribute) =>
    c.cells.find((x) => x.opportunityId === oid && x.attribute === attr);
  const ranking = previewing && preview.data ? preview.data.ranking : c.ranking;
  const ranked = ranking.filter((r) => r.ranked);
  const blocking = c.incomparableWarnings.filter((w) => !c.excludedOpportunityIds.includes(w.opportunityId));
  const excluded = c.incomparableWarnings.filter((w) => c.excludedOpportunityIds.includes(w.opportunityId));
  const linkVersion = weightsParam ? Number(weightsParam.replace(/^v/, '')) : null;
  const canApply = previewing && total === 100 && !apply.isPending;
  const error = apply.error ?? exclusion.error ?? select.error;

  return (
    <div className="app-page dx-page">
      <PageHeader
        breadcrumb={
          <Breadcrumb items={[{ label: 'Opportunities', href: '/me/opportunities' }, { label: 'Compare' }]} />
        }
        title={`Compare ${c.opportunityIds.length} candidates`}
        subtitle={`${c.commonUnitLabel}. Missing values show as Unknown, never 0.`}
        actions={
          <span className="dx-muted" style={{ fontSize: 12.5 }}>
            Up to 4 candidates
          </span>
        }
      />

      {linkVersion &&
      linkVersion !== c.weights.version &&
      c.weightsHistory.some((w) => w.version === linkVersion) ? (
        <Banner
          tone="neutral"
          title={`This link shows weights v${linkVersion}; weights v${c.weights.version} are now applied`}
          body={`Applied now: ${weightsText(applied)}. Earlier versions are kept.`}
        />
      ) : null}

      {blocking.map((w) => (
        <Banner
          key={w.opportunityId}
          tone="warn"
          title="Aggregate ranking blocked — incomparable market boundary"
          body={w.message}
          actions={
            <>
              <Button
                variant="secondary"
                disabled={exclusion.isPending}
                onClick={() =>
                  exclusion.mutate({
                    params: { id: c.id, opportunityId: w.opportunityId },
                    body: { excluded: true, reason: 'Excluded until normalized' },
                  })
                }
              >
                Exclude until normalized
              </Button>
              <Button
                variant="ghost"
                href={`/me/opportunities?selected=${byId.get(w.opportunityId)?.key ?? ''}`}
              >
                Open candidate
              </Button>
            </>
          }
        />
      ))}
      {excluded.map((w) => (
        <Banner
          key={w.opportunityId}
          tone="neutral"
          title={`${nameOf(w.opportunityId)} excluded from ranking until normalized`}
          body="It stays in the comparison. Ranking covers the remaining candidates with complete inputs."
          actions={
            <Button
              variant="ghost"
              disabled={exclusion.isPending}
              onClick={() =>
                exclusion.mutate({
                  params: { id: c.id, opportunityId: w.opportunityId },
                  body: { excluded: false, reason: null },
                })
              }
            >
              Include again
            </Button>
          }
        />
      ))}
      {error ? <ProblemBanner error={error} /> : null}

      <section aria-labelledby={headId} className="dx-box dx-stack" style={{ padding: '14px 16px' }}>
        <div className="dx-row" style={{ gap: '8px 14px', alignItems: 'baseline' }}>
          <h2 id={headId} style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            Optional weighted ranking
          </h2>
          <span className="dx-muted" style={{ fontSize: 12.5 }}>
            Applied: weights v{c.weights.version} · {weightsText(applied)}
          </span>
        </div>
        <div className="dx-mono-box">{c.formulaText}</div>
        <div className="dx-row" style={{ gap: '16px 28px', alignItems: 'flex-end' }}>
          {STEPS.map((s) => (
            <div key={s.key} className="dx-stepper" role="group" aria-label={`${s.label} weight`}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }} aria-hidden="true">
                {s.label}
              </span>
              <div className="dx-stepper__row">
                <button
                  type="button"
                  className="gos-ibtn"
                  aria-label={`Decrease ${s.label} weight`}
                  disabled={draft[s.key] <= 0}
                  onClick={() => setDraft((w) => ({ ...w, [s.key]: Math.max(0, w[s.key] - 10) }))}
                >
                  <Icon name="minus" size={14} />
                </button>
                <output aria-live="polite" aria-label={`${s.label} weight`}>
                  {draft[s.key]}%
                </output>
                <button
                  type="button"
                  className="gos-ibtn"
                  aria-label={`Increase ${s.label} weight`}
                  disabled={draft[s.key] >= 100}
                  onClick={() => setDraft((w) => ({ ...w, [s.key]: Math.min(100, w[s.key] + 10) }))}
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span
              role="status"
              style={{
                fontSize: 12.5,
                color: total === 100 ? 'var(--text-secondary)' : 'var(--warning-fg)',
                fontWeight: total === 100 ? 400 : 600,
              }}
            >
              Total {total}%{total === 100 ? '' : ' — must be 100%'}
            </span>
            <div className="dx-row">
              <Button
                variant="primary"
                disabled={!canApply}
                disabledReason={
                  apply.isPending
                    ? 'Applying…'
                    : !previewing
                      ? 'Change a weight to preview it first.'
                      : 'Weights must total 100%.'
                }
                onClick={() => apply.mutate({ params: { id: c.id }, body: draft })}
              >
                Apply weights
              </Button>
              <Button variant="ghost" onClick={() => setDraft(applied)}>
                Reset
              </Button>
            </div>
          </div>
        </div>
        {previewing ? (
          <p className="dx-inline" style={{ margin: 0, fontSize: 12.5 }}>
            <span style={{ color: 'var(--info-fg)', display: 'inline-flex' }}>
              <Icon name="eye" size={14} />
            </span>
            Previewing unapplied weights in the ranking row. Applying creates weights v{c.weights.version + 1}
            ; earlier versions are kept.
          </p>
        ) : null}
      </section>

      <div className="dx-list">
        <div className="gos-table-scroll">
          <table className="dx-cmp" aria-label="Candidate comparison">
            <thead>
              <tr>
                <th scope="col">Attribute</th>
                {cols.map(({ id, o, i }) => (
                  <th key={id} scope="col">
                    <span className="dx-cmp__col">
                      <CategoricalMark index={(i + 1) as 1 | 2 | 3 | 4} />
                      {o?.name ?? 'Candidate'}
                    </span>
                    <span style={{ display: 'block', marginTop: 2 }}>
                      <Mono size={12}>{o?.key}</Mono>
                      {c.excludedOpportunityIds.includes(id) ? (
                        <span className="dx-cmp__excluded"> · excluded from ranking</span>
                      ) : null}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.attr}>
                  <th scope="row">{r.label}</th>
                  {cols.map(({ id }) => (
                    <td key={id}>
                      <CellView cell={cell(id, r.attr)} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="dx-cmp__rank">
                <th scope="row" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  Weighted ranking
                  <div className="dx-faint" style={{ fontWeight: 400, fontSize: 12 }}>
                    {previewing ? `Preview · ${weightsText(draft)}` : weightsText(applied)}
                  </div>
                </th>
                {cols.map(({ id }) => (
                  <td key={id} aria-live={previewing ? 'polite' : undefined}>
                    {previewing && preview.isPending ? (
                      <span className="dx-muted">Calculating…</span>
                    ) : (
                      <RankCell row={ranking.find((x) => x.opportunityId === id)} ranked={ranked} />
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Action</th>
                {cols.map(({ id, o }) => {
                  const incomparable = c.incomparableWarnings.some((w) => w.opportunityId === id);
                  if (c.selectedOpportunityId === id)
                    return (
                      <td key={id}>
                        <span
                          className="dx-inline"
                          role="status"
                          style={{ color: 'var(--success-fg)', fontWeight: 500 }}
                        >
                          <Icon name="checkcircle" size={14} />
                          <span style={{ color: 'var(--text-primary)' }}>
                            Selected for assessment · shortlisted
                          </span>
                        </span>
                        <div style={{ marginTop: 6 }}>
                          <Button variant="ghost" href={`/me/opportunities?selected=${o?.key ?? ''}`}>
                            Open in Opportunities
                          </Button>
                        </div>
                      </td>
                    );
                  return (
                    <td key={id}>
                      <Button
                        variant="secondary"
                        disabled={incomparable || select.isPending}
                        disabledReason={incomparable ? 'Normalize the boundary first.' : 'Selecting…'}
                        onClick={() => select.mutate({ params: { id: c.id }, body: { opportunityId: id } })}
                        ariaLabel={`Select ${o?.name ?? 'candidate'} for assessment`}
                      >
                        Select for assessment
                      </Button>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="dx-faint" style={{ margin: 0, fontSize: 12.5 }}>
        Ratings are assessments by the named reviewers, not computed confidence. Selecting a candidate opens
        assessment; it does not approve spend.
      </p>
    </div>
  );
}
