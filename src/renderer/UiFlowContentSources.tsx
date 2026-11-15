import { useContext, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, FolderPlus, MapPin, Plus, Trash2 } from 'lucide-react';
import type { Project, UiComponent } from '../core/model';
import { playerFlowAllEntries, playerFlowGroups, playerFlowMissingEntries } from '../core/player-flow-content';
import { addPlayerFlowEntry, createPlayerFlowGroup, playerFlowSources, removePlayerFlowEntry, reorderPlayerFlowEntries, repairPlayerFlowEntry } from '../core/player-flow-authoring';
import { storyFlowSourceLabel, type FlowOwner } from '../core/story-flow-authoring';
import { UiFlowEditContext } from './UiFlowEditing';
import { Field, IconButton } from './components';

export type UiFlowContentChange = (label: string, change: (draft: Project, component: UiComponent) => void) => void;
const sourceKey = (owner: FlowOwner) => `${owner.kind}:${owner.id}`;
const sourceKind = { chapter: '章节', scene: '小章节', node: '段落' };

/** A custom map chooses real story entrances; it never creates another route. */
export function UiFlowContentSources({ project, component, change, disabled, sourceDisabled }: {
  project: Project; component: UiComponent; change: UiFlowContentChange; disabled?: boolean; sourceDisabled?: boolean;
}) {
  const editing = useContext(UiFlowEditContext);
  const [query, setQuery] = useState(''), [addition, setAddition] = useState(''), [limit, setLimit] = useState(40);
  const [selection, setSelection] = useState<string[]>([]), [groupName, setGroupName] = useState('');
  const sources = useMemo(() => playerFlowSources(project), [project.nodes, project.scenes, project.chapters]);
  const entries = playerFlowAllEntries(project, component), rawEntries = component.list?.flowContent?.custom?.entries ?? [];
  const missing = playerFlowMissingEntries(project, component), groups = playerFlowGroups(component);
  const available = sources.filter(source => !rawEntries.some(entry => entry.nodeId === source.nodeId));
  const filteredSources = available.filter(source => source.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const source = available.find(item => sourceKey(item.owner) === addition);
  const selectedIds = selection.filter(id => entries.some(entry => entry.id === id));
  const selectedInGroup = groups.some(group => group.nodeIds.some(id => selectedIds.includes(id)));
  const move = (nodeId: string, direction: -1 | 1) => change('排列剧情图节点', (_draft, object) => {
    const order = object.list?.flowContent?.custom?.entries.map(entry => entry.nodeId) ?? [];
    const from = order.indexOf(nodeId), to = from + direction;
    if (from >= 0 && to >= 0 && to < order.length) { [order[from], order[to]] = [order[to], order[from]]; reorderPlayerFlowEntries(object, order); }
  });
  return <div className="flow-custom-content" data-flow-custom-content>
    <p className="flow-edit-scope">只影响当前图。每个节点对应一个已有剧情入口；连线根据真实剧情自动生成。</p>
    <div className="flow-content-add">
      <Field label="查找可添加剧情"><input type="search" aria-label="查找可添加剧情" placeholder="章节、小章节或段落名称" value={query} onChange={event => { setQuery(event.target.value); setAddition(''); }} /></Field>
      <Field label="剧情入口"><select aria-label="添加到本图的剧情入口" value={source ? addition : ''} disabled={disabled || sourceDisabled || !filteredSources.length} onChange={event => setAddition(event.target.value)}><option value="">{filteredSources.length ? '选择已有剧情' : query ? '没有匹配的可添加剧情' : '所有可用入口均已加入'}</option>{filteredSources.map(item => <option key={sourceKey(item.owner)} value={sourceKey(item.owner)}>{sourceKind[item.owner.kind]} · {item.path}</option>)}</select></Field>
      {source?.preview && <small className="muted flow-source-preview" data-flow-source-preview={source.nodeId}>{source.preview}</small>}
      <button type="button" className="small-button" aria-label="添加剧情节点" disabled={disabled || sourceDisabled || !source} onClick={() => {
        if (!source) return;
        change('添加剧情图节点', (draft, object) => { addPlayerFlowEntry(draft, object, source.owner); });
        setAddition('');
      }}><Plus size={13} />添加剧情节点</button>
      {sourceDisabled && <small className="muted">同步剧本文本后可添加或修复剧情入口。</small>}
    </div>
    {!!missing.length && <div className="flow-content-missing" role="status">
      <strong>有 {missing.length} 个剧情入口需要修复</strong>
      <p className="muted ui-field-help">这些节点保留了文字和位置，试玩时暂不显示。重新指定入口后继续使用。</p>
      {missing.map(item => <UiFlowContentRepair key={item.entry.nodeId} project={project} component={component} nodeId={item.entry.nodeId} name={item.entry.name || item.entry.nodeId} reason={item.reason} change={change} disabled={disabled} sourceDisabled={sourceDisabled} />)}
    </div>}
    <div className="flow-content-list-heading"><strong>本图节点</strong><small>{entries.length} 个</small></div>
    {entries.length ? <>
      <p className="muted ui-field-help">勾选后可合成一个显示分组。上下移动调整目录顺序，图内位置仍由排列与拖动决定。</p>
      <div className="flow-custom-node-list">{entries.slice(0, limit).map(entry => {
        const rawIndex = rawEntries.findIndex(item => item.nodeId === entry.id), group = groups.find(item => item.nodeIds.includes(entry.id));
        return <div className="flow-custom-node" key={entry.id} data-flow-custom-node={entry.id}>
          <label><input type="checkbox" aria-label={`分组选择：${entry.name}`} checked={selectedIds.includes(entry.id)} disabled={disabled} onChange={event => setSelection(event.target.checked ? [...selectedIds, entry.id] : selectedIds.filter(id => id !== entry.id))} /><span><strong>{entry.name}</strong><small>{storyFlowSourceLabel(project, entry.owner) || entry.title}</small>{group && <small>分组：{group.name}</small>}</span></label>
          <div className="flow-custom-node-actions">
            <button type="button" className="text-button" aria-label={`编辑剧情节点：${entry.name}`} onClick={() => editing?.select(entry.id, true)}>编辑<ChevronRight size={12} /></button>
            <IconButton title={`定位剧情来源：${entry.name}`} disabled={!editing?.locateSource} onClick={() => editing?.locateSource?.(entry.id)}><MapPin size={12} /></IconButton>
            <IconButton title={`上移节点：${entry.name}`} disabled={disabled || rawIndex <= 0} onClick={() => move(entry.id, -1)}><ArrowUp size={12} /></IconButton>
            <IconButton title={`下移节点：${entry.name}`} disabled={disabled || rawIndex === rawEntries.length - 1} onClick={() => move(entry.id, 1)}><ArrowDown size={12} /></IconButton>
            <IconButton title={`从本图移除：${entry.name}`} disabled={disabled} onClick={() => change('移除剧情图节点', (_draft, object) => { removePlayerFlowEntry(object, entry.id); })}><Trash2 size={12} /></IconButton>
          </div>
        </div>;
      })}</div>
      {entries.length > limit && <button type="button" className="text-button" onClick={() => setLimit(limit + 40)}>显示更多节点（还有 {entries.length - limit} 项）</button>}
      <div className="flow-content-group-create">
        <Field label="分组名称"><input aria-label="新剧情分组名称" maxLength={120} value={groupName} disabled={disabled} placeholder="例如：第一章的分支" onChange={event => setGroupName(event.target.value)} /></Field>
        <div className="button-row"><button type="button" className="small-button" aria-label="添加剧情分组" disabled={disabled || !selectedIds.length || !groupName.trim()} onClick={() => {
          change('添加剧情图分组', (draft, object) => { createPlayerFlowGroup(draft, object, groupName.trim(), selectedIds); });
          setSelection([]); setGroupName('');
        }}><FolderPlus size={13} />打组{selectedIds.length ? `（${selectedIds.length}）` : ''}</button>{!!selectedIds.length && <button type="button" className="text-button" onClick={() => setSelection([])}>清除选择</button>}</div>
        {selectedInGroup && <small className="muted">已在其他组内的节点会移到新组。</small>}
      </div>
    </> : <p className="muted">当前图还没有可显示的节点，从上方添加已有剧情即可开始。</p>}
    {!!groups.length && <div className="flow-content-group-list" aria-label="本图分组"><div className="flow-content-list-heading"><strong>显示分组</strong><small>{groups.length} 个</small></div>{groups.map(group => <button key={group.id} type="button" className="flow-navigation-card" aria-label={`编辑剧情分组：${group.name}`} onClick={() => editing?.inspect?.({ kind: 'group', groupId: group.id })}><span><strong>{group.name}</strong><small>{group.nodeIds.length} 个节点 · {group.collapsed === false ? '在整图展开' : '双击进入组内'}</small></span><ChevronRight size={15} /></button>)}</div>}
  </div>;
}

function UiFlowContentRepair({ project, component, nodeId, name, reason, change, disabled, sourceDisabled }: {
  project: Project; component: UiComponent; nodeId: string; name: string; reason: 'node' | 'owner'; change: UiFlowContentChange; disabled?: boolean; sourceDisabled?: boolean;
}) {
  const [replacement, setReplacement] = useState('');
  const sources = playerFlowSources(project).filter(source => !component.list?.flowContent?.custom?.entries.some(entry => entry.nodeId !== nodeId && entry.nodeId === source.nodeId));
  const source = sources.find(item => sourceKey(item.owner) === replacement);
  return <div className="flow-content-repair" data-flow-missing-node={nodeId}>
    <strong>{name}</strong><small>{reason === 'node' ? '剧情入口已删除' : '原章节或段落已不存在'}</small>
    <Field label="重新指定剧情"><select aria-label={`修复剧情入口：${name}`} value={source ? replacement : ''} disabled={disabled || sourceDisabled} onChange={event => setReplacement(event.target.value)}><option value="">选择替代入口</option>{sources.map(item => <option key={sourceKey(item.owner)} value={sourceKey(item.owner)}>{sourceKind[item.owner.kind]} · {item.path}</option>)}</select></Field>
    {source?.preview && <small className="muted flow-source-preview" data-flow-source-preview={source.nodeId}>{source.preview}</small>}
    <div className="button-row"><button type="button" className="small-button" disabled={disabled || sourceDisabled || !source} onClick={() => { if (source) change('修复剧情图入口', (draft, object) => { repairPlayerFlowEntry(draft, object, nodeId, source.owner); }); }}>修复入口</button><button type="button" className="text-button" disabled={disabled} onClick={() => change('移除缺失剧情入口', (_draft, object) => { removePlayerFlowEntry(object, nodeId); })}>从本图移除</button></div>
  </div>;
}
