/**
 * S13 Evidence (prototype Evidence.dc.html): source list, source viewer with the permitted excerpt
 * (Source Serif 4), dates, licence boundary, linked claims and status (current, ageing, stale,
 * superseded, restricted, deleted with provenance kept), and the fact / inference / assumption
 * panel with Challenge, Mark stale, Replace and Inspect impacted cases.
 *
 * Restricted content never reaches this component: the API sends no passage, fact or inferred
 * claim when the viewer lacks the licence, and the screen never derives one.
 *
 * Routes: /evidence?case=ME-104 and /evidence/:sourceKey?claim=…&passage=….
 */
import { API, toFingerprint, type Source, type SourceDetail } from '@growth-os/contracts';
import {
  AiBadge,
  Banner,
  Button,
  EmptyState,
  Eyebrow,
  Freshness,
  Icon,
  KindTag,
  Mono,
  Pill,
  RestrictedValue,
  Skeleton,
  TextAreaField,
  UiLink,
} from '@growth-os/ui';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';
import { fmtDate, fmtDateTime } from '../history/dates';
import '../history/ws8d.css';

function SourceStatus({ s }: { s: Source }) {
  if (s.availability === 'restricted') return <RestrictedValue />;
  if (s.availability === 'deleted_by_provider') return <Pill label="Deleted" tone="neutral" icon="trash" />;
  if (s.availability === 'unavailable') return <Pill label="Unavailable" tone="neutral" icon="cloudoff" />;
  return (
    <Freshness
      freshness={s.freshness}
      detail={s.freshness === 'ageing' && s.ageingDays ? `${s.ageingDays} days` : undefined}
    />
  );
}

