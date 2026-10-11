/**
 * `timers.license_expiry` (daily 02:15; D-120 §2, D-129). When a licence term has ended, run its
 * on-expiry action and drop the licence to metadata only IN THE SAME WRITE (the database constraint
 * `license_fail_closed` refuses an expired licence that still allows content):
 *   - remove_content_keep_metadata: no excerpt, model context, embedding or export from now on; the
 *     source rows, their provenance and every audit record stay;
 *   - delete_copy_keep_audit: the same, and the licence's stored copies are marked deleted
 *     (`source.deleted_at`), so no read can reach their content; the audit record stays.
 * Reads fail closed by rights status (evidence module, search, export, the analysis tool gateway), so
 * an excerpt disappears at once; nothing is ever deleted from audit.
 */
import { sql, type Tx } from '@growth-os/db';
import type { LicenseExpiryAction } from '@growth-os/contracts';
import { localDate } from './plan';
import type { TimerContext } from './store';

export interface LicenseCandidate {
  licenseId: string;
  name: string;
  /** Last day of the term (ISO date, tenant local). */
  termEndsOn: string;
  onExpiry: LicenseExpiryAction;
  expiredAt: string | null;
}

export interface LicenseExpiryStep {
  licenseId: string;
  name: string;
  termEndsOn: string;
  onExpiry: LicenseExpiryAction;
  reason: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

/** Pure: which licences expire now. A term ends after its last day (tenant-local calendar). */
export function planLicenseExpiry(
  candidates: readonly LicenseCandidate[],
  now: string,
  timeZone: string,
): LicenseExpiryStep[] {
  const today = localDate(now, timeZone);
  return candidates
    .filter((c) => c.expiredAt === null && c.termEndsOn < today)
    .map((c) => ({
      licenseId: c.licenseId,
      name: c.name,
      termEndsOn: c.termEndsOn,
      onExpiry: c.onExpiry,
      reason:
        c.onExpiry === 'delete_copy_keep_audit'
          ? `Licence term ended ${day(c.termEndsOn)}: stored copy deleted, audit record kept`
          : `Licence term ended ${day(c.termEndsOn)}: excerpts and embeddings removed, provenance kept`,
    }));
}

export async function loadLicenseCandidates(tx: Tx): Promise<LicenseCandidate[]> {
  const r = await sql<{
    id: string;
    name: string;
    term_ends_on: string;
    on_expiry_action: LicenseExpiryAction;
  }>`
    SELECT id, name, term_ends_on::text AS term_ends_on, on_expiry_action
      FROM platform.license
     WHERE term_ends_on IS NOT NULL AND expired_at IS NULL
     ORDER BY id
     FOR UPDATE SKIP LOCKED`.execute(tx);
  return r.rows.map((row) => ({
    licenseId: row.id,
    name: row.name,
    termEndsOn: row.term_ends_on,
    onExpiry: row.on_expiry_action,
    expiredAt: null,
  }));
}

const AUTHZ = JSON.stringify({ decision: 'allow', rule: 'timer:license_expiry', authorityGrantId: null });

/** Apply one expiry: the action and the permission drop in one statement. False when another run won. */
export async function applyLicenseExpiry(tx: Tx, a: LicenseExpiryStep, ctx: TimerContext): Promise<boolean> {
  const updated = await sql<{ id: string }>`
    UPDATE platform.license
       SET max_excerpt_sentences = 0, allow_model_context = false, allow_embeddings = false,
           allow_export = false, expired_at = ${ctx.now}::timestamptz
     WHERE id = ${a.licenseId} AND expired_at IS NULL
     RETURNING id`.execute(tx);
  if (updated.rows.length === 0) return false;
  let deletedCopies = 0;
  if (a.onExpiry === 'delete_copy_keep_audit') {
    const d = await sql<{ id: string }>`
      UPDATE platform.source SET deleted_at = ${ctx.now}::timestamptz
       WHERE license_id = ${a.licenseId} AND deleted_at IS NULL
       RETURNING id`.execute(tx);
    deletedCopies = d.rows.length;
  }
  await sql`
    INSERT INTO platform.audit_event (tenant_id, actor_user_id, actor_kind, actor_role, action, object_type,
      object_id, object_version, case_id, summary, details, authz_context, correlation_id)
    VALUES (platform.current_tenant_id(), NULL, 'system', NULL, 'license.expired', 'license',
      ${a.licenseId}, NULL, NULL, ${a.reason},
      ${JSON.stringify({ termEndsOn: a.termEndsOn, onExpiry: a.onExpiry, deletedCopies })}::jsonb,
      ${AUTHZ}::jsonb, ${ctx.correlationId})`.execute(tx);
  return true;
}

export interface LicenseExpirySummary {
  expired: number;
}

export async function expireLicensesInTenant(tx: Tx, ctx: TimerContext): Promise<LicenseExpirySummary> {
  const plan = planLicenseExpiry(await loadLicenseCandidates(tx), ctx.now, ctx.timeZone);
  let expired = 0;
  for (const a of plan) if (await applyLicenseExpiry(tx, a, ctx)) expired += 1;
  return { expired };
}
