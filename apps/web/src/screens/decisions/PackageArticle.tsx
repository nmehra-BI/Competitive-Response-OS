/**
 * The read-only, versioned decision package (Decisions.dc.html "Decision package"), shared by S10
 * and the printable decision brief. Everything decision-relevant is read from the frozen snapshot
 * content (what the approver reads is what gets hashed); live condition status comes from the
 * gate request.
 */
import type { DecisionPackageView, GateCode, PersonRef, ReviewArea, Scenario } from '@growth-os/contracts';
import {
  ConditionItem,
  DissentItem,
  formatBudget,
  Icon,
  Mono,
  ResultGlyph,
  ReviewerPositions,
  ScenarioMark,
  useFocusableScroll,
} from '@growth-os/ui';
import { useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { dayMonth, dayTime, fullDate } from './dates';

export const GATE_KIND: Record<GateCode, string> = {
  G0: 'Mandate',
  G1: 'Validation',
  G2: 'Pilot',
  G3: 'Scale',
  X: 'Extension',
};

/** Review areas have no contract label map yet (change request in WS8c notes). */
export const REVIEW_AREA_ROLE: Record<ReviewArea, string> = {
  finance: 'Finance',
  specialist: 'Specialist',
  product: 'Product',
  commercial: 'Commercial',
  pilot_owner: 'Pilot owner',
  operations: 'Operations',
  sponsor: 'Sponsor',
};

/** Everyone the package names, by id (owners are ids in the frozen scope and conditions). */
export function peopleIn(pkg: DecisionPackageView): Map<string, PersonRef> {
  const all: PersonRef[] = [
    ...pkg.positions.map((p) => p.reviewer),
    ...pkg.snapshot.content.signOffs.map((p) => p.reviewer),
    ...pkg.gateRequest.conditions.flatMap((c) => [c.owner, c.addedBy]),
    ...pkg.panel.chain.map((c) => c.approver),
    ...pkg.dissent.map((d) => d.author),
    pkg.snapshot.createdBy,
    ...(pkg.gateRequest.submittedBy ? [pkg.gateRequest.submittedBy] : []),
  ];
  return new Map(all.map((p) => [p.id, p]));
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="ws8c-sec" aria-labelledby={id}>
      <h3 id={id}>
        {n} · {title}
      </h3>
      {children}
    </section>
  );
}

const RESULT_RE = /^(Met|Not met|Inconclusive) · (.+)$/;
const RESULT_KEY = { Met: 'met', 'Not met': 'not_met', Inconclusive: 'inconclusive' } as const;

/** "Met · 9 interviews (threshold 8) · Met · 4 paid commitments (threshold 4)" → glyph rows. */
export function splitResultSummary(
  summary: string,
): { result: 'met' | 'not_met' | 'inconclusive' | null; text: string }[] {
  return summary.split(/\s·\s(?=(?:Met|Not met|Inconclusive)\s·)/).map((part) => {
    const m = RESULT_RE.exec(part.trim());
    return m
      ? { result: RESULT_KEY[m[1] as keyof typeof RESULT_KEY], text: m[2]! }
      : { result: null, text: part.trim() };
  });
}

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const SCENARIOS: Record<string, Scenario> = { Downside: 'downside', Base: 'base', Upside: 'upside' };

