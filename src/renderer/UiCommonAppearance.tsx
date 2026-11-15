import { RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Project, UiButtonState, UiComponent, UiSkin, VariableValue } from '../core/model';
import { uiComponentFontSize, uiFitNames } from '../core/ui';
import { uiComponentTheme } from '../core/ui-page-settings';
import { uiInspectorAppearanceStates, uiInspectorSkinApplies } from '../core/ui-inspector-appearance';
import { uiAssetBinding, uiBoundAssetId } from '../core/ui-asset-binding';
import { applyUiDesignProperty, readUiDesignProperty, resetUiDesignProperty, uiDesignPropertyApplies } from '../core/ui-design-properties';
import { uiProperties, type UiProperty } from '../core/ui-properties';
import { uiPropertyControlDesignSnapshot } from '../core/ui-property-control-snapshot';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { UiAssetSelect } from './AssetPicker';
import { UiPropertyGroup } from './UiPropertyGroup';
import { UiImageEffectsFields } from './UiImageEffectsFields';
import { UiInspectorOpacity } from './UiInspectorVisibility';
import { UiDesignColorField } from './UiDesignColorField';
import { UiComponentContent, uiComponentPreviewStyle } from './UiComponentVisual';
import type { AssetUrl } from './StageEditor';
import './ui-common-appearance.css';

export { UiDesignColorField } from './UiDesignColorField';

const stateLabels: Record<UiButtonState, string> = { idle: '普通', hover: '鼠标经过', pressed: '按住', selected: '开启', disabled: '不可用' };
const backgroundProperties: Record<UiButtonState, UiProperty> = { idle: 'background', hover: 'hoverBackground', pressed: 'pressedBackground', selected: 'selectedBackground', disabled: 'disabledBackground' };
const textProperties: Record<UiButtonState, UiProperty> = { idle: 'textColor', hover: 'hoverTextColor', pressed: 'hoverTextColor', selected: 'selectedTextColor', disabled: 'disabledTextColor' };
const imageProperties: Record<UiButtonState, UiProperty> = { idle: 'idleImage', hover: 'hoverImage', pressed: 'pressedImage', selected: 'selectedImage', disabled: 'disabledImage' };
const repeatedKinds: ReadonlySet<UiComponent['kind']> = new Set(['choiceList', 'saveSlots', 'historyList', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'pauseMenu']);
const textEffectProperties: readonly UiProperty[] = ['outlineWidth', 'outlineColor', 'outlineOpacity', 'shadowX', 'shadowY', 'shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowSpread'];
const imageEffectProperties: readonly UiProperty[] = ['imageCropX', 'imageCropY', 'imageCropWidth', 'imageCropHeight', 'imageFlipX', 'imageFlipY', 'imageTint'];

function skinSource(project: Project, component: UiComponent, state: UiButtonState) {
  const binding = uiAssetBinding(project, component);
  const skin = component.kind === 'image' ? { ...component.skin, idle: uiBoundAssetId(project, component, binding?.initial) } : component.skin;
  if (skin?.[state]) return { value: skin[state], source: state === 'idle' && component.kind === 'image' ? binding ? '来自图片参数' : '来自图片内容' : '本控件' };
  if ((state === 'pressed' || state === 'selected') && skin?.hover) return { value: skin.hover, source: '沿用鼠标经过图片' };
  if (state !== 'idle' && skin?.idle) return { value: skin.idle, source: '沿用普通图片' };
  return { value: undefined, source: '未设置图片' };
}

/** Common appearance fields share defaults and resets with the design adapter;
 * repeated/native controls expose only the surfaces their renderer consumes. */
