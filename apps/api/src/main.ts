import { buildServer } from './server';
import { handlers } from './modules';
import { loadConfig } from './platform/config';

const port = Number(process.env.API_PORT ?? 4000);
// Dev login only with AUTH_MODE=dev, and on a hosted runtime only with DEMO_MODE=1 (D-165).
const authMode = loadConfig().authMode;

const app = await buildServer({ handlers, authMode, logger: true });
await app.listen({ port, host: '127.0.0.1' });
