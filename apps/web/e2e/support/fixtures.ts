/**
 * Shared Playwright fixtures for every e2e spec (WS7 harness):
 *
 *   import { test, expect } from './support/fixtures';
 *   test('…', async ({ page, loginAs, expectAccessible }) => {
 *     await loginAs('elena');                       // persona picker → landing page
 *     await page.goto('/me/cases/ME-104/decisions?gate=G2&version=3');
 *     await expectAccessible();                     // axe, WCAG 2.2 AA
 *   });
 *
 * `mockScenario` switches MSW variants when the app runs on mocks (E2E_MOCKS default on).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';
import { PERSONAS, type PersonaKey } from './personas';

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export interface A11yOptions {
  /** CSS selectors to limit the scan (default: whole page). */
  include?: string[];
  exclude?: string[];
  /** Rules to skip, each with a reason in the calling spec. Use sparingly. */
  disableRules?: string[];
}

export async function axeViolations(page: Page, opts: A11yOptions = {}) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const s of opts.include ?? []) builder = builder.include(s);
  for (const s of opts.exclude ?? []) builder = builder.exclude(s);
  if (opts.disableRules?.length) builder = builder.disableRules(opts.disableRules);
  const { violations } = await builder.analyze();
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
}

export async function loginAs(page: Page, who: PersonaKey, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByRole('button', { name: new RegExp(`^${escape(PERSONAS[who].name)}`) }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type Fixtures = {
  loginAs: (who: PersonaKey, next?: string) => Promise<void>;
  expectAccessible: (opts?: A11yOptions) => Promise<void>;
  mockScenario: (s: { g2Stale?: boolean }) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  loginAs: async ({ page }, use) => {
    await use((who, next) => loginAs(page, who, next));
  },
  expectAccessible: async ({ page }, use) => {
    await use(async (opts) => {
      expect(await axeViolations(page, opts)).toEqual([]);
    });
  },
  mockScenario: async ({ page }, use) => {
    await use(async (s) => {
      await page.evaluate((scenario) => {
        const m = (window as unknown as { __growthOsMocks?: { setScenario: (x: unknown) => void } })
          .__growthOsMocks;
        if (!m) throw new Error('mockScenario needs the app running on MSW mocks (E2E_MOCKS=1)');
        m.setScenario(scenario);
      }, s);
    });
  },
});

export { expect };
