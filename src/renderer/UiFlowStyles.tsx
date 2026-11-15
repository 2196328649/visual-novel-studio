import { useEffect, useMemo, useRef, useState } from 'react';
import { cloneData } from '../core/project-mutation';
import { makeId, type FlowStyle, type Project, type UiButtonState, type UiComponent } from '../core/model';
import { availableFlowStyleName, flowNodeAppearance, flowStyleUsages, renameFlowStyleReferences } from '../core/flow-style';
import type { FlowStyleProperty } from '../core/flow-style-editing';
import { playerFlowAllEntries } from '../core/player-flow-content';
import { isStandaloneNode } from '../core/standalone-performance';
import { Field } from './components';
import { UiFlowStyleFields } from './UiFlowStyleFields';
import { UiPropertyGroup } from './UiPropertyGroup';
import { storyFlowSourceLabel } from '../core/story-flow-authoring';
import { UiFlowNodeSample, type FlowCaptionNode } from './UiFlowNodePreview';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';

export const uiFlowPresetSearchLabels = ['编辑节点外观预设', '管理外观预设', '新建预设', '复制预设', '查看使用位置', '预设名称', '删除预设', '剧情引用 章节 小章节 段落 隐藏 同入口'] as const;

export interface UiFlowPresetSample { node: FlowCaptionNode; real: boolean }

/** A preset preview must never masquerade an unrelated story node as its user. */
export function uiFlowPresetSample(project: Project, component: UiComponent, presetId: string, preferredNodeId?: string): UiFlowPresetSample | undefined {
  const preset = project.ui.flowStyles?.find(style => style.id === presetId);
  if (!preset) return;
  const entries = playerFlowAllEntries(project, component).filter(entry => entry.styleId === presetId);
  const entry = entries.find(item => item.id === preferredNodeId) ?? entries[0];
  if (entry) {
    const storyNode = project.nodes.find(item => item.id === entry.id);
    return { node: { ...entry, kind: isStandaloneNode(storyNode) ? 'chapterTitle' : storyNode?.kind }, real: true };
  }
  const count = Math.max(1, (preset.style?.captionParts ?? component.style?.captionParts)?.length ?? 1);
  const parts = Array.from({ length: count }, (_, index) => index === count - 1 ? '剧情标题' : index === 0 ? '第一回' : `文字${index + 1}`);
  return { node: { id: `flow-preset-example:${preset.id}`, name: parts.join(' '), ...(count > 1 ? { parts } : {}), styleId: preset.id }, real: false };
}

