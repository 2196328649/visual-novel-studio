import { projectGraphs, addProjectGraphs } from './project-resources';
import { effectiveUiTheme, type BlueprintGraph, type BlueprintPin, type Project, type StageAction } from './model';
import { blueprintCallName } from './blueprint-names';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from './blueprint';
import { chapterCompositionBlueprint } from './chapter-composition-blueprint';
import type { ChapterTextLayout } from './chapter-composition';
import { performanceTimeline, timelineNodeActions } from './performance-timeline';
import { useTimelineDefault } from './timeline-component';

type Chapter = Extract<StageAction, { kind: 'chapter' }>;
export const chapterTextPerformanceId = 'builtin_chapter_text';
export const chapterImagePerformanceId = 'builtin_chapter_image';
const labels: Record<string, string> = { title: '标题', subtitle: '副标题', firstLine: '第一行小字', secondLine: '第二行小字', rightText: '右侧字', titleImageId: '章节题图', backgroundId: '章节背景', soundId: '章节音效', duration: '时长' };
const parameterIds: Record<string, string> = { title: 'title', subtitle: 'subtitle', firstLine: 'first_line', secondLine: 'second_line', rightText: 'right_text', titleImageId: 'title_image', backgroundId: 'background', overlayId: 'overlay', maskId: 'mask', soundId: 'sound', duration: 'duration' };

/** The visible image/text is a normal visual object, with editable child animation. */
export function createChapterPerformance(project: Project, mode: 'text' | 'image', chapter?: Chapter, textLayout?: ChapterTextLayout, oldPins: Record<string, BlueprintPin> = {}) {
  const theme = effectiveUiTheme(project.ui);
  const source: Chapter = chapter ?? { kind: 'chapter', title: '醉梦', subtitle: '1645 弘光元年', duration: 7, effect: theme.chapterTransition?.effect ?? 'ink',
    backgroundId: theme.pages?.chapterTitle?.backgroundId ?? (String(projectGraphs(project).find(graph => graph.chapterVariant === 'image')?.exposedInputs.find(pin => pin.name === '章节背景')?.defaultValue ?? '') || undefined),
    ...(mode === 'image' ? { titleImageId: project.assets.find(asset => asset.kind === 'image' && /题图|章节.*标题/.test(asset.name))?.id } : {}),
  };
  const built = chapterCompositionBlueprint(project, { ...source, ...(mode === 'text' ? { titleImageId: undefined } : {}), wait: true }, textLayout, { includeEmptySubtitle: true, titleMode: mode, fourPartText: mode === 'text' });
  const graph = built.graph;
  if (!built.chapterInputs.soundId) {
    const sound = blueprintNodeDefaults('playSound'); sound.properties.assetId = ''; graph.nodes.push(sound);
    const event = graph.nodes.find(node => node.type === 'event')!;
    for (const link of graph.links.filter(link => link.fromNodeId === event.id && link.fromPinId === 'exec')) { link.fromNodeId = sound.id; link.fromPinId = 'exec_out'; }
    connectBlueprintPins(graph, event.id, 'exec', sound.id, 'exec_in');
    const input = blueprintNodeDefaults('getInput'); input.properties.inputId = 'chapter_sound'; input.pins[0].dataType = 'asset'; graph.nodes.push(input);
    graph.exposedInputs.push({ id: 'chapter_sound', name: '章节音效', direction: 'input', dataType: 'asset', required: false, defaultValue: '' });
    connectBlueprintPins(graph, input.id, 'value', sound.id, 'assetId'); built.chapterInputs.soundId = 'chapter_sound';
    if (graph.timeline) { graph.timeline.tracks.push({ id: 'chapter_sound_track', name: '章节音效' }); graph.timeline.clips.push({ nodeId: sound.id, trackId: 'chapter_sound_track' }); }
  }
  const semantics = [...(mode === 'text' ? ['firstLine', 'secondLine', 'title', 'rightText'] : ['titleImageId']), 'duration', 'backgroundId', ...Object.keys(built.chapterInputs).filter(key => key === 'overlayId' || key === 'maskId' || key.startsWith('decoration_')), 'soundId'];
  const kept = new Set(semantics.map(key => built.chapterInputs[key]).filter(Boolean));
  for (const pin of [...graph.exposedInputs]) if (!kept.has(pin.id)) {
    const readers = new Set(graph.nodes.filter(node => node.type === 'getInput' && node.properties.inputId === pin.id).map(node => node.id));
    for (const link of [...graph.links]) if (readers.has(link.fromNodeId)) useTimelineDefault(graph, link.toNodeId, link.toPinId);
  }
  for (const key of semantics) {
    const pin = graph.exposedInputs.find(pin => pin.id === built.chapterInputs[key]);
    if (!pin) continue;
    const oldId = pin.id;
    pin.id = oldPins[key]?.id ?? parameterIds[key] ?? key; pin.name = oldPins[key]?.name ?? labels[key] ?? pin.name;
    if (key === 'titleImageId') pin.required = true;
    for (const node of graph.nodes) if (node.type === 'getInput' && node.properties.inputId === oldId) node.properties.inputId = pin.id;
  }
  const order = semantics.map(key => oldPins[key]?.id ?? parameterIds[key] ?? key);
  graph.exposedInputs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  graph.name = mode === 'text' ? '章节进入演出文字版' : '章节进入演出图片版';
  graph.callName = mode === 'text' ? graph.name : '章节进入演出';
  graph.id = mode === 'text' ? chapterTextPerformanceId : chapterImagePerformanceId;
  graph.performanceKind = 'standalone'; graph.timelineComponent = true; graph.chapterVariant = mode; graph.playback = { clickSkip: false };
  graph.chapterPresetRevision = 3;
  return graph;
}