export function PackageArticle({
  pkg,
  caseKey,
  caseTitle,
  compareTo,
}: {
  pkg: DecisionPackageView;
  caseKey: string;
  caseTitle: string;
  compareTo?: number;
}) {
  const s = pkg.snapshot;
  const c = s.content;
  const req = pkg.gateRequest;
  const people = peopleIn(pkg);
  const ref = useRef<HTMLElement>(null);
  useFocusableScroll(ref, [pkg]);
  const nameOf = (id: string | null) => (id ? (people.get(id)?.displayName ?? 'Owner on file') : '—');
  const scope = c.scope;
  const budget = scope.amount && scope.currency ? formatBudget(scope.amount, scope.currency) : null;
  const isCurrent = s.status === 'current' || s.status === 'stale';
  let n = 0;
  const next = () => ++n;

  const conditions = isCurrent
    ? req.conditions.map((x) => ({
        key: x.key,
        text: x.text,
        owner: x.owner.displayName,
        due: x.dueOn ? dayMonth(x.dueOn) : (x.dueRule ?? '—'),
        flag: x.flag,
        status: x.status,
        addedAtApproval:
          !!req.submittedBy && x.addedBy.id !== req.submittedBy.id ? x.addedBy.displayName : null,
      }))
    : c.conditionsProposed.map((x, i) => ({
        key: `C${i + 1}`,
        text: x.text,
        owner: nameOf(x.ownerId),
        due: x.dueOn ? dayMonth(x.dueOn) : (x.dueRule ?? '—'),
        flag: x.flag,
        status: 'open' as const,
        addedAtApproval: null,
      }));

  return (
    <article ref={ref} aria-label="Decision package" className="ws8c-package">
      <div className="ws8c-package__sheet">
        <div className="ws8c-package__meta">
          Decision package <Mono>{caseKey}</Mono> · {c.gateCode} · Snapshot v{s.version} ·{' '}
          <Mono>{s.fingerprint}</Mono>
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <Icon name="lock" size={12} />
            Read-only
          </span>
          <span>
            · Submitted by {(req.submittedBy ?? s.createdBy).displayName} · {dayTime(s.createdAt)}
          </span>
        </div>
        <h2 className="ws8c-package__title">
          {GATE_KIND[c.gateCode]}: {caseTitle}
        </h2>
        {pkg.changesSinceViewerLastSaw.length ? (
          <div className="ws8c-package__changes">
            <Icon name="compare" size={13} />
            Changes since {compareTo ? `v${compareTo}` : 'you last viewed this package'}:{' '}
            {pkg.changesSinceViewerLastSaw.join(' · ')}
          </div>
        ) : null}
        <div className="ws8c-ask">
          <div className="ws8c-ask__label">THE ASK</div>
          <p>{c.ask}</p>
        </div>

        <Section n={next()} title="Scope">
          <dl className="ws8c-dl" style={{ fontSize: 14, gridTemplateColumns: 'minmax(110px, 140px) 1fr' }}>
            <dt>Geography · segment</dt>
            <dd>
              {[scope.countryCodes.map(regionName).join(', ') || null, scope.segmentLabel]
                .filter(Boolean)
                .join(' · ') || '—'}
            </dd>
            {scope.maxSites ? (
              <>
                <dt>Sites</dt>
                <dd>Up to {scope.maxSites}</dd>
              </>
            ) : null}
            {scope.durationDays || (scope.windowStart && scope.windowEnd) ? (
              <>
                <dt>Duration</dt>
                <dd>
                  {[
                    scope.durationDays ? `${scope.durationDays} days` : null,
                    scope.windowStart && scope.windowEnd
                      ? `${fullDate(scope.windowStart)} – ${fullDate(scope.windowEnd)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </dd>
              </>
            ) : null}
            <dt>Budget</dt>
            <dd>
              {budget ? (
                <>
                  <b style={{ fontWeight: 600 }}>{budget}</b> · approved budget ceiling ·{' '}
                  {c.gateCode === 'G2' ? 'one-time pilot spend' : 'validation spend only'}
                </>
              ) : (
                'No spend requested'
              )}
            </dd>
            <dt>{c.gateCode === 'G2' ? 'Pilot owner' : 'Owner'}</dt>
            <dd>{nameOf(scope.ownerId)}</dd>
            {c.outcomeTargets.length ? (
              <>
                <dt>Review against</dt>
                <dd>
                  {c.outcomeTargets.map((t) => (
                    <div key={t.metricKey}>
                      {t.name}: {t.thresholdText} · {t.window}
                    </div>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
        </Section>

        <Section n={next()} title="Recommendation">
          <p className="ws8c-prose">
            <span className="ws8c-rec-tag">RECOMMENDATION</span>
            {c.recommendation}
          </p>
        </Section>

        {c.alternatives.length ? (
          <Section n={next()} title="Alternatives considered">
            <ul className="ws8c-prose-list">
              {c.alternatives.map((a) => (
                <li key={a.name}>
                  <b style={{ fontWeight: 600 }}>{a.name}</b> {a.meaning}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {c.validationResults.length ? (
          <Section n={next()} title="Validation results">
            <div className="ws8c-stack">
              {c.validationResults.map((r) => (
                <div key={r.resultVersionId} className="ws8c-stack">
                  <div className="ws8c-row" style={{ gap: '8px 14px' }}>
                    {splitResultSummary(r.summary).map((p) =>
                      p.result ? (
                        <ResultGlyph key={p.text} result={p.result} extra={p.text} />
                      ) : (
                        <span key={p.text}>{p.text}</span>
                      ),
                    )}
                  </div>
                  <p className="ws8c-serif ws8c-secondary">Limitation: {r.limitations}</p>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {c.assumptions.length ? (
          <Section n={next()} title="Critical assumptions">
            <div className="ws8c-chips">
              {c.assumptions.map((a) => (
                <Link
                  key={a.assumptionId}
                  to={`/me/cases/${encodeURIComponent(caseKey)}/validation`}
                  className="gos-chip gos-chip--assumption"
                  aria-label={`Assumption: ${a.name}${a.disputed ? ' · disputed' : ''}`}
                >
                  <Icon name="pencilruler" size={13} />
                  <span className="gos-chip__strong">{a.name}</span>
                  {a.disputed ? (
                    <span className="gos-chip__flag">
                      <Icon name="message" size={12} />
                      Disputed
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </Section>
        ) : null}

        {c.economics ? (
          <Section n={next()} title="Economics from snapshot">
            <div className="gos-table-scroll">
              <table className="ws8c-econ" aria-label={`Economics from snapshot v${s.version}`}>
                <thead>
                  <tr>
                    {(c.economics.tableText[0] ?? []).map((h, i) => (
                      <th key={h} scope="col" style={i === 0 ? { width: '40%' } : undefined}>
                        {SCENARIOS[h] ? (
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <ScenarioMark scenario={SCENARIOS[h]} /> {h}
                          </span>
                        ) : (
                          h
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.economics.tableText.slice(1).map((row) => (
                    <tr key={row[0]}>
                      {row.map((cell, i) =>
                        i === 0 ? (
                          <th key={i} scope="row" style={{ fontWeight: 400 }}>
                            {cell}
                          </th>
                        ) : (
                          <td key={i} className="gos-num">
                            {cell}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p
              className="ws8c-secondary"
              style={{ margin: '8px 0 0', fontSize: 13, display: 'flex', gap: 6, alignItems: 'baseline' }}
            >
              <span style={{ display: 'inline-flex', alignSelf: 'center' }}>
                <Icon name="lock" size={12} />
              </span>
              <span>
                Frozen in v{s.version}. {c.economics.note}
              </span>
            </p>
          </Section>
        ) : null}

        {c.signOffs.length ? (
          <Section n={next()} title="Sign-offs and reviewer positions">
            <ReviewerPositions
              rows={c.signOffs.map((p) => ({
                reviewer: p.reviewer.displayName,
                role: REVIEW_AREA_ROLE[p.area],
                position: p.position,
                scope: p.scopeText,
                version: p.signedVersion ? `v${p.signedVersion}` : '—',
              }))}
            />
          </Section>
        ) : null}

        {c.budgetAndStopRules.length ? (
          <Section n={next()} title="Budget and stop rules">
            <ul className="ws8c-prose-list">
              {c.budgetAndStopRules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {conditions.length ? (
          <Section n={next()} title="Conditions">
            <div className="ws8c-stack">
              {conditions.map((x) => (
                <div key={x.key}>
                  <ConditionItem
                    conditionKey={x.key}
                    text={x.text}
                    owner={x.owner}
                    due={x.due}
                    flag={x.flag}
                    status={x.status}
                  />
                  {x.addedAtApproval ? (
                    <div className="ws8c-small ws8c-secondary" style={{ marginTop: 4 }}>
                      Added by {x.addedAtApproval} at approval
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {c.dissent.length ? (
          <Section n={next()} title="Dissent">
            <div className="ws8c-stack">
              {c.dissent.map((d) => (
                <DissentItem
                  key={`${d.author.id}-${d.signedAt}`}
                  author={d.author.displayName}
                  initials={d.author.initials}
                  role={d.authorRole}
                  statement={d.statement}
                  when={dayTime(d.signedAt)}
                  scope={d.scopeText}
                />
              ))}
            </div>
          </Section>
        ) : null}

        {c.knownLimitations.length ? (
          <Section n={next()} title="Known limitations">
            <ul className="ws8c-prose-list">
              {c.knownLimitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {c.evidenceSummary.length ? (
          <Section n={next()} title="Sources">
            <div className="ws8c-chips">
              {c.evidenceSummary.map((e) => (
                <Link
                  key={e.sourceId}
                  to={`/evidence/${encodeURIComponent(e.sourceId)}`}
                  className="gos-chip"
                >
                  <Icon name="filetext" size={13} />
                  {e.label}
                </Link>
              ))}
            </div>
          </Section>
        ) : null}
      </div>
    </article>
  );
}
