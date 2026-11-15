import { effectiveUiComponents, uiPageSchema } from './model';
import { projectGraphs } from './project-resources';
import type { Diagnostic, Project } from './model';
import type { TextParseResult } from './text-script';
import { componentName, uiPageNames } from './ui-names';
import { gameFlowPhaseNames } from './game-flow-schema';
import { textDocumentContainsLine, visibleTextLine, type TextDocument } from './text-document';
import { textChapterAtLine, type TextChapter } from './text-chapters';

type SourceLocations = Pick<TextParseResult, 'sourceMap' | 'nodeLocations'>;

/** Match the chapter editor's gutter while keeping navigation in full-source coordinates. */
export function diagnosticTextLine(document: TextDocument, sourceLine: number, chapters: TextChapter[]): number | undefined {
  if (!textDocumentContainsLine(document, sourceLine)) return undefined;
  const line = visibleTextLine(document, sourceLine);
  if (document.scope) return line;
  const chapter = textChapterAtLine(chapters, sourceLine);
  return line - (chapter ? visibleTextLine(document, chapter.firstLine) - 1 : 0);
}

export type DiagnosticDestination =
  | { kind: 'text'; sourceLine: number }
  | { kind: 'story'; nodeId: string; lineId?: string; sourceLine?: number }
  | { kind: 'blueprint'; graphId: string; nodeId: string }
  | { kind: 'asset'; assetId: string }
  | { kind: 'ui'; target: NonNullable<Diagnostic['ui']> }
  | { kind: 'gameFlow'; target: NonNullable<Diagnostic['gameFlow']> }
  | { kind: 'settings'; section: 'entry' };

/** Node validation and runtime errors share the text parser's authored locations. */
export function diagnosticSourceLine(issue: Diagnostic, locations?: SourceLocations): number | undefined {
  if (Number.isInteger(issue.sourceLine) && issue.sourceLine! > 0) return issue.sourceLine;
  if (!locations || !issue.nodeId) return;
  if (issue.lineId) {
    const candidates = locations.sourceMap.filter(location => !location.reference && location.nodeId === issue.nodeId && location.lineId === issue.lineId);
    const dialogue = candidates.find(location => location.actionCount === undefined) ?? candidates[0];
    if (dialogue) return dialogue.sourceLine;
  }
  return locations.nodeLocations.find(location => location.nodeId === issue.nodeId)?.sourceLine
    ?? locations.sourceMap.find(location => !location.reference && location.nodeId === issue.nodeId)?.sourceLine;
}

export function diagnosticLocation(project: Project, issue: Diagnostic, locations?: SourceLocations): { label: string; destination?: DiagnosticDestination } {
  // Keep the originating flow step as context, but open the actual offending node/control.
  if (issue.gameFlow && issue.code?.startsWith('gameFlow.path.') && issue.nodeId) {
    const graph = projectGraphs(project).find(graph => graph.nodes.some(node => node.id === issue.nodeId));
    if (graph) return { label: '蓝图 / ' + graph.name + ' / ' + graph.nodes.find(node => node.id === issue.nodeId)!.name, destination: { kind: 'blueprint', graphId: graph.id, nodeId: issue.nodeId } };
  }
  if (issue.gameFlow && !(issue.code?.startsWith('gameFlow.path.') && issue.ui)) return { label: '流程蓝图 / ' + gameFlowPhaseNames[issue.gameFlow.phase], destination: { kind: 'gameFlow', target: issue.gameFlow } };
  if (issue.ui) {
    // A graph diagnostic may also carry its runtime page/trigger. The offending
    // node remains the edit target; do not lose it by opening the design tab.
    const graph = issue.nodeId && projectGraphs(project).find(graph => graph.nodes.some(node => node.id === issue.nodeId));
    if (graph) return { label: '蓝图 / ' + graph.name + ' / ' + graph.nodes.find(node => node.id === issue.nodeId)!.name, destination: { kind: 'blueprint', graphId: graph.id, nodeId: issue.nodeId! } };
    const target = issue.ui;
    const page = target.page === 'custom' ? project.ui.customPages.find(page => page.id === target.customPageId) : undefined;
    const instance = project.ui.instances?.find(instance => instance.id === target.instanceId);
    if (!uiPageSchema.safeParse(target.page).success || target.page === 'custom' && !page) return { label: '界面 / 页面已不存在，不会打开其他页面' };
    if (target.instanceId && !instance) return { label: '界面 / 所属方案已不存在，不会使用当前方案' };
    const components = page?.components ?? effectiveUiComponents({ ...project.ui, activeInstanceId: target.instanceId }).filter(component => component.page === target.page);
    const component = components.find(component => component.id === target.componentId);
    const label = ['界面', page ? page.name : instance?.name ?? '主题默认', uiPageNames[target.page], component ? componentName(component) : target.componentId].filter(Boolean).join(' / ') + (project.ui.disabledPages?.includes(target.page) ? '（已停用）' : '');
    if (target.componentId && !component) return { label: label + ' / 控件已不存在或已移到其他页面' };
    return { label, destination: { kind: 'ui', target } };
  }
  if (issue.setting === 'entry') return { label: '作品设置 / 故事入口', destination: { kind: 'settings', section: 'entry' } };
  const sourceLine = diagnosticSourceLine(issue, locations);
  const node = project.nodes.find(node => node.id === issue.nodeId);
  if (node) {
    const scene = project.scenes.find(scene => scene.id === node.sceneId);
    const chapter = project.chapters.find(chapter => chapter.id === scene?.chapterId);
    const lineIndex = node.kind === 'passage' ? node.lines.findIndex(line => line.id === issue.lineId) : -1;
    const label = [chapter?.name, scene?.name, node.name, lineIndex >= 0 ? '第 ' + (lineIndex + 1) + ' 句对白' : undefined].filter(Boolean).join(' / ');
    return { label, destination: { kind: 'story', nodeId: node.id, lineId: issue.lineId, sourceLine } };
  }
  const graph = projectGraphs(project)?.find(graph => graph.nodes.some(node => node.id === issue.nodeId));
  if (graph) return { label: '蓝图 / ' + graph.name + ' / ' + graph.nodes.find(node => node.id === issue.nodeId)!.name, destination: { kind: 'blueprint', graphId: graph.id, nodeId: issue.nodeId! } };
  if (sourceLine) return { label: '剧情文本', destination: { kind: 'text', sourceLine } };
  const asset = project.assets.find(asset => asset.id === issue.assetId);
  if (asset) return { label: '素材 / ' + asset.name, destination: { kind: 'asset', assetId: asset.id } };
  return { label: '作品检查' };
}

export function diagnosticKey(issue: Diagnostic): string {
  return JSON.stringify([issue.severity, issue.code, issue.message, issue.nodeId, issue.lineId, issue.assetId, issue.sourceLine, issue.setting, issue.ui?.page, issue.ui?.componentId, issue.ui?.instanceId, issue.ui?.customPageId, issue.gameFlow?.phase, issue.gameFlow?.stepId]);
}

export function uniqueDiagnostics(issues: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = diagnosticKey(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
