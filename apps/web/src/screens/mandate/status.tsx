/** Mandate status in the gate vocabulary: Draft mandate · G0 Returned · Awaiting decision · Approved. */
import type { MandateStatus } from '@growth-os/contracts';
import { GateChip, Pill, StagePill } from '@growth-os/ui';

export function MandateStatusChip({ status }: { status: MandateStatus }) {
  switch (status) {
    case 'draft':
      return <StagePill stage="draft_mandate" />;
    case 'returned':
      return <GateChip status="returned_for_revision" text="G0 · Returned for revision" />;
    case 'awaiting_decision':
      return <GateChip status="awaiting_decision" text="G0 · Awaiting decision" />;
    case 'approved':
      return <GateChip status="approved" text="G0 · Approved" />;
    case 'superseded':
      return <Pill label="Superseded" tone="neutral" icon="archive" />;
  }
}