/** Choosing a shared style here edits the library; assignment is in the current-node card. */
export function UiFlowStyles({ project, component, commit, assetUrl, selectedId, onSelect, node, textPending,
  state: controlledState, onStateChange, selectedPart, onSelectPart, onFocusProperty, showSample = true, showStateControl = true, onSampleChange,
}: {
  project: Project; component: UiComponent; commit: Commit; assetUrl: AssetUrl; selectedId: string; onSelect: (id: string) => void; node?: FlowCaptionNode; textPending?: boolean;
  state?: UiButtonState; onStateChange?: (state: UiButtonState) => void; selectedPart?: number; onSelectPart?: (textIndex: number) => void;
  onFocusProperty?: (property: FlowStyleProperty) => void; showSample?: boolean; showStateControl?: boolean;
  onSampleChange?: (sample: UiFlowPresetSample | undefined) => void;
}) {
  const styles = project.ui.flowStyles ?? [], current = styles.find(style => style.id === selectedId);
  const [localState, setLocalState] = useState<UiButtonState>('idle'), [notice, setNotice] = useState('');
  const state = controlledState ?? localState;
  const setState = (next: UiButtonState) => { if (controlledState === undefined) setLocalState(next); onStateChange?.(next); };
  const scope = JSON.stringify([project.id, component.id, component.page, project.ui.activeInstanceId]);
  const latest = useRef({ scope, selectedId, textPending }), mounted = useRef(true);
  latest.current = { scope, selectedId, textPending };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => setNotice(''), [scope, selectedId]);
  const active = () => mounted.current && latest.current.scope === scope && latest.current.selectedId === selectedId;
  const usage = current ? flowStyleUsages(project, current.id) : [];
  const sample = useMemo(() => uiFlowPresetSample(project, component, selectedId, node?.id), [project, component, selectedId, node?.id]);
  const sampleSignature = JSON.stringify([scope, selectedId, sample]);
  const lastSampleSignature = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!onSampleChange || lastSampleSignature.current === sampleSignature) return;
    lastSampleSignature.current = sampleSignature;
    onSampleChange(sample);
  }, [sampleSignature, onSampleChange]);
  const edit = (change: (style: FlowStyle) => void, options?: { separate?: boolean }) => {
    if (!current || !active()) return;
    try {
      commit('节点外观预设', draft => {
        if (!active() || draft.id !== project.id) return;
        const target = draft.ui.flowStyles?.find(style => style.id === selectedId);
        if (!target) return;
        const oldName = target.name;
        change(target);
        if (oldName === target.name) return;
        if (latest.current.textPending) throw new Error('请先同步剧本文本，再修改预设名称。');
        const nextName = target.name.trim();
        if (!nextName) throw new Error('请填写预设名称。');
        if (draft.ui.flowStyles?.some(style => style.id !== target.id && style.name.trim() === nextName)) throw new Error('已有同名预设，请换一个名称。');
        if (draft.scriptText) draft.scriptText.content = renameFlowStyleReferences(draft.scriptText.content, target.id, oldName, target.name);
      }, options);
      setNotice('');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const add = (copyId?: string) => {
    if (!active()) return;
    const id = makeId('flow_style');
    let written = false;
    try {
      commit('添加节点外观预设', draft => {
        if (!active() || draft.id !== project.id) return;
        const available = draft.ui.flowStyles ?? [];
        if (available.length >= 128) throw new Error('节点外观预设已达 128 个，请先整理未使用的预设。');
        const copy = copyId ? available.find(style => style.id === copyId) : undefined;
        if (copyId && !copy) throw new Error('原预设已不存在，请重新选择。');
        (draft.ui.flowStyles ??= []).push({ id, name: availableFlowStyleName(available, copy ? copy.name + ' 副本' : '新预设'), ...(copy ? { skin: cloneData(copy.skin), style: cloneData(copy.style) } : {}) });
        written = true;
      }, { separate: true });
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return; }
    if (written) { setNotice(''); onSelect(id); }
  };
  const remove = () => {
    if (!current || !active()) return;
    let removed = false;
    try {
      commit('删除节点外观预设', draft => {
        if (!active() || draft.id !== project.id || !draft.ui.flowStyles?.some(style => style.id === selectedId)) return;
        if (flowStyleUsages(draft, selectedId).length) throw new Error('此预设仍有剧情引用，请先替换所有使用位置。');
        draft.ui.flowStyles = draft.ui.flowStyles.filter(style => style.id !== selectedId);
        removed = true;
      }, { separate: true });
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return; }
    if (removed) { setNotice(''); onSelect(''); }
  };
  return <div className="ui-flow-styles" data-flow-preset-id={current?.id}>
    <Field label="编辑节点外观预设"><select aria-label="编辑节点外观预设" value={current?.id ?? ''} onChange={event => onSelect(event.target.value)}><option value="">选择要编辑的节点外观预设</option>{styles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</select></Field>
    {notice && <p className="ui-event-notice" role="alert">{notice}</p>}
    {current && sample && <div key={current.id}>
      {showSample && <>
        <p className="flow-edit-scope" data-flow-preset-sample={sample.real ? 'real' : 'synthetic'}>{sample.real ? `实际使用节点：${sample.node.name}` : usage.length ? '当前图没有显示此预设的节点。下方是未应用的示例，不代表画布中的节点。' : '未应用的示例：此预设尚未分配给剧情节点。'}</p>
        <UiFlowNodeSample project={project} component={component} node={sample.node} state={state} assetUrl={assetUrl} selectedPart={selectedPart} onSelectPart={onSelectPart} />
      </>}
      <UiFlowStyleFields project={project} component={component} value={current} effective={flowNodeAppearance(project, component, sample.node)} edit={(change, options) => edit(style => change(style), options)} assetUrl={assetUrl} state={state} onStateChange={setState} shared node={sample.node} selectedPart={selectedPart} onSelectPart={onSelectPart} onFocusProperty={onFocusProperty} showStateControl={showStateControl} />
    </div>}
    <UiPropertyGroup id="flow-preset-manage" title="管理外观预设" summary={current ? `${usage.length} 处剧情引用` : `${styles.length} 个预设`} searchKeywords={uiFlowPresetSearchLabels} searchChildren="title" defaultOpen={!current}>
      <div className="button-row"><button type="button" className="small-button" disabled={styles.length >= 128} onClick={() => add()}>新建预设</button><button type="button" className="small-button" disabled={!current || styles.length >= 128} onClick={() => add(current?.id)}>复制预设</button></div>
      {current && <>
        <Field label="预设名称"><input aria-label="预设名称" maxLength={120} disabled={textPending} value={current.name} onChange={event => { const name = event.target.value; if (name.trim()) edit(style => { style.name = name; }); }} /></Field>
        <UiPropertyGroup id="flow-preset-usages" title="查看使用位置" summary={`${usage.length} 处剧情引用`} searchKeywords="剧情引用 章节 小章节 段落 隐藏 同入口" searchChildren="title">
          {usage.length ? <ul className="flow-usage-list">{usage.map(item => <li key={item.id}>{'componentId' in item ? item.name : storyFlowSourceLabel(project, { kind: project.chapters.some(chapter => chapter.id === item.id) ? 'chapter' : project.scenes.some(scene => scene.id === item.id) ? 'scene' : 'node', id: item.id }) || item.name}</li>)}</ul> : <p className="muted ui-field-help">尚未使用。选中剧情节点后，可以为它指定此预设。</p>}
          {!!usage.length && <small className="muted">修改预设会同步这些引用；包含隐藏和同入口被覆盖的剧情。</small>}
        </UiPropertyGroup>
        <button type="button" className="danger-text small-button" disabled={usage.length > 0} onClick={remove}>删除预设</button>
        {!!usage.length && <small className="muted">使用中的预设不能删除，请先替换上方列出的剧情引用。</small>}
      </>}
    </UiPropertyGroup>
  </div>;
}
