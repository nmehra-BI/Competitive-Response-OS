/**
 * Module handler registry. Each module folder exports `handlers: HandlerMap` keyed by operation
 * id from @growth-os/contracts. Ownership per folder is listed in BUILD_PLAN.md.
 *
 *   platform/   auth, viewer, search, comments, evidence, reviews, my-work, admin, audit  (WS1, WS4)
 *   me/         overview, mandates, opportunities, comparisons, cases, thesis, sizing, lineage,
 *               feasibility, economics, assumptions, experiments, gates, pilot, budget, outcomes (WS4, WS3)
 *   tasksync/   task-set preview, send, retry, export, dev simulator endpoints              (WS6)
 *   analysis/   analysis runs and proposals                                                  (WS5)
 */
import type { HandlerMap } from '../server';
import { adminHandlers } from './platform/admin';
import { auditHandlers } from './platform/audit';
import { authHandlers } from './platform/auth';
import { commentHandlers } from './platform/comments';
import { evidenceHandlers } from './platform/evidence';
import { searchHandlers } from './platform/search';
import { assumptionHandlers } from './me/assumptions';
import { caseHandlers } from './me/cases';
import { comparisonHandlers } from './me/comparisons';
import { economicsHandlers } from './me/economics';
import { feasibilityHandlers } from './me/feasibility';
import { lineageHandlers } from './me/lineage';
import { mandateHandlers } from './me/mandates';
import { opportunityHandlers } from './me/opportunities';
import { overviewHandlers } from './me/overview';
import { sizingHandlers } from './me/sizing';
import { thesisHandlers } from './me/thesis';

export const handlers: HandlerMap = {
  // Modules register here as they land, e.g. ...platformHandlers, ...meHandlers
  ...authHandlers,
  ...evidenceHandlers,
  ...searchHandlers,
  ...commentHandlers,
  ...adminHandlers,
  ...auditHandlers,
  ...caseHandlers,
  ...assumptionHandlers,
  ...comparisonHandlers,
  ...mandateHandlers,
  ...opportunityHandlers,
  ...sizingHandlers,
  ...economicsHandlers,
  ...lineageHandlers,
  ...thesisHandlers,
  ...feasibilityHandlers,
  ...overviewHandlers,
};
