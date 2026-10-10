/**
 * S14 › Connections › Jira row › "Task mapping" (D-114 §1, D-134). One tab per purpose (Validation
 * tasks, Pilot tasks): destination project, issue type and an assignee table (person · role · Jira
 * account · Mapped / Unmapped / Not found). "Check with Jira" is a dry lookup that writes nothing.
 * Changing the project or issue type of a mapping used by an approved, unsent task set is material:
 * a dialog lists the impact ("Approval G2 · Snapshot v3 needs re-approval", "6 unsent tasks pause")
 * before Save sends the acknowledgement. Assignee edits are not material. Administrators configure;
 * nothing here approves anything.
 */
import {
  API,
  type Connection,
  type ConnectorMapping,
  type ConnectorMappingCheck,
} from '@growth-os/contracts';
import {
  AssigneeMappingTag,
  Banner,
  Button,
  ConnectorStatusTag,
  DataTable,
  SectionHeader,
  Skeleton,
} from '@growth-os/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { Modal } from '../../app/shell/Modal';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { api } from '../../lib/api-client';
import { useApiQuery, useCommand } from '../../lib/query';

type Purpose = ConnectorMapping['purpose'];
const PURPOSES: { key: Purpose; label: string }[] = [
  { key: 'validation_tasks', label: 'Validation tasks' },
  { key: 'pilot_tasks', label: 'Pilot tasks' },
];

type Body = Omit<ConnectorMapping, 'id'>;
type Row = ConnectorMappingCheck['assignees'][number];

const bodyOf = (
  m: ConnectorMapping,
  accounts: Record<string, string>,
  project: string,
  issueType: string,
): Body => ({
  connectionId: m.connectionId,
  purpose: m.purpose,
  destinationProject: project.trim(),
  issueType: issueType.trim(),
  // An empty account means "not mapped": it is left out of the map, never stored as "".
  assigneeMap: Object.fromEntries(
    Object.entries(accounts)
      .map(([k, v]) => [k, v.trim()] as const)
      .filter(([, v]) => v !== ''),
  ),
});

