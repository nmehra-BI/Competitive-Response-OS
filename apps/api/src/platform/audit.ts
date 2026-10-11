/** Audit and analytics writers live in @growth-os/db so the API, worker and seed share one implementation. */
export {
  assertAuditEntrySafe,
  auditWriter,
  createAuditWriter,
  AuditGuardError,
  RESTRICTED_DETAIL_KEYS,
  type AuditRecord,
  type PlatformAuditWriter,
} from '@growth-os/db';
