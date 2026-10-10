/**
 * Writes skills/<key>/output.schema.json from each skill.yaml (SkillOutput narrowed to the skill's
 * allowed proposal types). Run after changing a manifest: `pnpm --filter @growth-os/ai skills:schemas`.
 * A unit test fails when a checked-in schema is out of date.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SkillKey } from '@growth-os/contracts';
import { defaultSkillsDir, readManifest, skillOutputJsonSchema } from '../src/skills/loader';

const dir = defaultSkillsDir();
for (const key of SkillKey.options) {
  const m = await readManifest(dir, key);
  const schema = skillOutputJsonSchema(key, m.allowed_proposal_types);
  await writeFile(join(dir, key, 'output.schema.json'), `${JSON.stringify(schema, null, 2)}\n`);
  console.warn(`wrote skills/${key}/output.schema.json`);
}
