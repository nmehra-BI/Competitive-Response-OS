// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ApprovalPanelState, PersonRef } from '@growth-os/contracts';
import {
  AutosaveStatus,
  Banner,
  Button,
  ChartTable,
  DataTable,
  IllustrativeDataBar,
  RestrictedValue,
  relativeTime,
} from './primitives';
import { ApprovalPanelView, AuthBoxes, ConditionItem, DissentItem, GateRail } from './gates';
import { FormulaRow, LineageDrawerView, MeasureLadderRow } from './ledger';
import { AssumptionChip, EvidenceItem, OwnerPicker, ReviewPanelView } from './shared';
import { KindTag } from './status';

afterEach(cleanup);

const elena: PersonRef = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Elena Fischer',
  title: 'BU VP · Sponsor',
  initials: 'EF',
};
const jonas: PersonRef = {
  id: '00000000-0000-4000-8000-000000000004',
  displayName: 'Jonas Klein',
  title: 'Pilot owner',
  initials: 'JK',
};

const panel = (over: Partial<ApprovalPanelState> = {}): ApprovalPanelState => ({
  canDecide: true,
  allowedDispositions: [
    'approve',
    'approve_with_conditions',
    'return_for_revision',
    'not_approved',
    'abstain',
  ],
  cannotDecideReason: null,
  viewerAuthorityText: 'Up to €[limit] · BU Water · pilots and validation',
  chain: [
    {
      approver: elena,
      routingReason: 'Pilot spend in BU Water routes to the BU VP',
      state: 'waiting',
      isViewer: true,
    },
  ],
  requiredApprovals: 1,
  receivedApprovals: 0,
  ...over,
});

const panelProps = {
  gateCode: 'G2' as const,
  status: 'awaiting_decision' as const,
  snapshotVersion: 3,
  fingerprint: '7F3A·19C2',
  buttonLabel: 'Approve pilot €120k · 90 days',
  authorizes: ['Pilot at up to 4 German food-processing sites'],
  doesNotAuthorize: ['Not market entry', 'Not scale'],
  people: [jonas],
};

describe('Button', () => {
  it('a disabled button always renders its reason and is described by it', () => {
    render(
      <Button variant="primary" disabled disabledReason="G3 preconditions unmet">
        Request scale approval
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Request scale approval' });
    expect(btn).toHaveProperty('disabled', true);
    const reason = document.getElementById(btn.getAttribute('aria-describedby')!);
    expect(reason?.textContent).toBe('G3 preconditions unmet');
  });

  it('refuses a bare "Approve" decision label', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Button variant="decision">Approve</Button>)).toThrow(/scoped label/);
    err.mockRestore();
  });
});

describe('ApprovalPanelView', () => {
  it('offers the scoped approve button and the three secondary decisions', () => {
    render(<ApprovalPanelView {...panelProps} panel={panel()} />);
    expect(screen.getByRole('button', { name: 'Approve pilot €120k · 90 days' })).toBeTruthy();
    for (const n of ['Return for revision', 'Not approved', 'Abstain'])
      expect(screen.getByRole('button', { name: n })).toBeTruthy();
    expect(screen.getByText('What this authorizes')).toBeTruthy();
    expect(screen.getByText('What this does not authorize')).toBeTruthy();
    expect(screen.getByText('(policy placeholder)', { exact: false })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Approve$/ })).toBeNull();
  });

  it('requires a rationale and sends conditions as approve_with_conditions', () => {
    const onDecide = vi.fn();
    render(<ApprovalPanelView {...panelProps} panel={panel()} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve pilot €120k · 90 days' }));
    const submit = screen.getByRole('button', { name: 'Approve pilot €120k · 90 days' });
    expect(submit).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText(/Rationale/), { target: { value: 'Thresholds met' } });
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'Pilot limited to 4 sites' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    fireEvent.click(screen.getByRole('button', { name: /Approve pilot €120k · 90 days · 1 condition/ }));
    expect(onDecide).toHaveBeenCalledWith({
      disposition: 'approve_with_conditions',
      rationale: 'Thresholds met',
      note: null,
      conditions: [
        {
          text: 'Pilot limited to 4 sites',
          ownerId: jonas.id,
          dueOn: null,
          dueRule: null,
          flag: 'blocks_execution',
        },
      ],
    });
  });

  it('shows why the author cannot approve and offers no decision buttons', () => {
    render(
      <ApprovalPanelView
        {...panelProps}
        panel={panel({
          canDecide: false,
          allowedDispositions: [],
          cannotDecideReason: 'You authored this package and cannot approve it.',
        })}
      />,
    );
    expect(screen.getByText('You authored this package and cannot approve it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve pilot/ })).toBeNull();
  });

  it('renders the lock banner body under the policy reason', () => {
    render(
      <ApprovalPanelView
        {...panelProps}
        panel={panel({
          canDecide: false,
          allowedDispositions: [],
          cannotDecideReason: 'You authored this package and cannot approve it.',
        })}
        lockBody="Viewing as Maya Rao. Only Elena Fischer can decide G2 v3."
        secondaryAction={<button type="button">Withdraw v3</button>}
      />,
    );
    const body = screen.getByText('Viewing as Maya Rao. Only Elena Fischer can decide G2 v3.');
    expect(body.className).toBe('gos-banner__body');
    expect(screen.getByRole('button', { name: 'Withdraw v3' })).toBeTruthy();
  });

  it('disables approval with a visible reason when stale', () => {
    render(
      <ApprovalPanelView
        {...panelProps}
        panel={panel()}
        disabledReason="Approval disabled: snapshot v3 is out of date. Refresh to create v4."
      />,
    );
    const btn = screen.getByRole('button', { name: 'Approve pilot €120k · 90 days' });
    expect(btn).toHaveProperty('disabled', true);
    expect(screen.getByText(/snapshot v3 is out of date/)).toBeTruthy();
  });
});

