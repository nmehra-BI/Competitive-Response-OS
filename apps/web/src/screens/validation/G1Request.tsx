/**
 * G1 request from S09: check the deterministic preconditions, then open and submit the request.
 * Submitting freezes snapshot v1 (canonical JSON + SHA-256); the fingerprint is shown. The
 * decision itself happens on S10 by the sponsor, never here.
 */
import { API, GATE_STATUS_LABELS, type Experiment, type GateScope } from '@growth-os/contracts';
import { Button, GateChip, Icon, Mono, Skeleton, formatBudget } from '@growth-os/ui';
import { Link } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';

/** The G1 ask composed from the plan: G1 authorizes validation spend only. */
export function g1ScopeFromPlan(e: Experiment): GateScope {
  const p = e.current.plan;
  const budget = p.budgetAmount && p.currency ? formatBudget(p.budgetAmount, p.currency) : null;
  return {
    amount: p.budgetAmount,
    currency: p.currency,
    durationDays: null,
    windowStart: p.windowStart,
    windowEnd: p.windowEnd,
    countryCodes: [],
    segmentLabel: null,
    maxSites: p.sampleSize,
    milestones: [],
    ownerId: e.owner.id,
    authorizes: [
      `Validation outreach to ${p.sampleSize ?? 'the selected'} sites${budget ? ` · up to ${budget}` : ''}`,
      ...p.metrics.map((m) => m.name),
    ],
    doesNotAuthorize: [
      'Not a pilot',
      'Not market entry or scale',
      ...(budget ? [`No spend above ${budget}`] : []),
    ],
  };
}

export function G1Request({
  caseKey,
  experiment,
  gateRequestId,
  canPrepare,
}: {
  caseKey: string;
  experiment: Experiment;
  gateRequestId: string | null;
  canPrepare: boolean;
}) {
  const pre = useApiQuery(API.gates.rail, { params: { caseRef: caseKey, gateCode: 'G1' } });
  const req = useApiQuery(
    API.gates.get,
    { params: { id: gateRequestId ?? '' } },
    { enabled: !!gateRequestId },
  );
  const create = useCommand(API.gates.createRequest);
  const submit = useCommand(API.gates.submit);
  const scope = g1ScopeFromPlan(experiment);
  const label =
    scope.amount && scope.currency
      ? `Approve validation ${formatBudget(scope.amount, scope.currency)}`
      : 'Approve validation';

  if (pre.isPending || (gateRequestId && req.isPending)) return <Skeleton height={120} />;
  if (pre.error) return <ProblemBanner error={pre.error} />;
  const r = gateRequestId ? req.data : null;
  const submitted = submit.data?.snapshot;
  const busy = create.isPending || submit.isPending;
  const run = async () => {
    let id = r?.id ?? null;
    if (!id) {
      const created = await create.mutateAsync({
        params: { caseRef: caseKey },
        body: { gateCode: 'G1', scope, parentGateRequestId: null, proposedConditions: [] },
      });
      id = created.id;
    }
    await submit.mutateAsync({ params: { id } });
  };
  const unmet = pre.data.preconditions.filter((p) => !p.met);

  return (
    <section aria-labelledby="ws8c-g1-title" className="ws8c-card">
      <div className="ws8c-card__head">
        <h2 id="ws8c-g1-title">G1 · {r?.buttonLabel ?? label}</h2>
        <span className="ws8c-card__head-right">
          <GateChip
            status={r?.displayStatus ?? pre.data.status}
            text={GATE_STATUS_LABELS[r?.displayStatus ?? pre.data.status]}
          />
        </span>
      </div>
      <div className="ws8c-card__body">
        <ul
          className="gos-list-plain ws8c-stack"
          aria-label="G1 preconditions"
          style={{ gap: 4, fontSize: 13 }}
        >
          {pre.data.preconditions.map((p) => (
            <li key={p.key} className="ws8c-row" style={{ gap: 6 }}>
              <span
                style={{ color: p.met ? 'var(--success-fg)' : 'var(--warning-fg)', display: 'inline-flex' }}
              >
                <Icon name={p.met ? 'checkcircle' : 'alert'} size={14} label={p.met ? 'Met' : 'Not met'} />
              </span>
              {p.label}
              {p.detail ? <span className="ws8c-muted">· {p.detail}</span> : null}
            </li>
          ))}
        </ul>
        {submitted || (r && r.status !== 'draft') ? (
          <div className="ws8c-stack" role="status">
            <p style={{ margin: 0, fontSize: 13 }}>
              Submitted for decision
              {submitted ? (
                <>
                  {' '}
                  · Snapshot v{submitted.version} · <Mono size={12}>{submitted.fingerprint}</Mono>
                </>
              ) : null}
              . Elena Fischer decides on S10; tasks and spend wait for the decision.
            </p>
            <Link className="gos-link" to={`/me/cases/${encodeURIComponent(caseKey)}/decisions?gate=G1`}>
              Open decision package
            </Link>
          </div>
        ) : canPrepare ? (
          <div className="ws8c-row">
            <Button
              variant="primary"
              icon="send"
              disabled={!pre.data.canSubmit || busy}
              disabledReason={
                busy
                  ? 'Freezing the snapshot…'
                  : `G1 preconditions unmet: ${unmet.map((p) => p.label.toLowerCase()).join('; ')}`
              }
              onClick={() => void run().catch(() => undefined)}
            >
              {`Submit G1 · ${label}`}
            </Button>
          </div>
        ) : (
          <p className="ws8c-secondary" style={{ margin: 0, fontSize: 13 }}>
            The case owner submits G1 when the plan is ready.
          </p>
        )}
        {create.error ? <ProblemBanner error={create.error} /> : null}
        {submit.error ? <ProblemBanner error={submit.error} /> : null}
      </div>
    </section>
  );
}
