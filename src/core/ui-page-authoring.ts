import { effectiveUiComponents, type Project, type UiComponent } from './model';
import { builtinUiPages, type BuiltinUiPage } from './ui-page-catalog';
import { uiPages } from './ui-pages';
import type { UiPageUsage } from './ui-page-usages';
import { projectGraphs } from './project-resources';
import type { PerformanceTarget } from './performance-workspace';
import { timelineWrapperCall } from './timeline-component';

/** Browsing a spare page never enables/disables game functionality. Keep a
 * selected spare page in the picker so design/event mode switches stay put. */
export function uiPickerPages(project: Project, selectedId: string | undefined, usages: ReadonlyMap<string, readonly UiPageUsage[]>) {
  return uiPages(project).filter(page => page.id === selectedId || !page.disabled && (!page.template
    || builtinUiPages[page.kind as BuiltinUiPage].group === 'common'
    || builtinUiPages[page.kind as BuiltinUiPage].group !== 'legacy' && usages.get(page.id)?.some(use => !use.reference && !use.inactive)));
}
export function uiSelectionFallback(project: Project): { page: UiComponent['page']; customPageId?: string } {
  const pages = uiPages(project).filter(page => !page.disabled);
  const first = pages.find(page => page.template && builtinUiPages[page.kind as BuiltinUiPage].group === 'common') ?? pages.find(page => !page.template) ?? pages[0];
  return first ? { page: first.kind, customPageId: first.template ? undefined : first.id } : { page: 'custom' };
}
export function uiSelectionContext(project: Project, selectedId?: string): { page: UiComponent['page']; customPageId?: string; saveMode?: 'save' | 'load' } | undefined {
  if (!selectedId) return;
  const customPage = project.ui.customPages.find(page => page.components.some(component => component.id === selectedId));
  if (customPage) {
    const component = customPage.components.find(item => item.id === selectedId)!;
    return { page: 'custom', customPageId: customPage.id, ...(component.saveMode ? { saveMode: component.saveMode } : {}) };
  }
  const component = effectiveUiComponents(project.ui).find(item => item.id === selectedId);
  if (!component || component.page === 'custom' || project.ui.disabledPages?.includes(component.page)) return;
  return { page: component.page, ...(component.saveMode ? { saveMode: component.saveMode } : {}) };
}
export function enableUiPage(project: Project, page: BuiltinUiPage) {
  if (!Object.hasOwn(builtinUiPages, page)) throw new Error('内置页面已不存在。');
  const disabled = project.ui.disabledPages?.filter(item => item !== page);
  if (disabled?.length) project.ui.disabledPages = disabled;
  else delete project.ui.disabledPages;
}

export interface ChapterEditorEntry { id: string; name: string; target: PerformanceTarget; used: boolean }
/** Follow actual resource IDs rather than names, which the author can rename. */
export function chapterEditorEntries(project: Project): ChapterEditorEntry[] {
  const graphs = projectGraphs(project);
  const targets = new Map<string, PerformanceTarget>();
  for (const node of project.nodes) if (node.kind === 'passage') for (const line of node.lines) line.actions.forEach((action, actionIndex) => {
    if (action.kind === 'blueprint' && !targets.has(action.blueprintId)) targets.set(action.blueprintId, { nodeId: node.id, lineId: line.id, actionIndex, graphId: action.blueprintId, editorMode: 'timeline' });
  });
  const chapterGraphs = graphs.filter(graph => graph.chapterVariant || graph.nodes.some(node => {
    if (node.type !== 'savedAction') return false;
    try { return JSON.parse(String(node.properties.action))?.chapterPresentation === true; } catch { return false; }
  }));
  const chapterIds = new Set(chapterGraphs.map(graph => graph.id));
  const wrappers = graphs.filter(graph => {
    const call = timelineWrapperCall(project, graph);
    return call && chapterIds.has(call.timelineId);
  });
  const candidates = [...new Map([...wrappers, ...chapterGraphs].map(graph => [graph.id, graph])).values()];
  const children = new Set(candidates.flatMap(graph => { const call = timelineWrapperCall(project, graph); return call ? [call.timelineId] : []; }));
  return candidates.filter(graph => !children.has(graph.id) || targets.has(graph.id)).map(graph => {
    const target: PerformanceTarget = targets.get(graph.id) ?? { nodeId: '', graphId: graph.id, editorMode: 'timeline' };
    return { id: graph.id, name: graph.name, target, used: !!target.nodeId };
  }).sort((a, b) => Number(b.used) - Number(a.used));
}
