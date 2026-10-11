/** `timers.license_expiry` planner (pure): a term ends after its last tenant-local day. */
import { describe, expect, it } from 'vitest';
import { planLicenseExpiry, type LicenseCandidate } from './license-expiry';

const census: LicenseCandidate = {
  licenseId: 'l1',
  name: 'Site census',
  termEndsOn: '2027-12-31',
  onExpiry: 'remove_content_keep_metadata',
  expiredAt: null,
};

describe('planLicenseExpiry', () => {
  it('keeps a licence through its last day and expires it the next tenant-local day', () => {
    expect(planLicenseExpiry([census], '2027-12-31T22:00:00Z', 'Europe/Berlin')).toEqual([]); // 23:00 local
    const plan = planLicenseExpiry([census], '2027-12-31T23:30:00Z', 'Europe/Berlin'); // 00:30 on 1 Jan
    expect(plan).toEqual([
      {
        licenseId: 'l1',
        name: 'Site census',
        termEndsOn: '2027-12-31',
        onExpiry: 'remove_content_keep_metadata',
        reason: 'Licence term ended 31 Dec 2027: excerpts and embeddings removed, provenance kept',
      },
    ]);
  });

  it('names the delete-copy action and skips licences already expired', () => {
    const del = { ...census, licenseId: 'l2', onExpiry: 'delete_copy_keep_audit' as const };
    const done = { ...census, licenseId: 'l3', expiredAt: '2028-01-01T00:00:00Z' };
    const plan = planLicenseExpiry([del, done], '2028-02-01T09:00:00Z', 'Europe/Berlin');
    expect(plan.map((p) => [p.licenseId, p.reason])).toEqual([
      ['l2', 'Licence term ended 31 Dec 2027: stored copy deleted, audit record kept'],
    ]);
  });
});
