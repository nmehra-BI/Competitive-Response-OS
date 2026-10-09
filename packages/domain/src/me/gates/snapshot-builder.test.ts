import { describe, expect, it } from 'vitest';
import { Fingerprint } from '@growth-os/contracts';
import { cases, exp03, fid, gates, people } from '@growth-os/fixtures-aster';
import { canonicalize, sha256Hex } from '../../platform/snapshot/canonical';
import {
  buildSnapshotContent,
  createSnapshot,
  diffSnapshotContent,
  freezeSnapshot,
  nextSnapshotVersion,
  verifySnapshotHash,
  type SnapshotBuildInput,
} from './snapshot-builder';

const me104 = cases.find((c) => c.key === 'ME-104')!;
const person = (p: { id: string; displayName: string; title: string; initials: string }) => ({
  id: p.id,
  displayName: p.displayName,
  title: p.title,
  initials: p.initials,
});

/** ME-104 G2 package v3 from the fixture (committed versions only). */
function g2Input(): SnapshotBuildInput {
  const g2 = gates.g2;
  return {
    caseId: me104.id,
    caseKey: 'ME-104',
    gateCode: 'G2',
    ask: g2.ask,
    scope: {
      amount: g2.amount,
      currency: g2.currency,
      durationDays: g2.durationDays,
      windowStart: g2.windowStart,
      windowEnd: g2.windowEnd,
      countryCodes: ['DE'],
      segmentLabel: 'Food processing',
      maxSites: g2.maxSites,
      milestones: ['M1 · Kick-off', 'M2 · Run and measure', 'M3 · Review'],
      ownerId: g2.pilotOwnerId,
      authorizes: [...g2.authorizes],
      doesNotAuthorize: [...g2.doesNotAuthorize],
    },
    recommendation: g2.recommendation,
    alternatives: g2.alternatives.map((a) => ({ ...a })),
    evidenceSummary: [{ sourceId: fid('source', 14), label: 'SRC-014 · Site census' }],
    assumptions: [
      {
        assumptionId: fid('assumption', 1),
        versionId: fid('assumptionVersion', 2),
        name: 'Base adoption',
        valueText: '20%',
        disputed: true,
      },
    ],
    validationResults: [
      {
        experimentId: exp03.id,
        resultVersionId: fid('experiment', 103),
        summary: 'Met · 9 of 8; Met · 4 of 4',
        limitations: exp03.result.limitations,
      },
    ],
    economics: null,
    sizing: null,
    signOffs: g2.positions.map((p) => ({
      reviewer: person(Object.values(people).find((x) => x.id === p.reviewerId)!),
      area: p.area,
      position: p.position,
      scopeText: p.scopeText,
      signedVersion: 3,
      signedAt: '2026-11-24T17:05:00+01:00',
    })),
    budgetAndStopRules: [...g2.stopRules],
    conditionsProposed: [
      {
        text: g2.conditions[0].text,
        ownerId: g2.conditions[0].ownerId,
        dueOn: '2026-12-01',
        dueRule: null,
        flag: 'blocks_execution',
      },
    ],
    dissent: [
      {
        author: person(people.daniel),
        authorRole: 'Finance partner',
        statement: g2.dissent.statement,
        scopeText: g2.dissent.scopeText,
        signedAt: g2.dissent.signedAt,
        signedSnapshotVersion: 3,
      },
    ],
    knownLimitations: [...g2.knownLimitations],
    blockers: [],
    outcomeTargets: [
      {
        metricKey: 'paid_use_continuation',
        name: 'Paid use and continuation',
        thresholdText: '4 of 4 pilot customers',
        window: '1 Dec 2026 – 28 Feb 2027',
      },
    ],
    components: [
      { type: 'assumption_version', id: fid('assumptionVersion', 2), version: 2, state: 'committed' },
      { type: 'mandate_version', id: fid('mandateVersion', 2), version: 2, state: 'committed' },
      { type: 'experiment_result_version', id: fid('experiment', 103), version: 1, state: 'committed' },
      { type: 'feasibility_review', id: fid('feasibility', 5), version: null, state: 'committed' },
    ],
  };
}

