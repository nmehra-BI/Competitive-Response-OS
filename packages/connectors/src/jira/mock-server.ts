/**
 * Local mock of Jira Cloud and the Atlassian authorization server, for tests only (there is no
 * network to Jira). It implements exactly what the adapter uses:
 *
 *   GET  /authorize                                  consent (auto-approves; 302 to redirect_uri)
 *   POST /oauth/token                                authorization_code and refresh_token (rotating)
 *   GET  /oauth/token/accessible-resources           the site the grant covers (cloud id)
 *   /ex/jira/{cloudId}/rest/api/3/…
 *     GET  myself · project/{key} · issue/createmeta/{key}/issuetypes · mypermissions
 *     GET  user/assignable/search · user/search
 *     POST issue (fields + properties) · POST search/jql (project, labels, issue.property clauses)
 *     GET|PUT issue/{key}/properties/{propertyKey}
 *
 * Fault injection mirrors the simulated connector's rules (`mode`, `match`, `times`):
 *   token_expired          sticky: every issued token is revoked (API 401, refresh refused) until a
 *                          new authorization; clearing the rule does not revive old tokens
 *   access_token_expired   the current access tokens stop working (401) but refresh works
 *   timeout_after_success  create: the issue is created, the answer is held past the client timeout
 *   http_5xx               create (or `match.op`): 503, nothing created
 *   rate_limited           create (or `match.op`): 429 with Retry-After
 *   permission_denied      create (or `match.op`): 403
 * `match`: titleContains, assignee (email or account id), nthCall (1-based create call), op.
 *
 * Not for production: imported only by tests through `@growth-os/connectors/jira-mock`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export type MockJiraFaultMode =
  | 'token_expired'
  | 'access_token_expired'
  | 'timeout_after_success'
  | 'http_5xx'
  | 'rate_limited'
  | 'permission_denied';

export type MockJiraOp =
  | 'create'
  | 'search'
  | 'property_get'
  | 'property_put'
  | 'myself'
  | 'project'
  | 'issuetypes'
  | 'permissions'
  | 'assignable'
  | 'usersearch'
  | 'token'
  | 'resources';

export interface MockJiraFault {
  mode: MockJiraFaultMode;
  match?: { titleContains?: string; assignee?: string; nthCall?: number; op?: MockJiraOp };
  times?: number;
}

export interface MockJiraProject {
  name: string;
  issueTypes: string[];
  /** Emails (or account ids) that exist but are not assignable in this project. */
  notAssignable?: string[];
  /** Permissions of the integration account here (default: all granted). */
  permissions?: Partial<Record<'BROWSE_PROJECTS' | 'CREATE_ISSUES' | 'ASSIGN_ISSUES', boolean>>;
  /** First issue number (default 1). */
  keyStart?: number;
}

export interface MockJiraOptions {
  clientId?: string;
  clientSecret?: string;
  cloudId?: string;
  siteUrl?: string;
  accountDisplayName?: string;
  projects?: Record<string, MockJiraProject>;
  /** Emails no Jira user has. */
  unknownUsers?: string[];
  /** Hide email addresses in user search results (Atlassian privacy setting). */
  hideEmails?: boolean;
  accessTokenTtlSec?: number;
  /** How long a `timeout_after_success` answer is held (ms). */
  holdMs?: number;
  port?: number;
  host?: string;
  /** Ignore `properties` in create requests (to test the read-back and fallback). */
  dropCreateProperties?: boolean;
  /** Scopes the consent grants (default: what was asked). */
  grantedScopes?: string[];
}

export interface MockJiraIssue {
  id: string;
  key: string;
  project: string;
  issueType: string;
  summary: string;
  description: unknown;
  assigneeAccountId: string | null;
  duedate: string | null;
  labels: string[];
  properties: Record<string, unknown>;
  createdAt: string;
}

export interface MockJiraCall {
  method: string;
  path: string;
  op: MockJiraOp | 'authorize' | 'other';
  status: number;
}

