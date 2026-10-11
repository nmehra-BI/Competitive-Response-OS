/**
 * S03 Opportunities (prototype: Opportunities.dc.html). Split view: candidates on the left,
 * the selected candidate's fit, evidence and unknowns on the right with its actions —
 * Shortlist (s), Dismiss with a reason (d), Merge a likely duplicate (m), Convert to case,
 * Add manually. Discovery is never presented as exhaustive; AI candidates read "Proposed · AI".
 *
 * Deep links: mandate, status, selected, product, geo, segment.
 */
import {
  API,
  OPPORTUNITY_ORIGIN_LABELS,
  type Mandate,
  type Opportunity,
  type OpportunityStatus,
} from '@growth-os/contracts';
import {
  AiBadge,
  Banner,
  Button,
  EmptyState,
  EvidenceQualityTag,
  Eyebrow,
  Icon,
  Kbd,
  Mono,
  OpportunityTag,
  OwnerPicker,
  SegmentedControl,
  SourceChip,
  type IconName,
} from '@growth-os/ui';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';
import { useViewer } from '../../lib/session';
import {
  ErrorPage,
  fmtDateTime,
  LoadingPage,
  PageHeader,
  usePeople,
  useDocumentTitle,
} from '../overview/shared';

type Filter = 'active' | 'detected' | 'shortlisted' | 'dismissed';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'detected', label: 'Detected' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'dismissed', label: 'Dismissed · Duplicate' },
];
const CLOSED: OpportunityStatus[] = ['dismissed', 'duplicate'];
const DISMISS_REASONS = [
  'Outside mandate scope',
  'Outside channel coverage',
  'Insufficient evidence',
  'Not a priority this cycle',
];
const UUID = /^[0-9a-f-]{36}$/i;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function matches(o: Opportunity, f: Filter): boolean {
  if (f === 'active') return !CLOSED.includes(o.status);
  if (f === 'dismissed') return CLOSED.includes(o.status);
  return o.status === f;
}

export default function OpportunitiesScreen() {
  useDocumentTitle('Opportunities');
  const [params] = useSearchParams();
  const mandateParam = params.get('mandate');
  const mandates = useApiQuery(API.mandates.list, { query: {} }, { enabled: !mandateParam });
  const ref =
    mandateParam ??
    mandates.data?.items.find((m) => m.status === 'approved')?.key ??
    mandates.data?.items[0]?.key ??
    null;
  const mandate = useApiQuery(API.mandates.get, { params: { ref: ref ?? '' } }, { enabled: !!ref });
  if (!mandateParam && mandates.isPending) return <LoadingPage label="Opportunities" />;
  if (mandates.error) return <ErrorPage title="Opportunities" error={mandates.error} />;
  if (!ref)
    return (
      <div className="app-page dx-page">
        <PageHeader title="Opportunities" />
        <EmptyState
          title="No mandate yet"
          action={
            <Button variant="primary" icon="plus" href="/me/mandates/new">
              Create a mandate
            </Button>
          }
        >
          Discovery runs inside an approved mandate. Create one and ask your sponsor to approve it at G0.
        </EmptyState>
      </div>
    );
  if (mandate.isPending) return <LoadingPage label="Opportunities" />;
  if (mandate.error) return <ErrorPage title="Opportunities" error={mandate.error} />;
  return <Discovery mandate={mandate.data} />;
}

