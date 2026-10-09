import { projectGraphs, addProjectGraphs } from '../core/project-resources';
import type { BlueprintSelection } from '../core/ai-selection';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Clapperboard, Plus } from 'lucide-react';
import type { Project } from '../core/model';
import { createBlueprintGraph } from '../core/blueprint';
import { availableBlueprintName, blueprintCallName } from '../core/blueprint-names';
import { createTimelinePreset, isTimelineComponent } from '../core/timeline-component';
import { targetPerformance, performanceKind, performanceWorkspaceDraft, type PerformanceTarget } from '../core/performance-workspace';
import { BlueprintGraphEditor, type BlueprintFocus } from './BlueprintGraphEditor';
import { TextPreview } from './StoryPreview';
import { PerformanceTimeline } from './PerformanceTimeline';
import { performanceTimeline, timelinePreviewLayout } from '../core/performance-timeline';
import { timelineCallPreviewProject, type TimelinePreviewParent } from '../core/timeline-call-preview';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import './performance-workspace.css';
import { GraphResourceOptions } from './GraphResourceOptions';

export function PerformanceWorkspace({ project: savedProject, target: requestedTarget, onTarget, commit: save, assetUrl, focus: externalFocus, onNotice, suspended, onActiveSelection }: {
  project: Project; target?: PerformanceTarget; onTarget: (target: PerformanceTarget) => void; commit: Commit; assetUrl: AssetUrl;
  onActiveSelection?: (selection?: BlueprintSelection) => void; focus?: BlueprintFocus; onNotice: (message: string) => void; suspended?: boolean;
}) {
  const workspace = useMemo(() => performanceWorkspaceDraft(savedProject, requestedTarget), [savedProject, requestedTarget]);
  const { project, target } = workspace;
  const commit: Commit = useCallback((label, edit, options) => save(label, draft => { workspace.materialize(draft); edit(draft); }, options), [save, workspace]);
  const linked = useMemo(() => target ? targetPerformance(project, target).find(action => action.kind === 'blueprint' && (!target.graphId || action.blueprintId === target.graphId)) : undefined, [project, target]);
  const initialGraph = target?.graphId ?? (linked?.kind === 'blueprint' ? linked.blueprintId : projectGraphs(project).find(graph => !isTimelineComponent(graph))?.id ?? projectGraphs(project)[0]?.id);
  const [graphId, setGraphId] = useState(initialGraph);
  const [nodeViewId,setNodeViewId]=useState<string>();
  const [parents, setParents] = useState<TimelinePreviewParent[]>([]);
  const parentId = parents.at(-1)?.graphId;
  const [time, setTime] = useState(0);
  const [dragPreview, setDragPreview] = useState<Project>();
  const [seekRequest, setSeekRequest] = useState<{ time: number; request: number }>();
  const [playbackRequest, setPlaybackRequest] = useState(0);
  const togglePlayback = () => setPlaybackRequest(value => value + 1);
  const [sampleText, setSampleText] = useState('在这里预览这段演出的效果。');
  const [sampleSpeaker, setSampleSpeaker] = useState(project.characters.find(character => character.expressions.length)?.id ?? '');
  useEffect(() => { setGraphId(initialGraph); setParents([]); }, [initialGraph, project.id]);
  useEffect(()=>{if(externalFocus&&projectGraphs(project).some(g=>g.id===externalFocus.graphId)){setGraphId(externalFocus.graphId);setParents([]);setNodeViewId(externalFocus.selection?.active()?externalFocus.graphId:undefined);}},[externalFocus?.request, externalFocus?.graphId]);
  const graph = projectGraphs(project).find(graph => graph.id === graphId);
  const timeline = useMemo(() => isTimelineComponent(graph) && !!graph && !performanceTimeline(project, graph).reason, [project, graph]);
  useEffect(() => () => onActiveSelection?.(undefined), [onActiveSelection]);
  const showTimeline=timeline&&nodeViewId!==graph?.id;
  const kind = graph ? performanceKind(graph) : undefined;
  const boundNode = target?.graphId === graph?.id || linked?.kind === 'blueprint' && linked.blueprintId === graph?.id ? project.nodes.find(node => node.id === target?.nodeId) : undefined;
  const boundLine = boundNode?.kind === 'passage' ? boundNode.lines.find(line => line.id === target?.lineId) ?? boundNode.lines[0] : undefined;
  const playback = timeline ? graph?.playback : boundLine?.playback ?? (boundNode?.kind === 'chapterTitle' ? boundNode.playback : undefined);
  const standalone = !!timeline || !!boundLine?.silent || boundNode?.kind === 'chapterTitle';
  useEffect(() => { setTime(0); }, [graph?.id]);
  const seek = (value: number) => { setTime(value); setSeekRequest(previous => ({ time: value, request: (previous?.request ?? 0) + 1 })); };
  const trackTime = useCallback((value: number) => setTime(value), []);
  const focus = useMemo(() => graph ? externalFocus?.graphId === graph.id ? externalFocus : { graphId: graph.id, request: 1 } : undefined, [graph?.id, externalFocus]);
  const selectGraph = useCallback((id: string) => { setNodeViewId(undefined);setParents([]); setGraphId(id); onTarget(id === target?.graphId && requestedTarget?.nodeId ? requestedTarget : { nodeId: '', graphId: id, editorMode: 'graph' }); }, [onTarget, target, requestedTarget]);
  const openTimeline = useCallback((id: string, owner: string, callNodeId?: string) => { setNodeViewId(undefined);setParents(previous => [...previous, { graphId: owner, callNodeId }]); setGraphId(id); }, []);
  const back = () => { if (parentId) { setGraphId(parentId); setParents(previous => previous.slice(0, -1)); } };
  const callPreview = useMemo(() => graph ? timelineCallPreviewProject(dragPreview ?? project, graph.id, parents, linked?.kind === 'blueprint' && linked.blueprintId === (parents[0]?.graphId ?? graph.id) ? linked.inputs : undefined) : project, [project, dragPreview, graph, parents, linked]);
  const previewGraph = projectGraphs(callPreview).find(item => item.id === graph?.id);
  const minimumDuration = useMemo(() => previewGraph && timeline ? Math.max(.1, performanceTimeline(callPreview, previewGraph).until) : 5, [callPreview, previewGraph, timeline]);
  const previewProject = useMemo<Project>(() => previewGraph ? { ...timelinePreviewLayout(callPreview, previewGraph), nodes: [...project.nodes, { id: 'performance_preview', name: '演出预览', kind: 'passage', sceneId: boundNode?.sceneId ?? project.scenes[0]?.id ?? '', x: 0, y: 0, lines: [{ id: 'performance_preview_line', text: standalone ? '' : sampleText, silent: standalone, speakerId: standalone ? undefined : sampleSpeaker || undefined, playback, actions: [{ kind: 'blueprint', blueprintId: previewGraph.id }] }], next: boundNode && 'next' in boundNode ? boundNode.next : undefined }], entryId: 'performance_preview' } : project, [project, callPreview, previewGraph, sampleText, sampleSpeaker, standalone, playback, boundNode]);
  const create = () => {
    const created = createBlueprintGraph('effect', availableBlueprintName(project, '新的蓝图'));
    created.performanceKind = 'dialogue';
    save('新建蓝图', draft => { addProjectGraphs(draft, created); }); selectGraph(created.id);
  };
  const createTimeline = () => {
    const created = createTimelinePreset(project);
    save('新建时间轴预设', draft => addProjectGraphs(draft, created)); selectGraph(created.id);
  };
  const preview = graph && (kind || timeline) && <section className="performance-preview">
    <TextPreview playbackRequest={playbackRequest} embeddedTimeline={timeline} minimumDuration={minimumDuration} seekRequest={seekRequest} onTimeChange={trackTime} key={graph.id} project={previewProject} source="" sourceMap={[]} selection={{ nodeId: 'performance_preview', lineId: 'performance_preview_line' }} nodeSelection="performance_preview" assetUrl={assetUrl} suspended={suspended} onNotice={onNotice} />
  </section>;
  return <div className="performance-workspace" role="region" aria-label="演出工作区">
    <div className="workspace-toolbar"><Clapperboard size={16} /><strong>{timeline ? '时间轴预设' : '蓝图'}</strong>
      {timeline && parentId && <button className="small-button" onClick={back}><ArrowLeft size={14} />{isTimelineComponent(projectGraphs(project).find(item => item.id === parentId)) ? "返回上层时间轴" : "返回蓝图"}</button>}
      <select className="performance-target" aria-label="演出目标" value={graph ? 'graph:' + graph.id : ''} onChange={event => selectGraph(event.target.value.slice(6))}>
        {!graph && <option value="">选择蓝图或时间轴预设</option>}<GraphResourceOptions project={project} graphs={projectGraphs(project)} prefix="graph:" />
      </select>
      {timeline&&graph&&<button className="small-button" onClick={()=>setNodeViewId(showTimeline ? graph.id : undefined)}>{showTimeline ? '查看组件连线' : '返回时间轴编辑'}</button>}
      {graph && <code className="performance-call-hint">@{blueprintCallName(graph)}</code>}
      <div className="spacer" /><button className="small-button" disabled={projectGraphs(project).length >= 256} onClick={createTimeline}><Plus size={14} />新建时间轴预设</button><button className="small-button" disabled={projectGraphs(project).length >= 256} onClick={create}><Plus size={14} />新建蓝图</button>
    </div>
    {graph ? showTimeline ? <div className="performance-workspace-timeline"><PerformanceTimeline onTogglePlayback={togglePlayback} focus={focus} onActiveSelection={onActiveSelection} project={project} graph={graph} commit={commit} assetUrl={assetUrl} time={time} onSeek={seek} onBlueprint={() => setNodeViewId(graph.id)} onOpenTimeline={(id, callNodeId) => openTimeline(id, graph.id, callNodeId)} onNotice={onNotice} onPreviewProject={setDragPreview} preview={preview} /></div>
      : <div className={`performance-workspace-body ${kind && !timeline ? '' : 'logic-only'}`}><div className="performance-authoring graph"><BlueprintGraphEditor hideGraphPicker onActiveSelection={onActiveSelection} project={project} commit={commit} focus={focus} onGraphChange={selectGraph} onOpenTimeline={openTimeline} compact={!!kind} /></div>{!timeline&&preview}</div>
      : <div className="performance-empty"><Clapperboard size={36} /><h3>在蓝图中组合逻辑与时间轴</h3><p>添加时间轴组件并双击编辑。直接拖入项目素材，需要复用的素材可设为输入参数。</p><button className="primary" onClick={create}>新建蓝图</button></div>}
  </div>;
}
