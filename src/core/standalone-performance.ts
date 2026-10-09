import { projectGraphs } from './project-resources';
import type { PerformancePlayback, Project, StageAction, StoryLine, StoryNode } from './model';
import { resolveBlueprintCall } from './blueprint-names';

/** Only old saved documents used the declaration itself as a blueprint call. */
export function migrateStandaloneNames(project: Project): boolean {
  const script = project.scriptText;
  if (!script || script.standaloneSyntax === 'module-names') return false;
  if (script.performanceSyntax === 'explicit') { script.standaloneSyntax = 'module-names'; return false; }
  let changed = false;
  const pendingCalls = new Set<string>();
  script.content = script.content.split('\n').map(line => {
    const match = line.match(/^(\s*)[@／/]\s*独立演出\s*[:：]\s*(.+)$/);
    if (!match) {
      const command = line.trim().match(/^[@／/]\s*([^:：]+?)(?:\s*[:：].*)?$/);
      const graph = command && resolveBlueprintCall(projectGraphs(project), command[1]);
      if (graph) pendingCalls.add(graph.id);
      else if ((line.trim() && !/^\s*(?:[@／/]|;)/.test(line))
        || (command && /^(独立演出|节点标记|返回标题界面|返回标题|跳转|调用|返回|开始|选择)$/.test(command[1]))) pendingCalls.clear();
      return line;
    }
    const call = match[2].trim().replace(/^@/, '');
    const graph = resolveBlueprintCall(projectGraphs(project), call.split(/[:：]/)[0].trim());
    const alreadyCalled = graph && pendingCalls.has(graph.id);
    pendingCalls.clear();
    // A preceding explicit call also occurs in freshly migrated legacy endings.
    // Its closing module declaration must not create another blueprint call.
    if (!graph || alreadyCalled) return line;
    changed = true;
    return `${match[1]}@${call}\n${match[1]}@独立演出：${graph.name}`;
  }).join('\n');
  script.standaloneSyntax = 'module-names';
  return changed;
}

export function isStandaloneNode(node?: StoryNode): node is Extract<StoryNode, { kind: 'passage' }> & { lines: [StoryLine & { silent: true }] } {
  return node?.kind === 'passage' && node.lines.length === 1 && node.lines[0].silent === true;
}

export function performancePlayback(project: Project, line: Pick<StoryLine, 'actions' | 'playback'>): PerformancePlayback & { clickSkip: boolean; onComplete: 'next' | 'title' } {
  const defaults = line.actions.reduce<PerformancePlayback>((settings, action) => action.kind === 'blueprint' ? { ...settings, ...projectGraphs(project).find(graph => graph.id === action.blueprintId)?.playback } : settings, {});
  const settings = { ...defaults, ...line.playback };
  const visited = new Set<string>();
  const chapter = (actions: StageAction[]): boolean => actions.some(action => {
    if (action.kind === 'chapter' || action.kind === 'visual' && action.chapterPresentation) return true;
    if (action.kind === 'effect') {
      if (visited.has(action.effectId)) return false;
      visited.add(action.effectId);
      return chapter(project.effects.find(item => item.id === action.effectId)?.actions ?? []);
    }
    if (action.kind !== 'blueprint' || visited.has(action.blueprintId)) return false;
    visited.add(action.blueprintId);
    return projectGraphs(project).find(item => item.id === action.blueprintId)?.nodes.some(node => {
      if (node.type === 'showChapter') return true;
      if (node.type === 'callFunction') return chapter([{ kind: 'blueprint', blueprintId: String(node.properties.graphId) }]);
      if (node.type !== 'savedAction') return false;
      try { return chapter([JSON.parse(String(node.properties.action)) as StageAction]); } catch { return false; }
    }) ?? false;
  });
  return { ...settings, clickSkip: settings.clickSkip ?? !chapter(line.actions), onComplete: settings.onComplete ?? 'next' };
}

export function standaloneChapter(node?: StoryNode): Extract<StageAction, { kind: 'chapter' }> | undefined {
  if (node?.kind === 'chapterTitle') {
    const { title, subtitle, duration, effect, backgroundId, titleImageId, soundId } = node;
    return { kind: 'chapter', title, subtitle, duration, effect, backgroundId, titleImageId, soundId };
  }
  if (!isStandaloneNode(node) || node.lines.length !== 1 || node.lines[0].actions.length !== 1) return undefined;
  const action = node.lines[0].actions[0];
  return action.kind === 'chapter' ? action : undefined;
}

/** Preserve story identity and links while moving legacy chapter content into the common performance model. */
export function normalizeChapterPerformances(project: Project, previous?: Project): { nodeId: string; lineId: string }[] {
  const converted: { nodeId: string; lineId: string }[] = [];
  const lineIds = new Set(project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.map(line => line.id) : []));
  project.nodes = project.nodes.map(node => {
    if (node.kind !== 'chapterTitle') return node;
    const old = previous?.nodes.find(item => item.id === node.id);
    let lineId = isStandaloneNode(old) ? old.lines[0].id : `${node.id}_performance`;
    while (lineIds.has(lineId)) lineId += '_';
    lineIds.add(lineId);
    const action = standaloneChapter(node)!;
    const { title: _title, subtitle: _subtitle, duration: _duration, effect: _effect, backgroundId: _background, titleImageId: _image, soundId: _music, playback: _playback, ...base } = node;
    converted.push({ nodeId: node.id, lineId });
    return { ...base, kind: 'passage', lines: [{ id: lineId, text: '', silent: true, actions: [action], playback: node.playback ?? { clickSkip: false } }] };
  });
  return converted;
}
