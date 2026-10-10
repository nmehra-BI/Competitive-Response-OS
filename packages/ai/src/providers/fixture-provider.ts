/**
 * Deterministic fixture provider (default, D-018). Replays scripted turns from
 * skills/<skill>/fixtures/<fixtureKey>.json. The run's focus may name a script (`focus.fixture`);
 * otherwise the key is `default`. A missing script is an error (`provider_unavailable`), never a
 * silent fallback and never synthetic evidence.
 *
 * A script is a list of turns; the provider returns turn `request.turn` (the number of provider
 * calls already completed, persisted in the run checkpoint), so a resumed run continues exactly
 * where it stopped. Turn shapes:
 *
 *   { "type": "tool_calls", "calls": [{ "callId": "c1", "tool": "evidence.get", "args": {…} }] }
 *   { "type": "needs_input", "question": "…", "options": ["…"] }
 *   { "type": "final", "output": { SkillOutput } }
 *   { "type": "error", "code": "provider_unavailable", "message": "…" }
 *
 * Ids differ per tenant (seeds remap them), so scripts reference what the run was actually given
 * with placeholders that resolve against the context blocks, exactly like a model would copy an id:
 *
 *   ${id:key=OPP-07}        id of the first object in case context / tool results with key OPP-07
 *   ${id:name=Some name}    same, matching on `name`
 *   ${passage:SRC-014}      first passage id returned for source SRC-014 (`#2` for the second)
 *   ${json:subject.sizingInput}  (whole string) a value copied from the case context
 *
 * An unresolvable placeholder becomes a deterministic made-up UUID: the harness then treats it like
 * a hallucinated citation (downgraded) or an unknown reference (schema or write refused).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deterministicUuid } from '../util/hash';
import {
  ZERO_USAGE,
  type AnalysisProvider,
  type ContextBlock,
  type ProviderErrorCode,
  type ProviderRequest,
  type ProviderResponse,
  type TokenUsage,
} from './provider';

export interface FixtureTurn {
  type: 'tool_calls' | 'final' | 'error' | 'needs_input';
  calls?: { callId: string; tool: string; args: Record<string, unknown> }[];
  output?: unknown;
  code?: ProviderErrorCode;
  message?: string;
  question?: string;
  options?: string[];
  usage?: Partial<TokenUsage>;
}

export interface FixtureSource {
  load(skill: string, fixtureKey: string): Promise<FixtureTurn[] | null>;
}

const FIXTURE_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Reads `<skillsDir>/<skill>/fixtures/<key>.json`. Null when the script does not exist. */
export function createFileFixtureSource(skillsDir: string): FixtureSource {
  return {
    async load(skill, fixtureKey) {
      if (!FIXTURE_KEY.test(fixtureKey) || !FIXTURE_KEY.test(skill)) return null;
      try {
        const raw = await readFile(join(skillsDir, skill, 'fixtures', `${fixtureKey}.json`), 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) throw new Error(`fixture ${skill}/${fixtureKey} is not a list of turns`);
        return parsed as FixtureTurn[];
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
  };
}

/** In-memory scripts (tests): `{ "<skill>/<key>": turns }`. */
export function createMemoryFixtureSource(scripts: Record<string, FixtureTurn[]>): FixtureSource {
  return { load: async (skill, key) => scripts[`${skill}/${key}`] ?? null };
}

// ---------------------------------------------------------------------------
// Placeholder resolution
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\$\{(id|passage):([^}]+)\}/g;

function findId(value: unknown, field: string, wanted: string, depth = 0): string | null {
  if (depth > 8 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findId(v, field, wanted, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (obj[field] === wanted && typeof obj.id === 'string') return obj.id;
  for (const v of Object.values(obj)) {
    const hit = findId(v, field, wanted, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export function resolvePlaceholder(kind: string, expr: string, context: readonly ContextBlock[]): string {
  if (kind === 'passage') {
    const [sourceKey, nth] = expr.split('#');
    const passages = context.filter(
      (b): b is Extract<ContextBlock, { kind: 'evidence' }> =>
        b.kind === 'evidence' && b.sourceKey === sourceKey,
    );
    const hit = passages[Math.max(0, Number(nth ?? '1') - 1)];
    if (hit) return hit.evidenceId;
  } else {
    const eq = expr.indexOf('=');
    if (eq > 0) {
      const field = expr.slice(0, eq);
      const wanted = expr.slice(eq + 1);
      for (const b of context) {
        const json = b.kind === 'case_context' || b.kind === 'tool_result' ? b.json : null;
        const hit = findId(json, field, wanted);
        if (hit) return hit;
      }
    }
  }
  return deterministicUuid(`unresolved:${kind}:${expr}`);
}

const WHOLE_JSON = /^\$\{json:([A-Za-z0-9_.]+)\}$/;

/** `${json:subject.sizingInput}`: a whole value copied from the case context (null when absent). */
function jsonAt(path: string, context: readonly ContextBlock[]): unknown {
  const root = context.find((b) => b.kind === 'case_context');
  let cur: unknown = root && root.kind === 'case_context' ? root.json : undefined;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur === undefined ? null : structuredClone(cur);
}

export function resolvePlaceholders<T>(value: T, context: readonly ContextBlock[]): T {
  if (typeof value === 'string' && WHOLE_JSON.test(value))
    return jsonAt(WHOLE_JSON.exec(value)![1]!, context) as T;
  if (typeof value === 'string')
    return value.replace(PLACEHOLDER, (_m, kind: string, expr: string) =>
      resolvePlaceholder(kind, expr, context),
    ) as T;
  if (Array.isArray(value)) return value.map((v) => resolvePlaceholders(v, context)) as T;
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolvePlaceholders(v, context)]),
    ) as T;
  return value;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function createFixtureProvider(source: FixtureSource): AnalysisProvider {
  return {
    name: 'fixture',
    modelConfig: null,
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const turns = await source.load(req.skill, req.fixtureKey);
      if (!turns)
        return {
          type: 'error',
          code: 'provider_unavailable',
          message: `No fixture script "${req.fixtureKey}" for ${req.skill}`,
          usage: ZERO_USAGE,
        };
      const turn = turns[req.turn];
      if (!turn)
        return {
          type: 'error',
          code: 'malformed',
          message: `Fixture script "${req.fixtureKey}" has no turn ${req.turn + 1}`,
          usage: ZERO_USAGE,
        };
      const usage: TokenUsage = { ...ZERO_USAGE, ...turn.usage };
      switch (turn.type) {
        case 'tool_calls':
          return {
            type: 'tool_calls',
            calls: (turn.calls ?? []).map((c) => ({
              callId: c.callId,
              tool: c.tool,
              args: resolvePlaceholders(c.args ?? {}, req.context),
            })),
            usage,
          };
        case 'needs_input':
          return { type: 'needs_input', question: turn.question ?? '', options: turn.options ?? [], usage };
        case 'final':
          return { type: 'final', output: resolvePlaceholders(turn.output, req.context), usage };
        case 'error':
          return {
            type: 'error',
            code: turn.code ?? 'provider_unavailable',
            message: turn.message ?? 'Scripted provider error',
            usage,
          };
        default:
          return { type: 'error', code: 'malformed', message: 'Unknown fixture turn type', usage };
      }
    },
  };
}
