/**
 * Shared problem banner (FRONTEND §4): maps API problem codes to business copy. NOT_FOUND is
 * always generic so hidden resources never leak ("no access to case X" is never shown).
 */
import { Banner } from '@growth-os/ui';
import type { ReactNode } from 'react';
import { ApiProblem } from '../../lib/api-client';

export function ProblemBanner({ error, actions }: { error: unknown; actions?: ReactNode }) {
  if (!(error instanceof ApiProblem)) {
    return (
      <Banner
        tone="danger"
        title="We could not reach the server."
        body="Check your connection and try again. Your work is saved."
        actions={actions}
      />
    );
  }
  const p = error.problem;
  switch (p.code) {
    case 'NOT_FOUND':
      return (
        <Banner
          tone="neutral"
          title="This page could not be found."
          body="Check the link or go back to Overview."
          actions={actions}
        />
      );
    case 'UNAUTHENTICATED':
      return (
        <Banner tone="info" title="Your session ended." body="Sign in again to continue." actions={actions} />
      );
    case 'SNAPSHOT_STALE':
    case 'SNAPSHOT_HASH_MISMATCH':
      return (
        <Banner
          tone="warn"
          title={p.title}
          body="You can never approve something different from what you read. Reload the current version."
          actions={actions}
        />
      );
    case 'PRECONDITIONS_UNMET':
      return (
        <Banner
          tone="warn"
          title={p.title}
          body={
            p.blockers?.length ? (
              <>
                <span>Why?</span>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {p.blockers.map((b) => (
                    <li key={b.key}>{b.message}</li>
                  ))}
                </ul>
              </>
            ) : undefined
          }
          actions={actions}
        />
      );
    case 'VERSION_CONFLICT':
      return (
        <Banner
          tone="warn"
          title="Changed elsewhere"
          body="Someone saved a newer version. Review the changes before saving yours."
          actions={actions}
        />
      );
    case 'CALCULATION_BLOCKED':
      return (
        <Banner
          tone="warn"
          title={p.title}
          body={p.checks
            ?.filter((c) => c.blocking)
            .map((c) => c.message)
            .join(' · ')}
          actions={actions}
        />
      );
    case 'SELF_APPROVAL_PROHIBITED':
    case 'FORBIDDEN':
    case 'AUTHORITY_INSUFFICIENT':
    case 'CONFLICT_OF_INTEREST':
    case 'AGENT_IDENTITY_FORBIDDEN':
    case 'RESTRICTED_SOURCE':
      return <Banner tone="lock" title={p.title} actions={actions} />;
    case 'CONNECTOR_UNAVAILABLE':
      return (
        <Banner
          tone="warn"
          title={p.title}
          body="Internal work continues. You can export instead."
          actions={actions}
        />
      );
    default:
      return (
        <Banner
          tone="danger"
          title={p.title}
          body={`Reference ${p.correlationId}. Your work is saved.`}
          actions={actions}
        />
      );
  }
}
