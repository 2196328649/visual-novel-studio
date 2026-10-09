import { projectGraphs, addProjectGraphs } from './project-resources';
import type { BlueprintGraph, Project } from './model';
import { blueprintInputValue, blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from './blueprint';
import { createVisualObject, syncVisualPins } from './visual-object';
import { createChapterPerformance, chapterBlueprintPair } from './chapter-performances';
import { resolveBlueprintCall } from './blueprint-names';

export const endingPerformanceId = 'builtin_ending_performance';

export function createEndingPerformance(): BlueprintGraph {
  const graph = createBlueprintGraph('effect', '结局演出');
  graph.id = endingPerformanceId; graph.callName = '结局演出'; graph.performanceKind = 'standalone'; graph.timelineComponent = true; graph.playback = { clickSkip: true };
  const background = createVisualObject('solid'); background.instanceId = 'ending_background'; background.name = '结局背景'; background.color = '#000000'; background.duration = 3.6;
  const title = createVisualObject('text'); title.instanceId = 'ending_title'; title.name = '结局文字'; title.text = '故事结束'; title.width = .8; title.height = .4; title.duration = 3.6;
  title.textAlign = 'center'; title.textVerticalAlign = 'center';
  const nodes = [background, title].map((object, index) => {
    const node = blueprintNodeDefaults('savedAction'); node.name = object.name; node.id = 'ending_visual_' + index; node.properties.action = JSON.stringify(object); syncVisualPins(node, object); graph.nodes.push(node); return node;
  });
  const tail = blueprintNodeDefaults('delay'); tail.id = 'ending_tail'; tail.name = '等待全部轨道结束'; tail.properties.seconds = 3.6; graph.nodes.push(tail);
  connectBlueprintPins(graph, graph.nodes[0].id, 'exec', nodes[0].id, 'exec_in');
  connectBlueprintPins(graph, nodes[0].id, 'exec_out', nodes[1].id, 'exec_in');
  connectBlueprintPins(graph, nodes[1].id, 'exec_out', tail.id, 'exec_in');
  for (const [id, name, targetIds, targetPin] of [['caption', '文字', [nodes[1].id], 'object_text'], ['duration', '时长', nodes.map(node => node.id), 'object_duration']] as const) {
    const pin = nodes[1].pins.find(pin => pin.id === targetPin)!;
    graph.exposedInputs.push({ ...pin, id, name, defaultValue: id === 'caption' ? title.text : 3.6 });
    const read = blueprintNodeDefaults('getInput'); read.id = 'ending_input_' + id; read.properties.inputId = id; read.pins[0].dataType = pin.dataType; graph.nodes.push(read);
    for (const nodeId of targetIds) connectBlueprintPins(graph, read.id, 'value', nodeId, targetPin);
  }
  graph.timeline = { tracks: [{ id: 'ending_text', name: '文字' }, { id: 'ending_background', name: '背景' }], clips: [{ nodeId: nodes[1].id, trackId: 'ending_text' }, { nodeId: nodes[0].id, trackId: 'ending_background' }], tailNodeId: tail.id };
  return graph;
}

const chapterPresets = new WeakMap<Project['ui'], { assets: Project['assets']; graphs: BlueprintGraph[]; ending: BlueprintGraph }>();
export function availablePerformanceBlueprints(project: Project) {
  let chapters = chapterPresets.get(project.ui);
  if (!chapters || chapters.assets !== project.assets) {
    chapters = { assets: project.assets, graphs: [createChapterPerformance(project, 'text'), createChapterPerformance(project, 'image')].flatMap(graph => chapterBlueprintPair(graph)), ending: createEndingPerformance() };
    chapterPresets.set(project.ui, chapters);
  }
  const presets = chapters.graphs.filter(preset => !projectGraphs(project).some(graph => graph.id === preset.id || graph.name === preset.name || graph.callName === preset.name)).map(preset =>
    // Keep an existing authored command in control of its name; the image
    // preset remains available through its full name in that project.
    preset.callName && preset.callName !== preset.name && resolveBlueprintCall(projectGraphs(project), preset.callName)
      ? { ...preset, callName: preset.name } : preset);
  return [...(projectGraphs(project).some(graph => graph.id === endingPerformanceId || graph.name === '结局演出' || graph.callName === '结局演出') ? [] : [chapters.ending]), ...presets, ...projectGraphs(project)];
}

export function installPerformanceBlueprint(project: Project, graph: BlueprintGraph) {
  if (projectGraphs(project).some(item => item.id === graph.id)) return;
  const available = availablePerformanceBlueprints(project);
  addProjectGraphs(project, structuredClone(graph));
  for (const node of graph.nodes) if (node.type === 'callFunction') {
    const dependency = available.find(item => item.id === node.properties.graphId);
    if (dependency) installPerformanceBlueprint(project, dependency);
  }
}

/** Only reusable performances belong in the general story-command catalog. */
export function commandPerformanceBlueprints(project: Project) {
  const graphs = availablePerformanceBlueprints(project);
  const internal = new Set(graphs.filter(graph => graph.chapterVariant).flatMap(graph => graph.nodes.filter(node => node.type === 'callFunction').map(node => String(node.properties.graphId))));
  return graphs.filter(graph => !internal.has(graph.id) && graph.kind !== 'ui' && (graph.id.startsWith('builtin_') || graph.exposedInputs.length > 0));
}
