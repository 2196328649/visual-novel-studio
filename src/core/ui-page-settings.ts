import { effectiveUiTheme, uiPageAppearanceSchema, type Project, type UiComponent, type UiPageAppearance, type UiTheme } from './model';
import { uiPage } from './ui-pages';

export function uiComponentPageId(project: Project, component: Pick<UiComponent, 'id' | 'page'>): string {
  return component.page === 'custom'
    ? project.ui.customPages.find(page => page.components.some(item => item.id === component.id))?.id ?? ''
    : 'ui:' + component.page;
}

export function uiPageAppearance(project: Project, pageId: string): UiPageAppearance {
  if (!pageId.startsWith('ui:')) return project.ui.customPages.find(page => page.id === pageId)?.appearance ?? {};
  return effectiveUiTheme(project.ui).pages?.[pageId.slice(3) as UiComponent['page']]?.appearance ?? {};
}

export function localUiPageAppearance(project: Project, pageId: string): UiPageAppearance {
  if (!pageId.startsWith('ui:')) return project.ui.customPages.find(page => page.id === pageId)?.appearance ?? {};
  const pages = project.ui.activeInstanceId
    ? project.ui.instances?.find(instance => instance.id === project.ui.activeInstanceId)?.pages
    : project.ui.pages;
  return pages?.[pageId.slice(3) as UiComponent['page']]?.appearance ?? {};
}

/** Page defaults are resolved without baking them into authored controls. */
export function uiPageTheme(project: Project, pageId: string): UiTheme {
  const theme = effectiveUiTheme(project.ui);
  const appearance = pageId.startsWith('ui:')
    ? theme.pages?.[pageId.slice(3) as UiComponent['page']]?.appearance
    : project.ui.customPages.find(page => page.id === pageId)?.appearance;
  if (!appearance) return theme;
  return { ...theme, ...appearance,
    fontAssetId: appearance.fontAssetId === '' ? undefined : appearance.fontAssetId ?? theme.fontAssetId,
    hoverSoundId: appearance.hoverSoundId === '' ? undefined : appearance.hoverSoundId ?? theme.hoverSoundId,
    clickSoundId: appearance.clickSoundId === '' ? undefined : appearance.clickSoundId ?? theme.clickSoundId,
  };
}

export function uiComponentTheme(project: Project, component: Pick<UiComponent, 'id' | 'page'>): UiTheme {
  return uiPageTheme(project, uiComponentPageId(project, component));
}

export function setUiPageAppearance<K extends keyof UiPageAppearance>(project: Project, pageId: string, key: K, value: UiPageAppearance[K]) {
  const page = uiPage(project, pageId);
  if (!page) throw new Error('页面已不存在，请重新选择。');
  if (page.template && project.ui.activeInstanceId && !project.ui.instances?.some(instance => instance.id === project.ui.activeInstanceId)) throw new Error('界面方案已不存在，请重新选择。');
  const appearance = { ...localUiPageAppearance(project, pageId) };
  if (value === undefined) delete appearance[key];
  else appearance[key] = value;
  const parsed = uiPageAppearanceSchema.parse(appearance);
  const owner = project.ui.activeInstanceId ? project.ui.instances?.find(instance => instance.id === project.ui.activeInstanceId)! : project.ui;
  const target = page.template
    ? (((owner.pages ??= {})[page.kind] ??= {}))
    : project.ui.customPages.find(item => item.id === pageId)!;
  if (Object.keys(parsed).length) target.appearance = parsed;
  else delete target.appearance;
}
