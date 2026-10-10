/**
 * Release gate · log scrubbing (PRD §10, §17; never-rule 8; D-105). A restricted passage and a
 * confidential financial input carry canary strings. After the reads, searches, writes and failures a
 * real session makes, neither canary appears in the server log, in audit rows or in analytics rows —
 * and restricted text never reaches a response for a viewer without the licence.
 */
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@growth-os/contracts';
import { sql, withTenant } from '@growth-os/db';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../src/platform/testing';

const RESTRICTED = 'CANARY-restricted-passage-58213';
const CONFIDENTIAL = '0.4321987';

let t: TestApp;
let s: SeededTenant;
const lines: string[] = [];
const k: Record<'maya' | 'priya' | 'daniel' | 'jonas', string> = {
  maya: '',
  priya: '',
  daniel: '',
  jonas: '',
};

beforeAll(async () => {
  const sink = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  t = await createTestApp({ logStream: sink });
  s = await seedTenant(t.db, 'aster-demo');
  await withTenant(t.db, { tenantId: s.tenantId, userId: null, correlationId: 'log-scrub' }, async (tx) => {
    await sql`
      INSERT INTO platform.evidence_passage (tenant_id, source_id, locator, excerpt, excerpt_sha256)
      SELECT tenant_id, id, 'p. 7', ${`Vendor estimate: spend grows 9% a year. ${RESTRICTED}`},
             encode(digest(${RESTRICTED}, 'sha256'), 'hex')
        FROM platform.source WHERE display_key IN ('SRC-030', 'SRC-014')`.execute(tx);
  });
  for (const p of ['maya', 'priya', 'daniel', 'jonas'] as const) k[p] = await login(t.app, s.user(p));
});
afterAll(() => t.close());

const leaks = (text: string) => [RESTRICTED, CONFIDENTIAL].filter((c) => text.includes(c));

describe('log scrubbing', () => {
  it('drives reads, searches, writes and failures that touch restricted and confidential values', async () => {
    // Reads of the restricted sources by people without and with the licence.
    for (const who of ['maya', 'priya', 'jonas'] as const)
      for (const ref of ['SRC-030', 'SRC-014']) {
        const r = await call(t.app, API.evidence.get, { params: { ref }, cookie: k[who] });
        expect([200, 404]).toContain(r.statusCode);
        if (ref === 'SRC-030') expect(r.body).not.toContain(RESTRICTED);
      }
    // Searching for the restricted text itself (the query string must not be logged either).
    for (const who of ['maya', 'priya'] as const) {
      const r = await call(t.app, API.search.search, { query: { q: RESTRICTED }, cookie: k[who] });
      expect(r.statusCode).toBe(200);
      if (who === 'priya') expect(r.body).not.toContain(RESTRICTED);
    }
    // A confidential financial input in the economics draft, then a refused and a malformed write.
    const view = API.economics.get.response.parse(
      (await call(t.app, API.economics.get, { params: { caseRef: 'ME-104' }, cookie: k.maya })).json(),
    );
    const draft = await call(t.app, API.economics.saveDraft, {
      params: { caseRef: 'ME-104' },
      ifMatch: (view.draft ?? view.current)!.rowVersion,
      body: { drivers: [{ inputKey: 'gross_margin', value: CONFIDENTIAL }] },
      cookie: k.maya,
    });
    expect(draft.statusCode).toBe(200);
    const refused = await call(t.app, API.economics.saveDraft, {
      params: { caseRef: 'ME-104' },
      ifMatch: 0,
      body: { drivers: [{ inputKey: 'gross_margin', value: CONFIDENTIAL }] },
      cookie: k.priya,
    });
    expect(refused.statusCode).toBeGreaterThanOrEqual(400);
    const malformed = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/me/cases/ME-104/economics/draft`,
      headers: { cookie: k.maya, 'content-type': 'application/json', 'if-match': '"0"' },
      payload: `{"drivers":[{"inputKey":"${RESTRICTED}","value":"${CONFIDENTIAL}"`,
    });
    expect(malformed.statusCode).toBe(400);
    // A dispute quoting the canary and an evidence challenge: business text, still kept out of logs.
    const asm = await withTenant(t.db, { tenantId: s.tenantId, userId: null, correlationId: 'x' }, (tx) =>
      tx
        .selectFrom('platform.assumption')
        .select('id')
        .where('display_key', '=', 'ASM-04')
        .executeTakeFirstOrThrow(),
    );
    const d = await call(t.app, API.assumptions.dispute, {
      params: { id: asm.id },
      body: { statement: `Quoting ${RESTRICTED}`, proposedValueText: CONFIDENTIAL },
      cookie: k.daniel,
      idempotencyKey: true,
    });
    expect(d.statusCode).toBe(201);
    expect(lines.length).toBeGreaterThan(10);
  });

  it('the server log carries no restricted or confidential value', () => {
    // The log is not empty: the search and the refused writes were logged — without their values.
    expect(lines.some((l) => l.includes('/api/v1/search'))).toBe(true);
    expect(lines.some((l) => l.includes('/economics/draft'))).toBe(true);
    const found = lines.filter((l) => leaks(l).length > 0);
    expect(found).toEqual([]);
  });

  it('audit and analytics rows carry no restricted or confidential value', async () => {
    const rows = await withTenant(
      t.db,
      { tenantId: s.tenantId, userId: null, correlationId: 'x' },
      async (tx) => ({
        audit: await sql<{
          row: string;
        }>`SELECT (summary || ' ' || details::text) AS row FROM platform.audit_event`.execute(tx),
        analytics: await sql<{
          row: string;
        }>`SELECT (envelope::text || ' ' || props::text) AS row FROM platform.analytics_event`.execute(tx),
      }),
    );
    expect(rows.audit.rows.filter((r) => leaks(r.row).length)).toEqual([]);
    expect(rows.analytics.rows.filter((r) => leaks(r.row).length)).toEqual([]);
  });
});
