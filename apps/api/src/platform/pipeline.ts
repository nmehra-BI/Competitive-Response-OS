/**
 * The command pipeline (ARCHITECTURE.md §6). Every module handler is built with `command()` (writes)
 * or `query()` (reads). The steps, in order:
 *
 *   1. session      cookie → live session (401 UNAUTHENTICATED); identity loaded under RLS
 *   2. validate     params / query / body with the endpoint's Zod schemas (400 VALIDATION_FAILED)
 *   3. human        `auth: 'human'` endpoints need an interactive human (403 AGENT_IDENTITY_FORBIDDEN)
 *   4. headers      If-Match parsed (428 when required and missing); Idempotency-Key begun
 *                   (428 missing · 409 IDEMPOTENCY_IN_PROGRESS · 422 IDEMPOTENCY_KEY_REUSED · replay)
 *   5. transaction  withTenant(): load(ctx, tx) → authorize(ctx, facts) → handle(ctx, tools, facts)
 *                   tools.audit / tools.analytics / tools.enqueue write in the SAME transaction
 *   6. invariants   a command that wrote no audit event is refused (500, rolled back)
 *   7. response     validated and stripped by the endpoint's response schema; idempotent response
 *                   stored in the same transaction; key released if anything failed
 *
 * See docs/market-expansion/build/notes/WS1.md "Command pipeline" for a usage example.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  HEADERS,
  type AnalyticsEventName,
  type AnalyticsProps,
  type CaseStage,
  type DomainEvent,
  type EndpointDef,
} from '@growth-os/contracts';
import { auditWriter, enqueueJob, withTenant, type Tx } from '@growth-os/db';
import type { Allowed, Authorization, Identity, PlatformDeps, SessionRef, UploadedFile } from './context';
import { ApiError, zodFieldErrors } from './errors';
import { sha256Hex, stableStringify, stateHash } from './hash';
import { beginIdempotent, completeIdempotent, releaseIdempotent } from './idempotency';
import { loadIdentity } from './identity';
import { resolveSession } from './session';

export type Handler = (req: FastifyRequest, reply: FastifyReply, def: EndpointDef) => Promise<unknown>;
export type HandlerMap = Readonly<Record<string, Handler>>;

export type Params<D extends EndpointDef> = z.output<D['params']>;
export type Query<D extends EndpointDef> = z.output<D['query']>;
export type Body<D extends EndpointDef> = z.output<D['body']>;
/** What a handler returns: the endpoint's response *input* type (it is parsed before sending). */
export type Result<D extends EndpointDef> = z.input<D['response']>;

export interface Ctx<D extends EndpointDef> {
  def: D;
  params: Params<D>;
  query: Query<D>;
  body: Body<D>;
  files: readonly UploadedFile[];
  identity: Identity;
  tenantId: string;
  userId: string;
  correlationId: string;
  now: Date;
  deps: PlatformDeps;
  idempotencyKey: string | null;
  /** Parsed If-Match row version, or null when the endpoint does not declare If-Match. */
  ifMatch: number | null;
  setHeader(name: string, value: string): void;
  /** Sets `ETag: "<rowVersion>"` for draft resources. */
  setETag(rowVersion: number): void;
}

export interface AuditInput {
  action: string;
  objectType: string;
  objectId: string;
  objectVersion?: number | null;
  caseId?: string | null;
  /** Business summary. Never source text, account details or confidential inputs. */
  summary: string;
  details?: Record<string, string | number | boolean | null>;
  /** Object state before/after; only their SHA-256 is stored. */
  before?: unknown;
  after?: unknown;
}

export interface AnalyticsTarget {
  objectType: string;
  objectId: string;
  objectVersion?: number | null;
  caseId?: string | null;
  stage?: CaseStage | null;
}

export interface ReadTools {
  tx: Tx;
  authz: Allowed;
}

export interface Tools extends ReadTools {
  audit(input: AuditInput): Promise<void>;
  analytics<N extends AnalyticsEventName>(
    name: N,
    target: AnalyticsTarget,
    props: z.input<(typeof AnalyticsProps)[N]>,
  ): Promise<void>;
  /** Enqueue a worker job in this transaction (tenantId and correlationId are added). */
  enqueue(
    name: string,
    payload?: Record<string, unknown>,
    opts?: { runAt?: Date; jobKey?: string },
  ): Promise<string>;
  emit(event: DomainEvent): Promise<void>;
}

