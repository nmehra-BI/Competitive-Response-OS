/**
 * S09 Assumptions and validation (Validation.dc.html). Register sorted by decision sensitivity,
 * then evidence quality (no combined score), the open dispute thread, the experiment card with
 * pre-registered thresholds, amendments and results, and the validation tasks.
 *
 * Deep links: ?assumption=ASM-01 (open its dispute), ?experiment=EXP-03, ?view=table|2x2.
 */
import { API, type Experiment, type GateRailNode } from '@growth-os/contracts';
import {
  Button,
  EmptyState,
  formatBudget,
  Pill,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  useFocusableScroll,
} from '@growth-os/ui';
import { useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery } from '../../lib/query';
import { useViewer } from '../../lib/session';

import '../decisions/ws8c.css';
import { AssumptionRegister2x2, AssumptionRegisterTable } from './AssumptionRegister';
import { DisputePanel } from './DisputePanel';
import { ExperimentCard } from './ExperimentCard';
import { G1Request } from './G1Request';
import { NewExperimentForm } from './NewExperimentForm';
import { ValidationTasks } from './ValidationTasks';

type View = 'table' | '2x2';

const APPROVED = new Set(['approved', 'approved_with_conditions']);

export default function ValidationScreen() {
  const { caseKey = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const view: View = sp.get('view') === '2x2' ? '2x2' : 'table';
  const [closed, setClosed] = useState(false);
  const [focusDispute, setFocusDispute] = useState(false);
  const [creating, setCreating] = useState(false);
  const viewer = useViewer().data?.person ?? null;
  const header = useApiQuery(API.cases.header, { params: { caseRef: caseKey } });
  const asm = useApiQuery(API.assumptions.list, { params: { caseRef: caseKey } });
  const exps = useApiQuery(API.experiments.list, { params: { caseRef: caseKey } });

  const setParam = (k: string, v: string | null) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );

  const page = useRef<HTMLDivElement>(null);
  useFocusableScroll(page, [asm.data, exps.data, view]);

  const items = asm.data?.items ?? [];
  const experiments = exps.data?.items ?? [];
  const selectedKey =
    sp.get('assumption') ?? items.find((a) => a.openDispute?.status === 'open')?.key ?? null;
  const selected = items.find((a) => a.key === selectedKey) ?? null;
  const showDispute = !closed && !!selected?.openDispute;
  const expKey = sp.get('experiment');
  const experiment: Experiment | null = experiments.find((e) => e.key === expKey) ?? experiments[0] ?? null;
  const rail: GateRailNode[] = header.data?.rail ?? [];
  const g1 = rail.find((n) => n.gateCode === 'G1');
  const g1Approved = !!g1 && APPROVED.has(g1.status);
  const isCaseOwner = !!viewer && header.data?.case.owner.id === viewer.id;
  const plan = experiment?.current.plan;
  const authorizedBy =
    g1Approved && plan?.budgetAmount && plan.currency
      ? `Authorized by G1 · validation ${formatBudget(plan.budgetAmount, plan.currency)}.`
      : null;

  return (
    <div ref={page} className="app-page ws8c-page">
      <SectionHeader
        title="Assumptions and validation"
        subtitle="Sorted by decision sensitivity, then evidence quality. No combined score."
        right={
          <SegmentedControl<View>
            ariaLabel="Register view"
            value={view}
            options={[
              { value: 'table', label: 'Table' },
              { value: '2x2', label: '2×2' },
            ]}
            onChange={(v) => setParam('view', v === 'table' ? null : v)}
          />
        }
      />

      {asm.isPending ? (
        <Skeleton height={320} />
      ) : asm.error ? (
        <ProblemBanner error={asm.error} />
      ) : (
        <>
          {showDispute && selected?.openDispute ? (
            <DisputePanel
              assumption={selected}
              dispute={selected.openDispute}
              viewer={viewer}
              sponsor={header.data?.case.sponsor ?? null}
              focusOnOpen={focusDispute}
              onClose={() => {
                setClosed(true);
                setFocusDispute(false);
                setParam('assumption', null);
              }}
            />
          ) : null}
          {view === 'table' ? (
            <AssumptionRegisterTable
              items={items}
              experiments={experiments}
              selectedKey={showDispute ? selectedKey : null}
              canChangeValues={isCaseOwner}
              onOpenDispute={(key) => {
                setClosed(false);
                setFocusDispute(true);
                setParam('assumption', key);
              }}
            />
          ) : (
            <AssumptionRegister2x2 items={items} />
          )}
        </>
      )}

      <div className="ws8c-split">
        <div className="ws8c-split__main ws8c-stack" style={{ gap: 12 }}>
          {exps.isPending ? (
            <Skeleton height={420} />
          ) : exps.error ? (
            <ProblemBanner error={exps.error} />
          ) : experiment ? (
            <>
              <ExperimentCard experiment={experiment} assumptions={items} viewer={viewer} />
              {!g1Approved ? (
                <G1Request
                  caseKey={caseKey}
                  experiment={experiment}
                  gateRequestId={g1?.gateRequestId ?? null}
                  canPrepare={isCaseOwner}
                />
              ) : null}
            </>
          ) : creating && viewer ? (
            <NewExperimentForm
              caseKey={caseKey}
              assumptions={items}
              owner={viewer}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <>
              <EmptyState
                title="No validation experiment yet"
                action={
                  isCaseOwner ? (
                    <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                      Create experiment
                    </Button>
                  ) : undefined
                }
              >
                Pre-register thresholds before fieldwork. G1 locks the plan; later changes are amendments with
                a reason.
              </EmptyState>
              {(exps.data?.examples ?? []).map((ex) => (
                <section key={ex.id} className="ws8c-card" aria-label="Illustrative example experiment">
                  <div className="ws8c-card__head">
                    <Pill label="Illustrative example" tone="neutral" icon="info" />
                    <h3>{ex.title}</h3>
                  </div>
                  <div className="ws8c-card__body">
                    <p className="ws8c-serif">{ex.current.plan.hypothesis}</p>
                    <ul className="ws8c-list">
                      {ex.current.plan.metrics.map((m) => (
                        <li key={m.metricKey}>
                          {m.name} {m.thresholdText}
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              ))}
            </>
          )}
        </div>
        <div className="ws8c-split__side">
          <ValidationTasks experiment={experiment} viewer={viewer} authorizedBy={authorizedBy} />
          {experiment?.displayResult === 'met' ? (
            <NextG2 caseKey={caseKey} node={rail.find((n) => n.gateCode === 'G2') ?? null} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NextG2({ caseKey, node }: { caseKey: string; node: GateRailNode | null }) {
  const pre = useApiQuery(API.gates.rail, { params: { caseRef: caseKey, gateCode: 'G2' } });
  const unmet = pre.data?.preconditions.filter((p) => !p.met) ?? [];
  const requested = !!node?.gateRequestId;
  return (
    <section className="ws8c-card" aria-labelledby="ws8c-next-g2">
      <div className="ws8c-card__body" style={{ gap: 8 }}>
        <h2 id="ws8c-next-g2" style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>
          Next: G2 pilot request
        </h2>
        <p style={{ margin: 0, fontSize: 13 }} className="ws8c-secondary">
          Thresholds met.{' '}
          {pre.isPending
            ? ''
            : unmet.length
              ? `Open G2 preconditions: ${unmet.map((p) => p.label.toLowerCase()).join('; ')}.`
              : 'G2 preconditions are met.'}
        </p>
        <div>
          <Button
            variant={requested ? 'secondary' : 'primary'}
            icon="arrowr"
            href={`/me/cases/${encodeURIComponent(caseKey)}/decisions?gate=G2`}
          >
            {requested ? 'Open pilot package' : 'Prepare pilot package'}
          </Button>
        </div>
      </div>
    </section>
  );
}
