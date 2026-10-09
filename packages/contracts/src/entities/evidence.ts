/**
 * FROZEN evidence, provenance and licensing model (PRD §9 Source/Evidence/Claim, ME-02, S13).
 *
 * Source facts and model-produced interpretations are stored separately: a Claim has an
 * epistemic kind, and quoted facts link to a permitted EvidencePassage. Restricted sources never
 * return an excerpt, summary or generated paraphrase.
 */
import { z } from 'zod';
import {
  ChallengeKind,
  ChallengeStatus,
  ChallengeTargetType,
  ClaimEvidenceRelation,
  ClaimStatus,
  EntitlementAccess,
  EpistemicKind,
  EvidenceFreshness,
  EvidenceQuality,
  FieldOrigin,
  IngestionStatus,
  SourceAvailability,
  SourceOriginKind,
} from '../enums';
import { DisplayKey, Id, IsoDate, IsoDateTime, PersonRef, Sha256Hex } from '../primitives';

export const License = z.object({
  id: Id,
  key: z.string(),
  name: z.string(),
  /** e.g. "Internal use · excerpts up to 2 sentences · no redistribution of site lists" */
  boundaryText: z.string(),
  maxExcerptSentences: z.number().int().nonnegative(),
  allowModelContext: z.boolean(),
  allowEmbeddings: z.boolean(),
  allowExport: z.boolean(),
});
export type License = z.infer<typeof License>;

export const SourceEntitlement = z.object({
  id: Id,
  licenseId: Id,
  principalType: z.enum(['role', 'user']),
  principal: z.string(), // role code or user id
  access: EntitlementAccess,
});
export type SourceEntitlement = z.infer<typeof SourceEntitlement>;

/** Source metadata. Always safe to show to anyone who can see the case, except restricted titles stay generic. */
export const Source = z.object({
  id: Id,
  key: DisplayKey, // SRC-014
  title: z.string(),
  publisher: z.string().nullable(),
  originKind: SourceOriginKind,
  originText: z.string(), // "Licensed · [Publisher] portal · site-census-2026.pdf"
  uri: z.string().nullable(),
  contentSha256: Sha256Hex.nullable(),
  publishedOn: IsoDate.nullable(),
  retrievedAt: IsoDateTime.nullable(),
  licenseId: Id.nullable(),
  ingestionStatus: IngestionStatus,
  availability: SourceAvailability,
  freshness: EvidenceFreshness,
  ageingDays: z.number().int().nullable(),
  supersededBySourceId: Id.nullable(),
  staleReason: z.string().nullable(),
  deletedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  createdBy: Id,
});
export type Source = z.infer<typeof Source>;

/** A permitted excerpt. Full text lives in object storage and is never sent to a viewer without entitlement. */
export const EvidencePassage = z.object({
  id: Id,
  sourceId: Id,
  locator: z.string(), // "p. 12", "Table 3"
  excerpt: z.string(), // within the licence excerpt limit; empty when restricted
  excerptSha256: Sha256Hex,
});
export type EvidencePassage = z.infer<typeof EvidencePassage>;

/** Source chip shown beside claims and ledger inputs. */
export const SourceChip = z.object({
  sourceId: Id,
  key: DisplayKey,
  label: z.string(), // "Site census · 3 Jun 2026"
  quality: EvidenceQuality,
  restricted: z.boolean(),
});
export type SourceChip = z.infer<typeof SourceChip>;

export const Claim = z.object({
  id: Id,
  caseId: Id.nullable(),
  statement: z.string(),
  kind: EpistemicKind,
  kindDetail: z.string().nullable(), // "Site census 2026", "Jonas Klein", "Base · Year 3"
  origin: FieldOrigin,
  agentRunId: Id.nullable(),
  status: ClaimStatus,
  acceptedBy: Id.nullable(),
  acceptedAt: IsoDateTime.nullable(),
  sources: z.array(SourceChip),
  disputed: z.boolean(),
  createdAt: IsoDateTime,
  createdBy: Id,
});
export type Claim = z.infer<typeof Claim>;

export const ClaimEvidenceLink = z.object({
  id: Id,
  claimId: Id,
  sourceId: Id,
  passageId: Id.nullable(),
  relation: ClaimEvidenceRelation,
});
export type ClaimEvidenceLink = z.infer<typeof ClaimEvidenceLink>;

/** Challenges on claims and sources, and disputes on assumptions. Stay until resolved with a reason. */
export const Challenge = z.object({
  id: Id,
  kind: ChallengeKind,
  targetType: ChallengeTargetType,
  targetId: Id,
  caseId: Id.nullable(),
  raisedBy: PersonRef,
  statement: z.string(),
  proposedValue: z.string().nullable(),
  status: ChallengeStatus,
  resolution: z.string().nullable(),
  resolvedBy: PersonRef.nullable(),
  resolvedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  replies: z.array(z.object({ id: Id, author: PersonRef, body: z.string(), createdAt: IsoDateTime })),
});
export type Challenge = z.infer<typeof Challenge>;

/** S13 detail view. `excerpt` and passages are absent when the viewer lacks entitlement. */
export const SourceDetail = z.object({
  source: Source,
  license: License.nullable(),
  viewerAccess: EntitlementAccess,
  passages: z.array(EvidencePassage), // empty unless viewerAccess === 'excerpt'
  quotedFact: z.string().nullable(),
  inferredClaim: z.object({ text: z.string(), acceptedBy: PersonRef.nullable() }).nullable(),
  humanAssumption: z.object({ text: z.string(), owner: PersonRef }).nullable(),
  linkedUses: z.array(z.object({ label: z.string(), where: z.string(), href: z.string() })),
  /** Only cases the viewer can access. Never a count of hidden cases. */
  impact: z.array(z.object({ caseId: Id, caseKey: DisplayKey, what: z.string() })),
  challenges: z.array(Challenge),
});
export type SourceDetail = z.infer<typeof SourceDetail>;
