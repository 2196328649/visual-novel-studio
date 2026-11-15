import { uiComponentTheme } from '../core/ui-page-settings';
import { UiControlRangeFields } from './UiControlRangeFields';
import { uiControlDefinition, uiControlEffectiveValue, uiControlPrimaryProperty, uiControlRatio } from '../core/ui-control-properties';
import { changeUiControlBinding, uiControlBindingName, uiControlKindName } from '../core/ui-control-authoring';
import { uiPropertyDefault } from '../core/ui-properties';
import { uiPropertyControlFor } from '../core/ui-property-control';
import { parameterSets } from '../core/parameter-sets';
import { NumberInput } from './NumberInput';
import { useEffect, useState, type CSSProperties } from 'react';
import type { Project, UiButtonState, UiComponent, VariableValue } from '../core/model';
import { formatNumber, playerPreferenceKeys, playerPreferenceOptions, playerPreferences, preferenceInfo, sliderPreferences, type PlayerPreference } from '../core/preferences';
import { uiStateNames } from '../core/ui';
import { Field } from './components';
import { UiAssetSelect, UiSkinImage } from './UiAppearance';
import { UiDesignColorField } from './UiDesignColorField';
import { UiPropertyGroup } from './UiPropertyGroup';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import './ui-control-authoring.css';

type EditComponent = (change: (component: UiComponent) => void, options?: { separate?: boolean }) => void;

