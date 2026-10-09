/**
 * Seed runner. Loads the canonical Aster fixture (fixtures/aster) into the database for a profile.
 *
 * Profiles (see fixtures/aster/README.md):
 *   aster-start  tenant, people, roles, authority, policies, licences, sources, connections,
 *                approved mandate MD-21 and detected opportunities. Start of the PRD §15 journey.
 *   aster-demo   full journey history to 26 Nov 2026 (G2 awaiting decision) for demos and screens.
 *
 * TODO(WS1 platform/db): implement inserts for each fixture collection inside one transaction with
 * app.tenant_id set, generating display-key counters and audit events with actor_kind 'system'.
 */
import { asterFixture } from '@growth-os/fixtures-aster';

const profile = process.argv[2] ?? process.env.SEED_PROFILE ?? 'aster-start';

async function main(): Promise<void> {
  const counts = Object.fromEntries(
    Object.entries(asterFixture).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1]),
  );
  console.log(`seed profile "${profile}" — fixture collections:`, counts);
  throw new Error('db:seed is not implemented yet (owned by WS1). Fixture data is ready in fixtures/aster.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
