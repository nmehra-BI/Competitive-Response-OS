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

/**
 * S09 "Add assumption" (D-112 §1): a rate is typed as a percentage ("20" → "0.2") and stored as a
 * fraction in [0, 1]. String arithmetic only (no float); a blank or unreadable value is null, never 0.
 */
export function percentToFraction(input: string): string | null {
  const m = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(input.trim());
  if (!m) return null;
  const whole = m[1]!.padStart(3, '0');
  const int = whole.slice(0, -2).replace(/^0+(?=\d)/, '');
  const frac = `${whole.slice(-2)}${m[2] ?? ''}`.replace(/0+$/, '');
  if (Number(int) > 1 || (int === '1' && frac !== '')) return null;
  return frac ? `${int}.${frac}` : int;
}

/** A plain non-negative decimal ("1,250.5" → "1250.5"); null when unreadable. */
export function decimalValue(input: string): string | null {
  const s = input.trim().replace(/[,\s’']/g, '');
  return /^\d{1,16}(\.\d{1,8})?$/.test(s) ? s : null;
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
