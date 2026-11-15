import { AuthoringIndexCache } from '../core/authoring-index';
import { immutableAuthoringIndex } from './authoring-index';
import { uiProperties, type UiProperty } from '../core/ui-properties';
import { blueprintUiPropertyDefinition } from '../core/blueprint-ui-property-batch';
import { projectGraphs } from '../core/project-resources';
import { actorInstanceReferences } from '../core/actor-instance';
import type { BlueprintGraph, BlueprintLink, BlueprintNode, Project } from '../core/model';
import { blueprintNodeSummary, blueprintOutputLabel } from '../core/blueprint';
import { blueprintCardSummary } from '../core/blueprint-card-summary';
import { blueprintNodeLayout, type BlueprintNodeLayout } from '../core/blueprint-node-layout';
import { assetCategories } from '../core/asset-library';
import { sameProjectValue } from '../core/project-history';
import { cloneData } from '../core/project-mutation';
import { isBlueprintNumericType } from '../core/blueprint-numeric';
import type { StudioEdge } from './SelectableEdge';

type EditNode = (id: string, edit: (node: BlueprintNode) => void) => void;
export interface BlueprintViewActions { locateNode(id: string): void; inspectNode?(id: string): void; locateComponent?(id: string): void }
export interface BlueprintAdvancedView { expanded: ReadonlySet<string>; toggle(id: string): void }
export type BlueprintNodeView = {
  node: BlueprintNode;
  summary: string;
  cardSummary?: string;
  layout: BlueprintNodeLayout;
  invalid: boolean;
  project: Project;
  graph: BlueprintGraph;
  connectedInputs: ReadonlySet<string>;
  inputSources: ReadonlyMap<string, string>;
  inputSourceNodes: ReadonlyMap<string, string>;
  actions?: BlueprintViewActions;
  parametersCollapsed: boolean;
  advancedExpanded: boolean;
  toggleAdvanced: () => void;
  toggleParameters: () => void;
  edit: (edit: (node: BlueprintNode) => void) => void;
};
type Appearance = Omit<BlueprintNode, 'x' | 'y'>;
type Entry = { appearance: Appearance; context: string; links: BlueprintLink[]; sources: [string, string, string | undefined, number][]; data: BlueprintNodeView };
export interface BlueprintViewCacheStats { nodes: number; rebuilt: number; summaries: number; sourceLabels: number; comparedBuckets: number; defensiveCopies: number }
const simpleNodes = new Set(['event', 'return', 'comment', 'random', 'formatText', 'sequence', 'branch', 'select', 'switchValue', 'selectByKey', 'not', 'and', 'or', 'xor', 'math', 'literal', 'getInput', 'setOutput', 'delay', 'forLoop', 'camera', 'shake', 'switchScene', 'showBackground', 'playMusic', 'playSound', 'stopMusic', 'confirmMessage', 'getMinigameValue', 'setMinigameValue', 'finishMinigame']);
const uiNodes = new Set(['doOnce', 'gate', 'showUiPage', 'closeUiPage', 'getPageInput', 'getPageOutput', 'setPageOutput', 'preventPageClose', 'eventPage', 'uiAction', 'getUiControlOption', 'editUiControlOptions', 'focusUiComponent', 'setUiControlRange', 'resetUiControlRange', 'getUiProperty', 'getUiDefault', 'setUiProperty', 'resetUiProperty', 'animateUiProperty', 'stopUiAnimation', 'resetUiComponent', 'playUiAnimation', 'stopUiAnimationPlayback', 'playUiVideo', 'pauseUiVideo', 'stopUiVideo', 'playSpine', 'pauseSpine', 'setSpineSpeed', 'eventClick', 'eventButton', 'eventValueChanged', 'eventTextCommitted', 'eventImage', 'eventVideo', 'eventSpine', 'eventKey', 'eventTimer']);

/** Cache semantic node inputs and resource versions, never a serialized Project.
 * The renderer opts into immutable COW snapshots. Other callers default to
 * defensive snapshots so ordinary mutable authoring helpers cannot hide edits. */
