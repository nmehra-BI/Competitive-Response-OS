/**
 * Explainer scenes: SVG motion graphics as a PURE function of time. `Scene` draws chapter `index` at local
 * time `s` (seconds); the player owns the clock, so pause, scrub and chapter jumps are exact, a still frame is
 * `s = duration`, and the MP4 export is a recording of this component. Colours are design tokens only
 * (`var(--…)` in style, never in presentation attributes); fonts are the UI, serif and mono tokens.
 */
import { GUIDE_PATH_LABELS, type GuidePath } from '@growth-os/contracts';
import type { CSSProperties, ReactNode } from 'react';
import { CHAPTERS, ROLE_ENDINGS } from './script';

export const STAGE_W = 960;
export const STAGE_H = 540;

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - (1 - clamp(x)) ** 3;
/** 0 → 1 between `start` and `start + dur` seconds, eased. */
const at = (s: number, start: number, dur = 0.6) => easeOut((s - start) / dur);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

const UI: CSSProperties = { fontFamily: 'var(--font-ui)' };
const MONO: CSSProperties = { fontFamily: 'var(--font-mono)' };
const SERIF: CSSProperties = { fontFamily: 'var(--font-serif)' };

function T({
  x,
  y,
  children,
  size = 16,
  weight = 400,
  color = 'var(--text-primary)',
  font = UI,
  anchor = 'start',
  opacity = 1,
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  weight?: number;
  color?: string;
  font?: CSSProperties;
  anchor?: 'start' | 'middle' | 'end';
  opacity?: number;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      style={{ ...font, fontSize: size, fontWeight: weight, fill: color, opacity }}
    >
      {children}
    </text>
  );
}

function Box({
  x,
  y,
  w,
  h,
  fill = 'var(--bg-surface)',
  stroke = 'var(--border-subtle)',
  dash,
  strokeWidth = 1,
  r = 8,
  opacity = 1,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  dash?: string;
  strokeWidth?: number;
  r?: number;
  opacity?: number;
}) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={r}
      style={{ fill, stroke, strokeWidth, strokeDasharray: dash, opacity }}
    />
  );
}

/** Status chip: glyph + text + colour (research §7.5: never colour alone). */
function Chip({
  x,
  y,
  text,
  tone,
  glyph,
  opacity = 1,
  width,
}: {
  x: number;
  y: number;
  text: string;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'ai' | 'accent';
  glyph?: string;
  opacity?: number;
  width?: number;
}) {
  const fg = tone === 'accent' ? 'var(--accent)' : `var(--${tone}-fg)`;
  const bg = tone === 'accent' ? 'var(--accent-bg)' : `var(--${tone}-bg)`;
  const label = glyph ? `${glyph} ${text}` : text;
  const w = width ?? 16 + label.length * 7.2;
  return (
    <g style={{ opacity }}>
      <rect x={x} y={y} width={w} height={26} rx={13} style={{ fill: bg }} />
      <T x={x + 10} y={y + 18} size={13} weight={500} color={fg}>
        {label}
      </T>
    </g>
  );
}

type DiamondState = 'approved' | 'awaiting' | 'blocked' | 'not_started';

