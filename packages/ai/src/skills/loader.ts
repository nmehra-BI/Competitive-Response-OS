/**
 * Skill bundles (ARCHITECTURE §12.2): `skills/<key>/skill.yaml` + `instructions.md` + `fixtures/` +
 * `examples/` + `evals/`. A bundle declares its version, allowed tools, allowed proposal types and
 * budget. Skills confer no permissions: the gateway still checks every call, and the per-skill output
 * schema only narrows SkillOutput. The model name is configuration (`ANALYSIS_MODEL`), never here.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AgentToolName, ProposalPayload, SkillKey, SkillOutput, type RunBudget } from '@growth-os/contracts';

export type ProposalType = ProposalPayload['type'];
const PROPOSAL_TYPES = ProposalPayload.options.map((o) => o.shape.type.value) as [
  ProposalType,
  ...ProposalType[],
];
export const ProposalTypeSchema = z.enum(PROPOSAL_TYPES);

export const SkillManifest = z.object({
  key: SkillKey,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: z.enum(['active', 'stub', 'retired']),
  purpose: z.string().min(1),
  subject: z.enum(['case', 'mandate']),
  screens: z.array(z.string()).default([]),
  prd: z.array(z.string()).default([]),
  allowed_tools: z.array(AgentToolName),
  output_schema: z.literal('SkillOutput'),
  allowed_proposal_types: z.array(ProposalTypeSchema).min(1),
  budget: z.object({
    wall_time_ms: z.number().int().positive(),
    max_tool_calls: z.number().int().positive(),
    max_input_tokens: z.number().int().positive(),
    max_output_tokens: z.number().int().positive(),
    max_cost_micros: z.number().int().positive(),
  }),
  model: z.literal('config:ANALYSIS_MODEL'),
  never: z.array(z.string()).min(1),
});
export type SkillManifest = z.infer<typeof SkillManifest>;

export interface SkillBundle {
  key: SkillKey;
  version: string;
  subject: 'case' | 'mandate';
  instructions: string;
  allowedTools: AgentToolName[];
  allowedProposalTypes: ProposalType[];
  budget: RunBudget;
  /** JSON Schema of the skill's output (SkillOutput narrowed to the allowed proposal types). */
  outputSchema: Record<string, unknown>;
}

export interface SkillLoader {
  load(key: SkillKey): Promise<SkillBundle>;
}

/** The repository's `skills/` directory (override with ANALYSIS_SKILLS_DIR). */
export function defaultSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ANALYSIS_SKILLS_DIR) return resolve(env.ANALYSIS_SKILLS_DIR);
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../../skills');
}

/** SkillOutput restricted to the proposal types a skill may produce (same envelope, fewer variants). */
export function skillOutputSchema(
  allowed: readonly ProposalType[],
): z.ZodType<SkillOutput, z.ZodTypeDef, unknown> {
  const options = ProposalPayload.options.filter((o) => allowed.includes(o.shape.type.value));
  if (options.length === 0) throw new Error('A skill needs at least one proposal type');
  const payload =
    options.length === 1
      ? options[0]!
      : z.discriminatedUnion(
          'type',
          options as unknown as [(typeof options)[number], (typeof options)[number], ...typeof options],
        );
  return SkillOutput.extend({ proposals: z.array(payload) }).strict() as unknown as z.ZodType<
    SkillOutput,
    z.ZodTypeDef,
    unknown
  >;
}

/** JSON Schema of a skill's output (written to skills/<key>/output.schema.json and sent to providers). */
export function skillOutputJsonSchema(
  key: string,
  allowed: readonly ProposalType[],
): Record<string, unknown> {
  const schema = zodToJsonSchema(skillOutputSchema(allowed), { target: 'jsonSchema7' }) as Record<
    string,
    unknown
  >;
  return {
    ...schema,
    title: `${key} output`,
    description: `SkillOutput (@growth-os/contracts) for ${key}. Allowed proposal types: ${allowed.join(', ')}.`,
  };
}

export function bundleFrom(manifest: SkillManifest, instructions: string): SkillBundle {
  return {
    key: manifest.key,
    version: manifest.version,
    subject: manifest.subject,
    instructions,
    allowedTools: manifest.allowed_tools,
    allowedProposalTypes: manifest.allowed_proposal_types,
    budget: {
      wallTimeMs: manifest.budget.wall_time_ms,
      maxToolCalls: manifest.budget.max_tool_calls,
      maxInputTokens: manifest.budget.max_input_tokens,
      maxOutputTokens: manifest.budget.max_output_tokens,
      maxCostMicros: manifest.budget.max_cost_micros,
    },
    outputSchema: skillOutputJsonSchema(manifest.key, manifest.allowed_proposal_types),
  };
}

export async function readManifest(skillsDir: string, key: string): Promise<SkillManifest> {
  const raw = await readFile(join(skillsDir, key, 'skill.yaml'), 'utf8');
  const manifest = SkillManifest.parse(parseYaml(raw));
  if (manifest.key !== key) throw new Error(`skills/${key}/skill.yaml declares key ${manifest.key}`);
  return manifest;
}

/** Loads bundles from disk. Unknown keys and non-active bundles are refused. */
export function createFileSkillLoader(skillsDir = defaultSkillsDir()): SkillLoader {
  const cache = new Map<string, Promise<SkillBundle>>();
  return {
    load(key) {
      if (!SkillKey.safeParse(key).success) return Promise.reject(new Error(`Unknown skill ${key}`));
      let hit = cache.get(key);
      if (!hit) {
        hit = (async () => {
          const manifest = await readManifest(skillsDir, key);
          if (manifest.status !== 'active') throw new Error(`Skill ${key} is ${manifest.status}`);
          const instructions = await readFile(join(skillsDir, key, 'instructions.md'), 'utf8');
          return bundleFrom(manifest, instructions);
        })();
        hit.catch(() => cache.delete(key));
        cache.set(key, hit);
      }
      return hit;
    },
  };
}
