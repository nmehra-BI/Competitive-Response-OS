/**
 * `pnpm db:seed [aster-start|aster-demo]` — loads the canonical Aster fixture (fixtures/aster).
 * Runs as the owner role inside one tenant transaction (RLS and guard triggers apply).
 * See packages/db/src/seed/index.ts for the profiles.
 */
import { createDb } from '../index';
import { SEED_PROFILES, seedAster, type SeedProfile } from '../seed';

const profile = (process.argv[2] ?? process.env.SEED_PROFILE ?? 'aster-start') as SeedProfile;

async function main(): Promise<void> {
  if (!SEED_PROFILES.includes(profile))
    throw new Error(`Unknown seed profile "${profile}". Use one of: ${SEED_PROFILES.join(', ')}`);
  const db = createDb('owner', 2);
  try {
    const r = await seedAster(db, { profile });
    console.log(
      `seeded profile "${r.profile}" into tenant ${r.tenantSlug} (${r.tenantId}) · illustrative · ${r.audits} audit events`,
    );
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
