import { projectGraphs } from './project-resources';
import type { Diagnostic, Project } from './model';
import type { TextParseResult } from './text-script';
import { componentName, uiPageNames } from './ui-names';

type SourceLocations = Pick<TextParseResult, 'sourceMap' | 'nodeLocations'>;
export type DiagnosticDestination =
  | { kind: 'text'; sourceLine: number }
  | { kind: 'story'; nodeId: string; lineId?: string; sourceLine?: number }
  | { kind: 'blueprint'; graphId: string; nodeId: string }
  | { kind: 'asset'; assetId: string }
  | { kind: 'ui'; target: NonNullable<Diagnostic['ui']> }
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
  if (issue.ui) {
    const target = issue.ui;
    const page = project.ui.customPages.find(page => page.id === target.customPageId);
    const instance = project.ui.instances?.find(instance => instance.id === target.instanceId);
    const components = page?.components ?? instance?.components ?? project.ui.components;
    const component = components.find(component => component.id === target.componentId);
    const label = ['界面', page ? page.name : instance?.name ?? '主题默认', uiPageNames[target.page], component ? componentName(component) : target.componentId].filter(Boolean).join(' / ');
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
  return JSON.stringify([issue.severity, issue.code, issue.message, issue.nodeId, issue.lineId, issue.assetId, issue.sourceLine, issue.setting, issue.ui?.page, issue.ui?.componentId, issue.ui?.instanceId, issue.ui?.customPageId]);
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
