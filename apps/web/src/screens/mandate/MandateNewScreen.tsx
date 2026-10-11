/**
 * New mandate (/me/mandates/new). Creates a Draft mandate (mandates.create) and opens it in S02.
 * Product, segment, geography and sponsor start from an existing mandate's scope; everything
 * else is filled in on the mandate page, where the draft autosaves.
 */
import { API, type MandateDraftFields } from '@growth-os/contracts';
import { Button } from '@growth-os/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';
import { Breadcrumb, ErrorPage, LoadingPage, PageHeader, useDocumentTitle } from '../overview/shared';

export default function MandateNewScreen() {
  useDocumentTitle('New mandate');
  const navigate = useNavigate();
  const bus = useApiQuery(API.overview.portfolio, { query: {} });
  const mandates = useApiQuery(API.mandates.list, { query: {} });
  const create = useCommand(API.mandates.create, {
    onSuccess: (m) => navigate(`/me/mandates/${m.key}`),
  });
  const [title, setTitle] = useState('');
  const [bu, setBu] = useState('');
  const [from, setFrom] = useState('');
  const [touched, setTouched] = useState(false);
  if (bus.isPending || mandates.isPending) return <LoadingPage label="New mandate" />;
  if (bus.error || mandates.error)
    return <ErrorPage title="New mandate" error={bus.error ?? mandates.error} />;
  const units = bus.data.businessUnits.filter((b) => b.accessible);
  const buId = bu || units[0]?.id || '';
  const sources = mandates.data.items.filter((m) => m.currentVersion && m.businessUnitId === buId);
  const source = sources.find((m) => m.id === from) ?? null;
  const titleError = touched && !title.trim() ? 'Name the mandate.' : null;

  const onCreate = () => {
    setTouched(true);
    if (!title.trim() || !buId) return;
    const s = source?.currentVersion?.fields;
    const fields: MandateDraftFields = s
      ? {
          productId: s.productId,
          segmentIds: s.segmentIds,
          geographyCodes: s.geographyCodes,
          sponsorId: s.sponsorId,
          evidenceSourceKinds: s.evidenceSourceKinds,
          pilotDurationDays: s.pilotDurationDays,
        }
      : {};
    create.mutate({ body: { businessUnitId: buId, title: title.trim(), fields } });
  };

  return (
    <div className="app-page dx-page" style={{ maxWidth: 760 }}>
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: 'Mandates', href: '/me/mandates' }, { label: 'New' }]} />}
        title="New mandate"
        subtitle="Start a draft. You fill in the scope, owner and currency next; your sponsor approves it at G0."
      />
      <form
        className="dx-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onCreate();
        }}
      >
        <div>
          <label htmlFor="nm-title" className="dx-label">
            Title (required)
          </label>
          <input
            id="nm-title"
            className="gos-input"
            value={title}
            placeholder="e.g. Mandate · Swiss food-processing plants"
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? 'nm-title-err' : undefined}
            onChange={(e) => setTitle(e.target.value)}
          />
          {titleError ? (
            <div id="nm-title-err" className="dx-fielderr">
              {titleError}
            </div>
          ) : null}
        </div>
        <div className="dx-grid">
          <div>
            <label htmlFor="nm-bu" className="dx-label">
              Business unit
            </label>
            <select id="nm-bu" className="gos-select" value={buId} onChange={(e) => setBu(e.target.value)}>
              {bus.data.businessUnits.map((b) => (
                <option key={b.id} value={b.id} disabled={!b.accessible}>
                  {b.accessible ? b.name : `${b.name} · no access`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="nm-from" className="dx-label">
              Start from the scope of
            </label>
            <select
              id="nm-from"
              className="gos-select"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              <option value="">Nothing · empty scope</option>
              {sources.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.key} · {m.title}
                </option>
              ))}
            </select>
            <div className="dx-help">Copies product, segment, geography and sponsor. Nothing else.</div>
          </div>
        </div>
        <div className="dx-footer" style={{ marginTop: 0 }}>
          <Button
            variant="primary"
            type="submit"
            disabled={create.isPending}
            disabledReason={create.isPending ? 'Creating…' : undefined}
          >
            Create draft mandate
          </Button>
          <Button variant="ghost" href="/me/mandates">
            Cancel
          </Button>
        </div>
        {create.error ? <ProblemBanner error={create.error} /> : null}
      </form>
    </div>
  );
}