export class BlueprintViewCache {
  private identity = '';
  private edit?: EditNode;
  private actions?: BlueprintViewActions;
  private toggle?: (id: string) => void;
  private toggleAdvanced?: (id: string) => void;
  private entries = new Map<string, Entry>();
  private versions = new Map<string, { value: unknown; version: number }>();
  private versionSequence = 0;
  private appearances = new WeakMap<BlueprintNode, Appearance>();
  private graphContents = new WeakMap<BlueprintGraph, unknown>();
  private sourceLabels = new Map<string, { appearance: Appearance; context: string; componentLinked: boolean; label: string }>();
  private categoryInputs?: unknown[];
  private categories: [string, string][] = [];
  private actorInputs?: unknown[];
  private actors: ReturnType<typeof actorInstanceReferences> = [];
  private last: BlueprintViewCacheStats = { nodes: 0, rebuilt: 0, summaries: 0, sourceLabels: 0, comparedBuckets: 0, defensiveCopies: 0 };
  constructor(private readonly options: { assumeImmutable?: boolean } = {}) {}
  get stats(): BlueprintViewCacheStats { return { ...this.last }; }
  private snapshot<T>(value: T): T { if (this.options.assumeImmutable) return value; this.last.defensiveCopies++; return cloneData(value); }
  private version(key: string, value: unknown): number {
    const before = this.versions.get(key); this.last.comparedBuckets++;
    if (before && sameProjectValue(before.value, value)) return before.version;
    const version = ++this.versionSequence; this.versions.set(key, { value: this.snapshot(value), version }); return version;
  }
  private appearance(node: BlueprintNode): Appearance {
    if (this.options.assumeImmutable) { const cached = this.appearances.get(node); if (cached) return cached; }
    const { x: _x, y: _y, ...appearance } = node;
    if (this.options.assumeImmutable) this.appearances.set(node, appearance);
    return appearance;
  }
  private metadata(graph: BlueprintGraph) { const { nodes: _nodes, links: _links, ...metadata } = graph; return metadata; }
  private content(graph: BlueprintGraph) {
    if (this.options.assumeImmutable) { const cached = this.graphContents.get(graph); if (cached) return cached; }
    const content = { ...this.metadata(graph), nodes: graph.nodes.map(node => this.appearance(node)), links: graph.links };
    if (this.options.assumeImmutable) this.graphContents.set(graph, content);
    return content;
  }

