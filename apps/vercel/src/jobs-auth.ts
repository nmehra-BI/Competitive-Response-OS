/**
 * Who may run the job drain over HTTP (decisions.md D-161). Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>`; operators use the same header. No secret configured means
 * the endpoint is closed (fail closed), never open.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export type JobsAuth = 'ok' | 'unauthorized' | 'not_configured';

const digest = (v: string): Buffer => createHash('sha256').update(v).digest();

export function checkJobsAuth(header: string | string[] | undefined, secret: string | undefined): JobsAuth {
  if (!secret || secret.length < 32) return 'not_configured';
  if (typeof header !== 'string') return 'unauthorized';
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) return 'unauthorized';
  // Compare fixed-length digests so neither length nor content leaks through timing.
  return timingSafeEqual(digest(m[1]!), digest(secret)) ? 'ok' : 'unauthorized';
}

/** Methods whose success should start a job drain: every state change. */
export function isCommand(method: string | undefined, url: string | undefined, status: number): boolean {
  if (!method || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  if (!url?.startsWith('/api/v1/')) return false;
  return status >= 200 && status < 400;
}
