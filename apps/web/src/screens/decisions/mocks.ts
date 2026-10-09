/**
 * MSW handlers for S10 Decisions and the decision brief (WS8c). They take precedence over the WS7
 * base handlers and add: G1 request/submit/decide, the G2 draft and submit, v3 → v4 refresh,
 * superseded versions, withdraw, "See what changed", and the invalidated/expired variants.
 * Policy copy follows the WS3 PolicyEngine; every response is validated against the contract.
 */
import { API, type GateRequest } from '@growth-os/contracts';
import { cases, gates, people } from '@growth-os/fixtures-aster';
import type { HttpHandler } from 'msw';
import { findCase, gateRequestById } from '../../mocks/data';
import { mock, MockProblem } from '../../mocks/define';
import { state } from '../../mocks/state';
import {
  cannotDecideReason,
  G1_HASH,
  G1_ID,
  g1Package,
  g1Request,
  G2_ID,
  g2Package,
  g2Request,
  header,
  preconditionsFor,
  snapshotFor,
} from './mock-data';
import { hasResults, isStale, persisting, setStale, ws } from './mock-state';

const notFound = () => new MockProblem('NOT_FOUND', 'Not found.');
const ME104 = cases[0];

function requireCase(ref: string) {
  const c = findCase(ref);
  if (!c) throw notFound();
  return c;
}

/** WS3 gate.decide order: admin → self → role. Elena is the only designated approver here. */
function assertDecider(viewerId: string | null) {
  if (viewerId === people.elena.id) return;
  const reason = cannotDecideReason(viewerId);
  if (viewerId === people.maya.id) throw new MockProblem('SELF_APPROVAL_PROHIBITED', reason);
  throw new MockProblem('FORBIDDEN', reason);
}

function requestById(id: string): GateRequest | null {
  if (id === G1_ID) return g1Request();
  if (id === G2_ID) return g2Request();
  return null;
}

