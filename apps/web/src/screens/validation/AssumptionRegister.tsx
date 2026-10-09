/**
 * Assumption register (Validation.dc.html): table grouped Test first / Test next / Watch /
 * Monitor, sorted by sensitivity then evidence, and the 2×2 view. No combined score.
 */
import {
  REGISTER_GROUP_LABELS,
  type Assumption,
  type Experiment,
  type RegisterGroup,
} from '@growth-os/contracts';
import {
  AssumptionChip,
  AssumptionStatusTag,
  EvidenceQualityTag,
  Icon,
  Mono,
  SensitivityTag,
} from '@growth-os/ui';
import { useState } from 'react';
import { dayMonth } from '../decisions/dates';
import { ChangeValueForm } from './ChangeValueForm';
import { GROUP_SUBTITLE, groupRegister } from './register';

export interface RegisterProps {
  items: Assumption[];
  experiments: Experiment[];
  selectedKey: string | null;
  onOpenDispute: (key: string) => void;
  /** The case owner may change a value; the change is a new version with a reason (never-rule 12). */
  canChangeValues?: boolean;
}

function experimentKeys(a: Assumption, experiments: Experiment[]): string | null {
  const keys = experiments.filter((e) => a.linkedExperimentIds.includes(e.id)).map((e) => e.key);
  return keys.length ? keys.join(', ') : null;
}

export function AssumptionRegisterTable({
  items,
  experiments,
  selectedKey,
  onOpenDispute,
  canChangeValues = false,
}: RegisterProps) {
  const groups = groupRegister(items);
  const [changing, setChanging] = useState<string | null>(null);
  return (
    <div className="ws8c-register">
      <div className="gos-table-scroll">
        <table aria-label="Assumption register">
          <thead>
            <tr>
              <th scope="col">Assumption</th>
              <th scope="col">Owner</th>
              <th scope="col">Sensitivity</th>
              <th scope="col">Evidence</th>
              <th scope="col">Validation method</th>
              <th scope="col">Experiment</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.group}>
              <tr className="ws8c-group">
                <th scope="colgroup" colSpan={7}>
                  <span className="ws8c-group__name">{REGISTER_GROUP_LABELS[g.group]}</span>
                  <span className="ws8c-group__sub">{GROUP_SUBTITLE[g.group]}</span>
                </th>
              </tr>
              {g.items.map((a) => {
                const exp = experimentKeys(a, experiments);
                const disputed = a.openDispute?.status === 'open';
                return (
                  <tr key={a.id} data-assumption={a.key} data-selected={selectedKey === a.key || undefined}>
                    <th scope="row" style={{ fontWeight: 400 }}>
                      <div className="ws8c-asm">
                        <span className="ws8c-asm__icon" aria-hidden="true">
                          <Icon name="pencilruler" size={14} />
                        </span>
                        <div>
                          <div className="ws8c-asm__name">{a.name}</div>
                          <div className="ws8c-small ws8c-muted">If false: {a.consequenceIfFalse}</div>
                          {disputed && a.openDispute ? (
                            <button
                              type="button"
                              className="ws8c-linkbtn"
                              aria-label={`Disputed by ${a.openDispute.raisedBy.displayName}: open the dispute on ${a.name}`}
                              onClick={() => onOpenDispute(a.key)}
                            >
                              <Icon name="message" size={12} />
                              Disputed by {a.openDispute.raisedBy.displayName}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </th>
                    <td>{a.owner.displayName}</td>
                    <td>
                      <SensitivityTag level={a.sensitivity} />
                    </td>
                    <td>
                      <EvidenceQualityTag quality={a.current.evidenceQuality} />
                    </td>
                    <td className="ws8c-secondary">{a.validationMethod}</td>
                    <td>{exp ? <Mono size={12}>{exp}</Mono> : <span className="ws8c-muted">—</span>}</td>
                    <td>
                      <AssumptionStatusTag status={a.status} detail={a.statusDetail ?? undefined} />
                      {a.dueOn ? <div className="ws8c-small ws8c-muted">Due {dayMonth(a.dueOn)}</div> : null}
                      {canChangeValues && a.status !== 'retired' ? (
                        changing === a.id ? (
                          <ChangeValueForm assumption={a} onDone={() => setChanging(null)} />
                        ) : (
                          <button
                            type="button"
                            className="ws8c-linkbtn"
                            aria-label={`Change value · ${a.name}`}
                            onClick={() => setChanging(a.id)}
                          >
                            Change value
                          </button>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

const QUADRANTS: { group: RegisterGroup; title: string; hot?: boolean }[] = [
  { group: 'test_first', title: 'Test first · high, weak evidence', hot: true },
  { group: 'test_next', title: 'Test next · high, some evidence' },
  { group: 'watch', title: 'Watch · lower, weak evidence' },
  { group: 'monitor', title: 'Monitor · lower, some evidence' },
];

/** 2×2: decision sensitivity (rows) × evidence quality (columns). Chips, never a score. */
export function AssumptionRegister2x2({ items }: { items: Assumption[] }) {
  const groups = new Map(groupRegister(items).map((g) => [g.group, g.items]));
  return (
    <div className="ws8c-quad" role="group" aria-label="Assumption register · 2×2">
      <div className="ws8c-quad__axis-y" aria-hidden="true">
        Decision sensitivity →
      </div>
      {QUADRANTS.map((q) => (
        <section
          key={q.group}
          className={q.hot ? 'ws8c-quad__cell ws8c-quad__cell--hot' : 'ws8c-quad__cell'}
          aria-label={REGISTER_GROUP_LABELS[q.group]}
        >
          <h3>{q.title}</h3>
          <div className="ws8c-chips">
            {(groups.get(q.group) ?? []).map((a) => (
              <AssumptionChip
                key={a.id}
                text={a.name}
                owner={a.owner.displayName}
                disputed={a.openDispute?.status === 'open'}
                href={`?view=2x2&assumption=${encodeURIComponent(a.key)}`}
              />
            ))}
          </div>
        </section>
      ))}
      <div aria-hidden="true" />
      <div className="ws8c-quad__axis-x" aria-hidden="true">
        Evidence quality: weak → strong
      </div>
    </div>
  );
}
