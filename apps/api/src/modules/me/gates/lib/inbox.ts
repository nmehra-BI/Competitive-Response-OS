/**
 * Gate requests awaiting the viewer's decision (Reviews inbox, My Work). A request is listed only when
 * the policy engine's approval panel says the viewer can decide it now, so administrators, authors,
 * case owners and agents never see "Approve" here.
 */
import type { GateCode } from '@growth-os/contracts';
import type { Tx } from '@growth-os/db';
import { createPolicyEngine, type PolicySubject } from '@growth-os/domain';
import { canSee, loadGateCtx } from './access';
import { shortDate } from './common';
import { buttonLabel, scopeOf, snapshotById } from './serialize';
import { gateResource } from './package';

const policy = createPolicyEngine();

export interface AwaitingDecision {
  gateRequestId: string;
  caseId: string | null;
  caseKey: string;
  gateCode: GateCode;
  buttonLabel: string;
  dueText: string;
  href: string;
}

export async function awaitingDecisions(
  tx: Tx,
  subject: PolicySubject,
  viewerId: string,
): Promise<AwaitingDecision[]> {
  if (subject.actor.kind !== 'human') return [];
  const rows = await tx
    .selectFrom('platform.gate_request')
    .select('id')
    .where('status', '=', 'awaiting_decision')
    .orderBy('submitted_at')
    .execute();
  const out: AwaitingDecision[] = [];
  for (const r of rows) {
    const g = await loadGateCtx(tx, r.id);
    if (!canSee(subject, g)) continue;
    const snap = g.gate.current_snapshot_id ? await snapshotById(tx, g.gate.current_snapshot_id) : null;
    if (!snap || snap.status !== 'current') continue;
    const panel = policy.approvalPanel(subject, gateResource(g.gate, g.caseRow, snap));
    if (!panel.canDecide || !panel.allowedDispositions.includes('approve')) continue;
    const mine = await tx
      .selectFrom('platform.approval')
      .select('id')
      .where('snapshot_id', '=', snap.id)
      .where('approver_user_id', '=', viewerId)
      .executeTakeFirst();
    if (mine) continue;
    let key = g.caseRow?.key ?? null;
    if (!key) {
      const m = await tx
        .selectFrom('me.mandate')
        .select('display_key')
        .where('id', '=', g.gate.subject_id)
        .executeTakeFirst();
      key = m?.display_key ?? g.gate.display_key;
    }
    const code = g.gate.gate_code as GateCode;
    out.push({
      gateRequestId: g.gate.id,
      caseId: g.gate.case_id,
      caseKey: key,
      gateCode: code,
      buttonLabel: buttonLabel(code, scopeOf(g.gate)),
      dueText: g.gate.submitted_at
        ? `Submitted ${shortDate(g.gate.submitted_at)} · snapshot v${snap.version}`
        : `Snapshot v${snap.version}`,
      href: g.caseRow
        ? `/me/cases/${key}/decisions?gate=${g.gate.id}`
        : `/me/mandates/${key}?gate=${g.gate.id}`,
    });
  }
  return out;
}
