/**
 * S14 Administration (prototype Admin.dc.html): delegated authority with €[limit] placeholders and
 * the authority gap, roles, gate policies, source entitlements, connections (Connected / Expired /
 * Missing permission / Unavailable) with test and reconnect, run budget, and Diagnostics — the only
 * place that uses infrastructure terms. Administrators configure; they never approve gates.
 *
 * Route: /admin/:section (health, authority, roles, policies, entitlements, connections, budget,
 * diagnostics); `run` opens a run trace in Diagnostics.
 */
import {
  API,
  GATE_LABELS,
  GatePolicyBody,
  ROLE_LABELS,
  RunBudgetPolicyBody,
  type AuthorityGrant,
  type Connection,
  type EntitlementAccess,
  type GateCode,
  type RoleCode,
} from '@growth-os/contracts';
import {
  Banner,
  Button,
  ConnectorStatusTag,
  DataTable,
  GateChip,
  GateDiamond,
  Icon,
  Mono,
  Person,
  SectionHeader,
  Skeleton,
  formatBudget,
} from '@growth-os/ui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';
import { useViewer } from '../../lib/session';
import { fmtDateTime, fmtTime } from '../history/dates';
import '../history/ws8d.css';

const SECTIONS = [
  { id: 'authority', label: 'Roles and authority' },
  { id: 'policies', label: 'Gate policies' },
  { id: 'entitlements', label: 'Source entitlements' },
  { id: 'connections', label: 'Connections' },
  { id: 'budget', label: 'Run budget' },
  { id: 'diagnostics', label: 'Diagnostics' },
] as const;

/** Business description of what each role edits and reviews (documentation copy, not authority). */
const ROLE_SCOPE: Record<RoleCode, { edit: string; review: string }> = {
  sponsor: { edit: '—', review: 'All' },
  case_owner: { edit: 'Cases, sizing, economics', review: '—' },
  pilot_owner: { edit: 'Pilot tasks, actuals', review: '—' },
  commercial_reviewer: { edit: '—', review: 'Commercial access' },
  product_reviewer: { edit: 'Feasibility notes', review: 'Product fit' },
  finance_reviewer: { edit: 'Economics drafts', review: 'Economics' },
  specialist_reviewer: { edit: '—', review: 'Legal and regulatory' },
  investment_committee: { edit: '—', review: 'Scale requests' },
  read_only_reviewer: { edit: '—', review: 'Read only' },
  tenant_admin: { edit: 'Settings', review: '—' },
};

const PRECONDITION_LABELS: Record<string, string> = {
  sponsor_set: 'Sponsor named',
  objective_set: 'Objective',
  constraints_set: 'Constraints',
  owner_set: 'Accountable owner',
  currency_and_horizon_set: 'Currency and horizon',
  evidence_inventory: 'Evidence inventory',
  comparable_sizing: 'Comparable sizing',
  material_unknowns_listed: 'Material unknowns',
  feasibility_blockers_listed: 'Feasibility blockers listed',
  validation_results: 'Validation results',
  finance_review: 'Finance review',
  specialist_sign_off: 'Specialist sign-off',
  budget_and_stop_rules: 'Budget and stop rules',
  accountable_pilot_owner: 'Accountable pilot owner',
  pilot_actuals_vs_thresholds: 'Pilot actuals vs thresholds',
  readiness_reassessment: 'Readiness reassessment',
  updated_economics_and_capacity: 'Updated economics and capacity',
  approved_scale_budget: 'Approved scale budget',
  parent_gate_reviewed: 'Parent gate reviewed',
  extension_cap_set: 'Extension cap set',
  accountable_owner: 'Accountable owner',
};

const OTHERS_SEE: Record<EntitlementAccess, string> = {
  excerpt: 'Excerpts',
  aggregate_only: 'Aggregates only',
  none: 'Nothing · no excerpt or summary',
};

