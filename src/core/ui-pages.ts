import { effectiveUiComponents, effectiveUiTheme, type Project, type UiComponent } from './model';
import { builtinUiPages, type BuiltinUiPage } from './ui-page-catalog';

export interface UiPageDescriptor {
  id: string;
  name: string;
  template: boolean;
  kind: UiComponent['page'];
  disabled: boolean;
  /** Engine-backed menus require a modal waiting call. Other templates need
   * their system-provided content (dialogue, choices, confirmation, etc.). */
  menuScreen?: string;
  openProblem?: string;
}
/** Native hosts are shared by compilation, page ownership and acceptance. Menu
 * aliases (save/load) intentionally address the same author-facing page. */
export const uiPageHostScreens = Object.fromEntries(Object.entries(builtinUiPages).map(([page, definition]) => [page, definition.hosts])) as Record<BuiltinUiPage, readonly string[]>;
/** Opt-in preserves the released default: an unconfigured ending returns to title. */
export function uiGameOverEnabled(project: Project) {
  const theme = effectiveUiTheme(project.ui);
  return !theme.disabledPages?.includes('gameOver') && (theme.pages?.gameOver?.layout === 'custom' || effectiveUiComponents(theme).some(component => component.page === 'gameOver'));
}
export const uiPageMenuScreens = Object.fromEntries(Object.entries(builtinUiPages).filter(([, definition]) => definition.menu).map(([page, definition]) => [page, definition.menu!])) as Partial<Record<UiComponent['page'], string>>;
/** One author-facing address book; the legacy storage layout is an implementation detail. */
export function uiPages(project: Project): UiPageDescriptor[] {
  return [
    ...Object.entries(builtinUiPages).map(([page, definition]) => {
      const kind = page as UiComponent['page'];
      return { id: 'ui:' + page, name: definition.name, template: true, kind, disabled: !!project.ui.disabledPages?.includes(kind), menuScreen: definition.menu, openProblem: definition.openProblem };
    }),
    ...project.ui.customPages.map(page => ({ id: page.id, name: page.name, template: false, kind: 'custom' as const, disabled: false })),
  ];
}
export function uiPage(project: Project, pageId: string) { return uiPages(project).find(page => page.id === pageId); }
export function uiPageOpenProblem(project: Project, pageId: string, wait?: boolean, modalMode?: string): string | undefined {
  const page = uiPage(project, pageId);
  if (!page) return '页面已不存在，请重新选择。';
  if (page.disabled) return '该页面已在工程中停用。';
  if (page.openProblem) return page.openProblem;
  if (page.template && (wait === false || modalMode === 'modeless' || modalMode === 'passthrough')) return '此系统模板使用菜单宿主：需等待关闭并拦截底层输入，不能叠加显示。页面属性、事件和状态仍使用通用接口。';
}