/** A callable chapter is a logic graph. Its animation is an ordinary child component. */
export function chapterBlueprintPair(source: BlueprintGraph, occupied: string[] = []): [BlueprintGraph, BlueprintGraph] {
  const timeline = structuredClone(source);
  let suffix = 0;
  const stem = source.id.slice(0, 48) + '_timeline';
  timeline.id = stem;
  while (occupied.includes(timeline.id)) timeline.id = stem + '_' + ++suffix;
  timeline.name = source.name + ' · 时间轴';
  delete timeline.callName; delete timeline.chapterVariant;
  const graph = createBlueprintGraph('effect', source.name);
  Object.assign(graph, { id: source.id, name: source.name, callName: source.callName, chapterVariant: source.chapterVariant, chapterPresetRevision: source.chapterPresetRevision, playback: source.playback, performanceKind: 'dialogue', exposedInputs: structuredClone(source.exposedInputs), exposedOutputs: structuredClone(source.exposedOutputs) });
  const call = blueprintNodeDefaults('callFunction');
  call.name = timeline.name; call.properties.graphId = timeline.id; call.pins = callablePins(timeline); call.x = 450; call.y = 100;
  graph.nodes.push(call);
  connectBlueprintPins(graph, graph.nodes[0].id, 'exec', call.id, 'exec_in');
  graph.exposedInputs.forEach((pin, index) => {
    const input = blueprintNodeDefaults('getInput'); input.name = '输入 · ' + pin.name; input.properties.inputId = pin.id; input.pins[0].dataType = pin.dataType; input.x = 40; input.y = 230 + index * 140;
    graph.nodes.push(input); connectBlueprintPins(graph, input.id, 'value', call.id, 'arg_' + pin.id);
  });
  let previous = call;
  graph.exposedOutputs.forEach((pin, index) => {
    const output = blueprintNodeDefaults('setOutput'); output.name = '输出 · ' + pin.name; output.properties.outputId = pin.id; output.pins.find(item => item.id === 'value')!.dataType = pin.dataType; output.x = 850; output.y = 100 + index * 180;
    graph.nodes.push(output);
    connectBlueprintPins(graph, previous.id, 'exec_out', output.id, 'exec_in');
    connectBlueprintPins(graph, call.id, 'out_' + pin.id, output.id, 'value');
    previous = output;
  });
  return [graph, timeline];
}

