/** Mandate list (/me/mandates): every mandate the viewer can access with its G0 status. */
import { API } from '@growth-os/contracts';
import { Button, DataTable, EmptyState, Mono, Person, UiLink } from '@growth-os/ui';
import { useApiQuery } from '../../lib/query';
import { ErrorPage, LoadingPage, PageHeader, usePeople, useDocumentTitle } from '../overview/shared';
import { MandateStatusChip } from './status';

export default function MandatesScreen() {
  useDocumentTitle('Mandates');
  const q = useApiQuery(API.mandates.list, { query: {} });
  const { byId } = usePeople();
  if (q.isPending) return <LoadingPage label="Mandates" />;
  if (q.error) return <ErrorPage title="Mandates" error={q.error} />;
  return (
    <div className="app-page dx-page">
      <PageHeader
        title="Mandates"
        subtitle="What each business unit may look for, under which constraints, and who owns it."
        actions={
          <Button variant="primary" icon="plus" href="/me/mandates/new">
            Create mandate
          </Button>
        }
      />
      {q.data.items.length ? (
        <div className="dx-list">
          <DataTable
            ariaLabel="Mandates"
            minWidth={760}
            rowKey={(m) => m.id}
            rowHeader="mandate"
            rows={q.data.items}
            columns={[
              {
                key: 'mandate',
                header: 'Mandate',
                cell: (m) => (
                  <UiLink href={`/me/mandates/${m.key}`} className="dx-caselink">
                    <span className="dx-caselink__title">{m.title}</span>
                    <Mono size={12}>{m.key}</Mono>
                  </UiLink>
                ),
              },
              { key: 'status', header: 'Status', cell: (m) => <MandateStatusChip status={m.status} /> },
              {
                key: 'version',
                header: 'Version',
                cell: (m) =>
                  m.draftVersion
                    ? `Draft v${m.draftVersion.version}`
                    : m.currentVersion
                      ? `v${m.currentVersion.version}`
                      : '—',
              },
              {
                key: 'owner',
                header: 'Owner',
                cell: (m) => {
                  const p = byId((m.draftVersion ?? m.currentVersion)?.fields.ownerId);
                  return p ? (
                    <Person name={p.displayName} initials={p.initials} />
                  ) : (
                    <span className="dx-muted">Missing owner</span>
                  );
                },
              },
              {
                key: 'sponsor',
                header: 'Sponsor',
                cell: (m) => {
                  const p = byId((m.draftVersion ?? m.currentVersion)?.fields.sponsorId);
                  return p ? <Person name={p.displayName} initials={p.initials} /> : '—';
                },
              },
            ]}
          />
        </div>
      ) : (
        <EmptyState
          title="No mandates yet"
          action={
            <Button variant="primary" icon="plus" href="/me/mandates/new">
              Create a mandate
            </Button>
          }
        >
          A mandate states what you may look for and who owns it. Your sponsor approves it at G0.
        </EmptyState>
      )}
    </div>
  );
}
