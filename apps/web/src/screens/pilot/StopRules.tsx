/**
 * S11 "Stop rules · pre-registered" (D-112, D-127): the approved G2's stop rules, read from the approved
 * snapshot, with their trip state. "Report trip" (the rule's owner, the case owner or the pilot owner)
 * records evidence and asks the sponsor to review. A trip never stops the pilot, pauses tasks or passes a
 * gate by itself (never-rule 7); the rules themselves never change here (never-rule 12).
 */
import {
  API,
  STOP_RULE_CONSEQUENCE_LABELS,
  STOP_RULE_STATUS_LABELS,
  STOP_RULE_TRIGGER_KIND_LABELS,
  type PersonRef,
  type StopRuleState,
} from '@growth-os/contracts';
import { Button, Icon, Mono, TextAreaField } from '@growth-os/ui';
import { useState } from 'react';
import { Modal } from '../../app/shell/Modal';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useCommand } from '../../lib/query';
import { fmtDateTime } from '../history/dates';

export function StopRules({
  rules,
  caseRef,
  viewer,
  canReportAny,
  onDone,
}: {
  rules: StopRuleState[];
  caseRef: string;
  viewer: PersonRef | undefined;
  /** Case owner or pilot owner (pilot.edit_plan); a rule's own owner may always report it. */
  canReportAny: boolean;
  onDone: (note: string) => void;
}) {
  const [tripping, setTripping] = useState<StopRuleState | null>(null);
  if (rules.length === 0) return null;
  return (
    <section className="ws8d-section" aria-labelledby="pilot-stop-rules">
      <div className="ws8d-row">
        <Icon name="squarestop" size={15} />
        <h2 id="pilot-stop-rules">Stop rules · pre-registered</h2>
      </div>
      <p className="ws8d-muted" style={{ margin: 0 }}>
        A tripped rule asks the sponsor to review. It never stops the pilot, pauses tasks or passes a gate by
        itself.
      </p>
      <ul className="ws8d-plain" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rules.map((r) => {
          const tripped = r.status === 'tripped';
          const mayReport = canReportAny || (!!viewer && viewer.id === r.owner.id);
          return (
            <li
              key={r.id}
              className="ws8d-section ws8d-section--dashed"
              aria-label={`${r.key} · ${r.trigger.text}`}
            >
              <div className="ws8d-row">
                <Mono strong>{r.key}</Mono>
                <span style={{ fontWeight: 500, fontSize: 13.5 }}>{r.trigger.text}</span>
                <span className={tripped ? 'ws8d-tag ws8d-tag--warn' : 'ws8d-tag'}>
                  {STOP_RULE_STATUS_LABELS[r.status]}
                </span>
              </div>
              <dl className="ws8d-meta">
                <dt>Trigger</dt>
                <dd>{STOP_RULE_TRIGGER_KIND_LABELS[r.trigger.kind]}</dd>
                <dt>Consequence</dt>
                <dd>{STOP_RULE_CONSEQUENCE_LABELS[r.consequence]}</dd>
                <dt>Owner</dt>
                <dd>{r.owner.displayName}</dd>
                {tripped && r.trippedBy ? (
                  <>
                    <dt>Reported</dt>
                    <dd>
                      {r.trippedBy.displayName} · {fmtDateTime(r.trippedAt)} · sponsor review requested
                    </dd>
                  </>
                ) : null}
              </dl>
              <div>
                <Button
                  variant="secondary"
                  icon="flag"
                  disabled={!mayReport || tripped}
                  disabledReason={
                    tripped
                      ? 'The sponsor review is open.'
                      : `Only ${r.owner.displayName}, the case owner or the pilot owner can report it.`
                  }
                  ariaLabel={`Report trip · ${r.key}`}
                  onClick={() => setTripping(r)}
                >
                  Report trip
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {tripping ? (
        <TripDialog rule={tripping} caseRef={caseRef} onClose={() => setTripping(null)} onDone={onDone} />
      ) : null}
    </section>
  );
}

function TripDialog({
  rule,
  caseRef,
  onClose,
  onDone,
}: {
  rule: StopRuleState;
  caseRef: string;
  onClose: () => void;
  onDone: (note: string) => void;
}) {
  const [evidence, setEvidence] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const cmd = useCommand(API.pilot.tripStopRule);
  const label = `Report trip · ${rule.key}`;
  const submit = async () => {
    setErr(null);
    try {
      await cmd.mutateAsync({
        params: { caseRef, stopRuleId: rule.id },
        body: { evidence: evidence.trim() },
      });
      onDone(`${rule.key} tripped · sponsor review requested. Nothing else changed.`);
      onClose();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <Modal label={label} onClose={onClose}>
      <div className="ws8d-dialog">
        <h2>{label}</h2>
        <p className="ws8d-note" style={{ margin: 0 }}>
          {rule.trigger.text}. Pre-registered consequence: {STOP_RULE_CONSEQUENCE_LABELS[rule.consequence]}.{' '}
          The sponsor is asked to review; tasks, the plan and the gate stay as they are.
        </p>
        <TextAreaField label="Evidence" required value={evidence} onChange={setEvidence} rows={3} />
        {err ? <ProblemBanner error={err} /> : null}
        <div className="ws8d-row">
          <Button
            variant="primary"
            disabled={!evidence.trim() || cmd.isPending}
            disabledReason={!evidence.trim() ? 'Evidence is required.' : 'Saving…'}
            onClick={submit}
          >
            Report trip and request sponsor review
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
