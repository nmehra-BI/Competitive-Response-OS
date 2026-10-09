/**
 * Fastify bootstrap. Registers every endpoint of the frozen registry (ENDPOINTS). A module replaces
 * the default "not implemented" answer by exporting a handler keyed by operation id (built with
 * `command()` / `query()` from ./pipeline). Dev-only endpoints exist only when AUTH_MODE=dev.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { API_PREFIX, ENDPOINTS, HEADERS, type EndpointDef } from '@growth-os/contracts';
import { createDb, createObjectStore } from '@growth-os/db';
import { loadConfig, type PlatformConfig } from './config';
import type { PlatformDeps } from './context';
import { ApiError, notImplemented, toApiError } from './errors';
import type { HandlerMap } from './pipeline';

declare module 'fastify' {
  interface FastifyInstance {
    platform: PlatformDeps;
  }
}

export interface ServerOptions {
  handlers: HandlerMap;
  authMode: 'dev' | 'oidc';
  logger?: boolean;
  /** Injected services (tests). Missing ones are created from the environment. */
  deps?: Partial<PlatformDeps>;
  config?: Partial<PlatformConfig>;
  /** Log destination (tests capture it to prove nothing restricted is logged). Default stdout. */
  logStream?: NodeJS.WritableStream;
  /** Endpoints to register. Defaults to the frozen registry; tests may add synthetic ones. */
  endpoints?: readonly EndpointDef[];
}

const CORRELATION_ID = /^[\w.:-]{1,100}$/;
/** Content types a state-changing request may carry (CSRF: no form posts, API.md §2). */
const JSON_TYPE = /^application\/(?:[\w.+-]+\+)?json\b/i;
const MULTIPART_TYPE = /^multipart\/form-data\b/i;

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const config: PlatformConfig = { ...loadConfig(), ...opts.config, authMode: opts.authMode };
  const ownDb = !opts.deps?.db;
  const platformDeps: PlatformDeps = {
    db: opts.deps?.db ?? createDb('app'),
    objects: opts.deps?.objects ?? createObjectStore(),
    config,
    now: opts.deps?.now ?? (() => new Date()),
  };

  const app = Fastify({
    logger: opts.logger
      ? {
          // Never log bodies, cookies or auth headers: they may carry restricted values (§15). The
          // query string is dropped too: a search term can quote restricted text (D-105).
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          serializers: {
            req: (req: { method: string; url: string; id: string }) => ({
              method: req.method,
              url: req.url.split('?')[0],
              reqId: req.id,
            }),
          },
          ...(opts.logStream ? { stream: opts.logStream } : {}),
        }
      : false,
    genReqId: (req) => {
      const given = req.headers[HEADERS.correlationId.toLowerCase()];
      return typeof given === 'string' && CORRELATION_ID.test(given) ? given : randomUUID();
    },
    bodyLimit: 1024 * 1024,
  });
  app.decorate('platform', platformDeps);
  if (ownDb) app.addHook('onClose', async () => platformDeps.db.destroy());

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes } });

  app.addHook('onRequest', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const ct = req.headers['content-type'];
    if (ct === undefined || JSON_TYPE.test(ct) || MULTIPART_TYPE.test(ct)) return;
    throw new ApiError('VALIDATION_FAILED', 'Send application/json (form posts are refused).');
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header(HEADERS.correlationId, req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    const apiErr = toApiError(err);
    if (apiErr.code === 'INTERNAL') req.log.error({ err }, 'unhandled error');
    void reply
      .status(apiErr.status)
      .type('application/problem+json')
      .send(apiErr.toProblem(req.id, req.url.split('?')[0]));
  });

  app.setNotFoundHandler((req, reply) => {
    const e = new ApiError('NOT_FOUND', 'Not found');
    void reply
      .status(404)
      .type('application/problem+json')
      .send(e.toProblem(req.id, req.url.split('?')[0]));
  });

  app.get('/healthz', async () => ({ ok: true }));

  for (const def of opts.endpoints ?? ENDPOINTS) {
    if (def.auth === 'dev_only' && opts.authMode !== 'dev') continue;
    const handler = opts.handlers[def.id];
    app.route({
      method: def.method,
      url: `${API_PREFIX}${def.path}`,
      handler: async (req, reply) => {
        if (!handler) throw notImplemented(def.id);
        const result = await handler(req, reply, def);
        if (reply.sent) return reply;
        if (def.successStatus === 204) return reply.status(204).send();
        return reply.status(def.successStatus).send(result);
      },
    });
  }

  return app;
}
