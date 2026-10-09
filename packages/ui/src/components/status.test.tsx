// @vitest-environment jsdom
/**
 * Status semantics: every status renders its contract label as text AND a glyph. Colour is never
 * the only carrier of meaning (WCAG 1.4.1, research §7.5).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  AssumptionStatus,
  ASSUMPTION_STATUS_LABELS,
  CaseStage,
  CASE_STAGE_LABELS,
  ConditionStatus,
  CONDITION_STATUS_LABELS,
  ConnectorStatus,
  CONNECTOR_STATUS_LABELS,
  CrossCheckResult,
  CROSS_CHECK_RESULT_LABELS,
  EpistemicKind,
  EPISTEMIC_KIND_LABELS,
  EvidenceFreshness,
  EVIDENCE_FRESHNESS_LABELS,
  EvidenceQuality,
  EVIDENCE_QUALITY_LABELS,
  ExperimentResultDisplay,
  EXPERIMENT_RESULT_LABELS,
  GateStatus,
  GATE_STATUS_LABELS,
  OpportunityStatus,
  OPPORTUNITY_STATUS_LABELS,
  ReviewerPosition,
  REVIEWER_POSITION_LABELS,
  ReviewStatus,
  REVIEW_STATUS_LABELS,
  RunStatus,
  RUN_STATUS_LABELS,
  Scenario,
  SCENARIO_LABELS,
  Sensitivity,
  SENSITIVITY_LABELS,
  SyncStatus,
  SYNC_STATUS_LABELS,
  TaskStatus,
  TASK_STATUS_LABELS,
} from '@growth-os/contracts';
import type { ReactElement } from 'react';
import {
  AiBadge,
  AssumptionStatusTag,
  ConditionFlagTag,
  ConditionStatusTag,
  ConnectorStatusTag,
  CrossCheckTag,
  EvidenceQualityTag,
  Freshness,
  GateChip,
  GateDiamond,
  KindTag,
  OpportunityTag,
  ResultGlyph,
  ReviewerPositionTag,
  ReviewStatusTag,
  RunStatusTag,
  ScenarioLabel,
  ScenarioMark,
  SensitivityTag,
  SourceChip,
  StagePill,
  SyncStatusTag,
  TaskStatusTag,
} from './status';

afterEach(cleanup);

/** Renders, then asserts the exact label text and at least one SVG glyph. */
function expectTextAndGlyph(el: ReactElement, label: string) {
  const { container } = render(el);
  expect(container.textContent).toContain(label);
  // Stage pills without a dedicated icon use the prototype's dot glyph.
  expect(container.querySelector('svg, .gos-pill__dot')).not.toBeNull();
  cleanup();
}

const vocabularies: [string, readonly string[], (v: string) => ReactElement, Record<string, string>][] = [
  ['case stage', CaseStage.options, (v) => <StagePill stage={v as CaseStage} />, CASE_STAGE_LABELS],
  ['gate status', GateStatus.options, (v) => <GateChip status={v as GateStatus} />, GATE_STATUS_LABELS],
  [
    'experiment result',
    ExperimentResultDisplay.options,
    (v) => <ResultGlyph result={v as ExperimentResultDisplay} />,
    EXPERIMENT_RESULT_LABELS,
  ],
  [
    'assumption status',
    AssumptionStatus.options,
    (v) => <AssumptionStatusTag status={v as AssumptionStatus} />,
    ASSUMPTION_STATUS_LABELS,
  ],
  ['run status', RunStatus.options, (v) => <RunStatusTag status={v as RunStatus} />, RUN_STATUS_LABELS],
  [
    'connector',
    ConnectorStatus.options,
    (v) => <ConnectorStatusTag status={v as ConnectorStatus} />,
    CONNECTOR_STATUS_LABELS,
  ],
  [
    'freshness',
    EvidenceFreshness.options,
    (v) => <Freshness freshness={v as EvidenceFreshness} />,
    EVIDENCE_FRESHNESS_LABELS,
  ],
  [
    'evidence quality',
    EvidenceQuality.options,
    (v) => <EvidenceQualityTag quality={v as EvidenceQuality} />,
    EVIDENCE_QUALITY_LABELS,
  ],
  [
    'sensitivity',
    Sensitivity.options,
    (v) => <SensitivityTag level={v as Sensitivity} />,
    SENSITIVITY_LABELS,
  ],
  [
    'review status',
    ReviewStatus.options,
    (v) => <ReviewStatusTag status={v as ReviewStatus} />,
    REVIEW_STATUS_LABELS,
  ],
  [
    'reviewer position',
    ReviewerPosition.options,
    (v) => <ReviewerPositionTag position={v as ReviewerPosition} />,
    REVIEWER_POSITION_LABELS,
  ],
  [
    'condition status',
    ConditionStatus.options,
    (v) => <ConditionStatusTag status={v as ConditionStatus} />,
    CONDITION_STATUS_LABELS,
  ],
  ['task status', TaskStatus.options, (v) => <TaskStatusTag status={v as TaskStatus} />, TASK_STATUS_LABELS],
  [
    'cross-check',
    CrossCheckResult.options,
    (v) => <CrossCheckTag result={v as CrossCheckResult} />,
    CROSS_CHECK_RESULT_LABELS,
  ],
  ['scenario', Scenario.options, (v) => <ScenarioLabel scenario={v as Scenario} />, SCENARIO_LABELS],
];