export function normalizeChapterBlueprintEntrypoints(project: Project): boolean {
  let changed = false;
  for (const graph of [...projectGraphs(project)]) {
    if (!graph.chapterVariant || !graph.timeline) continue;
    const [owner, timeline] = chapterBlueprintPair(graph, projectGraphs(project).map(item => item.id));
    // Preserve any additional metadata on the public graph and all authored tracks in the child.
    Object.assign(graph, owner); delete graph.timeline; delete graph.timelineComponent;
    addProjectGraphs(project, timeline); changed = true;
  }
  if (changed) synchronizeBlueprintSignatures(project);
  return changed;
}

/** Expand only generated, static chapter wrappers; authored logic and dynamic modes stay intact. */
export function normalizeGeneratedChapterBlueprints(project: Project): boolean {
  let changed = false;
  for (const graph of projectGraphs(project)) {
    const chapterNode = graph.nodes.find(node => node.type === 'showChapter');
    if (!chapterNode || !graph.timeline || graph.timeline.clips.length !== 1 || graph.timeline.clips[0].nodeId !== chapterNode.id
      || graph.nodes.some(node => !['event', 'showChapter', 'getInput', 'delay'].includes(node.type))
      || graph.nodes.filter(node => node.type === 'showChapter').length !== 1 || graph.exposedOutputs.length) continue;
    const oldPins: Record<string, BlueprintPin> = {};
    for (const link of graph.links.filter(link => link.toNodeId === chapterNode.id)) {
      const reader = graph.nodes.find(node => node.id === link.fromNodeId && node.type === 'getInput');
      const pin = graph.exposedInputs.find(pin => pin.id === reader?.properties.inputId);
      if (pin) oldPins[link.toPinId] = pin;
    }
    let source: Chapter | undefined;
    try { source = timelineNodeActions(project, graph, chapterNode).find(action => action.kind === 'chapter'); } catch { continue; }
    // Existing custom text needs browser font measurement before conversion.
    if (!source?.titleImageId) continue;
    const model = performanceTimeline(project, graph);
    if (model.reason || model.clips[0]?.at !== 0 || model.until !== source.duration || graph.nodes.some(node => node.type === 'delay' && node.id !== graph.timeline!.tailNodeId)) continue;
    const unsupported = [oldPins.title, oldPins.subtitle, oldPins.effect].filter((pin): pin is BlueprintPin => !!pin).map(pin => pin.id);
    const references = JSON.stringify({ nodes: project.nodes, scenes: project.scenes, characters: project.characters, effects: project.effects, graphs: projectGraphs(project).filter(item => item !== graph) });
    if (unsupported.some(id => references.includes('"' + id + '"') || references.includes('"arg_' + id + '"'))) continue;
    // Keep draft argument lists unchanged. They may use positional parameters.
    const names = [graph.name, blueprintCallName(graph), `${blueprintCallName(graph)}【${graph.id}】`];
    if (project.scriptText?.content.split(/\r?\n/).some(line => {
      const match = line.match(/^\s*[@／/]\s*([^:：]+)[:：]\s*(.+)$/);
      return match && (names.includes(match[1].trim()) || match[2].includes(graph.id));
    })) continue;
    const replacement = createChapterPerformance(project, 'image', source, undefined, oldPins);
    const { id, name, callName, playback, ...metadata } = graph;
    // Preserve the graph identity, library assignment and playback policy.
    Object.assign(graph, metadata, replacement, { id, name, callName, playback });
    changed = true;
  }
  if (changed) synchronizeBlueprintSignatures(project);
  return changed;
}
