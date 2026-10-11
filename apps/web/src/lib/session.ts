/** Viewer session helpers. The SPA never sees tokens: the session is an httpOnly cookie (FRONTEND §9). */
import { API, type Viewer } from '@growth-os/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, ApiProblem } from './api-client';
import { invalidateAfter, useApiQuery } from './query';

export function useViewer() {
  return useApiQuery(API.auth.me, {}, { staleTime: 5 * 60_000, retry: false });
}

export function isUnauthenticated(err: unknown): boolean {
  return err instanceof ApiProblem && err.code === 'UNAUTHENTICATED';
}

/** End the session and clear every cached query (no restricted content survives a persona switch). */
export function useLogout() {
  const qc = useQueryClient();
  return useCallback(async () => {
    try {
      await api(API.auth.logout);
    } finally {
      await invalidateAfter(qc, API.auth.logout.id);
    }
  }, [qc]);
}

export function initialsOf(v: Viewer): string {
  return v.person.initials;
}
