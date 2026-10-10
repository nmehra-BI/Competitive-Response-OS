/**
 * Jira Cloud TaskConnector (D-121): REST API v3 through `api.atlassian.com/ex/jira/{cloudId}` with the
 * integration account's OAuth 2.0 (3LO) token.
 *
 *   createTask           search first (an earlier attempt may have created the issue), then create the
 *                        issue with the idempotency key as an entity property AND a label in the same
 *                        request, then set the property again; "Confirmed · PIL-n" only from Jira's
 *                        answer (never-rule 9). A timeout after the create was sent is ambiguous.
 *   findByIdempotencyKey JQL in the mapped projects on the key label, then the entity property is read
 *                        to confirm the match. Entity properties of a 3LO app are not JQL-searchable
 *                        (only Connect/Forge apps can index them), so the label is the search handle
 *                        and the property is the proof.
 *   preview              project, issue type, permissions and assignable-user lookups; no writes.
 *   health               /myself and the integration account's permissions in the mapped projects.
 *
 * Tokens are refreshed before expiry and once on a 401; a refused refresh → `token_expired` (the
 * outbox pauses every unsent task of the connection; S11 shows "Jira connection expired").
 * Nothing here logs; errors never carry tokens, codes or issue bodies.
 */
import {
  ConnectorError,
  type ConnectorHealth,
  type ExternalTaskInput,
  type ExternalTaskRef,
  type PreviewItemResult,
  type PreviewProblemCode,
  type TaskConnector,
} from '../task-connector';
import {
  IDEMPOTENCY_PROPERTY,
  idempotencyLabel,
  JIRA_CLOUD_PROVIDER,
  REFRESH_SKEW_MS,
  type JiraConfig,
} from './config';
import { TokenDecryptError } from './crypto';
import {
  connectorErrorFor,
  connectorErrorForTransport,
  httpRequest,
  JiraTransportError,
  MESSAGES,
  type FetchLike,
  type HttpResult,
  type RequestDescription,
} from './http';
import { OAuthGrantError, OAuthUnavailableError, refreshTokens } from './oauth';
import { TenantUnresolvedError, type CredentialStore, type JiraCredential } from './store';

export interface JiraConnectorOptions {
  connectionId: string;
  config: JiraConfig;
  store: CredentialStore;
  fetch?: FetchLike;
  now?: () => Date;
}

interface JiraUser {
  accountId: string;
  emailAddress?: string;
  displayName?: string;
  active?: boolean;
}

type AssigneeLookup = { accountId: string } | { problem: 'assignee_not_found' | 'assignee_not_in_project' };

const PERMISSIONS = ['BROWSE_PROJECTS', 'CREATE_ISSUES', 'ASSIGN_ISSUES'] as const;
type Permission = (typeof PERMISSIONS)[number];

/** Jira labels cannot contain spaces. */
export function jiraLabel(label: string): string {
  return label.trim().replace(/\s+/g, '-');
}

