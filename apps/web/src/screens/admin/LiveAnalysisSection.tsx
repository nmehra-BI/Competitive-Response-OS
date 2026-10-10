/**
 * S14 › Live analysis (D-120 §4, D-130). Off per workspace by default. An administrator turns it on
 * only after the signed data-processing addendum is recorded and a manual eval run passed on the
 * configured provider; both are audited. The setting records documents, never a model name.
 */
import { API } from '@growth-os/contracts';
import { Banner, Button, SectionHeader, Skeleton } from '@growth-os/ui';
import { useId, useState } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';

export function LiveAnalysisSection() {
  const q = useApiQuery(API.admin.liveAnalysis);
  const set = useCommand(API.admin.setLiveAnalysis);
  const id = useId();
  const [addendumRef, setAddendumRef] = useState('');
  const [signedOn, setSignedOn] = useState('');
  const [evalRef, setEvalRef] = useState('');
  const [evalAt, setEvalAt] = useState('');
  const ready = !!addendumRef.trim() && !!signedOn && !!evalRef.trim() && !!evalAt;
  return (
    <section id="admin-live-analysis" className="ws8d-admin-section" aria-labelledby="admin-live-analysis-h">
      <SectionHeader
        id="admin-live-analysis-h"
        title="Live analysis"
        subtitle="Off until the signed addendum is recorded and an eval run passes. The analysis assistant otherwise runs on reviewed fixtures."
      />
      {q.isPending ? (
        <Skeleton height={80} />
      ) : q.error ? (
        <ProblemBanner error={q.error} />
      ) : (
        <>
          <p role="status" style={{ margin: '0 0 8px', fontWeight: 500 }}>
            {q.data.enabled ? 'Live analysis · On' : 'Live analysis · Off'}
            {q.data.enabled && q.data.addendumRef ? ` · addendum ${q.data.addendumRef}` : ''}
          </p>
          {!q.data.liveProviderConfigured ? (
            <Banner
              tone="neutral"
              live={false}
              title="This deployment runs the reviewed fixture provider."
              body="Turning live analysis on records the documents; runs stay on the fixture provider until a live provider is configured."
            />
          ) : null}
          {q.data.enabled ? (
            <Button
              variant="secondary"
              disabled={set.isPending}
              disabledReason="Saving…"
              onClick={() =>
                set.mutate({
                  body: {
                    enabled: false,
                    addendumRef: q.data.addendumRef,
                    addendumSignedOn: q.data.addendumSignedOn,
                    evalRunRef: q.data.evalRunRef,
                    evalPassedAt: q.data.evalPassedAt,
                  },
                })
              }
            >
              Turn live analysis off
            </Button>
          ) : (
            <form
              aria-label="Turn live analysis on"
              className="ws8d-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!ready) return;
                set.mutate({
                  body: {
                    enabled: true,
                    addendumRef: addendumRef.trim(),
                    addendumSignedOn: signedOn,
                    evalRunRef: evalRef.trim(),
                    evalPassedAt: new Date(evalAt).toISOString(),
                  },
                });
              }}
            >
              <div className="ws8d-row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <label htmlFor={`${id}-a`}>
                  Signed addendum (reference){' '}
                  <input
                    id={`${id}-a`}
                    value={addendumRef}
                    onChange={(e) => setAddendumRef(e.target.value)}
                  />
                </label>
                <label htmlFor={`${id}-s`}>
                  Signed on{' '}
                  <input
                    id={`${id}-s`}
                    type="date"
                    value={signedOn}
                    onChange={(e) => setSignedOn(e.target.value)}
                  />
                </label>
                <label htmlFor={`${id}-e`}>
                  Passing eval run (reference){' '}
                  <input id={`${id}-e`} value={evalRef} onChange={(e) => setEvalRef(e.target.value)} />
                </label>
                <label htmlFor={`${id}-t`}>
                  Eval passed at{' '}
                  <input
                    id={`${id}-t`}
                    type="datetime-local"
                    value={evalAt}
                    onChange={(e) => setEvalAt(e.target.value)}
                  />
                </label>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={!ready || set.isPending}
                  disabledReason="Record the signed addendum and a passing eval run first."
                >
                  Turn live analysis on
                </Button>
              </div>
            </form>
          )}
          {set.error ? <ProblemBanner error={set.error} /> : null}
        </>
      )}
    </section>
  );
}
