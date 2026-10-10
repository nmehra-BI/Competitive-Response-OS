/**
 * FROZEN Growth OS shared primitives: tenant, identity, roles, delegated authority, policy,
 * connections. (PRD §9 "Shared" rows; §16 alignment.)
 */
import { z } from 'zod';
import {
  AssigneeMappingStatus,
  CommitteeSeat,
  ConnectionKind,
  ConnectorStatus,
  GateCode,
  MaterialChangeType,
  MaterialityClass,
  PolicyKind,
  PrincipalKind,
  RoleCode,
} from '../enums';
import {
  CountryCode,
  CurrencyCode,
  DecimalString,
  Id,
  IsoDate,
  IsoDateTime,
  PersonRef,
  RateString,
} from '../primitives';

export const Tenant = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  dataResidency: z.string(), // e.g. "eu"
  illustrative: z.boolean(), // true for the Aster sample workspace: UI shows the illustrative-data bar
  /**
   * IANA time zone for tenant-local dates (stale reasons, pilot window ends, "16 Oct"). Absent →
   * Europe/Berlin (D-047, D-049). Additive (D-068).
   */
  timeZone: z.string().min(1).optional(),
});
export type Tenant = z.infer<typeof Tenant>;

export const BusinessUnit = z.object({ id: Id, key: z.string(), name: z.string() });
export type BusinessUnit = z.infer<typeof BusinessUnit>;

export const User = z.object({
  id: Id,
  email: z.string().email(),
  displayName: z.string(),
  title: z.string().nullable(),
  kind: PrincipalKind,
  isActive: z.boolean(),
});
export type User = z.infer<typeof User>;

/** A role held within a scope. Null businessUnitId means all business units; caseId narrows to one case. */
export const RoleAssignment = z.object({
  id: Id,
  userId: Id,
  role: RoleCode,
  businessUnitId: Id.nullable(),
  caseId: Id.nullable(),
  grantedBy: Id,
  grantedAt: IsoDateTime,
  revokedAt: IsoDateTime.nullable(),
});
export type RoleAssignment = z.infer<typeof RoleAssignment>;

/**
 * Delegated authority: who may decide which gate, in which business unit, up to which ceiling.
 * Ceilings are tenant policy. The PRD sets none, so the Aster fixture uses placeholders.
 * A null ceiling means the gate carries no spend (G0).
 */
export const AuthorityGrant = z.object({
  id: Id,
  userId: Id,
  gateCode: GateCode,
  businessUnitId: Id,
  ceilingAmount: DecimalString.nullable(),
  currency: CurrencyCode.nullable(),
  validFrom: IsoDate,
  validTo: IsoDate.nullable(),
  grantedBy: Id,
  revokedAt: IsoDateTime.nullable(),
  /**
   * The Finance-signed delegation-of-authority document the grant was entered from (D-109 §2,
   * CR-PD-2). Absent or null on grants entered before D-122. Additive.
   */
  doaReference: z.string().min(1).nullable().optional(),
});
export type AuthorityGrant = z.infer<typeof AuthorityGrant>;

/**
 * A named committee seat holder (D-109 §3, D-124). Membership names who sits on the investment
 * committee for a business unit; it is NOT authority: a member decides a gate only with a valid
 * authority grant for that gate, BU and amount. Admins record members from the DoA document and
 * never hold a seat for themselves.
 */
export const CommitteeMember = z.object({
  id: Id,
  userId: Id,
  person: PersonRef,
  businessUnitId: Id,
  seat: CommitteeSeat,
  validFrom: IsoDate,
  validTo: IsoDate.nullable(),
  doaReference: z.string().min(1).nullable(),
  enteredBy: Id,
  revokedAt: IsoDateTime.nullable(),
});
export type CommitteeMember = z.infer<typeof CommitteeMember>;

/**
 * Extension (X) rule (D-110 §1): share of the parent G2 budget and window, one per parent G2, scope a
 * subset of the parent's. Both sides of the share are one-time pilot money (never-rule 3 holds).
 */
