import { useContext } from 'react';
import { ChevronRight, FolderOpen, MapPin } from 'lucide-react';
import type { Project, UiComponent } from '../core/model';
import { playerFlowAllEntries, playerFlowGroups, playerFlowPositions, setPlayerFlowPosition, playerFlowView } from '../core/player-flow-content';
import { editPlayerFlowGroup, removePlayerFlowGroup, setPlayerFlowGroupMembers } from '../core/player-flow-authoring';
import { storyFlowLayout } from '../core/story-flow';
import { UiFlowEditContext } from './UiFlowEditing';
import { UiPropertyGroup } from './UiPropertyGroup';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import type { UiFlowContentChange } from './UiFlowContentSources';

export function UiFlowContentGroup({ project, component, groupId, change, disabled }: {
  project: Project; component: UiComponent; groupId: string; change: UiFlowContentChange; disabled?: boolean;
}) {
  const editing = useContext(UiFlowEditContext), groups = playerFlowGroups(component);
  const group = groups.find(item => item.id === groupId);
  if (!group) return <p className="muted">此分组已不存在。返回整图后可重新选择。</p>;
  const entries = playerFlowAllEntries(project, component), rawEntries = component.list?.flowContent?.custom?.entries ?? [];
  const currentView = playerFlowView(project, component, editing?.groupId);
  const rootCard = currentView.groupId !== group.id && component.list?.layout === 'flow' && group.collapsed !== false
    ? storyFlowLayout(project, component, editing?.groupId).nodes.find(node => node.groupId === group.id)
    : undefined;
  const rootPosition = rootCard && playerFlowPositions(component, editing?.groupId)[rootCard.id];
  return <div className="flow-content-group-detail" data-flow-group-detail={group.id}>
    <UiPropertyGroup id="flow-group-content" title="剧情分组" summary={`${group.nodeIds.length} 个节点`} searchKeywords="分组名称 进入分组 在整图中显示为分组 解散分组" searchChildren="title" defaultOpen>
      <Field label="分组名称"><input aria-label="剧情分组名称" maxLength={120} value={group.name} disabled={disabled} onChange={event => { const name = event.target.value; if (name.trim()) change('剧情图分组名称', (_draft, object) => { editPlayerFlowGroup(object, group.id, { name }); }); }} /></Field>
      <p className="flow-edit-scope">将这些节点收进一个可双击进入的模块，仅整理这张图。剧情顺序、分支和到达记录保持原样。</p>
      <button type="button" className="small-button" disabled={!editing?.enterGroup} onClick={() => editing?.enterGroup?.(group.id)}><FolderOpen size={14} />进入分组<ChevronRight size={13} /></button>
      <Field label="在整图中显示为分组"><input type="checkbox" aria-label="在整图中显示为分组" checked={group.collapsed !== false} disabled={disabled} onChange={event => { const collapsed = event.target.checked; change('剧情图分组显示方式', (_draft, object) => { editPlayerFlowGroup(object, group.id, { collapsed }); }); }} /></Field>
      <small className="muted">关闭后，组内节点直接显示在整图上；分组仍保留。</small>
    </UiPropertyGroup>
    {rootCard && <UiPropertyGroup id="flow-group-position" title="分组卡片位置" summary={rootPosition ? '手动位置' : '自动排列'} searchKeywords="分组卡片位置 横向位置 纵向位置 恢复自动排列" searchChildren="title">
      <p className="muted ui-field-help">只影响当前层的分组卡片。进入组内后，节点位置单独保存。</p>
      <div className="field-row">{(['x', 'y'] as const).map(axis => <Field key={axis} label={axis === 'x' ? '横向位置 px' : '纵向位置 px'}><NumberInput aria-label={`分组卡片${axis === 'x' ? '横向' : '纵向'}位置`} min={0} disabled={disabled} value={rootPosition?.[axis] ?? rootCard[axis]} onChange={event => {
        const value = event.target.valueAsNumber;
        if (Number.isFinite(value) && value >= 0) change('调整剧情图分组位置', (_draft, object) => { setPlayerFlowPosition(object, rootCard.id, { x: rootPosition?.x ?? rootCard.x, y: rootPosition?.y ?? rootCard.y, [axis]: value }, editing?.groupId); });
      }} /></Field>)}</div>
      <button type="button" className="text-button" disabled={disabled || !rootPosition} onClick={() => change('恢复剧情图分组自动排列', (_draft, object) => { setPlayerFlowPosition(object, rootCard.id, undefined, editing?.groupId); })}>分组卡片恢复自动排列</button>
    </UiPropertyGroup>}
    <UiPropertyGroup id="flow-group-members" title="组内剧情" summary={`${group.nodeIds.length} 个节点`} searchKeywords="组内剧情 加入此分组" searchChildren="title" defaultOpen>
      <p className="muted ui-field-help">勾选加入，取消勾选移回整图。每个节点只能属于一个组。</p>
      <div className="flow-source-list">{rawEntries.map(raw => {
        const entry = entries.find(item => item.id === raw.nodeId), other = groups.find(item => item.id !== group.id && item.nodeIds.includes(raw.nodeId));
        const name = entry?.name ?? raw.name ?? raw.nodeId;
        return <div key={raw.nodeId}><label><input type="checkbox" aria-label={`加入此分组：${name}`} checked={group.nodeIds.includes(raw.nodeId)} disabled={disabled} onChange={event => {
          const checked = event.target.checked;
          change('剧情图分组成员', (_draft, object) => {
            const current = playerFlowGroups(object).find(item => item.id === group.id);
            if (current) setPlayerFlowGroupMembers(object, group.id, checked ? [...current.nodeIds, raw.nodeId] : current.nodeIds.filter(id => id !== raw.nodeId));
          });
        }} /><span><strong>{name}</strong>{!entry ? <small>入口缺失，可在“管理本图剧情”中修复</small> : other && <small>当前在“{other.name}”；加入后会移出原组</small>}</span></label></div>;
      })}</div>
    </UiPropertyGroup>
    <button type="button" className="small-button danger-text" disabled={disabled} onClick={() => change('解散剧情图分组', (_draft, object) => { removePlayerFlowGroup(object, group.id); })}>解散分组</button>
    <p className="muted ui-field-help">只移除分组，保留所有剧情节点，可撤销。</p>
  </div>;
}

