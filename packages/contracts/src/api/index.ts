/**
 * FROZEN API registry. `ENDPOINTS` is the single list the API registers and tests check:
 * every endpoint has a unique id and unique method+path, at least one screen and PRD reference.
 */
import type { EndpointDef } from './endpoint';
import {
  authEndpoints,
  commentEndpoints,
  directoryEndpoints,
  overviewEndpoints,
  searchEndpoints,
  workEndpoints,
} from './shell';
import { comparisonEndpoints, mandateEndpoints, opportunityEndpoints } from './discovery';
import {
  assumptionEndpoints,
  caseEndpoints,
  economicsEndpoints,
  feasibilityEndpoints,
  lineageEndpoints,
  sizingEndpoints,
  thesisEndpoints,
} from './assessment';
import { experimentEndpoints, gateEndpoints } from './decide';
import { budgetEndpoints, outcomeEndpoints, pilotEndpoints, taskSyncEndpoints } from './execute';
import { adminEndpoints, analysisEndpoints, devEndpoints, evidenceEndpoints } from './support';

export * from './endpoint';
export * from './shell';
export * from './discovery';
export * from './assessment';
export * from './decide';
export * from './execute';
export * from './support';

export const API = {
  auth: authEndpoints,
  overview: overviewEndpoints,
  work: workEndpoints,
  search: searchEndpoints,
  comments: commentEndpoints,
  directory: directoryEndpoints,
  mandates: mandateEndpoints,
  opportunities: opportunityEndpoints,
  comparisons: comparisonEndpoints,
  cases: caseEndpoints,
  thesis: thesisEndpoints,
  sizing: sizingEndpoints,
  lineage: lineageEndpoints,
  feasibility: feasibilityEndpoints,
  economics: economicsEndpoints,
  assumptions: assumptionEndpoints,
  experiments: experimentEndpoints,
  gates: gateEndpoints,
  pilot: pilotEndpoints,
  taskSync: taskSyncEndpoints,
  budget: budgetEndpoints,
  outcomes: outcomeEndpoints,
  evidence: evidenceEndpoints,
  analysis: analysisEndpoints,
  admin: adminEndpoints,
  dev: devEndpoints,
} as const;

export const ENDPOINTS: readonly EndpointDef[] = Object.values(API).flatMap(
  (group) => Object.values(group) as EndpointDef[],
);
