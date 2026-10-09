// @vitest-environment jsdom
/** S14 Administration and the History tab against the MSW mocks (acceptance steps 29–30). */
import { API } from '@growth-os/contracts';
import { gates, people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api, ApiProblem } from '../../lib/api-client';
import { G2_HASH, G2_SNAPSHOT_ID } from '../../mocks/data';
import { mockServer, resetMockState, resetReplay, session } from '../../mocks/node';
import { seedWs8d } from '../history/journey';
import { renderAt } from '../pilot/test-utils';
import { DIAGNOSTICS_RUN_ID } from './mocks';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
});
afterAll(() => mockServer.close());

const INFRA = /\b(agent|MCP|harness|tokens?)\b/i;

describe('S14 Administration', () => {
  it('shows the authority gap, the no-approval banner and connection states (step 29)', async () => {
    session.signIn(people.admin.id);
    renderAt('/admin/health');
    expect(await screen.findByText('Administrators cannot approve gates.')).toBeTruthy();
    expect(await screen.findByText(/Authority gap · G3/)).toBeTruthy();
    expect(screen.getAllByText(/No G3 approver for BU Water above €\[limit\]/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('up to €[limit]').length).toBeGreaterThan(0);
    const conns = await screen.findByRole('table', { name: 'Connections' });
    for (const s of ['Connected', 'Expired', 'Missing permission', 'Unavailable'])
      expect(within(conns).getAllByText(s).length).toBeGreaterThan(0);
    fireEvent.click(within(conns).getByRole('button', { name: 'Reconnect Finance export' }));
    expect(await screen.findByText(/Finance export reconnected/)).toBeTruthy();
  });

  it('keeps infrastructure terms inside Diagnostics only', async () => {
    session.signIn(people.admin.id);
    renderAt(`/admin/diagnostics?run=${DIAGNOSTICS_RUN_ID}`);
    expect(await screen.findByRole('table', { name: 'Tool events' })).toBeTruthy();
    expect(screen.getByText('denied · not summarised')).toBeTruthy();
    const diag = document.getElementById('admin-diagnostics')!;
    const outside = Array.from(document.querySelectorAll('main .ws8d-admin-section'))
      .filter((s) => s !== diag)
      .map((s) => s.textContent ?? '')
      .join(' ');
    expect(outside).not.toMatch(INFRA);
    expect(diag.textContent).toMatch(/MCP servers/);
  });

  it('non-admins see no administration data; admins cannot approve gates (FORBIDDEN)', async () => {
    session.signIn(people.maya.id);
    renderAt('/admin/health');
    expect(
      await screen.findByText('Administration is available to tenant administrators only.'),
    ).toBeTruthy();
    session.signIn(people.admin.id);
    try {
      await api(API.gates.decide, {
        params: { id: gates.g2.id },
        body: {
          snapshotId: G2_SNAPSHOT_ID,
          snapshotHash: G2_HASH,
          disposition: 'approve',
          rationale: 'x',
          note: null,
          conditions: [],
          delegateToUserId: null,
        },
        idempotencyKey: '00000000-0000-4000-8000-000000000001',
      });
      throw new Error('expected a refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiProblem);
      expect((e as ApiProblem).code).toBe('FORBIDDEN');
    }
  });
});

describe('History tab', () => {
  it('lists every recorded step once, in audit order with actor and version (step 30)', async () => {
    seedWs8d({ pilotVariant: 'timeout', outcomesMoment: 'decided' });
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/history');
    const table = await screen.findByRole('table', { name: 'Audit history' });
    const rows = within(table).getAllByRole('row').slice(1);
    const seqs = rows.map((r) => Number(within(r).getAllByRole('cell')[0]!.textContent));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(
      within(table).getByText('Activated the approved pilot plan v1 · stage Pilot running'),
    ).toBeTruthy();
    expect(within(table).getAllByText(/Decision recorded: Revise and extend validation/)).toHaveLength(1);
    expect(within(table).getAllByText('Sponsor').length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/· v\d/).length).toBeGreaterThan(0);
  });

  it('filters by object from the deep link', async () => {
    seedWs8d({ outcomesMoment: 'decided' });
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/history?object=outcome_observation');
    expect(await screen.findByText(/Showing Outcome actual/)).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Audit history' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
  });
});
