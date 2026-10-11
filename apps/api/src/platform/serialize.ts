/**
 * Row → contract helpers. Postgres timestamptz arrives as Date and date as 'YYYY-MM-DD' strings
 * (packages/db sets the DATE parser), even where generated types say Date.
 */
import type { PersonRef } from '@growth-os/contracts';

export function isoDateTime(v: Date | string): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

export function isoDateTimeOrNull(v: Date | string | null | undefined): string | null {
  return v === null || v === undefined ? null : isoDateTime(v);
}

export function isoDate(v: Date | string): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

export function isoDateOrNull(v: Date | string | null | undefined): string | null {
  return v === null || v === undefined ? null : isoDate(v);
}

export interface UserRowLike {
  id: string;
  display_name: string;
  title: string | null;
  initials: string;
}

export function personRef(u: UserRowLike): PersonRef {
  return { id: u.id, displayName: u.display_name, title: u.title, initials: u.initials };
}
