import type { Project, UiComponent } from './model';

/** undefined inherits the theme; null explicitly silences this control. */
export function uiHoverSound(project: Project, component?: UiComponent): string | undefined {
  const id = component?.hoverSoundId === undefined ? project.ui.hoverSoundId : component.hoverSoundId;
  return project.assets.find(asset => asset.id === id && asset.kind === 'audio')?.id;
}
