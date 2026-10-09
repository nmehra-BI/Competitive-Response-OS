/**
 * Lineage drawer (S06, S08, S10): formula, inputs one level, used-by (D-056: `lineageView` over the
 * merged sizing + economics graph) and the figure's history across committed versions. The same data
 * serves drafts and frozen versions; a blocked draft has no figures to show (422).
 */
import { API, type EconomicsOutput, type LineageNode, type SizingOutput } from '@growth-os/contracts';
import { lineageView, mergeLineage } from '@growth-os/domain';
import type { Tx } from '@growth-os/db';
import { notFound } from '../../../platform/errors';
import { query, type HandlerMap } from '../../../platform/pipeline';
import { isoDateTime } from '../../../platform/serialize';
import { caseHref, readDecision, readableCase, type CaseRecord } from '../cases/access';
import { economicsVersions, type EconomicsVersionRow } from '../economics/model';
import { blocked } from '../sizing';
import { sizingVersions, type SizingVersionRow } from '../sizing/model';
import { calcOutput } from '../sizing/read';

const CURRENCY: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

function group(v: string): string {
  const neg = v.startsWith('-');
  const [i, f] = (neg ? v.slice(1) : v).split('.');
  const g = i!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = f && /[1-9]/.test(f) ? `.${f.replace(/0+$/, '')}` : '';
  return `${neg ? '−' : ''}${g}${frac}`;
}

/** Exact value text ("€40,000,000", "2,000 sites", "20%"). No rounding (display of an exact figure). */
export function exactValue(n: LineageNode, currency: string | null): string | null {
  if (n.value === null) return null;
  if (n.unit === 'rate') {
    const [i, f = ''] = n.value.split('.');
    const shifted = `${i}${(f + '00').slice(0, 2)}.${f.slice(2)}`.replace(/^0+(?=\d)/, '');
    return `${group(shifted)}%`;
  }
  if (n.unit.startsWith('currency')) {
    const sym = CURRENCY[currency ?? ''] ?? `${currency ?? ''} `;
    const suffix = n.unit === 'currency_one_time' ? ' one-time' : n.unit === 'currency_per_year' ? '/year' : '';
    return `${sym}${group(n.value)}${suffix}`;
  }
  return `${group(n.value)}${n.unit === 'text' ? '' : ` ${n.unit.replace(/_/g, ' ')}`}`;
}

type Pair = { sizing: SizingVersionRow | undefined; economics: EconomicsVersionRow | undefined };

async function pick(tx: Tx, c: CaseRecord, model: 'sizing' | 'economics', version: number | 'draft' | undefined): Promise<Pair> {
  const sv = await sizingVersions(tx, c.id);
  const ev = await economicsVersions(tx, c.id);
  const sel = <T extends { state: string; version: number }>(xs: T[]) =>
    version === 'draft' ? xs.find((x) => x.state === 'draft') : version === undefined ? xs.filter((x) => x.state === 'committed').pop() : xs.find((x) => x.version === version && x.state === 'committed');
  if (model === 'sizing') {
    const sizing = sel(sv);
    const economics = version === 'draft' ? ev.find((e) => e.state === 'draft') : ev.filter((e) => e.state === 'committed' && e.sizing_version_id === sizing?.id).pop();
    return { sizing, economics };
  }
  const economics = sel(ev);
  return { economics, sizing: sv.find((s) => s.id === economics?.sizing_version_id) };
}

export const lineageHandlers: HandlerMap = {
  [API.lineage.get.id]: query(API.lineage.get, {
    load: (ctx, tx) => readableCase(tx, ctx.identity, ctx.params.caseRef),
    authorize: (ctx, c) => readDecision(ctx.identity, c),
    handle: async (ctx, { tx }, c) => {
      const { node: key, model, version } = ctx.query;
      const p = await pick(tx, c, model, version);
      const primary = model === 'sizing' ? p.sizing : p.economics;
      if (!primary) throw notFound();
      const sOut = await calcOutput<SizingOutput>(tx, p.sizing?.calculation_result_id ?? null);
      const eOut = await calcOutput<EconomicsOutput>(tx, p.economics?.calculation_result_id ?? null);
      const main = model === 'sizing' ? sOut : eOut;
      if (!main) throw notFound();
      if (main.blocked && model === 'sizing') throw blocked(main.checks);
      const graph = model === 'sizing' ? mergeLineage(sOut?.lineage ?? [], eOut?.lineage ?? []) : mergeLineage(eOut?.lineage ?? [], sOut?.lineage ?? []);
      const view = lineageView(graph, key);
      if (!view) throw notFound();
      const currency = main.engine === 'sizing' ? (main as SizingOutput).ladder.tam.value.currency : p.economics?.currency ?? null;
      // History of this figure across committed versions of the model.
      const rows = model === 'sizing' ? (await sizingVersions(tx, c.id)) : await economicsVersions(tx, c.id);
      const history: { at: string; text: string }[] = [];
      for (const r of rows.filter((x) => x.state === 'committed')) {
        const o = await calcOutput<SizingOutput | EconomicsOutput>(tx, r.calculation_result_id);
        const n = o?.lineage.find((x) => x.nodeKey === key);
        if (n) history.push({ at: isoDateTime(r.committed_at!), text: `v${r.version} · ${exactValue(n, currency) ?? 'Not available'}` });
      }
      const tab = (k: string) => (k.startsWith('economics') ? 'economics' : 'sizing');
      return {
        node: view.node,
        inputs: view.inputs,
        usedBy: view.usedBy.map((n) => ({ label: n.label, href: `${caseHref(c.display_key, tab(n.nodeKey))}?node=${encodeURIComponent(n.nodeKey)}` })),
        history,
        exactValue: exactValue(view.node, currency),
        engineLabel: `Calculated by ${main.engine} engine v${main.engineVersion} · reproducible`,
      };
    },
  }),
};