export const ExtensionRule = z.object({
  maxBudgetShare: RateString, // "0.25"
  maxDurationShare: RateString, // "0.50"
  minDurationDays: z.number().int().positive(), // 14
  maxPerParent: z.number().int().positive(), // 1
  /** Parent G2 + all its extensions ≤ the sponsor's G2 ceiling (D-109 §1 X row). */
  cumulativeWithinSponsorCeiling: z.boolean(),
  /** Real tenants: a null cap or duration is refused at request. Illustrative tenants keep the placeholder. */
  capRequiredInRealTenants: z.boolean(),
});
export type ExtensionRule = z.infer<typeof ExtensionRule>;

/** Default delegated-authority template row for one gate (D-109 §1). One-time EUR per request, excl. VAT. */
export const AuthorityTemplate = z.object({
  sponsorCeiling: DecimalString.nullable(), // null = the sponsor cannot approve this gate (G3)
  committeeCeiling: DecimalString.nullable(), // null = no committee route
  currency: CurrencyCode,
});
export type AuthorityTemplate = z.infer<typeof AuthorityTemplate>;

/** Gate policy body (S14 "Gate policies"). Preconditions are evaluated by deterministic code. */
export const GatePolicyBody = z.object({
  gateCode: GateCode,
  preconditionKeys: z.array(z.string()), // keys understood by packages/domain/src/me/gates
  requiredApprovals: z.number().int().min(1).default(1),
  requiredSignOffAreas: z.array(z.string()).default([]),
  approvalExpiryDays: z.number().int().positive().default(14),
  selfApprovalAllowed: z.literal(false).default(false),
  /** D-109 §4: false for G0 and G3 (never expire in the MVP). Absent = expires. Additive (CR-PD-1). */
  approvalExpires: z.boolean().optional(),
  /** Seats on the committee for this gate (G3: chair, finance, operations). Absent = no committee. */
  committeeSeats: z.array(CommitteeSeat).optional(),
  /** Seats whose approval is required inside the quorum (G3: finance). Quorum = `requiredApprovals`. */
  requiredSeats: z.array(CommitteeSeat).optional(),
  /** Default matrix row (D-109 §1); per-person ceilings stay on authority grants. */
  authority: AuthorityTemplate.optional(),
  /** X only (D-110 §1). */
  extension: ExtensionRule.optional(),
});
export type GatePolicyBody = z.infer<typeof GatePolicyBody>;

/** Materiality rule table (PRD §4). Rules map a change type to a class. Unlisted changes are uncertain. */
export const MaterialityPolicyBody = z.object({
  rules: z.array(
    z.object({
      changeType: MaterialChangeType,
      classification: MaterialityClass,
      note: z.string().optional(),
    }),
  ),
  /** Who resolves an uncertain change. Defaults to the sponsor of the case. */
  escalateTo: z.enum(['sponsor', 'investment_committee']).default('sponsor'),
});
export type MaterialityPolicyBody = z.infer<typeof MaterialityPolicyBody>;

export const RunBudgetPolicyBody = z.object({
  perRunWallTimeMs: z.number().int().positive().default(300_000), // PRD §13: 5-minute bounded brief
  perRunMaxToolCalls: z.number().int().positive().default(40),
  perRunMaxInputTokens: z.number().int().positive(),
  perRunMaxOutputTokens: z.number().int().positive(),
  perCaseMonthlyCostMicros: z.number().int().positive(),
  tenantConcurrentRuns: z.number().int().positive().default(4),
});
export type RunBudgetPolicyBody = z.infer<typeof RunBudgetPolicyBody>;

export const Policy = z.object({
  id: Id,
  kind: PolicyKind,
  key: z.string(),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'active', 'retired']),
  body: z.unknown(), // validated by kind-specific schema above
  createdBy: Id,
  createdAt: IsoDateTime,
});
export type Policy = z.infer<typeof Policy>;

export const Connection = z.object({
  id: Id,
  kind: ConnectionKind,
  provider: z.string(), // "jira_simulated", "jira_cloud", "upload", ...
  name: z.string(),
  scopeText: z.string(),
  status: ConnectorStatus,
  lastSuccessAt: IsoDateTime.nullable(),
  lastCheckedAt: IsoDateTime.nullable(),
  usedFor: z.string(),
  /**
   * Jira Cloud (D-121): the authorized site and integration account, granted scopes and token expiry.
   * Never a token. Null for simulated and upload connections. Additive.
   */
  jira: z
    .object({
      siteUrl: z.string().url(),
      cloudId: z.string().nullable(),
      accountDisplayName: z.string().nullable(), // "Growth OS integration"
      scopes: z.array(z.string()),
      tokenExpiresAt: IsoDateTime.nullable(),
      authorizedBy: PersonRef.nullable(),
      authorizedAt: IsoDateTime.nullable(),
    })
    .nullable()
    .optional(),
});
export type Connection = z.infer<typeof Connection>;

