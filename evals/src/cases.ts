/**
 * Evaluation cases: cross-skill and adversarial cases in `evals/cases/*.json`, per-skill cases in
 * `skills/<key>/evals/cases.json`. Each file holds a list of cases (see evals/README.md).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { SkillKey } from '@growth-os/contracts';
import { SUITES } from './suites';

const SuiteKey = z.enum(SUITES.map((s) => s.key) as [string, ...string[]]);

export const EvalCase = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  skill: SkillKey,
  subject: z.enum(['MD-21', 'ME-104']),
  fixture: z.string().default('default'),
  requester: z.enum(['maya', 'jonas', 'daniel', 'elena', 'admin']).default('maya'),
  suites: z.array(SuiteKey).min(1),
  world: z
    .object({
      injectEvidence: z.boolean().optional(),
      duplicateCohort: z.boolean().optional(),
      restrictedSecret: z.string().optional(),
    })
    .default({}),
  budget: z.object({ maxToolCalls: z.number().int().positive().optional() }).default({}),
  /** Simulate a worker crash on the first n calls of a tool; the runner then resumes the run. */
  interrupt: z.object({ tool: z.string(), times: z.number().int().positive() }).optional(),
  expect: z
    .object({
      status: z.enum(['completed', 'partial', 'failed', 'waiting_for_input']),
      proposalTypes: z.array(z.string()).optional(),
      /** Candidates that must be flagged as likely duplicates of an existing opportunity key. */
      duplicateOf: z.array(z.object({ name: z.string(), key: z.string() })).optional(),
      /** Cohort label pairs that must be proposed for de-duplication. */
      cohortDuplicates: z.array(z.tuple([z.string(), z.string()])).optional(),
      /** Curated candidate names (discovery relevance) and the manual baseline recall to beat. */
      curatedCandidates: z.array(z.string()).optional(),
      manualBaselineRecall: z.number().min(0).max(1).optional(),
      /** Precise figures the output must not keep as facts. */
      unsupportedFigures: z.array(z.string()).optional(),
      /** At least one engine call must have produced the numbers. */
      engineCalls: z.number().int().nonnegative().optional(),
      refusedTools: z.number().int().nonnegative().optional(),
      /** Tools that must not be called again after the interruption. */
      notReexecuted: z.array(z.string()).optional(),
      errorCode: z.string().optional(),
    })
    .strict(),
});
export type EvalCase = z.infer<typeof EvalCase>;

export function repoRoot(): string {
  return resolve(new URL('.', import.meta.url).pathname, '..', '..');
}

async function readCases(file: string): Promise<EvalCase[]> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
  const list = z.array(z.unknown()).parse(raw);
  return list.map((c, i) => {
    const r = EvalCase.safeParse(c);
    if (!r.success)
      throw new Error(
        `${file}[${i}]: ${r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`,
      );
    return r.data;
  });
}

export async function loadCases(root = repoRoot()): Promise<EvalCase[]> {
  const out: EvalCase[] = [];
  const crossDir = join(root, 'evals', 'cases');
  for (const f of (await readdir(crossDir)).filter((n) => n.endsWith('.json')).sort())
    out.push(...(await readCases(join(crossDir, f))));
  for (const key of SkillKey.options) {
    const file = join(root, 'skills', key, 'evals', 'cases.json');
    try {
      out.push(...(await readCases(file)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  const ids = new Set<string>();
  for (const c of out) {
    if (ids.has(c.id)) throw new Error(`duplicate eval case id ${c.id}`);
    ids.add(c.id);
  }
  return out;
}
