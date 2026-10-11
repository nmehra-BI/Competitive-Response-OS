import { describe, expect, it } from 'vitest';
import { devClockAllowed, devFeaturesAllowed, hostedWithoutDemo } from './clock';

describe('dev features on hosted runtimes (D-165)', () => {
  it('local development keeps the old rule: AUTH_MODE=dev is enough', () => {
    expect(devFeaturesAllowed({ AUTH_MODE: 'dev', NODE_ENV: 'development' })).toBe(true);
    expect(devFeaturesAllowed({ AUTH_MODE: 'oidc', NODE_ENV: 'development' })).toBe(false);
  });

  it('production or Vercel needs DEMO_MODE=1 as well', () => {
    expect(devFeaturesAllowed({ AUTH_MODE: 'dev', NODE_ENV: 'production' })).toBe(false);
    expect(devFeaturesAllowed({ AUTH_MODE: 'dev', VERCEL: '1' })).toBe(false);
    expect(devFeaturesAllowed({ AUTH_MODE: 'dev', VERCEL: '1', DEMO_MODE: '1' })).toBe(true);
    expect(devFeaturesAllowed({ AUTH_MODE: 'oidc', VERCEL: '1', DEMO_MODE: '1' })).toBe(false);
    expect(devClockAllowed({ AUTH_MODE: 'dev', NODE_ENV: 'production', DEMO_MODE: 'true' })).toBe(false);
  });

  it('hostedWithoutDemo blocks the dev clock regardless of AUTH_MODE', () => {
    expect(hostedWithoutDemo({ NODE_ENV: 'production' })).toBe(true);
    expect(hostedWithoutDemo({ NODE_ENV: 'production', DEMO_MODE: '1' })).toBe(false);
    expect(hostedWithoutDemo({ NODE_ENV: 'test' })).toBe(false);
  });
});
