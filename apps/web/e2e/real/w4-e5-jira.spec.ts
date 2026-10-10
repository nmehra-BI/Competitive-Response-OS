/**
 * W4-E5 · Jira Cloud on the real stack (`aster-demo`, G2 approved, pilot active) against the local
 * mock Jira server, which this spec starts (there is no network to Jira):
 *   · the admin adds a Jira Cloud connection on S14 and connects it through the consent redirect →
 *     "Connected · Growth OS integration"
 *   · Jonas previews and sends the pilot tasks → six issues in Jira, "6 of 6 tasks confirmed in Jira",
 *     every key exactly as Jira returned it, one issue per idempotency key
 *
 * The real project's API and worker processes run with `TASK_CONNECTOR=jira` and the Jira test
 * configuration from `support/real-env.ts` (`REAL.jiraEnv`, CR-E5-3); the mock listens on its API base URL.
 */
import pg from 'pg';
import { expect, test } from '../support/fixtures';
import { activateDemoPilot } from '../support/journey';
import { ASTER_TENANT, resetStack, sqlRows } from '../support/real';
import { REAL } from '../support/real-env';
import { startMockJira, type MockJira } from '../../../../packages/connectors/src/jira/mock-server';

const SITE = 'https://aster-industrial.atlassian.net';
const NAME = 'Jira Cloud · PIL, ME-VAL';
let mock: MockJira;

function jiraEnv() {
  const e = REAL.jiraEnv;
  return {
    clientId: e.JIRA_CLIENT_ID,
    clientSecret: e.JIRA_CLIENT_SECRET,
    base: new URL(e.JIRA_API_BASE_URL),
  };
}

/** Owner SQL in the Aster tenant (RLS applies), for the one setup step the UI has no screen for. */
async function ownerSql(text: string, params: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: REAL.dbEnv.DATABASE_OWNER_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [ASTER_TENANT]);
    await client.query(text, params);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const env = jiraEnv();
  resetStack('aster-demo');
  mock = await startMockJira({
    port: Number(env.base.port),
    host: env.base.hostname,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    siteUrl: SITE,
    projects: {
      PIL: { name: 'Pilot delivery', issueTypes: ['Task'], keyStart: 11 },
      'ME-VAL': { name: 'Market validation', issueTypes: ['Task'] },
    },
  });
});
test.afterAll(async () => {
  await mock?.close();
});

test('admin connects Jira Cloud as the integration account; a pilot send creates six issues', async ({
  page,
  loginAs,
  expectAccessible,
}) => {
  await activateDemoPilot(page, (who) => loginAs(who));

  // S14: add the site, then connect through Atlassian's consent page (the mock auto-approves).
  await loginAs('admin');
  await page.goto('/admin/connections');
  const panel = page.locator('#admin-jira');
  await panel.getByLabel('Jira Cloud site').fill(SITE);
  await panel.getByRole('button', { name: 'Add Jira Cloud connection' }).click();
  await expect(panel.getByTestId('jira-status-line')).toHaveText('Not connected yet');
  await panel.getByRole('button', { name: `Connect ${NAME} as the integration account` }).click();
  await page.waitForURL((u) => u.pathname === '/admin/connections' && !u.search.includes('code='));
  await expect(panel.getByTestId('jira-status-line')).toHaveText('Connected · Growth OS integration');
  await expect(
    page.getByRole('status').filter({ hasText: `${NAME}: Connected · Growth OS integration.` }),
  ).toBeVisible();
  await expectAccessible({ include: ['#admin-jira'] });
  expect(mock.calls.filter((c) => c.op === 'token' && c.status === 200)).toHaveLength(1);

  // The tokens are stored only as ciphertext with the key id.
  const [cred] = await sqlRows<{
    key_id: string;
    scopes: string[];
    account_display_name: string;
    plain: boolean;
  }>(
    `SELECT key_id, scopes, account_display_name,
            position(convert_to('at-', 'UTF8') in access_token_ciphertext) > 0 AS plain
       FROM platform.connection_credential`,
  );
  expect(cred).toMatchObject({ account_display_name: 'Growth OS integration', plain: false });
  expect(cred!.scopes).toEqual(['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access']);

  // Setup without a screen: the pilot's task set moves to the new connection (same mappings).
  const [jira] = await sqlRows<{ id: string }>(
    `SELECT id FROM platform.connection WHERE provider = 'jira_cloud'`,
  );
  await ownerSql(
    `INSERT INTO platform.connector_mapping (tenant_id, connection_id, purpose, destination_project, issue_type, assignee_map)
     SELECT tenant_id, $1, purpose, destination_project, issue_type, assignee_map
       FROM platform.connector_mapping m
      WHERE m.connection_id = (SELECT connection_id FROM platform.task_set WHERE owner_type = 'pilot_plan_version')`,
    [jira!.id],
  );
  await ownerSql(
    `UPDATE platform.task_set t
        SET connection_id = $1,
            mapping_id = (SELECT id FROM platform.connector_mapping WHERE connection_id = $1 AND purpose = 'pilot_tasks')
      WHERE t.owner_type = 'pilot_plan_version'`,
    [jira!.id],
  );

  // S11: Jonas previews and sends; the worker creates the issues in Jira.
  await loginAs('jonas');
  await page.goto('/me/cases/ME-104/pilot');
  await page.getByRole('button', { name: 'Preview tasks' }).click();
  await page.getByRole('button', { name: 'Create 6 tasks in Jira' }).click();
  await expect(page.getByRole('status').filter({ hasText: '6 of 6 tasks confirmed in Jira' })).toBeVisible({
    timeout: 90_000,
  });

  const issues = mock.issues('PIL');
  expect(issues.map((i) => i.key)).toEqual(['PIL-11', 'PIL-12', 'PIL-13', 'PIL-14', 'PIL-15', 'PIL-16']);
  const links = await sqlRows<{ external_key: string; idempotency_key: string }>(
    `SELECT external_key, idempotency_key FROM platform.external_task_link
      WHERE connection_id = $1 ORDER BY external_key`,
    [jira!.id],
  );
  expect(links.map((l) => l.external_key)).toEqual(issues.map((i) => i.key));
  // One issue per idempotency key, and each issue carries its key as the entity property.
  for (const l of links) {
    const issue = issues.find((i) => i.key === l.external_key)!;
    expect(issue.properties['growth-os.idempotency']).toEqual({ key: l.idempotency_key });
  }
  expect(new Set(issues.map((i) => JSON.stringify(i.properties))).size).toBe(6);
  await expect(page.getByText('PIL-11', { exact: false }).first()).toBeVisible();
});
