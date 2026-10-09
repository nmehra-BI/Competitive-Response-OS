// @vitest-environment jsdom
/** S06 Sizing against the MSW mocks (acceptance steps 6–8 and the blocking variants). */
import { people } from '@growth-os/fixtures-aster';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { session } from '../../mocks/node';
import { setAssessmentScenario } from './mock-state';
import { mockServer, renderAt, resetAll } from './test-utils';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetAll();
  sessionStorage.clear();
});
afterAll(() => mockServer.close());

function ladderRow(name: string | RegExp) {
  return screen.getByRole('group', { name });
}

describe('S06 Sizing', () => {
  it('shows the measure ladder with exact fixture values and no total row (step 6)', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/sizing');
    expect(await screen.findByRole('heading', { name: 'Measure ladder' }, { timeout: 5000 })).toBeTruthy();
    const tam = await waitFor(() => ladderRow('TAM'));
    expect(tam.textContent).toContain('5,000 unique sites');
    expect(tam.textContent).toContain('€100m/year');
    const sam = ladderRow('SAM');
    expect(sam.textContent).toContain('2,000 unique sites');
    expect(sam.textContent).toContain('€40m/year');
    const reach = ladderRow('Reachable pool');
    expect(reach.textContent).toContain('500 unique sites');
    expect(reach.textContent).toContain('—');
    expect(reach.textContent).not.toContain('€');
    const som = ladderRow('SOM · Base · Year 3');
    expect(som.textContent).toContain('100 customers');
    expect(som.textContent).toContain('€2.0m annual revenue');
    // Signed overlap arithmetic from the engine.
    expect(screen.getByRole('group', { name: 'Formula for SAM' }).textContent).toContain(
      '(1,400 + 1,100 − 500) × €20,000',
    );
    expect(screen.getByText('−500')).toBeTruthy();
    // No total row anywhere on the ladder.
    expect(screen.queryByRole('group', { name: /total/i })).toBeNull();
    expect(screen.getAllByRole('group').filter((g) => g.hasAttribute('data-measure'))).toHaveLength(4);
    expect(screen.getByText(/No total row\./)).toBeTruthy();
  });

  it('switches the SOM scenario and shows the capacity cap for Upside', async () => {
    session.signIn(people.maya.id);
    const { router } = renderAt('/me/cases/ME-104/sizing');
    await screen.findByRole('heading', { name: 'Measure ladder' });
    fireEvent.click(await screen.findByRole('button', { name: '▲ Upside' }));
    const som = await waitFor(() => ladderRow('SOM · Upside · Year 3'));
    expect(som.textContent).toContain('120 customers');
    expect(som.textContent).toContain('€2.4m annual revenue');
    expect(screen.getByText(/capped at 120/)).toBeTruthy();
    expect(router.state.location.search).toContain('scenario=upside');
  });

  it('blocks when the TAM edit makes SAM larger than TAM; ladder hidden; undo restores (step 7)', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/sizing');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit draft input' }));
    const form = screen.getByRole('form', { name: 'Edit a draft input' });
    fireEvent.change(within(form).getByLabelText(/New value/), { target: { value: '500' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save to draft' }));
    expect(await screen.findByText('Blocking: SAM is larger than TAM')).toBeTruthy();
    expect(screen.getByText('Ladder values are hidden while a blocking check is open')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'SAM' })).toBeNull();
    expect(screen.queryByText('€40m/year')).toBeNull();
    const snap = screen.getByRole('button', { name: 'Create snapshot v2' }) as HTMLButtonElement;
    expect(snap.disabled).toBe(true);
    expect(screen.getByText('Blocked: SAM above TAM.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    await waitFor(() => expect(screen.queryByText('Blocking: SAM is larger than TAM')).toBeNull());
    expect((await waitFor(() => ladderRow('SAM'))).textContent).toContain('€40m/year');
  });

  it('pauses on a duplicate cohort until one is kept', async () => {
    session.signIn(people.maya.id);
    setAssessmentScenario({ sizingVariant: 'duplicate_cohort' });
    renderAt('/me/cases/ME-104/sizing');
    expect(await screen.findByText('Duplicate cohort — calculation paused')).toBeTruthy();
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0);
    expect(screen.queryByRole('group', { name: 'TAM' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Create snapshot v2' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('Blocked: resolve the duplicate cohort.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep v1' }));
    await waitFor(() => expect(screen.queryByText('Duplicate cohort — calculation paused')).toBeNull());
    expect((await waitFor(() => ladderRow('SAM'))).textContent).toContain('€40m/year');
  });

  it('commits v2 and opens lineage on SAM with exact value, inputs and used-by (step 8)', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/sizing');
    fireEvent.click(await screen.findByRole('button', { name: 'Create snapshot v2' }));
    expect(await screen.findByText(/Snapshot v2 · committed/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Lineage for SAM' }));
    const dialog = await screen.findByRole('dialog', { name: 'SAM' });
    await waitFor(() => expect(dialog.textContent).toContain('€40,000,000'));
    expect(dialog.textContent).toContain('Inputs · one level');
    expect(dialog.textContent).toContain('Size-qualified');
    expect(dialog.textContent).toContain('Overlap removed');
    const usedBy = within(dialog)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(usedBy).toEqual(expect.arrayContaining(['SOM', 'Economics']));
  });

  it('shows the restricted site-list banner for an aggregate-only viewer', async () => {
    session.signIn(people.jonas.id);
    renderAt('/me/cases/ME-104/sizing');
    expect(await screen.findByText('Site list restricted under your access')).toBeTruthy();
  });

  it('opens the lineage drawer from the research deep link', async () => {
    session.signIn(people.maya.id);
    renderAt('/me/cases/ME-104/sizing?input=adoption-rate&view=lineage');
    const dialog = await screen.findByRole('dialog', { name: 'Adoption by year 3 · Base' });
    await waitFor(() => expect(dialog.textContent).toContain('20%'));
  });
});
