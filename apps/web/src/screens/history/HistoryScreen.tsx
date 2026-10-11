/**
 * History tab (audit). Every recorded step for the case in audit order (`seq`), with actor, role,
 * object and version. Append-only: nothing here can be edited.
 *
 * Deep links: `object` (object type) and `id` (object id) filter the list.
 */
import { API, ROLE_LABELS, type AuditEvent } from '@growth-os/contracts';
import { Button, DataTable, EmptyState, Mono, Person, SectionHeader, Skeleton } from '@growth-os/ui';
import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery } from '../../lib/query';
import { fmtDateTime } from './dates';
import './ws8d.css';

const OBJECT_LABEL: Record<string, string> = {
  case: 'Case',
  gate_request: 'Gate request',
  gate_snapshot: 'Gate snapshot',
  sizing_version: 'Sizing',
  assumption: 'Assumption',
  experiment: 'Experiment',
  experiment_result: 'Experiment result',
  feasibility_review: 'Feasibility review',
  condition: 'Condition',
  pilot_plan_version: 'Pilot plan',
  task: 'Task',
  task_set: 'Task set',
  scope_change_request: 'Scope change',
  outcome_observation: 'Outcome actual',
  outcome_review: 'Outcome review',
  decision_record: 'Decision',
  source: 'Source',
};

const objectLabel = (t: string) => OBJECT_LABEL[t] ?? t.replace(/_/g, ' ');

export default function HistoryScreen() {
  const { caseKey = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const objectType = search.get('object') ?? undefined;
  const objectId = search.get('id') ?? undefined;
  const all = useApiQuery(API.cases.history, { params: { caseRef: caseKey }, query: { limit: 200 } });
  const q = useApiQuery(API.cases.history, {
    params: { caseRef: caseKey },
    query: { limit: 200, objectType, objectId },
  });
  const types = useMemo(
    () => [...new Set((all.data?.items ?? []).map((e) => e.objectType))].sort(),
    [all.data],
  );

  const setFilter = (type: string | null) => {
    const next = new URLSearchParams(search);
    next.delete('id');
    if (type) next.set('object', type);
    else next.delete('object');
    setSearch(next, { replace: true });
  };

  return (
    <div className="ws8d-page">
      <SectionHeader
        title="History"
        subtitle="Every recorded step in audit order, with actor and version. The audit is append-only."
        right={
          <label className="ws8d-note" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            Object
            <select
              className="ws8d-input"
              style={{ marginTop: 0, minWidth: 180 }}
              value={objectType ?? ''}
              onChange={(e) => setFilter(e.target.value || null)}
            >
              <option value="">All objects</option>
              {[...new Set([...types, ...(objectType ? [objectType] : [])])].map((t) => (
                <option key={t} value={t}>
                  {objectLabel(t)}
                </option>
              ))}
            </select>
          </label>
        }
      />
      {objectType || objectId ? (
        <div className="ws8d-row">
          <span className="ws8d-note">
            Showing {objectType ? objectLabel(objectType) : 'one object'}
            {objectId ? (
              <>
                {' '}
                · <Mono size={12}>{objectId.slice(0, 8)}</Mono>
              </>
            ) : null}{' '}
            only
          </span>
          <Button variant="ghost" onClick={() => setFilter(null)}>
            Show all
          </Button>
        </div>
      ) : null}
      {q.isPending ? (
        <div aria-busy="true">
          <Skeleton height={240} />
        </div>
      ) : q.error || !q.data ? (
        <ProblemBanner error={q.error} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title="No recorded steps yet">Steps appear here as they are recorded.</EmptyState>
      ) : (
        <>
          <div className="gos-card" style={{ overflow: 'hidden' }}>
            <DataTable<AuditEvent>
              ariaLabel="Audit history"
              rowKey={(e) => e.id}
              rows={q.data.items}
              minWidth={900}
              columns={[
                { key: 'seq', header: '#', numeric: true, cell: (e) => <Mono size={12}>{e.seq}</Mono> },
                {
                  key: 'when',
                  header: 'When',
                  cell: (e) => <span className="ws8d-note">{fmtDateTime(e.occurredAt)}</span>,
                },
                {
                  key: 'actor',
                  header: 'Actor',
                  cell: (e) =>
                    e.actor ? (
                      <Person
                        name={e.actor.displayName}
                        initials={e.actor.initials}
                        subtitle={e.actorRole ? ROLE_LABELS[e.actorRole] : undefined}
                      />
                    ) : (
                      <span className="ws8d-note">System · task connector</span>
                    ),
                },
                {
                  key: 'what',
                  header: 'What happened',
                  cell: (e) => <span style={{ fontSize: 13 }}>{e.summary}</span>,
                },
                {
                  key: 'object',
                  header: 'Object · version',
                  cell: (e) => (
                    <span className="ws8d-note">
                      {objectLabel(e.objectType)}
                      {e.objectVersion !== null ? ` · v${e.objectVersion}` : ''}
                    </span>
                  ),
                },
              ]}
            />
          </div>
          {q.data.nextCursor ? (
            <p className="ws8d-muted">Showing the first 200 steps. Filter by object to see older ones.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