describe('snapshot builder', () => {
  it('builds a contract-valid, hashed, fingerprinted snapshot', async () => {
    const r = await createSnapshot(g2Input(), 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.snapshot;
    expect(s.version).toBe(3);
    expect(s.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.hash).toBe(await sha256Hex(s.canonical));
    expect(s.canonical).toBe(canonicalize(s.content));
    expect(Fingerprint.safeParse(s.fingerprint).success).toBe(true);
    expect(s.fingerprint).toBe(`${s.hash.slice(0, 4).toUpperCase()}·${s.hash.slice(4, 8).toUpperCase()}`);
    expect(await verifySnapshotHash(s.canonical, s.hash)).toBe(true);
    expect(await verifySnapshotHash(s.canonical.replace('120000.00', '130000.00'), s.hash)).toBe(false);
  });

  it('is deterministic: component order and key order do not change the hash', async () => {
    const a = g2Input();
    const b = g2Input();
    b.components = [...b.components].reverse();
    const ha = await createSnapshot(a, 3);
    const hb = await createSnapshot(b, 3);
    expect(ha.ok && hb.ok && ha.snapshot.hash === hb.snapshot.hash).toBe(true);
  });

  it('any change to what the approver reads changes the hash (v3 → v4 after an assumption change)', async () => {
    const v3 = await createSnapshot(g2Input(), 3);
    const changed = g2Input();
    changed.assumptions = [
      { ...changed.assumptions[0]!, versionId: fid('assumptionVersion', 3), valueText: '15%' },
    ];
    changed.components = changed.components.map((c) =>
      c.type === 'assumption_version' ? { ...c, id: fid('assumptionVersion', 3), version: 3 } : c,
    );
    const v4 = await createSnapshot(changed, 4);
    if (!v3.ok || !v4.ok) throw new Error('build failed');
    expect(v4.snapshot.hash).not.toBe(v3.snapshot.hash);
    const d = diffSnapshotContent(v3.snapshot.content, v4.snapshot.content);
    expect(d.changedFields).toEqual(['assumptions']);
    expect(d.components.added).toEqual([
      { type: 'assumption_version', id: fid('assumptionVersion', 3), version: 3 },
    ]);
    expect(d.components.removed).toHaveLength(1);
  });

  it('is immutable once frozen', async () => {
    const r = await createSnapshot(g2Input(), 3);
    if (!r.ok) throw new Error('build failed');
    expect(() => {
      (r.snapshot.content.scope as { amount: string | null }).amount = '999999.00';
    }).toThrow();
    expect(() => {
      (r.snapshot as { hash: string }).hash = 'x';
    }).toThrow();
  });

  it('freezing copies the input, so later edits to the source object cannot alter it', async () => {
    const built = buildSnapshotContent(g2Input());
    if (!built.ok) throw new Error('build failed');
    const frozen = await freezeSnapshot(built.content, 3);
    built.content.ask = 'changed after freezing';
    expect(frozen.content.ask).toBe(gates.g2.ask);
  });

  it('refuses draft components (committed versions only)', () => {
    const input = g2Input();
    input.components = [
      ...input.components,
      { type: 'economics_version', id: fid('economicsVersion', 3), version: 3, state: 'draft' },
    ];
    expect(buildSnapshotContent(input)).toMatchObject({ ok: false, code: 'PRECONDITIONS_UNMET' });
  });

  it('refuses the same object pinned at two versions', () => {
    const input = g2Input();
    input.components = [
      ...input.components,
      { type: 'assumption_version', id: fid('assumptionVersion', 2), version: 3, state: 'committed' },
    ];
    expect(buildSnapshotContent(input)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('refuses money as a number and contract violations', () => {
    const input = g2Input() as unknown as { scope: Record<string, unknown> };
    input.scope.amount = 120000.5;
    expect(buildSnapshotContent(input as unknown as SnapshotBuildInput)).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
  });

  it('numbers snapshot versions per case', () => {
    expect(nextSnapshotVersion([])).toBe(1);
    expect(nextSnapshotVersion([1, 3, 2])).toBe(4);
  });
});
