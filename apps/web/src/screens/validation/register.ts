/**
 * Assumption register ordering (S09, research §6.9): grouped Test first / Test next / Watch /
 * Monitor, then sorted by decision sensitivity, then evidence quality (weakest first). There is
 * deliberately no combined score. The group comes from the API (`registerGroup`); the sort is
 * repeated here so the table and the 2×2 never depend on server row order.
 */
import type { Assumption, EvidenceQuality, RegisterGroup, Sensitivity } from '@growth-os/contracts';

export const GROUP_ORDER: readonly RegisterGroup[] = ['test_first', 'test_next', 'watch', 'monitor'];

export const GROUP_SUBTITLE: Record<RegisterGroup, string> = {
  test_first: 'High sensitivity, weak or no evidence',
  test_next: 'Evidence exists but is partial',
  watch: 'Lower sensitivity, weak evidence',
  monitor: 'Lower sensitivity',
};

const SENSITIVITY_RANK: Record<Sensitivity, number> = { high: 0, medium: 1, low: 2 };
/** Weakest evidence first: what we know least about is tested first. */
const EVIDENCE_RANK: Record<EvidenceQuality, number> = {
  none: 0,
  weak: 1,
  conflicting: 2,
  some: 3,
  strong: 4,
};

export function compareAssumptions(a: Assumption, b: Assumption): number {
  return (
    SENSITIVITY_RANK[a.sensitivity] - SENSITIVITY_RANK[b.sensitivity] ||
    EVIDENCE_RANK[a.current.evidenceQuality] - EVIDENCE_RANK[b.current.evidenceQuality] ||
    a.key.localeCompare(b.key)
  );
}

export interface RegisterGroupRows {
  group: RegisterGroup;
  items: Assumption[];
}

/** Non-retired assumptions in register order; empty groups are left out. */
export function groupRegister(items: readonly Assumption[]): RegisterGroupRows[] {
  const live = items.filter((a) => a.status !== 'retired');
  return GROUP_ORDER.map((group) => ({
    group,
    items: live.filter((a) => a.registerGroup === group).sort(compareAssumptions),
  })).filter((g) => g.items.length > 0);
}
