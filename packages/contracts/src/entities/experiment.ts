/**
 * FROZEN validation experiments (PRD ME-09, S09, research §6.10).
 *
 * The plan locks when G1 approves it. Any later change is an amendment with a reason; the
 * original (pre-registered) plan stays visible. Results are append-only versions: a failed
 * threshold never disappears when a result is edited.
 */
import { z } from 'zod';
import { ExperimentLifecycle, ExperimentResultDisplay, ThresholdOperator, ThresholdResult } from '../enums';
import { CurrencyCode, DecimalString, DisplayKey, Id, IsoDate, IsoDateTime, PersonRef } from '../primitives';

export const ExperimentMetric = z.object({
  metricKey: z.string(), // "completed_interviews", "paid_commitments"
  name: z.string(),
  operator: ThresholdOperator,
  thresholdValue: DecimalString.nullable(),
  thresholdText: z.string(), // "≥ 8"
  unit: z.string(),
});
export type ExperimentMetric = z.infer<typeof ExperimentMetric>;

export const DecisionRule = z.object({
  condition: z.string(), // "≥ 4 commitments"
  action: z.string(), // "prepare G2 pilot request"
});
export type DecisionRule = z.infer<typeof DecisionRule>;

export const ExperimentPlan = z.object({
  hypothesis: z.string(),
  method: z.string(),
  sampleText: z.string(),
  sampleSize: z.number().int().positive().nullable(),
  selectionText: z.string(),
  nonresponseNote: z.string(),
  windowStart: IsoDate,
  windowEnd: IsoDate,
  budgetAmount: DecimalString.nullable(),
  currency: CurrencyCode.nullable(),
  budgetNote: z.string().nullable(), // "€15k · approved at G1 (validation only)"
  metrics: z.array(ExperimentMetric).min(1),
  decisionRules: z.array(DecisionRule),
});
export type ExperimentPlan = z.infer<typeof ExperimentPlan>;

export const ExperimentPlanVersion = z.object({
  id: Id,
  experimentId: Id,
  version: z.number().int().positive(),
  isOriginal: z.boolean(), // the pre-registered plan locked at G1
  plan: ExperimentPlan,
  createdBy: PersonRef,
  createdAt: IsoDateTime,
});
export type ExperimentPlanVersion = z.infer<typeof ExperimentPlanVersion>;

export const ExperimentAmendment = z.object({
  id: Id,
  number: z.number().int().positive(), // "Amendment 1"
  fromPlanVersion: z.number().int().positive(),
  toPlanVersion: z.number().int().positive(),
  reason: z.string().min(1),
  changedFields: z.array(z.string()),
  thresholdsChanged: z.boolean(),
  afterResultsSeen: z.boolean(),
  author: PersonRef,
  createdAt: IsoDateTime,
});
export type ExperimentAmendment = z.infer<typeof ExperimentAmendment>;

export const MetricObservation = z.object({
  metricKey: z.string(),
  observed: DecimalString.nullable(),
  observedText: z.string(), // "9", "4 of 4"
  result: ThresholdResult.nullable(), // null while too early to read
});
export type MetricObservation = z.infer<typeof MetricObservation>;

export const ExperimentResultVersion = z.object({
  id: Id,
  experimentId: Id,
  version: z.number().int().positive(),
  observations: z.array(MetricObservation),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  sourceText: z.string(), // "partner log and signed commitments"
  interpretation: z.string(),
  limitations: z.string(),
  recordedBy: PersonRef,
  recordedAt: IsoDateTime,
});
export type ExperimentResultVersion = z.infer<typeof ExperimentResultVersion>;

export const Experiment = z.object({
  id: Id,
  key: DisplayKey, // EXP-03
  caseId: Id,
  title: z.string(),
  lifecycle: ExperimentLifecycle,
  displayResult: ExperimentResultDisplay,
  owner: PersonRef,
  fieldworkOwner: PersonRef.nullable(),
  dueOn: IsoDate.nullable(),
  linkedAssumptionIds: z.array(Id),
  lockedByGateRequestId: Id.nullable(),
  lockedAt: IsoDateTime.nullable(),
  original: ExperimentPlanVersion.nullable(),
  current: ExperimentPlanVersion,
  amendments: z.array(ExperimentAmendment),
  results: z.array(ExperimentResultVersion), // all versions, newest last; never deleted
  decisionTaken: z.object({ text: z.string(), by: PersonRef, at: IsoDateTime }).nullable(),
  taskSetId: Id.nullable(),
  illustrative: z.boolean(), // example experiments in the empty state are marked
});
export type Experiment = z.infer<typeof Experiment>;
