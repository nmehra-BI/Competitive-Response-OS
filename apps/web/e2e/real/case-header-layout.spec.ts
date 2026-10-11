/**
 * Case header layout on the real stack (`aster-demo`, D-185). The next-decision card stretched to
 * 386 px and pushed the gate rail, the tabs and the screen out of the first viewport. Measured with the
 * browser's layout engine: the card sizes to its content, sits beside the title on a wide window and
 * under it at 1280 px and on a phone, and the rail, tabs and screen start inside the first viewport.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { resetStack } from '../support/real';
import type { PersonaKey } from '../support/personas';

test.beforeAll(() => resetStack('aster-demo'));

type Box = { x: number; y: number; width: number; height: number };

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} is not rendered`);
  return b;
}

const VIEWPORTS = [
  { width: 2000, height: 900, beside: true },
  { width: 1440, height: 900, beside: true },
  { width: 1280, height: 900, beside: false },
  { width: 390, height: 844, beside: false },
];
const TABS = ['thesis', 'sizing', 'economics', 'decisions', 'outcomes'];
const WHO: PersonaKey[] = ['elena', 'maya', 'jonas'];

for (const who of WHO) {
  test(`case header is compact for ${who}`, async ({ page, loginAs }) => {
    await loginAs(who);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const tab of TABS) {
        const at = `${who} · ${vp.width}px · ${tab}`;
        await page.goto(`/me/cases/ME-104/${tab}`);
        await expect(page.getByRole('navigation', { name: 'Case sections' })).toBeVisible();
        await expect(page.locator('.case-header[aria-busy="true"]')).toHaveCount(0);

        const card = await box(page, '.case-next');
        const title = await box(page, '.case-top__main');
        const rail = await box(page, '.case-rail');
        const tabs = await box(page, '.case-tabs');
        const header = await box(page, '.case-header');
        const screen = await box(page, '.case-header + *');

        // The card is sized to its content, never stretched.
        expect(card.height, at).toBeLessThan(260);
        if (vp.beside) {
          // Beside the title, aligned to its top.
          expect(card.x, at).toBeGreaterThan(title.x + title.width);
          expect(Math.abs(card.y - title.y), at).toBeLessThanOrEqual(1);
        } else {
          // Stacked under the title.
          expect(card.y, at).toBeGreaterThanOrEqual(title.y + title.height);
        }
        // Rail directly under the top row, tabs under the rail, screen directly under the header.
        expect(rail.y - Math.max(card.y + card.height, title.y + title.height), at).toBeLessThanOrEqual(24);
        expect(tabs.y - (rail.y + rail.height), at).toBeLessThanOrEqual(16);
        expect(screen.y - (header.y + header.height), at).toBeLessThanOrEqual(1);
        if (vp.width >= 1280) {
          // Rail, tabs and the start of the screen are inside the first viewport.
          expect(tabs.y + tabs.height, at).toBeLessThanOrEqual(vp.height);
          expect(screen.y, at).toBeLessThan(vp.height);
        }
        // No horizontal page scroll.
        await expect
          .poll(
            () =>
              page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
              ),
            { message: at },
          )
          .toBeLessThanOrEqual(0);
      }
    }
  });
}

test('the next-decision link keeps its target and is reachable without scrolling', async ({
  page,
  loginAs,
}) => {
  await loginAs('elena');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/me/cases/ME-104/thesis');
  const link = page.locator('.case-next').getByRole('link', { name: 'Open decision package' });
  await expect(link).toBeInViewport();
  await expect(link).toHaveAttribute('href', /^\/me\/cases\/ME-104\//);
});
