import type { BlueprintSelection } from '../core/ai-selection';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BlueprintGraph, Project } from '../core/model';
import { synchronizeBlueprintSignatures } from '../core/blueprint';
import { performanceTimeline, timelinePreviewLayout } from '../core/performance-timeline';
import { BlueprintGraphEditor, type BlueprintFocus } from './BlueprintGraphEditor';
import { PerformanceTimeline } from './PerformanceTimeline';
import { TextPreview } from './StoryPreview';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import './performance-workspace.css';

/** A component editor hosted by the UI draft; navigation never changes workspaces. */
export function UiEventTimeline({ project, graph, commit: commitDraft, assetUrl, navigation, focus, onOpenTimeline, onNotice, onActiveSelection }: {
  project: Project; graph: BlueprintGraph; commit: Commit; assetUrl: AssetUrl; navigation: ReactNode;
  focus?: BlueprintFocus; onOpenTimeline: (id: string, ownerId: string, callNodeId?: string) => void;
  onNotice: (message: string) => void;
  onActiveSelection?: (selection?: BlueprintSelection) => void;
}) {
  const [graphView, setGraphView] = useState(false);
  const [viewFocus, setViewFocus] = useState<BlueprintFocus>();
  useEffect(()=>{if(focus?.selection?.active()){setGraphView(true);setViewFocus(focus);}},[focus]);
  const selection = useRef<BlueprintSelection>(undefined);
  const select = useCallback((value?: BlueprintSelection) => {
    if (value) selection.current = value;
    onActiveSelection?.(value);
  }, [onActiveSelection]);
  const switchView = (value: boolean) => {
    if (selection.current) setViewFocus(previous => ({ ...selection.current!, request: (previous?.request ?? focus?.request ?? 0) + 1 }));
    setGraphView(value);
  };
  const [time, setTime] = useState(0);
  const [seekRequest, setSeekRequest] = useState<{ time: number; request: number }>();
  const model = useMemo(() => performanceTimeline(project, graph), [project, graph]);
  const commit: Commit = useCallback((label, edit) => commitDraft(label, draft => {
    edit(draft); synchronizeBlueprintSignatures(draft);
  }), [commitDraft]);
  const trackTime = useCallback((value: number) => setTime(value), []);
  const seek = (value: number) => {
    setTime(value); setSeekRequest(previous => ({ time: value, request: (previous?.request ?? 0) + 1 }));
  };
  const currentFocus = useMemo(() => viewFocus ?? (focus?.graphId === graph.id ? focus : { graphId: graph.id, request: 0 }), [graph.id, focus, viewFocus]);
  const previewProject = useMemo<Project>(() => ({ ...timelinePreviewLayout(project, graph, model), entryId: 'ui_timeline_preview', nodes: [{
    id: 'ui_timeline_preview', name: '界面调用的演出预览', kind: 'passage', sceneId: project.scenes[0]?.id ?? '', x: 0, y: 0,
    lines: [{ id: 'ui_timeline_preview_line', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: graph.id }] }],
  }] }), [project, graph.id]);
  const preview = <section className="performance-preview">
    <TextPreview embeddedTimeline minimumDuration={Math.max(5, model.until + 2)} seekRequest={seekRequest} onTimeChange={trackTime}
      project={previewProject} source="" sourceMap={[]} selection={{ nodeId: 'ui_timeline_preview', lineId: 'ui_timeline_preview_line' }}
      nodeSelection="ui_timeline_preview" assetUrl={assetUrl} onNotice={onNotice} />
  </section>;
  return <section className="ui-event-timeline" aria-label="界面事件的演出时间轴">
    <div className="workspace-toolbar">{navigation}<strong>{graph.name}</strong><div className="spacer" />
      <button className="text-button" onClick={() => switchView(!graphView)}>{graphView ? '返回时间轴编辑' : '查看组件连线'}</button>
    </div>
    <p className="ui-event-timeline-help">演出时间轴：安排画面、文字、角色和声音。控制界面控件，请返回事件图连接“设置属性”等节点。</p>
    {graphView ? <BlueprintGraphEditor fixedGraph project={project} commit={commit} focus={currentFocus} onOpenTimeline={onOpenTimeline} onActiveSelection={select} />
      : <div className="performance-workspace-timeline"><PerformanceTimeline project={project} graph={graph} commit={commit} assetUrl={assetUrl}
        focus={currentFocus} time={time} onSeek={seek} onBlueprint={() => switchView(true)} onNotice={onNotice} onActiveSelection={select}
        onOpenTimeline={(id, callNodeId) => onOpenTimeline(id, graph.id, callNodeId)} preview={preview} /></div>}
  </section>;
}