export interface MockJira {
  url: string;
  cloudId: string;
  siteUrl: string;
  clientId: string;
  clientSecret: string;
  issues(project?: string): MockJiraIssue[];
  calls: MockJiraCall[];
  setFaults(rules: MockJiraFault[]): void;
  /** Issue an authorization code directly (what a consent redirect carries). */
  issueCode(redirectUri: string, scopes?: string[]): string;
  accountIdOf(email: string): string;
  /** Number of live (unrevoked) refresh tokens: rotation leaves exactly one per grant. */
  liveRefreshTokens(): number;
  /** Revoke every token (the customer removed the app or the integration account). */
  revokeAll(): void;
  close(): Promise<void>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const DEFAULT_MOCK_PROJECTS: Record<string, MockJiraProject> = {
  PIL: { name: 'Pilot delivery', issueTypes: ['Task', 'Story', 'Bug'] },
  'ME-VAL': { name: 'Market validation', issueTypes: ['Task'] },
};

export async function startMockJira(opts: MockJiraOptions = {}): Promise<MockJira> {
  const clientId = opts.clientId ?? 'mock-client-id';
  const clientSecret = opts.clientSecret ?? 'mock-client-secret';
  const cloudId = opts.cloudId ?? '11111111-2222-4333-8444-555555555555';
  const siteUrl = opts.siteUrl ?? 'https://aster-industrial.atlassian.net';
  const accountDisplayName = opts.accountDisplayName ?? 'Growth OS integration';
  const projects = opts.projects ?? DEFAULT_MOCK_PROJECTS;
  const ttl = opts.accessTokenTtlSec ?? 3600;
  const holdMs = opts.holdMs ?? 3000;

  const codes = new Map<string, { redirectUri: string; scopes: string[]; used: boolean }>();
  const accessTokens = new Map<string, { expiresAt: number; revoked: boolean; scopes: string[] }>();
  const refreshTokens = new Map<string, { revoked: boolean; scopes: string[] }>();
  let faults: (MockJiraFault & { remaining: number })[] = [];
  let createCalls = 0;
  const issues: MockJiraIssue[] = [];
  const counters = new Map<string, number>();
  const calls: MockJiraCall[] = [];
  const sockets = new Set<Socket>();
  const timers = new Set<NodeJS.Timeout>();

  const accountIdOf = (email: string) =>
    email.startsWith('acc-') ? email : `acc-${sha(email.toLowerCase()).slice(0, 16)}`;
  const integrationAccountId = accountIdOf('growth-os-integration@aster.example');

  const issueTokens = (scopes: string[]) => {
    const access = `at-${randomBytes(24).toString('base64url')}`;
    const refresh = `rt-${randomBytes(24).toString('base64url')}`;
    accessTokens.set(access, { expiresAt: Date.now() + ttl * 1000, revoked: false, scopes });
    refreshTokens.set(refresh, { revoked: false, scopes });
    return {
      access_token: access,
      refresh_token: refresh,
      expires_in: ttl,
      scope: scopes.join(' '),
      token_type: 'Bearer',
    };
  };

  /** The first matching fault for an operation (consumes one use unless sticky). */
  const fault = (
    op: MockJiraOp,
    ctx: { title?: string; assignee?: string | null } = {},
  ): MockJiraFaultMode | null => {
    for (const f of faults) {
      // token_expired and access_token_expired are decided at authentication (authFault).
      if (f.mode === 'token_expired' || f.mode === 'access_token_expired') continue;
      if (f.remaining <= 0) continue;
      const m = f.match ?? {};
      if ((m.op ?? 'create') !== op) continue;
      if (m.titleContains !== undefined && !(ctx.title ?? '').includes(m.titleContains)) continue;
      if (m.assignee !== undefined && ctx.assignee !== m.assignee && ctx.assignee !== accountIdOf(m.assignee))
        continue;
      if (m.nthCall !== undefined && (op !== 'create' || createCalls !== m.nthCall)) continue;
      f.remaining -= 1;
      return f.mode;
    }
    return null;
  };
  /** access_token_expired: the current access tokens stop working (any op unless `match.op`). */
  const authFault = (op: MockJiraOp): boolean => {
    for (const f of faults) {
      if (f.mode !== 'access_token_expired' || f.remaining <= 0) continue;
      if (f.match?.op !== undefined && f.match.op !== op) continue;
      f.remaining -= 1;
      return true;
    }
    return false;
  };
  const stickyExpired = () => faults.some((f) => f.mode === 'token_expired');

  const userFor = (email: string) => ({
    accountId: accountIdOf(email),
    displayName: email.split('@')[0]!.replace(/[._]/g, ' '),
    active: true,
    ...(opts.hideEmails ? {} : { emailAddress: email }),
  });

  const readBody = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text) return resolve(null);
        try {
          resolve(JSON.parse(text));
        } catch {
          // Form-encoded token requests are accepted too.
          resolve(Object.fromEntries(new URLSearchParams(text)));
        }
      });
    });

  const send = (
    res: ServerResponse,
    status: number,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const searchIssues = (jql: string): MockJiraIssue[] => {
    const where = jql.replace(/\s+ORDER BY[\s\S]*$/i, '');
    const clauses = where.split(/\s+AND\s+/i).map((c) => c.trim());
    const unq = (s: string) =>
      s
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .replace(/\\"/g, '"');
    return issues.filter((i) =>
      clauses.every((c) => {
        let m: RegExpExecArray | null;
        if ((m = /^project\s+in\s*\((.*)\)$/i.exec(c))) return m[1]!.split(',').map(unq).includes(i.project);
        if ((m = /^project\s*=\s*(.+)$/i.exec(c))) return unq(m[1]!) === i.project;
        if ((m = /^labels\s*=\s*(.+)$/i.exec(c))) return i.labels.includes(unq(m[1]!));
        if ((m = /^issue\.property\[([^\]]+)\]\.(\w+)\s*=\s*(.+)$/i.exec(c))) {
          const v = i.properties[m[1]!] as Record<string, unknown> | undefined;
          return v !== undefined && String(v[m[2]!]) === unq(m[3]!);
        }
        return false; // unknown clause: no match (never "everything")
      }),
    );
  };

  async function api(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    url: URL,
    record: (op: MockJiraCall['op'], status: number) => void,
  ) {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const t = accessTokens.get(token);
    const opOf = (): MockJiraOp => {
      if (path === '/myself') return 'myself';
      if (path === '/issue' && req.method === 'POST') return 'create';
      if (path === '/search/jql') return 'search';
      if (/^\/issue\/[^/]+\/properties\//.test(path))
        return req.method === 'PUT' ? 'property_put' : 'property_get';
      if (/^\/issue\/createmeta\//.test(path)) return 'issuetypes';
      if (path.startsWith('/project/')) return 'project';
      if (path === '/mypermissions') return 'permissions';
      if (path === '/user/assignable/search') return 'assignable';
      return 'usersearch';
    };
    const op = opOf();
    const reply = (status: number, body?: unknown, headers?: Record<string, string>) => {
      record(op, status);
      send(res, status, body, headers);
    };
    if (!t || t.revoked || t.expiresAt <= Date.now() || stickyExpired())
      return reply(401, { message: 'Unauthorized' });
    if (authFault(op)) {
      for (const v of accessTokens.values()) v.revoked = true;
      return reply(401, { message: 'Unauthorized' });
    }

    if (op !== 'create' && op !== 'search' && op !== 'property_put') {
      const f = fault(op);
      if (f === 'http_5xx') return reply(503, { errorMessages: ['Service unavailable'] });
      if (f === 'rate_limited')
        return reply(429, { errorMessages: ['Rate limited'] }, { 'retry-after': '1' });
      if (f === 'permission_denied') return reply(403, { errorMessages: ['Forbidden'] });
    }

    if (op === 'myself')
      return reply(200, { accountId: integrationAccountId, displayName: accountDisplayName, active: true });

    if (op === 'project') {
      const key = decodeURIComponent(path.slice('/project/'.length));
      const p = projects[key];
      return p
        ? reply(200, { id: sha(key).slice(0, 5), key, name: p.name })
        : reply(404, { errorMessages: ['No project could be found'] });
    }
    if (op === 'issuetypes') {
      const key = decodeURIComponent(path.split('/')[3] ?? '');
      const p = projects[key];
      if (!p) return reply(404, { errorMessages: ['No project could be found'] });
      return reply(200, {
        maxResults: 200,
        startAt: 0,
        total: p.issueTypes.length,
        issueTypes: p.issueTypes.map((name, i) => ({ id: String(10000 + i), name })),
      });
    }
    if (op === 'permissions') {
      const p = projects[url.searchParams.get('projectKey') ?? ''];
      if (!p) return reply(404, { errorMessages: ['No project could be found'] });
      const want = (url.searchParams.get('permissions') ?? '').split(',').filter(Boolean);
      return reply(200, {
        permissions: Object.fromEntries(
          want.map((k) => [
            k,
            { key: k, havePermission: (p.permissions as Record<string, boolean> | undefined)?.[k] ?? true },
          ]),
        ),
      });
    }
    if (op === 'assignable' || op === 'usersearch') {
      const query = (url.searchParams.get('query') ?? '').toLowerCase();
      if (!query || (opts.unknownUsers ?? []).map((u) => u.toLowerCase()).includes(query))
        return reply(200, []);
      if (op === 'assignable') {
        const p = projects[url.searchParams.get('project') ?? ''];
        if (!p) return reply(404, { errorMessages: ['No project could be found'] });
        const blocked = (p.notAssignable ?? []).map((u) => u.toLowerCase());
        if (blocked.includes(query) || blocked.map(accountIdOf).includes(query)) return reply(200, []);
      }
      return reply(200, [userFor(query)]);
    }

    const body = (await readBody(req)) as Record<string, unknown> | null;

    if (op === 'search') {
      const f = fault('search');
      if (f === 'http_5xx') return reply(503, { errorMessages: ['Service unavailable'] });
      if (f === 'rate_limited')
        return reply(429, { errorMessages: ['Rate limited'] }, { 'retry-after': '1' });
      const found = searchIssues(String(body?.jql ?? ''));
      return reply(200, {
        issues: found
          .slice(0, Number(body?.maxResults ?? 50))
          .map((i) => ({ id: i.id, key: i.key, fields: {} })),
      });
    }

    if (op === 'property_get' || op === 'property_put') {
      const [, , issueKey, , propKey] = path.split('/');
      const issue = issues.find((i) => i.key === decodeURIComponent(issueKey ?? ''));
      if (!issue) return reply(404, { errorMessages: ['Issue does not exist'] });
      const prop = decodeURIComponent(propKey ?? '');
      if (op === 'property_get') {
        return prop in issue.properties
          ? reply(200, { key: prop, value: issue.properties[prop] })
          : reply(404, { errorMessages: ['Property not found'] });
      }
      const f = fault('property_put');
      if (f === 'http_5xx') return reply(503, { errorMessages: ['Service unavailable'] });
      if (f === 'permission_denied')
        return reply(403, { errorMessages: ['Edit issues permission required'] });
      const existed = prop in issue.properties;
      issue.properties[prop] = body;
      return reply(existed ? 200 : 201);
    }

    // op === 'create'
    createCalls += 1;
    const fields = (body?.fields ?? {}) as Record<string, unknown>;
    const title = String(fields.summary ?? '');
    const assignee = ((fields.assignee as { accountId?: string } | undefined)?.accountId ?? null) as
      string | null;
    const f = fault('create', { title, assignee });
    if (f === 'http_5xx') return reply(503, { errorMessages: ['Service unavailable'] });
    if (f === 'rate_limited') return reply(429, { errorMessages: ['Rate limited'] }, { 'retry-after': '1' });
    if (f === 'permission_denied')
      return reply(403, { errorMessages: ['You do not have permission to create issues in this project.'] });
    const projectKey = String((fields.project as { key?: string } | undefined)?.key ?? '');
    const p = projects[projectKey];
    if (!p) return reply(400, { errors: { project: 'valid project is required' } });
    const issueType = String((fields.issuetype as { name?: string } | undefined)?.name ?? '');
    if (!p.issueTypes.some((x) => x.toLowerCase() === issueType.toLowerCase()))
      return reply(400, { errors: { issuetype: 'Specify a valid issue type' } });
    if (assignee && (p.notAssignable ?? []).map(accountIdOf).includes(assignee))
      return reply(400, { errors: { assignee: `User '${assignee}' cannot be assigned issues.` } });
    const n = counters.get(projectKey) ?? p.keyStart ?? 1;
    counters.set(projectKey, n + 1);
    const prefix = projectKey.split('-').filter(Boolean).pop() ?? projectKey;
    const issue: MockJiraIssue = {
      id: String(10000 + issues.length),
      key: `${prefix}-${n}`,
      project: projectKey,
      issueType,
      summary: title,
      description: fields.description ?? null,
      assigneeAccountId: assignee,
      duedate: typeof fields.duedate === 'string' ? fields.duedate : null,
      labels: Array.isArray(fields.labels) ? fields.labels.map(String) : [],
      properties: opts.dropCreateProperties
        ? {}
        : Object.fromEntries(
            (Array.isArray(body?.properties)
              ? (body!.properties as { key: string; value: unknown }[])
              : []
            ).map((x) => [x.key, x.value]),
          ),
      createdAt: new Date().toISOString(),
    };
    issues.push(issue);
    const answer = { id: issue.id, key: issue.key, self: `${siteUrl}/rest/api/3/issue/${issue.id}` };
    if (f === 'timeout_after_success') {
      record(op, 201);
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!res.writableEnded && !res.destroyed) send(res, 201, answer);
      }, holdMs);
      timers.add(timer);
      return;
    }
    return reply(201, answer);
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock.invalid');
    const path = url.pathname;
    const record = (op: MockJiraCall['op'], status: number) =>
      calls.push({ method: req.method ?? 'GET', path, op, status });
    try {
      if (path === '/authorize' && req.method === 'GET') {
        const redirectUri = url.searchParams.get('redirect_uri') ?? '';
        if (url.searchParams.get('client_id') !== clientId || !redirectUri) {
          record('authorize', 400);
          return send(res, 400, { error: 'invalid_request' });
        }
        const scopes = (url.searchParams.get('scope') ?? '').split(' ').filter(Boolean);
        const code = issueCode(redirectUri, scopes);
        const to = new URL(redirectUri);
        to.searchParams.set('code', code);
        to.searchParams.set('state', url.searchParams.get('state') ?? '');
        record('authorize', 302);
        res.writeHead(302, { location: to.toString() });
        return res.end();
      }
      if (path === '/oauth/token' && req.method === 'POST') {
        const b = ((await readBody(req)) ?? {}) as Record<string, string>;
        if (b.client_id !== clientId || b.client_secret !== clientSecret) {
          record('token', 401);
          return send(res, 401, { error: 'access_denied' });
        }
        const f = fault('token');
        if (f === 'http_5xx') {
          record('token', 503);
          return send(res, 503, { error: 'temporarily_unavailable' });
        }
        if (b.grant_type === 'authorization_code') {
          const c = codes.get(b.code ?? '');
          if (!c || c.used || c.redirectUri !== b.redirect_uri) {
            record('token', 403);
            return send(res, 403, { error: 'invalid_grant' });
          }
          c.used = true;
          record('token', 200);
          return send(res, 200, issueTokens(opts.grantedScopes ?? c.scopes));
        }
        if (b.grant_type === 'refresh_token') {
          const r = refreshTokens.get(b.refresh_token ?? '');
          if (!r || r.revoked || stickyExpired()) {
            record('token', 403);
            return send(res, 403, { error: 'invalid_grant' });
          }
          r.revoked = true; // rotation: the old refresh token is spent
          record('token', 200);
          return send(res, 200, issueTokens(r.scopes));
        }
        record('token', 400);
        return send(res, 400, { error: 'unsupported_grant_type' });
      }
      if (path === '/oauth/token/accessible-resources' && req.method === 'GET') {
        const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        const t = accessTokens.get(token);
        if (!t || t.revoked || t.expiresAt <= Date.now() || stickyExpired()) {
          record('resources', 401);
          return send(res, 401, { message: 'Unauthorized' });
        }
        record('resources', 200);
        return send(res, 200, [
          {
            id: cloudId,
            url: siteUrl,
            name: siteUrl.replace(/^https?:\/\//, '').split('.')[0],
            scopes: t.scopes,
            avatarUrl: '',
          },
        ]);
      }
      const prefix = `/ex/jira/${cloudId}/rest/api/3`;
      if (path.startsWith(prefix)) return await api(req, res, path.slice(prefix.length) || '/', url, record);
      record('other', 404);
      return send(res, 404, { errorMessages: ['Not found'] });
    } catch {
      record('other', 500);
      if (!res.headersSent) send(res, 500, { errorMessages: ['mock failure'] });
    }
  });
  server.on('connection', (s: Socket) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  function issueCode(
    redirectUri: string,
    scopes: string[] = ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
  ): string {
    const code = `code-${randomBytes(16).toString('base64url')}`;
    codes.set(code, { redirectUri, scopes, used: false });
    return code;
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;

  const revokeAll = () => {
    for (const v of accessTokens.values()) v.revoked = true;
    for (const v of refreshTokens.values()) v.revoked = true;
  };

  return {
    url: `http://${opts.host ?? '127.0.0.1'}:${addr.port}`,
    cloudId,
    siteUrl,
    clientId,
    clientSecret,
    issues: (project) =>
      issues
        .filter((i) => project === undefined || i.project === project)
        .map((i) => ({ ...i, labels: [...i.labels], properties: { ...i.properties } })),
    calls,
    setFaults(rules) {
      faults = rules.map((r) => ({ ...r, remaining: r.times ?? 1 }));
      if (rules.some((r) => r.mode === 'token_expired')) revokeAll();
    },
    issueCode,
    accountIdOf,
    liveRefreshTokens: () => [...refreshTokens.values()].filter((r) => !r.revoked).length,
    revokeAll,
    async close() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