/** Gate diamond (research §10.4). */
function Diamond({
  cx,
  cy,
  state,
  size = 18,
}: {
  cx: number;
  cy: number;
  state: DiamondState;
  size?: number;
}) {
  const d = `M ${cx} ${cy - size} L ${cx + size} ${cy} L ${cx} ${cy + size} L ${cx - size} ${cy} Z`;
  const colour =
    state === 'approved'
      ? 'var(--success-fg)'
      : state === 'awaiting'
        ? 'var(--info-fg)'
        : state === 'blocked'
          ? 'var(--warning-fg)'
          : 'var(--neutral-fg)';
  return (
    <g>
      <path
        d={d}
        style={{ fill: state === 'approved' ? colour : 'var(--bg-surface)', stroke: colour, strokeWidth: 2 }}
      />
      {state === 'awaiting' ? (
        <path
          d={`M ${cx} ${cy - size} L ${cx - size} ${cy} L ${cx} ${cy + size} Z`}
          style={{ fill: colour }}
        />
      ) : null}
      {state === 'approved' ? (
        <path
          d={`M ${cx - 7} ${cy} l 5 5 l 9 -10`}
          style={{ fill: 'none', stroke: 'var(--bg-surface)', strokeWidth: 2.5 }}
        />
      ) : null}
      {state === 'blocked' ? (
        <line x1={cx - 8} y1={cy} x2={cx + 8} y2={cy} style={{ stroke: colour, strokeWidth: 2.5 }} />
      ) : null}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

const SCATTER = [
  { x: 90, y: 120, rot: -4, title: 'Germany_v7_final.pptx', kind: 'Slides' },
  { x: 650, y: 110, rot: 3, title: 'SOM (2).xlsx', kind: 'Spreadsheet' },
  { x: 120, y: 330, rot: 2, title: 'Re: Re: approved?', kind: 'Email' },
  { x: 640, y: 330, rot: -3, title: 'Pilot tasks — Q4', kind: 'Task tool' },
] as const;

function ScatterCard({ c, s, i, k }: { c: (typeof SCATTER)[number]; s: number; i: number; k: number }) {
  const appear = at(s, 0.2 + i * 0.5);
  const drift = Math.sin((s + i) * 0.9) * 6;
  const x = lerp(c.x, 380, k);
  const y = lerp(c.y + drift, 200, k);
  return (
    <g
      transform={`translate(${x} ${y + (1 - appear) * 20}) rotate(${c.rot * (1 - k)})`}
      style={{ opacity: appear * (1 - k) }}
    >
      <Box x={0} y={0} w={220} h={120} />
      <T x={14} y={26} size={12} color="var(--text-tertiary)">
        {c.kind}
      </T>
      <T x={14} y={50} size={15} weight={600}>
        {c.title}
      </T>
      {[70, 86, 102].map((ly, j) => (
        <rect
          key={ly}
          x={14}
          y={ly}
          width={190 - j * 40}
          height={6}
          rx={3}
          style={{ fill: 'var(--bg-sunken)' }}
        />
      ))}
    </g>
  );
}

function Problem({ s }: { s: number }) {
  const linkIn = at(s, 2, 0.8);
  const breakK = at(s, 5.2, 0.8);
  const links: [number, number, number, number][] = [
    [310, 180, 650, 170],
    [200, 240, 230, 330],
    [760, 230, 750, 330],
    [340, 390, 640, 390],
  ];
  return (
    <g>
      {links.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={lerp(x1, x2, linkIn * (1 - breakK * 0.45))}
          y2={lerp(y1, y2, linkIn * (1 - breakK * 0.45))}
          style={{ stroke: 'var(--border-control)', strokeWidth: 1.5, strokeDasharray: '6 6' }}
        />
      ))}
      {SCATTER.map((c, i) => (
        <ScatterCard key={c.title} c={c} s={s} i={i} k={0} />
      ))}
      <Chip x={392} y={250} text="Which version?" tone="warning" glyph="⚠" opacity={at(s, 5.6)} />
      <Chip x={402} y={290} text="Who approved?" tone="warning" glyph="⚠" opacity={at(s, 6.2)} />
    </g>
  );
}

const TABS = [
  'Thesis',
  'Sizing',
  'Feasibility',
  'Economics',
  'Validation',
  'Decisions',
  'Pilot',
  'Outcomes',
  'History',
];
/** Tab x positions from their text widths (13 px Geist ≈ 6.9 px per character) plus a 14 px gap. */
const TAB_X: number[] = TABS.reduce<number[]>(
  (acc, _t, i) => [...acc, i === 0 ? 28 : acc[i - 1]! + TABS[i - 1]!.length * 6.9 + 14],
  [],
);

/** The tab the underline sweeps to: one per half second from 4 s, then it rests on Decisions. */
const tabAt = (s: number) => Math.min(5, Math.max(0, Math.floor((s - 4) / 0.5)));

