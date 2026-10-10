/**
 * S14 › Licences (D-120, D-129). Fail closed: without a written confirmation of rights, or after the
 * term ended, a licence allows metadata only — no excerpt, model context, embeddings or export. Each
 * licence states its term end and what happens then (remove excerpts and embeddings, keep provenance;
 * or delete the stored copy, keep the audit record).
 */
import {
  API,
  LICENSE_EXPIRY_ACTION_LABELS,
  LICENSE_RIGHTS_STATUS_LABELS,
  LicenseExpiryAction,
  type License,
} from '@growth-os/contracts';
import { Button, DataTable, Mono, SectionHeader, Skeleton } from '@growth-os/ui';
import { useId, useState } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

export function LicencesSection() {
  const q = useApiQuery(API.admin.licenses);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section id="admin-licences" className="ws8d-admin-section" aria-labelledby="admin-licences-h">
      <SectionHeader
        id="admin-licences-h"
        title="Licences"
        subtitle="Content needs a written confirmation of rights. Unconfirmed or ended licences show metadata only."
      />
      {q.isPending ? (
        <Skeleton height={120} />
      ) : q.error ? (
        <ProblemBanner error={q.error} />
      ) : (
        <>
          <div className="gos-card" style={{ overflow: 'hidden' }}>
            <DataTable<License>
              ariaLabel="Licences"
              rowKey={(l) => l.id}
              rows={q.data.items}
              minWidth={900}
              columns={[
                { key: 'name', header: 'Licence', cell: (l) => l.name },
                {
                  key: 'rights',
                  header: 'Rights',
                  cell: (l) => LICENSE_RIGHTS_STATUS_LABELS[l.rightsStatus ?? 'unconfirmed'],
                },
                {
                  key: 'excerpts',
                  header: 'Excerpts',
                  cell: (l) =>
                    l.maxExcerptSentences > 0 ? `Up to ${l.maxExcerptSentences} sentences` : 'None',
                },
                { key: 'model', header: 'Model context', cell: (l) => yesNo(l.allowModelContext) },
                { key: 'export', header: 'Export', cell: (l) => yesNo(l.allowExport) },
                {
                  key: 'term',
                  header: 'Term ends',
                  cell: (l) => (l.termEndsOn ? <Mono size={12}>{l.termEndsOn}</Mono> : 'Open-ended'),
                },
                {
                  key: 'expiry',
                  header: 'On expiry',
                  cell: (l) => (l.onExpiry ? LICENSE_EXPIRY_ACTION_LABELS[l.onExpiry] : '—'),
                },
                {
                  key: 'edit',
                  header: '',
                  cell: (l) => (
                    <Button variant="ghost" onClick={() => setEditing(l.id)}>
                      {`Edit ${l.name}`}
                    </Button>
                  ),
                },
              ]}
            />
          </div>
          {editing ? (
            <LicenceForm
              key={editing}
              licence={q.data.items.find((l) => l.id === editing)!}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function LicenceForm({ licence, onDone }: { licence: License; onDone: () => void }) {
  const id = useId();
  const set = useCommand(API.admin.setLicense, { onSuccess: onDone });
  const [docRef, setDocRef] = useState(licence.rightsConfirmation?.documentRef ?? '');
  const [confirmedOn, setConfirmedOn] = useState(licence.rightsConfirmation?.confirmedOn ?? '');
  const [sentences, setSentences] = useState(String(licence.maxExcerptSentences));
  const [model, setModel] = useState(licence.allowModelContext);
  const [exportOk, setExportOk] = useState(licence.allowExport);
  const [termEnds, setTermEnds] = useState(licence.termEndsOn ?? '');
  const [onExpiry, setOnExpiry] = useState<LicenseExpiryAction>(
    licence.onExpiry ?? 'remove_content_keep_metadata',
  );
  const confirmed = !!docRef.trim() && !!confirmedOn;
  const content = Number(sentences) > 0 || model || exportOk;
  return (
    <form
      aria-label={`Edit licence ${licence.name}`}
      className="ws8d-form"
      style={{ marginTop: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        set.mutate({
          params: { id: licence.id },
          body: {
            name: licence.name,
            boundaryText: licence.boundaryText,
            maxExcerptSentences: Number(sentences) || 0,
            allowModelContext: model,
            allowEmbeddings: false,
            allowExport: exportOk,
            rightsConfirmation: confirmed ? { documentRef: docRef.trim(), confirmedOn } : null,
            termEndsOn: termEnds || null,
            onExpiry,
          },
        });
      }}
    >
      <div className="ws8d-row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label htmlFor={`${id}-doc`}>
          Written confirmation (document){' '}
          <input id={`${id}-doc`} value={docRef} onChange={(e) => setDocRef(e.target.value)} />
        </label>
        <label htmlFor={`${id}-on`}>
          Confirmed on{' '}
          <input
            id={`${id}-on`}
            type="date"
            value={confirmedOn}
            onChange={(e) => setConfirmedOn(e.target.value)}
          />
        </label>
        <label htmlFor={`${id}-n`}>
          Excerpt sentences{' '}
          <input
            id={`${id}-n`}
            type="number"
            min={0}
            value={sentences}
            onChange={(e) => setSentences(e.target.value)}
          />
        </label>
        <label>
          <input type="checkbox" checked={model} onChange={(e) => setModel(e.target.checked)} /> Model context
        </label>
        <label>
          <input type="checkbox" checked={exportOk} onChange={(e) => setExportOk(e.target.checked)} /> Export
        </label>
        <label htmlFor={`${id}-end`}>
          Term ends{' '}
          <input
            id={`${id}-end`}
            type="date"
            value={termEnds}
            onChange={(e) => setTermEnds(e.target.value)}
          />
        </label>
        <label htmlFor={`${id}-exp`}>
          On expiry{' '}
          <select
            id={`${id}-exp`}
            value={onExpiry}
            onChange={(e) => setOnExpiry(e.target.value as LicenseExpiryAction)}
          >
            {LicenseExpiryAction.options.map((a) => (
              <option key={a} value={a}>
                {LICENSE_EXPIRY_ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {set.error ? <ProblemBanner error={set.error} /> : null}
      <div className="ws8d-row">
        <Button
          variant="primary"
          type="submit"
          disabled={(content && !confirmed) || set.isPending}
          disabledReason="Record the written confirmation of rights before allowing excerpts, model context or export."
        >
          Save licence
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
