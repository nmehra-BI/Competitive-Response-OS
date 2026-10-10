/**
 * Seed runner for the Aster fixture (BUILD_PLAN §7). Both profiles load in ONE tenant transaction
 * with app.tenant_id set, so RLS and every guard trigger apply exactly as for live writes.
 *
 *   aster-start  journey start (approved MD-21, detected opportunities, org, sources, connections)
 *   aster-demo   aster-start + ME-104 history to 26 Nov 2026 (G2 snapshot v3 awaiting decision)
 *
 * The seeded tenant is marked illustrative (tenant.illustrative = true): the UI shows
 * "Illustrative data — synthetic", and only illustrative tenants accept dev persona login.
 */
import { tenant } from '@growth-os/fixtures-aster';
import { withTenant, type Db } from '../index';
import type { SeedCtx } from './context';
import { seedDemo } from './demo';
import { identityRemap, randomRemap, type Remap } from './remap';
import { seedStart } from './start';

export const SEED_PROFILES = ['aster-start', 'aster-demo'] as const;
export type SeedProfile = (typeof SEED_PROFILES)[number];

export interface SeedResult {
  profile: SeedProfile;
  tenantId: string;
  tenantSlug: string;
  /** Maps a fixture id to the id used in this seed (identity for the canonical seed). */
  id: (fixtureId: string) => string;
  audits: number;
}

export class AlreadySeededError extends Error {
  constructor(slug: string) {
    super(`Tenant "${slug}" is already seeded. Run \`pnpm db:reset\` to reseed from scratch.`);
    this.name = 'AlreadySeededError';
  }
}

export async function seedAster(
  db: Db,
  opts: { profile: SeedProfile; isolated?: boolean; remap?: Remap } = { profile: 'aster-start' },
): Promise<SeedResult> {
  const R: Remap = opts.remap ?? (opts.isolated ? randomRemap() : identityRemap);
  const tenantId = R.id(tenant.id);
  const tenantSlug = R.tag ? `${tenant.slug}-${R.tag}` : tenant.slug;
  const s = await withTenant(
    db,
    { tenantId, userId: null, correlationId: `seed:${opts.profile}` },
    async (tx): Promise<SeedCtx> => {
      const exists = await tx
        .selectFrom('platform.tenant')
        .select('id')
        .where('id', '=', tenantId)
        .executeTakeFirst();
      if (exists) throw new AlreadySeededError(tenantSlug);
      const ctx: SeedCtx = { tx, tenantId, R, audits: 0 };
      await seedStart(ctx);
      if (opts.profile === 'aster-demo') await seedDemo(ctx);
      return ctx;
    },
  );
  return { profile: opts.profile, tenantId, tenantSlug, id: R.id, audits: s.audits };
}

export { identityRemap, randomRemap, type Remap } from './remap';
