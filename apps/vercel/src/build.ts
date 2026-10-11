/**
 * Vercel build (decisions.md D-160, D-164). Runs inside the Vercel build container, which can reach
 * the Supabase session pooler:
 *
 *   1. migrate   packages/db migrations + graphile-worker schema + grants, as me_owner
 *   2. seed      aster-demo, only when the Aster tenant is absent (idempotent across deploys)
 *   3. web       vite build of apps/web
 *   4. output    .vercel/output (Build Output API v3): static SPA, one Node function, routes, cron
 *
 * Steps 1–2 run for production builds, or for any build with MIGRATE_ON_BUILD=1; SKIP_DB_STEPS=1 skips
 * them (local dry runs). Secrets are never printed: only host names and step results are logged.
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = join(root, '.vercel/output');
const fnDir = join(out, 'functions/api.func');

const env = process.env;
const isProd = env.VERCEL_ENV === 'production';
const runDb = env.SKIP_DB_STEPS !== '1' && (isProd || env.MIGRATE_ON_BUILD === '1');

function hostOf(url: string | undefined): string {
  try {
    const u = new URL(url ?? '');
    return `${u.hostname}:${u.port || '5432'} as ${decodeURIComponent(u.username).split('.')[0]}`;
  } catch {
    return '(unset)';
  }
}

async function dbSteps(): Promise<void> {
  console.log(`db: owner ${hostOf(env.DATABASE_OWNER_URL)} · ssl ${env.DATABASE_SSL ?? 'disable'}`);
  const { migrateDatabase } = await import('@growth-os/db/migrate');
  await migrateDatabase();
  console.log('db: migrations up to date (including job queue schema)');

  const { createDb } = await import('@growth-os/db');
  const { seedAster, AlreadySeededError } = await import('@growth-os/db/seed');
  const db = createDb('owner', 2);
  try {
    const r = await seedAster(db, { profile: 'aster-demo' });
    console.log(`db: seeded aster-demo into ${r.tenantSlug} (${r.audits} audit events)`);
  } catch (err) {
    if (err instanceof AlreadySeededError) console.log('db: Aster tenant present; seed skipped');
    else throw err;
  } finally {
    await db.destroy();
  }
}

/** Security headers for every response. The CSP allows the Google Fonts the SPA loads (index.html). */
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://vercel.live",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://vercel.live",
    'frame-src https://vercel.live',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '),
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY',
};

async function writeOutput(): Promise<void> {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(fnDir, { recursive: true });

  cpSync(join(root, 'apps/web/dist'), join(out, 'static'), { recursive: true });

  await build({
    entryPoints: [join(root, 'apps/vercel/src/handler.ts')],
    outfile: join(fnDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['pg-native'],
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
    // CommonJS dependencies inside an ESM bundle still call require() and use __dirname.
    banner: {
      js: [
        "import { createRequire as __cr } from 'node:module';",
        "import { fileURLToPath as __fu } from 'node:url';",
        "import { dirname as __dn } from 'node:path';",
        'const require = __cr(import.meta.url);',
        'const __filename = __fu(import.meta.url);',
        'const __dirname = __dn(__filename);',
      ].join('\n'),
    },
  });
  // Skill manifests, instructions and fixture scripts are read at run time (ANALYSIS_SKILLS_DIR).
  cpSync(join(root, 'skills'), join(fnDir, 'skills'), { recursive: true });
  writeFileSync(
    join(fnDir, '.vc-config.json'),
    JSON.stringify(
      {
        runtime: 'nodejs22.x',
        handler: 'index.mjs',
        launcherType: 'Nodejs',
        shouldAddHelpers: false,
        supportsResponseStreaming: true,
        maxDuration: 60,
        memory: 1024,
      },
      null,
      2,
    ),
  );

  const config = {
    version: 3,
    routes: [
      {
        src: '^/assets/(.*)$',
        headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
        continue: true,
      },
      { src: '^/(.*)$', headers: SECURITY_HEADERS, continue: true },
      { src: '^/api(?:/.*)?$', headers: { 'Cache-Control': 'no-store' }, continue: true },
      { handle: 'filesystem' },
      { src: '^/(?:api(?:/.*)?|healthz)$', dest: '/api' },
      { src: '^/(.*)$', dest: '/index.html' },
    ],
    // Hobby plan: at most one run a day; command-triggered drains do the real work (D-161).
    crons: [{ path: '/api/internal/jobs/run', schedule: env.JOBS_CRON_SCHEDULE ?? '17 3 * * *' }],
  };
  writeFileSync(join(out, 'config.json'), JSON.stringify(config, null, 2));
}

async function main(): Promise<void> {
  const t0 = Date.now();
  if (runDb) await dbSteps();
  else console.log(`db: steps skipped (VERCEL_ENV=${env.VERCEL_ENV ?? 'unset'})`);
  execSync('pnpm --filter @growth-os/web run build', { cwd: root, stdio: 'inherit' });
  await writeOutput();
  console.log(`build: .vercel/output written in ${Math.round((Date.now() - t0) / 1000)} s`);
}

main().catch((err: unknown) => {
  // Error messages from pg never contain the password; still print only the message.
  console.error(`build failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