describe('status vocabularies render text + glyph for every value', () => {
  for (const [name, values, renderOne, labels] of vocabularies) {
    it(name, () => {
      for (const v of values) expectTextAndGlyph(renderOne(v), labels[v]!);
    });
  }

  it('sync status (confirmed needs a key)', () => {
    for (const v of SyncStatus.options) {
      expectTextAndGlyph(<SyncStatusTag status={v} externalKey="PIL-11" />, SYNC_STATUS_LABELS[v]);
    }
  });

  it('opportunity status is text (outlined tag, no colour coding)', () => {
    for (const v of OpportunityStatus.options) {
      const { container } = render(<OpportunityTag status={v} />);
      expect(container.textContent).toBe(OPPORTUNITY_STATUS_LABELS[v]);
      cleanup();
    }
  });
});

describe('epistemic kinds', () => {
  it('each kind has glyph, label and its own line style', () => {
    const styles = new Set<string>();
    for (const k of EpistemicKind.options) {
      const { container } = render(<KindTag kind={k} detail="Maya Rao" />);
      const tag = container.querySelector('.gos-kind')!;
      expect(tag.textContent).toContain(EPISTEMIC_KIND_LABELS[k]);
      expect(tag.textContent).toContain('· Maya Rao');
      expect(tag.querySelector('svg')).not.toBeNull();
      styles.add(tag.className);
      cleanup();
    }
    expect(styles.size).toBe(EpistemicKind.options.length);
  });

  it('calculated ledger kind is labelled', () => {
    render(<KindTag kind="calculated" small />);
    expect(screen.getByText('Calculated')).toBeTruthy();
  });

  it('AI provenance is a separate badge', () => {
    render(<AiBadge variant="proposed" />);
    expect(screen.getByText('Proposed · AI')).toBeTruthy();
  });
});

describe('gate diamonds', () => {
  it('every state has an accessible name from GATE_STATUS_LABELS', () => {
    for (const s of GateStatus.options) {
      render(<GateDiamond status={s} />);
      expect(screen.getByRole('img', { name: GATE_STATUS_LABELS[s] })).toBeTruthy();
      cleanup();
    }
  });

  it('states are distinguishable by shape, not only colour', () => {
    const shapes = new Map<string, string>();
    for (const s of GateStatus.options) {
      const { container } = render(<GateDiamond status={s} />);
      const svg = container.querySelector('svg')!;
      const shape = svg.innerHTML + (svg.getAttribute('opacity') ?? '');
      shapes.set(s, shape);
      cleanup();
    }
    // By design (research §10.4) Invalidated/Expired share the ring and Preconditions open is the
    // outline diamond plus a count in its text ("2 of 5"); every other pair differs in shape.
    const shared = new Set(['expired', 'preconditions_open']);
    const distinct = new Set([...shapes.entries()].filter(([k]) => !shared.has(k)).map(([, v]) => v));
    expect(distinct.size).toBe(GateStatus.options.length - shared.size);
  });
});

describe('honest sync and conditions', () => {
  it('never shows "Confirmed" without an external key', () => {
    const { container } = render(<SyncStatusTag status="confirmed" externalKey={null} />);
    expect(container.textContent).not.toContain('Confirmed');
    expect(container.textContent).toContain('Checking');
  });

  it('shows the key next to Confirmed', () => {
    const { container } = render(<SyncStatusTag status="confirmed" externalKey="PIL-11" />);
    expect(container.textContent).toBe('Confirmed · PIL-11');
  });

  it('condition flags carry their exact wording', () => {
    render(<ConditionFlagTag flag="blocks_execution" />);
    expect(screen.getByText('Blocks execution until met')).toBeTruthy();
  });

  it('run status is a polite live region in business copy', () => {
    render(<RunStatusTag status="running" />);
    expect(screen.getByRole('status').textContent).toContain('Working: checking sources…');
  });
});

describe('marks and chips', () => {
  it('scenario markers use ▼ ● ▲ shapes', () => {
    const glyphs = Scenario.options.map((s) => {
      const { container } = render(<ScenarioMark scenario={s} />);
      const g = container.querySelector('svg')!.getAttribute('data-glyph');
      cleanup();
      return g;
    });
    expect(glyphs).toEqual(['▼', '●', '▲']);
  });

  it('restricted source chip shows a lock and no quality', () => {
    render(
      <SourceChip label="Vendor estimate · restricted" quality="none" href="/evidence/SRC-030" restricted />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('aria-label')).toContain('restricted source');
    expect(link.textContent).not.toContain('None');
  });
});
