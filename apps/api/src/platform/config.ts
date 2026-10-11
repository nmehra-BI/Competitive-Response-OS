/** Runtime configuration read once from the environment (see .env.example). */
export interface PlatformConfig {
  authMode: 'dev' | 'oidc';
  /** Slug of the illustrative tenant offered by the dev persona picker. */
  devTenantSlug: string;
  sessionTtlMs: number;
  cookieName: string;
  /** `Secure` cookie attribute. Browsers accept Secure cookies on http://localhost. */
  cookieSecure: boolean;
  idempotencyTtlMs: number;
  /** Upload size limit for evidence files. */
  maxUploadBytes: number;
  /** Validate every response against the endpoint schema and strip unknown fields. */
  validateResponses: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PlatformConfig {
  return {
    authMode: env.AUTH_MODE === 'dev' ? 'dev' : 'oidc',
    devTenantSlug: env.DEV_TENANT_SLUG ?? 'aster-industrial',
    sessionTtlMs: Number(env.SESSION_TTL_MS ?? 12 * 60 * 60 * 1000),
    cookieName: 'gos_session',
    cookieSecure: env.COOKIE_SECURE !== 'false',
    idempotencyTtlMs: 24 * 60 * 60 * 1000,
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024),
    validateResponses: true,
  };
}
