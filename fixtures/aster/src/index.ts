/**
 * @growth-os/fixtures-aster — canonical, synthetic Aster Industrial Systems data (PRD §6, §15).
 * Labelled "Illustrative data" wherever it is shown.
 */
import * as org from './org';
import * as discovery from './discovery';
import * as assessment from './assessment';
import * as decisions from './decisions';
import { journeyMoments } from './journey';

export * from './ids';
export * from './org';
export * from './discovery';
export * from './assessment';
export * from './decisions';
export * from './expected';
export * from './journey';

/** Every collection, for the seed runner and MSW mocks. */
export const asterFixture = {
  tenant: org.tenant,
  businessUnits: org.businessUnits,
  products: org.products,
  segments: org.segments,
  people: Object.values(org.people),
  roleAssignments: org.roleAssignments,
  authorityGrants: org.authorityGrants,
  gatePolicies: org.gatePolicies,
  materialityRules: org.materialityRules,
  licenses: org.licenses,
  sourceEntitlements: org.sourceEntitlements,
  connections: org.connections,
  connectorMappings: org.connectorMappings,
  committeeMembers: org.committeeMembers,
  sources: discovery.sources,
  mandate: discovery.mandate,
  opportunities: discovery.opportunities,
  comparison: discovery.comparison,
  cases: discovery.cases,
  assumptions: assessment.assumptions,
  adoptionDispute: assessment.adoptionDispute,
  sizingV2Input: assessment.sizingV2Input,
  economicsV2Input: assessment.economicsV2Input,
  feasibility: assessment.feasibility,
  exp03: decisions.exp03,
  validationTasks: decisions.validationTasks,
  gates: decisions.gates,
  pilotMilestones: decisions.pilotMilestones,
  pilotTasks: decisions.pilotTasks,
  outcomeTargets: decisions.outcomeTargets,
  outcomeObservations: decisions.outcomeObservations,
  outcomeReview: decisions.outcomeReview,
  journeyMoments,
} as const;
