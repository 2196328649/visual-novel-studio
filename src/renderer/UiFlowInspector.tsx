import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Copy, List, MapPin, MousePointer2, Paintbrush, Route, SlidersHorizontal, X } from 'lucide-react';
import { editableUiComponent, effectiveUiComponents, type Project, type UiComponent } from '../core/model';
import { flowNodeAppearance, flowStyleUsages } from '../core/flow-style';
import { copyFlowStyleForEntry } from '../core/flow-style-authoring';
import { flowStyleImpact } from '../core/flow-style-impact';
import { flowCaptionSlotIndex, type FlowStyleProperty } from '../core/flow-style-editing';
import { storyFlowLayout } from '../core/story-flow';
import { playerFlowAllEntries, playerFlowMode, playerFlowPositions, setPlayerFlowPosition } from '../core/player-flow-content';
import { editPlayerFlowEntry, initializePlayerFlowCustom, setPlayerFlowMode } from '../core/player-flow-authoring';
import { editStoryFlowEntry, storyFlowContentEdit, storyFlowSourceEditable, storyFlowSourceLabel } from '../core/story-flow-authoring';
import { isStandaloneNode } from '../core/standalone-performance';
import { uiComponentPageId } from '../core/ui-page-settings';
import { flowPreviewSample, UiFlowAuthoringStatusContext, UiFlowEditContext, type FlowInspectorTarget } from './UiFlowEditing';
import { UiPropertyGroup } from './UiPropertyGroup';
import { UiFlowNodeText } from './UiFlowNodeText';
import { UiFlowNodeSample } from './UiFlowNodePreview';
import { UiFlowStyleFields, uiFlowStyleSearchLabels, flowStateNames } from './UiFlowStyleFields';
import { UiFlowStyles, uiFlowPresetSample, uiFlowPresetSearchLabels } from './UiFlowStyles';
import { UiFlowLayoutFields, uiFlowArrangementSearchLabels, uiFlowBrowsingSearchLabels, uiFlowModeSearchLabels } from './UiFlowLayoutFields';
import { UiFlowPlayerFields, uiFlowPlayerRulesSearchLabels, uiFlowPlayerBrowsingSearchLabels } from './UiFlowPlayerFields';
import { UiFlowSources, flowSourceSearchLabels } from './UiFlowSources';
import { UiFlowContentMode, uiFlowContentSearchLabels } from './UiFlowContentMode';
import { UiFlowContentSources, type UiFlowContentChange } from './UiFlowContentSources';
import { UiFlowContentCall, UiFlowContentEdge, UiFlowContentGroup } from './UiFlowContentDetails';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { UiAssetSelect } from './AssetPicker';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import './ui-flow-inspector.css';

const nodeSearchLabels = ['查找节点 选择节点 选择剧情图节点 查找剧情图节点 清除节点查找 编辑节点内容 节点文字 标题 分段 当前节点文字 添加文字段 使用剧情标题 当前节点外观预设 编辑这个外观预设 调整这一段外观 复制预设并用于此节点 保存当前外观并用于此节点 剧情来源 定位到画布', ...Array.from({ length: 8 }, (_, index) => `节点文字第 ${index + 1} 段`)];
const styleSearchLabels = [...uiFlowStyleSearchLabels, ...uiFlowPresetSearchLabels, '编辑本图基础外观 编辑节点外观预设 实际使用的预设 本图基础外观 字体 字号 黑底 分段 当前属性影响 实际来源', '按剧情类型设置底图 结局背景图片 章节背景图片'];
const stylePropertyNames: Partial<Record<keyof NonNullable<UiComponent['style']>, string>> = {
  fontAssetId: '字体', fontSize: '字号', letterSpacing: '字间距', textColor: '普通文字色', hoverTextColor: '悬停 / 按住文字色', selectedTextColor: '当前位置文字色', disabledTextColor: '未到达文字色',
  align: '文字对齐', background: '普通底色', hoverBackground: '悬停底色', pressedBackground: '按住底色', selectedBackground: '当前位置底色', disabledBackground: '未到达底色',
  borderWidth: '边框宽度', borderColor: '边框颜色', radius: '圆角', opacity: '节点不透明度', outlineWidth: '描边宽度', outlineColor: '描边颜色', outlineOpacity: '描边不透明度',
  shadowX: '阴影横向偏移', shadowY: '阴影纵向偏移', shadowBlur: '黑底柔和度', shadowSpread: '黑底厚度', shadowColor: '阴影颜色', shadowOpacity: '黑底不透明度', captionParts: '分段文字样式',
};
const propertyName = (property: FlowStyleProperty) => property.kind === 'skin' ? `${property.state ? flowStateNames[property.state] : '节点'}底图` : property.kind === 'caption' ? `所选文字段 · ${{ fontAssetId: '字体', fontSize: '字号', letterSpacing: '字间距', color: '颜色', gap: '与下一段间距' }[property.key]}` : stylePropertyNames[property.key] ?? '节点外观';

