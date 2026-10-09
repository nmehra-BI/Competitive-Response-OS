/**
 * Connector selection by provider. The simulated Jira is the only adapter in the MVP; a real Jira
 * adapter (issue property + label for the key, JQL search for reconcile) plugs in here.
 */
import { ConnectorError, type TaskConnector } from './task-connector';
import { createPgSimStore, type SimExecutor } from './simulated/pg-store';
import { createSimulatedConnector, SIMULATED_PROVIDER } from './simulated/simulated-connector';

export interface ConnectionRef {
  id: string;
  provider: string;
}

/** Build the TaskConnector for a connection. Unknown providers get an always-unavailable adapter. */
export type ConnectorFactory = (connection: ConnectionRef) => TaskConnector;

export function createConnectorFactory(deps: { sim: SimExecutor }): ConnectorFactory {
  const sim = createPgSimStore(deps.sim);
  return (connection) =>
    connection.provider === SIMULATED_PROVIDER
      ? createSimulatedConnector(connection.id, sim)
      : unavailableConnector(connection.provider);
}

/** Every call fails connection-level: callers pause and offer CSV export. */
export function unavailableConnector(provider: string): TaskConnector {
  const message = `No task connector is available for provider "${provider}".`;
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
