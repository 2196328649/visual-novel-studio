import { useContext, useMemo, useState } from 'react';
import type { Project } from '../core/model';
import { editStoryFlowSource, storyFlowContentEdit, storyFlowSourceLabel, storyFlowSources } from '../core/story-flow-authoring';
import { UiFlowAuthoringStatusContext, UiFlowEditContext } from './UiFlowEditing';
import { Field } from './components';
import type { Commit } from './editor';

export const flowSourceSearchLabels = ['管理显示的剧情 显示哪些剧情 显示的剧情 剧情来源 所有剧情图共用 查找剧情来源 选择此入口 显示更多 显示章节 显示小章节 显示段落 入口 工程 共用 加入 隐藏 未加入 同一入口'] as const;

export function UiFlowSources({ project, commit }: { project: Project; commit: Commit }) {
  const editing = useContext(UiFlowEditContext), [query, setQuery] = useState(''), [limit, setLimit] = useState(40);
  const status = useContext(UiFlowAuthoringStatusContext);
  const sources = useMemo(() => storyFlowSources(project), [project.nodes, project.scenes, project.chapters]);
  const visible = sources.filter(source => source.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="flow-source-editor">
    <p className="flow-edit-scope">加入或隐藏入口，会同步到本工程中使用“跟随剧本”的剧情图。自定义图分别保留自己的内容。</p>
    <p className="muted ui-field-help">章节默认显示，小章节和段落可单独加入。同一入口只显示最具体的一项：段落优先于小章节，小章节优先于章节。</p>
    <Field label="查找剧情来源"><input type="search" aria-label="查找剧情来源" value={query} placeholder="章节、小章节或段落名称" onChange={event => { setQuery(event.target.value); setLimit(40); }} /></Field>
    <div className="flow-source-list">{visible.slice(0, limit).map(source => <div key={`${source.owner.kind}:${source.owner.id}`} data-flow-source={`${source.owner.kind}:${source.owner.id}`}>
      <label><input type="checkbox" aria-label={`显示${{ chapter: '章节', scene: '小章节', node: '段落' }[source.owner.kind]}：${source.item.name}`} disabled={status.textPending || status.saving || !source.nodeId || !source.editable} checked={source.visible} onChange={event => { const value = event.target.checked; commit(storyFlowContentEdit, draft => editStoryFlowSource(draft, source.owner, { visible: value }), { separate: true }); }} /><span><strong>{source.item.name}</strong><small>{source.path}</small></span></label>
      <small>{!source.editable ? '旧工程的内部入口，请使用对应章节或小章节设置' : !source.nodeId ? '没有剧情内容' : source.overriddenBy ? `同一入口显示：${storyFlowSourceLabel(project, source.overriddenBy)}` : source.visible ? '已加入剧情图' : '未加入'}</small>
      {source.visible && source.nodeId && <button type="button" className="text-button" onClick={() => editing?.select(source.nodeId, true)}>选择此入口</button>}
    </div>)}</div>
    {!visible.length && <p className="muted">没有匹配的剧情来源。</p>}
    {visible.length > limit && <button type="button" className="text-button" onClick={() => setLimit(limit + 40)}>显示更多（还有 {visible.length - limit} 项）</button>}
  </div>;
}
