/**
 * First-run onboarding on the real stack (`aster-demo`; ONBOARDING.md, D-190 onward; WF-12):
 *
 * - a fresh persona sign-in shows the welcome (axe-clean); the tour plays after the click and can be skipped;
 *   both are stored on the server and audited;
 * - the checklist shows the role's steps, with Next from the real inbox ("You have a G2 decision waiting");
 * - every coach mark of every role path anchors to an element that exists on the page it opens;
 * - a second sign-in (new browser context, same person) shows no welcome; the tour replays from the menu;
 * - the demo reset shows the welcome again.
 *
 * Screenshots go to `ONB_SHOTS` when set (design review), else to the test output folder.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { apiCall, auditActions, resetStack } from '../support/real';
import type { PersonaKey } from '../support/personas';

test.use({ onboardingAutostart: true, viewport: { width: 1440, height: 900 } });
test.beforeAll(() => resetStack('aster-demo'));

const shotDir = process.env.ONB_SHOTS;
async function shot(page: Page, name: string, target?: ReturnType<Page['locator']>) {
  const dir = shotDir ?? test.info().outputPath('shots');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.png`);
  if (target) await target.screenshot({ path });
  else await page.screenshot({ path });
}

/** Sign in as a first-time person: clear their guide state (demo reset), then reload so the welcome shows. */
async function firstSignIn(page: Page, loginAs: (who: PersonaKey) => Promise<void>, who: PersonaKey) {
  await loginAs(who);
  const r = await apiCall(page, 'POST', '/dev/onboarding/reset');
  expect(r.status).toBe(200);
  await page.reload();
  await expect(page.getByRole('dialog', { name: /Welcome to Market Expansion/ })).toBeVisible();
}

/** Move the tour slider (a native range input) to a time in seconds. */
async function seek(page: Page, seconds: number) {
  await page.getByRole('slider', { name: 'Tour position' }).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
}

