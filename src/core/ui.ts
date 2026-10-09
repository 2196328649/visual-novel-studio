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
export const uiProperties = {
  visible: { name: '显示', type: 'boolean', initial: true },
  enabled: { name: '启用', type: 'boolean', initial: true },
  selected: { name: '选中', type: 'boolean', initial: false },
  text: { name: '文字', type: 'string', initial: '' },
  x: { name: '横向位置（画面比例）', type: 'number', initial: 0 },
  y: { name: '纵向位置（画面比例）', type: 'number', initial: 0 },
  width: { name: '宽度（画面比例）', type: 'number', initial: 1 },
  height: { name: '高度（画面比例）', type: 'number', initial: 1 },
  opacity: { name: '不透明度（0～1）', type: 'number', initial: 1 },
  value: { name: '进度（0～1）', type: 'number', initial: 0 },
} as const;
export type UiProperty = keyof typeof uiProperties;
export function uiPropertyApplies(component: UiComponent, property: UiProperty): boolean {
  if (property === 'enabled') return ['button','preference','preferenceChoice'].includes(component.kind);
  if (property === 'selected') return component.kind === 'button';
  if (property === 'text') return component.kind === 'button' || component.kind === 'text' && !component.binding;
  if (property === 'value') return component.kind === 'progress';
  return true;
}
export const skinKinds = new Set<UiComponent['kind']>(['button', 'preferenceChoice', 'choiceList', 'saveSlots', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'pauseMenu', 'flowchart', 'historyList']);

/** Physical pressure is deliberately independent of the selected/toggled state. */
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
