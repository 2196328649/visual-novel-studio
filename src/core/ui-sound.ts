import type { Project, UiComponent } from './model';
import { uiComponentTheme, uiPageTheme } from './ui-page-settings';

/** undefined inherits the theme; null explicitly silences this control. */
export function uiHoverSound(project: Project, component?: UiComponent, pageId?: string): string | undefined {
  const id = component?.hoverSoundId === undefined ? (component ? uiComponentTheme(project, component).hoverSoundId : pageId ? uiPageTheme(project, pageId).hoverSoundId : project.ui.hoverSoundId) : component.hoverSoundId;
  return project.assets.find(asset => asset.id === id && asset.kind === 'audio')?.id;
}

/** The same inheritance for an accepted click. */
export function uiClickSound(project: Project, component?: UiComponent, pageId?: string): string | undefined {
  const id = component?.clickSoundId === undefined ? (component ? uiComponentTheme(project, component).clickSoundId : pageId ? uiPageTheme(project, pageId).clickSoundId : project.ui.clickSoundId) : component.clickSoundId;
  return project.assets.find(asset => asset.id === id && asset.kind === 'audio')?.id;
}
