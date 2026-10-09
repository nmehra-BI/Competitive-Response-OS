/**
 * S05 Expansion thesis (prototype Thesis.dc.html). Case hero, claims with their epistemic kind,
 * reasons to win, alternatives including "No entry", critical assumptions, signed disagreements,
 * blockers, the recommendation (not a decision) and the analysis run strip in business copy
 * ("Working: checking sources…") — never a percentage.
 *
 * Deep links: claim (scrolls to and highlights a claim), run.
 */
import {
  API,
  ReviewArea,
  type Assumption,
  type Claim,
  type ReviewStatus,
  type ThesisFields,
  type ThesisView,
} from '@growth-os/contracts';
import {
  AiBadge,
  AssumptionChip,
  Banner,
  Button,
  Card,
  DataTable,
  DissentItem,
  Eyebrow,
  GateDiamond,
  Icon,
  KindTag,
  OwnerPicker,
  Person,
  ReviewStatusTag,
  RunStatusTag,
  SectionHeader,
  Skeleton,
  SourceChip,
  TextAreaField,
} from '@growth-os/ui';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Modal } from '../../app/shell/Modal';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { api, queryKey } from '../../lib/api-client';
import { useDraft, usePublishAutosave, type Versioned } from '../../lib/drafts';
import { pollWhile, RUN_IN_FLIGHT, useApiQuery, useCommand } from '../../lib/query';
import { useViewer } from '../../lib/session';
import { useQueryClient } from '@tanstack/react-query';
import '../sizing/assessment.css';

type EditableFields = {
  proposition: string;
  intendedCustomer: string;
  whyNow: string;
  recommendation: string;
};

function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
}
function fmtWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso));
}

/** Reviewer status text from the view → review status glyph. */
function reviewStatusOf(text: string): ReviewStatus | 'disagreement' | 'signed_scoped' {
  switch (text) {
    case 'Disagreement':
      return 'disagreement';
    case 'Signed':
      return 'signed';
    case 'Signed · pilot scope':
      return 'signed_scoped';
    case 'In review':
      return 'in_review';
    case 'Blocker':
      return 'declined';
    default:
      return 'pending';
  }
}