function CaseScene({ s }: { s: number }) {
  const gather = at(s, 0, 1.6);
  const card = at(s, 1.4, 0.8);
  return (
    <g>
      {SCATTER.map((c, i) => (
        <ScatterCard key={c.title} c={c} s={9} i={i} k={gather} />
      ))}
      <g transform={`translate(150 ${150 + (1 - card) * 16})`} style={{ opacity: card }}>
        <Box x={0} y={0} w={660} h={250} />
        <T x={28} y={44} size={14} font={MONO} color="var(--text-secondary)">
          ME-104
        </T>
        <T x={28} y={80} size={24} weight={600}>
          German food-processing plants — monitoring
        </T>
        <Chip x={28} y={98} text="Validation" tone="accent" width={96} />
        <T x={140} y={116} size={14} color="var(--text-secondary)">
          Owner Maya Rao · Sponsor Elena Fischer · Germany · EUR 2026
        </T>
        <line x1={28} y1={150} x2={632} y2={150} style={{ stroke: 'var(--border-subtle)' }} />
        {TABS.map((tab, i) => {
          const k = at(s, 4 + i * 0.3, 0.4);
          return (
            <T key={tab} x={TAB_X[i]!} y={182} size={13} color="var(--text-secondary)" opacity={k}>
              {tab}
            </T>
          );
        })}
        <rect
          x={TAB_X[tabAt(s)]!}
          y={192}
          width={TABS[tabAt(s)]!.length * 6.9}
          height={3}
          rx={1.5}
          style={{ fill: 'var(--accent)', opacity: at(s, 4.2) }}
        />
        <T x={28} y={228} size={13} color="var(--text-tertiary)" opacity={at(s, 7)}>
          One case · one owner · one stage · every version kept
        </T>
      </g>
    </g>
  );
}

const KINDS = [
  {
    label: 'Evidence',
    detail: 'SRC-014 · site registry',
    value: '5,000 sites',
    fg: 'var(--kind-evidence-fg)',
    bg: 'var(--kind-evidence-bg)',
    dash: undefined,
    width: 1,
  },
  {
    label: 'Assumption · Maya Rao',
    detail: 'Adoption 20% by year 3',
    value: '20%',
    fg: 'var(--kind-assumption-fg)',
    bg: 'var(--kind-assumption-bg)',
    dash: '6 4',
    width: 1,
  },
  {
    label: 'Scenario · Base · Year 3',
    detail: 'Calculated · named assumptions',
    value: '€2.0m annual revenue',
    fg: 'var(--kind-scenario-fg)',
    bg: 'var(--kind-scenario-bg)',
    dash: '2 3',
    width: 1,
  },
  {
    label: 'Actual · 1 Dec–28 Feb',
    detail: 'Paid use and continuation',
    value: '3 of 4',
    fg: 'var(--kind-actual-fg)',
    bg: 'var(--kind-actual-bg)',
    dash: undefined,
    width: 1,
  },
] as const;

function Kinds({ s }: { s: number }) {
  const ai = at(s, 9.2);
  return (
    <g>
      {KINDS.map((k, i) => {
        const a = at(s, 1 + i * 0.9);
        const y = 110 + i * 72;
        return (
          <g key={k.label} transform={`translate(${130 + (1 - a) * 24} ${y})`} style={{ opacity: a }}>
            <Box x={0} y={0} w={700} h={56} fill="var(--bg-surface)" stroke={k.fg} dash={k.dash} />
            {i === 3 ? <rect x={0} y={0} width={4} height={56} style={{ fill: k.fg }} /> : null}
            <rect x={16} y={14} width={8 + k.label.length * 7.4} height={28} rx={4} style={{ fill: k.bg }} />
            <T x={22} y={33} size={13.5} weight={600} color={k.fg}>
              {k.label}
            </T>
            <T x={240} y={34} size={14} color="var(--text-secondary)">
              {k.detail}
            </T>
            <T x={684} y={34} size={16} weight={600} anchor="end">
              {k.value}
            </T>
          </g>
        );
      })}
      <g transform={`translate(130 ${398 + (1 - ai) * 16})`} style={{ opacity: ai }}>
        <Box x={0} y={0} w={700} h={56} stroke="var(--kind-assumption-fg)" dash="6 4" />
        <rect x={16} y={14} width={94} height={28} rx={4} style={{ fill: 'var(--kind-assumption-bg)' }} />
        <T x={22} y={33} size={13.5} weight={600} color="var(--kind-assumption-fg)">
          Assumption
        </T>
        <rect x={118} y={14} width={86} height={28} rx={4} style={{ fill: 'var(--ai-bg)' }} />
        <T x={126} y={33} size={13.5} weight={600} color="var(--ai-fg)">
          ✦ AI draft
        </T>
        <T x={250} y={34} size={14} color="var(--text-secondary)">
          Proposed — waiting for a person to accept or edit
        </T>
      </g>
    </g>
  );
}

