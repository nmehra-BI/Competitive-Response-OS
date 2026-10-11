/**
 * People for pickers: the tenant directory (`people.list`, D-079). Pickers offer people who can own
 * work, so a person whose only role is tenant administrator is left out (admins configure, never own).
 */
import { API, type PersonRef } from '@growth-os/contracts';
import { useApiQuery } from './query';

export function usePeople(): {
  people: PersonRef[];
  byId: (id: string | null | undefined) => PersonRef | null;
} {
  const q = useApiQuery(API.directory.people, { query: {} }, { staleTime: 10 * 60_000 });
  const all = q.data?.items ?? [];
  const people: PersonRef[] = all
    .filter((p) => p.roles.some((r) => r !== 'tenant_admin'))
    .map(({ id, displayName, title, initials }) => ({ id, displayName, title, initials }));
  const known = new Map(all.map((p) => [p.id, p]));
  return {
    people,
    byId: (id) => {
      const p = id ? known.get(id) : undefined;
      return p ? { id: p.id, displayName: p.displayName, title: p.title, initials: p.initials } : null;
    },
  };
}
