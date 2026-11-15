import { makeId, type FlowStyle, type Project, type UiComponent } from './model';
import { flowNodeAppearance } from './flow-style';
import { cloneData } from './project-mutation';
import { storyMenuEntries } from './story-menu';
import { editStoryFlowSource, storyFlowOwner, storyFlowSourceEditable, type FlowOwner } from './story-flow-authoring';
import { isStandaloneNode } from './standalone-performance';
import { uiComponentTheme } from './ui-page-settings';
import { uiStateColor, uiTextColor } from './ui';
import { playerFlowAllEntries, playerFlowMode } from './player-flow-content';
import { editPlayerFlowEntry } from './player-flow-authoring';

export type CopyFlowStyleResult = { ok: true; styleId: string; owner?: FlowOwner } | { ok: false; reason: string };

function copyName(styles: readonly FlowStyle[], stem: string) {
  let name = stem.trim().slice(0, 120), number = 2;
  while (styles.some(style => style.name === name)) {
    const suffix = ` ${number++}`;
    name = `${stem.trim().slice(0, 120 - suffix.length)}${suffix}`;
  }
  return name;
}

/** Capture the effective node look, including the current page's fallback text. */
function nodeLook(project: Project, component: UiComponent, entry: ReturnType<typeof storyMenuEntries>[number]) {
  const theme = uiComponentTheme(project, component);
  const node = project.nodes.find(item => item.id === entry.id);
  const kind = node && isStandaloneNode(node) ? 'chapterTitle' : node?.kind;
  const look = flowNodeAppearance({ ...project, ui: theme }, component, { ...entry, kind });
  const style: NonNullable<UiComponent['style']> = {
    fontSize: look.style?.fontSize ?? theme.fontSize,
    letterSpacing: look.style?.letterSpacing ?? 0,
    textColor: uiTextColor(look, theme, 'idle'),
    hoverTextColor: uiTextColor(look, theme, 'hover'),
    selectedTextColor: uiTextColor(look, theme, 'selected'),
    disabledTextColor: uiTextColor(look, theme, 'disabled'),
    background: uiStateColor(look, 'idle', theme.accent),
    hoverBackground: uiStateColor(look, 'hover', theme.accent),
    pressedBackground: uiStateColor(look, 'pressed', theme.accent),
    selectedBackground: uiStateColor(look, 'selected', theme.accent),
    disabledBackground: uiStateColor(look, 'disabled', theme.accent),
    align: look.style?.align ?? 'center',
    borderWidth: look.style?.borderWidth ?? 0,
    borderColor: look.style?.borderColor ?? theme.accent,
    radius: look.style?.radius ?? 0,
    outlineWidth: look.style?.outlineWidth ?? 0,
    outlineColor: look.style?.outlineColor ?? '#000000',
    outlineOpacity: look.style?.outlineOpacity ?? 1,
    shadowX: look.style?.shadowX ?? 0,
    shadowY: look.style?.shadowY ?? 0,
    shadowBlur: look.style?.shadowBlur ?? 0,
    shadowSpread: look.style?.shadowSpread ?? 0,
    shadowColor: look.style?.shadowColor ?? '#000000',
    shadowOpacity: look.style?.shadowOpacity ?? .7,
    captionParts: cloneData(look.style?.captionParts ?? []),
    opacity: look.style?.opacity ?? 1,
  };
  // The current schema has no explicit system-font sentinel. When no concrete
  // font asset is used, keep the existing cross-map font inheritance contract.
  if (look.style?.fontAssetId ?? theme.fontAssetId) style.fontAssetId = look.style?.fontAssetId ?? theme.fontAssetId;
  // flowNodeAppearance supplies node opacity; the map's opacity is never copied.
  // A nonempty skin also prevents the native renderer's truthy fallback from
  // substituting another map's base/type image for this explicit empty image.
  const skin = {
    ...cloneData(look.skin), fit: look.skin?.fit ?? 'stretch', hideText: look.skin?.hideText ?? false,
    brightness: { idle: 1, hover: 1, pressed: 1, selected: 1, disabled: 1, ...cloneData(look.skin?.brightness) },
    ...(look.skin?.fit === 'nineSlice' ? { borders: cloneData(look.skin.borders ?? { left: 12, top: 12, right: 12, bottom: 12 }) } : {}),
  };
  return { skin, style };
}

/**
 * Copying a real preset keeps its unset fields inherited; an unstyled entry
 * captures its effective look in this map. Script maps assign through the
 * shared story owner, while custom maps assign only their own saved entry.
 */
export function copyFlowStyleForEntry(project: Project, component: UiComponent, nodeId: string, options: { expectedOwner?: FlowOwner } = {}): CopyFlowStyleResult {
  if (component.kind !== 'flowchart') return { ok: false, reason: '请选择玩家剧情图控件。' };
  const custom = playerFlowMode(component) === 'custom';
  const entry = (custom ? playerFlowAllEntries(project, component) : storyMenuEntries(project, 'flowchart')).find(item => item.id === nodeId);
  if (!entry) return { ok: false, reason: '当前剧情入口已不存在或不再显示。' };
  if (options.expectedOwner && (!entry.owner || entry.owner.kind !== options.expectedOwner.kind || entry.owner.id !== options.expectedOwner.id)) return { ok: false, reason: '此节点的剧情来源已变化，请重新选择后再复制。' };
  if (!custom && (!entry.owner || !storyFlowSourceEditable(project, entry.owner) || !storyFlowOwner(project, entry.owner))) return { ok: false, reason: '此旧内部入口不能保存外观预设，请使用对应章节或小章节。' };
  const styles = project.ui.flowStyles ?? [];
  if (styles.length >= 128) return { ok: false, reason: '节点外观预设已达 128 个，请先删除未使用的预设。' };
  const source = styles.find(style => style.id === entry.styleId);
  const appearance = source ? { skin: cloneData(source.skin), style: cloneData(source.style) } : nodeLook(project, component, entry);
  const name = copyName(styles, source ? `${source.name.slice(0, 117)} 副本` : `${entry.name.slice(0, 117)} 外观`);
  let styleId = makeId('flow_style');
  while (styles.some(style => style.id === styleId)) styleId = makeId('flow_style');
  const copied: FlowStyle = { id: styleId, name, ...appearance };
  if (custom && !editPlayerFlowEntry(component, nodeId, { styleId })) return { ok: false, reason: '当前剧情入口已变化，请重新选择后再复制。' };
  (project.ui.flowStyles ??= []).push(copied);
  if (!custom && entry.owner) editStoryFlowSource(project, entry.owner, { styleId });
  return { ok: true, styleId, ...(entry.owner ? { owner: { ...entry.owner } } : {}) };
}
