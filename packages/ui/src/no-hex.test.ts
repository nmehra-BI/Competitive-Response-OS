/**
 * Components reference token variables only (FRONTEND §5.1). Raw hex colours are allowed in
 * tokens.css alone. This stands in for stylelint `color-no-hex` and also covers TSX.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const DIRS = ['packages/ui/src/components', 'packages/ui/src/styles', 'apps/web/src'];
const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('no raw hex colours outside tokens.css', () => {
  it('components, styles and the web app use tokens', () => {
    const offenders: string[] = [];
    for (const d of DIRS) {
      for (const f of walk(join(ROOT, d))) {
        if (!/\.(tsx?|css)$/.test(f) || f.endsWith('.test.ts') || f.endsWith('.test.tsx')) continue;
        const hits = readFileSync(f, 'utf8').match(HEX);
        if (hits) offenders.push(`${relative(ROOT, f)}: ${hits.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
