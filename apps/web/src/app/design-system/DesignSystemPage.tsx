/**
 * /design-system — living mirror of the prototype's Foundations board (DesignSystem.dc.html,
 * generator p_ds.py). Every example renders the real @growth-os/ui component, so this page is
 * also the visual regression and axe target for the design system.
 */
import {
  AssumptionStatus,
  CaseStage,
  ConnectorStatus,
  EvidenceQuality,
  ExperimentResultDisplay,
  GATE_STATUS_LABELS,
  GateStatus,
  OpportunityStatus,
  RunStatus,
  Sensitivity,
  SyncStatus,
  type ApprovalPanelState,
  type PersonRef,
} from '@growth-os/contracts';
import {
  ActivityTimelineView,
  AiBadge,
  ApprovalPanelView,
  AssumptionChip,
  AssumptionStatusTag,
  AuthBoxes,
  AutosaveStatus,
  Banner,
  Button,
  ChartTable,
  ConditionItem,
  ConnectorStatusTag,
  DissentItem,
  Eyebrow,
  EvidenceItem,
  EvidenceQualityTag,
  FormulaRow,
  Freshness,
  GateChip,
  GateDiamond,
  GateRail,
  IllustrativeDataBar,
  InputLedgerTable,
  KindTag,
  MeasureLadderRow,
  OpportunityTag,
  OwnerPicker,
  RestrictedValue,
  ResultGlyph,
  ReviewPanelView,
  ReviewStatusTag,
  RunStatusTag,
  SWATCH_GROUPS,
  ScenarioLabel,
  SectionHeader,
  SensitivityTag,
  SourceChip,
  StagePill,
  SyncStatusTag,
  formatContributionK,
  formatCount,
  formatExact,
  formatGrossContribution,
  formatMarketSpend,
  formatNotAvailable,
  formatOf,
  formatOneTime,
  formatRangeMillions,
  formatRate,
  formatScenarioRevenue,
  formatSigned,
  formatThousands,
  DataTable,
  Mono,
  type Swatch,
} from '@growth-os/ui';
import { useEffect, useState, type ReactNode } from 'react';

function Section({
  id,
  title,
  sub,
  children,
}: {
  id: string;
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="ds-section">
      <SectionHeader id={id} title={title} subtitle={sub} />
      {children}
    </section>
  );
}

