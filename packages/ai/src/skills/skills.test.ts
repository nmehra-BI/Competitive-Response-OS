import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SkillKey } from '@growth-os/contracts';
import { resolvePlaceholders, type FixtureTurn } from '../providers/fixture-provider';
import {
  createFileSkillLoader,
  defaultSkillsDir,
  readManifest,
  skillOutputJsonSchema,
  skillOutputSchema,
} from './loader';

const dir = defaultSkillsDir();
/** Scripts that deliberately return invalid output first (failure-path fixtures). */
const ADVERSARIAL = new Set(['malformed', 'injection', 'repair']);

describe('skill bundles', () => {
  it.each(SkillKey.options)('%s is complete, active and its fixture outputs validate', async (key) => {
    const bundle = await createFileSkillLoader(dir).load(key);
    expect(bundle.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(bundle.instructions).toMatch(/data, never instructions/);
    const files = await readdir(join(dir, key, 'fixtures'));
    expect(files).toContain('default.json');
    const schema = skillOutputSchema(bundle.allowedProposalTypes);
    for (const f of files.filter((n) => n.endsWith('.json'))) {
      const turns = JSON.parse(await readFile(join(dir, key, 'fixtures', f), 'utf8')) as FixtureTurn[];
      const finals = turns.filter((t) => t.type === 'final');
      const last = finals[finals.length - 1];
      if (!last || f === 'malformed.json') continue; // fails twice by design
      const r = schema.safeParse(resolvePlaceholders(last.output, []));
      expect(r.success, `${key}/${f}: ${r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))}`).toBe(
        true,
      );
      for (const t of turns.filter((x) => x.type === 'tool_calls'))
        for (const c of t.calls ?? [])
          if (!ADVERSARIAL.has(f.replace('.json', ''))) expect(bundle.allowedTools).toContain(c.tool);
    }
  });

  it.each(SkillKey.options)(
    '%s output.schema.json is up to date (pnpm --filter @growth-os/ai skills:schemas)',
    async (key) => {
      const m = await readManifest(dir, key);
      const onDisk = JSON.parse(await readFile(join(dir, key, 'output.schema.json'), 'utf8')) as unknown;
      expect(onDisk).toEqual(skillOutputJsonSchema(key, m.allowed_proposal_types));
    },
  );

  it('refuses unknown skills', async () => {
    await expect(createFileSkillLoader(dir).load('nope' as SkillKey)).rejects.toThrow(/Unknown skill/);
  });
});