/** The root remains mounted while a node or preset has its own inspector scope. */
export function UiFlowInspector({ project, component, previewComponent, commit, edit, assetUrl, target = { kind: 'map' }, active = true, onNavigate }: {
  project: Project; component: UiComponent; previewComponent?: UiComponent; commit: Commit;
  edit: (change: (component: UiComponent) => void, options?: { separate?: boolean }) => void;
  assetUrl: AssetUrl; target?: FlowInspectorTarget; active?: boolean; onNavigate?: (target: FlowInspectorTarget) => void;
}) {
  const flowEditing = useContext(UiFlowEditContext), editing = flowEditing?.componentId === component.id ? flowEditing : undefined;
  const status = useContext(UiFlowAuthoringStatusContext);
  const mode = playerFlowMode(component), custom = mode === 'custom';
  const entries = useMemo(() => playerFlowAllEntries(project, component), [project.chapters, project.scenes, project.nodes, component.list?.flowContent]);
  const nodes = useMemo(() => entries.map(entry => {
    const node = project.nodes.find(item => item.id === entry.id);
    return { ...entry, kind: node && isStandaloneNode(node) ? 'chapterTitle' : node?.kind };
  }), [entries, project.nodes]);
  const [query, setQuery] = useState(''), [localPart, setLocalPart] = useState(0), [notice, setNotice] = useState('');
  const [property, setProperty] = useState<FlowStyleProperty>({ kind: 'style', key: 'fontSize' });
  const [createdPreset, setCreatedPreset] = useState<{ id: string; nodeId?: string; scope: string }>();
  const selectedPart = editing?.selectedPart ?? localPart;
  const selectPart = (index: number) => { setLocalPart(index); editing?.setSelectedPart?.(index); };
  const pageId = uiComponentPageId(project, component);
  const scope = JSON.stringify([project.id, component.id, pageId, component.page === 'custom' ? undefined : project.ui.activeInstanceId, mode, editing?.groupId, editing?.browseTrail, target]);
  const selected = 'nodeId' in target ? entries.find(entry => entry.id === target.nodeId) : undefined;
  const preset = target.kind === 'preset' ? project.ui.flowStyles?.find(item => item.id === target.presetId) : undefined;
  const presetSample = useMemo(() => target.kind === 'preset' ? uiFlowPresetSample(project, component, target.presetId, target.nodeId) : undefined, [project, component, scope]);
  const sample = target.kind === 'preset' ? presetSample?.node : nodes.find(node => node.id === selected?.id) ?? nodes[0];
  const sampleReal = target.kind === 'preset' ? !!presetSample?.real : !!sample;
  const styleTarget = target.kind === 'base' || target.kind === 'preset' && !!preset ? target : undefined;
  const samplePreview = useMemo(() => sampleReal && sample ? flowPreviewSample(project, component, sample.id, editing) : undefined, [project, component, sampleReal, sample?.id, editing]);
  const visualState = samplePreview?.state ?? editing?.visualState ?? 'idle';
  const influence = useMemo(() => styleTarget ? flowStyleImpact(project, component, nodes, styleTarget, property, visualState, sampleReal ? sample?.id : 'no-applied-sample') : undefined,
    [project, component, nodes, scope, property, visualState, sample?.id, sampleReal]);
  const impactSignature = JSON.stringify(influence && { nodeIds: influence.nodeIds, label: influence.label });
  useEffect(() => {
    if (active && styleTarget && influence) editing?.setImpact?.({ nodeIds: influence.nodeIds, label: influence.label });
  }, [active, scope, impactSignature, editing?.setImpact]);
  const latest = useRef({ scope, active, ...status }), mounted = useRef(true);
  latest.current = { scope, active, ...status };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && latest.current.scope === scope && latest.current.active && !latest.current.saving;
  const readComponentIn = (draft: Project) => component.page === 'custom' ? draft.ui.customPages.find(page => page.id === pageId)?.components.find(item => item.id === component.id) : effectiveUiComponents(draft.ui).find(item => item.id === component.id);
  const editableComponentIn = (draft: Project) => component.page === 'custom'
    ? draft.ui.customPages.find(page => page.id === pageId)?.components.find(item => item.id === component.id)
    : editableUiComponent(draft.ui, component.id);
  const scopedCommit: Commit = (label, change, options) => {
    if (!current() || label === storyFlowContentEdit && latest.current.textPending) return;
    commit(label, draft => {
      if (!current() || draft.id !== project.id || label === storyFlowContentEdit && latest.current.textPending) return;
      if (component.page !== 'custom' && draft.ui.activeInstanceId !== project.ui.activeInstanceId) return;
      const object = readComponentIn(draft);
      if (object?.kind === 'flowchart' && object.page === component.page) change(draft);
    }, options);
  };
  const nodeCommit: Commit = (label, change, options) => {
    if (target.kind !== 'node' || !selected) return;
    scopedCommit(label, draft => {
      const object = readComponentIn(draft);
      if (!object || playerFlowMode(object) !== mode) return;
      const entry = playerFlowAllEntries(draft, object).find(item => item.id === selected.id);
      if (entry && entry.owner?.kind === selected.owner?.kind && entry.owner?.id === selected.owner?.id && (custom || storyFlowSourceEditable(draft, entry.owner))) change(draft);
    }, options);
  };
  const scopedEdit: typeof edit = (change, options) => { if (current()) edit(object => { if (current()) change(object); }, options); };
  const contentChange: UiFlowContentChange = (label, change) => scopedCommit(label, draft => {
    const currentObject = readComponentIn(draft);
    if (!currentObject || playerFlowMode(currentObject) !== mode) return;
    const object = editableComponentIn(draft);
    if (object) change(draft, object);
  }, { separate: true });
  const nodeLabel = custom ? '本图节点内容' : storyFlowContentEdit;
  const changeNode = (change: Parameters<typeof editPlayerFlowEntry>[2]) => nodeCommit(nodeLabel, draft => {
    if (custom) { const object = editableComponentIn(draft); if (object) editPlayerFlowEntry(object, selected!.id, change); }
    else editStoryFlowEntry(draft, selected!.id, change);
  }, { separate: true });
  const changeContentMode = (label: string, change: (draft: Project, object: UiComponent) => void) => scopedCommit(label, draft => {
    const object = editableComponentIn(draft);
    if (object) change(draft, object);
  }, { separate: true });
  const navigate = (next: FlowInspectorTarget) => {
    if (!mounted.current || latest.current.scope !== scope || !latest.current.active) return;
    if (next.kind === 'base' && !next.nodeId) next = { ...next, nodeId: nodes[0]?.id };
    if (next.kind === 'preset') {
      const reference = uiFlowPresetSample(project, component, next.presetId, next.nodeId);
      next = { ...next, nodeId: reference?.real ? reference.node.id : undefined };
    }
    if (onNavigate) onNavigate(next); else editing?.inspect?.(next);
  };
  // Newly created IDs become navigable only in the committed project snapshot.
  useEffect(() => {
    if (!createdPreset || createdPreset.scope !== scope || !active || !project.ui.flowStyles?.some(style => style.id === createdPreset.id)) return;
    navigate({ kind: 'preset', presetId: createdPreset.id, nodeId: createdPreset.nodeId });
    setCreatedPreset(undefined);
  }, [createdPreset, project.ui.flowStyles, scope, active]);
  const contentDisabled = status.saving || !!component.editor?.locked || !custom && (status.textPending || !storyFlowSourceEditable(project, selected?.owner));
  const selectedContent = custom ? component.list?.flowContent?.custom?.entries.find(entry => entry.nodeId === selected?.id) : undefined;
  const selectedStyle = project.ui.flowStyles?.find(style => style.id === selected?.styleId);
  const selectedStyleUsage = selectedStyle ? flowStyleUsages(project, selectedStyle.id).length : 0;
  const filtered = entries.filter(entry => `${entry.name} ${storyFlowSourceLabel(project, entry.owner)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const optionLabel = (entry: typeof entries[number]) => { const path = storyFlowSourceLabel(project, entry.owner); return path && path !== entry.name ? `${entry.name} · ${path}` : entry.name; };
  const chooseNode = <>
    <Field label="查找节点"><div className="flow-node-search"><input type="search" aria-label="查找剧情图节点" value={query} placeholder="剧情标题或章节路径" onChange={event => setQuery(event.target.value)} />{query && <button type="button" className="icon-button" aria-label="清除节点查找" onClick={() => setQuery('')}><X size={13} /></button>}</div></Field>
    <Field label="选择节点"><select aria-label="选择剧情图节点" disabled={!editing || !entries.length} value={selected?.id ?? ''} onChange={event => { if (event.target.value) editing?.select(event.target.value, true); }}><option value="">选择要编辑的剧情节点</option>{selected && !filtered.some(entry => entry.id === selected.id) && <option value={selected.id}>{optionLabel(selected)}（当前选择）</option>}{filtered.map(entry => <option key={entry.id} value={entry.id}>{optionLabel(entry)}</option>)}</select></Field>
    {!!query.trim() && <small className="muted">找到 {filtered.length} 个节点。</small>}
  </>;
  const editNodeStyle = (textIndex?: number) => {
    if (!selected) return;
    if (textIndex !== undefined) selectPart(textIndex);
    navigate(selectedStyle ? { kind: 'preset', presetId: selectedStyle.id, nodeId: selected.id } : { kind: 'base', nodeId: selected.id });
  };
  const copyForNode = () => {
    if (!selected || contentDisabled) return;
    let copiedId: string | undefined;
    try {
      nodeCommit(nodeLabel, draft => {
        const object = custom ? editableComponentIn(draft) : readComponentIn(draft);
        if (!object) return;
        const result = copyFlowStyleForEntry(draft, object, selected.id, { expectedOwner: selected.owner });
        if (!result.ok) throw new Error(result.reason);
        copiedId = result.styleId;
      }, { separate: true });
      if (copiedId) setCreatedPreset({ id: copiedId, nodeId: selected.id, scope });
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const partFocus = (index: number) => {
    selectPart(index);
    const look = sample ? flowNodeAppearance(project, component, target.kind === 'base' ? {} : sample) : component;
    const slot = flowCaptionSlotIndex(look.style?.captionParts?.length ?? 0, sample?.parts?.length ?? 1, index);
    setProperty(slot === undefined ? { kind: 'style', key: 'fontSize' } : { kind: 'caption', index: slot, key: 'fontSize' });
  };
  const actualPreview = sample && <div className="flow-actual-preview" data-flow-preview-reference={sampleReal ? sample.id : 'unapplied'}>
    <div className="flow-preview-heading"><span>{sampleReal ? '在当前图中的实际外观' : '未应用的示例'}</span><span>{flowStateNames[visualState]}</span></div>
    <UiFlowNodeSample project={project} component={component} previewComponent={previewComponent} node={sample} state={visualState} preview={samplePreview} assetUrl={assetUrl} selectedPart={selectedPart} onSelectPart={partFocus} />
    <div className="flow-preview-heading"><small>{sampleReal ? sample.name : '尚未分配给当前图显示的剧情节点'}</small>{sampleReal && <button type="button" className="text-button" onClick={() => editing?.locateNode?.(sample.id)}><MapPin size={12} />定位</button>}</div>
  </div>;
  return <div className="ui-player-flow-inspector" data-flow-inspector-target={target.kind} data-flow-editing-node={selected?.id}>
    {status.textPending && <p className="ui-event-notice" role="status">剧本文本有尚未同步的修改。跟随剧本的文字、预设与入口编辑，以及从剧本复制或重新生成自定义图，需同步后使用。</p>}
    {notice && <p className="ui-event-notice" role="alert">{notice}</p>}
    {target.kind === 'map' && <>
      <UiPropertyGroup id="flow-mode" title="展示方式" summary={`${entries.length} 个剧情节点`} searchKeywords={[...uiFlowModeSearchLabels, ...uiFlowContentSearchLabels]} searchChildren="title" defaultOpen>
        <UiFlowContentMode scope={scope} mode={mode} hasCustom={!!component.list?.flowContent?.custom} count={entries.length} disabled={status.saving || !!component.editor?.locked} scriptPending={status.textPending}
          onMode={next => changeContentMode('切换剧情图内容来源', (_draft, object) => { setPlayerFlowMode(object, next); })}
          onInitialize={source => changeContentMode('开始自定义剧情图', (draft, object) => { initializePlayerFlowCustom(draft, object, source === 'current' ? 'copy' : 'empty'); })}
          onRegenerate={() => changeContentMode('从剧本重新生成自定义剧情图', (draft, object) => { initializePlayerFlowCustom(draft, object, 'copy'); })}
          onManage={() => navigate({ kind: 'sources' })} />
        <UiFlowLayoutFields project={project} component={component} edit={scopedEdit} assetUrl={assetUrl} section="mode" />
      </UiPropertyGroup>
      <UiPropertyGroup id="flow-content" title="剧情节点" icon={<List size={15} />} summary="点击画布节点进入编辑" searchKeywords={[...nodeSearchLabels, ...flowSourceSearchLabels]} searchChildren="title">
        {chooseNode}<p className="muted ui-field-help">{custom ? '点击画布或选择节点，编辑本图文字、点击动作、外观与位置。添加、排序和分组在上方“管理本图剧情”中调整。' : '选择后单独编辑这段剧情的文字、预设和在图内的位置。'}</p>
      </UiPropertyGroup>
      <UiPropertyGroup id="flow-style" title="节点外观" icon={<Paintbrush size={15} />} summary="字体、黑底与节点图片" searchKeywords={styleSearchLabels} searchGroupNames={['节点样式']} searchChildren="title" defaultOpen>
        <button type="button" className="flow-navigation-card" onClick={() => navigate({ kind: 'base' })}><span><strong>本图基础外观</strong><small>当前图共用；预设未设置的属性由这里提供</small></span><ChevronRight size={16} /></button>
        <div className="flow-preset-overview" aria-label="节点外观预设">
          {(project.ui.flowStyles ?? []).filter(style => entries.some(entry => entry.styleId === style.id)).map(style => <button key={style.id} type="button" className="flow-navigation-card flow-preset-card" aria-label={`编辑预设：${style.name}`} onClick={() => navigate({ kind: 'preset', presetId: style.id })}>
            <span><strong>{style.name}</strong><small>{flowStyleUsages(project, style.id).length} 处剧情引用 · 工程共用</small></span><ChevronRight size={16} />
          </button>)}
        </div>
        <button type="button" className="text-button" onClick={() => navigate({ kind: 'preset', presetId: project.ui.flowStyles?.[0]?.id ?? '' })}>管理全部外观预设 <ChevronRight size={13} /></button>
      </UiPropertyGroup>
      <UiPropertyGroup id="flow-layout" title="排列与连线" icon={<Route size={15} />} summary={component.list?.layout === 'flow' ? '方向、间距与连线' : '行列与间距'} searchKeywords={uiFlowArrangementSearchLabels} searchGroupNames={['布局与连线']} searchChildren="title"><UiFlowLayoutFields project={project} component={component} edit={scopedEdit} assetUrl={assetUrl} section="layout" /></UiPropertyGroup>
      <UiPropertyGroup id="flow-browsing" title="浏览部件" icon={<SlidersHorizontal size={15} />} summary={component.list?.layout === 'flow' ? '显示区域、滚动条与当前位置标记' : '目录翻页'} searchKeywords={[...uiFlowBrowsingSearchLabels, ...uiFlowPlayerBrowsingSearchLabels]} searchChildren="title">
        <UiFlowLayoutFields project={project} component={component} edit={scopedEdit} assetUrl={assetUrl} section="browsing" />
        <UiFlowPlayerFields project={project} component={component} edit={scopedEdit} assetUrl={assetUrl} section="browsing" showPreview={false} />
      </UiPropertyGroup>
      <UiPropertyGroup id="flow-player" title="玩家操作" icon={<MousePointer2 size={15} />} summary="可进入范围与重玩确认" searchKeywords={uiFlowPlayerRulesSearchLabels} searchChildren="title"><UiFlowPlayerFields project={project} component={component} edit={scopedEdit} assetUrl={assetUrl} section="rules" showPreview={false} /></UiPropertyGroup>
    </>}
    {target.kind === 'node' && selected && <>
      <UiPropertyGroup id="flow-current-content" title="节点文字" icon={<List size={15} />} summary={storyFlowSourceLabel(project, selected.owner) || selected.title || selected.name} searchKeywords={nodeSearchLabels} searchChildren="title" defaultOpen>
        <UiFlowNodeText project={project} entry={selected} commit={nodeCommit} disabled={contentDisabled} selectedPart={selectedPart} onSelectPart={selectPart} onEditStyle={editNodeStyle}
          localContent={custom ? { name: selectedContent?.name, write: (draft, name) => {
            const object = editableComponentIn(draft);
            return !!object && editPlayerFlowEntry(object, selected.id, { name });
          } } : undefined} />
        {!custom && !storyFlowSourceEditable(project, selected.owner) && <p className="muted ui-field-help">这是旧工程的内部入口。文字与公开范围请在对应章节或小章节中调整。</p>}
      </UiPropertyGroup>
      {actualPreview}
      <UiPropertyGroup id="flow-node-appearance" title={custom ? '点击动作与外观' : '使用的外观'} icon={<Paintbrush size={15} />} searchKeywords={[...styleSearchLabels, ...nodeSearchLabels]} searchChildren="title" defaultOpen>
        {custom && <Field label="点击节点时"><select aria-label="点击节点时" disabled={contentDisabled} value={selectedContent?.action ?? 'replay'} onChange={event => changeNode({ action: event.target.value === 'inspect' ? 'inspect' : undefined })}><option value="replay">从这里重玩</option><option value="inspect">仅查看</option></select></Field>}
        <Field label="节点外观预设"><select aria-label="当前节点外观预设" disabled={contentDisabled} value={selected.styleId ?? ''} onChange={event => { const styleId = event.target.value || undefined; if (custom) changeNode({ styleId }); else nodeCommit(storyFlowContentEdit, draft => editStoryFlowEntry(draft, selected.id, { styleId }), { separate: true }); }}><option value="">使用本图基础外观</option>{project.ui.flowStyles?.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}{selected.styleId && !selectedStyle && <option value={selected.styleId}>预设已删除</option>}</select></Field>
        <p className="flow-edit-scope">{selectedStyle ? `“${selectedStyle.name}”被 ${selectedStyleUsage} 处剧情引用。` : '由当前图的基础外观提供字体和黑底。'}{custom ? '预设只分配给本图中的这个节点。' : '预设选择会同步到其他图中的同一剧情入口。'}</p>
        <div className="button-row"><button type="button" className="small-button" onClick={() => editNodeStyle()}>{selectedStyle ? '编辑这个外观预设' : '编辑本图基础外观'}<ChevronRight size={13} /></button><button type="button" className="text-button" disabled={contentDisabled || (project.ui.flowStyles?.length ?? 0) >= 128} onClick={copyForNode}><Copy size={13} />{selectedStyle ? '复制预设并用于此节点' : '保存当前外观并用于此节点'}</button></div>
      </UiPropertyGroup>
      {component.list?.layout === 'flow' && <UiFlowNodePosition project={project} component={component} nodeId={selected.id} edit={scopedEdit} />}
      <UiPropertyGroup id="flow-other-node" title="切换剧情节点" searchKeywords={nodeSearchLabels} searchChildren="title">{chooseNode}</UiPropertyGroup>
    </>}
    {(target.kind === 'base' || target.kind === 'preset') && <>
      <p className="flow-edit-scope">{target.kind === 'base' ? '作用于当前图。预设中已指定的属性优先；下方保留节点实际外观。' : preset ? `编辑“${preset.name}”，会同步 ${flowStyleUsages(project, preset.id).length} 处剧情引用，包含其他界面和暂未显示的入口。` : '选择或新建一套外观预设，再分配给剧情节点。'}</p>
      {actualPreview}
      {sampleReal && <Field label="参考节点"><select aria-label="外观参考节点" value={sample?.id ?? ''} onChange={event => navigate(target.kind === 'base' ? { kind: 'base', nodeId: event.target.value } : { kind: 'preset', presetId: target.presetId, nodeId: event.target.value })}>{nodes.filter(node => target.kind === 'base' || node.styleId === target.presetId).map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select></Field>}
      {influence && <div className="flow-property-impact" role="status" data-flow-property-impact data-flow-reference-affected={influence.reference.affected}>
        <strong>{propertyName(property)} · {influence.label}</strong><span>参考节点来源：{influence.reference.source}</span>{influence.reference.reason && <span>{influence.reference.reason}</span>}
        {target.kind === 'base' && sample?.styleId && project.ui.flowStyles?.some(style => style.id === sample.styleId) && !influence.reference.affected && <button type="button" className="text-button" onClick={() => navigate({ kind: 'preset', presetId: sample.styleId!, nodeId: sample.id })}>编辑该节点的外观预设 <ChevronRight size={12} /></button>}
      </div>}
      {target.kind === 'base' ? <>
        <UiFlowStyleFields project={project} component={component} value={component} effective={flowNodeAppearance(project, component, {})} edit={(change, options) => scopedEdit(c => change(c), options)} assetUrl={assetUrl} state={visualState} onStateChange={value => editing?.setVisualState?.(value)} node={sample} selectedPart={selectedPart} onSelectPart={selectPart} onFocusProperty={setProperty} showStateControl={false} />
        <UiPropertyGroup id="flow-type-images" title="按剧情类型设置底图" searchKeywords="结局背景图片 章节背景图片" searchChildren="title">{(['flowEndSkin', 'flowChapterSkin'] as const).map(key => <Field key={key} label={key === 'flowEndSkin' ? '结局背景图片' : '章节背景图片'}><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label={key === 'flowEndSkin' ? '结局背景图片' : '章节背景图片'} value={component.list?.[key]?.idle} onChange={value => scopedEdit(c => { c.list = { ...c.list, [key]: value ? { ...c.list?.[key], idle: value, fit: c.list?.[key]?.fit ?? 'stretch' } : undefined }; })} /></Field>)}<small className="muted">已设置底图的预设会整套替换这些类型底图。</small></UiPropertyGroup>
      </> : <UiFlowStyles project={project} component={component} commit={scopedCommit} assetUrl={assetUrl} selectedId={target.presetId} onSelect={presetId => {
        if (presetId && !project.ui.flowStyles?.some(style => style.id === presetId)) setCreatedPreset({ id: presetId, scope });
        else navigate({ kind: 'preset', presetId, nodeId: sampleReal ? sample?.id : undefined });
      }} node={sample} textPending={status.textPending} state={visualState} onStateChange={value => editing?.setVisualState?.(value)} selectedPart={selectedPart} onSelectPart={selectPart} onFocusProperty={setProperty} showSample={false} showStateControl={false} />}
    </>}
    {target.kind === 'group' && custom && <UiFlowContentGroup project={project} component={component} groupId={target.groupId} change={contentChange} disabled={contentDisabled} />}
    {target.kind === 'call' && <><UiFlowContentCall project={project} component={component} callId={target.callId} />{component.list?.layout === 'flow' && <UiFlowNodePosition project={project} component={component} nodeId={`call:${target.callId}`} edit={scopedEdit} />}</>}
    {target.kind === 'edge' && <UiFlowContentEdge project={project} component={component} from={target.from} to={target.to} />}
    {target.kind === 'sources' && <UiPropertyGroup id="flow-sources" title={custom ? '本图剧情' : '显示的剧情'} icon={<List size={15} />} summary={custom ? '仅影响当前图' : '工程内所有跟随剧本的图共用'} searchKeywords={[...flowSourceSearchLabels, ...uiFlowContentSearchLabels]} searchChildren="title" defaultOpen>
      {custom ? <UiFlowContentSources project={project} component={component} change={contentChange} disabled={contentDisabled} sourceDisabled={status.textPending} /> : <UiFlowSources project={project} commit={scopedCommit} />}
    </UiPropertyGroup>}
  </div>;
}

function UiFlowNodePosition({ project, component, nodeId, edit }: { project: Project; component: UiComponent; nodeId: string; edit: (change: (component: UiComponent) => void, options?: { separate?: boolean }) => void }) {
  const editing = useContext(UiFlowEditContext), manual = playerFlowPositions(component, editing?.groupId)[nodeId];
  const layout = useMemo(() => storyFlowLayout(project, component, editing?.groupId), [project.chapters, project.scenes, project.nodes, component, editing?.groupId]);
  const node = layout.nodes.find(item => item.id === nodeId);
  if (!node) return null;
  return <UiPropertyGroup id="flow-node-position" title="在图内的位置" icon={<MapPin size={15} />} summary={manual ? '手动位置' : '自动排列'} searchKeywords="横向位置 纵向位置 自动排列 当前节点恢复自动排列" searchChildren="title">
    <p className="muted ui-field-help">只影响当前图中的这个节点。也可以在画布上拖动。</p>
    <div className="field-row">{(['x', 'y'] as const).map(axis => <Field key={axis} label={axis === 'x' ? '横向位置 px' : '纵向位置 px'}><NumberInput aria-label={axis === 'x' ? '节点横向位置' : '节点纵向位置'} disabled={!!component.editor?.locked} min={0} value={manual?.[axis] ?? node[axis]} onChange={event => {
      const value = event.target.valueAsNumber;
      if (Number.isFinite(value) && value >= 0) edit(c => { setPlayerFlowPosition(c, nodeId, { x: manual?.x ?? node.x, y: manual?.y ?? node.y, [axis]: value }, editing?.groupId); });
    }} /></Field>)}</div>
    <button type="button" className="text-button" disabled={!manual || !!component.editor?.locked} onClick={() => edit(c => { setPlayerFlowPosition(c, nodeId, undefined, editing?.groupId); }, { separate: true })}>当前节点恢复自动排列</button>
  </UiPropertyGroup>;
}
