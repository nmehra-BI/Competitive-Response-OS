/**
 * Amount entry for one-time pilot money (S11 "Record spend", task budget lines). Amounts travel as
 * decimal strings with two fraction digits; the browser never does float arithmetic on money.
 * Group separators (",", " ", "’") are accepted while typing; anything else is refused (null).
 */
export function parseAmount(input: string): string | null {
  const s = input.trim().replace(/[,\s’']/g, '');
  const m = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const int = m[1]!.replace(/^0+(?=\d)/, '');
  return `${int}.${(m[2] ?? '').padEnd(2, '0')}`;
}

/** True for a positive amount ("0.00" is not an amount someone spent). */
export function isPositiveAmount(amount: string | null): amount is string {
  return amount !== null && /[1-9]/.test(amount);
}