export function UiFlowContentCall({ project, component, callId }: { project: Project; component: UiComponent; callId: string }) {
  const editing = useContext(UiFlowEditContext), view = playerFlowView(project, component, editing?.groupId);
  const entry = view.entries.find(item => item.callId === callId);
  if (!entry) return <p className="muted">当前视图中已没有这段子剧情，请返回画布重新选择。</p>;
  const sourceId = entry.sourceEntryId ?? entry.targetId;
  const source = playerFlowAllEntries(project, component).find(item => item.id === sourceId);
  const continuations = [...new Set(view.edges.filter(edge => edge.from === entry.id).map(edge => view.entries.find(item => item.id === edge.to)?.name).filter(Boolean))];
  return <div className="flow-content-call-detail" data-flow-call-detail={callId}>
    <UiPropertyGroup id="flow-call-content" title="子剧情" summary={entry.name} searchKeywords="子剧情 进入子剧情 调用位置 返回继续 编辑文字与外观 剧情来源" searchChildren="title" defaultOpen>
      <strong>{entry.name}</strong>
      <p className="flow-edit-scope">按顺序进入这段剧情。{continuations.length ? `返回后继续到“${continuations.join('”或“')}”。` : '图中未显示后续节点，实际结束方式由剧本决定。'}</p>
      <button type="button" className="small-button" disabled={!entry.viewId || !editing?.enterView} onClick={() => { if (entry.viewId) editing?.enterView?.(entry.viewId, callId); }}><FolderOpen size={14} />进入子剧情<ChevronRight size={13} /></button>
      <p className="muted ui-field-help">双击卡片或按 Enter 也可进入。内容与其他使用位置共用，每个使用位置分别接回自己的后续剧情。</p>
      <div className="button-row">
        {source && <button type="button" className="text-button" onClick={() => editing?.select(source.id, true)}>编辑文字与外观<ChevronRight size={12} /></button>}
        <button type="button" className="text-button" disabled={!editing?.locateSource} onClick={() => editing?.locateSource?.(callId)}><MapPin size={12} />定位调用位置</button>
        <button type="button" className="text-button" disabled={!editing?.locateSource || !entry.targetId} onClick={() => { if (entry.targetId) editing?.locateSource?.(entry.targetId); }}><MapPin size={12} />定位剧情内容</button>
      </div>
    </UiPropertyGroup>
  </div>;
}