const RUNGS = [
  { name: 'TAM', def: 'Annual market spend', sites: 5000, count: '5,000 sites', money: '€100m/year' },
  {
    name: 'SAM',
    def: 'Serviceable after fit filters',
    sites: 2000,
    count: '2,000 unique sites',
    money: '€40m/year',
  },
  {
    name: 'Reachable pool',
    def: 'Within channel coverage',
    sites: 500,
    count: '500 unique sites',
    money: '',
  },
  {
    name: 'SOM · Scenario · Year 3',
    def: '500 × 20% adoption',
    sites: 100,
    count: '100 customers',
    money: '€2.0m annual revenue',
  },
] as const;

function Ladder({ s }: { s: number }) {
  const strike = at(s, 8.6, 0.8);
  const totalIn = at(s, 8.2);
  return (
    <g>
      <T x={100} y={100} size={13} color="var(--text-tertiary)">
        Site counts · EUR · 2026 prices
      </T>
      {RUNGS.map((r, i) => {
        const grow = at(s, 0.6 + i * 1.4, 1);
        const y = 120 + i * 78;
        const w = Math.max(6, (r.sites / 5000) * 520) * grow;
        return (
          <g key={r.name} style={{ opacity: at(s, 0.4 + i * 1.4) }}>
            <T x={100} y={y + 22} size={15} weight={600}>
              {r.name}
            </T>
            <T x={100} y={y + 42} size={12.5} color="var(--text-tertiary)">
              {r.def}
            </T>
            <rect
              x={330}
              y={y + 8}
              width={w}
              height={34}
              rx={3}
              style={{ fill: 'var(--kind-scenario-bg)' }}
            />
            <rect x={330} y={y + 8} width={3} height={34} style={{ fill: 'var(--kind-scenario-fg)' }} />
            <T x={344} y={y + 30} size={13} font={MONO} color="var(--text-secondary)">
              {r.count}
            </T>
            <T x={870} y={y + 30} size={15} weight={600} anchor="end">
              {r.money}
            </T>
          </g>
        );
      })}
      <g style={{ opacity: at(s, 6.2) }}>
        <T x={870} y={452} size={13} anchor="end" color="var(--text-secondary)">
          ▼ €1.0m · ● €2.0m · ▲ €2.4m annual revenue (Downside · Base · Upside)
        </T>
      </g>
      <g style={{ opacity: totalIn }}>
        <Box x={330} y={468} w={540} h={40} dash="4 4" stroke="var(--border-control)" fill="none" />
        <T x={346} y={494} size={14} color="var(--text-tertiary)">
          TAM + SAM + pool + SOM = ?
        </T>
        <line
          x1={340}
          y1={488}
          x2={340 + 200 * strike}
          y2={488}
          style={{ stroke: 'var(--danger-fg)', strokeWidth: 2 }}
        />
        <Chip
          x={572}
          y={475}
          text="No total — different questions"
          tone="neutral"
          glyph="⊘"
          opacity={strike}
        />
      </g>
    </g>
  );
}

const GATES = [
  { code: 'G0', x: 210, label: 'Scope' },
  { code: 'G1', x: 420, label: 'Validate €15k' },
  { code: 'G2', x: 630, label: 'Pilot €120k · 90 days' },
  { code: 'G3', x: 840, label: 'Scale' },
] as const;