interface SpecBase<D extends EndpointDef, F> {
  /** Load the resource facts the policy needs (never trust the client for them). */
  load?: (ctx: Ctx<D>, tx: Tx) => Promise<F>;
  /** Decide. Deny → ApiError(code, reason). Hidden resources must deny with NOT_FOUND. */
  authorize: (ctx: Ctx<D>, facts: F) => Authorization | Promise<Authorization>;
  /** Accept multipart/form-data (field `metadata` holds the JSON body; file parts become `files`). */
  multipart?: boolean;
}

export interface QuerySpec<D extends EndpointDef, F = undefined> extends SpecBase<D, F> {
  handle: (ctx: Ctx<D>, tools: ReadTools, facts: F) => Promise<Result<D>>;
}

export interface CommandSpec<D extends EndpointDef, F = undefined> extends SpecBase<D, F> {
  handle: (ctx: Ctx<D>, tools: Tools, facts: F) => Promise<Result<D>>;
  /** 'required' (default): refuse to commit a command that wrote no audit event. */
  audit?: 'required' | 'none';
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

export function deps(req: FastifyRequest): PlatformDeps {
  return req.server.platform;
}

export async function requireSession(req: FastifyRequest): Promise<SessionRef> {
  const d = deps(req);
  const session = await resolveSession(d.db, req.cookies[d.config.cookieName]);
  if (!session) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue.');
  return session;
}

function parsePart<S extends z.ZodTypeAny>(schema: S, value: unknown, part: string): z.output<S> {
  const r = schema.safeParse(value ?? {});
  if (!r.success)
    throw new ApiError('VALIDATION_FAILED', 'Request validation failed', {
      errors: zodFieldErrors(r.error, part),
    });
  return r.data as z.output<S>;
}

async function readMultipart(
  req: FastifyRequest,
  maxBytes: number,
): Promise<{ body: unknown; files: UploadedFile[] }> {
  const files: UploadedFile[] = [];
  let body: Record<string, unknown> = {};
  for await (const part of req.parts({ limits: { fileSize: maxBytes, files: 1, fields: 20 } })) {
    if (part.type === 'file') {
      const bytes = new Uint8Array(await part.toBuffer());
      files.push({ fieldName: part.fieldname, fileName: part.filename, mimeType: part.mimetype, bytes });
    } else if (part.fieldname === 'metadata') {
      try {
        body = { ...body, ...(JSON.parse(String(part.value)) as Record<string, unknown>) };
      } catch {
        throw new ApiError('VALIDATION_FAILED', 'The metadata field must be JSON');
      }
    } else {
      body[part.fieldname] = part.value;
    }
  }
  return { body, files };
}

export async function parseInput<D extends EndpointDef>(
  def: D,
  req: FastifyRequest,
  multipart: boolean,
): Promise<{ params: Params<D>; query: Query<D>; body: Body<D>; files: UploadedFile[] }> {
  let rawBody: unknown = req.body;
  let files: UploadedFile[] = [];
  if (req.isMultipart()) {
    if (!multipart) throw new ApiError('VALIDATION_FAILED', 'This endpoint accepts application/json only');
    ({ body: rawBody, files } = await readMultipart(req, deps(req).config.maxUploadBytes));
  }
  return {
    params: parsePart(def.params, req.params, 'params'),
    query: parsePart(def.query, req.query, 'query'),
    body: parsePart(def.body, rawBody, 'body'),
    files,
  };
}

export function parseIfMatch(header: string | undefined): number | null {
  if (header === undefined) return null;
  const m = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(header);
  if (!m) throw new ApiError('VALIDATION_FAILED', 'If-Match must be a quoted row version such as "7"');
  return Number(m[1]);
}

/** Use in draft writes: 412 VERSION_CONFLICT when the client edited an older row version. */
export function assertIfMatch(ctx: Ctx<EndpointDef>, currentRowVersion: number): void {
  if (ctx.ifMatch === null) return;
  if (ctx.ifMatch !== currentRowVersion)
    throw new ApiError('VERSION_CONFLICT', 'This draft changed since you opened it.', {
      detail: `current version ${currentRowVersion}`,
    });
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function validateResponse<D extends EndpointDef>(def: D, result: unknown, req: FastifyRequest): unknown {
  if (def.successStatus === 204) return undefined;
  if (!deps(req).config.validateResponses) return result;
  const r = def.response.safeParse(result);
  if (!r.success) {
    req.log.error({ operation: def.id, issues: r.error.issues.slice(0, 5) }, 'response failed its contract');
    throw new ApiError('INTERNAL', 'Unexpected error');
  }
  return r.data;
}

function denied(d: Exclude<Authorization, { allow: true }>): ApiError {
  return new ApiError(d.code, d.code === 'NOT_FOUND' ? 'Not found' : d.reason);
}

async function identityFor(req: FastifyRequest, session: SessionRef): Promise<Identity> {
  const d = deps(req);
  const identity = await withTenant(
    d.db,
    { tenantId: session.tenantId, userId: session.userId, correlationId: req.id },
    (tx) => loadIdentity(tx, session),
  );
  if (!identity) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue.');
  return identity;
}

function buildCtx<D extends EndpointDef>(
  def: D,
  req: FastifyRequest,
  reply: FastifyReply,
  identity: Identity,
  input: Awaited<ReturnType<typeof parseInput<D>>>,
  extra: { idempotencyKey: string | null; ifMatch: number | null },
): Ctx<D> {
  const d = deps(req);
  return {
    def,
    ...input,
    identity,
    tenantId: identity.session.tenantId,
    userId: identity.session.userId,
    correlationId: req.id,
    now: d.now(),
    deps: d,
    ...extra,
    setHeader: (name, value) => void reply.header(name, value),
    setETag: (v) => void reply.header(HEADERS.etag, `"${v}"`),
  };
}

function requireHuman(def: EndpointDef, identity: Identity): void {
  if (def.auth === 'human' && !(identity.actor.kind === 'human' && identity.interactive))
    throw new ApiError('AGENT_IDENTITY_FORBIDDEN', 'This action needs a person signed in interactively.');
}

// ---------------------------------------------------------------------------
// query() and command()
// ---------------------------------------------------------------------------

/** Read handler: session → validate → withTenant(load → authorize → handle) → response schema. */
export function query<D extends EndpointDef, F = undefined>(def: D, spec: QuerySpec<D, F>): Handler {
  return async (req, reply) => {
    const session = await requireSession(req);
    const input = await parseInput(def, req, spec.multipart ?? false);
    const d = deps(req);
    return withTenant(
      d.db,
      { tenantId: session.tenantId, userId: session.userId, correlationId: req.id },
      async (tx) => {
        const identity = await loadIdentity(tx, session);
        if (!identity) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue.');
        requireHuman(def, identity);
        const ctx = buildCtx(def, req, reply, identity, input, {
          idempotencyKey: null,
          ifMatch: parseIfMatch(header(req, HEADERS.ifMatch)),
        });
        const facts = (spec.load ? await spec.load(ctx, tx) : undefined) as F;
        const decision = await spec.authorize(ctx, facts);
        if (!decision.allow) throw denied(decision);
        const result = await spec.handle(ctx, { tx, authz: decision }, facts);
        return validateResponse(def, result, req);
      },
    );
  };
}

/** Write handler: the full pipeline described at the top of this file. */
export function command<D extends EndpointDef, F = undefined>(def: D, spec: CommandSpec<D, F>): Handler {
  return async (req, reply) => {
    const d = deps(req);
    const session = await requireSession(req);
    const input = await parseInput(def, req, spec.multipart ?? false);
    const identity = await identityFor(req, session);
    requireHuman(def, identity);

    const rawIfMatch = header(req, HEADERS.ifMatch);
    if (def.ifMatch && rawIfMatch === undefined)
      throw new ApiError('PRECONDITION_REQUIRED', 'If-Match is required: send the row version you edited.');
    const ifMatch = def.ifMatch ? parseIfMatch(rawIfMatch) : null;

    let idempotencyKey: string | null = null;
    if (def.idempotent) {
      idempotencyKey = header(req, HEADERS.idempotencyKey) ?? null;
      if (!idempotencyKey)
        throw new ApiError('PRECONDITION_REQUIRED', 'Idempotency-Key is required for this action.');
      if (idempotencyKey.length > 200 || !/^[\w.:-]+$/.test(idempotencyKey))
        throw new ApiError('VALIDATION_FAILED', 'Idempotency-Key must be a UUID or a short token');
    }
    const scope = idempotencyKey
      ? { tenantId: session.tenantId, userId: session.userId, key: idempotencyKey }
      : null;
    if (scope) {
      const requestHash = sha256Hex(
        stableStringify({
          op: def.id,
          params: input.params,
          query: input.query,
          body: input.body,
          files: input.files.map((f) => sha256Hex(f.bytes)),
        }),
      );
      const begun = await beginIdempotent(
        d.db,
        { ...scope, method: def.method, route: def.id, requestHash, correlationId: req.id },
        d.now(),
        d.config.idempotencyTtlMs,
      );
      if (begun.kind === 'replay') {
        void reply.header('Idempotent-Replayed', 'true');
        return begun.body;
      }
      if (begun.kind === 'in_progress')
        throw new ApiError('IDEMPOTENCY_IN_PROGRESS', 'This request is still being processed.');
      if (begun.kind === 'reused')
        throw new ApiError(
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was used for a different request.',
        );
    }

    try {
      return await withTenant(
        d.db,
        { tenantId: session.tenantId, userId: session.userId, correlationId: req.id },
        async (tx) => {
          const ctx = buildCtx(def, req, reply, identity, input, { idempotencyKey, ifMatch });
          const facts = (spec.load ? await spec.load(ctx, tx) : undefined) as F;
          const decision = await spec.authorize(ctx, facts);
          if (!decision.allow) throw denied(decision);
          let audits = 0;
          const tools = commandTools(tx, ctx, decision, () => audits++);
          const result = await spec.handle(ctx, tools, facts);
          if ((spec.audit ?? 'required') === 'required' && audits === 0)
            throw new Error(`${def.id}: command committed no audit event`);
          const body = validateResponse(def, result, req);
          if (scope) await completeIdempotent(tx, scope, def.successStatus, body);
          return body;
        },
      );
    } catch (err) {
      if (scope) await releaseIdempotent(d.db, scope, req.id).catch(() => undefined);
      throw err;
    }
  };
}

/** The writers a command handler receives, bound to the caller and the transaction. */
export function commandTools<D extends EndpointDef>(
  tx: Tx,
  ctx: Ctx<D>,
  authz: Allowed,
  onAudit: () => void = () => undefined,
): Tools {
  const { identity } = ctx;
  const actorRole = authz.role ?? null;
  return {
    tx,
    authz,
    async audit(a) {
      await auditWriter.record(tx, {
        actorUserId: identity.user.id,
        actorKind: identity.kind,
        actorRole,
        action: a.action,
        objectType: a.objectType,
        objectId: a.objectId,
        objectVersion: a.objectVersion ?? null,
        caseId: a.caseId ?? null,
        beforeHash: a.before === undefined ? null : stateHash(a.before),
        afterHash: a.after === undefined ? null : stateHash(a.after),
        summary: a.summary,
        details: a.details ?? {},
        authz: { decision: 'allow', rule: authz.rule, authorityGrantId: authz.authorityGrantId },
      });
      onAudit();
    },
    async analytics(name, target, props) {
      await auditWriter.analytics(
        tx,
        name,
        {
          tenantId: ctx.tenantId,
          caseId: target.caseId ?? null,
          actorRole: actorRole ?? identity.roles[0]?.role ?? 'system',
          objectType: target.objectType,
          objectId: target.objectId,
          objectVersion: target.objectVersion ?? null,
          occurredAt: ctx.now.toISOString(),
          stage: target.stage ?? null,
          correlationId: ctx.correlationId,
        },
        props as Record<string, unknown>,
      );
    },
    enqueue(name, payload = {}, opts = {}) {
      return enqueueJob(
        tx,
        name,
        { ...payload, tenantId: ctx.tenantId, correlationId: ctx.correlationId },
        opts,
      );
    },
    emit(event) {
      return auditWriter.emit(tx, event);
    },
  };
}

/**
 * Writers for code that runs without an HTTP request (timers, materiality cascades in tests):
 * audit events are recorded with actor kind 'system' and the given rule.
 */
export function systemTools(
  tx: Tx,
  s: { tenantId: string; correlationId: string; now: Date; rule: string },
): Tools {
  const authz: Allowed = { allow: true, rule: s.rule, authorityGrantId: null, role: null };
  return {
    tx,
    authz,
    async audit(a) {
      await auditWriter.record(tx, {
        actorUserId: null,
        actorKind: 'system',
        actorRole: null,
        action: a.action,
        objectType: a.objectType,
        objectId: a.objectId,
        objectVersion: a.objectVersion ?? null,
        caseId: a.caseId ?? null,
        beforeHash: a.before === undefined ? null : stateHash(a.before),
        afterHash: a.after === undefined ? null : stateHash(a.after),
        summary: a.summary,
        details: a.details ?? {},
        authz: { decision: 'allow', rule: s.rule, authorityGrantId: null },
        occurredAt: s.now,
      });
    },
    async analytics(name, target, props) {
      await auditWriter.analytics(
        tx,
        name,
        {
          tenantId: s.tenantId,
          caseId: target.caseId ?? null,
          actorRole: 'system',
          objectType: target.objectType,
          objectId: target.objectId,
          objectVersion: target.objectVersion ?? null,
          occurredAt: s.now.toISOString(),
          stage: target.stage ?? null,
          correlationId: s.correlationId,
        },
        props as Record<string, unknown>,
      );
    },
    enqueue(name, payload = {}, opts = {}) {
      return enqueueJob(tx, name, { ...payload, tenantId: s.tenantId, correlationId: s.correlationId }, opts);
    },
    emit(event) {
      return auditWriter.emit(tx, event);
    },
  };
}