const GATE_ORDER: GateCode[] = ['G0', 'G1', 'G2', 'G3', 'X'];

export default function AdminScreen() {
  const viewer = useViewer();
  const isAdmin = !!viewer.data?.isAdmin;
  if (viewer.isPending)
    return (
      <div className="ws8d-page" aria-busy="true">
        <Skeleton height={200} />
      </div>
    );
  return (
    <div className="ws8d-page" style={{ maxWidth: 1240, gap: 0 }}>
      <h1 style={{ margin: 0, fontSize: 22, lineHeight: '30px', fontWeight: 600 }}>Administration</h1>
      <p className="ws8d-note" style={{ margin: '2px 0 14px' }}>
        {viewer.data?.tenant.name ?? 'Workspace'} · Growth OS workspace · Market Expansion
      </p>
      {isAdmin ? (
        <AdminBody illustrative={!!viewer.data?.tenant.illustrative} />
      ) : (
        <Banner
          tone="lock"
          live={false}
          title="Administration is available to tenant administrators only."
          body="Ask your tenant administrator to change roles, policies or connections."
        />
      )}
    </div>
  );
}

function useNames() {
  // The frozen admin contracts return user ids only (change request in the WS8d notes). Names come
  // from the dev persona list when the workspace runs with dev login; otherwise ids are shown.
  const personas = useApiQuery(API.auth.listDevPersonas, {}, { retry: false, staleTime: Infinity });
  const overview = useApiQuery(API.overview.portfolio, { query: {} }, { retry: false });
  return useMemo(() => {
    const people = new Map((personas.data?.personas ?? []).map((p) => [p.userId, p.person]));
    const bus = new Map((overview.data?.businessUnits ?? []).map((b) => [b.id, b.name]));
    return {
      person: (id: string, subtitle?: string): ReactNode => {
        const p = people.get(id);
        return p ? (
          <Person name={p.displayName} initials={p.initials} subtitle={subtitle} />
        ) : (
          <span>
            <Mono size={12}>{id.slice(0, 8)}</Mono>
            {subtitle ? <span className="ws8d-sub"> · {subtitle}</span> : null}
          </span>
        );
      },
      bu: (id: string | null) => (id === null ? 'All business units' : (bus.get(id) ?? id.slice(0, 8))),
    };
  }, [personas.data, overview.data]);
}

function AdminBody({ illustrative }: { illustrative: boolean }) {
  const { section = 'health' } = useParams();
  useEffect(() => {
    const el = document.getElementById(`admin-${section}`);
    if (el && section !== 'health') el.scrollIntoView?.({ block: 'start' });
  }, [section]);
  return (
    <>
      <Banner
        tone="lock"
        live={false}
        title="Administrators cannot approve gates."
        body="You configure approvers, policies and connections. Configuring tools never grants business approval authority, and policy cannot be bypassed from here."
      />
      <nav aria-label="Administration sections" className="ws8d-anchor-nav" style={{ margin: '16px 0 4px' }}>
        {SECTIONS.map((s) => (
          <Link key={s.id} to={`/admin/${s.id}`} aria-current={section === s.id ? 'true' : undefined}>
            {s.label}
          </Link>
        ))}
      </nav>
      <AuthoritySection illustrative={illustrative} />
      <RolesSection illustrative={illustrative} />
      <PoliciesSection />
      <EntitlementsSection />
      <ConnectionsSection />
      <RunBudgetSection />
      <DiagnosticsSection />
    </>
  );
}

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section id={`admin-${id}`} className="ws8d-admin-section" aria-labelledby={`admin-${id}-h`}>
      <SectionHeader id={`admin-${id}-h`} title={title} subtitle={subtitle} />
      {children}
    </section>
  );
}

function Loading({ q, children }: { q: { isPending: boolean; error: unknown }; children: () => ReactNode }) {
  if (q.isPending) return <Skeleton height={120} />;
  if (q.error) return <ProblemBanner error={q.error} />;
  return <>{children()}</>;
}

