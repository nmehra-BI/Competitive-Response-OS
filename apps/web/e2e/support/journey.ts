/**
 * Journey setup the approved design has no screen for (decisions.md D-095, PQ-17): the first assumption
 * register, sizing model and economics model of a newly converted case. The real endpoints are called as
 * the case owner — the same writers S06/S08/S09 use — so validation, policy, audit and the engines all
 * run; only the data entry is not a UI form. Everything after this is driven through the screens.
 */
import type { Page } from '@playwright/test';
import { assumptions, people, pilotMilestones, pilotTasks } from '@growth-os/fixtures-aster';
import { apiCall } from './real';

const sourceIdOf = async (page: Page, key: string) => {
  const r = await apiCall<{ source: { id: string } }>(page, 'GET', `/evidence/sources/${key}`);
  if (r.status !== 200) throw new Error(`source ${key}: ${r.status}`);
  return r.json.source.id;
};

function must<T>(r: { status: number; json: T }, ok: number, what: string): T {
  if (r.status !== ok) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

/** As Maya (signed in on `page`): register the assumptions, enter and commit sizing v1 and economics v1. */
export async function enterAssessmentInputs(page: Page, caseKey: string) {
  const asm: Record<string, string> = {};
  for (const a of assumptions) {
    const v = a as unknown as { value: string | null; valueText?: string; ownerId: string };
    const r = await apiCall<{ id: string }>(page, 'POST', `/me/cases/${caseKey}/assumptions`, {
      inputKey: a.inputKey,
      name: a.name,
      ownerId: v.ownerId, // the canonical seed keeps fixture ids
      value: v.value,
      valueText: v.value === null ? (v.valueText ?? null) : null,
      unit: a.unit,
      basis: a.basis,
      sensitivity: a.sensitivity,
      decisionCritical: a.decisionCritical,
      consequenceIfFalse: a.consequenceIfFalse,
      validationMethod: a.validationMethod,
      dueOn: a.dueOn,
    });
    asm[a.inputKey] = must(r, 201, `assumption ${a.key}`).id;
  }
  const src14 = await sourceIdOf(page, 'SRC-014');
  const src21 = await sourceIdOf(page, 'SRC-021');
  const first = must(
    await apiCall<{ draft: { rowVersion: number; cohorts: { id: string }[] } }>(
      page,
      'PATCH',
      `/me/cases/${caseKey}/sizing/draft`,
      {
        method: 'aggregate_overlap',
        horizonYears: 3,
        boundary: {
          marketUnit: 'annual spend on water monitoring',
          populationUnit: 'site',
          currency: 'EUR',
          priceYear: 2026,
          annualizationMethod: null,
        },
        inputs: [
          { inputKey: 'tam_site_count', value: '5000', unit: 'sites', sourceId: src14, assumptionId: null },
          ...(
            [
              ['annual_spend_per_site', 'currency_per_year_per_site'],
              ['reachable_pool', 'sites'],
              ['adoption_rate.downside', 'rate'],
              ['adoption_rate.base', 'rate'],
              ['adoption_rate.upside', 'rate'],
              ['capacity', 'customers'],
            ] as const
          ).map(([k, unit]) => ({ inputKey: k, value: '0', unit, sourceId: null, assumptionId: asm[k]! })),
        ],
        cohorts: [
          { id: null, name: 'Size-qualified', rule: '≥ size threshold', siteCount: 1400, sourceId: src14 },
          {
            id: null,
            name: 'Process-qualified',
            rule: 'Uses the target water process',
            siteCount: 1100,
            sourceId: src21,
          },
        ],
      },
      { 'If-Match': '"0"' },
    ),
    200,
    'sizing draft',
  );
  const [a, b] = first.draft.cohorts;
  must(
    await apiCall(
      page,
      'PATCH',
      `/me/cases/${caseKey}/sizing/draft`,
      { overlaps: [{ cohortAId: a!.id, cohortBId: b!.id, overlapCount: 500 }] },
      { 'If-Match': `"${first.draft.rowVersion}"` },
    ),
    200,
    'sizing overlaps',
  );
  must(await apiCall(page, 'POST', `/me/cases/${caseKey}/sizing/commit`), 201, 'sizing commit');
  must(
    await apiCall(
      page,
      'PATCH',
      `/me/cases/${caseKey}/economics/draft`,
      { drivers: [] },
      { 'If-Match': '"0"' },
    ),
    200,
    'economics draft',
  );
  must(await apiCall(page, 'POST', `/me/cases/${caseKey}/economics/commit`), 201, 'economics commit');
  // The feasibility dimensions and their named reviewers (S07 lists rows; nothing on S07 adds one).
  for (const [dimension, area, reviewerId, question, dueOn] of [
    ['product_fit', 'product', people.priya.id, 'Does the product fit the target workflow?', '2026-10-21'],
    ['operations', 'operations', people.opsLead.id, 'Can we install and support?', '2026-10-23'],
    ['specialist_review', 'specialist', people.lena.id, 'Legal and regulatory requirements', '2026-11-20'],
  ] as const)
    must(
      await apiCall(page, 'POST', `/me/cases/${caseKey}/review-requests`, {
        area,
        reviewerId,
        targetType: `feasibility.${dimension}`,
        targetId: null,
        question,
        whatToCheck: [question],
        dueOn,
      }),
      201,
      `feasibility ${dimension}`,
    );
  return asm;
}

interface PilotView {
  draft: { rowVersion: number; milestones: { id: string; ordinal: number }[] } | null;
  taskSet: { tasks: { id: string; ordinal: number }[] } | null;
}

/**
 * The six pilot tasks of the drafted plan (PRD §6), task 2 without an owner (acceptance step 21). The
 * plan itself is drafted by the G2 request (D-102); S11 edits owners but has no task editor (PQ-17).
 */
export async function enterPilotTasks(page: Page, caseKey: string): Promise<void> {
  const path = `/me/cases/${caseKey}/pilot-plan`;
  let v = must(await apiCall<PilotView>(page, 'GET', path), 200, 'pilot plan');
  v = must(
    await apiCall<PilotView>(
      page,
      'PATCH',
      `${path}/draft`,
      {
        milestones: pilotMilestones.map((m) => ({
          id: null,
          name: m.name,
          windowText: m.windowText,
          ordinal: m.ordinal,
        })),
      },
      { 'If-Match': `"${v.draft!.rowVersion}"` },
    ),
    200,
    'pilot milestones',
  );
  const milestoneId = (n: number) => v.draft!.milestones.find((m) => m.ordinal === n)!.id;
  const body = (ids: Map<number, string> | null) => ({
    tasks: pilotTasks.map((t) => ({
      id: ids?.get(t.ordinal) ?? null,
      title: t.title,
      milestoneId: milestoneId(t.milestone),
      function: t.function,
      ownerId: t.ordinal === 2 ? null : t.ownerId,
      dependsOnTaskIds: ids ? t.dependsOn.map((d) => ids.get(d)!) : [],
      dueOn: t.dueOn,
      dueRule: t.dueRule,
      deliverable: t.deliverable,
      conditionKey: (t as { conditionKey?: string }).conditionKey ?? null,
    })),
  });
  v = must(
    await apiCall<PilotView>(page, 'PATCH', `${path}/draft`, body(null), {
      'If-Match': `"${v.draft!.rowVersion}"`,
    }),
    200,
    'pilot tasks',
  );
  const ids = new Map(v.taskSet!.tasks.map((t) => [t.ordinal, t.id]));
  must(
    await apiCall(page, 'PATCH', `${path}/draft`, body(ids), { 'If-Match': `"${v.draft!.rowVersion}"` }),
    200,
    'pilot dependencies',
  );
}
