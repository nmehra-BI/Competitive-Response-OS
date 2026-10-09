/**
 * Request context types shared by the command pipeline (pipeline.ts) and every module.
 * See pipeline.ts for the step order and docs/market-expansion/build/notes/WS1.md for usage.
 */
import type { Db, ObjectStore } from '@growth-os/db';
import type {
  AuthorityGrant,
  PrincipalKind,
  RoleAssignment,
  RoleCode,
  Tenant,
  User,
} from '@growth-os/contracts';
import type { Actor, PolicySubject } from '@growth-os/domain';
import type { PlatformConfig } from './config';

/** Long-lived services the pipeline hands to handlers. Injected in tests. */
export interface PlatformDeps {
  /** App-role pool (me_app, NOBYPASSRLS). Queries run only inside withTenant(). */
  db: Db;
  objects: ObjectStore;
  config: PlatformConfig;
  /** Injectable clock for deterministic tests. */
  now: () => Date;
}

/** The authenticated session, as resolved from the cookie (ids only). */
export interface SessionRef {
  sessionId: string;
  tenantId: string;
  userId: string;
}

/** Who is calling: user row facts plus their roles and delegated authority. */
export interface Identity {
  session: SessionRef;
  user: User & { initials: string };
  tenant: Tenant;
  kind: PrincipalKind;
  interactive: boolean;
  roles: RoleAssignment[];
  authority: AuthorityGrant[];
  /** Cases where the user is owner, sponsor or a listed participant. */
  participantOfCaseIds: string[];
  actor: Actor;
  subject: PolicySubject;
}

/** Outcome of an `authorize` hook. `role` is recorded on audit and analytics as the actor role. */
export type Authorization =
  | { allow: true; rule: string; authorityGrantId: string | null; role?: RoleCode | null }
  | {
      allow: false;
      rule: string;
      code:
        | 'FORBIDDEN'
        | 'NOT_FOUND'
        | 'AGENT_IDENTITY_FORBIDDEN'
        | 'AUTHORITY_INSUFFICIENT'
        | 'SELF_APPROVAL_PROHIBITED'
        | 'CONFLICT_OF_INTEREST'
        | 'RESTRICTED_SOURCE';
      reason: string;
    };

export type Allowed = Extract<Authorization, { allow: true }>;

/** A file received with a multipart request (evidence upload). */
export interface UploadedFile {
  fieldName: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}
