import { parameterSets, parameterRange } from '../core/parameter-sets';
import { NumberInput } from './NumberInput';
import type { CSSProperties } from 'react';
import type { Project, UiButtonState, UiComponent, VariableValue } from '../core/model';
import { playerPreferenceKeys, playerPreferenceOptions, playerPreferences, sliderPreferences, type PlayerPreference } from '../core/preferences';
import { uiStateNames } from '../core/ui';
import { Field } from './components';
import { UiAssetSelect, UiSkinImage } from './UiAppearance';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';

export function PreferenceValueInput({ preference, value, onChange, label = '设置值' }: {
  preference: PlayerPreference; value?: VariableValue; onChange: (value: VariableValue) => void; label?: string;
}) {
  const info = playerPreferences[preference];
  const current = value ?? info.initial;
  if (info.type !== 'number') return <select aria-label={label} value={String(current)} onChange={event => onChange(info.type === 'boolean' ? event.target.value === 'true' : event.target.value)}>
    {playerPreferenceOptions(preference).map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
  </select>;
  return <NumberInput aria-label={label} type="number"   step={info.max === 1 ? 0.01 : 1} value={Number(current)} onChange={event => {
    const next = event.target.valueAsNumber;
    if (Number.isFinite(next)) onChange(Math.max(info.min!, Math.min(info.max!, next)));
  }} />;
}

export function UiPreferenceFields({ project, component, edit, assetUrl }: {
  project: Project; component: UiComponent; edit: (change: (component: UiComponent) => void) => void; assetUrl: AssetUrl;
}) {
  if (!['preference', 'preferenceChoice'].includes(component.kind) && component.action !== 'setPlayerPreference') return null;
  const preference = component.preference ?? 'musicVolume';
  const info = playerPreferences[preference];
  const options = component.selector?.options ?? playerPreferenceOptions(preference);
  const setOptions = (next: typeof options) => edit(c => { c.selector = { ...c.selector, options: next }; });
  const bound = project.variables.find(variable => variable.id === component.parameterId);
  const binding = <Field label="绑定设置或参数"><select aria-label="玩家设置" value={bound ? 'parameter:' + bound.id : preference} onChange={event => edit(c => {
    if (event.target.value.startsWith('parameter:')) { c.parameterId = event.target.value.slice(10); c.preference = undefined; return; }
    c.parameterId = undefined; c.preference = event.target.value as PlayerPreference; c.preferenceValue = playerPreferences[c.preference].initial; c.preferenceCharacterId = undefined;
    if (c.kind === 'preferenceChoice') c.selector = { ...c.selector, options: playerPreferenceOptions(c.preference) };
  })}><optgroup label="内置游戏设置">{(component.kind === 'preference' ? sliderPreferences : playerPreferenceKeys).map(key => <option key={key} value={key}>{playerPreferences[key].name}</option>)}</optgroup>{component.action !== 'setPlayerPreference' && parameterSets(project).map(set => <optgroup key={set.id} label={set.name}>{project.variables.filter(variable => (variable.parameterSetId ?? 'parameters_story') === set.id).map(variable => <option key={variable.id} value={'parameter:' + variable.id}>{variable.name}</option>)}</optgroup>)}</select></Field>;
  const parameterHelp = bound && <p className="muted ui-field-help">此控件读写“{bound.name}”。初始值、滑条范围和可选项在参数集中设置；蓝图可以读取同一参数。</p>;
  if (bound && bound.type !== 'number') return <>{binding}{parameterHelp}</>;
  return <>
    {binding}
    {parameterHelp}
    {!bound && preference === 'characterVolume' && <Field label="配音角色" hint="留空时调节旁白及未指定角色的配音。"><select aria-label="配音角色" value={component.preferenceCharacterId ?? ''} onChange={event => edit(c => { c.preferenceCharacterId = event.target.value || undefined; })}>
      <option value="">旁白及其他</option>{project.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select></Field>}
    {component.action === 'setPlayerPreference' && <Field label="设置值" hint={preference === 'textSpeed' ? '0 表示立即显示全部文字。' : info.max === 1 ? '0 至 1，1 为最大值。' : undefined}>
      <PreferenceValueInput preference={preference} value={component.preferenceValue} onChange={value => edit(c => { c.preferenceValue = value; })} />
    </Field>}
    {(component.kind === 'preference' || bound?.type === 'number') && <>
      <div className="inspector-section-title">滑条外观</div>
      <Field label="显示滑条标题"><input aria-label="显示滑条标题" type="checkbox" checked={component.slider?.showLabel ?? true} onChange={event => edit(c => { c.slider = { ...c.slider, showLabel: event.target.checked }; })} /></Field>
      <Field label="反向滑条" hint="向右拖动时数值减小，例如自动播放间隔或窗口不透明度。"><input aria-label="反向滑条" type="checkbox" checked={component.slider?.reverse ?? false} onChange={event => edit(c => { c.slider = { ...c.slider, reverse: event.target.checked }; })} /></Field>
      {(['trackId', 'fillId'] as const).map(key => <Field key={key} label={key === 'trackId' ? '滑条底图' : '滑条填充图'}><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label={key === 'trackId' ? '滑条底图' : '滑条填充图'} value={component.slider?.[key]} onChange={value => edit(c => { c.slider = { ...c.slider, [key]: value }; })} /></Field>)}
      {(['trackHeight', 'thumbWidth', 'thumbHeight'] as const).map(key => <Field key={key} label={{ trackHeight: '滑轨高度', thumbWidth: '滑块宽度', thumbHeight: '滑块高度' }[key]}><NumberInput aria-label={{ trackHeight: '滑轨高度', thumbWidth: '滑块宽度', thumbHeight: '滑块高度' }[key]} type="number"   value={component.slider?.[key] ?? (key === 'trackHeight' ? 12 : 26)} onChange={event => edit(c => { c.slider = { ...c.slider, [key]: Number(event.target.value) }; })} /></Field>)}
      <details className="ui-property-group"><summary>滑块状态图片</summary>{(Object.entries(uiStateNames) as [UiButtonState, string][]).map(([state, name]) => <Field key={state} label={`${name}滑块`}><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label={`${name}滑块`} value={component.slider?.thumb?.[state]} empty={state === 'idle' ? '使用默认滑块' : '沿用普通图片'} onChange={value => edit(c => { c.slider = { ...c.slider, thumb: { ...c.slider?.thumb, [state]: value } }; })} /></Field>)}</details>
    </>}
    {component.kind === 'preferenceChoice' && !bound && <>
      <div className="inspector-section-title">下拉选项</div>
      {options.map((option, index) => <div className="ui-preference-option" key={index}>
        <Field label={`选项 ${index + 1} 文字`}><input aria-label={`选项 ${index + 1} 文字`} value={option.label} onChange={event => setOptions(options.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} /></Field>
        <Field label={`选项 ${index + 1} 值`}><PreferenceValueInput label={`选项 ${index + 1} 值`} preference={preference} value={option.value} onChange={value => setOptions(options.map((item, i) => i === index ? { ...item, value } : item))} /></Field>
        <button className="danger-text small-button" disabled={options.length < 2} onClick={() => setOptions(options.filter((_, i) => i !== index))}>删除选项 {index + 1}</button>
      </div>)}
      <button className="small-button" disabled={options.length >= 64} onClick={() => setOptions([...options, { label: `选项 ${options.length + 1}`, value: info.initial }])}>添加选项</button>
      <Field label="选项行高"><NumberInput aria-label="选项行高" type="number"   value={component.selector?.itemHeight ?? 40} onChange={event => edit(c => { c.selector = { ...c.selector, options, itemHeight: Number(event.target.value) }; })} /></Field>
      <Field label="下拉面板底图"><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label="下拉面板底图" value={component.selector?.popupBackgroundId} onChange={value => edit(c => { c.selector = { ...c.selector, options, popupBackgroundId: value }; })} /></Field>
      <Field label="下拉箭头图片"><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label="下拉箭头图片" value={component.selector?.arrowId} onChange={value => edit(c => { c.selector = { ...c.selector, options, arrowId: value }; })} /></Field>
      <details className="ui-property-group"><summary>下拉选项状态图片</summary>{(Object.entries(uiStateNames) as [UiButtonState, string][]).map(([state, name]) => <Field key={state} label={`${name}选项图`}><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" label={`${name}选项图`} value={component.selector?.itemSkin?.[state]} onChange={value => edit(c => { c.selector = { ...c.selector, options, itemSkin: { ...c.selector?.itemSkin, [state]: value } }; })} /></Field>)}</details>
    </>}
  </>;
}

export function PlayerDefaultsFields({ project, commit }: { project: Project; commit: Commit }) {
  return <details className="ui-property-group"><summary>玩家初始设置</summary>
    <p className="muted ui-field-help">用于第一次启动和“恢复初始设置”。玩家以后调整的设置会保留，读取剧情存档不会覆盖它们。</p>
    {playerPreferenceKeys.map(key => <Field key={key} label={`初始${playerPreferences[key].name}`} hint={key === 'textSpeed' ? '每秒字数，0 表示立即显示。' : key === 'characterVolume' ? '所有角色的初始音量。' : undefined}>
      <PreferenceValueInput label={`初始${playerPreferences[key].name}`} preference={key} value={project.playerDefaults?.[key]} onChange={value => commit('玩家初始设置', draft => { draft.playerDefaults = { ...draft.playerDefaults, [key]: value }; })} />
    </Field>)}
    <button className="text-button" disabled={!project.playerDefaults} onClick={() => commit('恢复玩家初始设置', draft => { draft.playerDefaults = undefined; })}>恢复默认初始值</button>
  </details>;
}

export function AuthoredPreferencePreview({ project, component, assetUrl, scale, state }: {
  project: Project; component: UiComponent; assetUrl: AssetUrl; scale: number; state: UiButtonState;
}) {
  const preference = component.preference ?? 'musicVolume';
  const info = playerPreferences[preference];
  const parameter = project.variables.find(variable => variable.id === component.parameterId);
  const value = parameter?.initial ?? project.playerDefaults?.[preference] ?? info.initial;
  if (parameter && parameter.type !== 'number') return <div className="ui-authored-preference"><span className="ui-preference-label">{component.text || parameter.name}</span><span>{parameter.type === 'boolean' ? value ? '☑ 开启' : '☐ 关闭' : String(value) || '输入内容…'}{parameter.setting?.options?.length ? ' ▾' : ''}</span></div>;
  if (component.kind === 'preferenceChoice' && !parameter) {
    const caption = (component.selector?.options ?? playerPreferenceOptions(preference)).find(option => option.value === value)?.label ?? String(value);
    return <><UiSkinImage skin={component.skin} state={state} assetUrl={assetUrl} scale={scale} /><span className="ui-preference-caption">{caption}</span><span className="ui-preference-arrow" style={{ width: component.height * project.height * scale * 0.55, height: component.height * project.height * scale * 0.55 }}>{component.selector?.arrowId ? <UiSkinImage skin={{ idle: component.selector.arrowId }} state="idle" assetUrl={assetUrl} scale={scale} /> : '▾'}</span></>;
  }
  const slider = component.slider;
  const range = parameter ? parameterRange(parameter) : undefined;
  const rawRatio = Math.max(0, Math.min(1, range ? (Number(value) - range.min) / (range.max - range.min || 1) : preference === 'textSpeed' ? Number(value) === 0 ? 1 : (Number(value) - 1) / info.max! : Number(value) / info.max!));
  const ratio = slider?.reverse ? 1 - rawRatio : rawRatio;
  const thumbWidth = Math.min(component.width * project.width, slider?.thumbWidth ?? 26) * scale;
  const height = component.height * project.height * scale;
  const titleHeight = slider?.showLabel === false ? 0 : Math.min(height * 0.45, 32 * scale);
  const thumbHeight = Math.min(height - titleHeight, (slider?.thumbHeight ?? 26) * scale);
  const trackHeight = Math.min(thumbHeight, (slider?.trackHeight ?? 12) * scale);
  const picture = (assetId?: string) => assetId && <UiSkinImage skin={{ idle: assetId, fit: 'stretch' }} state="idle" assetUrl={assetUrl} scale={scale} />;
  return <div className="ui-authored-preference" style={{ '--preference-thumb-width': `${thumbWidth}px` } as CSSProperties}>
    {slider?.showLabel !== false && <span className="ui-preference-label" style={{ height: titleHeight }}>{component.text || parameter?.name || info.name}</span>}
    <div className="ui-preference-track-area" style={{ height: height - titleHeight }}>
      <div className="ui-preference-track" style={{ height: trackHeight, background: slider?.trackId ? undefined : '#515c60' }}>{picture(slider?.trackId)}</div>
      <div className="ui-preference-fill" style={{ height: trackHeight, width: `calc(${ratio * 100}% + ${thumbWidth * (0.5 - ratio)}px)`, background: slider?.fillId || slider?.trackId ? undefined : project.ui.accent }}>{picture(slider?.fillId)}</div>
      <div className="ui-preference-thumb" style={{ width: thumbWidth, height: thumbHeight, left: `calc(${ratio * 100}% - ${ratio * thumbWidth}px)`, background: slider?.thumb?.idle ? undefined : '#eef1ef', borderRadius: slider?.thumb?.idle ? 0 : 3 * scale }}><UiSkinImage skin={slider?.thumb} state={state} assetUrl={assetUrl} scale={scale} /></div>
    </div>
  </div>;
}
