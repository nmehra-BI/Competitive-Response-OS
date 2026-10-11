/**
 * Alternate path · AI down, against the second API started with ANALYSIS_ENABLED=false (project
 * `real-ai-down`, which also runs the whole Aster journey on it). Starting or resuming analysis is
 * refused with "Continue by hand"; nothing in the workflow depends on it (D-074).
 */
import { expect, test } from '../support/fixtures';
import { apiCall, resetStack } from '../support/real';

test.beforeAll(() => resetStack('aster-demo'));

test('analysis is refused with "Continue by hand" and the case screens still work', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await loginAs('maya', '/me/cases/ME-104/thesis');
  const start = await apiCall<{ code: string; title: string }>(
    page,
    'POST',
    '/me/cases/ME-104/analysis-runs',
    {
      skill: 'ability-to-win-assessment',
      goal: 'Assess ability to win',
      focus: {},
    },
  );
  expect(start.status).toBe(503);
  expect(start.json.title).toBe('Analysis is turned off. Continue by hand; nothing depends on it.');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectAccessible();
  for (const tab of ['sizing', 'economics', 'validation', 'decisions?gate=G2', 'pilot'])
    await page.goto(`/me/cases/ME-104/${tab}`).then(() => expect(page.getByRole('main')).toBeVisible());
});
