/**
 * Development persona picker (AUTH_MODE=dev, D-017). Pilot-only: production uses single sign-on.
 * Signing in clears every cached query, so nothing from a previous persona survives.
 */
import { API, type DevPersona } from '@growth-os/contracts';
import { Avatar, Icon, IllustrativeDataBar, Skeleton } from '@growth-os/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api-client';
import { invalidateAfter, useApiQuery } from '../../lib/query';
import { ProblemBanner } from '../shell/ProblemBanner';

/** Only same-app relative paths are followed after sign-in (no open redirects). */
export function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : null;
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const personas = useApiQuery(API.auth.listDevPersonas, {}, { retry: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    document.title = 'Sign in · Market Expansion';
  }, []);
  const signIn = async (p: DevPersona) => {
    setBusy(p.userId);
    setError(null);
    try {
      await api(API.auth.devLogin, { body: { userId: p.userId } });
      await invalidateAfter(qc, API.auth.devLogin.id);
      navigate(safeNext(params.get('next')) ?? p.landing, { replace: true });
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };
  return (
    <div className="app-root">
      <IllustrativeDataBar tenantName={personas.data?.tenantName} />
      <main className="login" id="main">
        <div className="login__card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <span aria-hidden="true" className="app-switcher__mark">
              <Icon name="compass" size={16} strokeWidth={1.8} />
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
              Growth OS{personas.data ? ` · ${personas.data.tenantName}` : ''}
            </span>
          </div>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: '32px', fontWeight: 600 }}>
            Sign in to Market Expansion
          </h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 13.5 }}>
            Choose a person to work as. This development sign-in is for the pilot only; production uses your
            company’s single sign-on.
          </p>
          {error ? (
            <div style={{ marginTop: 16 }}>
              <ProblemBanner error={error} />
            </div>
          ) : null}
          {personas.error ? (
            <div style={{ marginTop: 16 }}>
              <ProblemBanner error={personas.error} />
            </div>
          ) : null}
          <ul className="login__list" aria-label="People" aria-busy={personas.isPending}>
            {personas.isPending
              ? [1, 2, 3].map((i) => (
                  <li key={i}>
                    <Skeleton height={58} />
                  </li>
                ))
              : personas.data?.personas.map((p) => (
                  <li key={p.userId}>
                    <button
                      type="button"
                      className="login__persona"
                      onClick={() => signIn(p)}
                      disabled={busy !== null}
                      aria-describedby={`persona-${p.userId}`}
                    >
                      <Avatar initials={p.person.initials} size={32} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
                          {p.person.displayName}
                        </span>
                        <span
                          id={`persona-${p.userId}`}
                          style={{ display: 'block', fontSize: 12.5, color: 'var(--text-secondary)' }}
                        >
                          {p.roleSummary}
                        </span>
                      </span>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 12.5 }} aria-hidden="true">
                        {busy === p.userId ? 'Signing in…' : <Icon name="chevr" size={16} />}
                      </span>
                    </button>
                  </li>
                ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
