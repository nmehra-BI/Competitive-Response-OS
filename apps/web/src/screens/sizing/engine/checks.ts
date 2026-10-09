// PORT (WS8b): verbatim copy of the WS2 domain engine (branch worktree-agent-aa0d31ef83422e2fc @ e0958a5),
// imports adjusted only. Delete this folder when @growth-os/domain ships the engines; see ./adapter.ts.
/** Calculation-check collector shared by the sizing and economics engines. */
import type { CalcCheck, EngineInput } from '@growth-os/contracts';
import { dec, inUnitInterval, isWholeNonNegative } from './numeric';

export class CheckList {
  private readonly items: CalcCheck[] = [];

  add(key: CalcCheck['key'], blocking: boolean, message: string, inputKeys: readonly string[]): void {
    this.items.push({ key, blocking, message, inputKeys: [...inputKeys] });
  }

  block(key: CalcCheck['key'], message: string, inputKeys: readonly string[]): void {
    this.add(key, true, message, inputKeys);
  }

  get blocked(): boolean {
    return this.items.some((c) => c.blocking);
  }

  /** True when a blocking check names any of these input keys. */
  blocksAny(inputKeys: readonly string[]): boolean {
    return this.items.some((c) => c.blocking && c.inputKeys.some((k) => inputKeys.includes(k)));
  }

  list(): CalcCheck[] {
    return [...this.items];
  }
}

/** Currency and price-year agreement for an input that carries money. */
export function checkMoneyInput(
  checks: CheckList,
  input: EngineInput,
  currency: string,
  priceYear: number,
  normalizeHint: string,
): void {
  if (input.currency === null) {
    checks.block('MISSING_INPUT', `${input.label} has no currency. ${normalizeHint}`, [input.inputKey]);
  } else if (input.currency !== currency) {
    checks.block(
      'CURRENCY_MISMATCH',
      `${input.label} is in ${input.currency}; the model uses ${currency}. ${normalizeHint}`,
      [input.inputKey],
    );
  }
  checkPriceYear(checks, input, priceYear, normalizeHint);
}

/** Price year agreement for any input that states one. */
export function checkPriceYear(
  checks: CheckList,
  input: EngineInput,
  priceYear: number,
  normalizeHint: string,
): void {
  if (input.priceYear !== null && input.priceYear !== priceYear) {
    checks.block(
      'PRICE_YEAR_MISMATCH',
      `${input.label} uses ${input.priceYear} prices; the model uses ${priceYear} prices. ${normalizeHint}`,
      [input.inputKey],
    );
  }
}

export function checkUnit(checks: CheckList, input: EngineInput, expected: readonly string[]): void {
  if (!expected.includes(input.unit)) {
    checks.block(
      'UNIT_MISMATCH',
      `${input.label} is counted in ${input.unit.replaceAll('_', ' ')}; expected ${expected
        .map((u) => u.replaceAll('_', ' '))
        .join(' or ')}.`,
      [input.inputKey],
    );
  }
}

export function checkRate(checks: CheckList, input: EngineInput): void {
  if (!inUnitInterval(dec(input.value))) {
    checks.block('RATE_OUT_OF_RANGE', `${input.label} must be between 0% and 100%.`, [input.inputKey]);
  }
}

export function checkWholeCount(checks: CheckList, input: EngineInput): void {
  if (!isWholeNonNegative(dec(input.value))) {
    checks.block('UNIT_MISMATCH', `${input.label} must be a whole, non-negative count.`, [input.inputKey]);
  }
}

export function checkCapacity(checks: CheckList, input: EngineInput): void {
  const v = dec(input.value);
  if (v.isNegative()) {
    checks.block('CAPACITY_NEGATIVE', `${input.label} cannot be negative.`, [input.inputKey]);
  } else if (!v.isInteger()) {
    checks.block('UNIT_MISMATCH', `${input.label} must be a whole number of customers.`, [input.inputKey]);
  }
}