export function UiFlowContentEdge({ project, component, from, to }: { project: Project; component: UiComponent; from: string; to: string }) {
  const editing = useContext(UiFlowEditContext), layout = storyFlowLayout(project, component, editing?.groupId);
  const edge = layout.edges.find(item => item.from === from && item.to === to);
  if (!edge) return <p className="muted">当前视图中已没有这条连线，请返回画布重新选择。</p>;
  const name = (id: string) => layout.nodes.find(node => node.id === id)?.name ?? project.nodes.find(node => node.id === id)?.name ?? id;
  const paths = edge.paths ?? [];
  const fromCall = layout.nodes.find(node => node.id === from)?.callId, toCall = layout.nodes.find(node => node.id === to)?.callId;
  const relationship = fromCall ? `这段子剧情返回后，继续到“${name(to)}”。` : toCall ? `先进入子剧情“${name(to)}”，完成后再继续后面的剧情。` : undefined;
  return <UiPropertyGroup id="flow-edge-source" title="连线来源" summary={`${name(from)} → ${name(to)}`} searchKeywords="连线来源 剧情路径 选项 条件 定位出发剧情 定位到达剧情" searchChildren="title" defaultOpen>
    <div className="flow-content-edge" data-flow-edge-source={`${from}:${to}`}>
      <strong>{name(from)} → {name(to)}</strong>
      {relationship && <p className="flow-edit-scope">{relationship}</p>}
      <p className="flow-edit-scope">连线由真实剧情自动推导。下方是可定位的参考路径，不穷举所有组合；实际能否通过取决于剧本里的选项和条件。</p>
      {paths.length ? paths.map((path, index) => <details className="flow-content-path" key={index} open={paths.length === 1}>
        <summary>{paths.length > 1 ? `路径 ${index + 1}` : '经过的剧情'}{path.labels.length ? ` · ${path.labels.join(' → ')}` : ''}</summary>
        {path.truncated && <p className="muted ui-field-help">这条路径较长，中间部分已省略。定位到剧情可查看完整路线。</p>}
        <ol>{path.nodeIds.map((nodeId, at) => <li key={`${nodeId}:${at}`}><span>{project.nodes.find(node => node.id === nodeId)?.name ?? nodeId}</span><button type="button" className="text-button" aria-label={`定位路径剧情：${project.nodes.find(node => node.id === nodeId)?.name ?? nodeId}`} disabled={!editing?.locateSource} onClick={() => editing?.locateSource?.(nodeId)}><MapPin size={12} />定位</button></li>)}</ol>
      </details>) : <p className="muted">此连线来自两个入口之间的剧情出口。</p>}
      {paths.length >= 8 && <small className="muted">这里只列出最多 8 条代表性路径。</small>}
      <p className="muted ui-field-help">要改变路线，请定位到对应剧情，修改选项或跳转。</p>
    </div>
  </UiPropertyGroup>;
}
