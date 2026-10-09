/**
 * Case list (/me/cases): the S01 case table on its own page, filtered by stage (deep link
 * `stage`), owner and business unit. Only cases the viewer can access; hidden cases are not counted.
 */
import { API, CASE_STAGE_LABELS, CaseStage } from '@growth-os/contracts';
import { Button, EmptyState } from '@growth-os/ui';
import { useSearchParams } from 'react-router-dom';
import { useApiQuery } from '../../lib/query';
import { CaseTable, ErrorPage, LoadingPage, PageHeader, useDocumentTitle } from './shared';

const UUID = /^[0-9a-f-]{36}$/i;

export default function CasesScreen() {
  useDocumentTitle('Expansion cases');
  const [params, setParams] = useSearchParams();
  const stageParam = CaseStage.safeParse(params.get('stage'));
  const stage = stageParam.success ? stageParam.data : undefined;
  const owner = params.get('owner');
  const bu = params.get('bu');
  const q = useApiQuery(API.overview.listCases, {
    query: {
      stage,
      ownerId: owner && UUID.test(owner) ? owner : undefined,
      businessUnitId: bu && UUID.test(bu) ? bu : undefined,
    },
  });
  if (q.isPending) return <LoadingPage label="Expansion cases" />;
  if (q.error) return <ErrorPage title="Expansion cases" error={q.error} />;
  return (
    <div className="app-page dx-page">
      <PageHeader
        title="Expansion cases"
        subtitle={q.data.scope.label}
        actions={
          <>
            <label className="dx-inline dx-muted" style={{ fontSize: 13 }}>
              Stage
              <select
                className="gos-select"
                style={{ width: 'auto', minHeight: 36 }}
                value={stage ?? ''}
                onChange={(e) => {
                  const next = new URLSearchParams(params);
                  if (e.target.value) next.set('stage', e.target.value);
                  else next.delete('stage');
                  setParams(next, { replace: true });
                }}
              >
                <option value="">All stages</option>
                {CaseStage.options.map((s) => (
                  <option key={s} value={s}>
                    {CASE_STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="secondary" icon="compass" href="/me/opportunities">
              Opportunities
            </Button>
          </>
        }
      />
      <p className="dx-small dx-muted" style={{ margin: 0 }}>
        Market sizes are not totalled across cases. Each case has its own market boundary, unit and year.
      </p>
      {q.data.items.length ? (
        <div className="dx-list">
          <CaseTable rows={q.data.items} />
        </div>
      ) : (
        <EmptyState
          title={stage ? `No cases in ${CASE_STAGE_LABELS[stage]}` : 'No expansion cases yet'}
          action={
            <Button variant="primary" icon="plus" href="/me/mandates/new">
              Create a mandate
            </Button>
          }
        >
          Cases start from a shortlisted opportunity under an approved mandate.
        </EmptyState>
      )}
    </div>
  );
}
