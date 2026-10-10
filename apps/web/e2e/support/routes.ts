/**
 * One concrete URL per frozen route (FRONTEND §3), with the research's deep-link examples.
 * The a11y crawl visits all of them; journey specs reuse them.
 */
export const ROUTE_SAMPLES: Record<string, string> = {
  login: '/login',
  overview: '/me/overview?view=operator',
  mandates: '/me/mandates',
  mandateNew: '/me/mandates/new',
  mandate: '/me/mandates/MD-21?version=2',
  opportunities: '/me/opportunities?mandate=MD-21&selected=OPP-07',
  compare: '/me/opportunities/compare?ids=OPP-07,OPP-14,OPP-09,OPP-16',
  cases: '/me/cases',
  caseThesis: '/me/cases/ME-104/thesis',
  caseSizing: '/me/cases/ME-104/sizing?input=adoption-rate&view=lineage',
  caseFeasibility: '/me/cases/ME-104/feasibility',
  caseEconomics: '/me/cases/ME-104/economics',
  caseValidation: '/me/cases/ME-104/validation?experiment=EXP-03',
  caseDecisions: '/me/cases/ME-104/decisions?gate=G2&version=3&compare=2',
  caseBrief: '/me/cases/ME-104/brief?gate=G2&version=3',
  casePilot: '/me/cases/ME-104/pilot',
  caseOutcomes: '/me/cases/ME-104/outcomes',
  caseHistory: '/me/cases/ME-104/history',
  myWork: '/my-work',
  reviews: '/reviews?tab=awaiting',
  evidence: '/evidence',
  evidenceSource: '/evidence/SRC-014',
  admin: '/admin/health',
  designSystem: '/design-system',
};
