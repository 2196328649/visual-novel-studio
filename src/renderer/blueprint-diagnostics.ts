import type { BlueprintGraph, BlueprintNode, Diagnostic, Project } from '../core/model';
import { validateBlueprints } from '../core/blueprint-validation';
import { sameProjectValue } from '../core/project-history';
import { cloneData } from '../core/project-mutation';

/** Coordinates do not affect execution or diagnostics. Semantic edits still run
 * the complete cross-graph validator; no caller/resource dependency is guessed. */
export class BlueprintDiagnosticCache {
  private previous?: unknown;
  private result: Diagnostic[] = [];
  private nodes = new WeakMap<BlueprintNode, unknown>();
  private graphs = new WeakMap<BlueprintGraph, unknown>();
  constructor(private readonly options: { assumeImmutable?: boolean } = {}) {}
  private node(node: BlueprintNode) {
    if (this.options.assumeImmutable) { const cached = this.nodes.get(node); if (cached) return cached; }
    const { x: _x, y: _y, ...semantic } = node;
    if (this.options.assumeImmutable) this.nodes.set(node, semantic);
    return semantic;
  }
  private graph(graph: BlueprintGraph) {
    if (this.options.assumeImmutable) { const cached = this.graphs.get(graph); if (cached) return cached; }
    const semantic = { ...graph, nodes: graph.nodes.map(node => this.node(node)) };
    if (this.options.assumeImmutable) this.graphs.set(graph, semantic);
    return semantic;
  }
  update(project: Project): Diagnostic[] {
    const semantic = { ...project, blueprints: project.blueprints.map(graph => this.graph(graph)), timelinePresets: project.timelinePresets?.map(graph => this.graph(graph)) };
    if (this.previous && sameProjectValue(this.previous, semantic)) return this.result;
    this.result = validateBlueprints(project);
    this.previous = this.options.assumeImmutable ? semantic : cloneData(semantic);
    return this.result;
  }
}
