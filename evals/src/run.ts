/**
 * Eval runner. TODO(WS5): load cases from evals/cases and skills/<key>/evals, run the harness with
 * the selected provider, score with the suite graders, write a JSON report and fail CI on any
 * zero-tolerance suite failure.
 */
import { SUITES } from './suites';

const provider = process.argv.includes('--provider')
  ? process.argv[process.argv.indexOf('--provider') + 1]
  : 'fixture';
console.warn(
  `evals skeleton: provider=${provider}; ${SUITES.length} suites declared; no cases run yet (WS5).`,
);
