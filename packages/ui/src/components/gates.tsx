/**
 * Gate family: GateRail (common.py rail/gate_node), AuthBoxes (components.py auth_boxes),
 * ConditionItem (condition), DissentItem (dissent), reviewer positions and the S10 approval panel.
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import {
  GATE_STATUS_LABELS,
  RAIL_SEGMENT_LABELS,
  RailSegment,
  type ApprovalPanelState,
  type ConditionInput,
  type GateCode,
  type GateDisposition,
  type GateStatus,
  type PersonRef,
} from '@growth-os/contracts';
import type { AuthBoxesProps, ConditionItemProps, GateRailProps, ReviewerPositionsProps } from './contracts';
import { Icon } from './Icon';
import { Avatar, Banner, Button, DataTable, Mono, TextAreaField } from './primitives';
import { ConditionFlagTag, ConditionStatusTag, GateDiamond, ReviewerPositionTag, StagePill } from './status';
import { GATE_STATUS_FG } from './status-maps';

// ---------------------------------------------------------------------------
// Gate rail
// ---------------------------------------------------------------------------

const RAIL_GATES: GateCode[] = ['G0', 'G1', 'G2', 'G3'];

/**
 * Stage segments with a diamond per gate between them; scope and date under each gate.
 * G2 approval never moves the case past G3 (the rail only renders what the server says).
 */
export function GateRail({ currentSegment, nodes, flag }: GateRailProps) {
  const segments = RailSegment.options;
  const current = segments.indexOf(currentSegment);
  const byGate = new Map(nodes.filter((n) => n.gateCode !== 'X').map((n) => [n.gateCode, n]));
  const items: ReactNode[] = [];
  segments.forEach((seg, i) => {
    const state = i === current ? 'current' : i < current ? 'past' : 'future';
    items.push(
      <li key={seg} className="gos-rail__seg" aria-current={state === 'current' ? 'step' : undefined}>
        <span className={`gos-rail__segpill gos-rail__segpill--${state}`}>
          {RAIL_SEGMENT_LABELS[seg]}
          {state === 'current' ? <span className="gos-sr-only"> (current stage)</span> : null}
        </span>
      </li>,
    );
    const gate = RAIL_GATES[i];
    const node = gate ? byGate.get(gate) : undefined;
    if (gate && node) {
      items.push(
        <li key={gate} className="gos-rail__node" data-gate={gate} data-status={node.status}>
          <span className="gos-rail__gate">
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>
              <GateDiamond status={node.status} size={16} />
            </span>
            {gate}
          </span>
          <span className="gos-rail__caption">{node.caption}</span>
          <span className="gos-rail__status" style={{ color: statusTextColor(node.status) }}>
            {GATE_STATUS_LABELS[node.status]}
          </span>
        </li>,
      );
    }
  });
  if (flag) {
    items.push(
      <li key="flag" className="gos-rail__flag">
        <StagePill stage={flag} />
      </li>,
    );
  }
  return (
    <ol aria-label="Stage and gate rail" className="gos-rail">
      {items}
    </ol>
  );
}

function statusTextColor(s: GateStatus): string {
  return s === 'invalidated' || s === 'expired' ? GATE_STATUS_FG[s] : 'var(--text-tertiary)';
}

// ---------------------------------------------------------------------------
// Authorizes / does not authorize
// ---------------------------------------------------------------------------

