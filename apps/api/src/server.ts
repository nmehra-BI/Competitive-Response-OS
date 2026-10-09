/**
 * API server. Registers every endpoint from the frozen registry. A module replaces the default
 * "not implemented" handler by exporting a handler map keyed by operation id (see modules/README.md).
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import { API_PREFIX, ENDPOINTS, HEADERS, type EndpointDef } from '@growth-os/contracts';
import { ApiError, notImplemented } from './platform/errors';

export type Handler = (req: FastifyRequest, reply: FastifyReply, def: EndpointDef) => Promise<unknown>;
export type HandlerMap = Readonly<Record<string, Handler>>;

export interface ServerOptions {
  handlers: HandlerMap;
  authMode: 'dev' | 'oidc';
  logger?: boolean;
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger
      ? {
          // Never log bodies, cookies or auth headers: they may carry restricted values (§13).
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        }
      : false,
    genReqId: (req) =>
      (req.headers[HEADERS.correlationId.toLowerCase()] as string | undefined) ?? randomUUID(),
  });
  await app.register(cookie);

  app.addHook('onSend', async (req, reply) => {
    reply.header(HEADERS.correlationId, req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    const apiErr =
      err instanceof ApiError
        ? err
        : (err as { validation?: unknown }).validation
          ? new ApiError('VALIDATION_FAILED', 'Request validation failed')
          : new ApiError('INTERNAL', 'Unexpected error');
    if (apiErr.code === 'INTERNAL') req.log.error({ err }, 'unhandled error');
    void reply.status(apiErr.status).type('application/problem+json').send(apiErr.toProblem(req.id, req.url));
  });

  app.get('/healthz', async () => ({ ok: true }));

  for (const def of ENDPOINTS) {
    if (def.auth === 'dev_only' && opts.authMode !== 'dev') continue;
    const handler = opts.handlers[def.id];
    app.route({
      method: def.method,
      url: `${API_PREFIX}${def.path}`,
      handler: async (req, reply) => {
        if (!handler) throw notImplemented(def.id);
        // TODO(WS4): shared pipeline — auth, Zod validation of params/query/body, Idempotency-Key,
        // If-Match, then call the module handler and validate the response in dev/test.
        const result = await handler(req, reply, def);
        return reply.status(def.successStatus).send(result);
      },
    });
  }

  return app;
}
