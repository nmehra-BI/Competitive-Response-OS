/**
 * FROZEN Growth OS shared primitives: tenant, identity, roles, delegated authority, policy,
 * connections. (PRD §9 "Shared" rows; §16 alignment.)
 */
import { z } from 'zod';
import {
  ConnectionKind,
  ConnectorStatus,
  GateCode,
  MaterialChangeType,
  MaterialityClass,
  PolicyKind,
  PrincipalKind,
  RoleCode,
} from '../enums';
import { CountryCode, CurrencyCode, DecimalString, Id, IsoDate, IsoDateTime, PersonRef } from '../primitives';

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
});
export type AuthorityGrant = z.infer<typeof AuthorityGrant>;

/** Gate policy body (S14 "Gate policies"). Preconditions are evaluated by deterministic code. */
export const GatePolicyBody = z.object({
  gateCode: GateCode,
  preconditionKeys: z.array(z.string()), // keys understood by packages/domain/src/me/gates
  requiredApprovals: z.number().int().min(1).default(1),
  requiredSignOffAreas: z.array(z.string()).default([]),
  approvalExpiryDays: z.number().int().positive().default(14),
  selfApprovalAllowed: z.literal(false).default(false),
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