/** components.py auth_boxes(): "What this authorizes" / "What this does not authorize". */
export function AuthBoxes({ authorizes, doesNotAuthorize }: AuthBoxesProps) {
  const yesId = useId();
  const noId = useId();
  return (
    <div className="gos-auth">
      <section className="gos-auth__box gos-auth__box--yes" aria-labelledby={yesId}>
        <h3 id={yesId} className="gos-auth__title">
          What this authorizes
        </h3>
        <ul>
          {authorizes.map((t) => (
            <li key={t}>
              <Icon name="check" size={14} strokeWidth={2.2} />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="gos-auth__box gos-auth__box--no" aria-labelledby={noId}>
        <h3 id={noId} className="gos-auth__title">
          What this does not authorize
        </h3>
        <ul>
          {doesNotAuthorize.map((t) => (
            <li key={t}>
              <Icon name="x" size={14} strokeWidth={2.2} />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Condition, dissent, reviewer positions
// ---------------------------------------------------------------------------

/** components.py condition(): "Blocks execution until met" vs "Monitor only". */
export function ConditionItem({ conditionKey, text, owner, due, flag, status }: ConditionItemProps) {
  return (
    <div className="gos-condition" data-condition={conditionKey}>
      <div className="gos-condition__head">
        <Mono size={12} strong>
          {conditionKey}
        </Mono>
        <span className="gos-condition__text">{text}</span>
        <ConditionFlagTag flag={flag} />
      </div>
      <div className="gos-condition__meta">
        <span>Condition owner {owner}</span>
        <span>Due {due}</span>
        <ConditionStatusTag status={status} />
      </div>
    </div>
  );
}

export interface DissentItemProps {
  author: string;
  initials: string;
  role: string;
  statement: string;
  when: string;
  scope: string;
}

/** components.py dissent(): the reviewer's own words, signed and scoped. Never paraphrased. */
export function DissentItem({ author, initials, role, statement, when, scope }: DissentItemProps) {
  return (
    <figure className="gos-dissent">
      <div className="gos-dissent__head">
        <Avatar initials={initials} size={22} />
        <span className="gos-dissent__name">{author}</span>
        <span className="gos-dissent__role">{role}</span>
        <span className="gos-dissent__badge">
          <Icon name="message" size={13} />
          Dissent · signed
        </span>
        <span className="gos-dissent__when">{when}</span>
      </div>
      <blockquote>“{statement}”</blockquote>
      <figcaption>{scope}</figcaption>
    </figure>
  );
}

/** Reviewer positions table (research §6.12). */
export function ReviewerPositions({ rows }: ReviewerPositionsProps) {
  return (
    <DataTable
      ariaLabel="Sign-offs and reviewer positions"
      minWidth={600}
      rows={rows}
      rowKey={(r) => `${r.reviewer}-${r.role}`}
      columns={[
        {
          key: 'reviewer',
          header: 'Reviewer',
          cell: (r) => (
            <span className="gos-person__text">
              <span className="gos-person__name">{r.reviewer}</span>
              <span className="gos-person__sub">{r.role}</span>
            </span>
          ),
        },
        { key: 'position', header: 'Position', cell: (r) => <ReviewerPositionTag position={r.position} /> },
        { key: 'scope', header: 'Scope of review', cell: (r) => r.scope },
        { key: 'version', header: 'Version', cell: (r) => <Mono>{r.version}</Mono> },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Approval panel (S10)
// ---------------------------------------------------------------------------

export interface DecisionSubmission {
  disposition: GateDisposition;
  rationale: string;
  note: string | null;
  conditions: ConditionInput[];
}

export interface ApprovalPanelViewProps {
  gateCode: GateCode;
  status: GateStatus;
  /** Stamp text, e.g. "Awaiting decision · due 27 Nov". Defaults to the status label. */
  statusText?: string;
  snapshotVersion: number;
  fingerprint: string;
  expiresText?: string | null;
  /** Scoped label, e.g. "Approve pilot €120k · 90 days". Never a bare "Approve". */
  buttonLabel: string;
  authorizes: string[];
  doesNotAuthorize: string[];
  panel: ApprovalPanelState;
  /** Set when the snapshot is stale or differs from what the viewer read: approval is disabled. */
  disabledReason?: string | null;
  /** Candidate condition owners. */
  people?: PersonRef[];
  busy?: boolean;
  error?: ReactNode;
  onDecide?: (d: DecisionSubmission) => void;
  /** Extra action for viewers who cannot decide (e.g. "Withdraw v3" for the author). */
  secondaryAction?: ReactNode;
  /**
   * Body of the lock banner shown to viewers who cannot decide, under the policy reason (e.g.
   * "Viewing as Maya Rao. Only Elena Fischer can decide G2 v3."). Additive (D-064).
   */
  lockBody?: ReactNode;
  /** Shown after a decision was recorded. */
  decidedNote?: string | null;
}

type Mode = 'approve' | 'return_for_revision' | 'not_approved' | 'abstain';

const CHAIN_STATE = {
  waiting: 'Waiting',
  decided: 'Decided',
  abstained: 'Abstained',
  delegated: 'Delegated',
};

/**
 * Sticky S10 approval panel: version + fingerprint, expiry, viewer authority, authorizes boxes,
 * approval chain and scoped actions. Rationale is required for every decision. The panel never
 * offers an action the server did not allow (`panel.allowedDispositions`).
 */
export function ApprovalPanelView(props: ApprovalPanelViewProps) {
  const {
    gateCode,
    status,
    statusText,
    snapshotVersion,
    fingerprint,
    expiresText,
    buttonLabel,
    authorizes,
    doesNotAuthorize,
    panel,
    disabledReason,
    people = [],
    busy,
    error,
    onDecide,
    secondaryAction,
    decidedNote,
    lockBody,
  } = props;
  const [mode, setMode] = useState<Mode | null>(null);
  const [rationale, setRationale] = useState('');
  const [note, setNote] = useState('');
  const [conditions, setConditions] = useState<ConditionInput[]>([]);
  const modeHeading = useRef<HTMLDivElement>(null);
  const allowed = new Set(panel.allowedDispositions);
  const canApprove = allowed.has('approve') || allowed.has('approve_with_conditions');
  const open = (m: Mode) => {
    setMode(m);
    setRationale('');
    setNote('');
    setConditions([]);
    requestAnimationFrame(() => modeHeading.current?.focus());
  };
  const confirm = () => {
    if (!mode || !rationale.trim() || !onDecide) return;
    const disposition: GateDisposition =
      mode === 'approve' ? (conditions.length ? 'approve_with_conditions' : 'approve') : mode;
    onDecide({ disposition, rationale: rationale.trim(), note: note.trim() || null, conditions });
  };
  const MODES: Record<Mode, { title: string; confirm: string; note: string }> = {
    approve: {
      title: `${buttonLabel} · v${snapshotVersion}`,
      confirm: buttonLabel,
      note: `Records your identity, time, authority and fingerprint ${fingerprint}.`,
    },
    return_for_revision: {
      title: 'Return for revision',
      confirm: 'Return for revision',
      note: 'The author revises and submits a new version. Your comment is kept.',
    },
    not_approved: {
      title: 'Not approved',
      confirm: 'Record: Not approved',
      note: 'A recorded decision, not a failure. The case stays open for a stop or revision decision.',
    },
    abstain: {
      title: 'Abstain',
      confirm: 'Record abstention',
      note: 'Routes to the next approver under policy.',
    },
  };
  const md = mode ? MODES[mode] : null;
  return (
    <aside aria-label="Approval panel" className="gos-panel">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
        <span className="gos-panel__label">Gate {gateCode} · status</span>
        <div role="status" aria-live="polite">
          <span className="gos-panel__stamp" style={{ color: GATE_STATUS_FG[status] }} data-status={status}>
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>
              <GateDiamond status={status} size={16} />
            </span>
            <span className="gos-panel__stamp-text">{statusText ?? GATE_STATUS_LABELS[status]}</span>
          </span>
        </div>
      </div>
      <dl className="gos-panel__dl">
        <dt>Version</dt>
        <dd>
          <b style={{ fontWeight: 600 }}>Snapshot v{snapshotVersion}</b>
          <span style={{ color: 'var(--text-secondary)', display: 'inline-flex' }}>
            <Icon name="fingerprint" size={13} label="Fingerprint" />
          </span>
          <Mono size={12}>{fingerprint}</Mono>
        </dd>
        {expiresText ? (
          <>
            <dt>Expires</dt>
            <dd>{expiresText}</dd>
          </>
        ) : null}
      </dl>
      {panel.viewerAuthorityText ? (
        <div className="gos-panel__authority">
          <div style={{ fontWeight: 500 }}>Your authority</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {panel.viewerAuthorityText}
            {panel.viewerAuthorityText.includes('[') ? (
              <span style={{ color: 'var(--text-tertiary)' }}> (policy placeholder)</span>
            ) : null}
          </div>
        </div>
      ) : null}
      <AuthBoxes authorizes={authorizes} doesNotAuthorize={doesNotAuthorize} />
      <div>
        <div className="gos-panel__label" style={{ marginBottom: 6 }}>
          Approval chain · {panel.requiredApprovals} of{' '}
          {Math.max(panel.chain.length, panel.requiredApprovals)} required
        </div>
        <ul className="gos-list-plain" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {panel.chain.map((c) => (
            <li key={c.approver.id} className="gos-panel__chain">
              <Avatar initials={c.approver.initials} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>
                  {c.approver.displayName}
                  {c.isViewer ? ' · you' : ''}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.routingReason}</div>
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{CHAIN_STATE[c.state]}</span>
            </li>
          ))}
        </ul>
      </div>

      {error ? <div>{error}</div> : null}

      {decidedNote ? (
        <div className="gos-panel__section">
          <p style={{ margin: 0, fontSize: 13 }}>{decidedNote}</p>
          {secondaryAction}
        </div>
      ) : disabledReason ? (
        <div className="gos-panel__section">
          <Button variant="decision" block disabled>
            {buttonLabel}
          </Button>
          <p role="status" style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            {disabledReason}
          </p>
        </div>
      ) : !panel.canDecide ? (
        <div className="gos-panel__section">
          <Banner
            tone="lock"
            live={false}
            title={panel.cannotDecideReason ?? 'You cannot decide this gate.'}
            body={lockBody}
            actions={secondaryAction}
          />
        </div>
      ) : !md ? (
        <div className="gos-panel__section">
          {canApprove ? (
            <Button variant="decision" block onClick={() => open('approve')}>
              {buttonLabel}
            </Button>
          ) : null}
          <div className="gos-panel__secondary">
            {allowed.has('return_for_revision') ? (
              <Button variant="secondary" onClick={() => open('return_for_revision')}>
                Return for revision
              </Button>
            ) : null}
            {allowed.has('not_approved') ? (
              <Button variant="secondary" onClick={() => open('not_approved')}>
                Not approved
              </Button>
            ) : null}
            {allowed.has('abstain') ? (
              <Button variant="secondary" onClick={() => open('abstain')}>
                Abstain
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <form
          className="gos-panel__section"
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <div ref={modeHeading} tabIndex={-1} style={{ fontSize: 14, fontWeight: 600 }}>
            {md.title}
          </div>
          <TextAreaField label="Rationale" required value={rationale} onChange={setRationale} rows={3} />
          <TextAreaField label="Note" hint="optional" value={note} onChange={setNote} rows={2} />
          {mode === 'approve' ? (
            <ConditionsEditor people={people} value={conditions} onChange={setConditions} />
          ) : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Button
              variant={mode === 'approve' ? 'decision' : 'secondary'}
              tone={mode === 'approve' ? 'default' : 'dark'}
              type="submit"
              disabled={!rationale.trim() || busy}
              disabledReason={busy ? 'Recording…' : 'Write a rationale to record this decision.'}
            >
              {mode === 'approve' && conditions.length
                ? `${md.confirm} · ${conditions.length} condition${conditions.length > 1 ? 's' : ''}`
                : md.confirm}
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
          <p className="gos-panel__note">{md.note}</p>
        </form>
      )}
    </aside>
  );
}

/** Add conditions at approval: text, owner, due, "Blocks execution until met" or "Monitor only". */
function ConditionsEditor({
  people,
  value,
  onChange,
}: {
  people: PersonRef[];
  value: ConditionInput[];
  onChange: (v: ConditionInput[]) => void;
}) {
  const [text, setText] = useState('');
  const [ownerId, setOwnerId] = useState(people[0]?.id ?? '');
  const [due, setDue] = useState('');
  const [flag, setFlag] = useState<ConditionInput['flag']>('blocks_execution');
  const base = useId();
  const add = () => {
    if (!text.trim() || !ownerId) return;
    onChange([...value, { text: text.trim(), ownerId, dueOn: due || null, dueRule: null, flag }]);
    setText('');
    setDue('');
  };
  return (
    <fieldset className="gos-field">
      <legend style={{ marginBottom: 6 }}>
        Add conditions <span className="gos-field__hint">(optional)</span>
      </legend>
      {value.length ? (
        <ul
          className="gos-list-plain"
          style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}
        >
          {value.map((c, i) => (
            <li key={`${c.text}-${i}`} className="gos-condition" style={{ fontWeight: 400 }}>
              <div className="gos-condition__head">
                <span className="gos-condition__text">{c.text}</span>
                <ConditionFlagTag flag={c.flag} />
                <button
                  type="button"
                  className="gos-ibtn"
                  aria-label={`Remove condition: ${c.text}`}
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="gos-field" htmlFor={`${base}-t`}>
        Condition
        <input
          id={`${base}-t`}
          className="gos-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <label className="gos-field" htmlFor={`${base}-o`}>
          Condition owner
          <select
            id={`${base}-o`}
            className="gos-select"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="gos-field" htmlFor={`${base}-d`}>
          Due
          <input
            id={`${base}-d`}
            type="date"
            className="gos-input"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
      </div>
      <div role="radiogroup" aria-label="Effect of the condition">
        {(['blocks_execution', 'monitor_only'] as const).map((f) => (
          <label key={f} className="gos-radio">
            <input type="radio" name={`${base}-f`} checked={flag === f} onChange={() => setFlag(f)} />
            <ConditionFlagTag flag={f} />
          </label>
        ))}
      </div>
      <div>
        <Button
          variant="secondary"
          icon="plus"
          onClick={add}
          disabled={!text.trim()}
          disabledReason="Describe the condition first."
        >
          Add condition
        </Button>
      </div>
    </fieldset>
  );
}
