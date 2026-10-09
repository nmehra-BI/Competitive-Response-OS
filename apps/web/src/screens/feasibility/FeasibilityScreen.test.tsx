// @vitest-environment jsdom
/** S07 Feasibility against the MSW mocks. */
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { session } from '../../mocks/node';
import { mockServer, renderAt, resetAll } from '../sizing/test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetAll();
});
afterAll(() => mockServer.close());

function row(name: string) {
  const table = screen.getByRole('table', { name: 'Readiness checklist' });
  return within(table)
    .getByRole('rowheader', { name: new RegExp(`^${name}`) })
    .closest('tr')!;
}

describe('S07 Feasibility', () => {
  it('lists named reviewers; the specialist row stays pending and human-only; no readiness score', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/feasibility');
    await screen.findByRole('table', { name: 'Readiness checklist' });
    const spec = row('Specialist review');
    expect(spec.textContent).toContain('Lena Hoffmann');
    expect(spec.textContent).toContain('Pending — human review required');
    expect(spec.textContent).toContain('AI cannot provide this review');
    expect(spec.textContent).toContain('Blocks G2 until signed');
    expect(spec.textContent).not.toContain('Signed');
    expect(row('Differentiation').textContent).toContain('Signed');
    expect(row('Differentiation').textContent).toContain('Disagreement · Jonas Klein');
    expect(screen.getByText('No readiness score: each dimension stands on its own sign-off.')).toBeTruthy();
    expect(screen.queryByText(/score:? \d/i)).toBeNull();
  });

  it('records a signed disagreement in the author’s words', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/feasibility');
    await screen.findByRole('table', { name: 'Readiness checklist' });
    fireEvent.click(screen.getByRole('button', { name: 'Record disagreement · Operations' }));
    const form = screen.getByRole('form', { name: 'Record disagreement · Operations' });
    fireEvent.change(within(form).getByLabelText(/Your position, in your own words/), {
      target: { value: 'Capacity model ignores winter installation limits.' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Record disagreement' }));
    await waitFor(() =>
      expect(row('Operations').textContent).toContain('Capacity model ignores winter installation limits.'),
    );
    expect(row('Operations').textContent).toContain('Disagreement · Maya Rao');
  });

  it('requests a review for a pending dimension', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/feasibility');
    await screen.findByRole('table', { name: 'Readiness checklist' });
    fireEvent.click(screen.getByRole('button', { name: 'Request review · Operations' }));
    await waitFor(() => expect(row('Operations').textContent).toContain('Review requested'));
  });

  it('only the named specialist can sign; a scoped pilot sign-off resolves the G2 blocker', async () => {
    session.signIn(people.maya.id);
    const first = renderAt('/me/cases/ME-104/feasibility');
    await screen.findByRole('table', { name: 'Readiness checklist' });
    expect(within(row('Specialist review')).queryByRole('button', { name: 'Record review' })).toBeNull();
    first.unmount();
    session.signIn(people.lena.id);
    renderAt('/me/cases/ME-104/feasibility');
    await screen.findByRole('table', { name: 'Readiness checklist' });
    fireEvent.click(within(row('Specialist review')).getByRole('button', { name: 'Record review' }));
    const form = screen.getByRole('form', { name: /Record your review · Specialist review/ });
    fireEvent.change(within(form).getByLabelText(/Up to sites/), { target: { value: '4' } });
    fireEvent.change(within(form).getByLabelText(/Up to days/), { target: { value: '90' } });
    fireEvent.change(within(form).getByLabelText(/Scope of sign-off/), {
      target: { value: 'Signed for pilot only: up to 4 sites, 90 days' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Record review' }));
    await waitFor(() => expect(row('Specialist review').textContent).toContain('Signed · pilot scope'));
    expect(row('Specialist review').textContent).toContain('Signed for pilot only: up to 4 sites, 90 days');
    expect(row('Specialist review').textContent).not.toContain('Blocks G2 until signed');
  });
});
