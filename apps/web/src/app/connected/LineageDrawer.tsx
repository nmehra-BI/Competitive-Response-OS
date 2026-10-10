/**
 * Connected lineage drawer (frozen LineageDrawerProps). Walks inputs one level at a time. A dependent
 * that is checked against the figure rather than calculated from it (D-117) names the check, so SAM
 * reads "Used by: Reachable pool (upper-bound check: 500 ≤ 2,000 sites)".
 */
import { API, type LineageRelation } from '@growth-os/contracts';
import { LineageDrawerView, type LineageDrawerProps } from '@growth-os/ui';
import { useState } from 'react';
import { useApiQuery } from '../../lib/query';
import { ProblemBanner } from '../shell/ProblemBanner';

/** "Reachable pool (upper-bound check: 500 ≤ 2,000 sites)" for a check edge; the label otherwise. */
export function usedByLabel(u: {
  label: string;
  relation?: LineageRelation;
  detail?: string | null;
}): string {
  return u.relation === 'checked_against' && u.detail ? `${u.label} (${u.detail})` : u.label;
}

export function LineageDrawer({ caseRef, model, nodeKey, version, onClose }: LineageDrawerProps) {
  const [current, setCurrent] = useState(nodeKey);
  const q = useApiQuery(API.lineage.get, {
    params: { caseRef },
    query: { node: current, model, version },
  });
  return (
    <LineageDrawerView
      title={q.data?.node.label ?? 'Lineage'}
      onClose={onClose}
      loading={q.isPending}
      error={q.error ? <ProblemBanner error={q.error} /> : undefined}
      node={q.data?.node}
      inputs={q.data?.inputs}
      usedBy={q.data?.usedBy.map((u) => ({ label: usedByLabel(u), href: u.href }))}
      history={q.data?.history}
      exactValue={q.data?.exactValue}
      engineLabel={q.data?.engineLabel}
      draft={version === 'draft'}
      onSelectInput={setCurrent}
    />
  );
}