function Gates({ s }: { s: number }) {
  const stale = at(s, 8.8);
  const card = at(s, 3.6);
  const states: DiamondState[] = [
    s >= 1 ? 'approved' : 'not_started',
    s >= 1.8 ? 'approved' : 'not_started',
    s >= 2.6 ? 'awaiting' : 'not_started',
    'not_started',
  ];
  return (
    <g>
      <line x1={90} y1={130} x2={890} y2={130} style={{ stroke: 'var(--border-strong)', strokeWidth: 2 }} />
      {['Mandate', 'Discovery · Assessment', 'Validation', 'Pilot · Review', 'Scale'].map((seg, i) => (
        <T
          key={seg}
          x={[120, 315, 525, 735, 905][i]!}
          y={110}
          size={12.5}
          anchor="middle"
          color="var(--text-tertiary)"
        >
          {seg}
        </T>
      ))}
      {GATES.map((g, i) => (
        <g key={g.code} style={{ opacity: at(s, 0.2 + i * 0.3) }}>
          <Diamond cx={g.x} cy={130} state={states[i]!} />
          <T x={g.x} y={172} size={13} weight={600} anchor="middle">
            {g.code}
          </T>
          <T x={g.x} y={190} size={12} anchor="middle" color="var(--text-tertiary)">
            {g.label}
          </T>
        </g>
      ))}
      <g transform={`translate(200 ${222 + (1 - card) * 16})`} style={{ opacity: card }}>
        <Box x={0} y={0} w={560} h={270} />
        <T x={24} y={34} size={13} color="var(--text-tertiary)">
          Decision package · G2 ·{' '}
        </T>
        <T x={172} y={34} size={13} font={MONO} color="var(--text-secondary)">
          Snapshot v3
        </T>
        <T x={24} y={64} size={18} weight={600} font={SERIF}>
          German food-processing plants — pilot
        </T>
        <Box x={24} y={80} w={248} h={74} fill="var(--success-bg)" stroke="none" r={6} />
        <T x={36} y={102} size={12.5} weight={600} color="var(--success-fg)">
          Authorizes
        </T>
        <T x={36} y={124} size={12.5}>
          The 90-day pilot · €120k one-time
        </T>
        <Box x={288} y={80} w={248} h={74} fill="var(--neutral-bg)" stroke="none" r={6} />
        <T x={300} y={102} size={12.5} weight={600} color="var(--neutral-fg)">
          Does not authorize
        </T>
        <T x={300} y={124} size={12.5}>
          Market entry or scale
        </T>
        <g style={{ opacity: 1 - stale * 0.55 }}>
          <rect x={24} y={172} width={262} height={38} rx={6} style={{ fill: 'var(--accent)' }} />
          <T x={155} y={196} size={14} weight={600} anchor="middle" color="var(--bg-surface)">
            Approve pilot €120k · 90 days
          </T>
        </g>
        <T x={300} y={196} size={13} color="var(--text-secondary)" opacity={1 - stale}>
          Elena Fischer decides · rationale required
        </T>
        <g style={{ opacity: stale }}>
          <Box x={24} y={222} w={512} h={34} fill="var(--warning-bg)" stroke="none" r={6} />
          <T x={36} y={244} size={13} color="var(--warning-fg)" weight={600}>
            ⚠ Stale — Base adoption changed after v3. Refresh (creates v4).
          </T>
        </g>
      </g>
    </g>
  );
}

const TASKS = [
  { title: 'Confirm 4 pilot sites and contacts', owner: 'Jonas Klein' },
  { title: 'Install monitoring at 4 sites', owner: '[Operations lead]' },
  { title: 'Adapt dashboards for food-processing workflow', owner: 'Priya Shah' },
] as const;

function syncFor(
  row: number,
  s: number,
): { text: string; tone: 'neutral' | 'info' | 'success' | 'danger'; glyph: string } {
  const notSent = { text: 'Not sent', tone: 'neutral' as const, glyph: '○' };
  const sending = { text: 'Sending…', tone: 'info' as const, glyph: '◌' };
  if (row === 0)
    return s < 1.5
      ? notSent
      : s < 3.5
        ? sending
        : { text: 'Confirmed · PIL-11', tone: 'success', glyph: '✓' };
  if (row === 1)
    return s < 1.5
      ? notSent
      : s < 3.5
        ? sending
        : s < 5.5
          ? { text: 'Failed · Retry', tone: 'danger', glyph: '✕' }
          : s < 6.5
            ? sending
            : { text: 'Confirmed · PIL-17', tone: 'success', glyph: '✓' };
  return s < 1.5 ? notSent : s < 4 ? sending : { text: 'Confirmed · PIL-13', tone: 'success', glyph: '✓' };
}

