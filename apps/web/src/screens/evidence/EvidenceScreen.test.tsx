// @vitest-environment jsdom
/** S13 Evidence against the MSW mocks: permitted excerpt, restricted, deleted, superseded, actions. */
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mockServer, resetMockState, resetReplay, session } from '../../mocks/node';
import { renderAt } from '../pilot/test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
});
afterAll(() => mockServer.close());

describe('S13 Evidence', () => {
  it('shows the permitted excerpt, dates, licence boundary, linked claims and impact', async () => {
    session.signIn(people.maya.id);
    renderAt('/evidence/SRC-014?case=ME-104');
    const viewer = await screen.findByRole('article', { name: 'Source viewer' });
    expect(await within(viewer).findByText(/Permitted excerpt · Table 2/)).toBeTruthy();
    const quote = viewer.querySelector('blockquote')!;
    expect(quote.className).toContain('ws8d-blockquote');
    expect(quote.textContent).toContain('5,000 food-processing sites');
    expect(within(viewer).getByText('3 Jun 2026')).toBeTruthy();
    expect(within(viewer).getByText(/excerpts up to 2 sentences/)).toBeTruthy();
    expect(within(viewer).getByText('TAM site count · 5,000')).toBeTruthy();
    expect(within(viewer).getByText('Current · supersedes SRC-009')).toBeTruthy();
    const side = screen.getByRole('complementary', { name: 'Fact, inference and assumption' });
    expect(within(side).getByText('Quoted fact')).toBeTruthy();
    expect(within(side).getByText('Cases you cannot access are not listed or counted.')).toBeTruthy();
  });

  it('restricted source shows no excerpt, fact or paraphrase anywhere', async () => {
    session.signIn(people.maya.id);
    renderAt('/evidence/SRC-030?case=ME-104');
    expect(await screen.findByText('Restricted source · no excerpt shown')).toBeTruthy();
    expect(document.querySelector('blockquote')).toBeNull();
    expect(screen.getAllByText('Not shown — restricted.')).toHaveLength(2);
    expect(screen.queryByText(/Permitted excerpt/)).toBeNull();
  });

  it('aggregate-only viewers (pilot owner) never see the site census excerpt', async () => {
    session.signIn(people.jonas.id);
    renderAt('/evidence/SRC-014');
    expect(await screen.findByText('Aggregates only · no excerpt shown')).toBeTruthy();
    expect(document.querySelector('blockquote')).toBeNull();
    expect(document.body.textContent).not.toContain('process-water treatment step.]');
  });

  it('deleted source keeps provenance; superseded edition links to the current one', async () => {
    session.signIn(people.maya.id);
    renderAt('/evidence/SRC-011?case=ME-104');
    expect(await screen.findByText('Source deleted by provider · provenance kept')).toBeTruthy();
    expect(screen.getByText(/fingerprint 91C0·4A7E kept/)).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /SRC-009/ }));
    expect((await screen.findAllByText(/Superseded by SRC-014/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Open SRC-014' })).toBeTruthy();
  });

  it('challenge and mark stale require text and report the result', async () => {
    session.signIn(people.maya.id);
    renderAt('/evidence/SRC-021?case=ME-104');
    fireEvent.click(await screen.findByRole('button', { name: 'Challenge' }));
    const send = screen.getByRole('button', { name: 'Send challenge' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/What is wrong with this source/), {
      target: { value: 'Survey counts responders only.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send challenge' }));
    expect(await screen.findByText(/Challenge sent to the source owner/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark stale' }));
    fireEvent.change(screen.getByLabelText(/Why is it stale/), {
      target: { value: 'A 2027 survey exists.' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark stale' })[1]!);
    expect(await screen.findByText('Marked stale')).toBeTruthy();
  });
});
