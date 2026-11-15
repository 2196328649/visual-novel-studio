import type { PreviewOptions } from './bridge';
import type { Project, UiComponent } from './model';
import { uiPageNames } from './ui-names';

/** A story entry override is reached after Start; it is not the preview's boot origin. */
export function gamePreviewOrigin(project: Project, options: PreviewOptions = {}) {
  const kind = options.flowStart === 'title' ? 'title' : 'launch';
  const entry = project.nodes.find(node => node.id === (options.entryId ?? project.entryId));
  return {
    kind,
    label: kind === 'title' ? '从标题预览' : '从启动预览',
    detail: kind === 'title'
      ? '本次直接显示标题，跳过首次标题前内容；之后返回标题仍按启动节点的执行策略运行。'
      : '按启动节点的执行策略运行标题前内容，再显示标题。',
    storyEntry: entry?.name ?? '剧情起点已不存在',
  };
}

export function pagePreviewOrigin(project: Project, pageId: string) {
  const pageName = project.ui.customPages.find(page => page.id === pageId)?.name
    ?? (pageId.startsWith('ui:') ? uiPageNames[pageId.slice(3) as UiComponent['page']] : undefined)
    ?? '页面已不存在';
  return {
    kind: 'page' as const,
    pageName,
    label: `从当前页面预览：${pageName}`,
    detail: '仅验证页面及其调用逻辑，不执行完整的启动、新游戏和剧情流程。',
  };
}
