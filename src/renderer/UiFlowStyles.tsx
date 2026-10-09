import { useState } from 'react';
import { makeId, type FlowStyle, type Project, type UiButtonState, type UiComponent } from '../core/model';
import { availableFlowStyleName, flowStyleUsages, renameFlowStyleReferences } from '../core/flow-style';
import { uiFitNames, uiStateNames } from '../core/ui';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { UiAssetSelect, UiSkinImage, uiFontFamily } from './UiAppearance';
import { uiTextShadow } from '../core/ui-text-effects';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';

export function UiFlowStyles({ project, component, commit, assetUrl }: { project: Project; component: UiComponent; commit: Commit; assetUrl: AssetUrl }) {
  const styles = project.ui.flowStyles ?? [];
  const [selectedId, select] = useState(styles[0]?.id ?? ''), [state, setState] = useState<UiButtonState>('idle');
  const current = styles.find(s => s.id === selectedId), usage = current ? flowStyleUsages(project, current.id) : [];
  const edit = (change: (s: FlowStyle) => void) => commit('流程图框样式', draft => {
    const target = draft.ui.flowStyles?.find(s => s.id === current?.id);
    if (!target) return;
    const oldName = target.name;
    change(target);
    if (draft.scriptText && oldName !== target.name) draft.scriptText.content = renameFlowStyleReferences(draft.scriptText.content, target.id, oldName, target.name);
  });
  const add = (copy?: FlowStyle) => {
    const id = makeId('flow_style');
    commit('添加流程图框样式', draft => { (draft.ui.flowStyles ??= []).push({ id, name: availableFlowStyleName(draft.ui.flowStyles ?? [], copy ? copy.name + ' 副本' : '新样式'), skin: structuredClone(copy?.skin ?? component.skin), style: structuredClone(copy?.style ?? component.style) }); });
    select(id);
  };
  const colorKey = state === 'idle' ? 'textColor' : state === 'disabled' ? 'disabledTextColor' : state === 'selected' ? 'selectedTextColor' : 'hoverTextColor';
  const backgroundKey = state === 'idle' ? 'background' : `${state}Background` as const;
  return <details className="ui-property-group ui-flow-styles" open>
    <summary>框样式</summary>
    <p className="muted ui-field-help">剧本中填写“样式=名称”，可供多个章节、小章节和段落共用。</p>
    <Field label="编辑框样式"><select aria-label="编辑框样式" value={current?.id ?? ''} onChange={e => select(e.target.value)}><option value="">选择样式</option>{styles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
    <div className="button-row"><button className="small-button" disabled={styles.length >= 128} onClick={() => add()}>新建框样式</button><button className="small-button" disabled={!current || styles.length >= 128} onClick={() => add(current)}>复制样式</button></div>
    {current && <>
      <Field label="样式名称"><input aria-label="样式名称" maxLength={120} value={current.name} onChange={e => { const name = e.target.value; if (name.trim() && !styles.some(s => s.id !== current.id && s.name === name.trim())) edit(s => { s.name = name; }); }} /></Field>
      <Field label="样式状态"><select aria-label="样式状态" value={state} onChange={e => setState(e.target.value as UiButtonState)}>{Object.entries(uiStateNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
      <Field label={`${uiStateNames[state]}背景图片`}><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label="框样式背景图片" value={current.skin?.[state]} onChange={value => edit(s => { s.skin = { ...s.skin, [state]: value }; })} /></Field>
      <div className="field-row"><Field label={`${uiStateNames[state]}文字色`}><input aria-label="框样式文字色" type="color" value={current.style?.[colorKey] ?? current.style?.textColor ?? '#ffffff'} onChange={e => edit(s => { s.style = { ...s.style, [colorKey]: e.target.value }; })} /></Field><Field label={`${uiStateNames[state]}底色`}><input aria-label="框样式底色" type="color" value={current.style?.[backgroundKey] ?? current.style?.background ?? '#283133'} onChange={e => edit(s => { s.style = { ...s.style, [backgroundKey]: e.target.value }; })} /></Field></div>
      <Field label="背景缩放"><select aria-label="框样式背景缩放" value={current.skin?.fit ?? 'stretch'} onChange={e => edit(s => { s.skin = { ...s.skin, fit: e.target.value as NonNullable<FlowStyle['skin']>['fit'] }; })}>{Object.entries(uiFitNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      {current.skin?.fit === 'nineSlice' && <div className="field-row">{(['left', 'top', 'right', 'bottom'] as const).map(edge => <Field key={edge} label={`${{ left: '左', top: '上', right: '右', bottom: '下' }[edge]}边距`}><NumberInput min={0} max={2048} value={current.skin?.borders?.[edge] ?? 12} onChange={e => edit(s => { s.skin = { ...s.skin, borders: { left: 12, top: 12, right: 12, bottom: 12, ...s.skin?.borders, [edge]: Number(e.target.value) } }; })} /></Field>)}</div>}
      <details className="ui-property-group"><summary>文字、边框和阴影</summary>
        <Field label="框样式字体"><UiAssetSelect project={project} assetUrl={assetUrl} kind="font" label="框样式字体" value={current.style?.fontAssetId} onChange={value => edit(s => { s.style = { ...s.style, fontAssetId: value }; })} /></Field>
        <Field label="框样式字号"><NumberInput aria-label="框样式字号" min={12} max={96} value={current.style?.fontSize ?? component.style?.fontSize ?? project.ui.fontSize} onChange={e => edit(s => { s.style = { ...s.style, fontSize: Math.round(Number(e.target.value)) }; })} /></Field>
        <div className="field-row"><Field label="框样式边框宽度"><NumberInput min={0} max={32} value={current.style?.borderWidth ?? 0} onChange={e => edit(s => { s.style = { ...s.style, borderWidth: Number(e.target.value) }; })} /></Field><Field label="框样式边框色"><input type="color" value={current.style?.borderColor ?? '#ffffff'} onChange={e => edit(s => { s.style = { ...s.style, borderColor: e.target.value }; })} /></Field></div>
        <Field label="框样式阴影浓度 %"><NumberInput aria-label="框样式阴影浓度" min={0} max={100} value={Math.round((current.style?.shadowOpacity ?? .4) * 100)} onChange={e => edit(s => { s.style = { ...s.style, shadowOpacity: Number(e.target.value) / 100 }; })} /></Field>
        <Field label="框样式阴影柔化"><NumberInput min={0} max={64} value={current.style?.shadowBlur ?? 0} onChange={e => edit(s => { s.style = { ...s.style, shadowBlur: Number(e.target.value) }; })} /></Field>
      </details>
      <div aria-label="框样式示例" style={{ position: 'relative', height: 60, display: 'grid', placeItems: 'center', background: current.style?.[backgroundKey] ?? current.style?.background, fontFamily: uiFontFamily(current.style?.fontAssetId ?? component.style?.fontAssetId), color: current.style?.[colorKey] ?? current.style?.textColor, fontSize: Math.min(32, current.style?.fontSize ?? 24), textShadow: uiTextShadow(current, .5), border: `${current.style?.borderWidth ?? 0}px solid ${current.style?.borderColor ?? '#ffffff'}` }}><UiSkinImage skin={current.skin} state={state} assetUrl={assetUrl} scale={.5} /><span style={{ position: 'relative' }}>{current.name}</span></div>
      <p className="muted">{usage.length ? `已被 ${usage.length} 处使用；修改会同步更新。` : '尚未被剧本引用。'}</p>
      <button className="danger-text small-button" disabled={usage.length > 0} title={usage.length ? '先在剧本中替换正在使用的样式' : undefined} onClick={() => { commit('删除流程图框样式', draft => { draft.ui.flowStyles = draft.ui.flowStyles?.filter(s => s.id !== current.id); }); select(''); }}>删除样式</button>
    </>}
  </details>;
}
