/**
 * Decision snapshot builder (ARCHITECTURE §9.2, D-012). Builds `SnapshotContent` from COMMITTED
 * versions only, validates it against the frozen contract, canonicalizes it with the frozen JCS subset
 * and hashes it with SHA-256 (reusing platform/snapshot/canonical). The result is deep-frozen: what the
 * approver reads is byte-for-byte what is stored and hashed. The database re-checks the hash on insert.
 */
import { SnapshotContent, toFingerprint, type Fingerprint } from '@growth-os/contracts';
import { canonicalize, hashCanonical, sha256Hex } from '../../platform/snapshot/canonical';

export type SnapshotComponentType = SnapshotContent['components'][number]['type'];

export interface SnapshotComponentInput {
  type: SnapshotComponentType;
  id: string;
  version: number | null;
  /** Only committed rows may be pinned. Drafts are refused. */
  state: 'committed' | 'draft';
}

/** Everything in SnapshotContent except the schema version, with component states for the check. */
export type SnapshotBuildInput = Omit<SnapshotContent, 'schemaVersion' | 'components'> & {
  components: readonly SnapshotComponentInput[];
};

export type SnapshotBuildResult =
  | { ok: true; content: SnapshotContent }
  | { ok: false; code: 'PRECONDITIONS_UNMET' | 'VALIDATION_FAILED'; problems: string[] };

export interface FrozenSnapshot {
  /** Per-case snapshot version ("Snapshot v3"). */
  version: number;
  content: Readonly<SnapshotContent>;
  /** platform.decision_snapshot.content_canonical */
  canonical: string;
  /** platform.decision_snapshot.content_hash (lowercase hex SHA-256 of the canonical UTF-8 bytes). */
  hash: string;
  /** "7F3A·19C2" */
  fingerprint: Fingerprint;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Validate and normalize. Components are de-duplicated and sorted (their order carries no meaning). */
export function buildSnapshotContent(input: SnapshotBuildInput): SnapshotBuildResult {
  const drafts = input.components.filter((c) => c.state !== 'committed');
  if (drafts.length > 0) {
    return {
      ok: false,
      code: 'PRECONDITIONS_UNMET',
      problems: drafts.map((d) => `${d.type} ${d.id} is a draft. Commit it before creating a snapshot.`),
    };
  }
  const byKey = new Map<string, SnapshotComponentInput>();
  const problems: string[] = [];
  for (const c of input.components) {
    const k = `${c.type}|${c.id}`;
    const prev = byKey.get(k);
    if (prev && prev.version !== c.version) {
      problems.push(`${c.type} ${c.id} is pinned at two versions (${prev.version} and ${c.version}).`);
    }
    byKey.set(k, c);
  }
  if (problems.length > 0) return { ok: false, code: 'VALIDATION_FAILED', problems };

  const components = [...byKey.values()]
    .map(({ type, id, version }) => ({ type, id, version }))
    .sort((a, b) => (a.type === b.type ? (a.id < b.id ? -1 : 1) : a.type < b.type ? -1 : 1));

  const { components: _ignored, ...rest } = input;
  const parsed = SnapshotContent.safeParse({ ...rest, schemaVersion: 1, components });
  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_FAILED',
      problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  try {
    canonicalize(parsed.data); // non-integer numbers are refused: money must be decimal strings
  } catch (e) {
    return { ok: false, code: 'VALIDATION_FAILED', problems: [(e as Error).message] };
  }
  return { ok: true, content: parsed.data };
}

/** Canonicalize, hash and deep-freeze a built snapshot. */
export async function freezeSnapshot(content: SnapshotContent, version: number): Promise<FrozenSnapshot> {
  if (!Number.isInteger(version) || version < 1)
    throw new Error('snapshot version must be a positive integer');
  const copy = structuredClone(content);
  const { canonical, hash } = await hashCanonical(copy);
  return deepFreeze({ version, content: copy, canonical, hash, fingerprint: toFingerprint(hash) });
}

/** Build and freeze in one step. */
export async function createSnapshot(
  input: SnapshotBuildInput,
  version: number,
): Promise<{ ok: true; snapshot: FrozenSnapshot } | Extract<SnapshotBuildResult, { ok: false }>> {
  const built = buildSnapshotContent(input);
  if (!built.ok) return built;
  return { ok: true, snapshot: await freezeSnapshot(built.content, version) };
}

/** Snapshot versions are numbered per case: next = max + 1. */
export function nextSnapshotVersion(existing: readonly number[]): number {
  return existing.length === 0 ? 1 : Math.max(...existing) + 1;
}

/** Re-verify stored canonical text against its hash (the DB CHECK does the same). */
export async function verifySnapshotHash(canonical: string, hash: string): Promise<boolean> {
  return (await sha256Hex(canonical)) === hash;
}

export interface SnapshotDiff {
  /** Top-level content fields whose value differs. */
  changedFields: string[];
  components: {
    added: SnapshotContent['components'];
    removed: SnapshotContent['components'];
    /** Same object pinned at a different version. */
    changed: { type: SnapshotComponentType; id: string; from: number | null; to: number | null }[];
  };
}

/** "See what changed" between two snapshot contents (e.g. v3 → v4). */
export function diffSnapshotContent(from: SnapshotContent, to: SnapshotContent): SnapshotDiff {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  keys.delete('components');
  const f = from as unknown as Record<string, unknown>;
  const t = to as unknown as Record<string, unknown>;
  const changedFields = [...keys]
    .filter((k) => canonicalize(f[k] ?? null) !== canonicalize(t[k] ?? null))
    .sort();

  const idx = (c: SnapshotContent['components']) => new Map(c.map((x) => [`${x.type}|${x.id}`, x]));
  const a = idx(from.components);
  const b = idx(to.components);
  const added = [...b.entries()].filter(([k]) => !a.has(k)).map(([, v]) => v);
  const removed = [...a.entries()].filter(([k]) => !b.has(k)).map(([, v]) => v);
  const changed = [...b.entries()]
    .filter(([k, v]) => a.has(k) && a.get(k)?.version !== v.version)
    .map(([, v]) => ({
      type: v.type,
      id: v.id,
      from: a.get(`${v.type}|${v.id}`)?.version ?? null,
      to: v.version,
    }));
  return { changedFields, components: { added, removed, changed } };
}
