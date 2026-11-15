import type { FlowStyle, Project, UiButtonState, UiComponent, UiSkin } from './model';
import { flowCaptionSlotIndex, type FlowStyleProperty } from './flow-style-editing';
import { flowNodeAppearance } from './flow-style';
import { uiComponentTheme } from './ui-page-settings';
import { uiSkinAsset } from './ui';

type Style = NonNullable<UiComponent['style']>;
type CaptionPart = NonNullable<Style['captionParts']>[number];
export interface FlowStyleImpactNode { id: string; name?: string; parts?: string[]; kind?: string; styleId?: string }
export type FlowStyleImpactTarget = { kind: 'base' } | { kind: 'preset'; presetId: string };
export interface FlowStyleImpactReference { affected: boolean; source: string; reason?: string }
export interface FlowStyleImpact { nodeIds: string[]; label: string; reference: FlowStyleImpactReference }

const presetSource = (preset: FlowStyle) => `节点外观预设“${preset.name}”`;
const skinStates = (state: UiButtonState): UiButtonState[] => state === 'pressed' ? ['pressed', 'hover', 'idle'] : state === 'selected' ? ['selected', 'hover', 'idle'] : state === 'idle' ? ['idle'] : [state, 'idle'];
const stateNames: Record<UiButtonState, string> = { idle: '普通', hover: '悬停', pressed: '按住', selected: '当前位置', disabled: '未到达' };

function styleSource(component: UiComponent, preset: FlowStyle | undefined, key: keyof Style) {
  if (key === 'opacity') return preset?.style?.opacity !== undefined ? presetSource(preset) : '节点默认不透明度';
  if (key === 'playerOpacity') return '节点固定设置';
  if (preset?.style?.[key] !== undefined) return presetSource(preset);
  if (component.style?.[key] !== undefined) return '本图基础外观';
  return key === 'fontAssetId' || key === 'fontSize' || key === 'textColor' ? '页面默认文字' : '节点默认外观';
}

function nodeSkin(component: UiComponent, node: FlowStyleImpactNode, preset?: FlowStyle): { skin?: UiSkin; source: string; base: boolean } {
  if (preset?.skin !== undefined) return { skin: preset.skin, source: presetSource(preset), base: false };
  if (node.kind === 'end' && component.list?.flowEndSkin !== undefined) return { skin: component.list.flowEndSkin, source: '本图结局底图', base: false };
  if (node.kind === 'chapterTitle' && component.list?.flowChapterSkin !== undefined) return { skin: component.list.flowChapterSkin, source: '本图章节底图', base: false };
  return { skin: component.skin, source: component.skin ? '本图基础底图' : '节点默认底色', base: true };
}

/** Higher priority state fields can make a lower priority color irrelevant. */
function colorKeys(key: keyof Style, state: UiButtonState): (keyof Style)[] | undefined {
  if (['textColor', 'hoverTextColor', 'selectedTextColor', 'disabledTextColor'].includes(key)) {
    return state === 'disabled' ? ['disabledTextColor', 'textColor'] : state === 'selected' ? ['selectedTextColor', 'textColor'] : state === 'hover' || state === 'pressed' ? ['hoverTextColor', 'textColor'] : ['textColor'];
  }
  if (['background', 'hoverBackground', 'pressedBackground', 'selectedBackground', 'disabledBackground'].includes(key)) {
    return state === 'disabled' ? ['disabledBackground'] : state === 'pressed' ? ['pressedBackground', 'hoverBackground'] : state === 'selected' ? ['selectedBackground', 'hoverBackground'] : state === 'hover' ? ['hoverBackground', 'background'] : ['background'];
  }
}

function sourceForColor(component: UiComponent, preset: FlowStyle | undefined, look: UiComponent, keys: (keyof Style)[]) {
  const key = keys.find(item => look.style?.[item] !== undefined);
  return key ? styleSource(component, preset, key) : keys.includes('textColor') ? '页面默认文字' : '节点默认底色';
}

