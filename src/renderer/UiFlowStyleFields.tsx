import { useState } from 'react';
import type { Project, UiButtonState, UiComponent, UiSkin } from '../core/model';
import { uiComponentTheme } from '../core/ui-page-settings';
import { uiFitNames, uiTextColor, uiStateColor, uiSkinAsset } from '../core/ui';
import { softTextBackdrop } from '../core/ui-text-effects';
import { flowNodeAppearance } from '../core/flow-style';
import { flowStyleGroups, flowTextBackdropMode, flowTextBackdropOpacity, hasFlowNodeAppearance, hasFlowStyleGroup, resetFlowNodeAppearance, resetFlowStyleGroup, setFlowBackdropOpacity, type FlowStyleGroup, type FlowStyleProperty } from '../core/flow-style-editing';
import { Field } from './components';
import { UiAssetSelect } from './AssetPicker';
import { NumberInput } from './NumberInput';
import { FlowCaptionParts, uiFlowCaptionSearchLabels } from './FlowCaptionParts';
import { FlowStyleField } from './FlowStyleField';
import { UiDesignColorField } from './UiDesignColorField';
import { UiPropertyGroup } from './UiPropertyGroup';
import type { FlowCaptionNode } from './UiFlowNodePreview';
import type { AssetUrl } from './StageEditor';
import './flow-style-fields.css';

export const flowStateNames: Record<UiButtonState, string> = { idle: '普通', hover: '悬停', pressed: '按住', selected: '当前位置', disabled: '未到达' };
type Style = NonNullable<UiComponent['style']>;
export interface FlowLook { style?: Style; skin?: UiSkin }

const withStylePrefixes = (labels: readonly string[]) => labels.flatMap(label => [label, `基础${label}`, `预设${label}`]);
const baseTextSearchLabels = [
  ...withStylePrefixes(['字体', '字号 px', '字间距 px', '文字对齐', '文字色']), '字间距', '段内字间距', '整组基础文字', '整组基础字间距', '整组文字对齐', '左对齐', '居中', '右对齐',
  '恢复基础字间距：0 px', '恢复本图基础字间距', '恢复预设字间距',
  '悬停 / 按住文字色', '恢复本组基础文字', ...Object.values(flowStateNames).map(name => `${name}文字色`),
];
const shadowSearchLabels = [
  '文字黑底', '文字黑底 / 阴影', '文字描边与阴影', '柔边黑底', '自定义阴影', '无', ...withStylePrefixes(['文字黑底方式', '使用柔边黑底']),
  '黑底方式', '关闭阴影', '恢复基础阴影', '黑底厚度 px', '黑底柔和度 px', '黑底不透明度 %',
  ...withStylePrefixes(['阴影水平偏移 px', '阴影垂直偏移 px', '阴影柔化 px', '阴影扩展 px', '阴影颜色', '阴影不透明度 %']),
  '恢复本组文字黑底与阴影', '恢复本图基础文字黑底与阴影', '恢复系统默认：无', '恢复黑底颜色与不透明度',
];
const skinSearchLabels = [
  '节点底图', '节点底图与底色', ...withStylePrefixes(['图片亮度 %', '背景缩放']), '九宫格', '左边距 px', '上边距 px', '右边距 px', '下边距 px',
  '图片已含文字', '恢复基础底图', '清除节点底图', '清除本图节点底图', '整套底图改用本图或剧情类型设置', '恢复所有状态底色',
  ...Object.values(flowStateNames).flatMap(name => [...withStylePrefixes([`${name}图片`]), `${name}底色`]),
];
const frameSearchLabels = ['边框与圆角', '边框宽度 px', '边框颜色', '圆角 px', '节点不透明度 %', '恢复本组边框与圆角'];
const outlineSearchLabels = ['文字描边', '文字描边与阴影', '描边宽度 px', '描边颜色', '描边不透明度 %', '恢复本组文字描边'];

export const uiFlowStyleSearchLabels: readonly string[] = [
  '编辑与预览状态', '基础外观状态', '预设外观状态', '文字颜色', '基础底色', '预设底色',
  ...uiFlowCaptionSearchLabels, ...baseTextSearchLabels, ...shadowSearchLabels, ...skinSearchLabels, ...frameSearchLabels, ...outlineSearchLabels,
  '恢复全部节点外观', '恢复全部基础文字与颜色', '恢复页面默认文字与颜色',
];

