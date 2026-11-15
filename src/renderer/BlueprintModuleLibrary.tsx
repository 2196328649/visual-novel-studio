import { useLayoutEffect, useMemo, useState } from 'react';
import { ArrowUpRight, LibraryBig, Plus, Search } from 'lucide-react';
import type { BlueprintGraph } from '../core/model';
import { completionScore } from '../core/text-completion';
import { isTimelineComponent } from '../core/timeline-component';
import { UiEventDetail, useUiEventSidebar } from './UiEventSidebar';

export interface BlueprintModuleLibraryState { expanded: boolean; query: string }

export function BlueprintModuleLibrary({ session, graphs, graphId, environmentOnly, check, insert, open, create, atLimit }: {
  session?: BlueprintModuleLibraryState;
  graphs: BlueprintGraph[]; graphId: string; environmentOnly: boolean;
  check(graph: BlueprintGraph): { problem?: string; incomplete?: boolean };
  insert(graph: BlueprintGraph): void; open?(graph: BlueprintGraph): void; create?(): void; atLimit: boolean;
}) {
  const [expanded, setExpanded] = useState(session?.expanded ?? false), [query, setQuery] = useState(session?.query ?? '');
  const sidebar = useUiEventSidebar();
  useLayoutEffect(() => { if (session) Object.assign(session, { expanded, query }); }, [session, expanded, query]);
  const modules = useMemo(() => graphs.filter(graph => graph.id !== graphId && !graph.uiPageId && ['function', 'macro', 'effect'].includes(graph.kind) && !isTimelineComponent(graph)), [graphs, graphId]);
  if (sidebar) {
    const showing = expanded || !!sidebar.search.trim();
    const candidates = showing ? modules.filter(graph => completionScore(graph.name, sidebar.search, [graph.description ?? '']) > 0).map(graph => ({ graph, ...check(graph) })).filter(item => !environmentOnly || !item.problem) : [];
    return <details className="blueprint-module-library" open={showing} onToggle={event => { if (!sidebar.search.trim()) setExpanded(event.currentTarget.open); }}>
      <summary><LibraryBig size={14}/><span>可复用模块</span><small>{modules.length}</small></summary>
      {showing && <><div className="blueprint-module-results">{candidates.map(({ graph, problem }) => <div key={graph.id} data-blueprint-module={graph.id}><button type="button" className="text-button blueprint-module-insert" aria-pressed={sidebar.active === 'module:' + graph.id} title={problem ?? '单击查看详情，双击进入编辑；拖入画布创建调用。'} draggable={!atLimit && !problem} onDragStart={event => { event.dataTransfer.setData('application/vns-blueprint', graph.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => sidebar.select('module:' + graph.id)} onDoubleClick={() => open?.(graph)}><span>{graph.name}</span></button></div>)}</div>{!candidates.length && <p>没有符合筛选的可复用模块。</p>}{create && <button type="button" className="text-button" onClick={create}>＋ 创建用户节点</button>}</>}
      {modules.map(graph => <UiEventDetail key={graph.id} id={'module:' + graph.id} title={graph.name} kind="可复用模块"><p>{graph.description || '把一组常用操作封装在一起，拖入事件图即可调用。'}</p><p className="ui-field-help">{graph.exposedInputs.length} 个调用输入 · {graph.exposedOutputs.length} 个调用输出</p>{sidebar.active === 'module:' + graph.id && <ModuleActions graph={graph} check={check} insert={insert} open={open} atLimit={atLimit}/>}</UiEventDetail>)}
    </details>;
  }
  // Capability analysis is only needed while this section is being used.
  const candidates = expanded ? modules.filter(graph => completionScore(graph.name, query, [graph.description ?? '']) > 0).map(graph => ({ graph, ...check(graph) })).filter(item => !environmentOnly || !item.problem) : [];
  return <details className="blueprint-module-library" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><LibraryBig size={14} /><span>可复用模块</span><small>{modules.length}</small></summary>
    {expanded && <><div className="search"><Search size={13} /><input aria-label="搜索可复用模块" placeholder="名称或拼音首字母" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="blueprint-module-results">{candidates.map(({ graph, problem, incomplete }) => <div key={graph.id} data-blueprint-module={graph.id}>
        <button type="button" className="text-button blueprint-module-insert" title={problem ?? [graph.description, incomplete ? '含动态参数，需在实际调用时验证。' : '点击或拖入画布创建调用节点。'].filter(Boolean).join(' ')} aria-label={'添加模块调用：' + graph.name} disabled={atLimit || !!problem} draggable={!atLimit && !problem} onDragStart={event => { event.dataTransfer.setData('application/vns-blueprint', graph.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => insert(graph)}><Plus size={13} /><span>{graph.name}</span></button>
        {open && <button type="button" className="icon-button" title={'打开模块：' + graph.name} aria-label={'打开模块：' + graph.name} onClick={() => open(graph)}><ArrowUpRight size={13} /></button>}
      </div>)}</div>
      {!candidates.length && <p>{modules.length ? '没有符合当前筛选的模块。' : '把常用节点封装后，可在这里重复使用。'}</p>}
      {create && <button type="button" className="text-button" onClick={create}>＋ 创建用户节点</button>}
    </>}
  </details>;
}

function ModuleActions({ graph, check, insert, open, atLimit }: {
  graph: BlueprintGraph; check(graph: BlueprintGraph): { problem?: string; incomplete?: boolean };
  insert(graph: BlueprintGraph): void; open?(graph: BlueprintGraph): void; atLimit: boolean;
}) {
  const { problem, incomplete } = check(graph);
  return <>{problem && <p role="alert">{problem}</p>}{incomplete && <p className="ui-field-help">含动态输入，调用时会继续检查。</p>}<div className="ui-event-detail-actions"><button type="button" className="small-button" disabled={atLimit || !!problem} onClick={() => insert(graph)}>添加调用节点</button>{open && <button type="button" className="small-button" onClick={() => open(graph)}>进入模块</button>}</div></>;
}
