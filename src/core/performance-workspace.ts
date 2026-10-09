import { projectGraphs, addProjectGraphs } from './project-resources';
import { availableBlueprintName } from './blueprint-names';
import { makeId, type BlueprintGraph, type Project, type StageAction, type StoryNode } from './model';
import { assignBlueprintGroup, blueprintFromPerformance, exposePerformanceInputs, installPerformanceBlueprint, performanceInputs } from './blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from './performance-timeline';
import type { TextParseResult } from './text-script';
import { chapterBlueprintPair, createChapterPerformance } from './chapter-performances';

export interface PerformanceTarget { nodeId: string; lineId?: string; graphId?: string; actionIndex?: number; editorMode?: 'graph' | 'timeline' }
export type PerformanceKind = 'dialogue' | 'standalone';
export function performanceKind(graph?: BlueprintGraph): PerformanceKind | undefined {
  if (!graph) return undefined;
  return graph.performanceKind ?? (graph.kind === 'effect' || graph.timeline ? graph.nodes.some(node => node.type === 'showChapter') ? 'standalone' : 'dialogue' : undefined);
}
export function targetPerformanceKind(project: Project, target?: PerformanceTarget): PerformanceKind {
  const node = project.nodes.find(node => node.id === target?.nodeId);
  return node?.kind === 'chapterTitle' || (node?.kind === 'passage' && (node.lines.find(line => line.id === target?.lineId) ?? node.lines[0])?.silent) ? 'standalone' : 'dialogue';
}
export const chapterAction = (node: Extract<StoryNode, { kind: 'chapterTitle' }>): Extract<StageAction, { kind: 'chapter' }> => ({
  kind: 'chapter', title: node.title, subtitle: node.subtitle, duration: node.duration, effect: node.effect,
  backgroundId: node.backgroundId, titleImageId: node.titleImageId, soundId: node.soundId,
});

export function performanceTargetAt(parsed: TextParseResult, sourceLine: number): PerformanceTarget | undefined {
  const declared = [...parsed.nodeLocations].reverse().find(location => location.sourceLine <= sourceLine);
  const node = parsed.project.nodes.find(node => node.id === declared?.nodeId);
  if (node?.kind === 'chapterTitle') return { nodeId: node.id };
  const location = [...parsed.sourceMap].reverse().find(location => !location.reference && location.sourceLine <= sourceLine && (!node || location.nodeId === node.id));
  if (!location) return node?.kind === 'passage' ? { nodeId: node.id, lineId: node.lines[0]?.id } : undefined;
  const passage = parsed.project.nodes.find(node => node.id === location.nodeId);
  const line = passage?.kind === 'passage' ? passage.lines.find(line => line.id === location.lineId) : undefined;
  const action = location.actionCount === undefined ? undefined : line?.actions[location.actionCount - 1];
  return { nodeId: location.nodeId, lineId: location.lineId, graphId: action?.kind === 'blueprint' ? action.blueprintId : undefined, ...(action?.kind === 'blueprint' && (line?.actions.length ?? 0) > 1 ? { actionIndex: location.actionCount! - 1 } : {}) };
}

export function targetPerformance(project: Project, target: PerformanceTarget): StageAction[] {
  const node = project.nodes.find(node => node.id === target.nodeId);
  if (node?.kind === 'chapterTitle') return [chapterAction(node)];
  const actions = node?.kind === 'passage' ? (node.lines.find(line => line.id === target.lineId) ?? node.lines[0])?.actions ?? [] : [];
  return target.actionIndex === undefined ? actions : actions.slice(target.actionIndex, target.actionIndex + 1);
}

