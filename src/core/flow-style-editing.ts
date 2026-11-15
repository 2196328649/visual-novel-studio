import type { UiButtonState, UiComponent, UiSkin } from './model';

export type FlowNodeStyle = NonNullable<UiComponent['style']>;
export type FlowCaptionStyles = NonNullable<FlowNodeStyle['captionParts']>;
export type FlowCaptionProperty = keyof FlowCaptionStyles[number];
export type FlowStyleProperty =
  | { kind: 'style'; key: keyof FlowNodeStyle }
  | { kind: 'skin'; state?: UiButtonState }
  | { kind: 'caption'; index: number; key: FlowCaptionProperty };

/** Text and style slots are end-aligned. Extra leading texts share the first slot. */
export function flowCaptionSlotIndex(slotCount: number, textCount: number, textIndex: number): number | undefined {
  if (!Number.isInteger(slotCount) || !Number.isInteger(textCount) || !Number.isInteger(textIndex)
    || slotCount < 1 || textCount < 1 || textIndex < 0 || textIndex >= textCount) return;
  return Math.min(Math.max(0, slotCount - textCount + textIndex), slotCount - 1);
}

/** Only an explicit edit creates slots; selecting a sample never rewrites its style. */
export function editFlowCaptionText(
  parts: FlowNodeStyle['captionParts'], textCount: number, textIndex: number,
  key: FlowCaptionProperty, value: FlowCaptionStyles[number][FlowCaptionProperty],
): FlowNodeStyle['captionParts'] {
  if (value === undefined && !parts?.length) return parts;
  const count = parts?.length || Math.min(8, textCount);
  const slot = flowCaptionSlotIndex(count, textCount, textIndex);
  if (slot === undefined) return parts;
  return editFlowCaptionSlot(parts?.length ? parts : Array.from({ length: count }, () => ({})), slot, key, value);
}

/** Keep unused slots and explicit zero gaps. A cleared field inherits the base text. */
export function editFlowCaptionSlot(
  parts: FlowCaptionStyles, slot: number, key: FlowCaptionProperty,
  value: FlowCaptionStyles[number][FlowCaptionProperty],
): FlowCaptionStyles {
  if (!Number.isInteger(slot) || slot < 0 || slot >= parts.length) return parts;
  return parts.map((part, index) => {
    if (slot !== index) return part;
    const next = { ...part, [key]: value };
    if (value === undefined) delete next[key];
    return next;
  });
}

export const flowStyleGroups = {
  text: ['fontAssetId', 'fontSize', 'letterSpacing', 'textColor', 'hoverTextColor', 'selectedTextColor', 'disabledTextColor', 'align'],
  caption: ['captionParts'],
  background: ['background', 'hoverBackground', 'pressedBackground', 'selectedBackground', 'disabledBackground'],
  frame: ['borderColor', 'borderWidth', 'radius'],
  outline: ['outlineWidth', 'outlineColor', 'outlineOpacity'],
  shadow: ['shadowX', 'shadowY', 'shadowBlur', 'shadowSpread', 'shadowColor', 'shadowOpacity'],
} as const satisfies Record<string, readonly (keyof FlowNodeStyle)[]>;
export type FlowStyleGroup = keyof typeof flowStyleGroups;

export function hasFlowStyleGroup(style: UiComponent['style'], group: FlowStyleGroup): boolean {
  return flowStyleGroups[group].some(key => style?.[key] !== undefined);
}

/** Reset one visual group in an Immer draft, leaving every other group intact. */
export function resetFlowStyleGroup(target: { style?: FlowNodeStyle }, group: FlowStyleGroup): void {
  if (!target.style) return;
  for (const key of flowStyleGroups[group]) delete target.style[key];
  if (!Object.keys(target.style).length) delete target.style;
}

export function hasFlowNodeAppearance(look: { style?: FlowNodeStyle; skin?: UiSkin }, shared: boolean): boolean {
  return look.skin !== undefined || Object.values(flowStyleGroups).some(keys => keys.some(key => look.style?.[key] !== undefined))
    || shared && look.style?.opacity !== undefined;
}

/** Root opacity belongs to the whole map; preset opacity belongs to its nodes. */
export function resetFlowNodeAppearance(target: { style?: FlowNodeStyle; skin?: UiSkin }, shared: boolean): void {
  for (const group of Object.keys(flowStyleGroups) as FlowStyleGroup[]) resetFlowStyleGroup(target, group);
  if (shared && target.style) {
    delete target.style.opacity;
    if (!Object.keys(target.style).length) delete target.style;
  }
  delete target.skin;
}

export type FlowTextBackdropMode = 'none' | 'soft' | 'custom';

export function flowTextBackdropOpacity(style: UiComponent['style']): number {
  const color = style?.shadowColor ?? '#000000';
  const colorAlpha = color.length === 9 ? Number.parseInt(color.slice(7), 16) / 255 : 1;
  return Math.max(0, Math.min(1, style?.shadowOpacity ?? .7)) * colorAlpha;
}

/** Classify what is rendered, without converting saved custom shadows to a preset. */
export function flowTextBackdropMode(style: UiComponent['style']): FlowTextBackdropMode {
  if (!(flowTextBackdropOpacity(style) > 0) || !(style?.shadowBlur || style?.shadowSpread || style?.shadowX || style?.shadowY)) return 'none';
  return !style?.shadowX && !style?.shadowY && (style?.shadowColor ?? '#000000').slice(0, 7).toLowerCase() === '#000000' ? 'soft' : 'custom';
}

/** The simple black-backdrop slider controls visible opacity, including RGBA alpha. */
export function setFlowBackdropOpacity(target: { style?: FlowNodeStyle }, effective: UiComponent['style'], opacity: number): void {
  target.style ??= {};
  target.style.shadowColor = (effective?.shadowColor ?? '#000000').slice(0, 7);
  target.style.shadowOpacity = Math.max(0, Math.min(1, opacity));
}