function ceilingText(g: Pick<AuthorityGrant, 'ceilingAmount' | 'currency'>, illustrative: boolean) {
  if (g.ceilingAmount === null) return 'No spend';
  // Aster ceilings are policy placeholders: never display them as company policy.
  return illustrative || !g.currency
    ? 'up to €[limit]'
    : `up to ${formatBudget(g.ceilingAmount, g.currency)}`;
}

function AuthoritySection({ illustrative }: { illustrative: boolean }) {
  const q = useApiQuery(API.admin.authority);
  const names = useNames();
  return (
    <Section
      id="authority"
      title="Delegated authority"
      subtitle="Gate × business unit × ceiling. Ceilings are policy placeholders; the PRD sets none."
    >
      <Loading q={q}>
        {() => {
          const data = q.data!;
          type Row = {
            key: string;
            gate: GateCode;
            bu: string | null;
            grant: AuthorityGrant | null;
            gap: string | null;
          };
          const rows: Row[] = [];
          for (const gate of GATE_ORDER) {
            for (const g of data.items.filter((x) => x.gateCode === gate && !x.revokedAt))
              rows.push({ key: g.id, gate, bu: g.businessUnitId, grant: g, gap: null });
            for (const gap of data.gaps.filter((x) => x.gateCode === gate))
              rows.push({
                key: `gap-${gate}-${gap.businessUnitId}`,
                gate,
                bu: gap.businessUnitId,
                grant: null,
                gap: gap.message,
              });
          }
          return (
            <>
              {data.gaps.map((g) => (
                <Banner
                  key={`${g.gateCode}-${g.businessUnitId}`}
                  tone="warn"
                  live={false}
                  title={`Authority gap · ${GATE_LABELS[g.gateCode]}`}
                  body={g.message}
                />
              ))}
              <div className="gos-card" style={{ overflow: 'hidden' }}>
                <DataTable<Row>
                  ariaLabel="Delegated authority"
                  rowKey={(r) => r.key}
                  rows={rows}
                  minWidth={820}
                  columns={[
                    {
                      key: 'gate',
                      header: 'Gate',
                      cell: (r) => (
                        <GateChip status={r.gap ? 'blocked' : 'approved'} text={GATE_LABELS[r.gate]} />
                      ),
                    },
                    { key: 'bu', header: 'Business unit', cell: (r) => names.bu(r.bu) },
                    {
                      key: 'approver',
                      header: 'Approver',
                      cell: (r) =>
                        r.grant ? (
                          names.person(r.grant.userId)
                        ) : (
                          <span className="ws8d-row" style={{ gap: 6 }}>
                            <span style={{ color: 'var(--warning-fg)', display: 'inline-flex' }}>
                              <Icon name="alert" size={14} />
                            </span>
                            No approver above €[limit]
                          </span>
                        ),
                    },
                    {
                      key: 'ceiling',
                      header: 'Ceiling',
                      cell: (r) => (
                        <Mono size={12.5} strong>
                          {r.grant ? ceilingText(r.grant, illustrative) : 'above €[limit]'}
                        </Mono>
                      ),
                    },
                    {
                      key: 'notes',
                      header: 'Notes',
                      cell: (r) =>
                        r.gap ??
                        (r.gate === 'G0'
                          ? 'Sponsor approves scope'
                          : r.gate === 'G2'
                            ? 'Finance and specialist sign-offs required'
                            : 'Case owner cannot self-approve'),
                    },
                  ]}
                />
              </div>
            </>
          );
        }}
      </Loading>
    </Section>
  );
}

