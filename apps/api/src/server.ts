/**
 * API server entry for modules and tests. The implementation lives in ./platform (WS1): Fastify
 * bootstrap, sessions, the command pipeline and the error model.
 */
export { buildServer, type ServerOptions } from './platform/server';
export type { Handler, HandlerMap } from './platform/pipeline';
