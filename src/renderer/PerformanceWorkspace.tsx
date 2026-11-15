import type { BlueprintUsage } from '../core/blueprint-usages';
import { projectGraphs, addProjectGraphs } from '../core/project-resources';
import type { BlueprintSelection } from '../core/ai-selection';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Clapperboard, MoreHorizontal, Plus, Workflow } from 'lucide-react';
import type { Project } from '../core/model';
import { createBlueprintGraph } from '../core/blueprint';
import { availableBlueprintName, blueprintCallName } from '../core/blueprint-names';
import { createTimelinePreset, isTimelineComponent, timelineWrapperCall } from '../core/timeline-component';
import { targetPerformance, type PerformanceTarget } from '../core/performance-workspace';
import { BlueprintGraphEditor, type BlueprintFocus } from './BlueprintGraphEditor';
import { TextPreview } from './StoryPreview';
import { PerformanceTimeline } from './PerformanceTimeline';
import { performanceTimeline, timelinePreviewLayout } from '../core/performance-timeline';
import { timelineCallPreviewProject, type TimelinePreviewParent } from '../core/timeline-call-preview';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import './performance-workspace.css';
import { GraphResourceOptions } from './GraphResourceOptions';
import { performanceGraphOrigin, restoredPerformanceWorkspace, type OpenBlueprintGraph } from './blueprint-navigation';
import { UiToolbarPopover } from './UiToolbarPopover';
import './ui-layout-toolbar.css';

