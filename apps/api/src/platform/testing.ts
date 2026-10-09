/**
 * Test helpers for API integration tests (any stream). Each test file seeds its own ISOLATED copies
 * of the Aster fixture (fresh ids, same data), so suites never collide and cross-tenant attempts are
 * easy: seed two tenants, log in to one, address the other's ids.
 *
 *   const t = await createTestApp({ handlers });
 *   const a = await seedTenant(t.db);               // isolated aster-start
 *   const maya = await login(t.app, a.user('maya'));
 *   const res = await call(t.app, API.auth.me, { cookie: maya });
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { z } from 'zod';
import { API, API_PREFIX, HEADERS, type EndpointDef } from '@growth-os/contracts';
import { createDb, createObjectStore, type Db, type ObjectStore } from '@growth-os/db';
import { seedAster, type SeedProfile, type SeedResult } from '@growth-os/db/seed';
import { people } from '@growth-os/fixtures-aster';
import type { HandlerMap } from './pipeline';
import { buildServer } from './server';

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  objects: ObjectStore;
  close(): Promise<void>;
}

export async function createTestApp(
  opts: {
    handlers?: HandlerMap;
    endpoints?: readonly EndpointDef[];
    authMode?: 'dev' | 'oidc';
    now?: () => Date;
  } = {},
): Promise<TestApp> {
  const { handlers: allHandlers } = await import('../modules');
  const db = createDb('app', 4);
  const dir = await mkdtemp(join(tmpdir(), 'gos-objects-'));
  const objects = createObjectStore(dir);
  const app = await buildServer({
    handlers: opts.handlers ?? allHandlers,
    endpoints: opts.endpoints,
    authMode: opts.authMode ?? 'dev',
    deps: { db, objects, now: opts.now },
  });
  return {
    app,
    db,
    objects,
    async close() {
      await app.close();
      await db.destroy();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export type PersonKey = keyof typeof people;

export interface SeededTenant extends SeedResult {
  user(key: PersonKey): string;
}

/** Seed an isolated copy of Aster (fresh ids) and return id helpers. */
export async function seedTenant(db: Db, profile: SeedProfile = 'aster-start'): Promise<SeededTenant> {
  const r = await seedAster(db, { profile, isolated: true });
  return { ...r, user: (key) => r.id(people[key].id) };
}

/** Dev-login as a user; returns the Cookie header value. */
export async function login(app: FastifyInstance, userId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}${API.auth.devLogin.path}`,
    payload: { userId },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
  return raw.split(';')[0]!;
}

export interface CallOptions<D extends EndpointDef> {
  params?: z.input<D['params']>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  cookie?: string;
  /** `true` generates a fresh key. */
  idempotencyKey?: string | true;
  ifMatch?: number | string;
  headers?: Record<string, string>;
}

export function pathOf(def: EndpointDef, params: Record<string, unknown> = {}): string {
  return `${API_PREFIX}${def.path.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(String(params[k] ?? '')))}`;
}

export async function call<D extends EndpointDef>(
  app: FastifyInstance,
  def: D,
  o: CallOptions<D> = {},
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { ...o.headers };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.idempotencyKey)
    headers[HEADERS.idempotencyKey] = o.idempotencyKey === true ? randomUUID() : o.idempotencyKey;
  if (o.ifMatch !== undefined)
    headers[HEADERS.ifMatch] = typeof o.ifMatch === 'number' ? `"${o.ifMatch}"` : o.ifMatch;
  const query = Object.fromEntries(
    Object.entries(o.query ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
  return app.inject({
    method: def.method,
    url: pathOf(def, o.params as Record<string, unknown> | undefined),
    query,
    headers,
    ...(o.body !== undefined ? { payload: o.body as object } : {}),
  });
}
