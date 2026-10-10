/**
 * Connector selection by provider (D-020, D-135).
 *
 *   jira_simulated  the simulated task tool in the `sim` schema — always available, the default
 *   jira_cloud      the Jira Cloud adapter (OAuth 2.0 3LO integration account) when Jira is on for
 *                   this process: `TASK_CONNECTOR=jira`, or the complete Jira configuration in the
 *                   environment (see `jiraRequested`), or a `jira` block passed by tests
 *   anything else   an always-unavailable adapter (callers pause and offer CSV export)
 *
 * Call sites pass `{ id, provider }` (frozen); `tenantId` is optional and saves the Jira adapter a
 * tenant lookup. The worker role resolves the tenant itself; the API role cannot (it never lists
 * tenants), so API call sites for a Jira connection pass it.
 */
import { ConnectorError, type TaskConnector } from './task-connector';
import { createPgSimStore, type SimExecutor } from './simulated/pg-store';
import { createSimulatedConnector, SIMULATED_PROVIDER } from './simulated/simulated-connector';
import { createJiraConnector } from './jira/adapter';
import { JIRA_CLOUD_PROVIDER, jiraConfigFromEnv, jiraRequested, type JiraConfig } from './jira/config';
import type { FetchLike } from './jira/http';
import { canRunTransactions, createPgCredentialStore, type CredentialStore } from './jira/store';

export interface ConnectionRef {
  id: string;
  provider: string;
  /** Optional (additive): the connection's tenant, when the caller knows it. */
  tenantId?: string;
}

/** Build the TaskConnector for a connection. Unknown providers get an always-unavailable adapter. */
export type ConnectorFactory = (connection: ConnectionRef) => TaskConnector;

/** Optional Jira block (tests): explicit config, credential store, fetch and clock. */
export interface JiraFactoryDeps {
  config: JiraConfig;
  store?: (connection: ConnectionRef) => CredentialStore;
  fetch?: FetchLike;
  now?: () => Date;
}

export interface ConnectorFactoryDeps {
  sim: SimExecutor;
  /** Jira Cloud: omitted → from the environment; `null` → off. */
  jira?: JiraFactoryDeps | null;
  env?: Readonly<Record<string, string | undefined>>;
}

/** The Jira block from the environment: null when Jira is off; a reason when it is on but broken. */
export function jiraDepsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): JiraFactoryDeps | { unavailable: string } | null {
  if (!jiraRequested(env)) return null;
  const r = jiraConfigFromEnv(env);
  return r.ok ? { config: r.config } : { unavailable: r.reason };
}

export function createConnectorFactory(deps: ConnectorFactoryDeps): ConnectorFactory {
  const sim = createPgSimStore(deps.sim);
  const jira = deps.jira !== undefined ? deps.jira : jiraDepsFromEnv(deps.env ?? process.env);
  return (connection) => {
    if (connection.provider === SIMULATED_PROVIDER) return createSimulatedConnector(connection.id, sim);
    if (connection.provider === JIRA_CLOUD_PROVIDER && jira) {
      if ('unavailable' in jira) return unavailableConnector(connection.provider, jira.unavailable);
      const store =
        jira.store?.(connection) ??
        (canRunTransactions(deps.sim)
          ? createPgCredentialStore({
              db: deps.sim,
              connectionId: connection.id,
              tenantId: connection.tenantId,
              keys: { current: jira.config.tokenKey, previous: jira.config.previousTokenKeys },
            })
          : null);
      if (!store) return unavailableConnector(connection.provider);
      return createJiraConnector({
        connectionId: connection.id,
        config: jira.config,
        store,
        fetch: jira.fetch,
        now: jira.now,
      });
    }
    return unavailableConnector(connection.provider);
  };
}

/** Every call fails connection-level: callers pause and offer CSV export. */
export function unavailableConnector(provider: string, reason?: string): TaskConnector {
  const message = reason ?? `No task connector is available for provider "${provider}".`;
  const fail = async (): Promise<never> => {
    throw new ConnectorError('unavailable', message);
  };
  return {
    provider,
    health: async () => ({ status: 'unavailable', checkedAt: new Date().toISOString(), message }),
    preview: fail,
    createTask: fail,
    findByIdempotencyKey: fail,
  };
}