function MappingEditor({ mapping, connection }: { mapping: ConnectorMapping; connection: Connection }) {
  const ids = useId();
  const [project, setProject] = useState(mapping.destinationProject);
  const [issueType, setIssueType] = useState(mapping.issueType);
  const [accounts, setAccounts] = useState<Record<string, string>>({ ...mapping.assigneeMap });
  const [check, setCheck] = useState<ConnectorMappingCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<unknown>(null);
  const [impact, setImpact] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const save = useCommand(API.admin.setMapping, {
    onSuccess: (m) => {
      setImpact(null);
      setNote(`Saved: ${m.destinationProject} · ${m.issueType}.`);
      void runCheck(m);
    },
  });
  const latest = useRef(0);

  const runCheck = async (m: Body) => {
    const n = ++latest.current;
    setChecking(true);
    setCheckError(null);
    try {
      const r = await api(API.admin.checkMapping, { params: { id: mapping.id }, body: m });
      if (n === latest.current) setCheck(r);
    } catch (e) {
      if (n === latest.current) setCheckError(e);
    } finally {
      if (n === latest.current) setChecking(false);
    }
  };

  useEffect(() => {
    // The table lists the people this mapping serves: read them with a dry lookup on open.
    void runCheck(bodyOf(mapping, mapping.assigneeMap, mapping.destinationProject, mapping.issueType));
  }, [mapping.id]);

  const body = bodyOf(mapping, accounts, project, issueType);
  const destinationChanged =
    body.destinationProject !== mapping.destinationProject || body.issueType !== mapping.issueType;
  const invalid = !body.destinationProject || !body.issueType;

  const onSave = async () => {
    setNote(null);
    if (destinationChanged) {
      // Show the impact before saving: a dry run against the current approvals.
      try {
        const r = await api(API.admin.checkMapping, { params: { id: mapping.id }, body });
        setCheck(r);
        if (r.impact) {
          setImpact(r.impact.lines);
          return;
        }
      } catch (e) {
        setCheckError(e);
        return;
      }
    }
    save.mutate({ params: { id: mapping.id }, body });
  };

  const rows: Row[] = check?.assignees ?? [];
  return (
    <div
      className="ws8c-stack"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0' }}
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="gos-field" htmlFor={`${ids}-project`}>
          <span>Destination project</span>
          <input
            id={`${ids}-project`}
            className="gos-input"
            value={project}
            aria-invalid={!body.destinationProject ? true : undefined}
            onChange={(e) => setProject(e.target.value)}
          />
        </label>
        <label className="gos-field" htmlFor={`${ids}-type`}>
          <span>Issue type</span>
          <input
            id={`${ids}-type`}
            className="gos-input"
            value={issueType}
            aria-invalid={!body.issueType ? true : undefined}
            onChange={(e) => setIssueType(e.target.value)}
          />
        </label>
        {check ? (
          <span className="ws8d-note" role="status">
            {check.project.found
              ? `Project ${check.project.key}${check.project.name ? ` · ${check.project.name}` : ''} found`
              : `Project ${check.project.key} not checked`}
            {' · '}
            {check.issueType.found
              ? `Issue type ${check.issueType.name} found`
              : `Issue type ${check.issueType.name} not checked`}
          </span>
        ) : null}
      </div>
      {destinationChanged ? (
        <Banner
          tone="warn"
          live={false}
          title="Changing the destination of approved, unsent tasks is a material change."
          body="Save shows the impact first. Assignee changes are not material."
        />
      ) : null}
      {checking && !check ? (
        <Skeleton height={120} />
      ) : (
        <div className="gos-card" style={{ overflow: 'hidden' }}>
          <DataTable<Row>
            ariaLabel={`Assignees · ${PURPOSES.find((p) => p.key === mapping.purpose)!.label}`}
            rowKey={(r) => r.userId}
            rows={rows}
            minWidth={720}
            rowHeader="person"
            columns={[
              {
                key: 'person',
                header: 'Person',
                cell: (r) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{r.person.displayName}</div>
                    <div className="ws8d-sub">{r.roleText}</div>
                  </div>
                ),
              },
              {
                key: 'account',
                header: 'Jira account',
                cell: (r) => (
                  <input
                    className="gos-input"
                    aria-label={`Jira account for ${r.person.displayName}`}
                    value={accounts[r.userId] ?? ''}
                    placeholder="Not mapped"
                    onChange={(e) => setAccounts((a) => ({ ...a, [r.userId]: e.target.value }))}
                  />
                ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (r) => (
                  <div>
                    <AssigneeMappingTag status={r.status} />
                    {r.message ? <div className="ws8d-sub">{r.message}</div> : null}
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}
      {checkError ? <ProblemBanner error={checkError} /> : null}
      {save.error ? <ProblemBanner error={save.error} /> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          variant="secondary"
          icon="refresh"
          disabled={checking || invalid}
          disabledReason={invalid ? 'Enter a project and an issue type' : 'Checking…'}
          onClick={() => {
            setNote(null);
            void runCheck(body);
          }}
        >
          {`Check with ${connection.name.startsWith('Jira') ? 'Jira' : 'the task tool'}`}
        </Button>
        <Button
          variant="primary"
          disabled={save.isPending || invalid}
          disabledReason={invalid ? 'Enter a project and an issue type' : 'Saving…'}
          onClick={() => void onSave()}
        >
          Save mapping
        </Button>
        <span role="status" className="ws8d-note">
          {note ?? (check ? 'Checked just now · nothing was written in the task tool.' : '')}
        </span>
      </div>
      {impact ? (
        <Modal label="Material change" onClose={() => setImpact(null)}>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
            <SectionHeader
              title="Material change"
              subtitle={`Moving these tasks to ${body.destinationProject} · ${body.issueType} affects an approval.`}
            />
            <ul
              aria-label="Impact"
              style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              {impact.map((l) => (
                <li key={l} style={{ fontSize: 13 }}>
                  {l}
                </li>
              ))}
            </ul>
            <p className="ws8d-note" style={{ margin: 0 }}>
              The approver decides again on a refreshed snapshot. Tasks already created stay where they are.
            </p>
            {save.error ? <ProblemBanner error={save.error} /> : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant="primary"
                tone="dark"
                disabled={save.isPending}
                disabledReason="Saving…"
                onClick={() =>
                  save.mutate({
                    params: { id: mapping.id },
                    body: { ...body, acknowledgeMaterialImpact: true },
                  })
                }
              >
                Save and pause unsent tasks
              </Button>
              <Button variant="ghost" onClick={() => setImpact(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function ConnectionMappings({
  connection,
  mappings,
}: {
  connection: Connection;
  mappings: ConnectorMapping[];
}) {
  const ids = useId();
  const available = PURPOSES.filter((p) => mappings.some((m) => m.purpose === p.key));
  const [tab, setTab] = useState<Purpose>(available[0]?.key ?? 'validation_tasks');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const mapping = mappings.find((m) => m.purpose === tab);
  if (available.length === 0)
    return <p className="ws8d-note">No task mapping is set for this connection yet.</p>;
  const move = (i: number) => {
    const n = (i + available.length) % available.length;
    refs.current[n]?.focus();
    setTab(available[n]!.key);
  };
  return (
    <div>
      <div
        role="tablist"
        aria-label={`Task mapping · ${connection.name}`}
        style={{ display: 'flex', gap: 4 }}
      >
        {available.map((p, i) => (
          <button
            key={p.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${ids}-tab-${p.key}`}
            aria-selected={p.key === tab}
            aria-controls={`${ids}-panel`}
            tabIndex={p.key === tab ? 0 : -1}
            className={p.key === tab ? 'gos-btn gos-btn--secondary' : 'gos-btn gos-btn--ghost'}
            onClick={() => setTab(p.key)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') move(i + 1);
              else if (e.key === 'ArrowLeft') move(i - 1);
              else return;
              e.preventDefault();
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`}>
        {mapping ? <MappingEditor key={mapping.id} mapping={mapping} connection={connection} /> : null}
      </div>
    </div>
  );
}

/** The "Task mapping" section of S14: one row per task-tool connection, opening its editor. */
export function TaskMappingSection() {
  const q = useApiQuery(API.admin.connections);
  const [open, setOpen] = useState<string | null>(null);
  const tools = (q.data?.items ?? []).filter((c) => c.kind === 'task_tool');
  return (
    <section id="admin-task-mapping" className="ws8d-admin-section" aria-labelledby="admin-task-mapping-h">
      <SectionHeader
        id="admin-task-mapping-h"
        title="Task mapping"
        subtitle="Where approved tasks are created, and who they are assigned to"
      />
      {q.isPending ? (
        <Skeleton height={80} />
      ) : q.error ? (
        <ProblemBanner error={q.error} />
      ) : tools.length === 0 ? (
        <p className="ws8d-note">No task tool is connected.</p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {tools.map((c) => (
            <li key={c.id} className="gos-card" style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <b style={{ fontWeight: 600 }}>{c.name}</b>
                <ConnectorStatusTag status={c.status} />
                <span style={{ flex: 1 }} />
                <Button
                  variant="secondary"
                  icon="sliders"
                  ariaLabel={`${open === c.id ? 'Close task mapping' : 'Task mapping'} · ${c.name}`}
                  onClick={() => setOpen((o) => (o === c.id ? null : c.id))}
                >
                  {open === c.id ? 'Close task mapping' : 'Task mapping'}
                </Button>
              </div>
              {open === c.id ? (
                <ConnectionMappings
                  connection={c}
                  mappings={q.data!.mappings.filter((m) => m.connectionId === c.id)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