export function PerformanceWorkspace({ entryRequest, navigation, onLocateUsage, onOpenGraph, project: savedProject, target: requestedTarget, onTarget, commit: save, commitMaterialized, assetUrl, focus: externalFocus, onNotice, suspended, onActiveSelection }: {
  entryRequest?: number;
  navigation?: ReactNode; onLocateUsage?: (usage: BlueprintUsage) => void; onOpenGraph?: OpenBlueprintGraph; project: Project; target?: PerformanceTarget; onTarget: (target: PerformanceTarget) => void; commit: Commit; commitMaterialized: Commit; assetUrl: AssetUrl;
  onActiveSelection?: (selection?: BlueprintSelection) => void; focus?: BlueprintFocus; onNotice: (message: string) => void; suspended?: boolean;
}) {
  // A saved text sync can retire the line/action a target points at. Report it
  // and fall back to the project instead of crashing the whole editor.
  const workspace = useMemo(() => {
    try { return restoredPerformanceWorkspace(savedProject, requestedTarget, externalFocus?.restore); }
    catch (error) { return { project: savedProject, target: undefined, materialize: (_draft: Project) => {}, error: error instanceof Error ? error.message : String(error) }; }
  }, [savedProject, requestedTarget, externalFocus?.restore]);
  const { project, target } = workspace;
  const staleTarget = 'error' in workspace ? workspace.error : undefined;
  useEffect(() => { if (staleTarget) onNotice(staleTarget); }, [staleTarget]);
  const commit: Commit = useCallback((label, edit, options) => {
    // Only a transient canvas rewrites its source performance. Named resources
    // must remain editable even when an interface change invalidates a text call.
    const apply = workspace.project === savedProject ? save : commitMaterialized;
    apply(label, draft => { workspace.materialize(draft); edit(draft); }, options);
  }, [save, commitMaterialized, savedProject, workspace]);
  const linked = useMemo(() => target ? targetPerformance(project, target).find(action => action.kind === 'blueprint' && (!target.graphId || action.blueprintId === target.graphId)) : undefined, [project, target]);
  const graphs = useMemo(() => projectGraphs(project), [project]);
  const initialGraph = target?.graphId ?? (linked?.kind === 'blueprint' ? linked.blueprintId : graphs.find(graph => !isTimelineComponent(graph))?.id);
  const [graphId, setGraphId] = useState(initialGraph);
  const [nodeViewId, setNodeViewId] = useState<string | undefined>(target?.editorMode === 'timeline' ? undefined : initialGraph);
  const [parents, setParents] = useState<TimelinePreviewParent[]>([]);
  const parentId = parents.at(-1)?.graphId;
  const followGraph: OpenBlueprintGraph = (id, nodeId, origin) => onOpenGraph?.(id, nodeId, origin && performanceGraphOrigin(origin, savedProject, workspace, requestedTarget, parents));
  const [time, setTime] = useState(0);
  const [dragPreview, setDragPreview] = useState<Project>();
  const [seekRequest, setSeekRequest] = useState<{ graphId?: string; time: number; request: number }>();
  const [playbackRequest, setPlaybackRequest] = useState(0);
  const togglePlayback = () => setPlaybackRequest(value => value + 1);
  useEffect(() => {
    // Only a deliberate timeline entry opens a wrapper's timeline. Ordinary
    // blueprint navigation must keep the graph and its logic visible.
    const wrapped = target?.editorMode === 'timeline' ? timelineWrapperCall(project, graphs.find(item => item.id === initialGraph)) : undefined;
    if (wrapped && initialGraph) { setGraphId(wrapped.timelineId); setParents([{ graphId: initialGraph, callNodeId: wrapped.callNodeId }]); }
    else { setGraphId(initialGraph); setParents([]); }
    setNodeViewId(target?.editorMode === 'timeline' ? undefined : initialGraph);
  }, [initialGraph, project.id, target?.editorMode, entryRequest]);
  useEffect(() => {
    if (!externalFocus || !graphs.some(item => item.id === externalFocus.graphId)) return;
    setGraphId(externalFocus.graphId);
    setParents(externalFocus.restore?.performance?.parents ?? []);
    setNodeViewId(externalFocus.restore || externalFocus.nodeId || externalFocus.selection?.active() || target?.editorMode !== 'timeline' ? externalFocus.graphId : undefined);
  }, [externalFocus?.request, externalFocus?.graphId]);
  const graph = graphs.find(graph => graph.id === graphId);
  const timeline = useMemo(() => isTimelineComponent(graph) && !!graph && !performanceTimeline(project, graph).reason, [project, graph]);
  useEffect(() => () => onActiveSelection?.(undefined), [onActiveSelection]);
  const showTimeline = timeline && nodeViewId !== graph?.id;
  const timelineResource = isTimelineComponent(graph);
  // A timeline entered from the target's wrapper graph still previews as that
  // story line: its playback transition and dialogue stay in effect.
  const wrapperBound = !!graph && !!target?.graphId && parents.length === 1 && parentId === target.graphId && timelineWrapperCall(project, projectGraphs(project).find(item => item.id === parentId))?.timelineId === graph.id;
  const boundNode = target?.graphId === graph?.id || wrapperBound || linked?.kind === 'blueprint' && linked.blueprintId === graph?.id ? project.nodes.find(node => node.id === target?.nodeId) : undefined;
  const boundLine = boundNode?.kind === 'passage' ? boundNode.lines.find(line => line.id === target?.lineId) ?? boundNode.lines[0] : undefined;
  // Preview what the game runs: a story line's transition wraps whatever it calls.
  const playback = boundLine?.playback ?? (boundNode?.kind === 'chapterTitle' ? boundNode.playback : undefined) ?? (timeline ? graph?.playback : undefined);
  const standalone = (!!timeline && !wrapperBound) || !!boundLine?.silent || boundNode?.kind === 'chapterTitle';
  useEffect(() => { setTime(0); setSeekRequest(undefined); setDragPreview(undefined); }, [graph?.id]);
  const seek = (value: number) => { setTime(value); setSeekRequest(previous => ({ graphId: graph?.id, time: value, request: (previous?.request ?? 0) + 1 })); };
  const trackTime = useCallback((value: number) => setTime(value), []);
  const focus = useMemo(() => graph ? externalFocus?.graphId === graph.id ? externalFocus : { graphId: graph.id, request: 1 } : undefined, [graph?.id, externalFocus]);
  const selectGraph = useCallback((id: string, editorMode: 'graph' | 'timeline' = 'graph') => {
    setNodeViewId(editorMode === 'graph' ? id : undefined); setParents([]); setGraphId(id);
    onTarget(id === target?.graphId && requestedTarget?.nodeId ? { ...requestedTarget, editorMode } : { nodeId: '', graphId: id, editorMode });
  }, [onTarget, target, requestedTarget]);
  const openTimeline = useCallback((id: string, owner: string, callNodeId?: string) => { setNodeViewId(undefined);setParents(previous => [...previous, { graphId: owner, callNodeId }]); setGraphId(id); }, []);
  const back = () => { if (parentId) { setNodeViewId(undefined); setGraphId(parentId); setParents(previous => previous.slice(0, -1)); } };
  // Graph authoring has no live preview, including its expensive projection.
  // Materialize preview data only while the dedicated timeline is open.
  const callPreview = useMemo(() => showTimeline && graph ? timelineCallPreviewProject(dragPreview ?? project, graph.id, parents, linked?.kind === 'blueprint' && linked.blueprintId === (parents[0]?.graphId ?? graph.id) ? linked.inputs : undefined) : project, [showTimeline, project, dragPreview, graph, parents, linked]);
  const previewGraph = showTimeline ? projectGraphs(callPreview).find(item => item.id === graph?.id) : undefined;
  const minimumDuration = useMemo(() => previewGraph && timeline ? Math.max(.1, performanceTimeline(callPreview, previewGraph).until) : 5, [callPreview, previewGraph, timeline]);
  const previewProject = useMemo<Project>(() => previewGraph ? { ...timelinePreviewLayout(callPreview, previewGraph), nodes: [...project.nodes, { id: 'performance_preview', name: '演出预览', kind: 'passage', sceneId: boundNode?.sceneId ?? project.scenes[0]?.id ?? '', x: 0, y: 0, lines: [{ id: 'performance_preview_line', text: standalone ? '' : boundLine?.text ?? '', silent: standalone || !boundLine?.text, speakerId: standalone ? undefined : boundLine?.speakerId, playback, actions: [{ kind: 'blueprint', blueprintId: previewGraph.id }] }], next: boundNode && 'next' in boundNode ? boundNode.next : undefined }], entryId: 'performance_preview' } : project, [project, callPreview, previewGraph, boundLine, standalone, playback, boundNode]);
  const create = () => {
    const created = createBlueprintGraph('effect', availableBlueprintName(project, '新的蓝图'));
    created.performanceKind = 'dialogue';
    save('新建蓝图', draft => { addProjectGraphs(draft, created); }); selectGraph(created.id);
  };
  const createTimeline = () => {
    const created = createTimelinePreset(project);
    save('新建时间轴预设', draft => addProjectGraphs(draft, created)); selectGraph(created.id, 'timeline');
  };
  const preview = graph && showTimeline && <section className="performance-preview">
    <TextPreview playbackRequest={playbackRequest} embeddedTimeline={timeline} minimumDuration={minimumDuration} seekRequest={seekRequest?.graphId === graph.id ? seekRequest : undefined} onTimeChange={trackTime} key={graph.id} project={previewProject} source="" sourceMap={[]} selection={{ nodeId: 'performance_preview', lineId: 'performance_preview_line' }} nodeSelection="performance_preview" assetUrl={assetUrl} suspended={suspended} onNotice={onNotice} />
  </section>;
  return <div className="performance-workspace" role="region" aria-label={showTimeline ? '时间轴工作区' : '蓝图工作区'}>
    <div className="workspace-toolbar performance-context-toolbar">{navigation}{showTimeline ? <Clapperboard size={16} /> : <Workflow size={16} />}<strong>{showTimeline ? '时间轴预设' : '蓝图'}</strong>
      {parentId && <button className="small-button" onClick={back}><ArrowLeft size={14} />{isTimelineComponent(graphs.find(item => item.id === parentId)) ? "返回上层时间轴" : "返回蓝图"}</button>}
      <select className="performance-target" aria-label={timelineResource ? '时间轴预设' : '蓝图资源'} value={graph ? 'graph:' + graph.id : ''} onChange={event => selectGraph(event.target.value.slice(6), timelineResource ? 'timeline' : 'graph')}>
        {!graph && <option value="">选择蓝图</option>}<GraphResourceOptions project={project} graphs={graphs.filter(item => isTimelineComponent(item) === timelineResource)} prefix="graph:" />
      </select>
      {timeline && graph && !showTimeline && <button className="small-button" onClick={() => setNodeViewId(undefined)}>返回时间轴编辑</button>}
      {graph && !showTimeline && <code className="performance-call-hint">@{blueprintCallName(graph)}</code>}
      <div className="spacer" />{showTimeline ? <>
        <button className="small-button" disabled={graphs.length >= 256} onClick={createTimeline}><Plus size={14} />新建时间轴</button>
        <UiToolbarPopover label="时间轴选项" icon={<MoreHorizontal size={16} />}>
          <p>剧本调用：<code>@{graph && blueprintCallName(graph)}</code></p>
          <div className="ui-page-menu-actions"><button type="button" data-close-ui-popover onClick={() => graph && setNodeViewId(graph.id)}><Workflow size={14} />查看组件连线</button><button type="button" data-close-ui-popover disabled={graphs.length >= 256} onClick={create}><Plus size={14} />新建蓝图</button></div>
          <p>组件连线用于为演出接入变量或自定义逻辑。</p>
        </UiToolbarPopover>
      </> : <button className="small-button" disabled={graphs.length >= 256} onClick={create}><Plus size={14} />新建蓝图</button>}
    </div>
    {graph ? showTimeline ? <div className="performance-workspace-timeline"><PerformanceTimeline onTogglePlayback={togglePlayback} focus={focus} onActiveSelection={onActiveSelection} project={project} graph={graph} commit={commit} assetUrl={assetUrl} time={time} onSeek={seek} onBlueprint={() => setNodeViewId(graph.id)} onOpenTimeline={(id, callNodeId) => openTimeline(id, graph.id, callNodeId)} onNotice={onNotice} onPreviewProject={setDragPreview} preview={preview} /></div>
      : <div className="performance-workspace-body logic-only"><div className="performance-authoring graph"><BlueprintGraphEditor onLocateUsage={onLocateUsage} onOpenGraph={onOpenGraph ? followGraph : undefined} hideGraphPicker onActiveSelection={onActiveSelection} project={project} commit={commit} focus={focus} onGraphChange={selectGraph} onOpenTimeline={openTimeline} /></div></div>
      : <div className="performance-empty"><Workflow size={36} /><h3>在蓝图中组合事件与逻辑</h3><p>新建蓝图后，右键画布添加节点。时间轴预设在素材工作区单独管理。</p><button className="primary" onClick={create}>新建蓝图</button></div>}
  </div>;
}
