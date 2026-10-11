import { describe, expect, it } from 'vitest';
import { checkJobsAuth, isCommand } from './jobs-auth';

const SECRET = 'x'.repeat(40);

describe('checkJobsAuth', () => {
  it('fails closed without a configured secret', () => {
    expect(checkJobsAuth(`Bearer ${SECRET}`, undefined)).toBe('not_configured');
    expect(checkJobsAuth('Bearer short', 'short')).toBe('not_configured');
  });

  it('refuses a missing, malformed or wrong header', () => {
    expect(checkJobsAuth(undefined, SECRET)).toBe('unauthorized');
    expect(checkJobsAuth(SECRET, SECRET)).toBe('unauthorized');
    expect(checkJobsAuth(`Bearer ${SECRET}y`, SECRET)).toBe('unauthorized');
    expect(checkJobsAuth([`Bearer ${SECRET}`], SECRET)).toBe('unauthorized');
  });

  it('accepts the cron bearer token', () => {
    expect(checkJobsAuth(`Bearer ${SECRET}`, SECRET)).toBe('ok');
  });
});

describe('isCommand', () => {
  it('drains after successful state changes on the API only', () => {
    expect(isCommand('POST', '/api/v1/cases', 201)).toBe(true);
    expect(isCommand('PUT', '/api/v1/dev/clock', 200)).toBe(true);
    expect(isCommand('GET', '/api/v1/cases', 200)).toBe(false);
    expect(isCommand('POST', '/api/v1/cases', 409)).toBe(false);
    expect(isCommand('POST', '/api/internal/jobs/run', 200)).toBe(false);
  });
});