describe('gate objects', () => {
  it('GateRail marks the current stage for screen readers and shows status text per gate', () => {
    render(
      <GateRail
        currentSegment="pilot_review"
        nodes={[
          { gateCode: 'G0', status: 'approved', caption: 'Mandate · 5 Oct' },
          { gateCode: 'G1', status: 'approved', caption: 'Validation €15k · 16 Oct' },
          { gateCode: 'G2', status: 'awaiting_decision', caption: 'Pilot €120k · 90 days' },
          { gateCode: 'G3', status: 'not_started', caption: 'Scale' },
        ]}
      />,
    );
    const rail = screen.getByRole('list', { name: 'Stage and gate rail' });
    expect(rail.textContent).toContain('Pilot · Review (current stage)');
    expect(rail.textContent).toContain('Awaiting decision');
    expect(rail.querySelectorAll('[data-gate]').length).toBe(4);
  });

  it('AuthBoxes and conditions use the exact copy', () => {
    render(
      <>
        <AuthBoxes authorizes={['A']} doesNotAuthorize={['Not scale']} />
        <ConditionItem
          conditionKey="C2"
          text="Log effort weekly"
          owner="Jonas Klein"
          due="Weekly"
          flag="monitor_only"
          status="open"
        />
        <DissentItem
          author="Daniel Weber"
          initials="DW"
          role="Finance partner"
          statement="Plan on 10%."
          when="24 Nov"
          scope="Scope: adoption assumption"
        />
      </>,
    );
    expect(screen.getByText('Monitor only')).toBeTruthy();
    expect(screen.getByText('Dissent · signed')).toBeTruthy();
    expect(screen.getByText('“Plan on 10%.”')).toBeTruthy();
  });
});

