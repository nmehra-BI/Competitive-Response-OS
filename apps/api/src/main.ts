import { buildServer } from './server';
import { handlers } from './modules';

const port = Number(process.env.API_PORT ?? 4000);
const authMode = process.env.AUTH_MODE === 'dev' ? 'dev' : 'oidc';

const app = await buildServer({ handlers, authMode, logger: true });
await app.listen({ port, host: '127.0.0.1' });