function inspectNode(project: Project, component: UiComponent, node: FlowStyleImpactNode, target: FlowStyleImpactTarget, property: FlowStyleProperty, state: UiButtonState): FlowStyleImpactReference {
  const preset = project.ui.flowStyles?.find(item => item.id === node.styleId);
  const look = flowNodeAppearance(project, component, node), style = look.style ?? {};
  const skin = nodeSkin(component, node, preset);
  const applies = target.kind === 'base' || preset?.id === target.presetId;
  const unavailable = target.kind === 'preset' && !project.ui.flowStyles?.some(item => item.id === target.presetId);
  const no = (source: string, reason: string): FlowStyleImpactReference => ({ affected: false, source, reason });
  const yes = (source: string, reason?: string): FlowStyleImpactReference => ({ affected: true, source, ...(reason ? { reason } : {}) });
  const outside = (source: string) => no(source, unavailable ? '要编辑的外观预设已不存在。' : '此节点没有使用正在编辑的外观预设。');
  const hiddenText = skin.skin?.hideText || state === 'disabled' && !!skin.skin?.disabled;
  const textReason = skin.skin?.hideText ? '当前底图已设置“图片已含文字”，文字外观暂不可见。' : '未到达专用图片代替了节点文字。';
  const texts = state === 'disabled' ? [component.list?.flowLockedCaption ?? '未到达'] : node.parts ?? [node.name ?? ''];
  const slots = style.captionParts ?? [];
  const indices = texts.map((_, index) => flowCaptionSlotIndex(slots.length, texts.length, index) ?? -1);
  const visibleText = texts.some(text => !!text);

  if (property.kind === 'skin') {
    const source = property.state ? `${skin.source} · ${stateNames[skinStates(state).find(item => skin.skin?.[item] !== undefined) ?? 'idle']}图片` : skin.source;
    if (!applies) return outside(source);
    if (target.kind === 'base' && !skin.base) return no(source, `底图由${skin.source}整套覆盖，修改本图基础底图不影响它。`);
    if (property.state) {
      const chain = skinStates(state), position = chain.indexOf(property.state);
      if (position < 0) return no(source, `此图片不用于当前${stateNames[state]}状态。`);
      const overridden = chain.slice(0, position).find(item => skin.skin?.[item] !== undefined);
      if (overridden) return no(source, `当前${stateNames[state]}状态优先使用${stateNames[overridden]}图片。`);
    }
    // Creating a preset skin stops all type/base skin inheritance, not one field.
    if (target.kind === 'preset' && preset?.skin === undefined) return yes(source, '底图按整套覆盖；首次自定义会同时停止沿用本图底图。');
    return yes(source);
  }

  if (property.kind === 'caption') {
    const owner = preset?.style?.captionParts !== undefined ? presetSource(preset) : '本图基础外观';
    const part = slots[property.index];
    const source = part?.[property.key] !== undefined ? `${owner} · 第 ${property.index + 1} 段样式` : property.key === 'gap' ? '默认段间距' : property.key === 'color' ? sourceForColor(component, preset, look, colorKeys('textColor', state)!) : styleSource(component, preset, property.key);
    if (!applies) return outside(source);
    if (target.kind === 'base' && preset?.style?.captionParts !== undefined) return no(source, `分段样式由${presetSource(preset)}整套覆盖。`);
    if (hiddenText) return no(source, textReason);
    if (!Number.isInteger(property.index) || property.index < 0 || !part) return no(source, '当前尚未建立这个分段样式槽。');
    const matched = indices.flatMap((index, textIndex) => index === property.index ? [textIndex] : []);
    if (!matched.length) return no(source, '此样式槽没有对应当前节点的文字。');
    if (property.key === 'gap' && !matched.some(index => index < texts.length - 1)) return no(source, '此样式只对应末段，末段后没有间距。');
    if (!visibleText) return no(source, '当前状态没有显示文字。');
    return yes(source);
  }

  const key = property.key, chain = colorKeys(key, state);
  const source = chain ? sourceForColor(component, preset, look, chain) : styleSource(component, preset, key);
  if (!applies) return outside(source);
  if (key === 'opacity' && target.kind === 'base') return no(source, '本图不透明度作用于整张图，不是节点的不透明度。');
  if (key === 'playerOpacity') return no(source, '节点不跟随玩家对话框不透明度。');
  if (key === 'fontSize' && target.kind === 'base' && component.list?.layout !== 'flow' && !component.list?.rows && component.list?.itemHeight === undefined) return yes(source, '本图基础字号同时决定目录自动节点高度，即使节点文字另有字号也会影响布局。');
  if (target.kind === 'base' && preset?.style?.[key] !== undefined) return no(source, `此属性由${presetSource(preset)}单独设置。`);
  if (chain) {
    const position = chain.indexOf(key);
    if (position < 0) return no(source, `此属性不用于当前${stateNames[state]}状态。`);
    const overridden = chain.slice(0, position).find(item => style[item] !== undefined);
    if (overridden) return no(source, '当前状态使用优先级更高的状态颜色。');
  }

  const textKey = ['fontAssetId', 'fontSize', 'letterSpacing', 'align', 'captionParts', 'textColor', 'hoverTextColor', 'selectedTextColor', 'disabledTextColor', 'outlineWidth', 'outlineColor', 'outlineOpacity', 'shadowX', 'shadowY', 'shadowBlur', 'shadowSpread', 'shadowColor', 'shadowOpacity'].includes(key);
  if (textKey && hiddenText) return no(source, textReason);
  if (textKey && !visibleText) return no(source, '当前状态没有显示文字。');
  const partKey: keyof CaptionPart | undefined = key === 'fontAssetId' ? 'fontAssetId' : key === 'fontSize' ? 'fontSize' : key === 'letterSpacing' ? 'letterSpacing' : chain?.includes('textColor') ? 'color' : undefined;
  if (partKey && !indices.some((index, textIndex) => !!texts[textIndex] && slots[index]?.[partKey] === undefined)) {
    const owner = preset?.style?.captionParts !== undefined ? presetSource(preset) : '本图基础外观';
    return no(`${owner} · 分段文字样式`, '所有显示的文字都单独设置了此属性。');
  }
  if (chain && !chain.includes('textColor') && uiSkinAsset(skin.skin, state)) return no(skin.source, '当前状态使用底图，底色被图片遮住。');
  if (key === 'borderColor' && !(style.borderWidth ?? 0)) return no(source, '边框宽度为 0，边框颜色暂不可见。');
  if (key === 'outlineColor' || key === 'outlineOpacity') {
    if (!(style.outlineWidth ?? 0)) return no(source, '描边宽度为 0，描边外观暂不可见。');
  }
  if (key === 'outlineWidth' || key === 'outlineColor') {
    if (style.outlineOpacity === 0) return no(source, '描边不透明度为 0，描边暂不可见。');
  }
  if (key === 'shadowOpacity' || key === 'shadowColor') {
    if (!(style.shadowX || style.shadowY || style.shadowBlur || style.shadowSpread)) return no(source, '阴影偏移、柔化和扩展均为 0，阴影暂不可见。');
  }
  if (key.startsWith('shadow') && key !== 'shadowOpacity' && style.shadowOpacity === 0) return no(source, '阴影不透明度为 0，阴影暂不可见。');
  if (key === 'imageFit') return no(source, '节点底图缩放使用底图的缩放设置。');
  return yes(source, key === 'hoverTextColor' ? '悬停和按住共用这一文字色。' : undefined);
}

/**
 * Dependency analysis for one field, not a prediction for an arbitrary new value.
 * Only the supplied map nodes are highlighted; shared presets may also affect
 * their references in other maps. This function never writes project data.
 */
export function flowStyleImpact(project: Project, component: UiComponent, nodes: readonly FlowStyleImpactNode[], target: FlowStyleImpactTarget, property: FlowStyleProperty, state: UiButtonState = 'idle', referenceId?: string): FlowStyleImpact {
  const themed = { ...project, ui: uiComponentTheme(project, component) };
  const results = nodes.map(node => ({ node, reference: inspectNode(themed, component, node, target, property, state) }));
  const nodeIds = [...new Set(results.filter(item => item.reference.affected).map(item => item.node.id))];
  const reference = results.find(item => item.node.id === (referenceId ?? nodes[0]?.id))?.reference ?? { affected: false, source: '未选择节点', reason: '当前图没有可供查看的参考节点。' };
  return { nodeIds, label: nodeIds.length ? `当前图有 ${nodeIds.length} 个节点受影响` : '当前图没有节点受此属性影响', reference };
}
