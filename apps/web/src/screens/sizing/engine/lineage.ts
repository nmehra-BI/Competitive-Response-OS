// PORT (WS8b): verbatim copy of the WS2 domain engine (branch worktree-agent-aa0d31ef83422e2fc @ e0958a5),
// imports adjusted only. Delete this folder when @growth-os/domain ships the engines; see ./adapter.ts.
/**
 * Formula-and-lineage graph builder ("Trace precedents", UX research §6.3).
 *
 * Every engine output gets a node with formula text, formula with values, its inputs one level deep
 * and the number of assumptions it depends on (transitively). Input nodes use the shared key
 * `input.<inputKey>`, so the lineage of several engines can be merged and "Used by" spans them
 * (for example, the reachable pool input is used by SOM and by economics).
 */
import type { EngineInput, LineageNode, ValueUnit } from '@growth-os/contracts';

export function inputNodeKey(inputKey: string): string {
  return `input.${inputKey}`;
}

export interface CalculatedNodeSpec {
  nodeKey: string;
  label: string;
  kind?: 'calculated' | 'scenario';
  value: string | null;
  unit: ValueUnit;
  formulaText: string;
  formulaWithValues: string | null;
  inputs: readonly string[];
}

export interface PlainNodeSpec {
  nodeKey: string;
  label: string;
  kind: LineageNode['kind'];
  value: string | null;
  unit: ValueUnit;
  ref: LineageNode['ref'];
  formulaText?: string | null;
  formulaWithValues?: string | null;
  inputs?: readonly string[];
}

/** Builds lineage in insertion order (deterministic). Inputs must be added before their users. */
export class LineageBuilder {
  private readonly nodes = new Map<string, LineageNode>();

  has(nodeKey: string): boolean {
    return this.nodes.has(nodeKey);
  }

  /** Adds a node for an engine input (evidence or assumption). Idempotent per input key. */
  addInput(input: EngineInput): string {
    const nodeKey = inputNodeKey(input.inputKey);
    if (!this.nodes.has(nodeKey)) {
      this.nodes.set(nodeKey, {
        nodeKey,
        label: input.label,
        kind: input.kind === 'calculated' ? 'calculated' : input.kind,
        value: input.value,
        unit: input.unit,
        formulaText: null,
        formulaWithValues: null,
        inputs: [],
        dependsOnAssumptionCount: 0,
        ref: input.ref,
      });
    }
    return nodeKey;
  }

  /** Adds any node with explicit fields (e.g. a cohort or an overlap row). */
  addNode(spec: PlainNodeSpec): string {
    this.put({
      nodeKey: spec.nodeKey,
      label: spec.label,
      kind: spec.kind,
      value: spec.value,
      unit: spec.unit,
      formulaText: spec.formulaText ?? null,
      formulaWithValues: spec.formulaWithValues ?? null,
      inputs: [...(spec.inputs ?? [])],
      dependsOnAssumptionCount: 0,
      ref: spec.ref,
    });
    return spec.nodeKey;
  }

  addCalculated(spec: CalculatedNodeSpec): string {
    this.put({
      nodeKey: spec.nodeKey,
      label: spec.label,
      kind: spec.kind ?? 'calculated',
      value: spec.value,
      unit: spec.unit,
      formulaText: spec.formulaText,
      formulaWithValues: spec.formulaWithValues,
      inputs: [...spec.inputs],
      dependsOnAssumptionCount: 0,
      ref: null,
    });
    return spec.nodeKey;
  }

  private put(node: LineageNode): void {
    if (this.nodes.has(node.nodeKey)) throw new Error(`lineage: duplicate node ${node.nodeKey}`);
    for (const k of node.inputs) {
      if (!this.nodes.has(k)) throw new Error(`lineage: ${node.nodeKey} references unknown input ${k}`);
    }
    node.dependsOnAssumptionCount = this.countAssumptions(node.inputs);
    this.nodes.set(node.nodeKey, node);
  }

  /** Distinct assumption nodes reachable through the inputs (transitive precedents). */
  private countAssumptions(inputs: readonly string[]): number {
    const seen = new Set<string>();
    const assumptions = new Set<string>();
    const stack = [...inputs];
    while (stack.length > 0) {
      const key = stack.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      const n = this.nodes.get(key);
      if (!n) continue;
      if (n.kind === 'assumption') assumptions.add(key);
      stack.push(...n.inputs);
    }
    return assumptions.size;
  }

  build(): LineageNode[] {
    return [...this.nodes.values()];
  }
}

/** Merge lineage arrays from several engines; the first node with a given key wins. */
export function mergeLineage(...graphs: ReadonlyArray<readonly LineageNode[]>): LineageNode[] {
  const out = new Map<string, LineageNode>();
  for (const g of graphs) for (const n of g) if (!out.has(n.nodeKey)) out.set(n.nodeKey, n);
  return [...out.values()];
}

export interface LineageView {
  node: LineageNode;
  /** Precedents, one level ("Inputs · one level"). */
  inputs: LineageNode[];
  /** Dependents, one level ("Used by"). */
  usedBy: LineageNode[];
}

/** The lineage drawer for one figure: the node, its inputs one level, and what uses it. */
export function lineageView(nodes: readonly LineageNode[], nodeKey: string): LineageView | null {
  const byKey = new Map(nodes.map((n) => [n.nodeKey, n]));
  const node = byKey.get(nodeKey);
  if (!node) return null;
  return {
    node,
    inputs: node.inputs.map((k) => byKey.get(k)).filter((n): n is LineageNode => n !== undefined),
    usedBy: nodes.filter((n) => n.inputs.includes(nodeKey)),
  };
}

/** "Show next level": every dependent up to `depth` levels, nearest first, without duplicates. */
export function usedByTransitive(
  nodes: readonly LineageNode[],
  nodeKey: string,
  depth = Infinity,
): LineageNode[] {
  const out: LineageNode[] = [];
  const seen = new Set<string>([nodeKey]);
  let frontier = [nodeKey];
  for (let level = 0; level < depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const n of nodes) {
      if (!seen.has(n.nodeKey) && n.inputs.some((k) => frontier.includes(k))) {
        seen.add(n.nodeKey);
        out.push(n);
        next.push(n.nodeKey);
      }
    }
    frontier = next;
  }
  return out;
}
