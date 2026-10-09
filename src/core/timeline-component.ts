import { projectGraphs, addProjectGraphs, isTimelineResource } from './project-resources';
import { makeId, type BlueprintGraph, type BlueprintNode, type Project } from './model';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from './blueprint';
import { availableBlueprintName } from './blueprint-names';

export const isTimelineComponent = isTimelineResource;

export function createTimelinePreset(project: Project, name = '新的时间轴预设') {
  const timeline = createBlueprintGraph('effect', availableBlueprintName(project, name));
  timeline.id = makeId('timeline');
  timeline.timelineComponent = true;
  timeline.performanceKind = 'standalone';
  timeline.timeline = { tracks: [{ id: 'track_performance', name: '演出' }], clips: [] };
  return timeline;
}

export function addTimelineComponent(project: Project, ownerId: string, afterNodeId?: string, position?: { x: number; y: number }) {
  const owner = projectGraphs(project).find(graph => graph.id === ownerId);
  if (!owner || owner.timelineComponent === true) throw new Error('请在逻辑蓝图中添加时间轴组件。');
  if (projectGraphs(project).length >= 256 || owner.nodes.length >= 512) throw new Error('蓝图或节点数量已达到上限。');
  const timeline = createTimelinePreset(project, '时间轴预设');
  timeline.performanceKind = owner.performanceKind ?? 'dialogue';
  const node = blueprintNodeDefaults('callFunction', owner.nodes.length);
  node.name = timeline.name; node.properties.graphId = timeline.id; node.pins = callablePins(timeline);
  const previous = owner.nodes.find(item => item.id === afterNodeId) ?? owner.nodes.find(item => item.type === 'event');
  Object.assign(node, position ?? { x: (previous?.x ?? 0) + 420, y: previous?.y ?? 0 });
  addProjectGraphs(project, timeline); owner.nodes.push(node);
  const outputs = previous?.pins.filter(pin => pin.direction === 'output' && pin.dataType === 'exec') ?? [];
  if (previous && outputs.length === 1) {
    const old = owner.links.find(link => link.fromNodeId === previous.id && link.fromPinId === outputs[0].id);
    owner.links = owner.links.filter(link => link !== old);
    connectBlueprintPins(owner, previous.id, outputs[0].id, node.id, 'exec_in');
    if (old) connectBlueprintPins(owner, node.id, 'exec_out', old.toNodeId, old.toPinId);
  }
  synchronizeBlueprintSignatures(project);
  return { timeline, node };
}

export function timelineForNode(project: Project, node?: BlueprintNode) {
  if (node?.type !== 'callFunction') return undefined;
  const target = projectGraphs(project).find(graph => graph.id === node.properties.graphId);
  return isTimelineComponent(target) ? target : undefined;
}

export function useTimelineDefault(graph: BlueprintGraph, nodeId: string, pinId: string) {
  const link = graph.links.find(item => item.toNodeId === nodeId && item.toPinId === pinId);
  const input = graph.nodes.find(item => item.id === link?.fromNodeId && item.type === 'getInput');
  const pin = graph.exposedInputs.find(item => item.id === input?.properties.inputId);
  const node = graph.nodes.find(item => item.id === nodeId);
  if (!link || !input || !pin || !node) return;
  if (pin.defaultValue !== undefined) node.properties[pinId] = pin.defaultValue;
  graph.links = graph.links.filter(item => item.id !== link.id);
  if (!graph.links.some(item => item.fromNodeId === input.id)) graph.nodes = graph.nodes.filter(item => item.id !== input.id);
  if (!graph.nodes.some(item => item.type === 'getInput' && item.properties.inputId === pin.id)) graph.exposedInputs = graph.exposedInputs.filter(item => item.id !== pin.id);
}