export function editablePerformanceTarget(project: Project, target: PerformanceTarget): PerformanceTarget {
  if (target.graphId || !target.nodeId) return target;
  const node = project.nodes.find(node => node.id === target.nodeId);
  if (!node || !['passage', 'chapterTitle'].includes(node.kind)) return target;
  const lineId = target.lineId ?? (node.kind === 'passage' ? node.lines[0]?.id : undefined);
  const source = { ...target, lineId };
  const actions = targetPerformance(project, source);
  if (target.actionIndex !== undefined && (!Number.isInteger(target.actionIndex) || target.actionIndex < 0 || !actions.length)) throw new Error('这个演出已不存在，请重新选择。');
  if (actions.length === 1 && actions[0].kind === 'blueprint') return { ...source, graphId: actions[0].blueprintId };
  const chapter = actions.length === 1 && actions[0].kind === 'chapter';
  const name = availableBlueprintName(project, chapter ? '章节进入演出' : targetPerformanceKind(project, source) === 'standalone' ? '独立演出' : '台词演出');
  let graph = chapter && actions[0].kind === 'chapter' ? createChapterPerformance(project, actions[0].titleImageId ? 'image' : 'text', actions[0]) : blueprintFromPerformance(project, actions, name);
  if (chapter) {
    graph.id = makeId('blueprint'); graph.name = name; delete graph.callName;
    const pair = chapterBlueprintPair(graph, projectGraphs(project).map(item => item.id));
    graph = pair[0]; addProjectGraphs(project, pair[1]);
  }
  graph.performanceKind = targetPerformanceKind(project, source);
  const timeline = performanceTimeline(project, graph);
  if (!chapter && !timeline.reason) arrangePerformanceTimeline(project, graph, timeline.clips, timeline.tracks);
  return bindPerformanceBlueprint(project, source, graph, graph.performanceKind === 'standalone' ? '独立演出' : '台词演出');
}

/** A temporary timeline lets navigation leave the authored project untouched. */
export function performanceWorkspaceDraft(project: Project, target?: PerformanceTarget) {
  const unchanged = { project, target, materialize: (_draft: Project) => {} };
  if (!target?.nodeId || target.graphId) return unchanged;
  const actions = targetPerformance(project, target);
  if (actions.length === 1 && actions[0].kind === 'blueprint') return { ...unchanged, target: { ...target, graphId: actions[0].blueprintId } };
  const preview = structuredClone(project);
  const editable = editablePerformanceTarget(preview, target);
  const graph = projectGraphs(preview).find(graph => graph.id === editable.graphId);
  if (!graph) return unchanged;
  return { project: preview, target: editable, materialize: (draft: Project) => {
    for (const dependency of projectGraphs(preview)) if (dependency.id !== graph.id && !projectGraphs(project).some(item => item.id === dependency.id) && !projectGraphs(draft).some(item => item.id === dependency.id)) addProjectGraphs(draft, structuredClone(dependency));
    if (!projectGraphs(draft).some(item => item.id === graph.id)) bindPerformanceBlueprint(draft, editable, structuredClone(graph), graph.performanceKind === 'standalone' ? '独立演出' : '台词演出');
  } };
}

/** Keep the story node's identity and outgoing path when authoring a chapter as a graph. */
export function bindPerformanceBlueprint(project: Project, target: PerformanceTarget, graph: BlueprintGraph, group: string): PerformanceTarget {
  const node = project.nodes.find(node => node.id === target.nodeId);
  if (!node || (node.kind !== 'chapterTitle' && node.kind !== 'passage')) throw new Error('请选择章节演出或台词。');
  graph.performanceKind ??= targetPerformanceKind(project, target);
  installPerformanceBlueprint(project, graph);
  assignBlueprintGroup(project, graph.id, group);
  let lineId = target.lineId;
  if (node.kind === 'chapterTitle') {
    lineId ??= makeId('line');
    const { title: _title, subtitle: _subtitle, duration: _duration, effect: _effect, backgroundId: _background, titleImageId: _image, soundId: _music, playback: _playback, ...base } = node;
    project.nodes[project.nodes.indexOf(node)] = { ...base, kind: 'passage', lines: [{ id: lineId, text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: graph.id }], playback: node.playback ?? { clickSkip: false } }] };
  } else {
    const line = node.lines.find(line => line.id === lineId) ?? node.lines[0];
    if (!line) throw new Error('请先添加台词。');
    if (target.actionIndex === undefined) line.actions = [{ kind: 'blueprint', blueprintId: graph.id }];
    else line.actions.splice(target.actionIndex, 1, { kind: 'blueprint', blueprintId: graph.id });
    lineId = line.id;
  }
  return { nodeId: node.id, lineId, graphId: graph.id, ...(target.actionIndex === undefined ? {} : { actionIndex: target.actionIndex }) };
}
