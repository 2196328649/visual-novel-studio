import type { BlueprintGraph, BlueprintNode, Diagnostic, Project } from './model';
import { cloneData } from './project-mutation';
import { projectGraphs, withProjectGraphs } from './project-resources';
import { rawSavedBlueprintAction } from './blueprint-authoring';
import { canLaunchTimeline } from './timeline-launch';
import { visualInputFields } from './visual-object';
import { renewVisualIdentities } from './visual-selection';

/** Authored call paths are shared by clip sampling, interleaving and playback. */
export function timelinePlaybackId(path: string) {
  let a = 2166136261, b = 5381;
  for (const character of path) { a = Math.imul(a ^ character.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ character.charCodeAt(0); }
  return 'tl_' + (a >>> 0).toString(16) + '_' + (b >>> 0).toString(16);
}

/** Renew both the visual tree and its authored input addresses, before resolving values. */
export function scopeTimelineSavedAction(node: BlueprintNode, path: string, preserveNamedVisuals = false): Map<string, string> | undefined {
  if (node.type !== 'savedAction') return;
  const action = rawSavedBlueprintAction(node);
  if (action?.kind === 'audioClip') {
    node.properties.action = JSON.stringify({ ...action, instanceId: timelinePlaybackId(path + '/audio/' + action.instanceId) });
  } else if (action?.kind === 'visual') {
    // Script media explicitly declares its lifetime, even when currently timed.
    // Ordinary blueprint calls retain that named show/replace/hide contract;
    // an input can set duration to zero and make the same object persistent.
    if (preserveNamedVisuals && action.persistent !== undefined) return;
    const before = visualInputFields(action);
    renewVisualIdentities(action, id => timelinePlaybackId(path + '/object/' + id));
    const fields = new Map(visualInputFields(action).map(field => [JSON.stringify(field.path), 'object_' + field.key]));
    const pins = new Map(before.map(field => ['object_' + field.key, fields.get(JSON.stringify(field.path))!]));
    node.pins.forEach(pin => { pin.id = pins.get(pin.id) ?? pin.id; });
    const values = Object.entries(node.properties).filter(([key]) => key.startsWith('object_'));
    values.forEach(([key]) => { delete node.properties[key]; });
    for (const [key, value] of values) node.properties[pins.get(key) ?? key] = value;
    node.properties.action = JSON.stringify(action);
    return pins;
  }
}

// These are playback-only graphs. Keeping their path on the entry also makes a
// second preparation (including a serialized playback snapshot) idempotent.
const privateLaunchPath = (graph: BlueprintGraph) => graph.nodes.find(node => node.type === 'event')?.properties.__timelineLaunchPath;
const isTimelineClip = (graph: BlueprintGraph, node: BlueprintNode) => !!graph.timeline?.clips.some(clip => clip.nodeId === node.id);
const maxPrivateNodesPerGraph = 65536;
type LaunchIssue = { graph: BlueprintGraph; nodeId: string; message: string };

function launchInstancePlan(project: Project, prepareGraphIds?: ReadonlySet<string>) {
  const graphs = projectGraphs(project), byId = new Map(graphs.map(graph => [graph.id, graph]));
  const launchable = new Map<string, boolean>(), targets = new Map<BlueprintNode, BlueprintGraph | undefined>();
  const targetFor = (node: BlueprintNode): BlueprintGraph | undefined => {
    if (targets.has(node)) return targets.get(node);
    let target: BlueprintGraph | undefined;
    if ((node.type === 'callFunction' || node.type === 'callMacro') && node.properties.wait === false) {
      const candidate = byId.get(String(node.properties.graphId));
      if (candidate && !privateLaunchPath(candidate)) {
        if (!launchable.has(candidate.id)) launchable.set(candidate.id, canLaunchTimeline(project, candidate));
        if (launchable.get(candidate.id)) target = candidate;
      }
    }
    targets.set(node, target); return target;
  };
  const sizes = new Map<string, number>();
  const privateSize = (graph: BlueprintGraph, ancestors = new Set<string>()): number => {
    if (ancestors.has(graph.id)) throw new Error('包含递归调用');
    const cached = sizes.get(graph.id); if (cached !== undefined) return cached;
    const active = new Set(ancestors).add(graph.id);
    let size = graph.nodes.length;
    for (const node of graph.nodes) {
      const child = targetFor(node); if (child) size += privateSize(child, active);
      if (size > maxPrivateNodesPerGraph) break;
    }
    sizes.set(graph.id, size); return size;
  };
  const issues: LaunchIssue[] = [];
  const roots = graphs.flatMap(graph => {
    if (prepareGraphIds && !prepareGraphIds.has(graph.id)) return [];
    if (privateLaunchPath(graph)) return [];
    const calls = graph.nodes.filter(node => targetFor(node));
    if (!calls.length) return [];
    let size = 0, current = calls[0];
    try {
      for (const node of calls) {
        current = node; size += privateSize(targetFor(node)!);
        if (size > maxPrivateNodesPerGraph) throw new Error('展开后超过65536个私有节点');
      }
    } catch (error) {
      issues.push({ graph, nodeId: current.id, message: '时间轴“' + graph.name + '”不能建立独立的播放实例：' + (error instanceof Error ? error.message : '调用展开失败') + '。请减少同时调用的嵌套片段，或将部分调用设为等待完成。' });
      return [];
    }
    return [{ graph, calls }];
  });
  return { graphs, roots, issues, targetFor };
}

export function timelineLaunchInstanceDiagnostics(project: Project): Diagnostic[] {
  return launchInstancePlan(project).issues.map(({ message, nodeId }) => ({ severity: 'error', message, nodeId }));
}

/** Keep immediate launches as real calls, with private instances and call frames.
 * Inlining would lose local variables, output defaults and argument snapshots. */
export function isolateTimelineLaunchInstances(project: Project, onUnsupported?: (graph: BlueprintGraph, message: string, nodeId?: string) => void, prepareGraphIds?: ReadonlySet<string>): Project {
  const plan = launchInstancePlan(project, prepareGraphIds);
  plan.issues.forEach(issue => onUnsupported?.(issue.graph, issue.message, issue.nodeId));
  if (!plan.roots.length) return project;
  const helpers: BlueprintGraph[] = [], copies = new Map<string, BlueprintGraph>();
  const instantiate = (source: BlueprintGraph, path: string, preserveNamedVisuals: boolean): BlueprintGraph => {
    const cached = copies.get(path); if (cached) return cached;
    const graph = cloneData(source); graph.id = timelinePlaybackId(path + '/launch_graph');
    copies.set(path, graph); helpers.push(graph);
    const nodes = new Map(source.nodes.map(node => [node.id, timelinePlaybackId(path + '/' + node.id)]));
    const pins = new Map<string, Map<string, string>>();
    graph.nodes.forEach((node, index) => {
      const original = source.nodes[index]; node.id = nodes.get(original.id)!;
      node.properties.__timelineGraph ??= source.id; node.properties.__timelineNode ??= original.id;
      const renamed = scopeTimelineSavedAction(node, path, preserveNamedVisuals); if (renamed) pins.set(original.id, renamed);
      const target = plan.targetFor(original);
      if (target) node.properties.graphId = instantiate(target, path + '/' + original.id, preserveNamedVisuals && !isTimelineClip(source, original)).id;
    });
    graph.nodes.find(node => node.type === 'event')!.properties.__timelineLaunchPath = path;
    graph.links = source.links.map(link => ({
      ...link, id: timelinePlaybackId(path + '/link/' + link.id),
      fromNodeId: nodes.get(link.fromNodeId)!, fromPinId: pins.get(link.fromNodeId)?.get(link.fromPinId) ?? link.fromPinId,
      toNodeId: nodes.get(link.toNodeId)!, toPinId: pins.get(link.toNodeId)?.get(link.toPinId) ?? link.toPinId,
    }));
    if (graph.timeline) {
      graph.timeline.clips = graph.timeline.clips.map(clip => ({ ...clip, nodeId: nodes.get(clip.nodeId)! }));
      if (graph.timeline.tailNodeId) graph.timeline.tailNodeId = nodes.get(graph.timeline.tailNodeId)!;
    }
    return graph;
  };
  // Always clone from the immutable source map. Earlier roots may themselves be
  // reusable targets of later roots, so transformed call targets cannot be reused.
  const roots = new Map(plan.roots.map(({ graph, calls }) => {
    const selected = new Set(calls);
    return [graph.id, { ...graph, nodes: graph.nodes.map(node => selected.has(node) ? {
      ...node, properties: { ...node.properties, graphId: instantiate(plan.targetFor(node)!, graph.id + '/' + node.id, !isTimelineClip(graph, node)).id },
    } : node) }] as const;
  }));
  return withProjectGraphs(project, [...plan.graphs.map(graph => roots.get(graph.id) ?? graph), ...helpers]);
}
