/**
 * Output checks applied after schema validation and before anything is stored (ARCHITECTURE §12.4).
 *
 *  - Citations: every cited id must have been returned by a tool in THIS run. Others are removed;
 *    an "evidence" claim left without a valid citation is downgraded to `unknown` (an unsupported
 *    hypothesis, never kept as evidence). AI never produces `scenario` or `actual` claims.
 *  - Unsupported precision: a precise figure (3+ significant digits or decimals, not a year) that
 *    appears in no engine result and no returned passage is not a fact: the claim is downgraded to
 *    `unknown` and the figure is listed under unknowns. Numbers come from engine tool calls.
 *  - Outcome recommendations are marked "Recommendation · not a decision" (never-rule 1).
 */
import type { ProposalPayload, ProposedClaim, SkillOutput } from '@growth-os/contracts';

export const NOT_A_DECISION = 'Recommendation · not a decision.';

export interface CheckReport {
  output: SkillOutput;
  citationsRemoved: number;
  claimsDowngraded: number;
  unsupportedFigures: string[];
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const DISPLAY_KEY = /\b[A-Z]{1,5}(-[A-Z0-9]{1,6})+\b/g;
const NUMBER = /(?<![\w.])\d[\d,]*(?:\.\d+)?%?/g;

function normalize(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : 'NaN';
}

function tokens(text: string): { raw: string; values: string[]; precise: boolean }[] {
  const clean = text.replace(UUID, ' ').replace(DISPLAY_KEY, ' ');
  const out: { raw: string; values: string[]; precise: boolean }[] = [];
  for (const m of clean.matchAll(NUMBER)) {
    const raw = m[0].replace(/[,]+$/, '');
    const pct = raw.endsWith('%');
    const plain = raw.replace(/[,%]/g, '');
    const n = Number(plain);
    if (!Number.isFinite(n)) continue;
    const digits = plain
      .replace(/[^0-9]/g, '')
      .replace(/^0+/, '')
      .replace(/0+$/, '');
    const isYear = /^(19|20)\d{2}$/.test(plain);
    const hasDecimal = plain.includes('.') && !/\.0+$/.test(plain);
    const precise = !isYear && (digits.length >= 3 || hasDecimal);
    const values = pct ? [normalize(n), normalize(n / 100)] : [normalize(n), normalize(n * 100)];
    out.push({ raw, values, precise });
  }
  return out;
}

/** Numbers that the run actually saw (engine results, returned passages, case context). */
export function supportedNumbers(texts: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const t of texts) for (const tok of tokens(t)) tok.values.forEach((v) => set.add(v));
  return set;
}

export function unsupportedFigures(text: string, supported: ReadonlySet<string>): string[] {
  return tokens(text)
    .filter((t) => t.precise && !t.values.some((v) => supported.has(v)))
    .map((t) => t.raw);
}

function checkClaim(
  claim: ProposedClaim,
  returned: ReadonlySet<string>,
  supported: ReadonlySet<string>,
  report: { citationsRemoved: number; claimsDowngraded: number; figures: string[] },
): ProposedClaim {
  const valid = claim.evidenceIds.filter((id) => returned.has(id));
  report.citationsRemoved += claim.evidenceIds.length - valid.length;
  let kind = claim.kind;
  if (kind === 'scenario' || kind === 'actual') kind = 'inference_ai';
  if (kind === 'evidence' && valid.length === 0) kind = 'unknown';
  const figures = unsupportedFigures(claim.statement, supported);
  if (figures.length > 0 && kind !== 'assumption') {
    kind = 'unknown';
    report.figures.push(...figures);
  }
  if (kind !== claim.kind) report.claimsDowngraded++;
  return { ...claim, kind, evidenceIds: valid, confidenceNote: null };
}

export function checkOutput(
  output: SkillOutput,
  returnedIds: ReadonlySet<string>,
  supportTexts: readonly string[],
): CheckReport {
  const supported = supportedNumbers(supportTexts);
  const r = { citationsRemoved: 0, claimsDowngraded: 0, figures: [] as string[] };
  const filterIds = (ids: string[]) => {
    const valid = ids.filter((id) => returnedIds.has(id));
    r.citationsRemoved += ids.length - valid.length;
    return valid;
  };
  const flagText = (...texts: string[]) => {
    for (const t of texts) r.figures.push(...unsupportedFigures(t, supported));
  };
  const proposals = output.proposals.map((p): ProposalPayload => {
    switch (p.type) {
      case 'claim':
        return { ...p, claim: checkClaim(p.claim, returnedIds, supported, r) };
      case 'opportunity_candidate':
        flagText(p.trigger, p.fitRationale);
        return { ...p, evidenceIds: filterIds(p.evidenceIds) };
      case 'assumption_value':
        return { ...p, evidenceIds: filterIds(p.evidenceIds) };
      case 'outcome_review_draft':
        flagText(...p.whatWeLearned);
        return p.rationale.startsWith(NOT_A_DECISION)
          ? p
          : { ...p, rationale: `${NOT_A_DECISION} ${p.rationale}` };
      default:
        return p;
    }
  });
  const figures = [...new Set(r.figures)];
  const unknowns = [
    ...output.unknowns,
    ...figures.map((f) => `Unsupported figure "${f}": no engine result or cited source gives it`),
  ];
  return {
    output: { ...output, proposals, unknowns },
    citationsRemoved: r.citationsRemoved,
    claimsDowngraded: r.claimsDowngraded,
    unsupportedFigures: figures,
  };
}