function humanize(v: string): string {
  const s = v.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Origin({ origin }: { origin: 'human' | 'ai' | 'ai_edited' }) {
  if (origin === 'ai') return <AiBadge variant="draft" />;
  if (origin === 'ai_edited') return <AiBadge variant="accepted" />;
  return null;
}

// ---------------------------------------------------------------------------
// Analysis strip
// ---------------------------------------------------------------------------

function AnalysisStrip({ caseKey }: { caseKey: string }) {
  const runs = useApiQuery(
    API.analysis.latestForCase,
    { params: { caseRef: caseKey }, query: { limit: 1 } },
    { refetchInterval: pollWhile((d) => !!d.items[0] && RUN_IN_FLIGHT.has(d.items[0].status)) },
  );
  const run = runs.data?.items[0];
  return (
    <div role="region" aria-label="Analysis status" className="as-strip">
      {run ? (
        <RunStatusTag status={run.status} detail={run.statusDetail ? `· ${run.statusDetail}` : undefined} />
      ) : runs.isPending ? (
        <Skeleton height={16} width={260} />
      ) : (
        <span className="as-muted">No analysis has run for this case.</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

function ClaimItem({
  c,
  disputedBy,
  caseKey,
  highlighted,
}: {
  c: Claim;
  disputedBy: string | null;
  caseKey: string;
  highlighted: boolean;
}) {
  const [challenging, setChallenging] = useState(false);
  const [text, setText] = useState('');
  const accept = useCommand(API.thesis.acceptClaim);
  const discard = useCommand(API.thesis.discardClaim);
  const challenge = useCommand(API.thesis.challengeClaim, {
    onSuccess: () => {
      setChallenging(false);
      setText('');
    },
  });
  const proposed = c.origin === 'ai' && c.status === 'proposed';
  const err = accept.error ?? discard.error ?? challenge.error;
  return (
    <li id={`claim-${c.id}`} className={highlighted ? 'as-claim as-row-selected' : 'as-claim'}>
      <p className="as-serif">{c.statement}</p>
      <div className="as-row">
        <KindTag kind={c.kind} detail={c.kindDetail ?? undefined} />
        {proposed ? <AiBadge variant="draft" /> : c.origin === 'ai' ? <AiBadge variant="accepted" /> : null}
        {c.sources.map((s) => (
          <SourceChip
            key={s.sourceId}
            label={s.label}
            quality={s.quality}
            href={`/evidence/${s.key}`}
            restricted={s.restricted}
          />
        ))}
        {c.disputed && disputedBy ? (
          <Link
            to={`/me/cases/${caseKey}/validation?assumption=ASM-01`}
            className="as-flag"
            style={{ textDecoration: 'none' }}
          >
            <Icon name="message" size={13} />
            <span>Disputed by {disputedBy}</span>
          </Link>
        ) : null}
        <span className="as-claim__actions">
          {proposed ? (
            <>
              <Button
                variant="secondary"
                onClick={() =>
                  accept.mutate({ params: { id: c.id }, body: { as: 'assumption', editedStatement: null } })
                }
                disabled={accept.isPending}
                disabledReason={accept.isPending ? 'Saving…' : undefined}
              >
                Accept as assumption
              </Button>
              <Button variant="ghost" onClick={() => discard.mutate({ params: { id: c.id } })}>
                Discard
              </Button>
            </>
          ) : c.status !== 'challenged' && !challenging ? (
            <Button
              variant="ghost"
              icon="message"
              onClick={() => setChallenging(true)}
              ariaLabel={`Challenge: ${c.statement}`}
            >
              Challenge
            </Button>
          ) : null}
        </span>
      </div>
      {challenging ? (
        <form
          className="as-inline-form"
          aria-label="Challenge claim"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) challenge.mutate({ params: { id: c.id }, body: { statement: text.trim() } });
          }}
        >
          <TextAreaField
            label="What is wrong or unsupported?"
            required
            value={text}
            onChange={setText}
            rows={2}
          />
          <div className="as-row">
            <Button
              variant="primary"
              tone="dark"
              type="submit"
              disabled={!text.trim() || challenge.isPending}
              disabledReason={!text.trim() ? 'A statement is required' : 'Sending…'}
            >
              Send challenge to owner
            </Button>
            <Button variant="ghost" onClick={() => setChallenging(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {c.status === 'challenged' ? (
        <div role="status" className="as-flag" style={{ fontSize: 12.5 }}>
          <Icon name="message" size={13} />
          <span className="as-flag__text">
            Challenge open · sent to owner{challenge.data ? ` · ${fmtWhen(challenge.data.createdAt)}` : ''}
          </span>
        </div>
      ) : null}
      {err ? <ProblemBanner error={err} /> : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Assign reviewer
// ---------------------------------------------------------------------------

function AssignReviewerDialog({
  caseKey,
  options,
  onClose,
}: {
  caseKey: string;
  options: ThesisView['reviewers'][number]['person'][];
  onClose: () => void;
}) {
  const [reviewer, setReviewer] = useState<string | null>(null);
  const [area, setArea] = useState<ReviewArea>('product');
  const [question, setQuestion] = useState('');
  const areaId = useId();
  const cmd = useCommand(API.cases.requestReview);
  return (
    <Modal label="Assign reviewer" onClose={onClose}>
      <form
        style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 320 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!reviewer || !question.trim()) return;
          cmd.mutate({
            params: { caseRef: caseKey },
            body: {
              area,
              reviewerId: reviewer,
              targetType: 'thesis',
              targetId: null,
              question: question.trim(),
              whatToCheck: [],
              dueOn: null,
            },
          });
        }}
      >
        <SectionHeader title="Assign reviewer" subtitle="A focused question for one named person" />
        <OwnerPicker label="Reviewer" required value={reviewer} onChange={setReviewer} options={options} />
        <label className="gos-field" htmlFor={areaId}>
          <span>Area</span>
          <select
            id={areaId}
            className="gos-select"
            value={area}
            onChange={(e) => setArea(e.target.value as ReviewArea)}
          >
            {ReviewArea.options.map((a) => (
              <option key={a} value={a}>
                {humanize(a)}
              </option>
            ))}
          </select>
        </label>
        <TextAreaField label="Question" required value={question} onChange={setQuestion} rows={3} />
        {cmd.isSuccess ? (
          <Banner tone="ok" title={`Review requested from ${cmd.data.reviewer.displayName}`} />
        ) : null}
        {cmd.error ? <ProblemBanner error={cmd.error} /> : null}
        <div className="as-row">
          <Button
            variant="primary"
            type="submit"
            disabled={!reviewer || !question.trim() || cmd.isPending || cmd.isSuccess}
            disabledReason={
              cmd.isSuccess
                ? 'Requested'
                : !reviewer
                  ? 'Choose a reviewer'
                  : !question.trim()
                    ? 'Write the question'
                    : 'Sending…'
            }
          >
            Send review request
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

function section(title: string, subtitle: string, id: string, children: ReactNode) {
  return (
    <section aria-labelledby={id} className="as-section">
      <SectionHeader id={id} title={title} subtitle={subtitle || undefined} />
      {children}
    </section>
  );
}

function editable(f: ThesisFields): EditableFields {
  return {
    proposition: f.proposition.value,
    intendedCustomer: f.intendedCustomer.value,
    whyNow: f.whyNow.value,
    recommendation: f.recommendation?.value ?? '',
  };
}

export default function ThesisScreen() {
  const { caseKey = '' } = useParams();
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const viewer = useViewer();
  const q = useApiQuery(API.thesis.get, { params: { caseRef: caseKey } });
  const header = useApiQuery(API.cases.header, { params: { caseRef: caseKey } });
  const sizing = useApiQuery(API.sizing.get, { params: { caseRef: caseKey } });
  const [editing, setEditing] = useState(false);
  const [assign, setAssign] = useState(false);
  const startRun = useCommand(API.analysis.start);
  const commit = useCommand(API.thesis.commit, { onSuccess: () => setEditing(false) });
  const claimParam = sp.get('claim');

  const data = q.data;
  const version = data?.draft ?? data?.current ?? null;
  const server: Versioned<EditableFields> | undefined = useMemo(
    () =>
      version
        ? {
            value: editable(version.fields),
            rowVersion: data?.draft ? data.draft.rowVersion : (data?.current?.rowVersion ?? 0),
          }
        : undefined,
    [version, data?.draft, data?.current],
  );
  const draft = useDraft<EditableFields>({
    storageKey: editing && viewer.data ? `${viewer.data.tenant.id}:thesis:${caseKey}` : null,
    server,
    save: async (value, rowVersion) => {
      const fields = {
        proposition: { value: value.proposition, origin: 'human' as const },
        intendedCustomer: { value: value.intendedCustomer, origin: 'human' as const },
        whyNow: { value: value.whyNow, origin: 'human' as const },
        recommendation: { value: value.recommendation, origin: 'human' as const },
      };
      const view = await api(API.thesis.saveDraft, {
        params: { caseRef: caseKey },
        body: { fields },
        ifMatch: rowVersion,
      });
      qc.setQueryData(queryKey(API.thesis.get, { caseRef: caseKey }, undefined), view);
      return { value: editable(view.draft!.fields), rowVersion: view.draft!.rowVersion };
    },
  });
  usePublishAutosave(editing ? draft.status : null);

  useEffect(() => {
    if (!claimParam || !data) return;
    document.getElementById(`claim-${claimParam}`)?.scrollIntoView?.({ block: 'center' });
  }, [claimParam, data]);

  if (q.isPending) {
    return (
      <div className="as-page" aria-busy="true">
        <Skeleton height={36} />
        <Skeleton height={180} />
        <Skeleton height={300} />
      </div>
    );
  }
  if (q.error || !data || !version) {
    return (
      <div className="as-page">
        {q.error ? <ProblemBanner error={q.error} /> : <Banner tone="neutral" title="No thesis yet" />}
      </div>
    );
  }

  const f = version.fields;
  const values = draft.value ?? editable(f);
  const byId = new Map(data.criticalAssumptions.map((a) => [a.id, a]));
  const disputeByAssumption = new Map(data.disagreements.map((d) => [d.targetId, d]));
  const adoptionDispute = data.disagreements.find((d) => d.targetType === 'assumption');
  const next = header.data?.nextDecision;
  const people = [
    ...data.reviewers.map((r) => r.person),
    ...data.blockers.map((b) => b.owner),
    ...data.criticalAssumptions.map((a) => a.owner),
  ].filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i);
  const boundary = (sizing.data?.draft ?? sizing.data?.current)?.boundary;
  const horizon = (sizing.data?.draft ?? sizing.data?.current)?.horizonYears;

  const field = (
    key: keyof EditableFields,
    label: string,
    cls: string,
    origin: 'human' | 'ai' | 'ai_edited',
  ) =>
    editing ? (
      <TextAreaField
        label={label}
        value={values[key]}
        onChange={(v) => draft.setField(key, v)}
        rows={key === 'proposition' ? 3 : 2}
      />
    ) : (
      <div>
        <div className="as-row" style={{ marginBottom: 2 }}>
          <Eyebrow>{label}</Eyebrow>
          <Origin origin={origin} />
        </div>
        <p className={`as-serif ${cls}`}>{values[key]}</p>
      </div>
    );

  return (
    <div className="as-page">
      <h2 className="gos-sr-only">Thesis</h2>
      <AnalysisStrip caseKey={caseKey} />
      {data.draft ? (
        <Banner
          tone="info"
          title={`Draft v${data.draft.version} · not committed`}
          body={`Committed thesis v${data.current?.version ?? ''} stays unchanged until you commit this draft.`}
          live={false}
          actions={
            <Button
              variant="secondary"
              onClick={async () => {
                await draft.flush();
                commit.mutate({ params: { caseRef: caseKey } });
              }}
              disabled={commit.isPending}
              disabledReason={commit.isPending ? 'Committing…' : undefined}
            >
              {`Commit thesis v${data.draft.version}`}
            </Button>
          }
        />
      ) : null}
      <div className="as-split">
        <div className="as-main as-main--narrow">
          <section aria-label="Thesis summary" className="as-hero">
            {field('proposition', 'Proposition', 'as-serif--lg', f.proposition.origin)}
            <div className="as-grid-auto">
              {field('intendedCustomer', 'Intended customer', 'as-serif--md', f.intendedCustomer.origin)}
              {field('whyNow', 'Why now', 'as-serif--md', f.whyNow.origin)}
              <div>
                <Eyebrow>Next decision</Eyebrow>
                {next ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <GateDiamond status={next.blocked ? 'preconditions_open' : 'ready_to_submit'} size={16} />
                    <div style={{ fontSize: 13.5, lineHeight: '20px' }}>
                      <b style={{ fontWeight: 600 }}>{next.title}</b>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>{next.subtitle}</div>
                    </div>
                  </div>
                ) : (
                  <Skeleton height={36} />
                )}
              </div>
            </div>
          </section>

          {section(
            'Claims',
            'Every claim carries its kind. Plain text without a kind is not allowed.',
            'cl',
            <ul className="as-list as-claims">
              {data.claims.map((c) => (
                <ClaimItem
                  key={c.id}
                  c={c}
                  caseKey={caseKey}
                  highlighted={claimParam === c.id}
                  disputedBy={adoptionDispute?.raisedBy.displayName ?? null}
                />
              ))}
            </ul>,
          )}

          {section(
            'Reasons to win',
            'Tied to the core product, not to market size',
            'rw',
            <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {f.reasonsToWin.map((r) => {
                const a: Assumption | undefined = r.linkedAssumptionId
                  ? byId.get(r.linkedAssumptionId)
                  : undefined;
                const [st, ...rest] = (r.statusText ?? '').split(' · ');
                return (
                  <li key={r.id} className="as-serif">
                    {r.text.value}{' '}
                    {r.statusText ? (
                      <ReviewStatusTag
                        status={reviewStatusOf(st ?? '')}
                        extra={rest.join(' · ') || undefined}
                      />
                    ) : a ? (
                      <AssumptionChip
                        text={a.name}
                        owner={a.owner.displayName}
                        disputed={!!disputeByAssumption.get(a.id)}
                        href={`/me/cases/${caseKey}/validation?assumption=${a.key}`}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>,
          )}

          {section(
            'Alternatives',
            'Includes no entry',
            'al',
            <Card>
              <DataTable
                ariaLabel="Alternatives"
                minWidth={620}
                rows={f.alternatives}
                rowKey={(a) => a.id}
                rowHeader="name"
                columns={[
                  {
                    key: 'name',
                    header: 'Alternative',
                    cell: (a) => <b style={{ fontWeight: 600 }}>{a.name}</b>,
                  },
                  { key: 'meaning', header: 'What it means', cell: (a) => a.meaning },
                  {
                    key: 'status',
                    header: 'Status',
                    cell: (a) => (
                      <span
                        style={{
                          color: a.status === 'recommended' ? 'var(--accent)' : 'var(--text-secondary)',
                          fontWeight: a.status === 'recommended' ? 500 : 400,
                        }}
                      >
                        {a.statusText}
                      </span>
                    ),
                  },
                ]}
              />
            </Card>,
          )}

          {section(
            'Critical assumptions',
            'Top 5 from the register',
            'ca',
            <>
              <div className="as-row" style={{ gap: 8 }}>
                {data.criticalAssumptions.map((a) => (
                  <AssumptionChip
                    key={a.id}
                    text={a.name}
                    owner={a.owner.displayName}
                    disputed={!!a.openDispute}
                    href={`/me/cases/${caseKey}/validation?assumption=${a.key}`}
                  />
                ))}
              </div>
              <Link
                to={`/me/cases/${caseKey}/validation`}
                className="gos-link"
                style={{
                  display: 'inline-flex',
                  gap: 4,
                  alignItems: 'center',
                  marginTop: 8,
                  fontSize: 12.5,
                  fontWeight: 500,
                }}
              >
                Open register · sorted by decision sensitivity
                <Icon name="chevr" size={13} />
              </Link>
            </>,
          )}

          {section(
            'Disagreements',
            'Signed, in the reviewer’s words',
            'dg',
            data.disagreements.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.disagreements.map((d) => {
                  const a = data.criticalAssumptions.find((x) => x.id === d.targetId);
                  return (
                    <DissentItem
                      key={d.id}
                      author={d.raisedBy.displayName}
                      initials={d.raisedBy.initials}
                      role={d.raisedBy.title ?? ''}
                      statement={d.statement}
                      when={fmtWhen(d.createdAt)}
                      scope={`Scope: ${a ? a.name : 'assumption'}${d.proposedValue ? ` · proposes ${d.proposedValue}` : ''}`}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="as-muted" style={{ margin: 0 }}>
                No open disagreements.
              </p>
            ),
          )}

          {section(
            'Blockers',
            'Open items that stop a gate',
            'bl',
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.blockers.map((b) => (
                <div key={b.id} className="as-blocker">
                  {/* Items for the upcoming G1 are pending reviews; items for a later gate block it. */}
                  <ReviewStatusTag status={b.gate === 'G1' ? 'pending' : 'declined'} />
                  <span className="as-blocker__text">{b.text}</span>
                  <Person
                    name={b.owner.displayName}
                    initials={b.owner.initials}
                    subtitle={b.dueOn ? `due ${fmtDay(b.dueOn)}` : undefined}
                  />
                </div>
              ))}
            </div>,
          )}

          {section(
            'Recommendation',
            '',
            'rc',
            editing ? (
              <TextAreaField
                label="Recommendation · not a decision"
                value={values.recommendation}
                onChange={(v) => draft.setField('recommendation', v)}
                rows={3}
              />
            ) : (
              <div className="as-reco">
                <div className="as-row" style={{ marginBottom: 6 }}>
                  <span className="as-reco__label">RECOMMENDATION · NOT A DECISION</span>
                  <span className="as-faint" style={{ fontSize: 12 }}>
                    {people.find((p) => p.id === f.recommendationBy)?.displayName ?? ''}
                    {data.current?.committedAt ? ` · ${fmtDay(data.current.committedAt)}` : ''}
                  </span>
                </div>
                <p className="as-serif">{values.recommendation}</p>
              </div>
            ),
          )}

          <div className="as-actions">
            <Button variant="primary" href={`/me/cases/${caseKey}/decisions?gate=G1`}>
              Submit for G1 · validation €15k
            </Button>
            <Button
              variant="secondary"
              icon="pencil"
              onClick={() => {
                if (editing) void draft.flush();
                setEditing((e) => !e);
              }}
            >
              {editing ? 'Done editing' : 'Edit thesis'}
            </Button>
            <Button
              variant="secondary"
              icon="sparkle"
              onClick={() =>
                startRun.mutate({
                  params: { caseRef: caseKey },
                  body: {
                    skill: 'ability-to-win-assessment',
                    goal: 'Competitor scan for the thesis',
                    focus: {},
                  },
                })
              }
              disabled={startRun.isPending}
              disabledReason={startRun.isPending ? 'Requesting…' : undefined}
            >
              Request analysis
            </Button>
            <Button variant="secondary" icon="users" onClick={() => setAssign(true)}>
              Assign reviewer
            </Button>
            <span className="as-muted" style={{ fontSize: 12.5 }}>
              Submitting sends a read-only snapshot. Validation spend starts only after approval.
            </span>
          </div>
          {startRun.error ? <ProblemBanner error={startRun.error} /> : null}
          {commit.error ? <ProblemBanner error={commit.error} /> : null}
        </div>

        <aside aria-label="Context" className="as-aside">
          <section aria-labelledby="mb" className="as-box">
            <h3 id="mb">Market boundary</h3>
            {boundary ? (
              <dl className="as-dl">
                <dt>Unit</dt>
                <dd>{boundary.marketUnit.charAt(0).toUpperCase() + boundary.marketUnit.slice(1)}</dd>
                <dt>Population</dt>
                <dd>Unique {boundary.populationUnit}s</dd>
                <dt>Geography</dt>
                <dd>
                  {boundary.countryCode === 'DE' ? 'Germany' : boundary.countryCode} · {boundary.segmentLabel}
                </dd>
                <dt>Currency</dt>
                <dd>
                  {boundary.currency} · {boundary.priceYear} prices
                </dd>
                <dt>Horizon</dt>
                <dd>{horizon} years</dd>
              </dl>
            ) : (
              <Skeleton height={80} />
            )}
            <Link
              to={`/me/cases/${caseKey}/sizing`}
              className="gos-link"
              style={{
                display: 'inline-flex',
                gap: 4,
                alignItems: 'center',
                marginTop: 8,
                fontSize: 12.5,
                fontWeight: 500,
              }}
            >
              Open sizing
              <Icon name="chevr" size={13} />
            </Link>
          </section>
          <section aria-labelledby="rv" className="as-box">
            <h3 id="rv">Reviewers</h3>
            <ul className="as-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.reviewers.map((r) => (
                <li key={r.person.id} className="as-row" style={{ justifyContent: 'space-between' }}>
                  <Person name={r.person.displayName} initials={r.person.initials} subtitle={r.area} />
                  <ReviewStatusTag status={reviewStatusOf(r.status)} />
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
      {assign ? (
        <AssignReviewerDialog caseKey={caseKey} options={people} onClose={() => setAssign(false)} />
      ) : null}
    </div>
  );
}