describe('ledger family', () => {
  it('formula row and measure ladder row', () => {
    const onLineage = vi.fn();
    render(
      <>
        <FormulaRow lhs="SAM" expr="(1,400 + 1,100 − 500) × €20,000" result="€40m/year" />
        <MeasureLadderRow
          name="SAM"
          meaning="Sites we could serve"
          sites="2,000 unique sites"
          money="€40m/year"
          kinds={<KindTag kind="evidence" small />}
          onLineage={onLineage}
        />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lineage for SAM' }));
    expect(onLineage).toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Formula for SAM' }).textContent).toContain('€40m/year');
  });

  it('lineage drawer is a modal dialog that closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <LineageDrawerView
        title="SAM"
        onClose={onClose}
        node={{
          nodeKey: 'sizing.sam.value',
          label: 'SAM',
          kind: 'calculated',
          value: '40000000',
          unit: 'currency_per_year',
          formulaText: '(a + b − c) × d',
          formulaWithValues: '€40,000,000/year',
          inputs: [],
          dependsOnAssumptionCount: 1,
          ref: null,
        }}
        exactValue="€40,000,000"
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'SAM' });
    expect(dialog.textContent).toContain('€40,000,000');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('shared objects', () => {
  it('evidence item never shows an excerpt when restricted', () => {
    render(
      <EvidenceItem
        title="Vendor estimate"
        publisher="[Vendor]"
        published={null}
        quality="none"
        excerpt="secret text"
        restricted
        href="/evidence/SRC-030"
      />,
    );
    expect(document.body.textContent).not.toContain('secret text');
    expect(screen.getByText('Restricted')).toBeTruthy();
  });

  it('assumption chip announces dispute', () => {
    render(<AssumptionChip text="20% adoption" owner="Maya Rao" disputed href="/x" />);
    expect(screen.getByRole('link').getAttribute('aria-label')).toContain('disputed');
  });

  it('owner picker filters and picks with the keyboard', () => {
    const onChange = vi.fn();
    render(
      <OwnerPicker
        label="Accountable owner"
        required
        value={null}
        onChange={onChange}
        options={[elena, jonas]}
      />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Jo' } });
    expect(screen.getAllByRole('option').length).toBe(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(jonas.id);
  });

  it('review panel requires a position and a reason', () => {
    const onRespond = vi.fn();
    render(
      <ReviewPanelView
        title="Economics review"
        reviewer={elena}
        subtitle="Due 22 Oct"
        whatToCheck={['Margin']}
        onRespond={onRespond}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dispute' }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Ramp not checked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record: Dispute' }));
    expect(onRespond).toHaveBeenCalledWith({ response: 'dispute', reason: 'Ramp not checked' });
  });
});

describe('primitives', () => {
  it('autosave states use the FRONTEND §6 copy', () => {
    const now = new Date().toISOString();
    const cases = [
      [{ state: 'saving' } as const, 'Saving…'],
      [{ state: 'saved', at: now } as const, 'Saved · just now'],
      [{ state: 'unsaved' } as const, 'Unsaved changes — retry'],
      [{ state: 'conflict' } as const, 'Changed elsewhere'],
    ] as const;
    for (const [state, text] of cases) {
      render(<AutosaveStatus state={state} />);
      expect(screen.getByRole('status').textContent).toContain(text);
      cleanup();
    }
    expect(relativeTime(new Date(Date.now() - 120_000).toISOString())).toBe('2 min ago');
  });

  it('banner is a live status with glyph and title', () => {
    render(<Banner tone="warn" title="This snapshot is out of date" />);
    const s = screen.getByRole('status');
    expect(s.textContent).toContain('This snapshot is out of date');
    expect(s.querySelector('svg')).not.toBeNull();
  });

  it('illustrative ribbon and restricted value', () => {
    render(
      <>
        <IllustrativeDataBar />
        <RestrictedValue detail="licence excludes your role" />
      </>,
    );
    expect(screen.getByRole('note', { name: 'Illustrative data notice' }).textContent).toContain(
      'Illustrative data — synthetic',
    );
    expect(screen.getByText('Restricted')).toBeTruthy();
  });

  it('every chart has a table toggle', () => {
    render(
      <ChartTable
        caption="Customers at end of year 3 · count"
        chart={<svg role="img" aria-label="chart" />}
        table={{
          ariaLabel: 'Customers',
          rows: [{ s: 'Base', v: '100' }],
          rowKey: (r) => r.s,
          columns: [
            { key: 's', header: 'Scenario', cell: (r) => r.s },
            { key: 'v', header: 'Customers', numeric: true, cell: (r) => r.v },
          ],
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('table', { name: 'Customers' })).toBeTruthy();
  });
});

describe('DataTable scroll region', () => {
  const props = {
    ariaLabel: 'Pilot tasks',
    columns: [{ key: 'name', header: 'Name', cell: (r: { id: string }) => r.id }],
    rows: [{ id: 'PIL-11' }],
    rowKey: (r: { id: string }) => r.id,
  };

  it('is a named, keyboard-focusable region when overflow cannot be measured', () => {
    render(<DataTable {...props} />);
    const region = screen.getByRole('region', { name: 'Pilot tasks (scrollable)' });
    expect(region.tabIndex).toBe(0);
  });

  it('is not a tab stop when its content fits, and becomes one when it overflows', () => {
    let fire: () => void = () => {};
    let overflow = false;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          fire = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const sw = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(() => (overflow ? 900 : 300));
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    try {
      const { container } = render(<DataTable {...props} />);
      const scroller = container.querySelector<HTMLElement>('.gos-table-scroll')!;
      expect(scroller.getAttribute('tabindex')).toBeNull();
      expect(screen.queryByRole('region')).toBeNull();
      overflow = true;
      fire();
      expect(scroller.tabIndex).toBe(0);
      expect(screen.getByRole('region', { name: 'Pilot tasks (scrollable)' })).toBeTruthy();
    } finally {
      sw.mockRestore();
      cw.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