function Pilot({ s }: { s: number }) {
  const note = at(s, 7.6);
  return (
    <g>
      <T x={80} y={100} size={13} color="var(--text-tertiary)">
        Pilot tasks · G2 · Snapshot v3 · Jira project PIL
      </T>
      {TASKS.map((task, i) => {
        const y = 120 + i * 64;
        const st = syncFor(i, s);
        return (
          <g key={task.title} style={{ opacity: at(s, 0.2 + i * 0.3) }}>
            <Box x={80} y={y} w={800} h={52} />
            <T x={100} y={y + 31} size={14.5} weight={500}>
              {task.title}
            </T>
            <T x={500} y={y + 31} size={13} color="var(--text-secondary)">
              {task.owner}
            </T>
            <Chip x={660} y={y + 13} text={st.text} tone={st.tone} glyph={st.glyph} width={200} />
          </g>
        );
      })}
      <g style={{ opacity: note }}>
        <Box x={80} y={330} w={800} h={130} fill="var(--bg-sunken)" stroke="none" />
        <Chip x={104} y={356} text="Task · Done" tone="success" glyph="✓" width={130} />
        <T x={250} y={375} size={22} color="var(--text-tertiary)">
          →
        </T>
        <Diamond cx={310} cy={369} state="not_started" size={16} />
        <T x={340} y={375} size={14} weight={600}>
          G3 Scale · Not started
        </T>
        <T x={104} y={430} size={14} color="var(--text-secondary)">
          Gates move only by an authorized person’s decision on a snapshot.
        </T>
      </g>
    </g>
  );
}

const ACTUALS = [
  {
    name: 'Paid use and continuation',
    actual: '3 of 4',
    threshold: 'Threshold (pre-registered) 4 of 4',
    k: 3 / 4,
    tk: 1,
    result: 'Not met',
  },
  {
    name: 'Deployment effort per site',
    actual: '22 hours per site',
    threshold: 'Within 16 hours per site',
    k: 22 / 26,
    tk: 16 / 26,
    result: 'Not met',
  },
  {
    name: 'Buyer fit',
    actual: 'Mixed',
    threshold: 'Qualitative · interview notes',
    k: 0,
    tk: 0,
    result: 'Inconclusive',
  },
] as const;

function Outcomes({ s }: { s: number }) {
  const decision = at(s, 3.8);
  const g3 = at(s, 7.6);
  return (
    <g>
      <T x={80} y={96} size={13} color="var(--text-tertiary)">
        Actual · 1 Dec 2026 – 28 Feb 2027 · against thresholds set before the pilot
      </T>
      {ACTUALS.map((a, i) => {
        const y = 112 + i * 62;
        const grow = at(s, 0.4 + i * 0.6, 0.9);
        return (
          <g key={a.name} style={{ opacity: at(s, 0.2 + i * 0.6) }}>
            <T x={80} y={y + 20} size={14} weight={600}>
              {a.name}
            </T>
            <T x={80} y={y + 40} size={12} color="var(--text-tertiary)">
              {a.threshold}
            </T>
            {a.k > 0 ? (
              <>
                <rect
                  x={340}
                  y={y + 8}
                  width={300 * a.k * grow}
                  height={22}
                  rx={2}
                  style={{ fill: 'var(--chart-actual)' }}
                />
                <line
                  x1={340 + 300 * a.tk}
                  y1={y + 2}
                  x2={340 + 300 * a.tk}
                  y2={y + 36}
                  style={{ stroke: 'var(--chart-threshold)', strokeWidth: 2, strokeDasharray: '4 2' }}
                />
              </>
            ) : (
              <rect
                x={340}
                y={y + 8}
                width={300}
                height={22}
                rx={2}
                style={{ fill: 'none', stroke: 'var(--border-control)', strokeDasharray: '4 3' }}
              />
            )}
            <T x={652} y={y + 25} size={13} font={MONO}>
              {a.actual}
            </T>
            <Chip
              x={790}
              y={y + 6}
              text={a.result}
              tone="neutral"
              glyph={a.result === 'Not met' ? '◎–' : '◎?'}
              width={120}
            />
          </g>
        );
      })}
      <g transform={`translate(80 ${310 + (1 - decision) * 14})`} style={{ opacity: decision }}>
        <Box x={0} y={0} w={480} h={150} />
        <T x={20} y={32} size={12.5} color="var(--text-tertiary)">
          Decision · Elena Fischer · on Maya Rao’s recommendation
        </T>
        <T x={20} y={66} size={20} weight={600} font={SERIF}>
          Revise and extend validation
        </T>
        <T x={20} y={98} size={14} color="var(--text-secondary)">
          Extension €30k · 45 days — its own spend cap
        </T>
        <T x={20} y={126} size={12.5} color="var(--text-tertiary)">
          Not scale. Test deployment effort and the fourth site first.
        </T>
      </g>
      <g style={{ opacity: g3 }}>
        <Box x={590} y={310} w={290} h={150} fill="var(--warning-bg)" stroke="none" />
        <Diamond cx={630} cy={360} state="blocked" />
        <T x={660} y={366} size={16} weight={600} color="var(--warning-fg)">
          G3 Scale · Blocked
        </T>
        <T x={612} y={408} size={13} color="var(--text-secondary)">
          4 preconditions open, including
        </T>
        <T x={612} y={428} size={13} color="var(--text-secondary)">
          “Demand threshold · 3 of 4 met”
        </T>
      </g>
    </g>
  );
}