export default function EvidenceScreen() {
  const { sourceKey } = useParams();
  const [search] = useSearchParams();
  const caseRef = search.get('case') ?? undefined;
  const list = useApiQuery(API.evidence.list, { query: { caseRef, limit: 50 } });
  const qs = caseRef ? `?case=${encodeURIComponent(caseRef)}` : '';
  return (
    <div className="ws8d-page">
      <div>
        <nav
          aria-label="Breadcrumb"
          className="ws8d-sub"
          style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}
        >
          {caseRef ? (
            <>
              <Link
                to={`/me/cases/${encodeURIComponent(caseRef)}/thesis`}
                className="gos-link"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {caseRef}
              </Link>
              <Icon name="chevr" size={12} />
            </>
          ) : null}
          <span aria-current="page">Evidence</span>
        </nav>
        <h1 style={{ margin: 0, fontSize: 22, lineHeight: '30px', fontWeight: 600 }}>Evidence and history</h1>
      </div>
      <div className="ws8d-three">
        <nav aria-label="Sources" className="gos-card" style={{ overflow: 'hidden' }}>
          <div
            className="ws8d-sub"
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-canvas)',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            Sources{caseRef ? ` · ${caseRef}` : ''}
          </div>
          {list.isPending ? (
            <div aria-busy="true" style={{ padding: 12 }}>
              <Skeleton height={120} />
            </div>
          ) : list.error ? (
            <div style={{ padding: 12 }}>
              <ProblemBanner error={list.error} />
            </div>
          ) : (
            <ul className="ws8d-srclist">
              {list.data.items.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/evidence/${encodeURIComponent(s.key)}${qs}`}
                    className="ws8d-srcitem"
                    aria-current={s.key === sourceKey ? 'page' : undefined}
                  >
                    <span className="ws8d-row" style={{ gap: 6 }}>
                      <Mono size={12}>{s.key}</Mono>
                      <SourceStatus s={s} />
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 500, lineHeight: '18px' }}>{s.title}</span>
                    <span className="ws8d-sub">Published {fmtDate(s.publishedOn)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>
        {sourceKey ? (
          <SourcePane key={sourceKey} sourceKey={sourceKey} all={list.data?.items ?? []} qs={qs} />
        ) : (
          <>
            <EmptyState title="Choose a source">
              Open a source to see its permitted excerpt, licence boundary and what depends on it.
            </EmptyState>
            <span />
          </>
        )}
      </div>
    </div>
  );
}

function SourcePane({ sourceKey, all, qs }: { sourceKey: string; all: Source[]; qs: string }) {
  const [search] = useSearchParams();
  const q = useApiQuery(API.evidence.get, { params: { ref: sourceKey } });
  if (q.isPending) {
    return (
      <>
        <div aria-busy="true">
          <Skeleton height={320} />
        </div>
        <span />
      </>
    );
  }
  if (q.error || !q.data) {
    return (
      <>
        <ProblemBanner error={q.error} />
        <span />
      </>
    );
  }
  return (
    <>
      <Viewer d={q.data} all={all} qs={qs} passage={search.get('passage')} />
      <SidePanel d={q.data} all={all} />
    </>
  );
}

function statusLong(d: SourceDetail, all: Source[]): string {
  const s = d.source;
  const by = (id: string | null) => all.find((x) => x.id === id)?.key;
  if (s.availability === 'deleted_by_provider')
    return `Deleted by provider on ${fmtDate(s.deletedAt)}${s.contentSha256 ? ` · fingerprint ${toFingerprint(s.contentSha256)} kept` : ''}`;
  if (s.availability === 'restricted') return 'Restricted under your access';
  if (s.freshness === 'superseded') return `Superseded by ${by(s.supersededBySourceId) ?? 'a newer source'}`;
  if (s.freshness === 'stale') return `Stale · ${s.staleReason ?? 'marked stale'}`;
  const supersedes = all.find((x) => x.supersededBySourceId === s.id);
  const base =
    s.freshness === 'ageing' ? `Current · ageing${s.ageingDays ? ` · ${s.ageingDays} days` : ''}` : 'Current';
  return supersedes ? `${base} · supersedes ${supersedes.key}` : base;
}

function Viewer({
  d,
  all,
  qs,
  passage,
}: {
  d: SourceDetail;
  all: Source[];
  qs: string;
  passage: string | null;
}) {
  const s = d.source;
  const restricted =
    s.availability === 'restricted' || (s.availability === 'available' && d.viewerAccess === 'none');
  const aggregate = s.availability === 'available' && d.viewerAccess === 'aggregate_only';
  const deleted = s.availability === 'deleted_by_provider';
  const supersededBy =
    s.freshness === 'superseded' ? all.find((x) => x.id === s.supersededBySourceId) : undefined;
  const [requesting, setRequesting] = useState(false);
  return (
    <article aria-label="Source viewer" className="gos-card">
      <div
        style={{
          padding: '16px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div className="ws8d-row" style={{ gap: 8 }}>
          <Mono size={12.5} strong>
            {s.key}
          </Mono>
          {!restricted && !deleted ? <KindTag kind="evidence" small /> : null}
          <SourceStatus s={s} />
        </div>
        <h2 style={{ margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>{s.title}</h2>
        <dl className="ws8d-meta">
          <dt>Origin</dt>
          <dd>{s.originText}</dd>
          <dt>Published</dt>
          <dd>{s.publishedOn ? fmtDate(s.publishedOn) : '[date]'}</dd>
          <dt>Retrieved</dt>
          <dd>{s.retrievedAt ? fmtDateTime(s.retrievedAt) : '—'}</dd>
          <dt>Licence boundary</dt>
          <dd>{restricted ? 'Not in your entitlements' : (d.license?.boundaryText ?? '—')}</dd>
          <dt>Status</dt>
          <dd>{statusLong(d, all)}</dd>
        </dl>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {d.passages.map((p, i) => (
          <div
            key={p.id}
            aria-current={passage && (passage === p.id || passage === p.locator) ? 'true' : undefined}
          >
            <div className="ws8d-sub" style={{ fontWeight: 500, marginBottom: 8 }}>
              Permitted excerpt · {p.locator} · passage {i + 1} of {d.passages.length}
            </div>
            <blockquote className="ws8d-blockquote">“{p.excerpt}”</blockquote>
            <p className="ws8d-muted" style={{ marginTop: 8 }}>
              Shown within the licence
              {d.license ? `: up to ${d.license.maxExcerptSentences} sentences per passage` : ''}. Nothing
              here is generated.
            </p>
          </div>
        ))}
        {!restricted && !aggregate && !deleted && d.passages.length === 0 ? (
          <p className="ws8d-note" style={{ margin: 0 }}>
            No permitted excerpt is stored for this source.
          </p>
        ) : null}
        {restricted ? (
          <Banner
            tone="lock"
            live={false}
            title="Restricted source · no excerpt shown"
            body="Your role does not include this licence. No excerpt, summary or generated paraphrase is shown here or anywhere else in the product."
            actions={
              <>
                {s.uri ? (
                  <Button variant="secondary" icon="ext" href={s.uri}>
                    Open in licensed tool
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    icon="ext"
                    disabled
                    disabledReason="No licensed-tool link is recorded for this source."
                  >
                    Open in licensed tool
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setRequesting(true)}>
                  Request access
                </Button>
              </>
            }
          />
        ) : null}
        {aggregate ? (
          <Banner
            tone="lock"
            live={false}
            title="Aggregates only · no excerpt shown"
            body="Your access to this licence covers aggregate figures only. No excerpt, summary or generated paraphrase is shown."
            actions={
              <Button variant="ghost" onClick={() => setRequesting(true)}>
                Request access
              </Button>
            }
          />
        ) : null}
        {requesting ? <AccessRequest sourceKey={s.key} onClose={() => setRequesting(false)} /> : null}
        {deleted ? (
          <Banner
            tone="neutral"
            live={false}
            title="Source deleted by provider · provenance kept"
            body="Content is no longer available. The record of what it said, who used it and when is retained under the retention policy."
          />
        ) : null}
        {supersededBy ? (
          <Banner
            tone="neutral"
            live={false}
            title={`Superseded by ${supersededBy.key}${supersededBy.publishedOn ? ` (published ${fmtDate(supersededBy.publishedOn)})` : ''}`}
            body="Claims moved to the newer source. This edition stays readable for history."
            actions={
              <Button variant="secondary" href={`/evidence/${encodeURIComponent(supersededBy.key)}${qs}`}>
                {`Open ${supersededBy.key}`}
              </Button>
            }
          />
        ) : null}
        {s.freshness === 'stale' ? (
          <Banner
            tone="warn"
            live={false}
            title="Marked stale"
            body={`${s.staleReason ?? ''} Dependent figures show a freshness warning; approvals that use it are re-checked for materiality.`}
          />
        ) : null}
        <div>
          <Eyebrow>Linked claims and inputs</Eyebrow>
          {d.linkedUses.length ? (
            <ul className="ws8d-plain">
              {d.linkedUses.map((u) => (
                <li
                  key={u.label}
                  className="ws8d-row"
                  style={{
                    fontSize: 13,
                    padding: '6px 10px',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>{u.label}</span>
                  <UiLink href={u.href} className="gos-link" style={{ fontSize: 12.5, fontWeight: 500 }}>
                    {u.where}
                  </UiLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ws8d-note" style={{ margin: 0 }}>
              Nothing uses this source.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function AccessRequest({ sourceKey, onClose }: { sourceKey: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const cmd = useCommand(API.evidence.requestAccess);
  if (done) {
    return (
      <p role="status" className="ws8d-note" style={{ margin: 0 }}>
        Access requested from the licence owner. Nothing is shown until access is granted.
      </p>
    );
  }
  return (
    <div className="ws8d-form">
      <TextAreaField label="Why do you need access?" required value={reason} onChange={setReason} rows={2} />
      {err ? <ProblemBanner error={err} /> : null}
      <div className="ws8d-row">
        <Button
          variant="secondary"
          disabled={!reason.trim() || cmd.isPending}
          disabledReason="A reason is required."
          onClick={async () => {
            try {
              await cmd.mutateAsync({ params: { ref: sourceKey }, body: { reason: reason.trim() } });
              setDone(true);
            } catch (e) {
              setErr(e);
            }
          }}
        >
          Send access request
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

type Panel = 'challenge' | 'stale' | 'replace' | null;

function SidePanel({ d, all }: { d: SourceDetail; all: Source[] }) {
  const s = d.source;
  const canQuote = d.viewerAccess === 'excerpt' && s.availability === 'available';
  const notShown =
    s.availability === 'deleted_by_provider' ? 'Not available — source deleted.' : 'Not shown — restricted.';
  const [panel, setPanel] = useState<Panel>(null);
  const [showImpact, setShowImpact] = useState(true);
  const [text, setText] = useState('');
  const [replacement, setReplacement] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const challenge = useCommand(API.evidence.challenge);
  const stale = useCommand(API.evidence.markStale);
  const replace = useCommand(API.evidence.replace);
  const candidates = all.filter((x) => x.id !== s.id && x.availability === 'available');
  const open = (p: Panel) => {
    setPanel(panel === p ? null : p);
    setText('');
    setErr(null);
  };
  const run = async (p: Promise<unknown>, done: string) => {
    setErr(null);
    try {
      await p;
      setNote(done);
      setPanel(null);
      setText('');
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <aside
      aria-label="Fact, inference and assumption"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <section className="ws8d-section" aria-labelledby="fia-h" style={{ gap: 12 }}>
        <h2 id="fia-h">What this source does and does not say</h2>
        <div>
          <Eyebrow>Quoted fact</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
            <KindTag kind="evidence" detail="quoted" small />
            <p className="ws8d-serif" style={{ margin: 0 }}>
              {d.quotedFact ?? (canQuote ? 'No quoted fact recorded.' : notShown)}
            </p>
          </div>
        </div>
        <div>
          <Eyebrow>Inferred claim</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
            {d.inferredClaim ? (
              <AiBadge variant="accepted" acceptedBy={d.inferredClaim.acceptedBy?.displayName} />
            ) : null}
            <p className="ws8d-serif" style={{ margin: 0 }}>
              {d.inferredClaim?.text ?? (canQuote ? 'No inferred claim.' : notShown)}
            </p>
          </div>
        </div>
        <div>
          <Eyebrow>Human assumption · not in this source</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
            {d.humanAssumption ? (
              <KindTag kind="assumption" detail={d.humanAssumption.owner.displayName} small />
            ) : null}
            <p className="ws8d-serif" style={{ margin: 0 }}>
              {d.humanAssumption?.text ?? 'None from this source.'}
            </p>
          </div>
        </div>
      </section>

      <section className="ws8d-section" aria-label="Source actions">
        <div className="ws8d-row" style={{ gap: 8 }}>
          <Button variant="secondary" icon="message" onClick={() => open('challenge')}>
            Challenge
          </Button>
          <Button variant="secondary" icon="clock" onClick={() => open('stale')}>
            Mark stale
          </Button>
          <Button variant="secondary" icon="refresh" onClick={() => open('replace')}>
            Replace
          </Button>
          <Button variant="secondary" icon="layers" onClick={() => setShowImpact((x) => !x)}>
            Inspect impacted cases
          </Button>
        </div>
        {panel === 'challenge' ? (
          <div className="ws8d-form">
            <TextAreaField
              label="What is wrong with this source?"
              required
              value={text}
              onChange={setText}
              rows={2}
            />
            <div className="ws8d-row">
              <Button
                variant="secondary"
                tone="dark"
                disabled={!text.trim() || challenge.isPending}
                disabledReason="Describe the problem first."
                onClick={() =>
                  run(
                    challenge.mutateAsync({ params: { ref: s.key }, body: { statement: text.trim() } }),
                    'Challenge sent to the source owner · claims stay usable and are flagged.',
                  )
                }
              >
                Send challenge
              </Button>
              <Button variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {panel === 'stale' ? (
          <div className="ws8d-form">
            <TextAreaField label="Why is it stale?" required value={text} onChange={setText} rows={2} />
            <div className="ws8d-row">
              <Button
                variant="secondary"
                tone="dark"
                disabled={!text.trim() || stale.isPending}
                disabledReason="A reason is required."
                onClick={() =>
                  run(
                    stale.mutateAsync({ params: { ref: s.key }, body: { reason: text.trim() } }),
                    'Marked stale · dependent figures show a freshness warning; approvals that use it are re-checked.',
                  )
                }
              >
                Mark stale
              </Button>
              <Button variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {panel === 'replace' ? (
          <div className="ws8d-form">
            <label>
              Replace with
              <select
                className="ws8d-input"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
              >
                <option value="">Choose a newer source</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {`${c.key} · ${c.title}`}
                  </option>
                ))}
              </select>
            </label>
            <p className="ws8d-muted">
              Replacing re-links claims in a draft. Approved snapshots keep the original source.
            </p>
            <div className="ws8d-row">
              <Button
                variant="secondary"
                tone="dark"
                disabled={!replacement || replace.isPending}
                disabledReason="Choose the replacement source."
                onClick={() =>
                  run(
                    replace.mutateAsync({
                      params: { ref: s.key },
                      body: { replacementSourceId: replacement },
                    }),
                    'Replaced · draft claims re-linked; approved snapshots keep the original.',
                  )
                }
              >
                Replace source
              </Button>
              <Button variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {err ? <ProblemBanner error={err} /> : null}
        <p role="status" className="ws8d-note" style={{ margin: 0 }}>
          {note ?? ''}
        </p>
        {showImpact ? (
          <div>
            <div className="ws8d-sub" style={{ fontWeight: 500, marginBottom: 6 }}>
              Impacted · cases you can access
            </div>
            {d.impact.length ? (
              <ul className="ws8d-plain">
                {d.impact.map((i) => (
                  <li
                    key={i.caseId}
                    style={{
                      fontSize: 13,
                      padding: '8px 10px',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 6,
                    }}
                  >
                    <Link
                      to={`/me/cases/${encodeURIComponent(i.caseKey)}/thesis`}
                      className="gos-link"
                      style={{ fontWeight: 600 }}
                    >
                      {i.caseKey}
                    </Link>{' '}
                    · {i.what}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ws8d-note" style={{ margin: 0 }}>
                No case you can access depends on this source.
              </p>
            )}
            <p className="ws8d-muted" style={{ marginTop: 6 }}>
              Cases you cannot access are not listed or counted.
            </p>
          </div>
        ) : null}
        {d.challenges.length ? (
          <div>
            <Eyebrow>Open challenges</Eyebrow>
            <ul className="ws8d-plain">
              {d.challenges.map((c) => (
                <li key={c.id} style={{ fontSize: 13 }}>
                  <b style={{ fontWeight: 600 }}>{c.raisedBy.displayName}</b> · {fmtDateTime(c.createdAt)} —{' '}
                  {c.statement}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