function RolesSection({ illustrative }: { illustrative: boolean }) {
  const roles = useApiQuery(API.admin.roles);
  const authority = useApiQuery(API.admin.authority);
  const names = useNames();
  return (
    <Section
      id="roles"
      title="Roles"
      subtitle="Hidden navigation for non-admins; nothing is disabled without a reason"
    >
      <Loading q={roles}>
        {() => {
          const items = roles.data!.items.filter((r) => !r.revokedAt);
          const canApprove = (userId: string, role: RoleCode): string => {
            if (role === 'tenant_admin') return 'No — configures only';
            const grants = (authority.data?.items ?? []).filter((g) => g.userId === userId && !g.revokedAt);
            if (!grants.length) return role === 'case_owner' ? 'No · cannot self-approve' : 'No';
            const gatesText = grants.map((g) => g.gateCode).join(', ');
            const ceiling = grants.find((g) => g.ceilingAmount !== null);
            return `${gatesText}${ceiling ? ` within ${ceilingText(ceiling, illustrative).replace(/^up to /, '')}` : ''}`;
          };
          return (
            <div className="gos-card" style={{ overflow: 'hidden' }}>
              <DataTable
                ariaLabel="Roles"
                rowKey={(r) => r.id}
                rows={items}
                minWidth={820}
                columns={[
                  { key: 'person', header: 'Person', cell: (r) => names.person(r.userId) },
                  { key: 'role', header: 'Role', cell: (r) => ROLE_LABELS[r.role] },
                  { key: 'edit', header: 'Can edit', cell: (r) => ROLE_SCOPE[r.role].edit },
                  { key: 'review', header: 'Can review', cell: (r) => ROLE_SCOPE[r.role].review },
                  {
                    key: 'approve',
                    header: 'Can approve gates',
                    cell: (r) => {
                      const t = canApprove(r.userId, r.role);
                      return (
                        <span
                          style={{
                            color: t.startsWith('No') ? 'var(--text-secondary)' : 'var(--text-primary)',
                            fontWeight: t.startsWith('No') ? 400 : 500,
                          }}
                        >
                          {t}
                        </span>
                      );
                    },
                  },
                ]}
              />
            </div>
          );
        }}
      </Loading>
    </Section>
  );
}

