/**
 * Date display for the WS8d screens (Europe/Berlin, en-GB as in the prototype): "27 Nov 2026",
 * "27 Nov", "5 Mar 2027, 11:20". Numbers and money never go through here: they use
 * @growth-os/ui format.
 */
const TZ = 'Europe/Berlin';

function parse(iso: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
}

export function fmtDate(iso: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!iso) return '—';
  return parse(iso)
    .toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(opts.year === false ? {} : { year: 'numeric' }),
      timeZone: TZ,
    })
    .replace('Sept', 'Sep');
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = parse(iso);
  const date = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: TZ,
  });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TZ,
  });
  return `${date.replace('Sept', 'Sep')}, ${time}`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return parse(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: TZ,
  });
}

/** "1 Dec 2026 – 28 Feb 2027" or "1 Dec–28 Feb" (short). */
export function fmtPeriod(start: string, end: string, short = false): string {
  return short
    ? `${fmtDate(start, { year: false })}–${fmtDate(end, { year: false })}`
    : `${fmtDate(start)} – ${fmtDate(end)}`;
}