export const handlers: HttpHandler[] = [
  // ----- Case envelope follows the journey moment -----
  mock(API.cases.header, ({ params }) => header(requireCase(params.caseRef))),

  mock(API.gates.rail, ({ params }) => {
    requireCase(params.caseRef);
    return preconditionsFor(params.gateCode);
  }),

  mock(API.gates.get, ({ params }) => {
    ws();
    const req =
      params.id === G1_ID || params.id === G2_ID ? requestById(params.id) : gateRequestById(params.id);
    if (!req) throw notFound();
    return req;
  }),

  mock(API.gates.package, ({ params, query, viewerId }) => {
    ws();
    const pkg =
      params.id === G1_ID
        ? g1Package(viewerId)
        : params.id === G2_ID
          ? g2Package(viewerId, query.version, query.compareTo)
          : null;
    if (!pkg) throw notFound();
    return pkg;
  }),

  mock(
    API.gates.createRequest,
    persisting(({ params, body, viewerId }) => {
      const c = requireCase(params.caseRef);
      if (c.key !== ME104.key) throw notFound();
      if (viewerId !== people.maya.id)
        throw new MockProblem('FORBIDDEN', 'Only the case owner prepares gate requests.');
      const w = ws();
      if (body.gateCode === 'G1') {
        if (w.exp === 'none')
          throw new MockProblem('PRECONDITIONS_UNMET', 'Create the validation experiment first.', {
            blockers: [{ key: 'experiment_plan', message: 'No validation experiment yet', gate: 'G1' }],
          });
        if (w.g1 !== 'none') throw new MockProblem('INVALID_TRANSITION', 'A G1 request already exists.');
        w.g1 = 'draft';
        w.g1Scope = body.scope;
        return g1Request()!;
      }
      if (body.gateCode === 'G2') {
        if (!hasResults(w))
          throw new MockProblem(
            'PRECONDITIONS_UNMET',
            'G2 preconditions unmet: validation results recorded',
            {
              blockers: [
                { key: 'validation_results', message: 'Validation results recorded · not yet', gate: 'G2' },
              ],
            },
          );
        if (w.g2 !== 'none' && w.g2 !== 'withdrawn')
          throw new MockProblem('INVALID_TRANSITION', 'A G2 request already exists.');
        w.g2 = 'draft';
        w.g2Scope = body.scope;
        w.g2Proposed = body.proposedConditions;
        state.g2Decision = null;
        return g2Request()!;
      }
      throw new MockProblem('INVALID_TRANSITION', 'This gate is not requested from Decisions.');
    }),
  ),

  mock(
    API.gates.submit,
    persisting(({ params, viewerId }) => {
      const w = ws();
      if (viewerId !== people.maya.id)
        throw new MockProblem('FORBIDDEN', 'Only the case owner submits gate requests.');
      if (params.id === G1_ID) {
        if (w.g1 !== 'draft')
          throw new MockProblem('INVALID_TRANSITION', 'Only a draft request can be submitted.');
        w.g1 = 'awaiting';
        return { gateRequest: g1Request()!, snapshot: snapshotFor('G1') };
      }
      if (params.id === G2_ID) {
        if (w.g2 !== 'draft')
          throw new MockProblem('INVALID_TRANSITION', 'Only a draft request can be submitted.');
        w.g2 = 'submitted';
        w.g2Version = 3;
        setStale(false);
        return { gateRequest: g2Request()!, snapshot: snapshotFor('G2') };
      }
      throw notFound();
    }),
  ),

  mock(
    API.gates.refresh,
    persisting(({ params, viewerId }) => {
      const w = ws();
      if (params.id !== G2_ID || w.g2 !== 'submitted') throw notFound();
      if (viewerId === people.admin.id)
        throw new MockProblem(
          'FORBIDDEN',
          'Administrators configure roles and policies but cannot approve gates.',
        );
      if (!isStale())
        throw new MockProblem('INVALID_TRANSITION', 'The snapshot is current. Nothing to refresh.');
      w.g2Version += 1;
      setStale(false);
      return { gateRequest: g2Request()!, snapshot: snapshotFor('G2') };
    }),
  ),

  mock(
    API.gates.withdraw,
    persisting(({ params, viewerId }) => {
      const w = ws();
      if (params.id !== G2_ID || w.g2 !== 'submitted') throw notFound();
      if (viewerId !== people.maya.id)
        throw new MockProblem('FORBIDDEN', 'Only the package author can withdraw it.');
      if (state.g2Decision)
        throw new MockProblem('INVALID_TRANSITION', 'A decided request cannot be withdrawn.');
      w.g2 = 'withdrawn';
      return g2Request()!;
    }),
  ),

  mock(API.gates.diff, ({ params, query }) => {
    const w = ws();
    const changes: {
      path: string;
      label: string;
      from: string | null;
      to: string | null;
      material: boolean;
    }[] = [];
    const isV3 = params.id === g2Package(null, 3)?.snapshot.id;
    const isV2 = params.id === g2Package(null, 2)?.snapshot.id;
    const againstCurrent =
      query.against === 'current_inputs' || query.against === g2Package(null, w.g2Version)?.snapshot.id;
    if (isV3 && againstCurrent && (isStale() || w.g2Version > 3)) {
      changes.push({
        path: 'assumptions[adoption_rate.base].version',
        label: 'Adoption assumption · Base (ASM-01)',
        from: 'version 1 · reviewed by Daniel Weber',
        to: `version ${w.adoptionVersion}`,
        material: true,
      });
    }
    if (isV2) {
      changes.push(
        {
          path: 'signOffs[specialist]',
          label: 'Specialist sign-off',
          from: null,
          to: 'Signed for pilot only: up to 4 sites, 90 days',
          material: true,
        },
        { path: 'budgetAndStopRules', label: 'Stop rules', from: null, to: '3 stop rules', material: true },
        {
          path: 'conditionsProposed[C1]',
          label: 'Condition C1',
          from: null,
          to: gates.g2.conditions[0].text,
          material: true,
        },
      );
    }
    return { changes };
  }),

  mock(
    API.gates.decide,
    persisting(({ params, body, viewerId }) => {
      const w = ws();
      const req = requestById(params.id);
      if (!req) throw notFound();
      assertDecider(viewerId);
      if (params.id === G1_ID) {
        if (w.g1 !== 'awaiting')
          throw new MockProblem('INVALID_TRANSITION', 'This gate has already been decided.');
        if (body.snapshotHash !== G1_HASH)
          throw new MockProblem('SNAPSHOT_HASH_MISMATCH', 'The snapshot you read is not the current one.');
        if (body.disposition === 'abstain') return g1Package(viewerId)!;
        w.g1Decision = {
          disposition: body.disposition,
          rationale: body.rationale,
          by: viewerId!,
          at: new Date().toISOString(),
        };
        w.g1 = 'approved';
        if (body.disposition === 'approve' || body.disposition === 'approve_with_conditions')
          w.exp = 'locked';
        return g1Package(viewerId)!;
      }
      // G2
      if (w.g2 !== 'submitted' || state.g2Decision)
        throw new MockProblem('INVALID_TRANSITION', 'This gate has already been decided.');
      const current = g2Package(viewerId)!.snapshot;
      if (isStale())
        throw new MockProblem(
          'SNAPSHOT_STALE',
          `Snapshot v${current.version} is out of date. Refresh to create v${current.version + 1}.`,
        );
      if (body.snapshotId !== current.id) {
        throw new MockProblem(
          'SNAPSHOT_STALE',
          'This snapshot was superseded. Read the current version before deciding.',
        );
      }
      if (body.snapshotHash !== current.contentHash)
        throw new MockProblem('SNAPSHOT_HASH_MISMATCH', 'The snapshot you read is not the current one.');
      if (body.disposition === 'approve_with_conditions' && body.conditions.length === 0)
        throw new MockProblem(
          'VALIDATION_FAILED',
          'Add at least one condition or approve without conditions.',
        );
      const proposed = new Set(req.conditions.map((c) => c.text));
      state.g2Decision = {
        disposition: body.disposition,
        rationale: body.rationale,
        note: body.note,
        by: viewerId!,
        at: new Date().toISOString(),
        conditions: body.conditions.filter((c) => !proposed.has(c.text)),
      };
      return g2Package(viewerId)!;
    }),
  ),
];