  update(project: Project, graph: BlueprintGraph, diagnostics: readonly { nodeId?: string }[], edit: EditNode, collapsed: ReadonlySet<string>, toggle: (id: string) => void, actions?: BlueprintViewActions, advanced?: BlueprintAdvancedView) {
    this.last = { nodes: graph.nodes.length, rebuilt: 0, summaries: 0, sourceLabels: 0, comparedBuckets: 0, defensiveCopies: 0 };
    // Mutable test/authoring callers share indexes only within this synchronous update.
    const indexes = this.options.assumeImmutable ? immutableAuthoringIndex : new AuthoringIndexCache({ assumeImmutable: true });
    const identity = project.id + ':' + graph.id;
    if (identity !== this.identity) { this.entries.clear(); this.sourceLabels.clear(); this.versions.clear(); this.categoryInputs = undefined; this.actorInputs = undefined; }
    const reusable = identity === this.identity && this.edit === edit && this.toggle === toggle && this.actions === actions && this.toggleAdvanced === advanced?.toggle;
    const graphs = projectGraphs(project), graphsById = new Map(graphs.map(item => [item.id, item]));
    const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
    const incoming = new Map<string, BlueprintLink[]>();
    for (const link of graph.links) { const links = incoming.get(link.toNodeId) ?? []; links.push(link); incoming.set(link.toNodeId, links); }
    const resourceVersions = new Map<string, number>(), nodeContexts = new Map<string, string>();
    const projectKeys = Object.keys(project).filter(key => key !== 'blueprints' && key !== 'timelinePresets');
    const resource = (key: string): number => {
      const known = resourceVersions.get(key); if (known !== undefined) return known;
      let value: unknown;
      if (key === '@metadata') value = this.metadata(graph);
      else if (key === '@catalog') value = graphs.map(item => this.metadata(item));
      else if (key === '@allGraphs') value = graphs.map(item => this.content(item));
      else if (key === '@actorInstances') {
        const inputs = [project.nodes, project.scenes, project.effects, project.characters, project.blueprints, project.timelinePresets, project.gameFlow, project.assets, project.ui];
        if (!this.options.assumeImmutable || !this.actorInputs || inputs.some((input, index) => input !== this.actorInputs![index])) {
          this.actors = actorInstanceReferences(project); this.actorInputs = inputs;
        }
        value = this.actors;
      }
      else if (key.startsWith('@graph:')) { const target = graphsById.get(key.slice(7)); value = target && this.content(target); }
      else if (key === '@assetCategories') {
        const inputs = [project.assets, project.contentBrowser, project.ui, project.nodes, project.scenes, project.blueprints, project.timelinePresets, project.effects, project.characters];
        if (!this.categoryInputs || !sameProjectValue(this.categoryInputs, inputs)) { this.categories = [...assetCategories(project)]; this.categoryInputs = this.snapshot(inputs); }
        value = this.categories;
      } else value = (project as unknown as Record<string, unknown>)[key];
      const version = this.version(key, value); resourceVersions.set(key, version); return version;
    };
    const context = (node: BlueprintNode): string => {
      const known = nodeContexts.get(node.id); if (known !== undefined) return known;
      const keys = new Set<string>(['@metadata']);
      if (simpleNodes.has(node.type) || isBlueprintNumericType(node.type)) { /* No project-wide controls. */ }
      else if (uiNodes.has(node.type)) { keys.add('ui'); keys.add('variables'); keys.add('playerPreferenceSettings'); keys.add('playerDefaults'); }
      else if (node.type === 'getVariable' || node.type === 'setVariable') { keys.add('variables'); keys.add('ui'); }
      else if (node.type === 'getPlayerPreference' || node.type === 'setPlayerPreference') { keys.add('characters'); keys.add('playerPreferenceSettings'); keys.add('playerDefaults'); }
      else if (['callFunction', 'callMacro', 'startTask', 'debounce', 'waitTask'].includes(node.type)) {
        projectKeys.forEach(key => keys.add(key)); keys.add('@catalog'); keys.add('@actorInstances');
        const visit = (id: string, seen = new Set<string>()) => {
          if (seen.has(id)) return; seen.add(id); keys.add('@graph:' + id);
          for (const child of graphsById.get(id)?.nodes ?? []) if (['callFunction', 'callMacro', 'startTask', 'debounce', 'waitTask'].includes(child.type)) visit(String(child.properties.graphId ?? ''), seen);
        };
        visit(String(node.properties.graphId ?? ''));
      } else if (node.type === 'showCharacter' || node.type === 'hideCharacter') { projectKeys.forEach(key => keys.add(key)); keys.add('@actorInstances'); }
      else { projectKeys.forEach(key => keys.add(key)); keys.add('@allGraphs'); }
      // Generic value selectors also occur on literals and exposed call inputs.
      if (node.type === 'event' && graph.uiPageId) keys.add('ui');
      if (node.type === 'setUiProperty' && (blueprintUiPropertyDefinition(node).rows ?? []).some(row => uiProperties[row.property as UiProperty]?.resource || row.property === 'spineSkin')) { keys.add('assets'); keys.add('contentBrowser'); keys.add('resourceSettings'); keys.add('@assetCategories'); }
      for (const pin of node.pins) {
        if (['instanceId', 'presetId', 'expressionId'].includes(pin.id)) { ['characters', 'assets', 'nodes', 'scenes', 'effects', '@actorInstances'].forEach(key => keys.add(key)); }
        if (pin.dataType === 'asset') { keys.add('assets'); keys.add('contentBrowser'); keys.add('resourceSettings'); keys.add('@assetCategories'); }
        else if (pin.dataType === 'character') keys.add('characters');
        else if (pin.dataType === 'scene') keys.add('scenes');
        else if (pin.dataType === 'ui' || pin.dataType === 'component') keys.add('ui');
      }
      const result = [...keys].sort().map(key => key + ':' + resource(key)).join('|'); nodeContexts.set(node.id, result); return result;
    };
    const usedSources = new Set<string>();
    const sourceLabel = (source: BlueprintNode, pin: string): string => {
      const key = source.id + ':' + pin; usedSources.add(key);
      const appearance = this.appearance(source), dependencies = context(source);
      const componentLinked = ['getUiProperty', 'getUiDefault'].includes(source.type) && !!incoming.get(source.id)?.some(link => link.toPinId === 'componentId');
      const before = this.sourceLabels.get(key);
      if (before && before.context === dependencies && before.componentLinked === componentLinked && sameProjectValue(before.appearance, appearance)) return before.label;
      const label = blueprintOutputLabel(project, graph, source, pin, indexes); this.last.sourceLabels++;
      this.sourceLabels.set(key, { appearance: this.snapshot(appearance), context: dependencies, componentLinked, label }); return label;
    };
    // A card's concise prose may use more of its direct source than the pin's
    // label does (for example, which design property a getter reads). Track that
    // semantic source once; moving it still leaves all downstream controls intact.
    const cardSourceVersions = new Map<string, number>();
    const cardSourceVersion = (source: BlueprintNode): number => {
      const known = cardSourceVersions.get(source.id); if (known !== undefined) return known;
      const version = this.version('@card-source:' + source.id, {
        appearance: this.appearance(source), context: context(source),
        componentLinked: ['getUiProperty', 'getUiDefault'].includes(source.type) && !!incoming.get(source.id)?.some(link => link.toPinId === 'componentId'),
      });
      cardSourceVersions.set(source.id, version); return version;
    };
    const invalid = new Set(diagnostics.flatMap(issue => issue.nodeId ? [issue.nodeId] : []));
    const next = new Map<string, Entry>();
    const result = graph.nodes.map(node => {
      const appearance = this.appearance(node), dependencies = context(node), links = incoming.get(node.id) ?? [];
      const valuePins = new Set(node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => pin.id));
      const sources: Entry['sources'] = links.filter(link => valuePins.has(link.toPinId)).map(link => { const source = nodesById.get(link.fromNodeId); return [link.toPinId, source ? sourceLabel(source, link.fromPinId) : '缺失节点', source?.id, source ? cardSourceVersion(source) : 0]; });
      const previous = reusable ? this.entries.get(node.id) : undefined;
      const sameContent = !!previous && previous.context === dependencies && sameProjectValue(previous.appearance, appearance) && sameProjectValue(previous.links, links) && sameProjectValue(previous.sources, sources);
      const advancedExpanded = advanced?.expanded.has(node.id) ?? false;
      if (sameContent && previous.data.invalid === invalid.has(node.id) && previous.data.parametersCollapsed === collapsed.has(node.id) && previous.data.advancedExpanded === advancedExpanded) { next.set(node.id, previous); return { node, data: previous.data }; }
      const summary = sameContent ? previous!.data.summary : blueprintNodeSummary(project, graph, node, indexes); if (!sameContent) this.last.summaries++;
      const connectedInputs = new Set(links.map(link => link.toPinId));
      const layout = blueprintNodeLayout(node, { parametersCollapsed: collapsed.has(node.id), advancedExpanded, connectedInputs, hasProblem: invalid.has(node.id) });
      const data: BlueprintNodeView = {
        node, summary, cardSummary: sameContent ? previous!.data.cardSummary : blueprintCardSummary(project, graph, node, indexes), layout, invalid: invalid.has(node.id), project, graph,
        connectedInputs, inputSources: new Map(sources.map(([pin, label]) => [pin, label])),
        inputSourceNodes: new Map<string, string>(sources.flatMap<[string, string]>(([pin, _label, source]) => source ? [[pin, source]] : [])), actions,
        parametersCollapsed: collapsed.has(node.id), toggleParameters: () => toggle(node.id), advancedExpanded, toggleAdvanced: () => advanced?.toggle(node.id), edit: change => edit(node.id, change),
      };
      this.last.rebuilt++; next.set(node.id, { appearance: this.snapshot(appearance), context: dependencies, links: this.snapshot(links), sources, data });
      return { node, data };
    });
    for (const key of this.sourceLabels.keys()) if (!usedSources.has(key)) this.sourceLabels.delete(key);
    for (const key of this.versions.keys()) if (key.startsWith('@card-source:') && !cardSourceVersions.has(key.slice(13))) this.versions.delete(key);
    this.identity = identity; this.edit = edit; this.toggle = toggle; this.toggleAdvanced = advanced?.toggle; this.actions = actions; this.entries = next;
    return result;
  }
}

/** Moving or editing a node does not change its wire's presentation. Preserve
 * those edge objects so React Flow only redraws wires whose endpoints move. */
export function reuseBlueprintEdges(previous: StudioEdge[], next: StudioEdge[]): StudioEdge[] {
  const byId = new Map(previous.map(edge => [edge.id, edge]));
  const result = next.map(edge => {
    const before = byId.get(edge.id);
    return before && JSON.stringify(before) === JSON.stringify(edge) ? before : edge;
  });
  return result.length === previous.length && result.every((edge, index) => edge === previous[index]) ? previous : result;
}
