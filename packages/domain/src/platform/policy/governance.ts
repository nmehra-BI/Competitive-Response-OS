/**
 * Delegated-authority governance (D-109, D-110, D-122): the default matrix, request routing, the
 * investment-committee quorum and the extension (X) rule. Pure and deterministic: callers load the
 * facts (grants, seats, decisions, parent pilot) and write what these functions decide.
 *
 * Invariants:
 *  - a quorum counts approvals on the CURRENT snapshot only; decisions on an earlier snapshot lapse
 *    (never-rule 2);
 *  - abstain never counts; a required seat that records Not approved or abstains ends the request;
 *  - committee membership is not authority (the policy engine still checks a grant per decider);
 *  - every amount here is one-time money of one gate or one pilot; nothing here touches a /year figure
 *    (never-rule 3). The X cumulative rule adds the one-time pilot ask to the one-time extension asks
 *    of the same pilot only.
 */
import Decimal from 'decimal.js';
import {
  COMMITTEE_SEAT_LABELS,
  type ApprovalRoute,
  type AuthorityTemplate,
  type CommitteeSeat,
  type CommitteeSeatState,
  type ExtensionRule,
  type GateCode,
  type GateDisposition,
  type GatePolicyBody,
} from '@growth-os/contracts';

// ---------------------------------------------------------------------------
// Defaults (D-109 §1, §3, §4; D-110 §1)
// ---------------------------------------------------------------------------

/** The default delegated-authority matrix every new tenant starts with (one-time EUR per request). */
export const DEFAULT_AUTHORITY: Readonly<Record<GateCode, AuthorityTemplate>> = {
  G0: { sponsorCeiling: null, committeeCeiling: null, currency: 'EUR' }, // no spend: the sponsor approves
  G1: { sponsorCeiling: '50000.00', committeeCeiling: '250000.00', currency: 'EUR' },
  G2: { sponsorCeiling: '150000.00', committeeCeiling: '1000000.00', currency: 'EUR' },
  G3: { sponsorCeiling: null, committeeCeiling: '2000000.00', currency: 'EUR' },
  X: { sponsorCeiling: '50000.00', committeeCeiling: '250000.00', currency: 'EUR' },
};

export const DEFAULT_COMMITTEE_SEATS: readonly CommitteeSeat[] = ['chair', 'finance', 'operations'];
export const DEFAULT_REQUIRED_SEATS: readonly CommitteeSeat[] = ['finance'];
export const DEFAULT_COMMITTEE_QUORUM = 2;

export const DEFAULT_EXTENSION_RULE: ExtensionRule = {
  maxBudgetShare: '0.25',
  maxDurationShare: '0.50',
  minDurationDays: 14,
  maxPerParent: 1,
  cumulativeWithinSponsorCeiling: true,
  capRequiredInRealTenants: true,
};

/** Gates that never expire in the MVP (D-109 §4). */
const NEVER_EXPIRE: ReadonlySet<GateCode> = new Set<GateCode>(['G0', 'G3']);
/** Gates without spend: the sponsor approves, no ceiling applies. */
const NO_SPEND: ReadonlySet<GateCode> = new Set<GateCode>(['G0']);

export interface EffectiveGatePolicy {
  gateCode: GateCode;
  /** Approvals needed when the request routes to the sponsor (always 1 in the MVP matrix). */
  requiredApprovals: number;
  approvalExpires: boolean;
  approvalExpiryDays: number;
  authority: AuthorityTemplate;
  committee: { seats: CommitteeSeat[]; requiredSeats: CommitteeSeat[]; quorum: number };
  /** X only. */
  extension: ExtensionRule | null;
}

/**
 * A stored gate policy with the D-109 / D-110 defaults filled in where a field is absent (policies
 * published before D-122 keep their exact shape; D-122 adjustment 1). When the policy names its own
 * committee seats, its `requiredApprovals` is the committee quorum (G3); otherwise a request that routes
 * to the committee (above the sponsor's ceiling) uses the default 2 of 3 with the finance seat.
 */
