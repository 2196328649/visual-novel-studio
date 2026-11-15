import type { UiButtonState, UiComponent, UiSkin, UiTheme } from './model';

export const uiStateNames: Record<UiButtonState, string> = { idle: '普通', hover: '悬停', pressed: '按住', selected: '选中', disabled: '禁用' };
export const uiFitNames = { stretch: '拉伸铺满', contain: '完整显示', cover: '裁切铺满', nineSlice: '九宫格缩放' } as const;

export function uiTooltip(component: UiComponent): string {
  const caption = component.tooltip ?? (component.skin?.hideText ? component.text : '');
  const key = component.shortcut?.replace(/^K_/, '').toUpperCase();
  return caption && key ? `${caption}(${key})` : caption;
}

export function uiTextColor(component: UiComponent, theme: UiTheme, state: UiButtonState): string {
  const style = component.style;
  return (state === 'disabled' ? style?.disabledTextColor : state === 'selected' ? style?.selectedTextColor : state === 'hover' || state === 'pressed' ? style?.hoverTextColor : undefined) ?? style?.textColor ?? theme.textColor;
}
export function uiStateColor(component: UiComponent, state: UiButtonState, accent = '#3b8f80'): string {
  const s = component.style;
  return (state === 'disabled' ? s?.disabledBackground ?? '#22282a' : state === 'pressed' ? s?.pressedBackground ?? s?.hoverBackground ?? accent : state === 'selected' ? s?.selectedBackground ?? s?.hoverBackground ?? accent : state === 'hover' ? s?.hoverBackground ?? s?.background ?? accent : s?.background ?? '#283133');
}
export { uiProperties, uiPropertyApplies, type UiProperty } from './ui-properties';
export const skinKinds = new Set<UiComponent['kind']>(['button', 'preferenceChoice', 'choiceList', 'saveSlots', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'pauseMenu', 'flowchart', 'historyList']);

/** Physical pressure is deliberately independent of the selected/toggled state. */
/** Edges that meet leave no middle to stretch, so keep one source pixel for it, as Unity's slicing does. */
export function nineSliceEdges<T extends { left: number; top: number; right: number; bottom: number }>(borders: T, width?: number, height?: number): T {
  const fit = (start: number, end: number, size?: number): [number, number] => {
    if (!size || size < 2 || start + end < size) return [start, end];
    const kept = Math.min(start, size - 1);
    return [kept, Math.min(end, size - 1 - kept)];
  };
  const [left, right] = fit(borders.left, borders.right, width), [top, bottom] = fit(borders.top, borders.bottom, height);
  return { ...borders, left, right, top, bottom };
}

export function uiSkinAsset(skin: UiSkin | undefined, state: UiButtonState): string | undefined {
  if (!skin) return;
  if (state === 'pressed') return skin.pressed ?? skin.hover ?? skin.idle;
  if (state === 'selected') return skin.selected ?? skin.hover ?? skin.idle;
  return skin[state] ?? skin.idle;
}

export function editableUiPages(theme: UiTheme): NonNullable<UiTheme['pages']> {
  const instance = theme.instances?.find(item => item.id === theme.activeInstanceId);
  return instance ? (instance.pages ??= {}) : (theme.pages ??= {});
}

export function uiPageBackgroundOpacity(theme: UiTheme, page: UiComponent['page']): number {
  const settings = theme.pages?.[page];
  if (settings?.backgroundOpacity !== undefined) return settings.backgroundOpacity;
  if (page !== 'history' || settings?.background || settings?.backgroundId) return 1;
  return settings?.layout === 'custom' ? 0 : 0.8;
}

/** Layout pixels use the project's virtual resolution; previews scale the whole canvas. */
export function uiComponentBounds(component: UiComponent, width: number, height: number) {
  return {
    x: Math.round(component.x * width), y: Math.round(component.y * height),
    width: Math.max(1, Math.round(component.width * width)),
    height: Math.max(1, Math.round(component.height * height)),
  };
}

export function uiComponentFontSize(component: UiComponent, theme: UiTheme, width: number, height: number) {
  const bounds = uiComponentBounds(component, width, height);
  return Math.max(12, Math.min(component.style?.fontSize ?? theme.fontSize, Math.floor(bounds.height * 0.7)));
}

/** Shared virtual-pixel metrics for the native dialogue screen and its design preview. */
export function dialogueLayout(width: number, height: number, theme: UiTheme) {
  const margin = Math.max(20, Math.round(width * 0.035));
  const quickHeight = theme.pages?.say?.showQuickMenu === false ? 0 : 42;
  const dialogueHeight = Math.round(height * theme.dialogueHeight);
  return { margin, contentWidth: width - margin * 2, quickHeight, dialogueHeight,
    top: height - quickHeight - dialogueHeight, paddingTop: 16, spacing: 8, speakerSize: Math.min(theme.fontSize, 30) };
}