const grid = (min: number) => ({ gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))` });

function SwatchRow({ s }: { s: Swatch }) {
  return (
    <div className="ds-swatch">
      <span aria-hidden="true" className="ds-swatch__chips">
        <span style={{ background: s.light }} />
        <span style={{ background: s.dark }} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '16px', minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{s.name}</span>
        <span className="gos-mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
          {s.light} · {s.dark}
        </span>
        {s.note ? <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{s.note}</span> : null}
      </span>
    </div>
  );
}

function Vocab({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ds-box">
      <h3 style={{ margin: '0 0 8px', fontSize: 12.5, fontWeight: 600 }}>{title}</h3>
      <div className="ds-vocab">{children}</div>
    </div>
  );
}

const P = (id: number, displayName: string, title: string, initials: string): PersonRef => ({
  id: `a57eff99-0000-4000-8000-${String(id).padStart(12, '0')}`,
  displayName,
  title,
  initials,
});
const MAYA = P(2, 'Maya Rao', 'Strategy lead', 'MR');
const JONAS = P(4, 'Jonas Klein', 'Regional commercial lead', 'JK');
const PRIYA = P(5, 'Priya Shah', 'Product lead', 'PS');
const DANIEL = P(3, 'Daniel Weber', 'Finance partner', 'DW');
const ELENA = P(1, 'Elena Fischer', 'BU VP · Sponsor', 'EF');

const PANEL: ApprovalPanelState = {
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
      approver: ELENA,
      routingReason: 'Pilot spend in BU Water routes to the BU VP',
      state: 'waiting',
      isViewer: true,
    },
  ],
  requiredApprovals: 1,
  receivedApprovals: 0,
};

const SCENARIOS = [
  { s: 'downside' as const, customers: 50, x: 170, note: '' },
  { s: 'base' as const, customers: 100, x: 245, note: '' },
  { s: 'upside' as const, customers: 120, x: 320, note: ' · capped' },
];

function ScenarioDotPlot() {
  return (
    <svg
      role="img"
      aria-label="Downside 50, Base 100, Upside 120 customers; capacity 120"
      viewBox="0 0 400 90"
      style={{ width: '100%', height: 'auto', display: 'block', fontFamily: 'var(--font-ui)' }}
    >
      <line x1="20" y1="50" x2="380" y2="50" style={{ stroke: 'var(--border-strong)' }} />
      <line x1="320" y1="14" x2="320" y2="70" style={{ stroke: 'var(--chart-cap)' }} strokeWidth="2" />
      <text x="324" y="22" fontSize="11" style={{ fill: 'var(--chart-cap)' }}>
        Capacity 120
      </text>
      <path d="M164 42h12l-6 10Z" style={{ fill: 'var(--scenario-downside)' }} />
      <text x="170" y="72" fontSize="11" textAnchor="middle" style={{ fill: 'var(--text-secondary)' }}>
        ▼ Downside 50
      </text>
      <circle cx="245" cy="47" r="6" style={{ fill: 'var(--scenario-base)' }} />
      <text x="245" y="72" fontSize="11" textAnchor="middle" style={{ fill: 'var(--text-secondary)' }}>
        ● Base 100
      </text>
      <path d="M314 52h12l-6-10Z" style={{ fill: 'var(--scenario-upside)' }} />
      <text x="320" y="86" fontSize="11" textAnchor="middle" style={{ fill: 'var(--text-secondary)' }}>
        ▲ Upside 120 · capped
      </text>
      <text x="20" y="66" fontSize="10" style={{ fill: 'var(--text-tertiary)' }}>
        0
      </text>
    </svg>
  );
}

export function DesignSystemPage() {
  const [owner, setOwner] = useState<string | null>(JONAS.id);
  useEffect(() => {
    document.title = 'Design foundations · Market Expansion';
  }, []);
  const numberRows: [string, string][] = [
    [
      'Market sizes: lowercase m, unit after slash',
      `${formatMarketSpend('100000000.00', 'EUR')} · ${formatMarketSpend('40000000.00', 'EUR')}`,
    ],
    [
      'One format per row in comparison sets; no more precision than the fixture',
      [
        formatScenarioRevenue('1000000.00', 'EUR'),
        formatScenarioRevenue('2000000.00', 'EUR'),
        formatScenarioRevenue('2400000.00', 'EUR'),
        formatGrossContribution('600000.00', 'EUR'),
        formatGrossContribution('1200000.00', 'EUR'),
        formatGrossContribution('1440000.00', 'EUR'),
      ].join(' · '),
    ],
    [
      'Thousands: k, no decimals',
      [
        formatThousands('120000', 'EUR'),
        formatThousands('15000', 'EUR'),
        formatThousands('600000', 'EUR'),
      ].join(' · '),
    ],
    [
      'Scenario money names scenario and horizon',
      `${formatScenarioRevenue('2000000.00', 'EUR')} annual revenue · Base · end of year 3`,
    ],
    ['One-time money says so', formatOneTime('400000.00', 'EUR')],
    ['Ranges: en dash, unit once', `${formatRangeMillions('35000000', '50000000', 'EUR')} · 8–12 interviews`],
    ['Counts with thousands separator', `${formatCount(5000)} sites · ${formatCount(2000)} unique sites`],
    ['Signed adjustments use a true minus', formatSigned(-500)],
    [
      'Whole-number percentages for assumptions',
      `${formatRate('0.20')} adoption · ${formatRate('0.60')} margin`,
    ],
    ['Threshold ratios as x of y', `${formatOf(3, 4)} pilot customers met threshold`],
    [
      'True zero vs missing',
      `${formatContributionK('0.00', 'EUR')} · ${formatNotAvailable('needs ramp inputs')}`,
    ],
    ['Exact value on demand (ledger only)', formatExact('40000000', 'EUR')],
    ['Currency and year once per view header', 'EUR · 2026 prices'],
    ['Placeholders are bracketed, never invented', '€[cap] · €[limit]'],
  ];
  return (
    <div className="app-page">
      <h1>Design foundations</h1>
      <p style={{ margin: '4px 0 8px', fontSize: 13.5, color: 'var(--text-secondary)', maxWidth: 760 }}>
        One Growth OS family with Competitive Response: warm neutral canvas, one indigo accent, semantic hues
        for status only, violet for AI. Market Expansion adds epistemic kinds, an ordinal scenario ramp, gate
        diamonds and number rules.
      </p>

      <Section
        id="s-type"
        title="Typography"
        sub="Geist for interface, Source Serif 4 for reading, Geist Mono for IDs and ledger figures"
      >
        <div className="ds-grid" style={grid(300)}>
          <div className="ds-box">
            <Eyebrow>UI sans · Geist · 400/500/600</Eyebrow>
            <div style={{ fontSize: 30, lineHeight: '38px', fontWeight: 600, letterSpacing: '-0.02em' }}>
              Portfolio overview
            </div>
            <div style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>
              Approve pilot €120k · 90 days
            </div>
            <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600 }}>Measure ladder</div>
            <div style={{ fontSize: 14, lineHeight: '20px' }}>
              Interface text and tables, 14/20. Tabular figures: 5,000 · 2,000 · 500
            </div>
            <div style={{ fontSize: 13, lineHeight: '20px', color: 'var(--text-secondary)' }}>
              Secondary 13/20 · labels and meta
            </div>
            <div style={{ fontSize: 12, lineHeight: '16px', color: 'var(--text-tertiary)' }}>
              Caption 12/16 · timestamps
            </div>
          </div>
          <div className="ds-box">
            <Eyebrow>Reading serif · Source Serif 4 · 17/28</Eyebrow>
            <p className="gos-serif" style={{ margin: 0, fontSize: 17, lineHeight: '28px' }}>
              Aster should run a bounded, paid pilot with four German food-processing sites before any
              decision on market entry. The adoption assumption is disputed and stays visible.
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Decision package, thesis prose, evidence excerpts, exports.
            </p>
          </div>
          <div className="ds-box">
            <Eyebrow>Mono · Geist Mono · 13/20</Eyebrow>
            <div className="gos-mono" style={{ fontSize: 13, lineHeight: '22px' }}>
              ME-104 · v3 · 7F3A·19C2 · PIL-12
              <br />
              SAM = (1,400 + 1,100 − 500) × €20,000
              <br />
              {'    '}= €40,000,000/year
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
              IDs, versions, fingerprints, task keys, formula rows, ledger values.
            </p>
          </div>
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Scale 12/16 · 13/20 · 14/20 · 16/24 (serif 17/28) · 18/26 · 20/28 · 24/32 · 30/38
        </p>
      </Section>

      <Section
        id="s-pal"
        title="Palette"
        sub="Each swatch shows light | dark. Text pairs meet 4.5:1; marks meet 3:1."
      >
        {SWATCH_GROUPS.map((g) => (
          <div key={g.title}>
            <h3 className="ds-sub">{g.title}</h3>
            <div className="ds-grid" style={grid(200)}>
              {g.swatches.map((s) => (
                <SwatchRow key={s.name} s={s} />
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section id="s-sp" title="Spacing, radius, motion" sub="4 px base grid">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end' }}>
          {[2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64].map((v) => (
            <div key={v} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span
                aria-hidden="true"
                style={{
                  width: v,
                  height: v,
                  background: 'var(--accent-bg)',
                  border: '1px solid var(--accent-border)',
                }}
              />
              <span className="gos-mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                {v}
              </span>
            </div>
          ))}
        </div>
        <div className="ds-grid" style={{ ...grid(220), marginTop: 16, fontSize: 13 }}>
          <div className="ds-box">
            <Eyebrow>Radius</Eyebrow>4 · 6 · 8 px
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {[4, 6, 8].map((r) => (
                <span
                  key={r}
                  aria-hidden="true"
                  style={{
                    width: 32,
                    height: 24,
                    border: '1px solid var(--border-control)',
                    borderRadius: r,
                  }}
                />
              ))}
            </div>
          </div>
          <div className="ds-box">
            <Eyebrow>Layout</Eyebrow>Sidebar 240 · content max 1160–1240 · right panel 360 · rows 36 compact /
            44 comfortable
          </div>
          <div className="ds-box">
            <Eyebrow>Motion</Eyebrow>120 ms hover · 180 ms panels · 240 ms drawers · reduced-motion turns all
            off
          </div>
          <div className="ds-box">
            <Eyebrow>Focus</Eyebrow>
            <Button variant="secondary">Focus-visible ring</Button>
          </div>
        </div>
      </Section>

      <Section
        id="s-kind"
        title="Epistemic kinds"
        sub="Every number shows what kind of claim it is, by line style, glyph and label — never by colour alone"
      >
        <div className="ds-grid" style={grid(250)}>
          {[
            [
              <KindTag key="e" kind="evidence" detail="Census 2026" />,
              '5,000 sites',
              500,
              'Sourced fact from a permitted source. Solid 1 px border · document glyph.',
            ],
            [
              <KindTag key="a" kind="assumption" detail="Maya Rao" />,
              '20% adoption',
              500,
              'Human-owned belief used as input. Dashed 1 px border · ruler-pencil glyph.',
            ],
            [
              <KindTag key="s" kind="scenario" detail="Base · Year 3" />,
              '€2.0m annual revenue',
              500,
              'Output under named assumptions for a horizon. Dotted border · branch glyph. Never “forecast”.',
            ],
            [
              <KindTag key="ac" kind="actual" detail="1 Dec–28 Feb" />,
              '3 of 4 met',
              700,
              'Measured observation with period and source. Flag glyph · solid ink border · bold figures.',
            ],
            [
              <KindTag key="u" kind="unknown" />,
              'Unknown',
              500,
              'Required but not available. Never shown as 0.',
            ],
            [
              <span key="ai" style={{ display: 'inline-flex', gap: 4 }}>
                <AiBadge variant="draft" /> <KindTag kind="assumption" small />
              </span>,
              'Price €20k/year',
              500,
              'AI provenance is a separate badge beside the kind until a person accepts it.',
            ],
          ].map(([tag, value, weight, desc], i) => (
            <div key={i} className="ds-box" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>{tag as ReactNode}</div>
              <div style={{ fontSize: 20, fontWeight: weight as number }}>{value as string}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: '18px' }}>
                {desc as string}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="s-ramp"
        title="Scenario ramp"
        sub="Downside ▼ · Base ● · Upside ▲ — conditional cases, not probabilities"
      >
        <div className="ds-grid" style={grid(320)}>
          <ChartTable
            caption="Customers at end of year 3 · count · capacity cap 120"
            chart={<ScenarioDotPlot />}
            table={{
              ariaLabel: 'Customers at end of year 3 by scenario',
              minWidth: 280,
              rows: SCENARIOS,
              rowKey: (r) => r.s,
              rowHeader: 'scenario',
              columns: [
                { key: 'scenario', header: 'Scenario', cell: (r) => <ScenarioLabel scenario={r.s} /> },
                {
                  key: 'customers',
                  header: 'Customers',
                  numeric: true,
                  cell: (r) => `${r.customers}${r.note}`,
                },
              ],
            }}
          />
          <div className="ds-box" style={{ fontSize: 13, lineHeight: '20px' }}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {(['downside', 'base', 'upside'] as const).map((s) => (
                <ScenarioLabel key={s} scenario={s} size={13} />
              ))}
            </div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-secondary)' }}>
              <li>Fixed order Downside · Base · Upside, equal column widths.</li>
              <li>Shape and direct label carry identity; colour is the third cue.</li>
              <li>Never “likely”, “expected” or percentages next to scenario names.</li>
              <li>Base means reference assumptions, not the expected outcome.</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section id="s-gate" title="Gate diamonds" sub="One glyph family for gate status">
        <div className="ds-grid" style={grid(200)}>
          {GateStatus.options.map((s) => (
            <div
              key={s}
              className="ds-box"
              style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px' }}
            >
              <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                <GateDiamond status={s} size={16} />
              </span>
              <span style={{ fontSize: 13 }}>
                {GATE_STATUS_LABELS[s]}
                {s === 'preconditions_open' ? ' (2 of 5)' : ''}
              </span>
            </div>
          ))}
        </div>
        <div className="ds-box" style={{ marginTop: 16 }}>
          <GateRail
            currentSegment="scale"
            nodes={[
              { gateCode: 'G0', status: 'approved', caption: 'Mandate · 5 Oct' },
              { gateCode: 'G1', status: 'approved', caption: 'Validation €15k · 16 Oct' },
              {
                gateCode: 'G2',
                status: 'approved_with_conditions',
                caption: 'Pilot €120k · 90 days · 27 Nov',
              },
              { gateCode: 'G3', status: 'blocked', caption: 'Scale · 2 preconditions unmet' },
            ]}
          />
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Gate rail: stage segments with a diamond per gate, scope and date under each. G2 approval never
          moves the case past G3.
        </p>
      </Section>

      <Section
        id="s-voc"
        title="Status vocabularies"
        sub="One grammar per dimension, icon + text + colour, fixed position"
      >
        <div className="ds-grid" style={grid(420)}>
          <Vocab title="Case stage">
            {CaseStage.options.map((s) => (
              <StagePill key={s} stage={s} />
            ))}
          </Vocab>
          <Vocab title="Gate status">
            {GateStatus.options.map((s) => (
              <GateChip key={s} status={s} />
            ))}
          </Vocab>
          <Vocab title="Experiment result">
            {ExperimentResultDisplay.options.map((s) => (
              <ResultGlyph key={s} result={s} />
            ))}
          </Vocab>
          <Vocab title="Assumption status">
            {AssumptionStatus.options.map((s) => (
              <AssumptionStatusTag key={s} status={s} />
            ))}
          </Vocab>
          <Vocab title="Run status · analysis strip only">
            {RunStatus.options
              .filter((s) => !['awaiting_approval', 'cancelled'].includes(s))
              .map((s) => (
                <RunStatusTag key={s} status={s} />
              ))}
          </Vocab>
          <Vocab title="External sync">
            {SyncStatus.options.map((s) => (
              <SyncStatusTag key={s} status={s} externalKey={s === 'confirmed' ? 'PIL-12' : null} />
            ))}
          </Vocab>
          <Vocab title="Connector">
            {ConnectorStatus.options.map((s) => (
              <ConnectorStatusTag key={s} status={s} />
            ))}
          </Vocab>
          <Vocab title="Evidence freshness">
            <Freshness freshness="current" />
            <Freshness freshness="ageing" detail="34 days" />
            <Freshness freshness="stale" />
            <Freshness freshness="superseded" />
          </Vocab>
          <Vocab title="Evidence quality · sensitivity">
            {EvidenceQuality.options.map((s) => (
              <EvidenceQualityTag key={s} quality={s} />
            ))}
            {Sensitivity.options.map((s) => (
              <SensitivityTag key={s} level={s} />
            ))}
          </Vocab>
          <Vocab title="Opportunity status · reviews">
            {OpportunityStatus.options.map((s) => (
              <OpportunityTag key={s} status={s} />
            ))}
            <AiBadge variant="proposed" />
            <ReviewStatusTag status="signed" />
            <ReviewStatusTag status="signed_scoped" />
            <ReviewStatusTag status="pending" />
            <ReviewStatusTag status="in_review" />
            <ReviewStatusTag status="declined" />
          </Vocab>
          <Vocab title="Restricted · autosave">
            <RestrictedValue detail="licence excludes your role" />
            <AutosaveStatus state={{ state: 'saving' }} />
            <AutosaveStatus state={{ state: 'unsaved' }} />
            <AutosaveStatus state={{ state: 'conflict' }} />
          </Vocab>
          <Vocab title="Sources">
            <SourceChip label="Site census · 3 Jun 2026" quality="strong" href="/evidence/SRC-014" />
            <SourceChip label="Trade survey · 2026" quality="some" href="/evidence/SRC-021" />
            <SourceChip
              label="Vendor estimate · restricted"
              quality="none"
              href="/evidence/SRC-030"
              restricted
            />
          </Vocab>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Reserved words: “Approved” only for gates · “Met” only for thresholds · “Supported” only for
          assumptions · “Confirmed” only for external sync · “Verified” only for evidence strength · “Done”
          only for tasks. Red is reserved for system failures, contradictions and invalidated approvals.
        </p>
      </Section>

      <Section
        id="s-num"
        title="Number formatting"
        sub="Round to what the evidence supports; exact values live in the ledger"
      >
        <DataTable
          ariaLabel="Number formatting rules"
          minWidth={520}
          rows={numberRows}
          rowKey={(r) => r[0]}
          columns={[
            { key: 'rule', header: 'Rule', cell: (r) => r[0] },
            {
              key: 'example',
              header: 'Example',
              cell: (r) =>
                r[0].startsWith('Exact') ? (
                  <Mono size={13} strong>
                    {r[1]}
                  </Mono>
                ) : (
                  r[1]
                ),
            },
          ]}
        />
      </Section>

      <Section id="s-comp" title="Components" sub="Shared across screens">
        <div className="ds-grid" style={grid(440)}>
          <div>
            <h3 className="ds-sub">Evidence drawer item</h3>
            <EvidenceItem
              title="German food-processing site census, 2026 edition"
              publisher="[Publisher]"
              published="3 Jun 2026"
              quality="strong"
              excerpt="5,000 food-processing sites in Germany operate a process-water treatment step."
              href="/evidence/SRC-014"
              meta={
                <>
                  <span>Retrieved 8 Oct 2026</span>
                  <span>Licence: internal use, 2-sentence excerpts</span>
                </>
              }
            />
          </div>
          <div>
            <h3 className="ds-sub">Assumption chip</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <AssumptionChip
                text="20% adoption"
                owner="Maya Rao"
                disputed
                href="/me/cases/ME-104/validation?assumption=ASM-01"
              />
              <AssumptionChip
                text="€20k annual price"
                owner="Maya Rao"
                href="/me/cases/ME-104/validation?assumption=ASM-04"
              />
              <AssumptionChip
                text="Capacity 120 customers"
                owner="[Operations lead]"
                href="/me/cases/ME-104/validation"
              />
            </div>
            <h3 className="ds-sub">Owner picker</h3>
            <OwnerPicker
              label="Accountable owner"
              required
              value={owner}
              onChange={setOwner}
              options={[MAYA, JONAS, PRIYA, DANIEL]}
              hint="Only people with access to ME-104 are listed. Owner is one person, not a team."
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <h3 className="ds-sub">Formula ledger row</h3>
            <FormulaRow
              lhs="SAM"
              expr="(Size-qualified 1,400 + Process-qualified 1,100 − Overlap 500) × Annual spend per site €20,000"
              result="€40m/year · Calculated · depends on 1 assumption"
            />
            <div className="gos-card" style={{ marginTop: 8, overflow: 'hidden' }}>
              <InputLedgerTable
                rows={[
                  {
                    inputKey: 'annual_spend_per_site',
                    label: 'Annual spend per site',
                    valueText: '€20,000/year',
                    kind: 'assumption',
                    basis: 'Maya Rao · paid pilot offer',
                    quality: 'weak',
                    version: 'v2',
                    usedBy: 'TAM · SAM · SOM · Economics',
                  },
                ]}
              />
            </div>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <h3 className="ds-sub">Measure-ladder row</h3>
            <MeasureLadderRow
              name="SAM"
              meaning="Sites we could serve after eligibility and product-fit filters."
              sites="2,000 unique sites"
              money="€40m/year"
              kinds={
                <>
                  <KindTag kind="evidence" small />
                  <KindTag kind="assumption" small />
                </>
              }
              lineageHref="/me/cases/ME-104/sizing?input=sizing.sam.value&view=lineage"
            />
          </div>
          <div>
            <h3 className="ds-sub">Review panel</h3>
            <ReviewPanelView
              title="Economics review · requested of Daniel Weber"
              reviewer={DANIEL}
              subtitle="Due 22 Oct · Economics v2"
              whatToCheck={[
                'Margin definition: 60% gross, delivery/COGS deducted',
                'Opex scope: €600k/year incremental sales and admin',
                'Currency EUR · 2026 prices',
              ]}
            />
          </div>
          <div>
            <h3 className="ds-sub">Activity item</h3>
            <ActivityTimelineView
              items={[
                {
                  initials: 'EF',
                  title: 'Elena Fischer approved pilot €120k · 90 days (G2) with 3 conditions',
                  detail: 'Snapshot v3 · 7F3A·19C2',
                  when: '27 Nov, 09:14',
                  keyDecision: true,
                },
                {
                  initials: 'MR',
                  title: 'Maya Rao amended the validation window',
                  detail: 'Amendment 1 · original kept',
                  when: '2 Nov, 15:20',
                },
              ]}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <h3 className="ds-sub">Approval buttons</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
              <Button variant="decision">Approve validation €15k</Button>
              <Button variant="decision">Approve pilot €120k · 90 days</Button>
              <Button variant="decision">Approve extension €[cap]</Button>
              <Button
                variant="decision"
                disabled
                disabledReason="G3 preconditions unmet: demand threshold 3 of 4 (4 of 4 required)"
              >
                Authorize scale
              </Button>
              <Button variant="secondary">Return for revision</Button>
              <Button variant="secondary">Not approved</Button>
              <Button variant="ghost">Abstain</Button>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
              A bare “Approve” never appears. Disabled buttons always sit next to their reason.
            </p>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <h3 className="ds-sub">Authorizes / Does not authorize</h3>
            <AuthBoxes
              authorizes={[
                'Pilot at up to 4 German food-processing sites',
                'Up to €120k · 90 days (1 Dec 2026 – 28 Feb 2027)',
                'Creating the approved pilot tasks',
              ]}
              doesNotAuthorize={[
                'Not market entry',
                'Not scale',
                'Not prospect outreach',
                'Not spend above €120k',
              ]}
            />
          </div>
          <div>
            <h3 className="ds-sub">Dissent object</h3>
            <DissentItem
              author="Daniel Weber"
              initials="DW"
              role="Finance partner"
              statement="I do not see comparable evidence for 20% adoption in this segment. Plan on 10% until the pilot shows paid use."
              when="14 Oct, 10:02"
              scope="Scope: adoption assumption · carried into package v3"
            />
          </div>
          <div>
            <h3 className="ds-sub">Condition objects</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ConditionItem
                conditionKey="C1"
                text="Pilot limited to 4 sites as signed by the specialist"
                owner="Jonas Klein"
                due="1 Dec"
                flag="blocks_execution"
                status="met"
              />
              <ConditionItem
                conditionKey="C2"
                text="Log deployment effort per site every week"
                owner="Jonas Klein"
                due="Weekly"
                flag="monitor_only"
                status="open"
              />
            </div>
          </div>
          <div>
            <h3 className="ds-sub">Approval panel</h3>
            <ApprovalPanelView
              gateCode="G2"
              status="awaiting_decision"
              statusText="Awaiting decision · due 27 Nov"
              snapshotVersion={3}
              fingerprint="7F3A·19C2"
              expiresText="If unused by 11 Dec 2026"
              buttonLabel="Approve pilot €120k · 90 days"
              authorizes={[
                'Pilot at up to 4 German food-processing sites',
                'Up to €120k · 90 days, 1 Dec 2026 – 28 Feb 2027',
              ]}
              doesNotAuthorize={['Not market entry', 'Not scale']}
              panel={PANEL}
              people={[JONAS, MAYA]}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 className="ds-sub">Banners</h3>
            <Banner
              tone="warn"
              title="This snapshot is out of date: the adoption assumption changed on 26 Nov. Approval is disabled."
              live={false}
            />
            <Banner
              tone="danger"
              title="5 of 6 tasks confirmed in Jira · 1 failed (permission)"
              live={false}
            />
            <Banner tone="info" title="v4 is being prepared by Maya Rao" live={false} />
            <Banner tone="ok" title="Specialist sign-off recorded" live={false} />
            <Banner tone="neutral" title="Discovery partial — 1 source unavailable" live={false} />
            <Banner tone="lock" title="You authored this package and cannot approve it." live={false} />
            <h3 className="ds-sub">Illustrative-data ribbon</h3>
            <div className="gos-card" style={{ overflow: 'hidden' }}>
              <IllustrativeDataBar />
            </div>
            <h3 className="ds-sub">Scenario markers</h3>
            <div style={{ display: 'flex', gap: 14 }}>
              {(['downside', 'base', 'upside'] as const).map((s) => (
                <ScenarioLabel key={s} scenario={s} size={16} />
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Markers always sit next to their scenario name; the shape, not the colour, carries identity.
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}
