/**
 * Date display for the WS8c screens. Times show in the tenant's zone (Aster: Europe/Berlin; the
 * contracts carry no tenant time zone yet), dates as "27 Nov" / "11 Dec 2026", times as "09:14".
 * Plain ISO dates (YYYY-MM-DD) are calendar dates and are never shifted by a time zone.
 */
export const TENANT_TIME_ZONE = 'Europe/Berlin';

const fmt = (opts: Intl.DateTimeFormatOptions, tz = TENANT_TIME_ZONE) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts });

function asInstant(value: string): { date: Date; tz: string } {
  // "2026-11-20" is a calendar date: format it in UTC so it never moves a day.
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { date: new Date(`${value}T00:00:00Z`), tz: 'UTC' }
    : { date: new Date(value), tz: TENANT_TIME_ZONE };
}

/** "27 Nov" */
export function dayMonth(value: string): string {
  const { date, tz } = asInstant(value);
  return fmt({ day: 'numeric', month: 'short' }, tz).format(date);
}

/** "11 Dec 2026" */
export function fullDate(value: string): string {
  const { date, tz } = asInstant(value);
  return fmt({ day: 'numeric', month: 'short', year: 'numeric' }, tz).format(date);
}

/** "27 Nov, 09:14" */
export function dayTime(value: string): string {
  const d = new Date(value);
  const time = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${dayMonth(value)}, ${time}`;
}

/** "16 Oct 2026, 15:02" */
export function fullDateTime(value: string): string {
  const d = new Date(value);
  const time = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${fullDate(value)}, ${time}`;
}

/** "19 Oct – 13 Nov" (en dash, spaced, as in the prototype). */
export function dateRange(start: string, end: string): string {
  return `${dayMonth(start)} – ${dayMonth(end)}`;
}

/** "19 Oct–20 Nov" (unspaced, for measured periods). */
export function period(start: string, end: string): string {
  return `${dayMonth(start)}–${dayMonth(end)}`;
}