/** Shared editor for the map's base look and an explicitly selected shared style. */
export function UiFlowStyleFields({ project, component, value, effective, edit, assetUrl, state, onStateChange, shared = false, node, selectedPart, onSelectPart, onFocusProperty, showStateControl = true }: {
  project: Project; component: UiComponent; value: FlowLook; effective: UiComponent;
  edit: (change: (value: FlowLook) => void, options?: { separate?: boolean }) => void;
  assetUrl: AssetUrl; state: UiButtonState; onStateChange: (state: UiButtonState) => void; shared?: boolean;
  node?: FlowCaptionNode; selectedPart?: number; onSelectPart?: (textIndex: number) => void;
  onFocusProperty?: (property: FlowStyleProperty) => void; showStateControl?: boolean;
}) {
  const theme = uiComponentTheme(project, component);
  const style = effective.style, prefix = shared ? '预设' : '基础';
  const scope = `${project.id}/${project.ui.activeInstanceId ?? 'base'}/${component.page}/${component.id}/${shared ? `preset/${'id' in value ? String(value.id) : node?.styleId ?? 'current'}` : 'base'}`;
  const groupPrefix = `flow-${shared ? 'preset' : 'base'}`;
  const [customShadowScope, setCustomShadowScope] = useState<string>();
  const setStyle = <K extends keyof Style>(key: K, next: Style[K], options?: { separate?: boolean }) => edit(target => {
    target.style ??= {};
    if (next === undefined) delete target.style[key]; else target.style[key] = next;
    if (!Object.keys(target.style).length) delete target.style;
  }, options);
  const colorKey = state === 'disabled' ? 'disabledTextColor' : state === 'selected' ? 'selectedTextColor' : state === 'hover' || state === 'pressed' ? 'hoverTextColor' : 'textColor';
  const backgroundKey = state === 'idle' ? 'background' : `${state}Background` as const;
  const colorLabel = state === 'hover' || state === 'pressed' ? '悬停 / 按住文字色' : `${flowStateNames[state]}文字色`;
  const skin = value.skin ?? effective.skin;
  const base = { fontAssetId: style?.fontAssetId ?? theme.fontAssetId, fontSize: style?.fontSize ?? theme.fontSize, textColor: uiTextColor(effective, theme, state), letterSpacing: style?.letterSpacing ?? 0 };
  const fontName = project.assets.find(asset => asset.id === base.fontAssetId)?.name ?? (base.fontAssetId ? '字体未找到' : '界面默认');
  const inheritedText = shared ? '本图基础文字' : '页面文字';
  const styleSource = (key: keyof Style): string => {
    if (value.style?.[key] !== undefined) return key === 'letterSpacing' ? shared ? '此预设字间距单独设置' : '本图基础字间距' : shared ? '此预设单独设置' : '本图基础外观';
    if (shared && component.style?.[key] !== undefined) return key === 'letterSpacing' ? `沿用本图基础字间距：${component.style.letterSpacing} px` : '沿用本图基础外观';
    if (key === 'letterSpacing') return '默认字间距：0 px';
    if (['fontAssetId', 'fontSize', 'textColor'].includes(key)) return '沿用页面文字';
    if (key.endsWith('TextColor')) return `${styleSource('textColor')} · 普通文字色`;
    if ((key === 'pressedBackground' || key === 'selectedBackground') && style?.hoverBackground !== undefined) return `${styleSource('hoverBackground')} · 悬停底色`;
    if (key === 'hoverBackground' && style?.background !== undefined) return `${styleSource('background')} · 普通底色`;
    return '系统默认值';
  };
  const field = (key: keyof Style) => ({
    scope: `${scope}/${key}`, source: styleSource(key), canReset: value.style?.[key] !== undefined,
    onReset: () => setStyle(key, undefined, { separate: true }),
    resetLabel: key === 'letterSpacing' ? shared ? '恢复本图基础字间距' : '恢复默认字间距：0 px' : shared ? '恢复本图基础设置' : '恢复页面 / 系统默认值',
    onFocus: () => onFocusProperty?.({ kind: 'style', key }),
  });
  const resetGroup = (group: FlowStyleGroup, label: string) => hasFlowStyleGroup(value.style, group) && <button type="button" className="text-button flow-style-section-reset" onClick={() => {
    if (group === 'shadow') setCustomShadowScope(undefined);
    edit(target => resetFlowStyleGroup(target, group), { separate: true });
  }}>{label}</button>;
  const numeric = (key: keyof Pick<Style, 'fontSize' | 'borderWidth' | 'radius' | 'outlineWidth' | 'shadowX' | 'shadowY' | 'shadowBlur' | 'shadowSpread'>, label: string, fallback = 0, min?: number, step = .5) => <FlowStyleField key={key} label={label} {...field(key)}><NumberInput aria-label={`${shared ? '预设' : ''}${label.replace(/ px$/, '')}`} min={min} step={step} value={style?.[key] ?? fallback} onChange={event => {
    const next = event.target.valueAsNumber;
    if (key !== 'fontSize' || Number.isInteger(next)) setStyle(key, next);
  }} /></FlowStyleField>;
  const color = (key: keyof Pick<Style, 'textColor' | 'hoverTextColor' | 'selectedTextColor' | 'disabledTextColor' | 'background' | 'hoverBackground' | 'pressedBackground' | 'selectedBackground' | 'disabledBackground' | 'borderColor' | 'outlineColor' | 'shadowColor'>, label: string, resolved: string) => <FlowStyleField label={label} {...field(key)} raw><UiDesignColorField label={label} value={resolved} onChange={next => setStyle(key, next)} /></FlowStyleField>;
  const setSkin = (change: (skin: UiSkin) => void, separate = false) => edit(target => { const next = { ...skin }; change(next); target.skin = next; }, { separate });
  const skinSource = value.skin !== undefined ? shared ? '此预设整套底图' : '本图节点底图' : shared ? '沿用本图或剧情类型的整套底图' : '系统默认底图';
  const skinField = (key: string, reset: (skin: UiSkin) => void, canReset: boolean, imageState?: UiButtonState) => ({
    scope: `${scope}/skin/${key}`, source: skinSource, canReset,
    onReset: () => setSkin(reset, true), resetLabel: value.skin === undefined ? '单独设置底图并恢复此项默认值' : '恢复此项默认值',
    onFocus: () => onFocusProperty?.({ kind: 'skin', ...(imageState ? { state: imageState } : {}) }),
  });
  const fallbackSkin = { ...skin }; delete fallbackSkin[state];
  const fallbackImage = uiSkinAsset(fallbackSkin, state);
  const fallbackImageState = (state === 'pressed' || state === 'selected') && skin?.hover ? '悬停' : '普通';
  const imageEmpty = fallbackImage ? `沿用${fallbackImageState}图片：${project.assets.find(asset => asset.id === fallbackImage)?.name ?? '图片未找到'}` : '使用当前状态底色';
  const texts = state === 'disabled' ? [component.list?.flowLockedCaption ?? '未到达'] : node ? node.parts ?? [node.name] : undefined;
  const actualSkin = node ? flowNodeAppearance(project, component, node).skin : skin;
  const hiddenMessage = actualSkin?.hideText ? '当前节点启用了“图片已含文字”，文字与黑底不会显示。可在节点底图中关闭。'
    : state === 'disabled' && actualSkin?.disabled ? '未到达专用图片会替代文字，当前看不到文字与黑底；切换到普通状态可查看。' : undefined;
  const actualBackdrop = flowTextBackdropMode(style), backdrop = customShadowScope === scope ? 'custom' : actualBackdrop;
  const shadowPercent = Number((flowTextBackdropOpacity(style) * 100).toFixed(2));
  return <div className="flow-style-fields" data-flow-style-scope={shared ? 'preset' : 'base'}>
    {showStateControl && <Field label="编辑与预览状态"><select aria-label={`${prefix}外观状态`} value={state} onChange={event => onStateChange(event.target.value as UiButtonState)}>{Object.entries(flowStateNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>}
    {hiddenMessage && <p className="flow-style-notice">{hiddenMessage}</p>}
    <UiPropertyGroup id={`${groupPrefix}-caption-parts`} title="文字" defaultOpen searchKeywords={[...uiFlowCaptionSearchLabels, ...texts ?? []]}>
      <FlowCaptionParts key={`${scope}/${node?.id ?? 'sample'}/${state === 'disabled' ? 'locked' : 'read'}`} project={project} assetUrl={assetUrl} base={base} prefix={shared ? '预设' : ''} parts={style?.captionParts} texts={texts} selectedPart={selectedPart} onSelectPart={onSelectPart} onFocusProperty={onFocusProperty} scope={`${scope}/${node?.id ?? 'sample'}/${state}`} inherited={shared && value.style?.captionParts === undefined && style?.captionParts !== undefined} onChange={(parts, options) => setStyle('captionParts', parts, options)} />
      {resetGroup('caption', shared ? '整套分段改用本图设置' : '清除本图分段样式，改用整组基础文字')}
    </UiPropertyGroup>
    <UiPropertyGroup id={`${groupPrefix}-text-effects`} title="文字黑底 / 阴影" defaultOpen summary={{ none: '无', soft: '柔边黑底', custom: '自定义阴影' }[actualBackdrop]} searchKeywords={shadowSearchLabels}>
      <FlowStyleField label="黑底方式" scope={`${scope}/shadow-mode`} source={flowStyleGroups.shadow.some(key => value.style?.[key] !== undefined) ? shared ? '此预设单独设置' : '本图基础外观' : shared ? '沿用本图基础阴影' : '系统默认：无'} canReset={hasFlowStyleGroup(value.style, 'shadow')} onReset={() => { setCustomShadowScope(undefined); edit(target => resetFlowStyleGroup(target, 'shadow'), { separate: true }); }} resetLabel={shared ? '恢复本图基础文字黑底与阴影' : '恢复系统默认：无'} onFocus={() => onFocusProperty?.({ kind: 'style', key: 'shadowOpacity' })} className="flow-style-shadow-mode">
        <select aria-label={`${prefix}文字黑底方式`} value={backdrop} onChange={event => {
          const next = event.target.value;
          setCustomShadowScope(next === 'custom' ? scope : undefined);
          if (next === 'none') setStyle('shadowOpacity', 0, { separate: true });
          if (next === 'soft' && actualBackdrop !== 'soft') edit(target => { target.style = { ...target.style, ...softTextBackdrop }; }, { separate: true });
        }}><option value="none">无</option><option value="soft">柔边黑底</option><option value="custom">自定义阴影</option></select>
      </FlowStyleField>
      {backdrop === 'soft' && <>
        {numeric('shadowSpread', '黑底厚度 px', 0, 0)}
        {numeric('shadowBlur', '黑底柔和度 px', 0, 0)}
        <FlowStyleField label="黑底不透明度 %" {...field('shadowOpacity')} source={`${styleSource('shadowOpacity')}；含颜色本身的不透明度`} canReset={value.style?.shadowOpacity !== undefined || value.style?.shadowColor !== undefined} resetLabel="恢复黑底颜色与不透明度" onReset={() => edit(target => { if (target.style) { delete target.style.shadowOpacity; delete target.style.shadowColor; } }, { separate: true })}>
          <NumberInput aria-label={`${prefix}黑底不透明度`} min={0} max={100} step={1} value={shadowPercent} onChange={event => edit(target => setFlowBackdropOpacity(target, style, event.target.valueAsNumber / 100))} />
        </FlowStyleField>
      </>}
      {backdrop === 'custom' && <>
        {numeric('shadowX', '阴影水平偏移 px')}{numeric('shadowY', '阴影垂直偏移 px')}
        {numeric('shadowBlur', '阴影柔化 px', 0, 0)}{numeric('shadowSpread', '阴影扩展 px', 0, 0)}
        {color('shadowColor', '阴影颜色', style?.shadowColor ?? '#000000')}
        <FlowStyleField label="阴影不透明度 %" {...field('shadowOpacity')}><NumberInput aria-label={`${prefix}阴影不透明度`} min={0} max={100} step={1} value={Number(((style?.shadowOpacity ?? .7) * 100).toFixed(2))} onChange={event => setStyle('shadowOpacity', event.target.valueAsNumber / 100)} /></FlowStyleField>
        {style?.shadowColor?.length === 9 && <small className="flow-style-note">叠加颜色透明度后，实际不透明度为 {shadowPercent}%。</small>}
        {actualBackdrop === 'none' && <small className="flow-style-note">当前阴影未显示；不透明度和厚度、柔化或偏移需要大于零。</small>}
      </>}
      {backdrop === 'none' && <small className="flow-style-note">黑底位于文字背后；选择“柔边黑底”后可调整厚度、柔和度和不透明度。</small>}
      {resetGroup('shadow', '恢复本组文字黑底与阴影')}
    </UiPropertyGroup>
    <UiPropertyGroup id={`${groupPrefix}-base-text`} title="整组基础文字" summary={`${fontName} · ${base.fontSize} px`} searchKeywords={baseTextSearchLabels}>
      <FlowStyleField label={`${prefix}字体`} {...field('fontAssetId')}><UiAssetSelect project={project} assetUrl={assetUrl} kind="font" label={`${prefix}字体`} value={value.style?.fontAssetId} empty={`${inheritedText}：${fontName}`} onChange={font => setStyle('fontAssetId', font)} /></FlowStyleField>
      <FlowStyleField label={`${prefix}字号 px`} {...field('fontSize')}><NumberInput aria-label={`${prefix}字号`} min={1} step={1} value={base.fontSize} onChange={event => { if (Number.isInteger(event.target.valueAsNumber)) setStyle('fontSize', event.target.valueAsNumber); }} /></FlowStyleField>
      <FlowStyleField label={`${prefix}字间距 px`} {...field('letterSpacing')}><NumberInput aria-label={`${prefix}字间距`} step={0.1} value={base.letterSpacing} onChange={event => setStyle('letterSpacing', event.target.valueAsNumber)} /></FlowStyleField>
      <FlowStyleField label="整组文字对齐" {...field('align')}><select aria-label={`${prefix}文字对齐`} value={style?.align ?? 'center'} onChange={event => setStyle('align', event.target.value as Style['align'])}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></FlowStyleField>
      {color(colorKey, colorLabel, base.textColor)}
      {style?.captionParts?.some(part => part.fontAssetId !== undefined || part.fontSize !== undefined || part.color !== undefined || part.letterSpacing !== undefined) && <small className="flow-style-note">分段里已指定的字体、字号、颜色或字间距优先生效。字间距调整段内字符距离，与下一段间距独立；选择上方实际文字可编辑分段值。</small>}
      {resetGroup('text', '恢复本组基础文字')}
    </UiPropertyGroup>
    <UiPropertyGroup id={`${groupPrefix}-skin`} title="节点底图与底色" searchKeywords={skinSearchLabels}>
      <FlowStyleField label={`${flowStateNames[state]}图片`} {...skinField(state, next => { delete next[state]; }, skin?.[state] !== undefined, state)}><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label={`${prefix}${flowStateNames[state]}图片`} value={skin?.[state]} empty={imageEmpty} onChange={assetId => setSkin(next => { if (assetId === undefined) delete next[state]; else next[state] = assetId; })} /></FlowStyleField>
      {(state === 'pressed' || state === 'selected') && !skin?.[state] && <small className="flow-style-note">未指定图片时，依次使用悬停图片、普通图片。</small>}
      {state === 'disabled' && skin?.disabled && <small className="flow-style-note">未到达专用图片会替代节点文字。</small>}
      {shared && value.skin === undefined && <small className="flow-style-note">底图按整套沿用。修改后，此预设会单独保存各状态图片、缩放与文字显示设置。</small>}
      <FlowStyleField label="图片亮度 %" {...skinField(`brightness/${state}`, next => { next.brightness = { ...next.brightness }; delete next.brightness[state]; }, skin?.brightness?.[state] !== undefined)}><NumberInput aria-label={`${prefix}图片亮度`} min={0} max={100} step={1} value={Number(((skin?.brightness?.[state] ?? 1) * 100).toFixed(2))} onChange={event => setSkin(next => { next.brightness = { ...next.brightness, [state]: event.target.valueAsNumber / 100 }; })} /></FlowStyleField>
      <FlowStyleField label="背景缩放" {...skinField('fit', next => { delete next.fit; }, skin?.fit !== undefined)}><select aria-label={`${prefix}背景缩放`} value={skin?.fit ?? 'stretch'} onChange={event => setSkin(next => { next.fit = event.target.value as UiSkin['fit']; })}>{Object.entries(uiFitNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></FlowStyleField>
      {skin?.fit === 'nineSlice' && (['left', 'top', 'right', 'bottom'] as const).map(edge => <FlowStyleField key={edge} label={`${{ left: '左', top: '上', right: '右', bottom: '下' }[edge]}边距 px`} {...skinField(`borders/${edge}`, next => { next.borders = { left: 12, top: 12, right: 12, bottom: 12, ...next.borders, [edge]: 12 }; }, skin.borders?.[edge] !== undefined && skin.borders[edge] !== 12)}><NumberInput min={0} step={1} value={skin.borders?.[edge] ?? 12} onChange={event => setSkin(next => { next.borders = { left: 12, top: 12, right: 12, bottom: 12, ...next.borders, [edge]: event.target.valueAsNumber }; })} /></FlowStyleField>)}
      <FlowStyleField label="图片已含文字" {...skinField('hideText', next => { delete next.hideText; }, skin?.hideText !== undefined)}><input type="checkbox" checked={skin?.hideText ?? false} onChange={event => setSkin(next => { next.hideText = event.target.checked; })} /></FlowStyleField>
      {value.skin !== undefined && <button type="button" className="text-button flow-style-section-reset" onClick={() => edit(target => { delete target.skin; }, { separate: true })}>{shared ? '整套底图改用本图或剧情类型设置' : '清除本图节点底图'}</button>}
      {color(backgroundKey, `${flowStateNames[state]}底色`, uiStateColor(effective, state, theme.accent))}
      {resetGroup('background', '恢复所有状态底色')}
    </UiPropertyGroup>
    <UiPropertyGroup id={`${groupPrefix}-frame`} title="边框与圆角" searchKeywords={frameSearchLabels}>
      {numeric('borderWidth', '边框宽度 px', 0, 0)}
      {color('borderColor', '边框颜色', style?.borderColor ?? theme.accent)}
      {numeric('radius', '圆角 px', 0, 0)}
      {shared && <FlowStyleField label="节点不透明度 %" {...field('opacity')} source={value.style?.opacity !== undefined ? '此预设节点不透明度' : '节点默认不透明度：100%'} resetLabel="恢复节点不透明度 100%"><NumberInput min={0} max={100} step={1} value={Number(((style?.opacity ?? 1) * 100).toFixed(2))} onChange={event => setStyle('opacity', event.target.valueAsNumber / 100)} /></FlowStyleField>}
      {resetGroup('frame', '恢复本组边框与圆角')}
    </UiPropertyGroup>
    <UiPropertyGroup id={`${groupPrefix}-outline`} title="文字描边" searchKeywords={outlineSearchLabels}>
      {numeric('outlineWidth', '描边宽度 px', 0, 0)}
      {color('outlineColor', '描边颜色', style?.outlineColor ?? '#000000')}
      <FlowStyleField label="描边不透明度 %" {...field('outlineOpacity')}><NumberInput min={0} max={100} step={1} value={Number(((style?.outlineOpacity ?? 1) * 100).toFixed(2))} onChange={event => setStyle('outlineOpacity', event.target.valueAsNumber / 100)} /></FlowStyleField>
      {resetGroup('outline', '恢复本组文字描边')}
    </UiPropertyGroup>
    {hasFlowNodeAppearance(value, shared) && <button type="button" className="text-button flow-style-section-reset" title={shared ? '恢复此预设的全部节点文字、黑底、底图、底色、边框与不透明度；保留预设名称和引用。' : '恢复本图基础节点外观；整张图的位置、大小与不透明度不变。'} onClick={() => { setCustomShadowScope(undefined); edit(target => resetFlowNodeAppearance(target, shared), { separate: true }); }}>恢复全部节点外观</button>}
  </div>;
}