export function effectiveGatePolicy(body: GatePolicyBody): EffectiveGatePolicy {
  const code = body.gateCode;
  const seats = body.committeeSeats?.length ? [...body.committeeSeats] : [...DEFAULT_COMMITTEE_SEATS];
  const required = (body.requiredSeats ?? DEFAULT_REQUIRED_SEATS).filter((s) => seats.includes(s));
  const quorum = body.committeeSeats?.length
    ? Math.min(Math.max(body.requiredApprovals, 1), seats.length)
    : Math.min(DEFAULT_COMMITTEE_QUORUM, seats.length);
  return {
    gateCode: code,
    requiredApprovals: body.requiredApprovals,
    approvalExpires: body.approvalExpires ?? !NEVER_EXPIRE.has(code),
    approvalExpiryDays: body.approvalExpiryDays,
    authority: body.authority ?? DEFAULT_AUTHORITY[code],
    committee: { seats, requiredSeats: required, quorum },
    extension: code === 'X' ? (body.extension ?? DEFAULT_EXTENSION_RULE) : null,
  };
}

// ---------------------------------------------------------------------------
// Money (display label only; never arithmetic across time bases)
// ---------------------------------------------------------------------------

/** "€120k", "€30k", "€1,250": a label for one-time amounts in governance copy. */
export function formatMoneyShort(amount: string, currency: string): string {
  const symbol = currency === 'EUR' ? '€' : `${currency} `;
  const [intPart = '0', frac = ''] = amount.replace(/^-/, '').split('.');
  const neg = amount.startsWith('-') ? '−' : '';
  const n = BigInt(intPart || '0');
  const cents = frac.replace(/0+$/, '');
  if (cents === '' && n >= 1000n && n % 1000n === 0n) return `${neg}${symbol}${(n / 1000n).toString()}k`;
  const grouped = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg}${symbol}${grouped}${cents ? `.${frac.padEnd(2, '0').slice(0, 2)}` : ''}`;
}

function dec(v: string | null | undefined): Decimal | null {
  if (v === null || v === undefined) return null;
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Routing (D-109 §1)
// ---------------------------------------------------------------------------

export interface RouteInput {
  gateCode: GateCode;
  /** The one-time amount the request asks for; null = placeholder (never approvable). */
  amount: string | null;
  currency: string | null;
  authority: AuthorityTemplate;
  /**
   * The case sponsor's valid grant ceiling for this gate and business unit on the decision date
   * (undefined = the sponsor holds no grant; null = a no-spend grant).
   */
  sponsorGrantCeiling?: string | null;
  /**
   * X only (D-109 §1 X row): the parent G2's approved amount plus every other extension of the same
   * parent, and the sponsor's G2 ceiling it must stay within. Absent for other gates.
   */
  cumulative?: { priorAmount: string; sponsorParentCeiling: string | null; within: boolean };
}

export interface RouteResult {
  route: ApprovalRoute;
  reason: string;
}

/**
 * Who decides a request under the matrix: the sponsor within their ceiling (and, for an extension,
 * within the cumulative rule), else the committee within its ceiling, else an authority gap.
 */
export function routeRequest(i: RouteInput): RouteResult {
  if (NO_SPEND.has(i.gateCode)) return { route: 'sponsor', reason: `${i.gateCode} has no spend` };
  const t = i.authority;
  const amount = dec(i.amount);
  const sameCurrency = i.currency === null || i.currency === t.currency;
  if (amount === null) {
    // A placeholder ask routes like the smallest ask; it stays unapprovable (no amount).
    if (t.sponsorCeiling !== null) return { route: 'sponsor', reason: 'Amount not stated yet' };
    if (t.committeeCeiling !== null) return { route: 'committee', reason: 'Amount not stated yet' };
    return { route: 'authority_gap', reason: 'No approver in the matrix' };
  }
  const templateSponsor = dec(t.sponsorCeiling);
  const grant = i.sponsorGrantCeiling === undefined ? undefined : dec(i.sponsorGrantCeiling);
  const sponsorLimit =
    templateSponsor === null || grant === undefined || grant === null
      ? null
      : Decimal.min(templateSponsor, grant);
  let cumulativeOk = true;
  if (i.cumulative) {
    const ceiling = dec(i.cumulative.sponsorParentCeiling);
    const prior = dec(i.cumulative.priorAmount) ?? new Decimal(0);
    cumulativeOk = !i.cumulative.within || (ceiling !== null && prior.plus(amount).lte(ceiling));
  }
  if (sameCurrency && sponsorLimit !== null && amount.lte(sponsorLimit) && cumulativeOk)
    return { route: 'sponsor', reason: 'Within the sponsor’s delegated authority' };
  const committee = dec(t.committeeCeiling);
  if (sameCurrency && committee !== null && amount.lte(committee))
    return {
      route: 'committee',
      reason: cumulativeOk
        ? 'Above the sponsor’s ceiling: the investment committee decides'
        : 'Pilot plus extensions above the sponsor’s pilot ceiling: the investment committee decides',
    };
  return { route: 'authority_gap', reason: 'Above every ceiling in the matrix · Authority gap' };
}

// ---------------------------------------------------------------------------
// Committee quorum (D-109 §3)
// ---------------------------------------------------------------------------

export interface CommitteeHolder {
  seat: CommitteeSeat;
  userId: string | null;
}

export interface CommitteeDecisionFact {
  userId: string;
  /** The seat the decision was recorded in (approval.committee_seat). */
  seat: CommitteeSeat | null;
  disposition: GateDisposition;
  snapshotId: string;
  /** False when the approval was invalidated or expired. */
  effective: boolean;
}

export interface CommitteeInput {
  quorum: number;
  seats: readonly CommitteeSeat[];
  requiredSeats: readonly CommitteeSeat[];
  holders: readonly CommitteeHolder[];
  /** Author, case owner, the case's economics finance reviewer, anyone conflicted. */
  excludedUserIds: readonly string[];
  currentSnapshotId: string | null;
  decisions: readonly CommitteeDecisionFact[];
  viewerId: string | null;
}

export interface CommitteeSeatView {
  seat: CommitteeSeat;
  userId: string | null;
  required: boolean;
  state: CommitteeSeatState;
  isViewer: boolean;
}

export type CommitteeOutcome = 'pending' | 'approved' | 'not_approved';

export interface CommitteeEvaluation {
  seats: CommitteeSeatView[];
  approvals: number;
  outcome: CommitteeOutcome;
  statusText: string;
}

const APPROVE: ReadonlySet<GateDisposition> = new Set<GateDisposition>([
  'approve',
  'approve_with_conditions',
]);
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

const seatText = (s: CommitteeSeat) => COMMITTEE_SEAT_LABELS[s].toLowerCase();
const seatList = (xs: readonly CommitteeSeat[]) => xs.map(seatText).join(' and ');

/** The seat a person holds on this committee (first live seat), or null. */
export function seatOf(holders: readonly CommitteeHolder[], userId: string): CommitteeSeat | null {
  return holders.find((h) => h.userId === userId)?.seat ?? null;
}

/**
 * Per-seat state and the quorum outcome on the current snapshot. Approved when at least `quorum` seats
 * approved on the current snapshot and every required seat is among them. Not approved when quorum can
 * no longer be reached: a required seat recorded Not approved or abstained (or cannot sit), or too few
 * seats remain that could still approve.
 */
export function evaluateCommittee(i: CommitteeInput): CommitteeEvaluation {
  const current = i.decisions.filter((d) => d.snapshotId === i.currentSnapshotId);
  const seats: CommitteeSeatView[] = i.seats.map((seat) => {
    const holder = i.holders.find((h) => h.seat === seat)?.userId ?? null;
    const required = i.requiredSeats.includes(seat);
    const isViewer = holder !== null && holder === i.viewerId;
    const view = (state: CommitteeSeatState): CommitteeSeatView => ({
      seat,
      userId: holder,
      required,
      state,
      isViewer,
    });
    if (holder === null) return view('vacant');
    if (i.excludedUserIds.includes(holder)) return view('excluded');
    const mine = current.find((d) => d.seat === seat || (d.seat === null && d.userId === holder));
    if (mine) {
      if (APPROVE.has(mine.disposition)) return view(mine.effective ? 'approved' : 'lapsed');
      if (mine.disposition === 'not_approved') return view('not_approved');
      if (mine.disposition === 'abstain') return view('abstained');
      return view('waiting');
    }
    const earlier = i.decisions.some(
      (d) =>
        d.snapshotId !== i.currentSnapshotId &&
        APPROVE.has(d.disposition) &&
        (d.seat === seat || (d.seat === null && d.userId === holder)),
    );
    return view(earlier ? 'lapsed' : 'waiting');
  });
  const approved = seats.filter((s) => s.state === 'approved');
  const open = seats.filter((s) => s.state === 'waiting' || s.state === 'lapsed');
  const requiredMissing = i.requiredSeats.filter((r) => !approved.some((s) => s.seat === r));
  const requiredLost = i.requiredSeats.filter((r) => {
    const s = seats.find((x) => x.seat === r);
    return !s || !['approved', 'waiting', 'lapsed'].includes(s.state);
  });
  let outcome: CommitteeOutcome = 'pending';
  if (approved.length >= i.quorum && requiredMissing.length === 0) outcome = 'approved';
  else if (requiredLost.length > 0 || approved.length + open.length < i.quorum) outcome = 'not_approved';

  let statusText: string;
  if (outcome === 'approved') {
    statusText = `Quorum reached · ${approved.length} of ${seats.length}${
      i.requiredSeats.length ? ` with the ${seatList(i.requiredSeats)}` : ''
    }`;
  } else if (outcome === 'not_approved') {
    statusText = requiredLost.length
      ? `Quorum cannot be reached · ${seatList(requiredLost)} did not approve`
      : 'Quorum cannot be reached';
  } else {
    const missing = i.quorum - approved.length;
    const req = requiredMissing.length ? ` · ${seatList(requiredMissing)}` : '';
    if (approved.length === 0)
      statusText = `Waiting on ${i.quorum} of ${seats.length} approvers${
        requiredMissing.length ? ` · ${seatList(requiredMissing)} required` : ''
      }`;
    else if (missing === 1)
      statusText = `Waiting on ${ORDINALS[approved.length] ?? 'another'} approver${req}`;
    else if (missing > 1) statusText = `Waiting on ${missing} more approvers${req}`;
    else statusText = `Waiting on the ${seatList(requiredMissing)}`;
  }
  return { seats, approvals: approved.length, outcome, statusText };
}

// ---------------------------------------------------------------------------
// Extension rule (D-110 §1)
// ---------------------------------------------------------------------------

export interface ExtensionParentFacts {
  /** The parent G2's approved one-time amount. */
  amount: string | null;
  currency: string | null;
  durationDays: number | null;
  maxSites: number | null;
}

export interface ExtensionLimits {
  parentAmount: string;
  currency: string;
  parentDurationDays: number | null;
  maxAmount: string;
  maxDurationDays: number | null;
  minDurationDays: number;
  extensionsUsed: number;
  extensionsAllowed: number;
  cumulativeCeiling: string | null;
  text: string;
}

function pctText(share: string): string {
  const p = new Decimal(share).times(100);
  return p.isInteger() ? p.toFixed(0) : p.toString();
}

/** The S12 limits for a parent pilot: "Up to €30k (25% of €120k) · up to 45 days". */
export function extensionLimits(
  rule: ExtensionRule,
  parent: ExtensionParentFacts,
  extensionsUsed: number,
  cumulativeCeiling: string | null,
): ExtensionLimits | null {
  const amount = dec(parent.amount);
  if (amount === null || parent.currency === null) return null;
  const maxAmount = amount.times(rule.maxBudgetShare).toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2);
  const maxDurationDays =
    parent.durationDays === null
      ? null
      : Math.max(
          new Decimal(parent.durationDays).times(rule.maxDurationShare).floor().toNumber(),
          rule.minDurationDays,
        );
  const text = `Up to ${formatMoneyShort(maxAmount, parent.currency)} (${pctText(rule.maxBudgetShare)}% of ${formatMoneyShort(
    amount.toFixed(2),
    parent.currency,
  )})${maxDurationDays !== null ? ` · up to ${maxDurationDays} days` : ''}`;
  return {
    parentAmount: amount.toFixed(2),
    currency: parent.currency,
    parentDurationDays: parent.durationDays,
    maxAmount,
    maxDurationDays,
    minDurationDays: rule.minDurationDays,
    extensionsUsed,
    extensionsAllowed: rule.maxPerParent,
    cumulativeCeiling,
    text,
  };
}

export interface ExtensionRequestFacts {
  amount: string | null;
  currency: string | null;
  durationDays: number | null;
  maxSites: number | null;
  /** Scope lines ("What this authorizes"). */
  scopeItems: readonly string[];
  /** Parent targets the extension re-tests, with their latest result (null = no data). */
  retestTargets: readonly { name: string; result: 'met' | 'not_met' | 'inconclusive' | null }[];
}

export interface ExtensionContext {
  rule: ExtensionRule;
  parent: ExtensionParentFacts;
  /** Other extensions of the same parent that are not withdrawn. */
  otherExtensions: number;
  /** An illustrative (training) tenant keeps a null cap as a submittable placeholder. */
  illustrative: boolean;
}

export interface RuleViolation {
  key: 'extension_cap_required' | 'extension_within_rule' | 'one_extension_per_parent';
  message: string;
}

/** Scope lines that would widen the parent scope: new sites or prospect outreach (D-110 §1). */
const WIDENING = /\b(new sites?|additional sites?|more sites|outreach|prospects?)\b/i;
const NEGATED = /^\s*(no|not|never|without)\b/i;

/**
 * Every way an extension request breaks the rule, in order: one per parent, a stated cap and
 * duration (real tenants), share of budget, share of window, minimum duration, scope subset, re-tested
 * thresholds. Empty = within the rule. Placeholders (illustrative tenants) skip the share checks.
 */
export function checkExtensionRequest(ctx: ExtensionContext, req: ExtensionRequestFacts): RuleViolation[] {
  const out: RuleViolation[] = [];
  const { rule, parent } = ctx;
  if (ctx.otherExtensions >= rule.maxPerParent)
    out.push({
      key: 'one_extension_per_parent',
      message: `One extension per pilot: this pilot already has ${ctx.otherExtensions === 1 ? 'an extension' : `${ctx.otherExtensions} extensions`}. A bigger ask or a second extension is a new G2 with a full package and finance review.`,
    });
  const placeholder = req.amount === null || req.durationDays === null;
  if (placeholder && !ctx.illustrative && rule.capRequiredInRealTenants)
    out.push({ key: 'extension_cap_required', message: 'State the extension cap and duration' });
  const limits = extensionLimits(rule, parent, ctx.otherExtensions, null);
  const amount = dec(req.amount);
  if (amount !== null && limits) {
    if (req.currency !== null && req.currency !== limits.currency)
      out.push({
        key: 'extension_within_rule',
        message: `The extension is in ${req.currency}; the pilot budget is in ${limits.currency}.`,
      });
    else if (amount.gt(limits.maxAmount))
      out.push({
        key: 'extension_within_rule',
        message: `The extension asks ${formatMoneyShort(amount.toFixed(2), limits.currency)}; the rule allows up to ${formatMoneyShort(limits.maxAmount, limits.currency)} (${pctText(rule.maxBudgetShare)}% of ${formatMoneyShort(limits.parentAmount, limits.currency)}).`,
      });
  }
  if (req.durationDays !== null) {
    if (limits && limits.maxDurationDays !== null && req.durationDays > limits.maxDurationDays)
      out.push({
        key: 'extension_within_rule',
        message: `The extension asks ${req.durationDays} days; the rule allows up to ${limits.maxDurationDays} days (${pctText(rule.maxDurationShare)}% of the ${parent.durationDays}-day pilot).`,
      });
    if (req.durationDays < rule.minDurationDays)
      out.push({
        key: 'extension_within_rule',
        message: `An extension runs at least ${rule.minDurationDays} days.`,
      });
  }
  if (req.maxSites !== null && parent.maxSites !== null && req.maxSites > parent.maxSites)
    out.push({
      key: 'extension_within_rule',
      message: `The extension covers the same or fewer sites: up to ${parent.maxSites}, no new sites.`,
    });
  const widening = req.scopeItems.find((s) => WIDENING.test(s) && !NEGATED.test(s));
  if (widening)
    out.push({
      key: 'extension_within_rule',
      message: `The extension scope is a subset of the pilot: no new sites and no prospect outreach ("${widening}").`,
    });
  if (req.retestTargets.length === 0)
    out.push({
      key: 'extension_within_rule',
      message: 'Name the unmet or inconclusive thresholds the extension re-tests.',
    });
  const met = req.retestTargets.filter((t) => t.result === 'met');
  if (met.length > 0)
    out.push({
      key: 'extension_within_rule',
      message: `An extension re-tests unmet or inconclusive thresholds only (${met.map((t) => t.name).join(', ')} met).`,
    });
  return out;
}