test('Elena’s first sign-in: welcome, tour (frames), skip; stored and audited; second sign-in is quiet', async ({
  page,
  browser,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('elena');
  const welcome = page.getByRole('dialog', { name: 'Welcome to Market Expansion, Elena' });
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText('Nothing is approved until you decide.');
  await expect(welcome.getByRole('button', { name: 'Play the 90-second tour' })).toBeFocused();
  await expectAccessible();
  await shot(page, '01-welcome-modal');

  await welcome.getByRole('button', { name: 'Play the 90-second tour' }).click();
  const player = page.getByRole('dialog', { name: 'How Market Expansion works' });
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
  await player.getByRole('button', { name: 'Pause' }).click();
  // One frame per chapter, near its end (the scene is a pure function of time).
  const ends = [8.5, 18.5, 30.5, 42.5, 55.5, 65.5, 75.5, 83.5];
  const ids = ['problem', 'case', 'kinds', 'ladder', 'gates', 'pilot', 'outcomes', 'role'];
  for (const [i, t] of ends.entries()) {
    await seek(page, t);
    await expect(player.getByTestId('explainer-stage')).toHaveAttribute('data-chapter', ids[i]!);
    await shot(page, `02-explainer-${i + 1}-${ids[i]}`, player);
  }
  await expect(player.getByTestId('explainer-caption')).toContainText('Illustrative data');
  await expect(player.getByRole('button', { name: 'Open Reviews' })).toBeVisible();
  await expectAccessible();
  await player.getByRole('button', { name: 'Close' }).click();
  await expect(player).toBeHidden();

  // Server state and audit (the never-downgraded "skipped" over nothing yet: Elena skipped).
  const me = await page.request.get('/api/v1/me/onboarding');
  expect(await me.json()).toMatchObject({ path: 'decide', welcomeSeen: true, explainer: 'skipped' });
  const audit = await auditActions();
  expect(audit.filter((a) => a === 'onboarding.updated').length).toBeGreaterThanOrEqual(2);

  // Second sign-in on another "device": no welcome.
  const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await other.newPage();
  await page2.goto('/login');
  await page2.getByRole('button', { name: /^Elena Fischer/ }).click();
  await page2.waitForURL((u) => !u.pathname.startsWith('/login'));
  await expect(page2.getByRole('button', { name: /^Guide/ })).toBeVisible();
  await page2.waitForTimeout(800);
  await expect(page2.getByRole('dialog', { name: /Welcome to Market Expansion/ })).toHaveCount(0);
  // Replay from the account menu.
  await page2.getByRole('button', { name: /Account and display settings/ }).click();
  await page2.getByRole('button', { name: 'Replay the tour' }).click();
  await expect(page2.getByRole('dialog', { name: 'How Market Expansion works' })).toBeVisible();
  await page2.keyboard.press('Escape');
  await expect(page2.getByRole('dialog', { name: 'How Market Expansion works' })).toBeHidden();
  await other.close();
});

test('the checklist shows Elena’s steps and Next from her real inbox', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await firstSignIn(page, loginAs, 'elena');
  await page
    .getByRole('dialog', { name: /Welcome/ })
    .getByRole('button', { name: 'Skip for now' })
    .click();
  await page.getByRole('button', { name: /^Guide/ }).click();
  const panel = page.getByRole('complementary', { name: 'Getting started' });
  await expect(panel.getByText('Decide investments')).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Your steps' }).getByRole('listitem')).toHaveCount(3);
  await expect(panel.getByText('You have a G2 decision waiting')).toBeVisible();
  await expect(panel).toContainText('Approve pilot €120k · 90 days · ME-104');
  await expect(panel).toContainText('Nothing is approved until you choose an action and give a rationale.');
  // She landed on Reviews, so "Open Reviews" is complete (a visit step).
  await expect(panel.locator('[data-step="decide.reviews"]')).toContainText('Complete');
  await expect(panel.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
  await expectAccessible();
  await shot(page, '03-checklist-elena');
});

const PATHS: [PersonaKey, string, number][] = [
  ['elena', 'Decide investments', 3],
  ['maya', 'Build the case', 5],
  ['jonas', 'Run the pilot', 4],
  ['daniel', 'Review what you are asked', 3],
  ['admin', 'Set up the workspace', 3],
];

for (const [who, label, count] of PATHS) {
  test(`coach marks anchor to elements that exist · ${who} · ${label}`, async ({ page, loginAs }) => {
    await firstSignIn(page, loginAs, who);
    await page
      .getByRole('dialog', { name: /Welcome/ })
      .getByRole('button', { name: 'Skip for now' })
      .click();
    for (let i = 0; i < count; i++) {
      await page.getByRole('button', { name: /^Guide/ }).click();
      const panel = page.getByRole('complementary', { name: 'Getting started' });
      await expect(panel.getByText(label)).toBeVisible();
      const item = panel.getByRole('list', { name: 'Your steps' }).getByRole('listitem').nth(i);
      const key = (await item.getAttribute('data-step'))!;
      await item.getByRole('button', { name: /^Show me/ }).click();
      const coach = page.getByTestId('coach-mark');
      await expect(coach).toHaveAttribute('data-step', key);
      await expect(coach).toHaveAttribute('data-anchored', 'true', { timeout: 5_000 });
      await expect(page.locator(`[data-coach-anchor="${key}"]`)).toHaveCount(1);
      await expect(page.locator(`[data-coach-anchor="${key}"]`)).toBeVisible();
      await expect(coach.getByRole('heading', { level: 2 })).toBeFocused();
      if (who === 'maya' && key === 'build.sizing') await shot(page, '04-coach-mark-sizing');
      if (who === 'elena' && key === 'decide.reviews') await shot(page, '04-coach-mark-reviews');
      await page.keyboard.press('Escape');
      await expect(coach).toBeHidden();
    }
  });
}

test('demo reset shows the welcome again; axe on the guide and a coach mark', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await firstSignIn(page, loginAs, 'jonas');
  await page
    .getByRole('dialog', { name: /Welcome/ })
    .getByRole('button', { name: 'Show me around' })
    .click();
  const panel = page.getByRole('complementary', { name: 'Getting started' });
  await expect(panel.getByText('Run the pilot')).toBeVisible();
  await expectAccessible();
  await panel.getByRole('button', { name: 'Show me: Review the pilot plan' }).click();
  await expect(page.getByTestId('coach-mark')).toHaveAttribute('data-anchored', 'true');
  await expectAccessible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Guide/ }).click();
  await panel.getByRole('button', { name: 'Reset onboarding (demo)' }).click();
  await expect(page.getByRole('dialog', { name: 'Welcome to Market Expansion, Jonas' })).toBeVisible();
  expect(await auditActions()).toContain('onboarding.reset');
});