export const ConnectorMapping = z.object({
  id: Id,
  connectionId: Id,
  purpose: z.enum(['validation_tasks', 'pilot_tasks']),
  destinationProject: z.string(), // e.g. "PIL", "ME-VAL"
  issueType: z.string(),
  assigneeMap: z.record(Id, z.string()), // userId -> external account id or email
});
export type ConnectorMapping = z.infer<typeof ConnectorMapping>;

/**
 * S14 task mapping editor "Check with Jira" (D-114 §1): a dry lookup through the connector's
 * `preview()` (no writes), plus the materiality impact of saving. Project or issue-type changes on a
 * mapping used by an approved, unsent task set are `plan_destination_changed` (material by default).
 */
export const ConnectorMappingCheck = z.object({
  mappingId: Id,
  project: z.object({ key: z.string(), name: z.string().nullable(), found: z.boolean() }),
  issueType: z.object({ name: z.string(), found: z.boolean() }),
  assignees: z.array(
    z.object({
      userId: Id,
      person: PersonRef,
      roleText: z.string(), // "Pilot owner"
      externalAccount: z.string().nullable(),
      status: AssigneeMappingStatus,
      message: z.string().nullable(), // "not a member of project PIL"
    }),
  ),
  impact: z
    .object({
      material: z.boolean(),
      changeType: MaterialChangeType,
      lines: z.array(z.string()), // "Approval G2 · Snapshot v3 needs re-approval", "3 unsent tasks pause"
      affectedGateRequestIds: z.array(Id),
    })
    .nullable(), // null = only assignee edits (not material)
  connectionStatus: ConnectorStatus,
  checkedAt: IsoDateTime,
});
export type ConnectorMappingCheck = z.infer<typeof ConnectorMappingCheck>;

/**
 * Tenant "Live analysis" setting (D-120 §4, CR-PD-8). Off by default. An administrator turns it on
 * only with the signed addendum recorded (document reference and date) and a passing manual eval run
 * on the configured provider. The model name stays configuration (`ANALYSIS_MODEL`), never here.
 */
export const LiveAnalysisSetting = z.object({
  enabled: z.boolean(),
  addendumRef: z.string().min(1).nullable(),
  addendumSignedOn: IsoDate.nullable(),
  evalRunRef: z.string().min(1).nullable(),
  evalPassedAt: IsoDateTime.nullable(),
  /** The deployment's ANALYSIS_PROVIDER is a live provider (not `fixture`). Read-only. */
  liveProviderConfigured: z.boolean(),
  changedBy: PersonRef.nullable(),
  changedAt: IsoDateTime.nullable(),
});
export type LiveAnalysisSetting = z.infer<typeof LiveAnalysisSetting>;

/** Enterprise context references (shared). Stable identity, versioned attributes kept minimal in MVP. */
export const Product = z.object({
  id: Id,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});
export type Product = z.infer<typeof Product>;
export const Segment = z.object({ id: Id, key: z.string(), name: z.string() });
export type Segment = z.infer<typeof Segment>;
export const Company = z.object({ id: Id, name: z.string(), parentCompanyId: Id.nullable() });
export type Company = z.infer<typeof Company>;
export const Site = z.object({
  id: Id,
  externalSiteId: z.string(),
  name: z.string(),
  companyId: Id.nullable(),
  countryCode: CountryCode,
  segmentId: Id.nullable(),
  restricted: z.boolean(),
});
export type Site = z.infer<typeof Site>;

/** Session-level "who am I" (GET /me). */
export const Viewer = z.object({
  user: User,
  person: PersonRef,
  tenant: Tenant,
  roles: z.array(RoleAssignment),
  authority: z.array(AuthorityGrant),
  landing: z.string(), // role-based landing route (research §8.2)
  isAdmin: z.boolean(),
});
export type Viewer = z.infer<typeof Viewer>;
