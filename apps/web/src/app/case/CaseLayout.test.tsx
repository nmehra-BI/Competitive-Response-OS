// @vitest-environment jsdom
/**
 * Case header layout (D-185). The next-decision card once grew to 386 px and pushed the gate rail, the
 * tabs and the screen below the fold: `.case-next` carried the row's `flex: 0 1 360px` while sitting in
 * a column-flex wrapper, where that basis is a height. jsdom has no layout engine, so this file pins the
 * structure (aside is the row item, rail and tabs follow the top row) and the CSS rules that size it;
 * `e2e/real/case-header-layout.spec.ts` measures the real page.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { people } from '@growth-os/fixtures-aster';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createQueryClient } from '../../lib/query';
import { mockServer, resetMockState, resetReplay, session } from '../../mocks/node';
import { AppProviders } from '../providers';
import { buildRoutes } from '../router';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  resetMockState();
  resetReplay();
});
afterAll(() => mockServer.close());

const css = readFileSync(join(__dirname, '..', 'app.css'), 'utf8');

/** Declarations of one exact selector block in app.css, as a property → value map. */
function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  const body = m[1]!.replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries(
    body
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const i = d.indexOf(':');
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
      }),
  );
}

describe('case header layout', () => {
  it('puts the next decision in an aside beside the title, with rail, tabs and screen directly after', async () => {
    session.signIn(people.elena.id);
    const router = createMemoryRouter(buildRoutes(), { initialEntries: ['/me/cases/ME-104/thesis'] });
    render(
      <AppProviders client={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    await screen.findByRole('heading', { level: 1, name: 'German food-processing plants — monitoring' });
    const header = screen.getByRole('region', { name: 'Case header' });
    const top = header.querySelector(':scope > .case-top')!;
    expect([...top.children].map((c) => c.className)).toEqual(['case-top__main', 'case-top__aside']);
    const aside = top.querySelector(':scope > .case-top__aside')!;
    const card = aside.querySelector(':scope > .case-next')!;
    expect(card.querySelector('h2')?.textContent).toBe('Next decision');
    // No inline sizing on the aside: its size comes from the stylesheet rules pinned below.
    expect(aside.getAttribute('style')).toBeNull();
    expect(card.getAttribute('style')).toBeNull();
    // Rail and tabs are the next siblings of the top row (never inside a column), then the screen.
    expect([...header.children].map((c) => c.className)).toEqual([
      'case-crumbs',
      'case-top',
      'case-rail',
      'case-tabs',
    ]);
    expect(header.nextElementSibling).not.toBeNull();
  });

  it('sizes the aside as the row item and lets the card size to its content', () => {
    const aside = rule('.case-top__aside');
    expect(aside.flex).toBe('0 1 360px');
    expect(aside['align-self']).toBe('flex-start');
    expect(aside['flex-direction']).toBe('column');
    // Inside the column aside, any flex basis on the card would become its height.
    const card = rule('.case-next');
    expect(card.flex).toBe('none');
    expect(card['flex-basis']).toBeUndefined();
    expect(card['min-height']).toBeUndefined();
    expect(card.height).toBeUndefined();
    // Wraps under the title once the title block cannot keep 640 px (1280 px windows, phones).
    expect(rule('.case-top__main').flex).toBe('1 1 640px');
    expect(rule('.case-top')['flex-wrap']).toBe('wrap');
    // The tab strip clips its visually hidden count prefixes, so it never widens the page.
    expect(rule('.case-tabs').position).toBe('relative');
    expect(rule('.case-tabs')['overflow-x']).toBe('auto');
  });
});
