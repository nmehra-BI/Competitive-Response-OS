/**
 * Auth and viewer (API.md §2, D-017): dev persona picker, dev login, logout, GET /me.
 * The dev routes are registered only when AUTH_MODE=dev (server.ts) and only ever answer for
 * illustrative tenants (migration 0002 functions). Login and logout are audited.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { API, type DevPersona, type RoleCode } from '@growth-os/contracts';
import { auditWriter, withTenant, type Tx } from '@growth-os/db';
import { signedIn } from '../../../platform/authz';
import type { PlatformDeps } from '../../../platform/context';
import { ApiError } from '../../../platform/errors';
import { loadIdentity, landingFor, toViewer } from '../../../platform/identity';
import { deps, parseInput, query, type HandlerMap } from '../../../platform/pipeline';
import { personRef } from '../../../platform/serialize';
import {
  devLoginTenant,
  illustrativeTenantId,
  insertSession,
  resolveSession,
  revokeSession,
} from '../../../platform/session';

/** Roles offered in the persona picker (the six Aster personas), then the tenant administrator. */
const PERSONA_ROLES: readonly RoleCode[] = [
  'sponsor',
  'case_owner',
  'finance_reviewer',
  'pilot_owner',
  'commercial_reviewer',
  'product_reviewer',
  'specialist_reviewer',
  'investment_committee',
];

function setSessionCookie(reply: FastifyReply, d: PlatformDeps, token: string, expires: Date): void {
  void reply.setCookie(d.config.cookieName, token, {
    httpOnly: true,
    secure: d.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    expires,
  });
}

function clearSessionCookie(reply: FastifyReply, d: PlatformDeps): void {
  void reply.clearCookie(d.config.cookieName, {
    httpOnly: true,
    secure: d.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
  });
}

async function auditSession(
  tx: Tx,
  action: 'auth.session_started' | 'auth.session_ended',
  userId: string,
  sessionId: string,
  now: Date,
  method: string,
): Promise<void> {
  await auditWriter.record(tx, {
    actorUserId: userId,
    actorKind: 'human',
    actorRole: null,
    action,
    objectType: 'session',
    objectId: sessionId,
    objectVersion: null,
    caseId: null,
    beforeHash: null,
    afterHash: null,
    summary: action === 'auth.session_started' ? 'Signed in' : 'Signed out',
    details: { method },
    authz: {
      decision: 'allow',
      rule: action === 'auth.session_started' ? 'dev_login' : 'session_owner',
      authorityGrantId: null,
    },
    occurredAt: now,
  });
}

async function listDevPersonas(req: FastifyRequest): Promise<unknown> {
  const d = deps(req);
  const tenantId = await illustrativeTenantId(d.db, d.config.devTenantSlug);
  if (!tenantId) throw new ApiError('NOT_FOUND', 'No illustrative workspace is seeded. Run pnpm db:seed.');
  return withTenant(d.db, { tenantId, userId: null, correlationId: req.id }, async (tx) => {
    const tenant = await tx.selectFrom('platform.tenant').select('name').executeTakeFirstOrThrow();
    const users = await tx
      .selectFrom('platform.app_user')
      .selectAll()
      .where('kind', '=', 'human')
      .where('is_active', '=', true)
      .orderBy('created_at')
      .orderBy('email')
      .execute();
    const roles = await tx
      .selectFrom('platform.role_assignment')
      .select([
        'id',
        'user_id',
        'role',
        'business_unit_id',
        'case_id',
        'granted_by',
        'granted_at',
        'revoked_at',
      ])
      .where('revoked_at', 'is', null)
      .execute();
    const byUser = new Map<string, RoleCode[]>();
    for (const r of roles) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role as RoleCode]);
    const toPersona = (u: (typeof users)[number]): DevPersona => {
      const userRoles = byUser.get(u.id) ?? [];
      return {
        userId: u.id,
        person: personRef(u),
        roleSummary: u.title ?? userRoles.join(' · '),
        landing: landingFor(
          userRoles.map((role) => ({
            id: u.id,
            userId: u.id,
            role,
            businessUnitId: null,
            caseId: null,
            grantedBy: u.id,
            grantedAt: new Date(0).toISOString(),
            revokedAt: null,
          })),
        ),
      };
    };
    const personas = users.filter((u) => (byUser.get(u.id) ?? []).some((r) => PERSONA_ROLES.includes(r)));
    const admins = users.filter(
      (u) => !personas.includes(u) && (byUser.get(u.id) ?? []).includes('tenant_admin'),
    );
    return API.auth.listDevPersonas.response.parse({
      tenantName: tenant.name,
      personas: [...personas, ...admins].map(toPersona),
    });
  });
}

async function devLogin(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const d = deps(req);
  const { body } = await parseInput(API.auth.devLogin, req, false);
  const tenantId = await devLoginTenant(d.db, body.userId);
  if (!tenantId) throw new ApiError('NOT_FOUND', 'Not found');
  const now = d.now();

  // Switching persona ends the previous session.
  const previous = await resolveSession(d.db, req.cookies[d.config.cookieName]);
  if (previous) {
    await withTenant(
      d.db,
      { tenantId: previous.tenantId, userId: previous.userId, correlationId: req.id },
      async (tx) => {
        if (await revokeSession(tx, previous, now))
          await auditSession(
            tx,
            'auth.session_ended',
            previous.userId,
            previous.sessionId,
            now,
            'persona_switch',
          );
      },
    );
  }

  const { viewer, token, expiresAt } = await withTenant(
    d.db,
    { tenantId, userId: body.userId, correlationId: req.id },
    async (tx) => {
      const user = await tx
        .selectFrom('platform.app_user')
        .select(['id', 'kind'])
        .where('id', '=', body.userId)
        .executeTakeFirstOrThrow();
      if (user.kind !== 'human')
        throw new ApiError('AGENT_IDENTITY_FORBIDDEN', 'Agents and services cannot sign in.');
      const s = await insertSession(tx, {
        tenantId,
        userId: user.id,
        method: 'dev_persona',
        interactive: true,
        ttlMs: d.config.sessionTtlMs,
        now,
      });
      await auditSession(tx, 'auth.session_started', user.id, s.session.sessionId, now, 'dev_persona');
      const identity = await loadIdentity(tx, s.session);
      if (!identity) throw new ApiError('INTERNAL', 'Unexpected error');
      return { viewer: toViewer(identity), token: s.token, expiresAt: s.expiresAt };
    },
  );
  setSessionCookie(reply, d, token, expiresAt);
  return API.auth.devLogin.response.parse(viewer);
}

async function logout(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const d = deps(req);
  await parseInput(API.auth.logout, req, false);
  const session = await resolveSession(d.db, req.cookies[d.config.cookieName]);
  clearSessionCookie(reply, d);
  if (!session) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue.');
  const now = d.now();
  await withTenant(
    d.db,
    { tenantId: session.tenantId, userId: session.userId, correlationId: req.id },
    async (tx) => {
      if (await revokeSession(tx, session, now))
        await auditSession(tx, 'auth.session_ended', session.userId, session.sessionId, now, 'logout');
    },
  );
  return undefined;
}

export const authHandlers: HandlerMap = {
  [API.auth.listDevPersonas.id]: listDevPersonas,
  [API.auth.devLogin.id]: devLogin,
  [API.auth.logout.id]: logout,
  [API.auth.me.id]: query(API.auth.me, {
    authorize: () => signedIn,
    handle: async (ctx) => toViewer(ctx.identity),
  }),
};
