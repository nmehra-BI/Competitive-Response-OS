/**
 * Shared PRD §7 objects: evidence item, assumption chip, owner picker, review panel and activity
 * timeline (components.py evidence_item, assumption_chip, owner_picker, review_panel, activity_item).
 */
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EvidenceQuality, PersonRef, ReviewResponse } from '@growth-os/contracts';
import type { OwnerPickerProps } from './contracts';
import { Icon, UiLink } from './Icon';
import { Avatar, Button, RestrictedValue, TextAreaField } from './primitives';
import { EvidenceQualityTag, KindTag } from './status';

// ---------------------------------------------------------------------------
// Evidence item
// ---------------------------------------------------------------------------

export interface EvidenceItemProps {
  title: string;
  publisher: string | null;
  published: string | null;
  quality: EvidenceQuality;
  /** Permitted excerpt. Null when the licence excludes the viewer: no excerpt is ever shown. */
  excerpt: string | null;
  restricted?: boolean;
  meta?: ReactNode;
  href: string;
}

/** components.py evidence_item(): kind + quality + publisher, title, serif excerpt, licence meta. */
export function EvidenceItem({
  title,
  publisher,
  published,
  quality,
  excerpt,
  restricted,
  meta,
  href,
}: EvidenceItemProps) {
  return (
    <article className="gos-evidence" aria-label={title}>
      <div className="gos-evidence__meta">
        <KindTag kind="evidence" small />
        {restricted ? <RestrictedValue /> : <EvidenceQualityTag quality={quality} />}
        <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
          {[publisher, published ? `published ${published}` : null].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className="gos-evidence__title">{title}</div>
      {!restricted && excerpt ? <blockquote>“{excerpt}”</blockquote> : null}
      {restricted ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          The licence for this source does not include you. No excerpt is shown.
        </p>
      ) : null}
      <div className="gos-evidence__foot">
        {meta}
        <UiLink href={href} className="gos-link">
          Open source
        </UiLink>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Assumption chip
// ---------------------------------------------------------------------------

/** components.py assumption_chip(): dashed assumption chip with owner and dispute flag. */
export function AssumptionChip({
  text,
  owner,
  disputed,
  href,
}: {
  text: string;
  owner: string;
  disputed?: boolean;
  href: string;
}) {
  return (
    <UiLink
      href={href}
      className="gos-chip gos-chip--assumption"
      aria-label={`Assumption: ${text} · ${owner}${disputed ? ' · disputed' : ''}`}
    >
      <Icon name="pencilruler" size={13} />
      <span className="gos-chip__strong">{text}</span>
      <span>· {owner}</span>
      {disputed ? (
        <span className="gos-chip__flag">
          <Icon name="message" size={12} />
          Disputed
        </span>
      ) : null}
    </UiLink>
  );
}

// ---------------------------------------------------------------------------
// Owner picker (combobox + listbox, keyboard operable)
// ---------------------------------------------------------------------------

export interface OwnerPickerViewProps extends OwnerPickerProps {
  options: PersonRef[];
  hint?: string;
}

/** components.py owner_picker(): one accountable person, filtered by name or title. */
export function OwnerPicker({ value, onChange, required, label, options, hint }: OwnerPickerViewProps) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((p) => `${p.displayName} ${p.title ?? ''}`.toLowerCase().includes(s)) : options;
  }, [q, options]);
  const pick = (p: PersonRef | undefined) => {
    if (p) onChange(p.id);
  };
  const activeOpt = filtered[Math.min(active, filtered.length - 1)];
  return (
    <div className="gos-owner-picker">
      <label htmlFor={inputId} className="gos-field" style={{ marginBottom: 6 }}>
        {label}
        {required ? ' (required)' : ''}
      </label>
      <div className="gos-owner-picker__search">
        <Icon name="search" size={14} />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-required={required || undefined}
          aria-describedby={hint ? hintId : undefined}
          aria-activedescendant={activeOpt ? `${listId}-${activeOpt.id}` : undefined}
          value={q}
          placeholder="Search people"
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(activeOpt);
            }
          }}
        />
      </div>
      <ul ref={listRef} id={listId} role="listbox" aria-label="People" className="gos-owner-picker__list">
        {filtered.map((p, i) => (
          <li
            key={p.id}
            id={`${listId}-${p.id}`}
            role="option"
            aria-selected={p.id === value}
            className={
              i === active
                ? 'gos-owner-picker__option gos-owner-picker__option--active'
                : 'gos-owner-picker__option'
            }
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(p)}
          >
            <Avatar initials={p.initials} size={22} />
            <span style={{ flex: 1 }}>
              {p.displayName} {p.title ? <span className="gos-owner-picker__role">· {p.title}</span> : null}
            </span>
            {p.id === value ? (
              <Icon name="check" size={14} strokeWidth={2.2} style={{ color: 'var(--accent)' }} />
            ) : null}
          </li>
        ))}
        {!filtered.length ? (
          <li role="presentation" className="gos-owner-picker__hint" style={{ padding: 8 }}>
            No matching people.
          </li>
        ) : null}
      </ul>
      {hint ? (
        <div id={hintId} className="gos-owner-picker__hint">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review panel
// ---------------------------------------------------------------------------

export interface ReviewPanelViewProps {
  title: string;
  reviewer: PersonRef;
  subtitle: string;
  whatToCheck: string[];
  /** Existing response (read-only once responded). */
  response?: ReviewResponse | null;
  responseReason?: string | null;
  busy?: boolean;
  onRespond?: (r: { response: ReviewResponse; reason: string }) => void;
}

const RESPONSE_LABEL: Record<ReviewResponse, string> = {
  confirm: 'Confirm',
  dispute: 'Dispute',
  abstain: 'Abstain',
};

/** components.py review_panel(): focused question, what to check, Confirm / Dispute / Abstain + reason. */
export function ReviewPanelView({
  title,
  reviewer,
  subtitle,
  whatToCheck,
  response,
  responseReason,
  busy,
  onRespond,
}: ReviewPanelViewProps) {
  const [choice, setChoice] = useState<ReviewResponse | null>(null);
  const [reason, setReason] = useState('');
  const groupId = useId();
  return (
    <section className="gos-review-panel" aria-label={title}>
      <div className="gos-review-panel__head">
        <Avatar initials={reviewer.initials} size={24} />
        <div style={{ lineHeight: '17px' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{subtitle}</div>
        </div>
      </div>
      <div>
        <div className="gos-eyebrow" style={{ marginBottom: 4 }}>
          Claims to confirm
        </div>
        <ul>
          {whatToCheck.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
      {response ? (
        <p role="status" style={{ margin: 0, fontSize: 13 }}>
          You responded: <b style={{ fontWeight: 600 }}>{RESPONSE_LABEL[response]}</b>
          {responseReason ? ` — ${responseReason}` : ''}
        </p>
      ) : (
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (choice && reason.trim()) onRespond?.({ response: choice, reason: reason.trim() });
          }}
        >
          <div
            role="group"
            aria-labelledby={groupId}
            style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <span id={groupId} className="gos-sr-only">
              Your position
            </span>
            {(['confirm', 'dispute', 'abstain'] as const).map((r) => (
              <button
                key={r}
                type="button"
                className="gos-btn gos-btn--secondary"
                aria-pressed={choice === r}
                style={
                  choice === r
                    ? { borderColor: 'var(--text-primary)', boxShadow: 'inset 0 0 0 1px var(--text-primary)' }
                    : undefined
                }
                onClick={() => setChoice(r)}
              >
                {RESPONSE_LABEL[r]}
              </button>
            ))}
          </div>
          <TextAreaField label="Reason" required value={reason} onChange={setReason} rows={2} />
          <div>
            <Button
              variant="primary"
              type="submit"
              disabled={!choice || !reason.trim() || busy}
              disabledReason={busy ? 'Recording…' : 'Choose a position and write a reason.'}
            >
              {choice ? `Record: ${RESPONSE_LABEL[choice]}` : 'Record response'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Activity timeline
// ---------------------------------------------------------------------------

export interface ActivityItemViewProps {
  initials: string | null;
  title: string;
  detail?: string | null;
  when: string;
  keyDecision?: boolean;
  href?: string | null;
}

/** components.py activity_item(): avatar · title (+ "Key decision") · detail · time. */
export function ActivityItem({ initials, title, detail, when, keyDecision, href }: ActivityItemViewProps) {
  return (
    <li className="gos-activity__item">
      {initials ? (
        <Avatar initials={initials} size={24} />
      ) : (
        <span style={{ width: 24 }} aria-hidden="true" />
      )}
      <div className="gos-activity__body">
        <div className="gos-activity__title">
          {href ? (
            <UiLink
              href={href}
              className="gos-link"
              style={{ fontWeight: 500, color: 'var(--text-primary)' }}
            >
              {title}
            </UiLink>
          ) : (
            <span>{title}</span>
          )}
          {keyDecision ? (
            <span className="gos-keytag">
              <Icon name="pin" size={11} />
              Key decision
            </span>
          ) : null}
        </div>
        {detail ? <div className="gos-activity__detail">{detail}</div> : null}
      </div>
      <span className="gos-activity__when">{when}</span>
    </li>
  );
}

export function ActivityTimelineView({
  items,
  ariaLabel = 'Activity',
}: {
  items: ActivityItemViewProps[];
  ariaLabel?: string;
}) {
  return (
    <ul className="gos-activity" aria-label={ariaLabel}>
      {items.map((i) => (
        <ActivityItem key={`${i.when}-${i.title}`} {...i} />
      ))}
    </ul>
  );
}
