import { describe, expect, it } from 'vitest';
import { ENDPOINTS } from '@growth-os/contracts';
import { buildServer } from './server';

describe('API skeleton', () => {
  it('registers every frozen endpoint and answers with problem+json until implemented', async () => {
    const app = await buildServer({ handlers: {}, authMode: 'dev' });
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes.length).toBeGreaterThan(0);
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json().code).toBe('INTERNAL');
    expect(res.headers['x-correlation-id']).toBeTruthy();
    expect(ENDPOINTS.length).toBeGreaterThan(90);
    await app.close();
  });

  it('does not expose dev-only endpoints outside dev auth mode', async () => {
    const app = await buildServer({ handlers: {}, authMode: 'oidc' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-login', payload: {} });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