export function PreferenceValueInput({ project, preference, value, onChange, label = '设置值' }: {
  project?: Project; preference: PlayerPreference; value?: VariableValue; onChange: (value: VariableValue) => void; label?: string;
}) {
  const info = playerPreferences[preference];
  const current = value ?? preferenceInfo(project, preference).initial;
  if (info.type !== 'number') return <select aria-label={label} value={String(current)} onChange={event => onChange(info.type === 'boolean' ? event.target.value === 'true' : event.target.value)}>
    {playerPreferenceOptions(preference, project).map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
  </select>;
  return <NumberInput aria-label={label} type="number" step={info.step} value={Number(current)} onChange={event => {
    const next = event.target.valueAsNumber;
    // Only the engine's limits apply here: blueprints and buttons may go beyond the player's slider.
    if (Number.isFinite(next)) onChange(Math.min(info.limit?.max ?? Infinity, Math.max(info.limit?.min ?? -Infinity, next)));
  }} />;
}

export function UiPreferenceFields({ project, component, edit, assetUrl, section = 'all', onParameter }: {
  project: Project; component: UiComponent; edit: EditComponent; assetUrl: AssetUrl;
  section?: 'content' | 'appearance' | 'interaction' | 'all'; onParameter?: (id: string) => void;
}) {
  const settingAction = component.action === 'setPlayerPreference';
  if (!['preference', 'preferenceChoice'].includes(component.kind) && !settingAction) return null;
  const content = section === 'all' || section === 'content', appearance = section === 'all' || section === 'appearance', interaction = section === 'all' || section === 'interaction';
  const bindingVisible = settingAction ? interaction : content;
  const preference = component.preference;
  const info = preference && playerPreferences[preference] ? preferenceInfo(project, preference) : undefined;
  const bound = project.variables.find(variable => variable.id === component.parameterId), control = uiControlDefinition(project, component);
  const currentProperty = control && uiControlPrimaryProperty(control);
  const currentControl = currentProperty && uiPropertyControlFor(project, component, currentProperty);
  const options = component.selector?.options ?? (preference && info ? playerPreferenceOptions(preference, project) : []);
  const nativeChoice = !!control?.choice && !component.parameterId;
  const builtins = settingAction || ['preferences', 'voiceSettings'].includes(component.page) ? component.kind === 'preference' ? sliderPreferences : playerPreferenceKeys : [];
  const bindingValue = component.parameterId ? 'parameter:' + component.parameterId : preference ?? '';
  const badParameter = !!component.parameterId && (!bound || bound.type === 'asset' || settingAction);
  const setOptions = (next: typeof options, separate = false) => edit(target => { target.selector = { ...target.selector, options: next }; }, { separate });
  return <>
    {bindingVisible && <>
      <Field label={currentControl ? '默认设置或参数' : '绑定设置或参数'} hint={currentControl ? '决定控件类型和默认范围；当前值使用下方单独指定的参数。' : undefined}><select aria-label="玩家设置" value={bindingValue} onChange={event => edit(target => changeUiControlBinding(project, target, event.target.value), { separate: true })}>
        <option value="" disabled>选择设置或参数</option>
        {badParameter && <option value={bindingValue} disabled>{uiControlBindingName(project, component)}{settingAction && bound ? '（此动作只支持内置设置）' : ''}</option>}
        {!!preference && !component.parameterId && !builtins.includes(preference) && <option value={preference} disabled>{info?.name ?? '设置已失效'}（不适用于当前控件）</option>}
        {!!builtins.length && <optgroup label="内置游戏设置">{builtins.map(key => <option key={key} value={key}>{preferenceInfo(project, key).name}</option>)}</optgroup>}
        {!settingAction && parameterSets(project).map(set => <optgroup key={set.id} label={set.name}>{project.variables.filter(variable => variable.type !== 'asset' && (variable.parameterSetId ?? 'parameters_story') === set.id).map(variable => <option key={variable.id} value={'parameter:' + variable.id}>{variable.name}</option>)}</optgroup>)}
      </select></Field>
      {!settingAction && <p className="ui-control-binding-summary" role={!control ? 'status' : undefined}>{control ? <strong>{uiControlKindName(project, component)}</strong> : '绑定失效；请重新选择来源。'}</p>}
      {!settingAction && control && <Field label="当前值" uiProperty={currentProperty} hint="默认读取上方的设置或参数；右键可指定单向跟随或双向同步。"><span>初始值：{typeof control.initial === 'boolean' ? control.initial ? '开启' : '关闭' : typeof control.initial === 'number' ? formatNumber(control.initial, info) : String(control.initial) || '空文字'}</span></Field>}
      {bound && !badParameter && <div className="ui-control-source"><span className="muted ui-field-help">{currentControl ? `默认来源${control?.choice ? '和选项' : ''}已保留；恢复当前值的默认设置后，继续读写此参数。` : `初始值${control?.choice ? '和选项' : ''}来自参数集，修改控件会读写同一参数。`}</span>{onParameter && <button type="button" className="text-button" onClick={() => onParameter(bound.id)}>{currentControl ? '查看默认来源参数' : '在参数集中查看'}</button>}</div>}
      {!component.parameterId && preference === 'characterVolume' && <Field label="配音角色" hint="留空时调节旁白及未指定角色的配音。"><select aria-label="配音角色" value={component.preferenceCharacterId ?? ''} onChange={event => edit(target => { target.preferenceCharacterId = event.target.value || undefined; })}>
        <option value="">旁白及其他</option>{component.preferenceCharacterId && !project.characters.some(character => character.id === component.preferenceCharacterId) && <option value={component.preferenceCharacterId} disabled>角色已删除</option>}{project.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
      </select></Field>}
      {settingAction && preference && info && !component.parameterId && <Field label="设置值" hint={preference === 'textSpeed' ? '0 表示立即显示全部文字。' : info.max === 1 ? '0 至 1，1 为最大值。' : undefined}>
        <PreferenceValueInput project={project} preference={preference} value={component.preferenceValue} onChange={value => edit(target => { target.preferenceValue = value; })} />
      </Field>}
    </>}
    {content && !settingAction && <>
      {(control?.range || component.controlRange) && <UiControlRangeFields component={component} control={control} edit={edit} />}
      {control?.textInput && <>
        <Field label="输入占位文字" uiProperty="placeholder"><input aria-label="输入占位文字" maxLength={2000} value={component.input?.placeholder ?? ''} onChange={event => edit(target => { target.input = { ...target.input, placeholder: event.target.value }; })} /></Field>
        <Field label="输入最大长度" uiProperty="maxLength" hint="按 Unicode 字符计数；改变上限不会截断已有参数内容。"><NumberInput aria-label="输入最大长度" min={0} step={1} value={component.input?.maxLength ?? 200} onChange={event => edit(target => { target.input = { ...target.input, maxLength: Math.round(event.target.valueAsNumber) }; })} /></Field>
      </>}
      {control?.choice && bound && <p className="muted ui-field-help">{control.options.length} 个选项，游戏中横向排列；在参数集中添加、删除或排序。</p>}
      {nativeChoice && preference && info && <UiPropertyGroup id="control-choice-options" title="下拉选项" summary={options.length + ' 项'} searchKeywords="选项 文字 值 添加 删除">
        {options.map((option, index) => <div className="ui-preference-option" key={index}>
          <UiChoiceOptionLabel label={`选项 ${index + 1} 文字`} value={option.label} onChange={label => setOptions(options.map((item, current) => current === index ? { ...item, label } : item))} />
          <Field label={`选项 ${index + 1} 值`}><PreferenceValueInput project={project} label={`选项 ${index + 1} 值`} preference={preference} value={option.value} onChange={value => setOptions(options.map((item, current) => current === index ? { ...item, value } : item))} /></Field>
          <button type="button" className="danger-text small-button" disabled={options.length < 2} onClick={() => setOptions(options.filter((_, current) => current !== index), true)}>删除选项 {index + 1}</button>
        </div>)}
        <button type="button" className="small-button" disabled={options.length >= 64} onClick={() => setOptions([...options, { label: `选项 ${options.length + 1}`, value: info.initial }], true)}>添加选项</button>
      </UiPropertyGroup>}
    </>}
    {interaction && !settingAction && (control || component.readOnly !== undefined || component.slider?.reverse !== undefined) && <>
      <Field label="禁止用户改值" uiProperty="readOnly" hint="只限制玩家输入；蓝图能否赋值由“当前值”的控制方式决定，不改变关联参数。"><input aria-label="禁止用户改值" type="checkbox" disabled={!control} checked={component.readOnly ?? false} onChange={event => edit(target => { target.readOnly = event.target.checked; })} /></Field>
      {control?.slider && <Field label="反向滑条" uiProperty="sliderReverse" hint="向右拖动时数值减小。"><input aria-label="反向滑条" type="checkbox" checked={component.slider?.reverse ?? false} onChange={event => edit(target => { target.slider = { ...target.slider, reverse: event.target.checked }; })} /></Field>}
    </>}
    {appearance && control?.slider && <UiSliderAppearance project={project} component={component} edit={edit} assetUrl={assetUrl} />}
    {appearance && nativeChoice && <>
      <Field label="选项行高" hint="画面像素；最小 5，包含文字上下各 2 像素的留白。"><NumberInput aria-label="选项行高" min={5} value={component.selector?.itemHeight ?? 40} onChange={event => edit(target => { target.selector = { ...target.selector, options, itemHeight: event.target.valueAsNumber }; })} /></Field>
      <Field label="下拉箭头图片"><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label="下拉箭头图片" value={component.selector?.arrowId} empty="使用默认箭头" onChange={value => edit(target => { target.selector = { ...target.selector, options, arrowId: value }; })} /></Field>
      {preference !== 'windowSize' ? <>
        <Field label="下拉面板底图"><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label="下拉面板底图" value={component.selector?.popupBackgroundId} empty="使用控件背景色" onChange={value => edit(target => { target.selector = { ...target.selector, options, popupBackgroundId: value }; })} /></Field>
        <UiChoiceStateImages project={project} component={component} edit={edit} assetUrl={assetUrl} options={options} />
      </> : <p className="muted ui-field-help">分辨率列表使用系统底色和文字色。{(component.selector?.popupBackgroundId || component.selector?.itemSkin) && '已保存的面板图片和选项皮肤保留，当前设置不使用它们。'}</p>}
    </>}
    {appearance && !control?.slider && component.slider && <p className="muted ui-field-help">已保存滑条外观；当前绑定类型不使用，切换回滑条时继续使用。</p>}
    {appearance && !nativeChoice && component.selector && <p className="muted ui-field-help">已保存下拉外观；当前绑定使用{control?.choice ? '横向选项组' : '其他输入方式'}，不使用下拉图片。</p>}
  </>;
}

/** Deleting while replacing a label is an editing state, not a valid option. */
function UiChoiceOptionLabel({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const empty = !draft.trim();
  return <Field label={label} hint={empty ? '选项文字不能为空；离开输入框会恢复原文字。' : undefined}><input aria-label={label} aria-invalid={empty || undefined} value={draft} onChange={event => { const next = event.target.value; setDraft(next); if (next.trim()) onChange(next); }} onBlur={() => { if (empty) setDraft(value); }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setDraft(value); event.currentTarget.blur(); } if (event.key === 'Enter') event.currentTarget.blur(); }} /></Field>;
}

function UiSliderAppearance({ project, component, edit, assetUrl }: { project: Project; component: UiComponent; edit: EditComponent; assetUrl: AssetUrl }) {
  const [state, setState] = useState<Exclude<UiButtonState, 'selected'>>('idle');
  const thumb = component.slider?.thumb;
  const inherited = state === 'pressed' && thumb?.hover ? '悬停图片' : state !== 'idle' && thumb?.idle ? '普通图片' : '默认滑块';
  return <>
    <div className="inspector-section-title">滑条外观</div>
    {(['trackColor', 'fillColor', 'thumbColor'] as const).map(key => {
      const label = { trackColor: '滑条轨道颜色', fillColor: '滑条填充颜色', thumbColor: '滑块底色' }[key];
      const property = { trackColor: 'sliderTrackColor', fillColor: 'sliderFillColor', thumbColor: 'sliderThumbColor' }[key] as 'sliderTrackColor' | 'sliderFillColor' | 'sliderThumbColor';
      return <UiDesignColorField key={key} label={label} property={property} value={String(uiPropertyDefault(project, component, property))} canReset={component.slider?.[key] !== undefined} source={component.slider?.[key] !== undefined ? '此控件单独设置' : key === 'fillColor' ? component.slider?.trackId ? '底图上默认无填充' : '沿用页面强调色' : '默认滑条颜色'} onChange={value => edit(target => { target.slider = { ...target.slider, [key]: value }; })} onReset={() => edit(target => { if (target.slider) delete target.slider[key]; }, { separate: true })} />;
    })}
    <Field label="显示滑条标题" uiProperty="sliderShowLabel"><input aria-label="显示滑条标题" type="checkbox" checked={component.slider?.showLabel ?? true} onChange={event => edit(target => { target.slider = { ...target.slider, showLabel: event.target.checked }; })} /></Field>
    <UiPropertyGroup id="control-slider-images" title="轨道与滑块图片" searchKeywords="滑条 底图 填充图 滑块 普通 悬停 按住 禁用 图片">
      {(['trackId', 'fillId'] as const).map(key => <Field key={key} label={key === 'trackId' ? '滑条底图' : '滑条填充图'} uiProperty={key === 'trackId' ? 'sliderTrackImage' : 'sliderFillImage'}><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label={key === 'trackId' ? '滑条底图' : '滑条填充图'} value={component.slider?.[key]} empty="使用颜色" onChange={value => edit(target => { target.slider = { ...target.slider, [key]: value }; })} /></Field>)}
      <Field label="滑块状态"><select aria-label="滑块状态" value={state} onChange={event => setState(event.target.value as typeof state)}>{(['idle', 'hover', 'pressed', 'disabled'] as const).map(value => <option key={value} value={value}>{uiStateNames[value]}</option>)}</select></Field>
      <Field label={`${uiStateNames[state]}滑块`} uiProperty={({ idle: 'sliderThumbImage', hover: 'sliderHoverThumbImage', pressed: 'sliderPressedThumbImage', disabled: 'sliderDisabledThumbImage' } as const)[state]}><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label={`${uiStateNames[state]}滑块`} value={thumb?.[state]} empty={'使用' + inherited} onChange={value => edit(target => { target.slider = { ...target.slider, thumb: { ...target.slider?.thumb, [state]: value } }; })} /></Field>
      {thumb?.selected && <p className="muted ui-field-help">旧选中图片仍保留；滑条拖动时使用按住图片。</p>}
    </UiPropertyGroup>
    <UiPropertyGroup id="control-slider-size" title="滑条尺寸" summary="画面像素" searchKeywords="滑轨 高度 滑块 宽度 大小">
      <div className="ui-control-dimensions">{(['trackHeight', 'thumbWidth', 'thumbHeight'] as const).map(key => <Field key={key} label={{ trackHeight: '滑轨高度', thumbWidth: '滑块宽度', thumbHeight: '滑块高度' }[key]} uiProperty={({ trackHeight: 'sliderTrackHeight', thumbWidth: 'sliderThumbWidth', thumbHeight: 'sliderThumbHeight' } as const)[key]}><NumberInput aria-label={{ trackHeight: '滑轨高度', thumbWidth: '滑块宽度', thumbHeight: '滑块高度' }[key]} min={0.01} value={component.slider?.[key] ?? (key === 'trackHeight' ? 12 : 26)} onChange={event => edit(target => { target.slider = { ...target.slider, [key]: event.target.valueAsNumber }; })} /></Field>)}</div>
    </UiPropertyGroup>
  </>;
}

function UiChoiceStateImages({ project, component, edit, assetUrl, options }: { project: Project; component: UiComponent; edit: EditComponent; assetUrl: AssetUrl; options: NonNullable<UiComponent['selector']>['options'] }) {
  const [state, setState] = useState<UiButtonState>('idle');
  const skin = component.selector?.itemSkin;
  const inherited = ['pressed', 'selected'].includes(state) && skin?.hover ? '沿用悬停图片' : state !== 'idle' && skin?.idle ? '沿用普通图片' : '使用背景色';
  return <UiPropertyGroup id="control-choice-state-images" title="下拉选项状态图片" searchKeywords="选项状态 普通 悬停 按住 选中 禁用 图片">
    <Field label="选项状态"><select aria-label="选项状态" value={state} onChange={event => setState(event.target.value as UiButtonState)}>{(Object.entries(uiStateNames) as [UiButtonState, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
    <Field label={`${uiStateNames[state]}选项图`}><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label={`${uiStateNames[state]}选项图`} value={skin?.[state]} empty={inherited} onChange={value => edit(target => { target.selector = { ...target.selector, options, itemSkin: { ...target.selector?.itemSkin, [state]: value } }; })} /></Field>
  </UiPropertyGroup>;
}

export function PlayerDefaultsFields({ project, commit }: { project: Project; commit: Commit }) {
  return <details className="ui-property-group"><summary>玩家初始设置</summary>
    <p className="muted ui-field-help">用于第一次启动和“恢复初始设置”。玩家以后调整的设置会保留，读取剧情存档不会覆盖它们。</p>
    {playerPreferenceKeys.map(key => <Field key={key} label={`初始${preferenceInfo(project, key).name}`} hint={key === 'textSpeed' ? '每秒字数，0 表示立即显示。' : key === 'characterVolume' ? '所有角色的初始音量。' : undefined}>
      <PreferenceValueInput project={project} label={`初始${preferenceInfo(project, key).name}`} preference={key} value={project.playerDefaults?.[key]} onChange={value => commit('玩家初始设置', draft => { draft.playerDefaults = { ...draft.playerDefaults, [key]: value }; })} />
    </Field>)}
    <button className="text-button" disabled={!project.playerDefaults} onClick={() => commit('恢复玩家初始设置', draft => { draft.playerDefaults = undefined; })}>恢复默认初始值</button>
  </details>;
}

export function AuthoredPreferencePreview({ project, component, assetUrl, scale, state, value: controlledValue }: {
  project: Project; component: UiComponent; assetUrl: AssetUrl; scale: number; state: UiButtonState; value?: VariableValue;
}) {
  const theme = uiComponentTheme(project, component);
  const parameter = project.variables.find(variable => variable.id === component.parameterId);
  const control = uiControlDefinition(project, component);
  if (!control) return <span className="ui-preference-invalid" role="status">{component.text && <strong>{component.text}</strong>}<span>{uiControlBindingName(project, component)}</span></span>;
  const value = uiControlEffectiveValue(control, controlledValue ?? control.initial);
  if (parameter && control.type !== 'number') return <div className="ui-authored-preference"><span className="ui-preference-label">{component.text || parameter.name}</span>{control.choice ? <span className="ui-preference-option-preview">{control.options.map((option, index) => <span key={index} data-selected={option.value === value || undefined}>{option.label}</span>)}</span> : <span>{control.type === 'boolean' ? value ? '☑ 开启' : '☐ 关闭' : String(value) || component.input?.placeholder || '输入内容…'}</span>}</div>;
  if (control.choice) {
    const caption = control.options.find(option => option.value === value)?.label ?? String(value);
    return <><UiSkinImage skin={component.skin} state={state} assetUrl={assetUrl} scale={scale} /><span className="ui-preference-caption">{caption}</span><span className="ui-preference-arrow" style={{ width: component.height * project.height * scale * 0.55, height: component.height * project.height * scale * 0.55 }}>{component.selector?.arrowId ? <UiSkinImage skin={{ idle: component.selector.arrowId }} state="idle" assetUrl={assetUrl} scale={scale} /> : '▾'}</span></>;
  }
  const slider = component.slider;
  const rawRatio = control?.range ? uiControlRatio(control, value) : 0;
  const ratio = slider?.reverse ? 1 - rawRatio : rawRatio;
  const thumbWidth = Math.min(component.width * project.width, slider?.thumbWidth ?? 26) * scale;
  const height = component.height * project.height * scale;
  const titleHeight = slider?.showLabel === false ? 0 : Math.min(height * 0.45, 32 * scale);
  const thumbHeight = Math.min(height - titleHeight, (slider?.thumbHeight ?? 26) * scale);
  const trackHeight = Math.min(thumbHeight, (slider?.trackHeight ?? 12) * scale);
  const picture = (assetId?: string) => assetId && <UiSkinImage skin={{ idle: assetId, fit: 'stretch' }} state="idle" assetUrl={assetUrl} scale={scale} />;
  return <div className="ui-authored-preference" style={{ '--preference-thumb-width': `${thumbWidth}px` } as CSSProperties}>
    {slider?.showLabel !== false && <span className="ui-preference-label" style={{ height: titleHeight }}>{component.text || parameter?.name || uiControlBindingName(project, component)}</span>}
    <div className="ui-preference-track-area" style={{ height: height - titleHeight }}>
      <div className="ui-preference-track" style={{ height: trackHeight, background: slider?.trackId ? undefined : slider?.trackColor ?? '#515c60' }}>{picture(slider?.trackId)}</div>
      <div className="ui-preference-fill" style={{ height: trackHeight, width: `calc(${ratio * 100}% + ${thumbWidth * (0.5 - ratio)}px)`, background: slider?.fillId ? undefined : slider?.fillColor ?? (slider?.trackId ? 'transparent' : theme.accent) }}>{picture(slider?.fillId)}</div>
      <div className="ui-preference-thumb" style={{ width: thumbWidth, height: thumbHeight, left: `calc(${ratio * 100}% - ${ratio * thumbWidth}px)`, background: slider?.thumb?.idle ? undefined : slider?.thumbColor ?? '#eef1ef', borderRadius: slider?.thumb?.idle ? 0 : 3 * scale }}><UiSkinImage skin={slider?.thumb} state={state === 'selected' ? 'pressed' : state} assetUrl={assetUrl} scale={scale} /></div>
    </div>
  </div>;
}
