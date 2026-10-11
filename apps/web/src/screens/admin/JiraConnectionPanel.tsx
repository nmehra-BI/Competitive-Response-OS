/**
 * S14 · Jira Cloud connection (W4-E5, D-121, D-135). An administrator adds the Jira Cloud site, then
 * connects it as the dedicated integration account through Atlassian's consent page. Atlassian sends
 * the browser back to /admin/connections?code=…&state=… (the one registered redirect URL); this panel
 * finishes the authorization once and removes the code from the address bar. The connection id
 * comes from the `connection` query or the state's prefix.
 *
 * Administrators configure; they never approve (never-rule 6). No secret ever reaches the page.
 */
import { API, type Connection } from '@growth-os/contracts';
import { Banner, Button, ConnectorStatusTag, SectionHeader, Skeleton } from '@growth-os/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';
import { fmtDateTime } from '../history/dates';

const STATE_CONNECTION = /^([0-9a-f-]{36})\./;

/** "Connected · Growth OS integration" — the status line of an authorized Jira connection. */
export function jiraStatusLine(c: Connection): string {
  const who = c.jira?.accountDisplayName;
  if (c.status === 'connected') return who ? `Connected · ${who}` : 'Connected';
  if (c.status === 'expired') return c.jira?.authorizedAt ? 'Jira connection expired' : 'Not connected yet';
  if (c.status === 'missing_permission') return 'Missing permission in a mapped project';
  return 'Unavailable';
}

export function JiraConnectionPanel() {
  const q = useApiQuery(API.admin.connections);
  const create = useCommand(API.admin.createConnection);
  const authorize = useCommand(API.admin.authorizeConnection);
  const complete = useCommand(API.admin.completeAuthorization);
  const [params, setParams] = useSearchParams();
  const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const finishing = useRef(false);
  const ids = { name: useId(), site: useId(), used: useId() };
  const [name, setName] = useState('Jira Cloud · PIL, ME-VAL');
  const [site, setSite] = useState('');
  const [usedFor, setUsedFor] = useState('Validation and pilot tasks');

  // Return from Atlassian's consent page: finish once, then drop the code from the address bar.
  const code = params.get('code');
  const state = params.get('state');
  useEffect(() => {
    if (!code || !state || finishing.current) return;
    finishing.current = true;
    const id = params.get('connection') ?? STATE_CONNECTION.exec(state)?.[1] ?? null;
    const next = new URLSearchParams(params);
    for (const k of ['code', 'state', 'connection']) next.delete(k);
    setParams(next, { replace: true });
    if (!id) {
      setErr(new Error('This authorization link is not valid any more. Start the connection again.'));
      return;
    }
    complete
      .mutateAsync({ params: { id }, body: { code, state } })
      .then((c) => {
        setNote(`${c.name}: ${jiraStatusLine(c)}.`);
        void q.refetch();
      })
      .catch((e: unknown) => setErr(e));
  }, [code, state, params, setParams, complete, q]);

  const jira = (q.data?.items ?? []).filter((c) => c.provider === 'jira_cloud');

  const add = async () => {
    setErr(null);
    try {
      const c = await create.mutateAsync({
        body: {
          kind: 'task_tool',
          provider: 'jira_cloud',
          name: name.trim(),
          siteUrl: site.trim(),
          usedFor: usedFor.trim(),
        },
      });
      setNote(`${c.name} added. Connect it as the integration account to start.`);
      await q.refetch();
    } catch (e) {
      setErr(e);
    }
  };

  const connect = async (c: Connection) => {
    setErr(null);
    try {
      const r = await authorize.mutateAsync({ params: { id: c.id } });
      window.location.assign(r.authorizeUrl);
    } catch (e) {
      setErr(e);
    }
  };

  const siteValid = /^https:\/\/[^\s/]+/.test(site.trim());
  return (
    <section id="admin-jira" className="ws8d-admin-section" aria-labelledby="admin-jira-h">
      <SectionHeader
        id="admin-jira-h"
        title="Jira Cloud"
        subtitle="Connect as the dedicated integration account, not a personal account"
      />
      <Banner
        tone="info"
        live={false}
        title="Growth OS asks Jira for: read and write Jira work, read users, offline access."
        body="Your Jira admin gives the integration account Browse, Create and Assign in the mapped projects only. Sending tasks still needs an approved gate in Growth OS; Jira permissions never approve anything."
      />
      {q.isPending ? (
        <Skeleton height={80} />
      ) : (
        <div className="gos-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
          {jira.map((c) => (
            <div
              key={c.id}
              className="ws8d-row"
              style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div className="ws8d-sub">{c.jira?.siteUrl ?? c.scopeText}</div>
                <div className="ws8d-note" data-testid="jira-status-line">
                  {jiraStatusLine(c)}
                </div>
                {c.jira?.authorizedAt ? (
                  <div className="ws8d-sub">
                    Authorized{c.jira.authorizedBy ? ` by ${c.jira.authorizedBy.displayName}` : ''} ·{' '}
                    {fmtDateTime(c.jira.authorizedAt)}
                  </div>
                ) : null}
              </div>
              <div className="ws8d-row" style={{ gap: 8 }}>
                <ConnectorStatusTag status={c.status} />
                {c.status !== 'connected' ? (
                  <Button
                    variant="primary"
                    onClick={() => connect(c)}
                    ariaLabel={`Connect ${c.name} as the integration account`}
                  >
                    Connect as integration account
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          <form
            className="ws8d-row"
            style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
            aria-label="Add a Jira Cloud connection"
            onSubmit={(e) => {
              e.preventDefault();
              if (siteValid) void add();
            }}
          >
            <label className="gos-field" htmlFor={ids.name}>
              <span>Name</span>
              <input
                id={ids.name}
                className="gos-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="gos-field" htmlFor={ids.site}>
              <span>
                Jira Cloud site <span className="gos-field__hint">(https://your-site.atlassian.net)</span>
              </span>
              <input
                id={ids.site}
                className="gos-input"
                inputMode="url"
                placeholder="https://your-site.atlassian.net"
                value={site}
                onChange={(e) => setSite(e.target.value)}
              />
            </label>
            <label className="gos-field" htmlFor={ids.used}>
              <span>Used for</span>
              <input
                id={ids.used}
                className="gos-input"
                value={usedFor}
                onChange={(e) => setUsedFor(e.target.value)}
              />
            </label>
            <Button
              variant="secondary"
              type="submit"
              disabled={!siteValid || !name.trim() || !usedFor.trim()}
              disabledReason="Enter the name, the https address of the Jira Cloud site and what it is used for."
            >
              Add Jira Cloud connection
            </Button>
          </form>
        </div>
      )}
      {err ? <ProblemBanner error={err} /> : null}
      <p role="status" className="ws8d-note" style={{ margin: 0 }}>
        {note ?? ''}
      </p>
    </section>
  );
}
