/**
 * First-run onboarding on the MSW mocks (ONBOARDING.md, D-190 onward): a first sign-in shows the welcome, the
 * tour plays after the click and can be skipped, the guide lists the role's steps, coach marks point at
 * elements that exist, a reload (second sign-in) shows no welcome, and the tour can be replayed. axe-clean.
 * The real-stack version (server state, audit, every coach-mark anchor) is real/onboarding.spec.ts.
 */
import { expect, test } from './support/fixtures';

test.use({ onboardingAutostart: true });

test('first sign-in: welcome → tour → skip; guide with role steps; coach mark; no welcome on the next load', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya');
  const welcome = page.getByRole('dialog', { name: 'Welcome to Market Expansion, Maya' });
  await expect(welcome).toBeVisible();
  await expect(welcome.getByRole('button', { name: 'Play the 90-second tour' })).toBeFocused();
  await expectAccessible();

  await welcome.getByRole('button', { name: 'Play the 90-second tour' }).click();
  const player = page.getByRole('dialog', { name: 'How Market Expansion works' });
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(player.getByTestId('explainer-caption')).toContainText('Expansion decisions usually live in');
  await player.getByRole('button', { name: /The measure ladder/ }).click();
  await expect(player.getByTestId('explainer-stage')).toHaveAttribute('data-chapter', 'ladder');
  await expectAccessible();
  await player.getByRole('button', { name: 'Skip tour' }).click();
  await expect(player).toBeHidden();

  // The guide: Maya's five build steps (all complete at the aster-demo moment).
  await page.getByRole('button', { name: /^Guide/ }).click();
  const panel = page.getByRole('complementary', { name: 'Getting started' });
  await expect(panel.getByText('Build the case')).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Your steps' }).getByRole('listitem')).toHaveCount(5);
  await expect(panel.getByText('5 of 5 complete')).toBeVisible();
  await expectAccessible();

  await panel.getByRole('button', { name: 'Show me: Size the market' }).click();
  await expect(page).toHaveURL(/\/me\/cases\/ME-104\/sizing/);
  const coach = page.getByRole('dialog', { name: 'Size the market' });
  await expect(coach).toHaveAttribute('data-anchored', 'true');
  await expect(page.locator('[data-coach-anchor="build.sizing"]')).toHaveCount(1);
  await expect(coach.getByRole('heading', { name: 'Size the market' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(coach).toBeHidden();

  // Second sign-in (reload): no welcome.
  await page.reload();
  await expect(page.getByRole('button', { name: /^Guide/ })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog', { name: /Welcome to Market Expansion/ })).toHaveCount(0);

  // Replay from the account menu.
  await page.getByRole('button', { name: /Account and display settings/ }).click();
  await page.getByRole('button', { name: 'Replay the tour' }).click();
  await expect(page.getByRole('dialog', { name: 'How Market Expansion works' })).toBeVisible();
});

test('reduced motion shows the storyboard instead of motion', async ({ page, loginAs }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAs('elena');
  await page.getByRole('button', { name: 'Play the 90-second tour' }).click();
  const player = page.getByRole('dialog', { name: 'How Market Expansion works' });
  await expect(player.getByText(/Storyboard · reduced motion/)).toBeVisible();
  await expect(player.getByRole('button', { name: /^(Play|Pause)$/ })).toHaveCount(0);
  await expect(player.getByRole('heading', { name: '1. Scattered decisions' })).toBeVisible();
});
