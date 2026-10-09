/**
 * @growth-os/domain — pure, deterministic domain logic. No I/O, no clock reads (pass `now`),
 * no randomness. Growth OS shared primitives live in ./platform; Market Expansion logic in ./me.
 */
export * from './platform/workflow/state-machine';
export * from './platform/workflow/machines';
export * from './platform/workflow/guards';
export * from './platform/workflow/runtime';
export * from './platform/policy/policy-engine';
export * from './platform/snapshot/canonical';
export * from './platform/materiality/materiality';
export * from './platform/audit/audit-writer';
export * from './me/lifecycle/machines';
export * from './me/lifecycle/runtime';
export * from './me/gates/definitions';
export * from './me/gates/preconditions';
export * from './me/gates/snapshot-builder';
export * from './me/sizing/engine';
export * from './me/economics/engine';
export * from './me/comparison/ranking';
