/**
 * Eval runner (PRD §12). Loads cases from evals/cases and skills/<key>/evals, runs each through the
 * real harness, gateway, skill bundles and output checks against the in-memory Aster world, grades
 * every suite the case declares, prints a table and fails (exit 1) on any failure. Every declared
 * suite must have at least one case.
 *
 *   pnpm evals:smoke                                  # all suites, fixture provider (CI)
 *   tsx evals/src/run.ts --suite prompt-injection     # one suite
 *   tsx evals/src/run.ts --provider claude            # manual/nightly; needs ANTHROPIC_API_KEY + ANALYSIS_MODEL
 *   tsx evals/src/run.ts --report evals-report.json   # also write a JSON report
 */
import { writeFile } from 'node:fs/promises';
import {
  createFileFixtureSource,
  createFileSkillLoader,
  createFixtureProvider,
  createHarness,
  createMemoryRunStore,
  createToolGateway,
  defaultSkillsDir,
  providerFromEnv,
  type AnalysisProvider,
} from '@growth-os/ai';
import { loadCases, type EvalCase } from './cases';
import { GRADERS, baseline, type Grade, type Outcome } from './graders';
import { SUITES } from './suites';
import { createWorld } from './world';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const providerName = arg('provider') ?? 'fixture';
const suiteFilter = arg('suite') ?? 'smoke';
const reportPath = arg('report');

const skills = createFileSkillLoader();
const provider: AnalysisProvider =
  providerName === 'claude'
    ? providerFromEnv({ ...process.env, ANALYSIS_PROVIDER: 'claude' })
    : createFixtureProvider(createFileFixtureSource(defaultSkillsDir()));

async function execute(c: EvalCase): Promise<Outcome> {
  const world = createWorld(c.world);
  const store = createMemoryRunStore({
    caseContext: (run) =>
      world.caseContext({ caseId: run.caseId, mandateId: run.mandateId }, run.requestedBy),
  });
  const gateway = createToolGateway(world.handlers, { scope: world.scope });
  const harness = createHarness({ provider, gateway, skills, store });
  const bundle = await skills.load(c.skill);
  const run = store.createRun({
    tenantId: world.tenantId,
    skill: c.skill,
    skillVersion: bundle.version,
    requestedBy: world.userId(c.requester),
    budget: { ...bundle.budget, ...c.budget },
    caseId: c.subject === 'ME-104' ? world.caseId : null,
    mandateId: c.subject === 'MD-21' ? world.mandateId : null,
    caseOwnerId: world.userId('maya'),
    focus: providerName === 'fixture' ? { fixture: c.fixture } : {},
  });
  let interrupted = false;
  let callsAtCrash: Record<string, number> = {};
  if (c.interrupt) {
    world.interrupt(c.interrupt.tool, c.interrupt.times);
    try {
      await harness.execute(run.id);
    } catch {
      interrupted = true;
      callsAtCrash = { ...world.calls };
    }
  }
  const status = await harness.execute(run.id); // a fresh worker attempt after an interruption
  return { c, world, store, bundle, runId: run.id, status, interrupted, callsAtCrash };
}

interface Row {
  suite: string;
  caseId: string;
  grade: Grade;
}

const cases = await loadCases();
const suites = SUITES.filter((s) => suiteFilter === 'smoke' || s.key === suiteFilter);
if (suites.length === 0) throw new Error(`Unknown suite ${suiteFilter}`);
const rows: Row[] = [];
for (const c of cases) {
  const wanted = c.suites.filter((s) => suites.some((x) => x.key === s));
  if (wanted.length === 0) continue;
  const o = await execute(c);
  const base = baseline(o);
  for (const s of wanted) {
    const g = GRADERS[s]!(o);
    rows.push({ suite: s, caseId: c.id, grade: base.pass ? g : { pass: false, detail: base.detail } });
  }
}

let failed = 0;
console.warn(`evals: provider=${providerName} · ${cases.length} cases · ${suites.length} suites`);
const summary = suites.map((s) => {
  const mine = rows.filter((r) => r.suite === s.key);
  const passed = mine.filter((r) => r.grade.pass).length;
  const ok = mine.length > 0 && passed === mine.length;
  if (!ok) failed++;
  const note = s.grader === 'deterministic' ? '' : ' · expert review pending';
  console.warn(
    `${ok ? 'PASS' : 'FAIL'}  ${s.key.padEnd(26)} ${String(passed).padStart(2)}/${String(mine.length).padEnd(2)} threshold ${s.threshold}${note}`,
  );
  for (const r of mine.filter((x) => !x.grade.pass)) console.warn(`        ✗ ${r.caseId}: ${r.grade.detail}`);
  if (mine.length === 0) console.warn('        ✗ no cases declared for this suite');
  return { suite: s.key, grader: s.grader, threshold: s.threshold, cases: mine.length, passed, ok };
});

if (reportPath)
  await writeFile(
    reportPath,
    `${JSON.stringify({ provider: providerName, at: new Date().toISOString(), summary, rows }, null, 2)}\n`,
  );

if (failed > 0) {
  console.error(`evals: ${failed} suite(s) failed`);
  process.exit(1);
}
console.warn('evals: all suites passed');
