import type { CaseHeader, GateCode } from '@growth-os/contracts';

/** The gate a bare /decisions link opens: the next decision, else the latest requested gate. */
export function defaultGate(h: CaseHeader): GateCode {
  if (h.nextDecision.gateCode && h.nextDecision.gateCode !== 'G0') return h.nextDecision.gateCode;
  const requested = [...h.rail].reverse().find((n) => n.gateRequestId && n.gateCode !== 'G0');
  return requested?.gateCode ?? 'G2';
}
