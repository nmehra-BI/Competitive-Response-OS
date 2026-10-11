/**
 * evidence.ingest (ARCHITECTURE.md §11, ME-02). For one uploaded source:
 *   1. load the original from object storage and verify its SHA-256 against the source row
 *   2. sanitize: drop scripts, styles, comments, hidden elements, zero-width and control characters
 *   3. extract permitted passages: at most the licence's excerpt limit (sentences) per passage
 *   4. mark ingested (or partial when no text can be extracted, e.g. a binary file)
 * Failures set ingestion_status = 'failed' with an audit event. Content is never invented: a file
 * that cannot be read yields no passages. Idempotent: only `pending` sources are processed.
 */
import { createHash } from 'node:crypto';
import { auditWriter, withTenant, type Db, type ObjectStore, type Tx } from '@growth-os/db';
import type { EvidenceIngestPayload } from '../catalog';

export const MAX_PASSAGES = 3;
export const MAX_EXCERPT_CHARS = 600;

const HIDDEN_ELEMENT =
  /<([a-z][\w-]*)\b[^>]*(?:\bhidden\b|aria-hidden\s*=\s*["']?true|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'])[^>]*>[\s\S]*?<\/\1\s*>/gi;

const range = (from: number, to: number): string => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
/** Zero-width, bidi-control and word-joiner characters (U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+FEFF). */
const INVISIBLE = new RegExp(
  `[${range(0x200b, 0x200f)}${range(0x202a, 0x202e)}${range(0x2060, 0x2064)}${String.fromCharCode(0xfeff)}]`,
  'g',
);
/** C0 controls except tab, newline and carriage return, plus DEL. */
const CONTROL = new RegExp(
  `[${range(0x00, 0x08)}${String.fromCharCode(0x0b, 0x0c)}${range(0x0e, 0x1f)}${String.fromCharCode(0x7f)}]`,
  'g',
);

/** Plain text from an untrusted document. Removes active and hidden content (prompt-injection control). */
export function sanitizeText(raw: string): string {
  let s = raw;
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|template|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(HIDDEN_ELEMENT, ' ');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article)\s*>|<br\s*\/?>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  // Zero-width and bidi control characters hide text from readers; other controls are noise.
  s = s.replace(INVISIBLE, '');
  s = s.replace(CONTROL, ' ');
  return s
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

export function firstSentences(paragraph: string, n: number): string {
  const sentences = paragraph.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [paragraph];
  return sentences
    .slice(0, n)
    .map((x) => x.trim())
    .join(' ')
    .slice(0, MAX_EXCERPT_CHARS)
    .trim();
}

/** Permitted passages: up to MAX_PASSAGES paragraphs, each cut to the licence sentence limit. */
export function extractPassages(text: string, maxSentences: number): { locator: string; excerpt: string }[] {
  if (maxSentences <= 0) return [];
  return text
    .split('\n\n')
    .slice(0, MAX_PASSAGES)
    .map((p, i) => ({ locator: `¶ ${i + 1}`, excerpt: firstSentences(p, maxSentences) }))
    .filter((p) => p.excerpt.length > 0);
}

export function looksBinary(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  return head.includes(0) || (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46); // NUL or %PDF
}

async function record(
  tx: Tx,
  sourceId: string,
  key: string,
  action: string,
  summary: string,
  details: Record<string, string | number | boolean | null>,
) {
  await auditWriter.record(tx, {
    actorUserId: null,
    actorKind: 'system',
    actorRole: null,
    action,
    objectType: 'source',
    objectId: sourceId,
    objectVersion: null,
    caseId: null,
    beforeHash: null,
    afterHash: null,
    summary,
    details: { sourceKey: key, ...details },
    authz: { decision: 'allow', rule: 'worker:evidence.ingest', authorityGrantId: null },
  });
}

export type IngestResult = 'ingested' | 'partial' | 'failed' | 'skipped';

export async function ingestSource(
  db: Db,
  store: ObjectStore,
  p: EvidenceIngestPayload,
): Promise<IngestResult> {
  return withTenant(
    db,
    { tenantId: p.tenantId, userId: null, correlationId: p.correlationId },
    async (tx) => {
      const src = await tx
        .selectFrom('platform.source')
        .selectAll()
        .where('id', '=', p.sourceId)
        .forUpdate()
        .executeTakeFirst();
      if (!src || src.ingestion_status !== 'pending') return 'skipped';
      const fail = async (reason: string): Promise<IngestResult> => {
        await tx
          .updateTable('platform.source')
          .set({ ingestion_status: 'failed' })
          .where('id', '=', src.id)
          .execute();
        await record(
          tx,
          src.id,
          src.display_key,
          'source.ingestion_failed',
          `Ingestion failed for ${src.display_key}: ${reason}`,
          { reason },
        );
        return 'failed';
      };
      if (!src.object_key || !src.content_sha256) return fail('no stored file');
      const bytes = await store.get(src.object_key);
      if (!bytes) return fail('stored file missing');
      if (createHash('sha256').update(bytes).digest('hex') !== src.content_sha256)
        return fail('content hash mismatch');

      const license = src.license_id
        ? await tx
            .selectFrom('platform.license')
            .select(['max_excerpt_sentences'])
            .where('id', '=', src.license_id)
            .executeTakeFirst()
        : undefined;
      const maxSentences = license?.max_excerpt_sentences ?? 0;

      if (looksBinary(bytes)) {
        await tx
          .updateTable('platform.source')
          .set({ ingestion_status: 'partial' })
          .where('id', '=', src.id)
          .execute();
        await record(
          tx,
          src.id,
          src.display_key,
          'source.ingested',
          `${src.display_key} stored; no text extracted from this file type`,
          { passageCount: 0, binary: true },
        );
        return 'partial';
      }
      let text: string;
      try {
        text = sanitizeText(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        return fail('file is not valid UTF-8 text');
      }
      const passages = extractPassages(text, maxSentences);
      for (const ps of passages)
        await tx
          .insertInto('platform.evidence_passage')
          .values({
            tenant_id: p.tenantId,
            source_id: src.id,
            locator: ps.locator,
            excerpt: ps.excerpt,
            excerpt_sha256: createHash('sha256').update(ps.excerpt, 'utf8').digest('hex'),
          })
          .execute();
      await tx
        .updateTable('platform.source')
        .set({ ingestion_status: 'ingested' })
        .where('id', '=', src.id)
        .execute();
      await record(
        tx,
        src.id,
        src.display_key,
        'source.ingested',
        `${src.display_key} ingested: ${passages.length} permitted passages`,
        {
          passageCount: passages.length,
          maxSentences,
        },
      );
      return 'ingested';
    },
  );
}
