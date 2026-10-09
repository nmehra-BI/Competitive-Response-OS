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

export const handlers: HandlerMap = {
  // Modules register here as they land, e.g. ...platformHandlers, ...meHandlers
};
