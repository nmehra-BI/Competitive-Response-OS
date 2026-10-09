/**
 * One implementation of gate facts and gate read-models (D-072): `gates.preconditions`, the case
 * header rail and snapshot content must agree because they call the same functions. This suite proves
 * it through the API on aster-demo (ME-104 at Pilot approval pending) and after the case moves.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, type GateCode } from '@growth-os/contracts';
import { committedEconomicsSummary } from '../economics/read';
import { committedSizingSummary } from '../sizing/read';
import {
  call,
  createTestApp,
  login,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from '../../../platform/testing';
import { caseByRef } from './lib/common';
import { caseGateState, latestCaseGate } from './lib/facts';
import { buildInput } from './lib/snapshot';
import { ids, inTenant } from './testkit';

let t: TestApp;
let a: SeededTenant;
let maya: string;

beforeAll(async () => {
  t = await createTestApp();
  a = await seedTenant(t.db, 'aster-demo');
  maya = await login(t.app, a.user('maya'));
});
afterAll(async () => {
  await t.close();
});

async function railAndPreconditions(code: GateCode) {
  const header = API.cases.header.response.parse(
    (await call(t.app, API.cases.header, { params: { caseRef: 'ME-104' }, cookie: maya })).json(),
  );
  const node = header.rail.find((n) => n.gateCode === code)!;
  const pre = API.gates.rail.response.parse(
    (
      await call(t.app, API.gates.rail, { params: { caseRef: 'ME-104', gateCode: code }, cookie: maya })
    ).json(),
  );
  return { node, pre };
}

describe('gate facts have one source (D-072)', () => {
  it.each(['G1', 'G2', 'G3'] as const)(
    '%s: the header rail and gates.preconditions show the same status and counts',
    async (code) => {
      const { node, pre } = await railAndPreconditions(code);
      expect(node.status).toBe(pre.status);
      expect(node.preconditionsMet).toBe(pre.preconditions.filter((p) => p.met).length);
      expect(node.preconditionsTotal).toBe(pre.preconditions.length);
    },
  );

  it('X: no rail node before an extension is requested; the evaluator still answers for X', async () => {
    const { node, pre } = await railAndPreconditions('X');
    expect(node).toBeUndefined();
    const state = await inTenant(t, a, async (tx) =>
      caseGateState(tx, (await caseByRef(tx, 'ME-104'))!, 'X'),
    );
    expect(state.gate).toBeNull();
    expect(pre.status).toBe(state.status);
    expect(pre.preconditions).toEqual(state.evaluation.preconditions);
  });

  it('a fresh snapshot of G2 carries the same sizing and economics text as the read serializers', async () => {
    const out = await inTenant(t, a, async (tx) => {
      const c = (await caseByRef(tx, 'ME-104'))!;
      const g2 = (await latestCaseGate(tx, c.id, 'G2'))!;
      expect(g2.id).toBe(ids(a).g2);
      // A first snapshot (no previous content to carry over) is built from the committed records.
      const built = await buildInput(tx, { ...g2, current_snapshot_id: null }, c);
      return {
        built: built.input,
        sizing: await committedSizingSummary(tx, c.id),
        economics: await committedEconomicsSummary(tx, c.id),
      };
    });
    expect(out.sizing).not.toBeNull();
    expect(out.built.sizing).toEqual({
      sizingVersionId: out.sizing!.sizingVersionId,
      inputHash: out.sizing!.inputHash,
      summary: out.sizing!.summary,
    });
    expect(out.built.economics).toEqual({
      economicsVersionId: out.economics!.economicsVersionId,
      inputHash: out.economics!.inputHash,
      tableText: out.economics!.tableText,
      note: out.economics!.note,
    });
    // The seeded package states the same text: the serializers match the fixture's display copy.
    const pkg = API.gates.package.response.parse(
      (await call(t.app, API.gates.package, { params: { id: ids(a).g2 }, cookie: maya })).json(),
    );
    expect(pkg.snapshot.content.economics!.tableText).toEqual(out.economics!.tableText);
    expect(pkg.snapshot.content.economics!.note).toBe(out.economics!.note);
    expect(pkg.snapshot.content.sizing!.summary).toBe(out.sizing!.summary);
  });
});
