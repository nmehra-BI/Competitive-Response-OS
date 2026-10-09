/** Connected lineage drawer (frozen LineageDrawerProps). Walks inputs one level at a time. */
import { API } from '@growth-os/contracts';
import { LineageDrawerView, type LineageDrawerProps } from '@growth-os/ui';
import { useState } from 'react';
import { useApiQuery } from '../../lib/query';
import { ProblemBanner } from '../shell/ProblemBanner';

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
      usedBy={q.data?.usedBy}
      history={q.data?.history}
      exactValue={q.data?.exactValue}
      engineLabel={q.data?.engineLabel}
      draft={version === 'draft'}
      onSelectInput={setCurrent}
    />
  );
}