export function UiCommonAppearance({ project, component, edit, assetUrl, state = 'idle', onStateChange, includeVisibility = true }: {
  project: Project; component: UiComponent; edit: (change: (component: UiComponent) => void, options?: { separate?: boolean }) => void; assetUrl: AssetUrl;
  state?: UiButtonState; onStateChange?: (state: UiButtonState) => void; includeVisibility?: boolean;
}) {
  const theme = uiComponentTheme(project, component), availableStates = uiInspectorAppearanceStates(project, component);
  const activeState = availableStates.includes(state) ? state : 'idle';
  const repeated = repeatedKinds.has(component.kind), skin = uiInspectorSkinApplies(project, component), hasBrightness = skin || component.kind === 'image';
  const textHidden = component.kind === 'button' && !!component.skin?.hideText;
  const hasText = uiDesignPropertyApplies(component, 'textColor', project);
  const hasFont = uiDesignPropertyApplies(component, 'font', project);
  const hasBorder = uiDesignPropertyApplies(component, 'borderWidth', project);
  const read = (property: UiProperty) => readUiDesignProperty(project, component, property);
  const write = (property: UiProperty, value: VariableValue) => edit(c => { applyUiDesignProperty(project, c, property, value); });
  const reset = (property: UiProperty) => edit(c => { if (!c.propertyControls?.[property]) resetUiDesignProperty(c, property); }, { separate: true });
  const supportedStateColor = !repeated && (component.kind === 'button' || component.kind === 'text' || component.kind === 'panel');
  const backgroundProperty = supportedStateColor ? backgroundProperties[activeState] : 'background';
  const textProperty = supportedStateColor ? textProperties[activeState] : 'textColor';
  const image = skinSource(project, component, activeState);
  const hasImageControl = !!component.propertyControls?.image || availableStates.some(key => !!component.propertyControls?.[imageProperties[key]]);
  const skinFit = component.skin?.fit ?? 'stretch';

  const propertyShell = (property: UiProperty, label: string, children: ReactNode, hint?: string) => {
    const value = read(property);
    if (!value.applies) return null;
    return <div className="ui-design-property" data-ui-design-field={property} key={property}>
      <div className="ui-design-property-control"><Field label={label} hint={hint} uiProperty={property}>{children}</Field>
        {value.canReset && !component.propertyControls?.[property] && <button type="button" className="ui-design-reset" aria-label={`恢复${label}`} title={`恢复${label}`} onClick={() => reset(property)}><RotateCcw size={12} aria-hidden="true" /></button>}
      </div><small className="ui-design-source" data-ui-design-source={property}>{value.source}</small>
    </div>;
  };
  const number = (property: UiProperty, label = uiProperties[property].name, factor = 1, hint?: string) => {
    const value = read(property), info = uiProperties[property];
    return propertyShell(property, label, <NumberInput aria-label={label} min={info.min === undefined ? undefined : info.min * factor} max={info.max === undefined ? undefined : info.max * factor} step={info.integer || factor === 100 ? 1 : .5}
      value={Number((Number(value.value) * factor).toFixed(2))} onChange={event => write(property, info.integer ? Math.round(Number(event.target.value) / factor) : Number(event.target.value) / factor)} />, hint);
  };
  const color = (property: UiProperty, label: string, extraSource?: string) => {
    const value = read(property);
    return value.applies ? <UiDesignColorField key={property} property={property} label={label} value={String(value.value)} source={extraSource ?? value.source}
      canReset={value.canReset} onReset={() => reset(property)} onChange={value => write(property, value)} /> : null;
  };
  const configuredSize = Number(read('fontSize').value), displayedSize = uiComponentFontSize(component, theme, project.width, project.height);
  const outlineEnabled = Number(read('outlineWidth').value) > 0;
  const shadowEnabled = (['shadowX', 'shadowY', 'shadowBlur', 'shadowSpread'] as const).some(key => Number(read(key).value) !== 0) && Number(read('shadowOpacity').value) > 0;
  const resetProperties: UiProperty[] = includeVisibility ? ['opacity'] : [];
  if (uiDesignPropertyApplies(component, 'background', project)) resetProperties.push('background');
  if (supportedStateColor && availableStates.length > 1) resetProperties.push('hoverBackground', 'pressedBackground', 'selectedBackground', 'disabledBackground');
  if (component.kind === 'progress') resetProperties.push('selectedBackground');
  if (hasText) resetProperties.push(...(['font', 'fontSize', 'textColor', 'align', ...textEffectProperties] as UiProperty[]).filter(property => uiDesignPropertyApplies(component, property, project)));
  if (supportedStateColor && hasText && availableStates.length > 1) resetProperties.push('hoverTextColor', 'selectedTextColor', 'disabledTextColor');
  if (hasBorder) resetProperties.push('borderWidth', 'borderColor', 'radius');
  const stateImages = skin && availableStates.some(key => (component.kind !== 'image' || key !== 'idle') && !component.propertyControls?.[imageProperties[key]] && component.skin?.[key] !== undefined);
  const stateBrightness = hasBrightness && availableStates.some(key => component.skin?.brightness?.[key] !== undefined);
  const canResetSkinFit = skin && component.kind !== 'image' && (component.skin?.fit !== undefined || component.skin?.borders !== undefined);
  const canResetGroup = resetProperties.some(property => !component.propertyControls?.[property] && read(property).canReset) || stateImages || stateBrightness || canResetSkinFit || component.kind === 'image' && imageEffectProperties.some(property => !component.propertyControls?.[property] && read(property).canReset) || includeVisibility && component.style?.playerOpacity !== undefined || component.kind === 'button' && component.skin?.hideText !== undefined;
  const groupHasControls = [...resetProperties, ...(component.kind === 'image' ? imageEffectProperties : []), ...(skin ? availableStates.map(key => imageProperties[key]) : [])].some(property => component.propertyControls?.[property]);

  return <div className="ui-common-appearance">
    {availableStates.length > 1 && <div className="ui-appearance-state"><Field label="预览状态" hint={repeated ? '预览列表条目在此状态下的样子。' : component.parentId && component.kind !== 'button' ? '此控件跟随父对象的交互状态。' : '只切换编辑预览，不会改变游戏里的按钮行为。'}>
      <select aria-label="外观预览状态" value={activeState} onChange={event => onStateChange?.(event.target.value as UiButtonState)}>{availableStates.map(value => <option value={value} key={value}>{stateLabels[value]}</option>)}</select>
    </Field></div>}
    <AppearancePreview project={project} component={component} state={activeState} assetUrl={assetUrl} repeated={repeated} />

    {skin && !(component.kind === 'image' && activeState === 'idle') && <div className="ui-design-property" data-ui-design-field={imageProperties[activeState]}>
      <div className="ui-design-property-control"><Field label={`${stateLabels[activeState]}图片`} uiProperty={imageProperties[activeState]}><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label={`${stateLabels[activeState]}图片`} value={component.skin?.[activeState]}
        empty={image.value && component.skin?.[activeState] === undefined ? image.source : activeState === 'idle' ? '使用背景颜色' : '沿用其他状态'} onChange={value => edit(c => {
          if (c.kind === 'button') applyUiDesignProperty(project, c, imageProperties[activeState], value ?? '');
          else if (value) c.skin = { ...c.skin, [activeState]: value };
          else if (c.skin) delete c.skin[activeState];
        })} /></Field>
        {component.skin?.[activeState] !== undefined && !component.propertyControls?.[imageProperties[activeState]] && <button type="button" className="ui-design-reset" aria-label={`恢复${stateLabels[activeState]}图片`} title={`恢复${stateLabels[activeState]}图片`} onClick={() => edit(c => { if (c.skin && !c.propertyControls?.[imageProperties[activeState]]) delete c.skin[activeState]; }, { separate: true })}><RotateCcw size={12} aria-hidden="true" /></button>}
      </div><small className="ui-design-source" data-ui-design-source={imageProperties[activeState]}>{image.source}{image.value && component.skin?.[activeState] === undefined ? ` · ${project.assets.find(asset => asset.id === image.value)?.name ?? '素材已移除'}` : ''}</small>
    </div>}
    {skin && component.kind === 'image' && activeState === 'idle' && <p className="ui-appearance-note">普通图片在「内容」中选择；这里调整图片效果和状态外观。</p>}
    {hasBrightness && (image.value || component.assetParameterId || hasImageControl || component.skin?.brightness?.[activeState] !== undefined) && <div className="ui-design-property" data-ui-design-field={`brightness.${activeState}`}>
      <div className="ui-design-property-control"><Field label="图片亮度 %"><NumberInput aria-label="图片亮度 %" min={0} max={100} step={1} value={Math.round((component.skin?.brightness?.[activeState] ?? 1) * 100)} onChange={event => edit(c => { c.skin = { ...c.skin, brightness: { ...c.skin?.brightness, [activeState]: Number(event.target.value) / 100 } }; })} /></Field>
        {component.skin?.brightness?.[activeState] !== undefined && <button type="button" className="ui-design-reset" aria-label="恢复图片亮度" title="恢复图片亮度" onClick={() => edit(c => { if (c.skin?.brightness) delete c.skin.brightness[activeState]; }, { separate: true })}><RotateCcw size={12} aria-hidden="true" /></button>}
      </div><small className="ui-design-source" data-ui-design-source={`brightness.${activeState}`}>{component.skin?.brightness?.[activeState] === undefined ? '原图亮度' : '本控件'}{activeState === 'disabled' && !component.skin?.disabled ? ' · 未指定不可用图片时，还会自动降低图片不透明度' : ''}</small>
    </div>}
    {uiDesignPropertyApplies(component, 'background', project) && <>
      {color(backgroundProperty, component.kind === 'progress' ? '轨道颜色' : repeated ? '条目普通背景颜色' : !supportedStateColor && activeState !== 'idle' ? '普通背景颜色' : '背景颜色')}
      {image.value && (component.kind === 'button' || repeated) && <p className="ui-appearance-note">使用图片时，背景颜色只在该状态没有可用图片时显示。</p>}
    </>}
    {component.kind === 'progress' && color('selectedBackground', '填充颜色')}
    {hasText && !textHidden && color(textProperty, !supportedStateColor && availableStates.length > 1 ? '共用文字颜色' : '文字颜色', activeState === 'pressed' && textProperty === 'hoverTextColor' ? `${read(textProperty).source} · 与鼠标经过共用文字颜色` : undefined)}
    {component.kind === 'button' && <Field label="图片已含文字" hint="开启后隐藏按钮文字，仍保留文字用作提示和辅助阅读。"><input aria-label="图片已含文字" type="checkbox" checked={component.skin?.hideText ?? false} onChange={event => edit(c => { c.skin = { ...c.skin, hideText: event.target.checked }; })} /></Field>}

    {skin && component.kind !== 'image' && <UiPropertyGroup id="appearance-skin-fit" title="图片缩放" summary={uiFitNames[skinFit]} searchKeywords="图片 缩放 拉伸 完整显示 裁切 九宫格 边距">
      <p className="ui-appearance-note">全部状态共用这组图片缩放设置。</p>
      <Field label="图片缩放方式"><select aria-label="图片缩放方式" value={skinFit} onChange={event => edit(c => { c.skin = { ...c.skin, fit: event.target.value as UiSkin['fit'] }; })}>{Object.entries(uiFitNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      {skinFit === 'nineSlice' && <><p className="ui-appearance-note">保持四角大小，拉伸边缘与中间。边距使用原图片像素。</p><div className="ui-appearance-columns">{(['left', 'top', 'right', 'bottom'] as const).map(edge => {
        const label = `${{ left: '左', top: '上', right: '右', bottom: '下' }[edge]}边距`;
        return <Field key={edge} label={label}><NumberInput aria-label={label} min={0} step={1} value={component.skin?.borders?.[edge] ?? 12} onChange={event => edit(c => { c.skin = { ...c.skin, borders: { left: 12, top: 12, right: 12, bottom: 12, ...c.skin?.borders, [edge]: Number(event.target.value) } }; })} /></Field>;
      })}</div></>}
      <button type="button" className="text-button" aria-label="恢复图片缩放" disabled={!canResetSkinFit} onClick={() => edit(c => { if (c.skin) { delete c.skin.fit; delete c.skin.borders; } }, { separate: true })}>恢复图片缩放</button>
    </UiPropertyGroup>}

    {hasText && <UiPropertyGroup id="appearance-text" title="文字" summary={textHidden ? '图片已含文字' : `${configuredSize}px`} searchKeywords="字体 字号 文字对齐 左对齐 居中 右对齐" defaultOpen>
      {textHidden ? <p className="ui-appearance-note">按钮已隐藏文字；关闭「图片已含文字」后可调整字体。</p> : <>
        {hasFont && propertyShell('font', '字体', <UiAssetSelect project={project} assetUrl={assetUrl} kind="font" label="字体" value={component.style?.fontAssetId} empty="沿用页面字体" onChange={value => write('font', value ?? '')} />)}
        {number('fontSize', '字号')}
        {['text', 'button', 'chapterTitle'].includes(component.kind) && displayedSize !== configuredSize && <p className="ui-appearance-note limit">{configuredSize < 12 ? `设置${configuredSize}，当前显示12；此控件的文字最小显示12。` : `设置${configuredSize}，当前显示${displayedSize}，受高度限制。增加控件高度可以显示更大的字。`}</p>}
        {propertyShell('align', '文字对齐', <select aria-label="文字对齐" value={String(read('align').value)} onChange={event => write('align', event.target.value)}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select>)}
        {repeated && <p className="ui-appearance-note">这是条目的默认文字；内部单独设置的文字继续使用自己的样式。</p>}
      </>}
    </UiPropertyGroup>}

    {hasBorder && <UiPropertyGroup id="appearance-frame" title="边框与圆角" summary={`${Number(read('borderWidth').value)}px · 圆角 ${Number(read('radius').value)}px`} searchKeywords="描边 边框颜色 边框宽度 圆角 半径">
      <div className="ui-appearance-columns">{number('borderWidth', '边框宽度')}{number('radius', '圆角半径')}</div>
      {Number(read('borderWidth').value) > 0 && color('borderColor', '边框颜色')}
      {Number(read('radius').value) > 0 && <p className="ui-appearance-note">圆角只作用于自身背景和图片；子控件及文字阴影保持原来的显示范围。</p>}
    </UiPropertyGroup>}

    {hasText && !textHidden && uiDesignPropertyApplies(component, 'outlineWidth', project) && <UiPropertyGroup id="appearance-text-effects" title="文字效果" summary={[outlineEnabled ? '描边' : '', shadowEnabled ? '阴影' : ''].filter(Boolean).join(' · ') || '未启用'} searchKeywords="描边 文字阴影 模糊 柔化 扩展 偏移">
      <Field label="文字描边"><input aria-label="文字描边" type="checkbox" checked={outlineEnabled} onChange={event => edit(c => { applyUiDesignProperty(project, c, 'outlineWidth', event.target.checked ? Math.max(1, c.style?.outlineWidth ?? 1) : 0); })} /></Field>
      {outlineEnabled && <>{number('outlineWidth', '描边宽度')}{color('outlineColor', '描边颜色')}{number('outlineOpacity', '描边不透明度 %', 100)}</>}
      <Field label="文字阴影"><input aria-label="文字阴影" type="checkbox" checked={shadowEnabled} onChange={event => edit(c => {
        applyUiDesignProperty(project, c, 'shadowOpacity', event.target.checked ? c.style?.shadowOpacity || .7 : 0);
        if (event.target.checked && !['shadowX', 'shadowY', 'shadowBlur', 'shadowSpread'].some(key => Number(c.style?.[key as keyof NonNullable<UiComponent['style']>] ?? 0) !== 0)) {
          applyUiDesignProperty(project, c, 'shadowY', 2); applyUiDesignProperty(project, c, 'shadowBlur', 4);
        }
      })} /></Field>
      {shadowEnabled && <>
        <div className="ui-appearance-columns">{number('shadowX', '阴影横向偏移')}{number('shadowY', '阴影纵向偏移')}</div>
        <div className="ui-appearance-columns">{number('shadowBlur', '阴影柔化')}{number('shadowSpread', '阴影扩展')}</div>
        {color('shadowColor', '阴影颜色')}{number('shadowOpacity', '阴影不透明度 %', 100)}
      </>}
      <button type="button" className="text-button" disabled={!textEffectProperties.some(property => !component.propertyControls?.[property] && read(property).canReset)} title={groupHasControls ? '只恢复未关联项；已关联项的原设计默认值保留。' : undefined} onClick={() => edit(c => { for (const property of textEffectProperties) if (!c.propertyControls?.[property] && uiDesignPropertyApplies(c, property, project)) resetUiDesignProperty(c, property); }, { separate: true })}>恢复文字效果</button>
    </UiPropertyGroup>}

    {component.kind === 'image' && <UiImageEffectsFields project={project} component={component} edit={edit} />}
    {includeVisibility && <UiInspectorOpacity project={project} component={component} edit={edit} />}
    {groupHasControls && <p className="ui-appearance-note">恢复本组外观只影响未关联项；已关联项的原设计默认值保留。</p>}
    <button type="button" className="text-button" aria-label="恢复本组外观" disabled={!canResetGroup} onClick={() => edit(c => {
      for (const property of resetProperties) if (!c.propertyControls?.[property]) resetUiDesignProperty(c, property);
      if (includeVisibility && c.style) delete c.style.playerOpacity;
      if (c.kind === 'image') for (const property of imageEffectProperties) if (!c.propertyControls?.[property]) resetUiDesignProperty(c, property);
      if (hasBrightness && c.skin?.brightness) for (const key of availableStates) delete c.skin.brightness[key];
      if (skin && c.skin) {
        for (const key of availableStates) {
          if ((c.kind !== 'image' || key !== 'idle') && !c.propertyControls?.[imageProperties[key]]) delete c.skin[key];
        }
        if (c.kind !== 'image') { delete c.skin.fit; delete c.skin.borders; }
        if (c.kind === 'button') delete c.skin.hideText;
      }
    }, { separate: true })}>恢复本组外观</button>
  </div>;
}

function AppearancePreview({ project, component, state, assetUrl, repeated }: { project: Project; component: UiComponent; state: UiButtonState; assetUrl: AssetUrl; repeated: boolean }) {
  // Media playback remains on the canvas; this compact sample never creates a
  // second decoder or Spine player while an author changes appearance values.
  if (component.kind === 'video' || component.kind === 'spine') return null;
  // These controls have several independently styled parts. Their real canvas
  // renderer is the preview; a generic button sample misrepresents their state.
  if (repeated || component.kind === 'preference' || component.kind === 'preferenceChoice') return null;
  const { component: previewComponent, values } = uiPropertyControlDesignSnapshot(project, component);
  const enabledState = values.enabled === false ? 'disabled' : values.enabled === true && state === 'disabled' ? 'idle' : state;
  const previewState = enabledState === 'disabled' ? 'disabled' : values.selected === true ? 'selected' : values.selected === false && enabledState === 'selected' ? 'idle' : enabledState;
  const width = Math.max(1, previewComponent.width * project.width), height = Math.max(1, previewComponent.height * project.height);
  const scale = Math.min(1, 220 / width, 110 / height);
  return <div className="ui-appearance-preview" data-ui-appearance-preview data-preview-state={previewState} style={{ minHeight: Math.max(74, height * scale + 20) }}>
    <div className={`ui-component ${previewComponent.kind}`} style={uiComponentPreviewStyle(project, previewComponent, scale, previewState)}>
      <UiComponentContent project={project} component={previewComponent} assetUrl={assetUrl} state={previewState} scale={scale} bindings={{ speaker: '角色姓名', dialogue: '这一句台词的文字预览。', tooltip: '提示文字预览', chapterTitle: '章节标题' }} />
    </div><span className="ui-appearance-preview-label">{stateLabels[previewState]}外观</span>
  </div>;
}