function Discovery({ mandate }: { mandate: Mandate }) {
  const [params, setParams] = useSearchParams();
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const product = params.get('product');
  const geo = params.get('geo');
  const segment = params.get('segment');
  const list = useApiQuery(API.opportunities.list, {
    query: {
      mandateId: mandate.id,
      productId: product && UUID.test(product) ? product : undefined,
      countryCode: geo && /^[A-Z]{2}$/.test(geo) ? geo : undefined,
      segmentId: segment && UUID.test(segment) ? segment : undefined,
    },
  });
  const [adding, setAdding] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const statusParam = params.get('status') as Filter | null;
  const filter: Filter = FILTERS.some((f) => f.value === statusParam) ? statusParam! : 'active';

  if (list.isPending) return <LoadingPage label="Opportunities" />;
  if (list.error) return <ErrorPage title="Opportunities" error={list.error} />;
  const all = list.data.items;
  const visible = all.filter((o) => matches(o, filter));
  const selectedKey = params.get('selected');
  const selected = all.find((o) => o.key === selectedKey) ?? visible[0] ?? null;
  const compareHref = compare.length >= 2 ? `/me/opportunities/compare?ids=${compare.join(',')}` : undefined;
  const mandateLabel = mandate.title.replace(/^Mandate · /, '');

  return (
    <div className="app-page dx-page">
      <PageHeader
        title="Opportunities"
        subtitle={
          <>
            Mandate <Mono size={12}>{mandate.key}</Mono> · {mandateLabel} ·{' '}
            {mandate.status === 'approved' ? 'G0 approved' : 'G0 not approved yet'}
          </>
        }
        actions={
          <>
            <Button variant="secondary" icon="plus" onClick={() => setAdding(true)}>
              Add manually
            </Button>
            <Button
              variant="secondary"
              icon="compare"
              href={compareHref}
              disabled={!compareHref}
              disabledReason={!compareHref ? 'Select 2 to 4 candidates to compare.' : undefined}
            >
              {`Compare selected${compare.length ? ` (${compare.length})` : ''}`}
            </Button>
          </>
        }
      />

      {list.data.discoveryPartial ? (
        <Banner
          tone="warn"
          title={`Discovery partial — ${plural(list.data.unavailableSources.length, 'source')} unavailable`}
          body={`${list.data.unavailableSources.map((s) => `${s.name} connection is unavailable since ${s.since}`).join('. ')}. Results are not exhaustive. Candidates from the other sources are shown.`}
          actions={
            <>
              <Button variant="secondary" icon="upload" href="/evidence">
                Upload a file instead
              </Button>
              <Button variant="ghost" href="/admin/connections">
                Connection status
              </Button>
            </>
          }
        />
      ) : null}

      {adding ? (
        <AddManual
          mandateId={mandate.id}
          onClose={() => setAdding(false)}
          onAdded={(key) => {
            setAdding(false);
            setParam('selected', key);
          }}
        />
      ) : null}

      <div className="dx-row" style={{ gap: '8px 14px' }}>
        <SegmentedControl<Filter>
          ariaLabel="Status filter"
          value={filter}
          options={FILTERS}
          onChange={(v) => setParam('status', v === 'active' ? null : v)}
        />
        {list.data.filtersText ? (
          <span className="dx-faint" style={{ fontSize: 12.5 }}>
            Filters: {list.data.filtersText}
          </span>
        ) : null}
        <span role="status" className="dx-muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
          {visible.length} of {plural(all.length, 'candidate')} · not an exhaustive search
        </span>
      </div>

      {all.length === 0 ? (
        <EmptyState
          title="No candidates for this mandate yet"
          action={
            <Button variant="secondary" icon="plus" onClick={() => setAdding(true)}>
              Add manually
            </Button>
          }
        >
          Discovery found no candidates with the current filters and sources. Check the filters, connect or
          upload a source, or add a candidate you already know.
        </EmptyState>
      ) : (
        <div className="dx-split">
          <div className="dx-split__main dx-list">
            {visible.length ? (
              <CandidateTable
                rows={visible}
                selectedKey={selected?.key ?? null}
                onSelect={(k) => setParam('selected', k)}
                compare={compare}
                onToggleCompare={(k) =>
                  setCompare((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k].slice(0, 4)))
                }
              />
            ) : (
              <p className="dx-muted" style={{ padding: 20, margin: 0, fontSize: 13 }}>
                No candidates match this filter.
              </p>
            )}
          </div>
          <div className="dx-split__side">
            {selected ? <Detail key={selected.key} o={selected} all={all} mandate={mandate} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function CandidateTable({
  rows,
  selectedKey,
  onSelect,
  compare,
  onToggleCompare,
}: {
  rows: Opportunity[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  compare: string[];
  onToggleCompare: (key: string) => void;
}) {
  return (
    <div className="gos-table-scroll">
      <table className="dx-opps" aria-label="Opportunity candidates">
        <thead>
          <tr>
            <th scope="col">
              <span className="gos-sr-only">Compare</span>
            </th>
            <th scope="col">Market · trigger</th>
            <th scope="col">Fit rationale</th>
            <th scope="col">Evidence · unknowns</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const sel = o.key === selectedKey;
            const inCompare = compare.includes(o.key);
            return (
              <tr key={o.id} data-selected={sel}>
                <td style={{ width: 28, paddingRight: 0 }}>
                  <input
                    type="checkbox"
                    className="dx-check"
                    style={{ width: 16, height: 16, margin: '2px 0 0', accentColor: 'var(--accent)' }}
                    aria-label={`Compare ${o.key} ${o.name}`}
                    checked={inCompare}
                    disabled={!inCompare && compare.length >= 4}
                    onChange={() => onToggleCompare(o.key)}
                  />
                </td>
                <th scope="row" style={{ minWidth: 220 }}>
                  <button
                    type="button"
                    className="dx-pick"
                    aria-pressed={sel}
                    onClick={() => onSelect(o.key)}
                  >
                    <span className="dx-pick__name">{o.name}</span>
                    <span className="dx-row" style={{ gap: 6 }}>
                      <Mono size={12}>{o.key}</Mono>
                      {o.origin === 'ai' && o.status === 'detected' ? <AiBadge variant="proposed" /> : null}
                      {o.origin === 'manual' ? (
                        <span className="dx-small dx-muted">{OPPORTUNITY_ORIGIN_LABELS.manual}</span>
                      ) : null}
                    </span>
                    <span className="dx-muted" style={{ fontSize: 12.5 }}>
                      <span className="dx-faint">Trigger</span> {o.trigger}
                    </span>
                  </button>
                </th>
                <td style={{ minWidth: 200 }}>{o.fitRationale}</td>
                <td style={{ width: 140 }}>
                  <EvidenceQualityTag quality={o.evidenceQuality} />
                  <div className="dx-small dx-muted" style={{ marginTop: 3 }}>
                    {o.sourceCount ? plural(o.sourceCount, 'source') : 'No sources'}
                  </div>
                  <div className="dx-small dx-muted dx-inline" style={{ marginTop: 3, gap: 4 }}>
                    <Icon name="dashcircle" size={12} />
                    {plural(o.unknownCount, 'unknown')}
                  </div>
                </td>
                <td style={{ width: 132 }}>
                  <OpportunityTag status={o.status} />
                  <div className="dx-small dx-faint" style={{ marginTop: 4 }}>
                    {o.lastCheckedAt ? `Checked ${fmtDateTime(o.lastCheckedAt)}` : 'Not checked'}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const FIT_GLYPH: Record<
  Opportunity['fitCriteria'][number]['result'],
  { icon: IconName; cls: string; word: string }
> = {
  met: { icon: 'check', cls: 'dx-glyph-ok', word: 'yes' },
  not_met: { icon: 'x', cls: 'dx-muted', word: 'no' },
  unknown: { icon: 'help', cls: 'dx-glyph-warn', word: 'unknown' },
};

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
}

function Detail({ o, all, mandate }: { o: Opportunity; all: Opportunity[]; mandate: Mandate }) {
  const viewer = useViewer();
  const { people } = usePeople();
  const [mode, setMode] = useState<'idle' | 'dismiss' | 'convert'>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const shortlist = useCommand(API.opportunities.shortlist);
  const dismiss = useCommand(API.opportunities.dismiss);
  const merge = useCommand(API.opportunities.merge);
  const convert = useCommand(API.opportunities.convert);
  const cases = useApiQuery(API.overview.listCases, { query: {} }, { enabled: o.status === 'converted' });
  const headingRef = useRef<HTMLHeadingElement>(null);

  const dupTarget = o.likelyDuplicateOfId ? all.find((x) => x.id === o.likelyDuplicateOfId) : undefined;
  const mergedInto = o.duplicateOfId ? all.find((x) => x.id === o.duplicateOfId) : undefined;
  const closed = CLOSED.includes(o.status);
  const busy = shortlist.isPending || dismiss.isPending || merge.isPending || convert.isPending;
  const error = shortlist.error ?? dismiss.error ?? merge.error ?? convert.error;
  const convertedCase = convert.data?.case ?? cases.data?.items.find((c) => c.id === o.convertedCaseId);
  const ownerId = owner ?? viewer.data?.user.id ?? null;

  const act = {
    shortlist: () => shortlist.mutate({ params: { ref: o.key } }),
    dismiss: () => {
      setMode('dismiss');
      setReason(null);
    },
    merge: () =>
      dupTarget && merge.mutate({ params: { ref: o.key }, body: { targetOpportunityId: dupTarget.id } }),
  };
  // Keyboard: s shortlist · d dismiss · m merge (FRONTEND §8), never while typing.
  const actRef = useRef(act);
  actRef.current = act;
  const canRef = useRef({ s: false, d: false, m: false });
  canRef.current = {
    s: o.status === 'detected' && !busy,
    d: !closed && o.status !== 'converted' && !busy,
    m: !!dupTarget && !busy,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 's' && canRef.current.s) actRef.current.shortlist();
      else if (k === 'd' && canRef.current.d) actRef.current.dismiss();
      else if (k === 'm' && canRef.current.m) actRef.current.merge();
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <aside className="dx-detail" aria-labelledby="opp-detail-title">
      <div>
        <div className="dx-row" style={{ gap: 8 }}>
          <Mono size={12}>{o.key}</Mono>
          {o.origin === 'ai' && o.status === 'detected' ? <AiBadge variant="proposed" /> : null}
          <OpportunityTag status={o.status} />
        </div>
        <h2 id="opp-detail-title" ref={headingRef} tabIndex={-1}>
          {o.name}
        </h2>
        <p className="dx-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          {o.fitRationale}
        </p>
      </div>

      {dupTarget ? (
        <div
          role="status"
          className="gos-banner"
          data-tone="warn"
          style={{ background: 'var(--warning-bg)' }}
        >
          <span className="gos-banner__icon" style={{ color: 'var(--warning-fg)' }}>
            <Icon name="merge" size={15} />
          </span>
          <div className="gos-banner__text" style={{ fontSize: 13 }}>
            <b style={{ color: 'var(--warning-fg)', fontWeight: 600 }}>Likely duplicate of {dupTarget.key}</b>{' '}
            · {dupTarget.name}. Merging keeps both records and links them.
          </div>
        </div>
      ) : null}

      <div>
        <Eyebrow>Fit to mandate criteria</Eyebrow>
        <ul className="dx-fit">
          {o.fitCriteria.map((c) => {
            const g = FIT_GLYPH[c.result];
            return (
              <li key={c.criterion}>
                <span className={g.cls} style={{ display: 'inline-flex', marginTop: 2 }}>
                  <Icon name={g.icon} size={14} strokeWidth={2.2} />
                </span>
                <span>
                  {c.criterion} · {g.word}
                  {c.note ? <span className="dx-muted"> · {c.note}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <Eyebrow>Evidence</Eyebrow>
        {o.sources.length ? (
          <div className="dx-row" style={{ gap: 6 }}>
            {o.sources.map((s) => (
              <SourceChip
                key={s.sourceId}
                label={s.label}
                quality={s.quality}
                restricted={s.restricted}
                href={`/evidence/${s.key}`}
              />
            ))}
          </div>
        ) : (
          <p className="dx-small dx-muted" style={{ margin: 0 }}>
            No evidence attached. Attach sources before shortlisting.
          </p>
        )}
      </div>
      <div>
        <Eyebrow>Unknowns</Eyebrow>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: '20px' }}>
          {o.unknowns.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      </div>

      {error ? <ProblemBanner error={error} /> : null}

      {mode === 'dismiss' && !closed ? (
        <fieldset className="dx-fieldset">
          <legend>Dismiss with a reason (required)</legend>
          <div className="dx-row" style={{ gap: 6 }}>
            {DISMISS_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className="dx-chip-btn"
                aria-pressed={reason === r}
                onClick={() => setReason(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="dx-row" style={{ marginTop: 10 }}>
            <Button
              variant="secondary"
              tone="dark"
              disabled={!reason || busy}
              disabledReason={!reason ? 'Choose a reason.' : 'Dismissing…'}
              onClick={() =>
                reason &&
                dismiss.mutate(
                  { params: { ref: o.key }, body: { reason } },
                  { onSuccess: () => setMode('idle') },
                )
              }
            >
              Dismiss candidate
            </Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
          <p className="dx-small dx-faint" style={{ margin: '8px 0 0' }}>
            Dismissed candidates stay visible under the Dismissed filter with your reason.
          </p>
        </fieldset>
      ) : null}

      {mode === 'convert' && o.status === 'shortlisted' ? (
        <fieldset className="dx-fieldset dx-stack">
          <legend>Convert to an expansion case</legend>
          <p className="dx-small" style={{ margin: 0 }}>
            Creates an expansion case in Discovery under mandate {mandate.key}. The candidate keeps its
            evidence and origin. No spend is authorized.
          </p>
          <OwnerPicker
            label="Case owner"
            required
            value={ownerId}
            options={people}
            onChange={setOwner}
            hint="One accountable person. The owner cannot approve the case's gates."
          />
          <div className="dx-row">
            <Button
              variant="primary"
              icon="briefcase"
              disabled={!ownerId || busy}
              disabledReason={!ownerId ? 'Choose the case owner.' : 'Converting…'}
              onClick={() =>
                ownerId &&
                convert.mutate(
                  { params: { ref: o.key }, body: { ownerId } },
                  { onSuccess: () => setMode('idle') },
                )
              }
            >
              Convert to case
            </Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </fieldset>
      ) : null}

      {mode === 'idle' && !closed && o.status !== 'converted' ? (
        <div className="dx-actions">
          {o.status === 'detected' ? (
            <Button
              variant="primary"
              icon="star"
              onClick={act.shortlist}
              disabled={busy}
              disabledReason={busy ? 'Working…' : undefined}
            >
              Shortlist <Kbd>S</Kbd>
            </Button>
          ) : null}
          {o.status === 'shortlisted' ? (
            <Button
              variant="primary"
              icon="briefcase"
              onClick={() => setMode('convert')}
              disabled={mandate.status !== 'approved'}
              disabledReason="The mandate needs G0 approval first."
            >
              Convert to case
            </Button>
          ) : null}
          {dupTarget ? (
            <Button variant="secondary" icon="merge" onClick={act.merge} disabled={busy}>
              Merge into {dupTarget.key} <Kbd>M</Kbd>
            </Button>
          ) : null}
          <Button variant="secondary" icon="x" onClick={act.dismiss} disabled={busy}>
            Dismiss <Kbd>D</Kbd>
          </Button>
        </div>
      ) : null}

      {o.status === 'converted' ? (
        <Banner
          tone="ok"
          title={convertedCase ? `Converted to case ${convertedCase.key}` : 'Converted to an expansion case'}
          body={
            convertedCase
              ? `Owner ${convertedCase.owner.displayName} · stage Discovery. The candidate keeps its evidence and origin.`
              : 'The candidate keeps its evidence and origin.'
          }
          actions={
            convertedCase ? (
              <Button variant="secondary" icon="arrowr" href={`/me/cases/${convertedCase.key}/thesis`}>
                Open case
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {o.status === 'duplicate' ? (
        <p className="dx-muted" style={{ margin: 0, fontSize: 12.5 }}>
          Merged into {mergedInto?.key ?? 'another candidate'}. Both records are kept and linked.
        </p>
      ) : null}
      {o.status === 'dismissed' ? (
        <p className="dx-muted" style={{ margin: 0, fontSize: 12.5 }}>
          Dismissed · reason: {o.dismissReason ?? 'not recorded'}. Kept for audit.
        </p>
      ) : null}
    </aside>
  );
}

function AddManual({
  mandateId,
  onClose,
  onAdded,
}: {
  mandateId: string;
  onClose: () => void;
  onAdded: (key: string) => void;
}) {
  const [name, setName] = useState('');
  const create = useCommand(API.opportunities.createManual, { onSuccess: (o) => onAdded(o.key) });
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <form
      className="dx-box dx-box--canvas dx-row"
      style={{ alignItems: 'flex-end', gap: 10, padding: '12px 14px' }}
      aria-label="Add a candidate manually"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) create.mutate({ body: { mandateId, name: name.trim() } });
      }}
    >
      <label htmlFor="opp-new" style={{ flex: '1 1 280px', fontSize: 13, fontWeight: 500 }}>
        Market name
        <input
          id="opp-new"
          ref={inputRef}
          className="gos-input"
          style={{ marginTop: 6 }}
          value={name}
          placeholder="e.g. Swiss food-processing plants"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
        />
      </label>
      <Button
        variant="primary"
        type="submit"
        disabled={!name.trim() || create.isPending}
        disabledReason={!name.trim() ? 'Name the market.' : 'Adding…'}
      >
        Add candidate
      </Button>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <p className="dx-small dx-faint" style={{ flexBasis: '100%', margin: 0 }}>
        Manual candidates start as Detected with no evidence. Attach sources before shortlisting.
      </p>
      {create.error ? (
        <div style={{ flexBasis: '100%' }}>
          <ProblemBanner error={create.error} />
        </div>
      ) : null}
    </form>
  );
}
