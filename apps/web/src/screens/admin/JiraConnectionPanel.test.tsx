// @vitest-environment jsdom
/**
 * S14 Jira Cloud panel (W4-E5): the status line names the integration account; returning from
 * Atlassian's consent page finishes the authorization once (connection from the state prefix) and
 * removes the code from the address bar.
 */
import { API, API_PREFIX, type Connection } from '@growth-os/contracts';
import { people } from '@growth-os/fixtures-aster';
import { cleanup, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mockServer, resetMockState, resetReplay, session } from '../../mocks/node';
import { renderAt } from '../pilot/test-utils';
import { jiraStatusLine } from './JiraConnectionPanel';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
});
afterAll(() => mockServer.close());

const CONN = '6f1d3b52-9c1e-4b8a-a1f0-1c2d3e4f5a6b';
const jira = (over: Partial<Connection> = {}): Connection => ({
  id: CONN,
  kind: 'task_tool',
  provider: 'jira_cloud',
  name: 'Jira Cloud · PIL, ME-VAL',
  scopeText:
    'Jira Cloud aster-industrial.atlassian.net · Browse, Create and Assign in the mapped projects only',
  status: 'connected',
  lastSuccessAt: '2026-10-10T08:00:00Z',
  lastCheckedAt: '2026-10-10T08:00:00Z',
  usedFor: 'Validation and pilot tasks',
  jira: {
    siteUrl: 'https://aster-industrial.atlassian.net',
    cloudId: '11111111-2222-4333-8444-555555555555',
    accountDisplayName: 'Growth OS integration',
    scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
    tokenExpiresAt: '2026-10-10T09:00:00Z',
    authorizedBy: { id: people.admin.id, displayName: 'Admin', title: null, initials: 'AD' },
    authorizedAt: '2026-10-10T08:00:00Z',
  },
  ...over,
});

describe('Jira Cloud panel', () => {
  it('status lines', () => {
    expect(jiraStatusLine(jira())).toBe('Connected · Growth OS integration');
    expect(jiraStatusLine(jira({ status: 'expired' }))).toBe('Jira connection expired');
    expect(jiraStatusLine(jira({ status: 'expired', jira: { ...jira().jira!, authorizedAt: null } }))).toBe(
      'Not connected yet',
    );
    expect(jiraStatusLine(jira({ status: 'missing_permission' }))).toBe(
      'Missing permission in a mapped project',
    );
  });

  it('finishes the consent redirect once and shows the connected integration account', async () => {
    const calls: { id: string; body: unknown }[] = [];
    let connected = false;
    mockServer.use(
      http.get(`*${API_PREFIX}${API.admin.connections.path}`, () =>
        HttpResponse.json({ items: [jira(connected ? {} : { status: 'expired' })], mappings: [] }),
      ),
      http.post(
        `*${API_PREFIX}/admin/connections/:id/authorization/callback`,
        async ({ params, request }) => {
          calls.push({ id: String(params.id), body: await request.json() });
          connected = true;
          return HttpResponse.json(jira());
        },
      ),
    );
    session.signIn(people.admin.id);
    const state = `${CONN}.${'A'.repeat(43)}`;
    const router = renderAt(`/admin/connections?code=code-123&state=${encodeURIComponent(state)}`);
    expect(
      await screen.findByText('Jira Cloud · PIL, ME-VAL: Connected · Growth OS integration.'),
    ).toBeTruthy();
    expect(calls).toEqual([{ id: CONN, body: { code: 'code-123', state } }]);
    expect(router.state.location.search).toBe('');
    expect((await screen.findAllByTestId('jira-status-line')).map((e) => e.textContent)).toEqual([
      'Connected · Growth OS integration',
    ]);
  });
});