function PoliciesSection() {
  const q = useApiQuery(API.admin.policies);
  return (
    <Section
      id="policies"
      title="Gate policies"
      subtitle="Preconditions per gate. Completing tasks never passes a gate."
    >
      <Loading q={q}>
        {() => {
          const items = q.data!.items.filter((p) => p.status === 'active');
          const gatesP = items
            .filter((p) => p.kind === 'gate')
            .map((p) => GatePolicyBody.safeParse(p.body))
            .flatMap((r) => (r.success ? [r.data] : []))
            .filter((g) => g.gateCode !== 'X');
          const expiry = items.find((p) => p.kind === 'approval_expiry')?.body as
            { days?: number } | undefined;
          const retention = items.find((p) => p.kind === 'retention')?.body as { note?: string } | undefined;
          return (
            <>
              <div
                className="ws8d-grid"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12 }}
              >
                {gatesP.map((g) => (
                  <div key={g.gateCode} className="ws8d-section" style={{ padding: '12px 14px', gap: 8 }}>
                    <h3 className="ws8d-row" style={{ gap: 8, fontSize: 13.5 }}>
                      <GateDiamond status="not_started" size={15} />
                      {GATE_LABELS[g.gateCode]}
                    </h3>
                    <ul className="ws8d-list" style={{ color: 'var(--text-secondary)' }}>
                      {g.preconditionKeys.map((k) => (
                        <li key={k}>{PRECONDITION_LABELS[k] ?? k}</li>
                      ))}
                    </ul>
                    {g.requiredSignOffAreas.length ? (
                      <p className="ws8d-muted">Sign-offs required: {g.requiredSignOffAreas.join(', ')}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="ws8d-section" style={{ padding: '12px 14px', gap: 4, fontSize: 13 }}>
                <div>
                  <b style={{ fontWeight: 600 }}>Materiality rule</b> · Changes to geography, product, spend
                  ceiling or a decision-critical assumption invalidate affected approvals and return the case
                  for review. Uncertain cases escalate.
                </div>
                <div>
                  <b style={{ fontWeight: 600 }}>Approval expiry</b> · {expiry?.days ?? 14} days if unused ·{' '}
                  <b style={{ fontWeight: 600 }}>Self-approval</b> · not allowed ·{' '}
                  <b style={{ fontWeight: 600 }}>Retention</b> ·{' '}
                  {retention?.note
                    ? retention.note.replace(/^Approval history kept for /i, 'approval history kept for ')
                    : 'approval history kept'}
                </div>
              </div>
            </>
          );
        }}
      </Loading>
    </Section>
  );
}

function EntitlementsSection() {
  const q = useApiQuery(API.admin.entitlements);
  return (
    <Section
      id="entitlements"
      title="Source entitlements"
      subtitle="Restricted sources never reach excerpts, search results or generated summaries"
    >
      <Loading q={q}>
        {() => (
          <div className="gos-card" style={{ overflow: 'hidden' }}>
            <DataTable
              ariaLabel="Source entitlements"
              rowKey={(r) => r.licenseId}
              rows={q.data!.items}
              minWidth={720}
              columns={[
                { key: 'src', header: 'Source', cell: (r) => r.sourceLabel },
                { key: 'lic', header: 'Licence', cell: (r) => r.licenseText },
                { key: 'who', header: 'Who sees excerpts', cell: (r) => r.excerptVisibleTo.join(', ') },
                { key: 'others', header: 'Others see', cell: (r) => OTHERS_SEE[r.othersSee] },
              ]}
            />
          </div>
        )}
      </Loading>
    </Section>
  );
}

function ConnectionsSection() {
  const q = useApiQuery(API.admin.connections);
  const test = useCommand(API.admin.testConnection);
  const reconnect = useCommand(API.admin.reconnect);
  const [tested, setTested] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const act = async (c: Connection) => {
    setErr(null);
    try {
      if (c.status === 'expired') {
        await reconnect.mutateAsync({ params: { id: c.id } });
        setNote(`${c.name} reconnected. Paused sync resumes only after a re-check.`);
      } else {
        const r = await test.mutateAsync({ params: { id: c.id } });
        setTested((t) => ({ ...t, [c.id]: r.status === 'connected' }));
        setNote(`${c.name}: ${r.status === 'connected' ? 'test passed' : 'still not available'}.`);
      }
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <Section id="connections" title="Connections" subtitle="Status, scope, last success and a test action">
      <Loading q={q}>
        {() => (
          <div className="gos-card" style={{ overflow: 'hidden' }}>
            <DataTable<Connection>
              ariaLabel="Connections"
              rowKey={(c) => c.id}
              rows={q.data!.items}
              minWidth={860}
              columns={[
                {
                  key: 'name',
                  header: 'Connection',
                  cell: (c) => (
                    <div>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <div className="ws8d-sub">{c.scopeText}</div>
                    </div>
                  ),
                },
                { key: 'status', header: 'Status', cell: (c) => <ConnectorStatusTag status={c.status} /> },
                {
                  key: 'last',
                  header: 'Last success',
                  cell: (c) => (
                    <span className="ws8d-note">
                      {c.lastSuccessAt ? fmtDateTime(c.lastSuccessAt) : 'Never'}
                    </span>
                  ),
                },
                {
                  key: 'used',
                  header: 'Used for',
                  cell: (c) => <span className="ws8d-note">{c.usedFor}</span>,
                },
                {
                  key: 'action',
                  header: 'Action',
                  cell: (c) =>
                    c.status === 'missing_permission' ? (
                      <Button
                        variant="secondary"
                        disabled
                        disabledReason="The tool owner grants this permission outside Growth OS."
                      >
                        Request permission
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => act(c)}
                        ariaLabel={`${c.status === 'expired' ? 'Reconnect' : c.status === 'unavailable' ? 'Retry' : 'Test'} ${c.name}`}
                      >
                        {c.status === 'expired'
                          ? 'Reconnect'
                          : c.status === 'unavailable'
                            ? 'Retry'
                            : tested[c.id]
                              ? 'Tested · OK'
                              : 'Test'}
                      </Button>
                    ),
                },
              ]}
            />
          </div>
        )}
      </Loading>
      {err ? <ProblemBanner error={err} /> : null}
      <p role="status" className="ws8d-note" style={{ margin: 0 }}>
        {note ?? ''}
      </p>
    </Section>
  );
}

function RunBudgetSection() {
  const q = useApiQuery(API.admin.policies);
  const body = useMemo(() => {
    const p = q.data?.items.find((x) => x.kind === 'run_budget' && x.status === 'active');
    const r = p ? RunBudgetPolicyBody.safeParse(p.body) : null;
    return r?.success ? r.data : null;
  }, [q.data]);
  const minutes = body ? Math.round(body.perRunWallTimeMs / 60_000) : null;
  return (
    <Section id="budget" title="Run budget" subtitle="Business limits for the analysis assistant">
      <div
        className="ws8d-grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12 }}
      >
        <div className="ws8d-section" style={{ padding: '12px 14px', gap: 4 }}>
          <div className="ws8d-sub">Analysis budget per case</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>[budget] per month</div>
          <div className="ws8d-note">Used this month · [used]</div>
        </div>
        <div className="ws8d-section" style={{ padding: '12px 14px', gap: 4 }}>
          <div className="ws8d-sub">When the budget is reached</div>
          <div style={{ fontSize: 13.5 }}>
            Analysis shows “Stopped — your work is saved”. Calculations and approvals keep working.
            {minutes ? ` Each analysis stops after ${minutes} minutes.` : ''}
          </div>
        </div>
        <div className="ws8d-section" style={{ padding: '12px 14px', gap: 4 }}>
          <div className="ws8d-sub">Allowed actions for analysis</div>
          <div style={{ fontSize: 13.5 }}>
            Read permitted sources · propose drafts · run deterministic sizing and economics. Never approve,
            send or spend.
          </div>
        </div>
      </div>
    </Section>
  );
}

function DiagnosticsSection() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const runId = search.get('run');
  const [ref, setRef] = useState(runId ?? '');
  const policies = useApiQuery(API.admin.policies);
  const trace = useApiQuery(
    API.admin.runDiagnostics,
    { params: { id: runId ?? '' } },
    { enabled: !!runId, retry: false },
  );
  const budget = useMemo(() => {
    const p = policies.data?.items.find((x) => x.kind === 'run_budget' && x.status === 'active');
    const r = p ? RunBudgetPolicyBody.safeParse(p.body) : null;
    return r?.success ? r.data : null;
  }, [policies.data]);
  const yesNo = (v: boolean | null, label: string) => (v === null ? null : `${label} ${v ? '✓' : '✕'}`);
  return (
    <Section id="diagnostics" title="Diagnostics">
      <details className="ws8d-diag" open>
        <summary>
          <Icon name="terminal" size={15} />
          Diagnostics · technical details for administrators
        </summary>
        <div className="ws8d-diag__body">
          <p className="ws8d-note" style={{ margin: 0 }}>
            This is the only place that uses infrastructure terms. Traces show structured outputs and tool
            events, not hidden reasoning.
          </p>
          <dl className="ws8d-meta ws8d-mono-dl" style={{ gridTemplateColumns: 'minmax(160px, 220px) 1fr' }}>
            <dt>Agent run budget</dt>
            <dd>
              {budget
                ? `${Math.round(budget.perRunWallTimeMs / 1000)} s wall time · ${budget.perRunMaxToolCalls} tool calls · ${budget.perRunMaxInputTokens.toLocaleString('en-GB')} input / ${budget.perRunMaxOutputTokens.toLocaleString('en-GB')} output tokens`
                : '—'}
            </dd>
            <dt>Concurrent agent runs</dt>
            <dd>{budget ? budget.tenantConcurrentRuns : '—'}</dd>
            <dt>Harness version</dt>
            <dd>[harness version]</dd>
            <dt>MCP servers</dt>
            <dd>work-connector (Jira) · intelligence gateway</dd>
          </dl>
          <form
            className="ws8d-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (ref.trim()) navigate(`/admin/diagnostics?run=${encodeURIComponent(ref.trim())}`);
            }}
          >
            <label
              className="ws8d-note"
              style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
            >
              Run id
              <input
                className="ws8d-input"
                style={{ marginTop: 0, width: 320, fontFamily: 'var(--font-mono)' }}
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
            </label>
            <Button variant="secondary" type="submit" icon="search">
              Open trace
            </Button>
          </form>
          {!runId ? (
            <p className="ws8d-muted">Open a run from its id to see its steps and tool events.</p>
          ) : trace.isPending ? (
            <Skeleton height={120} />
          ) : trace.error || !trace.data ? (
            <ProblemBanner error={trace.error} />
          ) : (
            <>
              <dl
                className="ws8d-meta ws8d-mono-dl"
                style={{ gridTemplateColumns: 'minmax(160px, 220px) 1fr' }}
              >
                <dt>Run</dt>
                <dd>
                  {trace.data.run.correlationId} · {trace.data.run.statusLabel} ·{' '}
                  {fmtDateTime(trace.data.run.finishedAt ?? trace.data.run.createdAt)}
                </dd>
                <dt>Skill</dt>
                <dd>
                  {trace.data.run.skill} v{trace.data.run.skillVersion}
                </dd>
                <dt>Provider</dt>
                <dd>
                  {trace.data.run.provider}
                  {trace.data.run.modelConfig
                    ? ` · ${trace.data.run.modelConfig}`
                    : ' · model config not recorded'}
                </dd>
                <dt>Usage</dt>
                <dd>
                  {Math.round(trace.data.run.usage.elapsedMs / 1000)} s · {trace.data.run.usage.toolCalls}{' '}
                  tool calls · {trace.data.run.usage.inputTokens.toLocaleString('en-GB')} input /{' '}
                  {trace.data.run.usage.outputTokens.toLocaleString('en-GB')} output tokens
                </dd>
                <dt>Input snapshot</dt>
                <dd>{trace.data.run.inputSnapshotHash.slice(0, 12)}…</dd>
              </dl>
              <ol className="ws8d-list" aria-label="Run steps">
                {trace.data.steps.map((s) => (
                  <li key={s.id}>
                    <Mono size={12}>{s.kind}</Mono> · {s.summary}
                  </li>
                ))}
              </ol>
              <DataTable
                ariaLabel="Tool events"
                rowKey={(t) => t.id}
                rows={trace.data.toolCalls}
                minWidth={620}
                columns={[
                  { key: 't', header: 'Time', cell: (t) => <Mono size={12}>{fmtTime(t.createdAt)}</Mono> },
                  {
                    key: 'tool',
                    header: 'Tool call',
                    cell: (t) => (
                      <Mono size={12}>
                        {t.tool} v{t.toolVersion}
                        {typeof t.argsRedacted.source === 'string' ? ` ${t.argsRedacted.source}` : ''}
                      </Mono>
                    ),
                  },
                  {
                    key: 'scope',
                    header: 'Scope check',
                    cell: (t) => (
                      <Mono size={12}>
                        {[
                          yesNo(t.scopeCheck.tenant, 'tenant'),
                          yesNo(t.scopeCheck.entitlement, 'entitlement'),
                          yesNo(t.scopeCheck.schema, 'schema'),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Mono>
                    ),
                  },
                  { key: 'r', header: 'Result', cell: (t) => <Mono size={12}>{t.resultSummary}</Mono> },
                ]}
              />
            </>
          )}
        </div>
      </details>
    </Section>
  );
}