const jqlString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Atlassian Document Format for the issue description (case, gate and snapshot, requester). */
export function descriptionDoc(input: ExternalTaskInput): unknown {
  const lines = [
    input.description,
    `${input.links.caseKey} · approved under ${input.links.gateLabel}`,
    `Growth OS: ${input.links.url}`,
  ].filter((l) => l && l.trim().length > 0);
  return {
    type: 'doc',
    version: 1,
    content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}

export function createJiraConnector(opts: JiraConnectorOptions): TaskConnector {
  const fetchImpl: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const now = opts.now ?? (() => new Date());
  const { config, store } = opts;
  const assignees = new Map<string, AssigneeLookup>();
  const inflight = new Map<string, Promise<ExternalTaskRef>>();

  // ---- credentials ------------------------------------------------------------------------------

  const expired = (message: string = MESSAGES.expired) => new ConnectorError('token_expired', message);

  async function credential(): Promise<JiraCredential> {
    let c: JiraCredential | null;
    try {
      c = await store.load();
    } catch (e) {
      throw storeError(e);
    }
    if (!c || c.revokedAt) throw expired();
    if (c.expiresAt.getTime() - now().getTime() <= REFRESH_SKEW_MS) return refresh(c.accessToken, false);
    return c;
  }

  function storeError(e: unknown): ConnectorError {
    if (e instanceof ConnectorError) return e;
    if (e instanceof TokenDecryptError)
      return expired('The stored Jira token cannot be read with the configured key. Reconnect Jira.');
    if (e instanceof TenantUnresolvedError)
      return new ConnectorError('unavailable', 'The Jira connection could not be loaded.');
    throw e;
  }

  /**
   * Refresh under the store's row lock. `force` (after a 401): refresh unless another process already
   * replaced the token we used. Not forced: refresh only when the token is about to expire.
   */
  async function refresh(usedAccessToken: string, force: boolean): Promise<JiraCredential> {
    let out: JiraCredential | null;
    try {
      out = await store.update(async (cur) => {
        if (cur.revokedAt) throw expired();
        const fresh = cur.expiresAt.getTime() - now().getTime() > REFRESH_SKEW_MS;
        if (force ? cur.accessToken !== usedAccessToken && fresh : fresh) return null;
        if (!cur.refreshToken) throw expired();
        try {
          return await refreshTokens(config, fetchImpl, cur.refreshToken, now());
        } catch (e) {
          if (e instanceof OAuthGrantError) throw expired();
          if (e instanceof OAuthUnavailableError)
            throw new ConnectorError('transient', 'The Atlassian authorization service is not available.');
          throw e;
        }
      });
    } catch (e) {
      throw storeError(e);
    }
    if (!out || out.revokedAt) throw expired();
    return out;
  }

  // ---- requests ---------------------------------------------------------------------------------

  async function call(
    method: string,
    path: string,
    d: RequestDescription,
    body?: unknown,
    accept: (status: number) => boolean = (s) => s >= 200 && s < 300,
  ): Promise<HttpResult> {
    let cred = await credential();
    for (let attempt = 0; ; attempt++) {
      let res: HttpResult;
      try {
        res = await httpRequest(
          fetchImpl,
          `${config.apiBaseUrl}/ex/jira/${encodeURIComponent(cred.cloudId)}/rest/api/3${path}`,
          { method, headers: { authorization: `Bearer ${cred.accessToken}` }, body },
          config.timeoutMs,
        );
      } catch (e) {
        if (e instanceof JiraTransportError) throw connectorErrorForTransport(e, d);
        throw e;
      }
      if (res.status === 401 && attempt === 0) {
        cred = await refresh(cred.accessToken, true);
        continue;
      }
      if (accept(res.status)) return res;
      throw connectorErrorFor(res, d);
    }
  }

  const siteOf = async () => (await credential()).siteUrl.replace(/\/+$/, '');

  async function projectExists(project: string): Promise<boolean> {
    const res = await call(
      'GET',
      `/project/${encodeURIComponent(project)}`,
      { write: false, action: `read project ${project}`, project },
      undefined,
      (s) => s === 200 || s === 404,
    );
    return res.status === 200;
  }

  async function issueTypes(project: string): Promise<string[]> {
    const res = await call(
      'GET',
      `/issue/createmeta/${encodeURIComponent(project)}/issuetypes?maxResults=200`,
      { write: false, action: `read issue types of project ${project}`, project },
      undefined,
      (s) => s === 200 || s === 404,
    );
    if (res.status === 404) return [];
    const b = res.body as { issueTypes?: { name?: string }[]; values?: { name?: string }[] } | null;
    return (b?.issueTypes ?? b?.values ?? []).map((t) => String(t.name ?? ''));
  }

  async function permissions(project: string): Promise<Record<Permission, boolean>> {
    const res = await call(
      'GET',
      `/mypermissions?projectKey=${encodeURIComponent(project)}&permissions=${PERMISSIONS.join(',')}`,
      { write: false, action: `read permissions in project ${project}`, project },
      undefined,
      (s) => s === 200 || s === 404,
    );
    const p = ((res.body as { permissions?: Record<string, { havePermission?: boolean }> } | null)
      ?.permissions ?? {}) as Record<string, { havePermission?: boolean }>;
    return Object.fromEntries(
      PERMISSIONS.map((k) => [k, res.status === 200 && p[k]?.havePermission === true]),
    ) as Record<Permission, boolean>;
  }

  /** Map our assignee (account id or email from the S14 mapping) to an assignable Jira account. */
  async function lookupAssignee(project: string, assignee: string): Promise<AssigneeLookup> {
    const cacheKey = `${project}|${assignee.toLowerCase()}`;
    const hit = assignees.get(cacheKey);
    if (hit) return hit;
    const d = { write: false, action: `look up assignable users in project ${project}`, project };
    const q = encodeURIComponent(assignee);
    const res = await call(
      'GET',
      `/user/assignable/search?project=${encodeURIComponent(project)}&query=${q}&maxResults=5`,
      d,
    );
    const users = (Array.isArray(res.body) ? res.body : []) as JiraUser[];
    const want = assignee.toLowerCase();
    const exact = users.find(
      (u) => u.accountId === assignee || (u.emailAddress ?? '').toLowerCase() === want,
    );
    // Email visibility is a per-user privacy setting in Atlassian: one match without an email is the
    // person the query found.
    const only = users.length === 1 && !users[0]!.emailAddress ? users[0] : undefined;
    let out: AssigneeLookup;
    if (exact ?? only) out = { accountId: (exact ?? only)!.accountId };
    else {
      const all = await call('GET', `/user/search?query=${q}&maxResults=5`, {
        ...d,
        action: 'look up users',
      });
      const found = (Array.isArray(all.body) ? all.body : []) as JiraUser[];
      out = { problem: found.length ? 'assignee_not_in_project' : 'assignee_not_found' };
    }
    assignees.set(cacheKey, out);
    return out;
  }

  /** Issues carrying our key label in the given projects; confirmed by the entity property. */
  async function searchByKey(
    idempotencyKey: string,
    projects: readonly string[],
  ): Promise<ExternalTaskRef | null> {
    const clauses = [`labels = ${jqlString(idempotencyLabel(idempotencyKey))}`];
    // The integration account can browse only the mapped projects; the clause keeps the search there.
    if (projects.length) clauses.unshift(`project in (${projects.map(jqlString).join(', ')})`);
    const res = await call(
      'POST',
      '/search/jql',
      { write: false, action: 'search issues' },
      { jql: `${clauses.join(' AND ')} ORDER BY created ASC`, fields: ['key'], maxResults: 10 },
    );
    const issues = ((res.body as { issues?: { key?: string }[] } | null)?.issues ?? []).filter(
      (i) => typeof i.key === 'string',
    );
    for (const issue of issues) {
      const prop = await call(
        'GET',
        `/issue/${encodeURIComponent(issue.key!)}/properties/${IDEMPOTENCY_PROPERTY}`,
        { write: false, action: 'read the issue property' },
        undefined,
        (s) => s === 200 || s === 404,
      );
      const value = (prop.body as { value?: { key?: unknown } } | null)?.value;
      // The label is ours and carries the full key; the property, when present, must agree.
      if (prop.status === 404 || value?.key === idempotencyKey)
        return { key: issue.key!, url: `${await siteOf()}/browse/${issue.key!}` };
    }
    return null;
  }

  async function create(input: ExternalTaskInput): Promise<ExternalTaskRef> {
    const key = input.idempotencyKey;
    const existing = await searchByKey(key, [input.project]);
    if (existing) return existing;

    let accountId: string | null = null;
    if (input.assignee) {
      const a = await lookupAssignee(input.project, input.assignee);
      if ('problem' in a)
        throw new ConnectorError(
          'permission_denied',
          a.problem === 'assignee_not_in_project'
            ? `assignee ${input.assignee} is not a member of project ${input.project}`
            : `assignee ${input.assignee} was not found in Jira`,
        );
      accountId = a.accountId;
    }
    const d: RequestDescription = {
      write: true,
      action: `create an issue in project ${input.project}`,
      project: input.project,
      issueType: input.issueType,
      assignee: input.assignee,
    };
    const created = await call('POST', '/issue', d, {
      fields: {
        project: { key: input.project },
        issuetype: { name: input.issueType },
        summary: input.title,
        description: descriptionDoc(input),
        ...(accountId ? { assignee: { accountId } } : {}),
        ...(input.dueOn ? { duedate: input.dueOn } : {}),
        labels: [...new Set([...input.labels.map(jiraLabel), idempotencyLabel(key)])],
      },
      // The key is on the issue in the same request that creates it.
      properties: [{ key: IDEMPOTENCY_PROPERTY, value: { key } }],
    });
    const issueKey = (created.body as { key?: unknown } | null)?.key;
    if (typeof issueKey !== 'string') throw new ConnectorError('timeout_ambiguous', MESSAGES.timeout);
    // Set the property again (idempotent PUT) so success is reported only with the key on the issue.
    // The issue exists either way: any failure here is ambiguous and goes to reconcile, which finds it.
    try {
      await call(
        'PUT',
        `/issue/${encodeURIComponent(issueKey)}/properties/${IDEMPOTENCY_PROPERTY}`,
        { ...d, action: 'set the issue property' },
        { key },
      );
    } catch (e) {
      if (e instanceof ConnectorError && e.kind === 'token_expired') throw e;
      throw new ConnectorError('timeout_ambiguous', MESSAGES.timeout);
    }
    return { key: issueKey, url: `${await siteOf()}/browse/${issueKey}` };
  }

  // ---- the interface ----------------------------------------------------------------------------

  return {
    provider: JIRA_CLOUD_PROVIDER,

    async health(): Promise<ConnectorHealth> {
      const checkedAt = now().toISOString();
      try {
        await call('GET', '/myself', { write: false, action: 'read the integration account' });
        const missing: string[] = [];
        for (const project of await store.mappedProjects()) {
          const p = await permissions(project);
          for (const k of ['BROWSE_PROJECTS', 'CREATE_ISSUES', 'ASSIGN_ISSUES'] as const)
            if (!p[k]) missing.push(`${k.toLowerCase().replace(/_/g, ' ')} in ${project}`);
        }
        if (missing.length)
          return {
            status: 'missing_permission',
            checkedAt,
            message: `The integration account lacks: ${missing.join('; ')}.`,
          };
        return { status: 'connected', checkedAt, message: null };
      } catch (e) {
        let err: ConnectorError;
        try {
          err = storeError(e);
        } catch {
          // A health check never throws: anything unexpected reads as Unavailable.
          return { status: 'unavailable', checkedAt, message: 'The Jira connection could not be checked.' };
        }
        if (err.kind === 'token_expired') return { status: 'expired', checkedAt, message: err.message };
        if (err.kind === 'permission_denied')
          return { status: 'missing_permission', checkedAt, message: err.message };
        return { status: 'unavailable', checkedAt, message: err.message };
      }
    },

    async preview(items): Promise<PreviewItemResult[]> {
      const projectFacts = new Map<
        string,
        { exists: boolean; types: string[]; perms: Record<Permission, boolean> }
      >();
      for (const project of new Set(items.map((i) => i.project))) {
        const exists = await projectExists(project);
        projectFacts.set(project, {
          exists,
          types: exists ? await issueTypes(project) : [],
          perms: exists
            ? await permissions(project)
            : { BROWSE_PROJECTS: false, CREATE_ISSUES: false, ASSIGN_ISSUES: false },
        });
      }
      const out: PreviewItemResult[] = [];
      for (const item of items) {
        const f = projectFacts.get(item.project)!;
        const problems: string[] = [];
        const problemCodes: PreviewProblemCode[] = [];
        const add = (code: PreviewProblemCode | null, text: string) => {
          problems.push(text);
          if (code) problemCodes.push(code);
        };
        if (!f.exists) add('project_not_found', `project ${item.project} was not found in Jira`);
        else {
          if (!f.types.some((t) => t.toLowerCase() === item.issueType.toLowerCase()))
            add(
              'issue_type_not_found',
              `issue type ${item.issueType} is not available in project ${item.project}`,
            );
          if (!f.perms.CREATE_ISSUES || !f.perms.BROWSE_PROJECTS)
            add(
              'permission_denied',
              `the integration account cannot create issues in project ${item.project}`,
            );
          if (!item.assignee) add(null, `no assignee is mapped for "${item.title}"`);
          else {
            const a = await lookupAssignee(item.project, item.assignee);
            if ('problem' in a)
              add(
                a.problem,
                a.problem === 'assignee_not_in_project'
                  ? `assignee ${item.assignee} is not a member of project ${item.project}`
                  : `assignee ${item.assignee} was not found in Jira`,
              );
            else if (!f.perms.ASSIGN_ISSUES)
              add(
                'permission_denied',
                `the integration account cannot assign issues in project ${item.project}`,
              );
          }
        }
        out.push({
          title: item.title,
          assignee: item.assignee,
          fields: {
            project: item.project,
            issueType: item.issueType,
            ...(item.dueOn ? { dueOn: item.dueOn } : {}),
            labels: item.labels.join(', '),
          },
          problems,
          ...(problemCodes.length ? { problemCodes } : {}),
        });
      }
      return out;
    },

    createTask(input): Promise<ExternalTaskRef> {
      // Concurrent calls for one key in this process share one attempt (the outbox lease prevents
      // concurrent attempts across processes).
      const running = inflight.get(input.idempotencyKey);
      if (running) return running;
      const p = create(input).finally(() => inflight.delete(input.idempotencyKey));
      inflight.set(input.idempotencyKey, p);
      return p;
    },

    async findByIdempotencyKey(idempotencyKey): Promise<ExternalTaskRef | null> {
      let projects: string[];
      try {
        projects = await store.mappedProjects();
      } catch (e) {
        throw storeError(e);
      }
      return searchByKey(idempotencyKey, projects);
    },
  };
}
