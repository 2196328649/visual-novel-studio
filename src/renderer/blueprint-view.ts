import { projectGraphs, withProjectGraphs } from '../core/project-resources';
import type { BlueprintGraph, BlueprintNode, Project } from '../core/model';
import { blueprintNodeSummary, blueprintInputSource } from '../core/blueprint';
import { assetCategories } from '../core/asset-library';
import type { StudioEdge } from './SelectableEdge';

type EditNode = (id: string, edit: (node: BlueprintNode) => void) => void;
export type BlueprintNodeView = {
  node: BlueprintNode;
  summary: string;
  invalid: boolean;
  project: Project;
  graph: BlueprintGraph;
  connectedInputs: ReadonlySet<string>;
  inputSources: ReadonlyMap<string, string>;
  parametersCollapsed: boolean;
  toggleParameters: () => void;
  edit: (edit: (node: BlueprintNode) => void) => void;
};

/** History snapshots clone the project. Compare the inputs that the node UI
 * reads so a local edit does not rebuild every resource selector on the canvas.
 * Position and selection belong to the canvas, not to its editable contents. */
export class BlueprintViewCache {
  private context = '';
  private edit?: EditNode;
  private toggle?: (id: string) => void;
  private entries = new Map<string, { key: string; data: BlueprintNodeView }>();

  update(project: Project, graph: BlueprintGraph, diagnostics: readonly { nodeId?: string }[], edit: EditNode, collapsed: ReadonlySet<string>, toggle: (id: string) => void) {
    const context = JSON.stringify(withProjectGraphs({ ...project, assetCategories: [...assetCategories(project)] }, projectGraphs(project).map(item => item.id === graph.id ? { ...item, nodes: [], links: [] } : item)));
    const reuse = this.context === context && this.edit === edit && this.toggle === toggle;
    const incoming = new Map<string, typeof graph.links>();
    for (const link of graph.links) {
      const links = incoming.get(link.toNodeId) ?? [];
      links.push(link); incoming.set(link.toNodeId, links);
    }
    const invalid = new Set(diagnostics.flatMap(issue => issue.nodeId ? [issue.nodeId] : []));
    const next = new Map<string, { key: string; data: BlueprintNodeView }>();
    const nodes = graph.nodes.map(node => {
      const { x, y, ...appearance } = node;
      const links = incoming.get(node.id) ?? [];
      const summary = blueprintNodeSummary(project, graph, node);
      const inputSources = new Map(links.filter(link => node.pins.some(p=>p.id===link.toPinId&&p.dataType!=='exec')).map(link=>[link.toPinId,blueprintInputSource(project,graph,node.id,link.toPinId)!.label]));
      const key = JSON.stringify([appearance, links, [...inputSources], summary, invalid.has(node.id), collapsed.has(node.id)]);
      const previous = reuse ? this.entries.get(node.id) : undefined;
      const entry = previous?.key === key ? previous : { key, data: {
        node, summary, invalid: invalid.has(node.id), project, graph,
        connectedInputs: new Set(links.map(link => link.toPinId)),
        inputSources,
        parametersCollapsed: collapsed.has(node.id), toggleParameters: () => toggle(node.id),
        edit: (change: (node: BlueprintNode) => void) => edit(node.id, change),
      } };
      next.set(node.id, entry);
      return { node, data: entry.data };
    });
    this.context = context; this.edit = edit; this.toggle = toggle; this.entries = next;
    return nodes;
  }
}

/** Moving or editing a node does not change its wire's presentation. Preserve
 * those edge objects so React Flow only redraws wires whose endpoints move. */
export function reuseBlueprintEdges(previous: StudioEdge[], next: StudioEdge[]): StudioEdge[] {
  const byId = new Map(previous.map(edge => [edge.id, edge]));
  const result = next.map(edge => {
    const before = byId.get(edge.id);
    return before && before.data?.disconnect === edge.data?.disconnect && JSON.stringify(before) === JSON.stringify(edge) ? before : edge;
  });
  return result.length === previous.length && result.every((edge, index) => edge === previous[index]) ? previous : result;
}