function Role({ s, path, name, initials }: { s: number; path: GuidePath; name: string; initials: string }) {
  const end = ROLE_ENDINGS[path];
  const a = at(s, 0.2);
  return (
    <g style={{ opacity: a }}>
      <circle
        cx={190}
        cy={190}
        r={46}
        style={{ fill: 'var(--accent-bg)', stroke: 'var(--accent)', strokeWidth: 2 }}
      />
      <T x={190} y={199} size={24} weight={600} anchor="middle" color="var(--accent)">
        {initials}
      </T>
      <T x={260} y={176} size={13} color="var(--text-tertiary)">
        Your role
      </T>
      <T x={260} y={208} size={26} weight={600} font={SERIF}>
        {name} · {GUIDE_PATH_LABELS[path]}
      </T>
      {end.steps.map((step, i) => {
        const k = at(s, 1 + i * 0.7);
        return (
          <g
            key={step}
            style={{ opacity: k }}
            transform={`translate(${150 + i * 240} ${300 + (1 - k) * 10})`}
          >
            <Box x={0} y={0} w={220} h={86} />
            <circle cx={30} cy={43} r={15} style={{ fill: 'var(--bg-sunken)' }} />
            <T x={30} y={48} size={14} weight={600} anchor="middle">
              {String(i + 1)}
            </T>
            <T x={56} y={48} size={14.5} weight={500}>
              {step}
            </T>
          </g>
        );
      })}
    </g>
  );
}

export interface SceneProps {
  index: number;
  /** Seconds from the chapter start. */
  s: number;
  path: GuidePath;
  name: string;
  initials: string;
}

/** One chapter frame, including the common header (chapter title, illustrative-data tag). */
export function Scene({ index, s, path, name, initials }: SceneProps) {
  const ch = CHAPTERS[index]!;
  const body =
    index === 0 ? (
      <Problem s={s} />
    ) : index === 1 ? (
      <CaseScene s={s} />
    ) : index === 2 ? (
      <Kinds s={s} />
    ) : index === 3 ? (
      <Ladder s={s} />
    ) : index === 4 ? (
      <Gates s={s} />
    ) : index === 5 ? (
      <Pilot s={s} />
    ) : index === 6 ? (
      <Outcomes s={s} />
    ) : (
      <Role s={s} path={path} name={name} initials={initials} />
    );
  return (
    <g>
      <rect x={0} y={0} width={STAGE_W} height={STAGE_H} style={{ fill: 'var(--bg-canvas)' }} />
      <T x={40} y={52} size={24} weight={600} font={SERIF}>
        {ch.title}
      </T>
      <T x={40} y={74} size={12.5} color="var(--text-tertiary)" font={MONO}>
        {`${index + 1} / ${CHAPTERS.length}`}
      </T>
      <rect x={692} y={30} width={238} height={26} rx={13} style={{ fill: 'var(--neutral-bg)' }} />
      <T x={811} y={48} size={12.5} anchor="middle" color="var(--neutral-fg)">
        Illustrative data · Aster (fictional)
      </T>
      {body}
    </g>
  );
}

/** The whole stage at a chapter + local time, as an accessible image whose text is the caption. */
export function Stage(props: SceneProps & { label: string }) {
  return (
    <svg
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      role="img"
      aria-label={props.label}
      className="onb-stage"
      preserveAspectRatio="xMidYMid meet"
    >
      <Scene {...props} />
    </svg>
  );
}
