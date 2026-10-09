import { projectGraphs, addProjectGraphs, setProjectGraphs } from '../core/project-resources';
import { assertTimelineEditDoesNotOverlap } from '../core/timeline-edit-validation';
import { ActorTransitionFields } from './ActorTransitionFields';
import { actorTransitionDefaults, parseActorTransitions, graphShowsActors } from '../core/actor-transitions';
import { uiControlValue } from '../core/ui-control-value';
import type { BlueprintSelectionRequest } from './blueprint-editor-selection';
import type { BlueprintSelection } from '../core/ai-selection';
import { uiControlValueType, uiTextInput } from '../core/ui-control-events';
import { uiPageAnimations } from '../core/ui-animation-clips';
import { UiDock } from './UiDock';
import { uiPageComponents } from '../core/ui-logic';
import { useBlueprintPanelLayout } from './BlueprintPanelLayout';
import { availableBlueprintName } from '../core/blueprint-names';
import { EntranceOffsetsEditor } from './EntranceOffsetsEditor';
import { maxBlueprintInputs, maxBlueprintOutputs } from '../core/model';
import { addTimelineComponent, isTimelineComponent, timelineForNode } from '../core/timeline-component';
import { CharacterPresetSelect } from './CharacterPresets';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, SelectionMode, useReactFlow, useNodesInitialized, useUpdateNodeInternals, type Node, type NodeProps, type Edge, type OnSelectionChangeParams, type ReactFlowProps } from '@xyflow/react';
import { ArrowLeft, CircleHelp, Copy, GitBranch, LibraryBig, Plus, Search, Settings2, Trash2, Workflow, X, ZoomIn, LayoutGrid, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Unplug, Link2, ChevronDown, ChevronRight, ListCollapse, Crosshair } from 'lucide-react';
import { layoutBlueprint } from './blueprint-layout';
import { allUiComponents, effectiveCharacter, makeId, type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Project, type VariableValue } from '../core/model';
import { uiProperties, uiPropertyApplies, type UiProperty } from '../core/ui';
import { playerPreferenceKeys, playerPreferences, type PlayerPreference } from '../core/preferences';
import { blueprintCatalog, blueprintCategories, blueprintInputValue, blueprintInputSource, blueprintOutputLabel, blueprintKindNames, blueprintNodeDefaults, blueprintPinsCompatible, blueprintTypeNames, callablePins, connectBlueprintPins, createBlueprintGraph, defaultBlueprintValue, synchronizeBlueprintNodeValuePins, synchronizeBlueprintSignatures, type BlueprintDataType, type BlueprintNodeType } from '../core/blueprint';
import { validateBlueprints } from '../core/blueprint-validation';
import type { Commit } from './editor';
import { Field, IconButton } from './components';
import { BlueprintValueInput } from './BlueprintValueInput';
import { blueprintNodeAssetFilter } from '../core/blueprint-assets';
import { PreferenceValueInput } from './PlayerPreferences';
import { studioEdgeTypes, type StudioEdge } from './SelectableEdge';
import { NodePicker, type NodePickerItem } from './NodePicker';
import { categoryAssets, assetCategories } from '../core/asset-library';
import { rawSavedBlueprintAction, updateSavedBlueprintAction, assignBlueprintGroup, blueprintGroup } from '../core/blueprint-authoring';
import { ActionEditor } from './Inspector';
import { BlueprintParameterValue } from './BlueprintCallFields';
import { BlueprintNameField } from './BlueprintNaming';
import { BlueprintInlineValue, BlueprintNodeFields } from './BlueprintNodeFields';
import { addInteractionBlueprintExample, addParallelMotionExample } from '../core/blueprint-examples';
import { adaptBlueprintNodeToPin } from '../core/blueprint';
import { BlueprintViewCache, reuseBlueprintEdges, type BlueprintNodeView } from './blueprint-view';
import { useBlueprintEdgeSelection } from './useBlueprintEdgeSelection';
import { useStableCallbacks } from './useStableCallbacks';
import { blueprintLayoutIsCurrent, registerBlueprintEditor, type BlueprintEditorCommand } from './blueprint-editor-actions';
import type { AiEditorResult } from '../core/ai-editor-commands';

type FlowNode = Node<BlueprintNodeView, 'blueprint'>;
const initialNodes: FlowNode[] = [];
type WireOrigin = { nodeId: string; pinId: string; direction: 'input' | 'output' };
const pinColors: Record<BlueprintDataType, string> = { exec: 'var(--blueprint-exec, #eef3fc)', boolean: 'var(--blueprint-boolean, #ea8392)', number: 'var(--blueprint-number, #85d4be)', string: 'var(--blueprint-string, #d3a4ed)', asset: 'var(--blueprint-asset, #e8be7b)', scene: 'var(--blueprint-scene, #83bcea)', character: 'var(--blueprint-character, #e89ec1)', ui: 'var(--blueprint-ui, #91c9e9)', component: 'var(--blueprint-component, #9cdec8)', any: 'var(--blueprint-any, #bac7db)' };
function GraphGroupField({ project, graph, commit, message }: { project: Project; graph: BlueprintGraph; commit: Commit; message: (value: string) => void }) {
  const saved = blueprintGroup(project, graph.id), [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved, graph.id]);
  return <Field label="资源分组" hint="用 / 嵌套分组；资源管理器和 / 调用菜单同步更新。"><input aria-label="蓝图资源分组" value={value} onChange={event => setValue(event.target.value)} onBlur={() => {
    if (value === saved) return;
    try { const copy = structuredClone(project); assignBlueprintGroup(copy, graph.id, value); commit('修改蓝图分组', draft => { draft.contentBrowser = copy.contentBrowser; }); }
    catch (error) { message(error instanceof Error ? error.message : String(error)); setValue(saved); }
  }} /></Field>;
}
const GraphNodeContents = memo(function GraphNodeContents({ data }: { data: BlueprintNodeView }) {
  const { node } = data;
  const inputs = node.pins.filter(pin => pin.direction === 'input');
  const outputs = node.pins.filter(pin => pin.direction === 'output');
  const pin = (item: BlueprintPin | undefined) => item && <div className={`blueprint-pin-slot ${item.direction}`} title={`${item.name} · ${blueprintTypeNames[item.dataType]}`}>
    <Handle type={item.direction === 'input' ? 'target' : 'source'} position={item.direction === 'input' ? Position.Left : Position.Right} id={item.id}
      aria-label={`${node.name} · ${item.name} · ${item.direction === 'input' ? '输入' : '输出'}`} className={item.dataType === 'exec' ? 'exec-pin' : ''} style={{ background: pinColors[item.dataType] }} />
    <span>{item.name}</span>
    {!data.parametersCollapsed && data.inputSources.has(item.id) && <div className="blueprint-pin-source" title={'来自：'+data.inputSources.get(item.id)}>来自：{data.inputSources.get(item.id)}</div>}
    {!data.parametersCollapsed && item.direction === 'input' && item.dataType !== 'exec' && !data.connectedInputs.has(item.id) && <div className="blueprint-pin-value nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()}><BlueprintInlineValue project={data.project} graph={data.graph} node={node} pin={item} edit={data.edit} /></div>}
  </div>;
  return <>
    <div className="graph-node-title"><GitBranch size={14} /><strong>{node.name}</strong>{data.invalid && <span title="请完成右侧参数">待完善</span>}<button className="node-collapse nodrag nopan" title={data.parametersCollapsed ? '展开节点参数' : '收起节点参数'} aria-label={data.parametersCollapsed ? '展开节点参数' : '收起节点参数'} aria-expanded={!data.parametersCollapsed} onClick={event => { event.stopPropagation(); data.toggleParameters(); }}>{data.parametersCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button></div>
    <div className="graph-node-detail" title={data.summary}>{data.summary}</div>
    {!data.parametersCollapsed && <div className="blueprint-node-fields nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()}><BlueprintNodeFields project={data.project} graph={data.graph} node={node} edit={data.edit} /></div>}
    {Array.from({ length: Math.max(inputs.length, outputs.length) }, (_, index) => <div className="blueprint-pin-row" key={index}>{pin(inputs[index]) ?? <div />}{pin(outputs[index]) ?? <div />}</div>)}
  </>;
});
const GraphNode = memo(function GraphNode({ data, selected }: NodeProps<FlowNode>) {
  return <div className={`graph-node blueprint-graph-node node-kind-${data.node.type} ${selected ? 'selected' : ''} ${data.invalid ? 'invalid' : ''} ${data.node.type === 'comment' ? 'comment' : ''} ${data.parametersCollapsed ? 'parameters-collapsed' : ''}`}><GraphNodeContents data={data} /></div>;
}, (previous, next) => previous.data === next.data && previous.selected === next.selected);
const nodeTypes = { blueprint: GraphNode };
export interface BlueprintFocus { selection?:BlueprintSelectionRequest; graphId: string; nodeId?: string; objectInstanceId?:string; request: number }
export interface UiGraphWorkspace { pageId:string; selectedComponentId?:string; toolbar:ReactNode; library:(add:(type:BlueprintNodeType,properties?:Record<string,VariableValue>)=>void)=>ReactNode; auxiliary:ReactNode; auxiliaryOpen:boolean }
interface Props { hideGraphPicker?: boolean; onOpenUiAnimation?:(id:string,nodeId?:string)=>void; fixedGraph?:boolean; uiWorkspace?:UiGraphWorkspace; onActiveSelection?: (selection?: BlueprintSelection) => void; project: Project; commit: Commit; onBack?: () => void; focus?: BlueprintFocus; compact?: boolean; onGraphChange?: (id: string) => void; onOpenTimeline?: (id: string, ownerId: string, callNodeId?: string) => void }

export const BlueprintGraphEditor = memo(function BlueprintGraphEditor(props: Props) {
  return <ReactFlowProvider key={props.project.id}><GraphEditor {...props} /></ReactFlowProvider>;
});

function GraphEditor({ hideGraphPicker, project, commit: commitProject, onBack, focus, compact, onGraphChange, onOpenTimeline, onActiveSelection, uiWorkspace, fixedGraph, onOpenUiAnimation }: Props) {
  const graphs = projectGraphs(project) ?? [];
  const [graphId, setGraphId] = useState(focus?.graphId ?? graphs.find(item => !isTimelineComponent(item))?.id ?? '');
  const graph = uiWorkspace || fixedGraph ? graphs.find(item=>item.id===focus?.graphId) : graphs.find(item => item.id === graphId) ?? graphs.find(item => !isTimelineComponent(item));
  const [selectedId, setSelectedId] = useState<string | undefined>(focus?.nodeId);
  const { selectedEdgeIds, selectedEdgeId, setSelectedEdgeIds, setSelectedEdgeId, onEdgesChange } = useBlueprintEdgeSelection<FlowNode>(graph?.id);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const pendingSelection = useRef<string | undefined>(focus?.nodeId);
  const collapseKey = `vns:blueprint-parameters:${project.id}`;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem(collapseKey) ?? '[]'); return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []); } catch { return new Set(); }
  });
  const toggleParameters = useCallback((id: string) => setCollapsed(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; }), []);
  useEffect(() => { try { localStorage.setItem(collapseKey, JSON.stringify([...collapsed])); } catch { /* Optional editor preference. */ } }, [collapsed, collapseKey]);
  const allParametersCollapsed = !!graph?.nodes.length && graph.nodes.every(node => collapsed.has(node.id));
  const [paletteOpen, setPaletteOpen] = useState(() => { try { return localStorage.getItem('vns:blueprint-palette') === 'true'; } catch { return false; } });
  const [propertiesOpen, setPropertiesOpen] = useState(!compact);
  const panelLayout = useBlueprintPanelLayout(paletteOpen, propertiesOpen);
  const [arranging, setArranging] = useState(false);
  const arrangingNow = useRef(false), mounted = useRef(true);
  const latestGraph = useRef({ projectId: project.id, graph });
  latestGraph.current = { projectId: project.id, graph };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const canvas = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [variableDrop,setVariableDrop]=useState<{id:string;x:number;y:number;position:{x:number;y:number}}>();
  const [componentDrop,setComponentDrop]=useState<{id:string;x:number;y:number;position:{x:number;y:number}}>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [uiContextOnly,setUiContextOnly]=useState(true);
  const uiNodeAllowed=(type:string)=>!uiWorkspace||!uiContextOnly||['界面与动画','流程控制','状态与计算','复用与参数'].includes(blueprintCatalog[type as BlueprintNodeType].category)||['delay','uiAction','playSound','comment'].includes(type);
  const [inspectorTab, setInspectorTab] = useState<'node' | 'interface' | 'links'>('node');
  const [autoConnect, setAutoConnect] = useState(true);
  const [message, setMessage] = useState('');
  const commit = useCallback((label: string, edit: Parameters<Commit>[1]) => {
    let applied = false, failure: unknown;
    try {
      commitProject(label, draft => {
        const before = structuredClone(draft);
        try { edit(draft); synchronizeBlueprintSignatures(draft); assertTimelineEditDoesNotOverlap(before, draft); }
        catch (error) { failure = error; throw error; }
        applied = true;
      });
    } catch (error) { failure = error; }
    // Stage commits may catch the exception themselves; UI drafts propagate it.
    if (failure) setMessage(failure instanceof Error ? failure.message : String(failure));
    else if (applied) setMessage('');
    return applied && !failure;
  }, [commitProject]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; position: { x: number; y: number }; wire?: WireOrigin }>();
  const [viewCache] = useState(() => new BlueprintViewCache());
  const edgeCache = useRef<StudioEdge[]>([]);
  const flow = useReactFlow<FlowNode>();
  const { setNodes: setFlowNodes, getNodes: getFlowNodes } = flow;
  const nodesInitialized = useNodesInitialized();
  const framedRequest = useRef<string | undefined>(undefined);
  const frameNode = (id: string) => flow.fitView({ nodes: [{id}], padding: .2, minZoom: .65, maxZoom: 1, duration: 160 });
  const selectNode = useCallback((id?: string) => {
    pendingSelection.current = id && !getFlowNodes().some(node => node.id === id) ? id : undefined;
    setSelectedId(id); setSelectedEdgeId();
    setFlowNodes(previous => previous.map(node => node.selected === (node.id === id) ? node : { ...node, selected: node.id === id }));
  }, [getFlowNodes, setFlowNodes, setSelectedEdgeId]);
  const onSelectionChange = useCallback(({ nodes }: OnSelectionChangeParams<FlowNode, StudioEdge>) => {
    const ids = nodes.map(node => node.id);
    setSelectedNodeIds(previous => previous.length === ids.length && previous.every((id, i) => id === ids[i]) ? previous : ids);
    setSelectedId(previous => nodes.some(node => node.id === previous) ? previous : nodes[0]?.id);
  }, []);
  const updateNodeInternals = useUpdateNodeInternals();
  const diagnostics = useMemo(() => validateBlueprints(project), [project]);
  const activeGraphId = graph?.id;
  const editNode = useCallback((id: string, edit: (node: BlueprintNode) => void) => commit('修改节点参数', draft => {
    const graph=projectGraphs(draft).find(item=>item.id===activeGraphId),target=graph?.nodes.find(item=>item.id===id);
    if(target&&graph){edit(target);synchronizeBlueprintNodeValuePins(draft,graph,target);graph.links=graph.links.filter(link=>graph.nodes.find(n=>n.id===link.fromNodeId)?.pins.some(p=>p.id===link.fromPinId)&&graph.nodes.find(n=>n.id===link.toNodeId)?.pins.some(p=>p.id===link.toPinId));}
  }), [commit, activeGraphId]);
  const nodeViews = useMemo(() => graph ? viewCache.update(project, graph, diagnostics, editNode, collapsed, toggleParameters) : [], [project, graph, diagnostics, editNode, viewCache, collapsed, toggleParameters]);
  const pinLayout = useMemo(() => nodeViews.map(({ node, data }) => `${node.id}:${node.pins.map(pin => `${pin.id}:${pin.direction}:${pin.dataType}`).join(',')}:${[...data.connectedInputs].sort().join(',')}:${data.parametersCollapsed}`).join('|'), [nodeViews]);
  // Canvas movement stays in React Flow's store. Commit authored positions on
  // drop, and refresh handles only after the editable contents have changed.
  useEffect(() => {
    const frame = requestAnimationFrame(() => updateNodeInternals(getFlowNodes().map(node => node.id)));
    return () => cancelAnimationFrame(frame);
  }, [pinLayout, getFlowNodes, updateNodeInternals]);
  const selected = graph?.nodes.find(node => node.id === selectedId);
  const activeNodeIds = graph?.nodes.filter(n => selectedNodeIds.includes(n.id)).map(n => n.id) ?? [];
  const activeLinkIds = graph?.links.filter(l => selectedEdgeIds.has(l.id)).map(l => l.id) ?? [];
  const activeSelectionKey = JSON.stringify([graph?.id, selected?.id, activeNodeIds, activeLinkIds]);
  useEffect(() => { onActiveSelection?.(graph ? {graphId:graph.id,nodeId:selected?.id,nodeIds:activeNodeIds,linkIds:activeLinkIds} : undefined); }, [activeSelectionKey, onActiveSelection]);
  useEffect(() => () => onActiveSelection?.(undefined), [onActiveSelection]);
  const selectedCall = selected && (selected.type === 'callFunction' || selected.type === 'callMacro') ? graphs.find(item => item.id === selected.properties.graphId) : undefined;
  const selectedIssues = diagnostics.filter(issue => issue.nodeId === selectedId);
  const selectedLink = graph?.links.find(link => link.id === selectedEdgeId);
  const linkDescription = (link: NonNullable<typeof selectedLink>) => {
    const from = graph?.nodes.find(node => node.id === link.fromNodeId), to = graph?.nodes.find(node => node.id === link.toNodeId);
    const fromPin = from?.pins.find(pin => pin.id === link.fromPinId);
    const label = from && graph && fromPin?.dataType !== 'exec' ? blueprintOutputLabel(project,graph,from,link.fromPinId) : `${from?.name ?? '缺失节点'} · ${fromPin?.name ?? link.fromPinId}`;
    return `${label} → ${to?.name ?? '缺失节点'} · ${to?.pins.find(pin => pin.id === link.toPinId)?.name ?? link.toPinId}`;
  };
  useEffect(() => { try { localStorage.setItem('vns:blueprint-palette', String(paletteOpen)); } catch { /* Optional preference. */ } }, [paletteOpen]);
  useEffect(() => { setSelectedEdgeIds(new Set([...selectedEdgeIds].filter(id => graph?.links.some(link => link.id === id)))); }, [graph, selectedEdgeIds, setSelectedEdgeIds]);

  useEffect(() => { commit('更新蓝图接口', synchronizeBlueprintSignatures); }, [project.id]);
  useEffect(() => {
    if (!focus) return;
    if (focus.selection) { setGraphId(focus.graphId); return; }
    // The host echoes graph selection. Keep the node selected by createGraph
    // so adding the first action still connects it to the new start event.
    if (focus.graphId === graphId && !focus.nodeId) return;
    setGraphId(focus.graphId); selectNode(focus.nodeId); setInspectorTab('node'); setPropertiesOpen(!compact || !!focus.nodeId);
  }, [focus?.request, focus?.graphId, focus?.nodeId]);
  useEffect(() => {
    setFlowNodes(previous => {
      const byId = new Map(previous.map(node => [node.id, node]));
      const requested = pendingSelection.current;
      if (nodeViews.some(({ node }) => node.id === requested)) pendingSelection.current = undefined;
      return nodeViews.map(({ node, data }) => {
        const before = byId.get(node.id);
        const selected = requested ? node.id === requested : before?.selected ?? false;
        if (before?.data === data && before.position.x === node.x && before.position.y === node.y && before.selected === selected) return before;
        return { ...before, id: node.id, type: 'blueprint', position: { x: node.x, y: node.y }, selected, data };
      });
    });
  }, [nodeViews, setFlowNodes]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"], .content-browser, .modal-backdrop, .sidebar, .node-picker')) return;
      if (event.key === 'Escape') { setContextMenu(undefined); selectNode(); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedEdgeIds.size || getFlowNodes().some(node => node.selected))) { event.preventDefault(); deleteSelected(); }
      if (event.key.toLocaleLowerCase() === 'd' && (event.ctrlKey || event.metaKey) && selected) { event.preventDefault(); duplicateSelected(); }
      if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target as HTMLElement)?.closest('button')) { event.preventDefault(); openNodePicker(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, selected, selectedEdgeIds, graph, getFlowNodes, selectNode]);
  useEffect(() => {
    if (!graph || !nodesInitialized || focus?.selection) return;
    const request = JSON.stringify([graph.id, focus?.graphId, focus?.nodeId, focus?.request]);
    if (framedRequest.current === request) return;
    const frame = requestAnimationFrame(() => {
      framedRequest.current = request;
      const id = focus?.graphId === graph.id && graph.nodes.some(n=>n.id===focus.nodeId) ? focus.nodeId : undefined;
      if (id) void frameNode(id);
      else void flow.fitView({ padding: .22, maxZoom: 1, duration: 160 });
    });
    return () => cancelAnimationFrame(frame);
  }, [graph?.id, focus?.graphId, focus?.nodeId, focus?.request, nodesInitialized]);
  const selectionStarted=useRef<BlueprintSelectionRequest>(undefined);
  const liveEdgeSelection=useRef(selectedEdgeIds);liveEdgeSelection.current=selectedEdgeIds;
  useEffect(()=>()=>focus?.selection?.finish({status:'cancelled',message:'画布或定位请求已切换，选择操作已取消。'}),[focus?.selection]);
  useEffect(()=>{
    const request=focus?.selection;
    if(!request?.active()||selectionStarted.current===request||graph?.id!==focus?.graphId||!graph)return;
    if(graph.nodes.length&&(!nodesInitialized||graph.nodes.some(n=>!getFlowNodes().some(f=>f.id===n.id))))return;
    selectionStarted.current=request;
    if(request.nodeIds.some(id=>graph.nodes.filter(n=>n.id===id).length!==1)||request.linkIds.some(id=>graph.links.filter(l=>l.id===id).length!==1)){
      request.finish({status:'failed',message:'节点或连线已变化，本次选择没有应用。'});return;
    }
    const ids=new Set(request.nodeIds);pendingSelection.current=undefined;
    setFlowNodes(nodes=>nodes.map(n=>({...n,selected:ids.has(n.id)})));
    setSelectedId(request.nodeIds[0]);setSelectedEdgeIds(new Set(request.linkIds));setContextMenu(undefined);
    setInspectorTab(request.linkIds.length?'links':'node');setPropertiesOpen(true);
    void (async()=>{
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      if(!request.active())return;
      const same=()=>latestGraph.current.projectId===project.id&&latestGraph.current.graph?.id===graph.id&&
        getFlowNodes().filter(n=>n.selected).length===ids.size&&getFlowNodes().filter(n=>n.selected).every(n=>ids.has(n.id))&&
        liveEdgeSelection.current.size===request.linkIds.length&&request.linkIds.every(id=>liveEdgeSelection.current.has(id));
      if(!same()){request.finish({status:'cancelled',message:'当前选择或画布已改变，操作已取消。'});return;}
      if(request.frame){
        const framed=new Set(ids);for(const link of graph.links.filter(l=>request.linkIds.includes(l.id))){framed.add(link.fromNodeId);framed.add(link.toNodeId);}
        if(framed.size)await flow.fitView({nodes:[...framed].map(id=>({id})),padding:.2,maxZoom:1,duration:160});
      }
      if(!request.active())return;
      if(!same()){request.finish({status:'cancelled',message:'当前选择或画布已改变，操作已取消。'});return;}
      const message=ids.size||request.linkIds.length?'已选中 '+ids.size+' 个节点 / '+request.linkIds.length+' 条连线。':'已清空当前蓝图的选择。';
      setMessage(message);request.finish({status:'completed',message});
    })().catch(()=>request.finish({status:'failed',message:'画布选择未完成，请重试。'}));
  },[focus?.selection, focus?.graphId, graph?.id, nodesInitialized, nodeViews]);
  const { disconnectLink } = useStableCallbacks({ disconnectLink: (id: string) => { if (!editGraph('断开蓝图连线', target => { target.links = target.links.filter(link => link.id !== id); })) return; setSelectedEdgeIds(new Set([...selectedEdgeIds].filter(value => value !== id))); setMessage('连线已断开，可使用 Ctrl+Z 撤销。'); } });
  const edges: StudioEdge[] = useMemo(() => edgeCache.current = reuseBlueprintEdges(edgeCache.current, (graph?.links ?? []).map(link => {
    const source = graph?.nodes.find(node => node.id === link.fromNodeId)?.pins.find(pin => pin.id === link.fromPinId);
    const target = graph?.nodes.find(node => node.id === link.toNodeId)?.pins.find(pin => pin.id === link.toPinId);
    const valid = source && target && blueprintPinsCompatible(source, target);
    return { id: link.id, source: link.fromNodeId, sourceHandle: link.fromPinId, target: link.toNodeId, targetHandle: link.toPinId, type: 'studio',
      selected: selectedEdgeIds.has(link.id), selectable: true, reconnectable: true, zIndex: selectedEdgeIds.has(link.id) ? 5 : 0,
      ariaLabel: `连线：${linkDescription(link)}`, data: { label: linkDescription(link), disconnect: disconnectLink, showLabel: selectedEdgeIds.size === 1 },
      style: { stroke: selectedEdgeIds.has(link.id) ? 'var(--editor-accent, #ffd38a)' : valid ? pinColors[source.dataType] : '#eb6f80', strokeWidth: selectedEdgeIds.has(link.id) ? 3 : source?.dataType === 'exec' ? 2.2 : 1.8, strokeDasharray: valid ? undefined : '5 4' } };
  })), [graph, selectedEdgeIds, disconnectLink]);
  const editGraph = (label: string, edit: (target: BlueprintGraph) => void) => {
    return !!graph && commit(label, draft => { const target = projectGraphs(draft)?.find(item => item.id === graph.id); if (target) {edit(target);for(const node of target.nodes)synchronizeBlueprintNodeValuePins(draft,target,node);target.links=target.links.filter(link=>target.nodes.find(n=>n.id===link.fromNodeId)?.pins.some(p=>p.id===link.fromPinId)&&target.nodes.find(n=>n.id===link.toNodeId)?.pins.some(p=>p.id===link.toPinId));} });
  };
  const editSelected = (label: string, edit: (node: BlueprintNode) => void) => editGraph(label, target => { const node = target.nodes.find(item => item.id === selectedId); if (node) edit(node); });
  const setProperty = (key: string, value: VariableValue | undefined) => editSelected('修改节点参数', node => {
    if (value === undefined) delete node.properties[key]; else node.properties[key] = value;
  });
  const defaultSelections = (node: BlueprintNode) => {
    if (['eventKey', 'eventTimer', 'showUiPage', 'closeUiPage'].includes(node.type)) node.properties.pageId = project.ui.customPages[0]?.id ?? '';
    if(node.type==='eventTextCommitted')node.properties.componentId=allUiComponents(project).find(c=>uiTextInput(project,c))?.id??'';
    if(node.type==='eventValueChanged')node.properties.componentId=allUiComponents(project).find(c=>uiControlValueType(project,c))?.id??'';
    if (['eventClick','eventButton'].includes(node.type)) node.properties.componentId = allUiComponents(project).find(component => component.kind === 'button')?.id ?? '';
    if (node.type === 'showBackground') node.properties.assetId = categoryAssets(project, 'image', 'scene')[0]?.id ?? '';
    if (node.type === 'playMusic' || node.type === 'playSound') node.properties.assetId = categoryAssets(project, 'audio', node.type === 'playMusic' ? 'bgm' : 'sound')[0]?.id ?? '';
    if (node.type === 'hideCharacter') {
      const character = project.characters[0];
      if (character) { node.properties.characterId = character.id;  }
    }
    if (node.type === 'getVariable' || node.type === 'setVariable') {
      const variable = project.variables[0];
      if (variable) { node.properties.variableId = variable.id; if (node.type === 'setVariable') node.properties.value = variable.initial; }
    }
    if (node.type === 'effect' && project.effects[0]) node.properties.effectId = project.effects[0].id;
    if (node.type === 'getInput' && graph?.exposedInputs[0]) node.properties.inputId = graph.exposedInputs[0].id;
    if (node.type === 'setOutput' && graph?.exposedOutputs[0]) node.properties.outputId = graph.exposedOutputs[0].id;
    if (['setUiProperty', 'getUiProperty', 'animateUiProperty', 'stopUiAnimation', 'resetUiComponent', 'playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type)) {
      const component = allUiComponents(project).find(item => !['playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type) || item.kind === 'spine');
      if (component) {
        node.properties.componentId = component.id;
        if (node.type === 'playSpine') node.properties.animation = project.assets.find(item => item.id === component.assetId)?.spine?.animations[0]?.name ?? '';
      }
    }
    if(['playUiAnimation','stopUiAnimationPlayback'].includes(node.type))node.properties.animationId=(uiWorkspace?uiPageAnimations(project,uiWorkspace.pageId):project.ui.animations)?.[0]?.id??'';
    if(uiWorkspace){
      const eventPageId=graph?.uiPageId??uiWorkspace.pageId,components=uiPageComponents(project,eventPageId),component=components.find(c=>c.id===uiWorkspace.selectedComponentId)??components[0];
      if(['eventKey','eventTimer'].includes(node.type))Object.assign(node.properties,{pageId:eventPageId,uiInstanceId:graph?.uiInstanceId??(eventPageId.startsWith('ui:')?project.ui.activeInstanceId??'base':'')});
      if(node.type==='eventTextCommitted')Object.assign(node.properties,{componentId:(uiTextInput(project,component)?component:components.find(c=>uiTextInput(project,c)))?.id??'',uiInstanceId:graph?.uiInstanceId??''});
      if(node.type==='eventValueChanged')Object.assign(node.properties,{componentId:(uiControlValueType(project,component)?component:components.find(c=>uiControlValueType(project,c)))?.id??'',uiInstanceId:graph?.uiInstanceId??''});
      if(['eventClick','eventButton'].includes(node.type))Object.assign(node.properties,{componentId:components.find(c=>c.id===component?.id&&c.kind==='button')?.id??components.find(c=>c.kind==='button')?.id??'',uiInstanceId:graph?.uiInstanceId??''});
      if(['getUiProperty','setUiProperty','animateUiProperty','stopUiAnimation','resetUiComponent'].includes(node.type))node.properties.componentId=component?.id??'';
    }
  };
  const chooseGraph = (id: string) => { if (fixedGraph && !isTimelineComponent(graphs.find(item => item.id === id))) { setMessage('请在蓝图工作区编辑这个复用流程。'); return; } if (isTimelineComponent(graphs.find(item => item.id === id)) && onOpenTimeline && graph) { onOpenTimeline(id, graph.id, selected?.properties.graphId === id ? selected.id : undefined); return; } setGraphId(id); onGraphChange?.(id); selectNode(); setContextMenu(undefined); setInspectorTab('node'); setMessage(''); };
  const inspectEdge = () => { setInspectorTab('links'); setPropertiesOpen(true); setContextMenu(undefined); setMessage('连线已选中。按 Delete 断开，或拖动连线端点改接。'); };
  const selectEdge = (id: string) => { selectNode(); setSelectedEdgeId(id); inspectEdge(); };
  const openNodePicker = (point?: { x: number; y: number }) => {
    const bounds = canvas.current?.getBoundingClientRect(); if (!bounds) return;
    const at = point ?? { x: bounds.x + bounds.width * 0.4, y: bounds.y + bounds.height * 0.3 };
    setContextMenu({ ...at, position: flow.screenToFlowPosition(at) });
  };
  const arrange = async (): Promise<AiEditorResult> => {
    if (!graph || !graph.nodes.length) return {status:'cancelled',message:'当前蓝图没有可排列的节点。'};
    if (arrangingNow.current) return {status:'failed',message:'蓝图正在排列，请稍后重试。'};
    arrangingNow.current = true; setArranging(true);
    const source = {projectId:project.id,graph:structuredClone(graph)};
    try {
      const layout = await layoutBlueprint({ id: graph.id, layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '75', 'elk.layered.spacing.nodeNodeBetweenLayers': '120' }, children: graph.nodes.map(node => ({ id: node.id, width: 340, height: 150 + Math.max(node.pins.filter(pin => pin.direction === 'input').length, node.pins.filter(pin => pin.direction === 'output').length) * 65 })), edges: graph.links.map(link => ({ id: link.id, sources: [link.fromNodeId], targets: [link.toNodeId] })) });
      if (!mounted.current || !blueprintLayoutIsCurrent(source,latestGraph.current)) return {status:'cancelled',message:'排列期间蓝图已变化或关闭，旧结果未应用。请重新排列。'};
      let applied=false;
      const accepted = editGraph('自动排列蓝图', target => {
        if (!blueprintLayoutIsCurrent(source,{projectId:project.id,graph:target})) return;
        for (const position of layout.children ?? []) { const node = target.nodes.find(item => item.id === position.id); if (node) { node.x = position.x ?? node.x; node.y = position.y ?? node.y; } }
        applied=true;
      });
      if(!accepted || !applied)return {status:'failed',message:'节点位置未应用，请检查当前文本或蓝图中的错误。'};
      // Wait for committed positions to reach React Flow before fitting them.
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      if(mounted.current&&latestGraph.current.projectId===project.id&&latestGraph.current.graph?.id===graph.id)await flow.fitView({padding:.18,maxZoom:1,duration:180});
      return {status:'completed',message:'已自动排列「'+graph.name+'」，可撤销；尚未保存工程。'};
    } catch { return {status:'failed',message:'自动排列未完成，请稍后重试。'}; }
    finally { arrangingNow.current=false;if(mounted.current)setArranging(false); }
  };
  const { editorCommand } = useStableCallbacks({editorCommand:async(command:BlueprintEditorCommand):Promise<AiEditorResult>=>{
    if(!graph)return {status:'failed',message:'当前没有节点蓝图。'};
    if(command==='arrangeBlueprint'){const result=await arrange();if(mounted.current)setMessage(result.message);return result;}
    if(command==='frameBlueprint'){
      const fitted=await flow.fitView({padding:.22,maxZoom:1,duration:180});
      return fitted?{status:'completed',message:'已显示「'+graph.name+'」的全部节点。'}:{status:'cancelled',message:'当前没有可显示的节点，请等待画布加载后重试。'};
    }
    if(command==='collapseBlueprintNodes'||command==='expandBlueprintNodes'){
      setCollapsed(previous=>{const next=new Set(previous);for(const node of graph.nodes)command==='collapseBlueprintNodes'?next.add(node.id):next.delete(node.id);return next;});
      return {status:'completed',message:command==='collapseBlueprintNodes'?'已收起当前蓝图的节点参数。':'已展开当前蓝图的节点参数。'};
    }
    setPropertiesOpen(true);setInspectorTab(command==='showBlueprintConnections'?'links':command==='showBlueprintInterface'?'interface':'node');
    return {status:'completed',message:'已打开当前蓝图的'+(command==='showBlueprintConnections'?'连线列表。':command==='showBlueprintInterface'?'输入与输出。':'节点属性。')};
  }});
  useEffect(()=>graph?registerBlueprintEditor(project.id,graph.id,editorCommand):undefined,[project.id, graph?.id, editorCommand]);
  const createGraph = (kind: BlueprintGraph['kind'], starter = false) => {
    const next = createBlueprintGraph(kind, availableBlueprintName(project, starter ? '我的第一段演出' : kind === 'macro' ? `用户节点 ${graphs.filter(item => item.kind === 'macro').length + 1}` : kind === 'minigame' ? `小游戏逻辑 ${graphs.filter(item => item.kind === 'minigame').length + 1}` : `新蓝图 ${graphs.length + 1}`));
    if (starter) {
      const types: BlueprintNodeType[] = [...(project.assets.some(asset => asset.kind === 'image') ? ['showBackground' as const] : []), ...(project.characters.some(character => effectiveCharacter(project, character.id)?.expressions.length) ? ['showCharacter' as const] : []), 'delay', 'return'];
      for (const type of types) {
        const node = blueprintNodeDefaults(type, next.nodes.length); defaultSelections(node);
        const previous = next.nodes.at(-1)!; node.x = previous.x + 420; node.y = previous.y;
        next.nodes.push(node); connectBlueprintPins(next, previous.id, previous.pins.find(pin => pin.direction === 'output' && pin.dataType === 'exec')!.id, node.id, 'exec_in');
      }
    }
    if (!commit(starter ? '创建入门示例' : '新建蓝图', draft => { addProjectGraphs(draft, next); })) return;
    setGraphId(next.id); onGraphChange?.(next.id); selectNode(next.nodes[starter ? 1 : 0]?.id); setInspectorTab('node');
    setMessage(starter ? '示例已连接好。选择节点修改参数，再把这张蓝图添加到对白演出或场景事件中。' : '从左侧添加节点。选中事件开始后添加常用演出，可以自动接线。');
  };
  const addExample = (kind: string) => {
    if (!kind) return;
    const next = structuredClone(project);
    const id = kind === 'interaction' ? addInteractionBlueprintExample(next).graphId : addParallelMotionExample(next);
    if (!commit('添加蓝图示例', draft => { setProjectGraphs(draft, projectGraphs(next)); draft.ui.customPages = next.ui.customPages; draft.variables = next.variables; draft.contentBrowser = next.contentBrowser; })) return;
    chooseGraph(id);
    setMessage(kind === 'interaction' ? `已添加蓝图与自定义界面。在文本中输入 @${projectGraphs(next).find(item => item.id === id)!.name} 调用；在界面编辑器中修改按钮和布局。` : '镜头不等待 → 震动等待，两种演出同时播放。节点上可直接调整时长和幅度。');
  };
  const addNode = (type: BlueprintNodeType, called?: BlueprintGraph, position?: { x: number; y: number }, properties?: Record<string, VariableValue>, wire?: WireOrigin) => {
    if (!graph || graph.nodes.length >= 512 || (type === 'event' && graph.nodes.some(node => node.type === 'event'))) return;
    const node = blueprintNodeDefaults(type, graph.nodes.length); defaultSelections(node);
    if (called) { node.name = called.name; node.properties.graphId = called.id; node.pins = callablePins(called); }
    if (properties) Object.assign(node.properties, properties);
    synchronizeBlueprintNodeValuePins(project,graph,node);
    const available = selected?.pins.filter(pin => pin.direction === 'output' && pin.dataType === 'exec' && !graph.links.some(link => link.fromNodeId === selected.id && link.fromPinId === pin.id)) ?? [];
    const from = !wire && autoConnect && available.length === 1 && node.pins.some(pin => pin.id === 'exec_in') ? available[0] : undefined;
    const wireNode = wire && graph.nodes.find(item => item.id === wire.nodeId), wirePin = wireNode?.pins.find(pin => pin.id === wire?.pinId);
    adaptBlueprintNodeToPin(node, wirePin);
    const destination = wirePin && node.pins.find(pin => wirePin.direction === 'output' ? blueprintPinsCompatible(wirePin, pin) : blueprintPinsCompatible(pin, wirePin));
    if (wire && (!wirePin || !destination)) { setMessage('没有兼容的连接点，请选择其他节点。'); return; }
    if (position) { node.x = position.x; node.y = position.y; }
    else if (selected && from) { node.x = selected.x + 420; node.y = selected.y; }
    else {
      const viewport = document.querySelector('.generic-blueprint-workspace .flow-container')?.getBoundingClientRect();
      if (viewport) { const point = flow.screenToFlowPosition({ x: viewport.x + viewport.width / 2 - 100, y: viewport.y + viewport.height / 2 - 50 }); node.x = point.x; node.y = point.y; }
    }
    const height = (item: BlueprintNode) => 150 + Math.max(item.pins.filter(pin => pin.direction === 'input').length, item.pins.filter(pin => pin.direction === 'output').length) * 65;
    // Keep the complete node rectangles apart, including their connection
    // points. Near-identical origins are not the only kind of overlap.
    for (let attempt = 0; !position && attempt <= graph.nodes.length; attempt++) {
      const overlap = graph.nodes.find(other => node.x < other.x + 350 && node.x + 350 > other.x && node.y < other.y + height(other) + 28 && node.y + height(node) + 28 > other.y);
      if (!overlap) break;
      node.y = overlap.y + height(overlap) + 40;
    }
    if (!editGraph('添加蓝图节点', target => {
      target.nodes.push(node);
      if (selected && from) connectBlueprintPins(target, selected.id, from.id, node.id, 'exec_in');
      if (wire && destination) {
        const error = wire.direction === 'output' ? connectBlueprintPins(target, wire.nodeId, wire.pinId, node.id, destination.id) : connectBlueprintPins(target, node.id, destination.id, wire.nodeId, wire.pinId);
        if (error) throw new Error(error);
      }
    })) return;
    selectNode(node.id); setInspectorTab('node'); setPropertiesOpen(true);
    setMessage(wire ? `已添加${node.name}并接线，可一次撤销。` : from ? `已连接：${selected!.name} → ${node.name}` : `已添加${node.name}。拖动两侧连接点即可连线。`);
    if (!position) void flow.setCenter(node.x + 120, node.y + 100, { zoom: Math.max(0.65, flow.getZoom()), duration: 180 });
  };
  const droppedControlValue = uiControlValue(project, uiWorkspace && componentDrop ? uiPageComponents(project, uiWorkspace.pageId).find(c => c.id === componentDrop.id) : undefined);
  const controlValueItems: NodePickerItem[] = droppedControlValue?.read && componentDrop ? [
    { id: 'read-control-value', name: '读取控件值', category: '控件值', hint: '读取：' + droppedControlValue.label, choose: () => addNode(droppedControlValue.read!.type, undefined, componentDrop.position, droppedControlValue.read!.properties) },
    { id: 'write-control-value', name: '设置控件值', category: '控件值', hint: '修改：' + droppedControlValue.label + '；所有使用它的控件同步更新。', choose: () => addNode(droppedControlValue.write!.type, undefined, componentDrop.position, droppedControlValue.write!.properties) },
  ] : droppedControlValue?.error ? [{ id: 'missing-control-value', name: '控件值未就绪', category: '控件值', hint: droppedControlValue.error, disabled: true, choose: () => {} }] : [];
  const addTimeline = () => {
    if (!graph) return;
    let nodeId: string | undefined;
    try {
      if (!commit('添加时间轴组件', draft => { nodeId = addTimelineComponent(draft, graph.id, selected?.id, contextMenu?.position).node.id; })) return;
      selectNode(nodeId); setInspectorTab('node'); setPropertiesOpen(true); setContextMenu(undefined);
      setMessage('已添加时间轴组件。双击进入编辑；素材设为参数后会出现在组件输入端口。');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const deleteSelected = () => {
    const ids = new Set(getFlowNodes().filter(node => node.selected).map(node => node.id));
    if (!ids.size && !selectedEdgeIds.size) return;
    if (!editGraph('删除蓝图所选内容', target => { target.nodes = target.nodes.filter(node => !ids.has(node.id)); target.links = target.links.filter(link => !selectedEdgeIds.has(link.id) && !ids.has(link.fromNodeId) && !ids.has(link.toNodeId)); })) return;
    selectNode(); setMessage('已删除所选节点和连线，可一次撤销恢复。');
  };
  const duplicateSelected = () => {
    if (!selected || selected.type === 'event') return;
    const node = structuredClone(selected); node.id = makeId('bpnode'); node.x += 50; node.y += 80; node.name = `${node.name} 副本`.slice(0, 120);
    if (editGraph('复制蓝图节点', target => { if (target.nodes.length < 512) target.nodes.push(node); })) selectNode(node.id);
  };
  const inputField = (pinId: string, label?: string, options: { type?: BlueprintDataType; fallback?: VariableValue; assetKind?: 'image' | 'audio'; componentKind?: 'spine'; min?: number; max?: number; step?: number; hint?: string } = {}) => {
    if (!selected || !graph) return null;
    const pin = selected.pins.find(pin => pin.id === pinId);
    const connection = graph.links.find(link => link.toNodeId === selected.id && link.toPinId === pinId);
    const source = connection && graph.nodes.find(node => node.id === connection.fromNodeId);
    const sourceLabel = blueprintInputSource(project,graph,selected.id,pinId)?.label;
    const key = pinId === 'first_index' ? 'firstIndex' : pinId === 'last_index' ? 'lastIndex' : pinId;
    const title = label ?? pin?.name ?? pinId;
    const assetFilter = blueprintNodeAssetFilter(selected, pinId);
    return <Field key={pinId} label={title} hint={options.hint}>{connection ? <div className="blueprint-linked-value"><button type="button" className="blueprint-source-link" disabled={!source} title={sourceLabel} aria-label={`定位${title}来源：${sourceLabel}`} onClick={()=>{if(source){selectNode(source.id);void frameNode(source.id);}}}>来自：{sourceLabel}</button><IconButton title={`断开${title}的数据线`} onClick={() => editGraph('断开数据线', target => { target.links = target.links.filter(link => link.id !== connection.id); })}><X size={13} /></IconButton></div>
      : pinId === 'presetId' ? <CharacterPresetSelect project={project} characterId={String(selected.properties.characterId ?? '')} value={String(blueprintInputValue(selected, pinId) ?? '')} label={title} onChange={value => setProperty(key, value)} /> : <BlueprintValueInput componentIds={uiWorkspace?uiPageComponents(project,uiWorkspace.pageId).map(c=>c.id):undefined} project={project} assetKind={assetFilter?.kind} assetCategory={assetFilter?.category} type={options.type ?? pin?.dataType ?? 'string'} label={title} value={blueprintInputValue(selected, pinId) ?? options.fallback} onChange={value => setProperty(key, value)} {...options} />}</Field>;
  };
  const typeSelect = (value: BlueprintDataType, label: string, onChange: (type: BlueprintDataType) => void, types = Object.keys(blueprintTypeNames).filter(type => type !== 'exec') as BlueprintDataType[]) => <select aria-label={label} value={value} onChange={event => onChange(event.target.value as BlueprintDataType)}>{types.map(type => <option key={type} value={type}>{blueprintTypeNames[type]}</option>)}</select>;
  const transitionField = (scene = false) => selected && (['showCharacter'].includes(selected.type) ? <ActorTransitionFields inheritLabel="角色与默认时长" value={parseActorTransitions(selected.properties.actorTransitions)} defaults={actorTransitionDefaults((selected.properties.transition ?? 'dissolve') as 'none' | 'dissolve' | 'fade' | 'move', Number(selected.properties.duration ?? .5))} onChange={value => setProperty('actorTransitions', value ? JSON.stringify(value) : '')} /> : <Field label={scene ? '转场方式' : '出现或离开方式'}><select value={String(selected.properties[scene ? 'mode' : 'transition'] ?? 'none')} onChange={event => setProperty(scene ? 'mode' : 'transition', event.target.value)}><option value="none">立即切换</option><option value="dissolve">渐变过渡</option><option value="fade">淡出再淡入</option>{!scene && selected.type !== 'showBackground' && <option value="move">移动过渡</option>}</select></Field>);
  const resourceField = (label: string, key: string, choices: { id: string; name: string }[], onSelected?: (node: BlueprintNode, id: string) => void) => selected && <Field label={label}><select value={String(selected.properties[key] ?? '')} onChange={event => editSelected(`选择${label}`, node => { node.properties[key] = event.target.value; onSelected?.(node, event.target.value); })}><option value="">请选择{label}</option>{choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>;
  const selectedCharacter = selected && effectiveCharacter(project, String(selected.properties.characterId ?? ''));
  const selectedVariable = project.variables.find(item => item.id === selected?.properties.variableId);
  const selectedComponent = allUiComponents(project).find(item => item.id === selected?.properties.componentId);
  const selectedSpine = project.assets.find(item => item.id === selectedComponent?.assetId)?.spine;
  const renderProperties = (): ReactNode => {
    if (!selected || !graph) return null;
    switch (selected.type) {
      case 'eventClick': case 'eventButton': case 'eventValueChanged': case 'eventTextCommitted': case 'eventKey': case 'eventTimer': return <BlueprintNodeFields project={project} graph={graph} node={selected} edit={edit => editSelected('修改事件参数', edit)} />;
      case 'showUiPage': case 'closeUiPage': case 'random': case 'formatText': return <>{selected.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => graph.links.some(l=>l.toNodeId===selected.id&&l.toPinId===pin.id)?inputField(pin.id):<Field key={pin.id} label={pin.name}><BlueprintInlineValue project={project} graph={graph} node={selected} pin={pin} edit={edit => editSelected('修改节点参数', edit)} /></Field>)}</>;
      case 'event': return <p className="blueprint-note">选中这个节点，再添加演出节点，会自动接上第一条执行线。蓝图可从对白演出、场景事件或界面按钮调用。</p>;
      case 'showBackground': return <>{inputField('assetId', '背景素材', { type: 'asset', assetKind: 'image' })}{transitionField()}</>;
      case 'showChapter': return <>{inputField('title')}{inputField('subtitle')}{inputField('duration', '时长', { min: 0, max: 60, step: 0.1 })}{inputField('backgroundId', '章节背景', { assetKind: 'image' })}{inputField('titleImageId', '章节题图', { assetKind: 'image' })}{inputField('soundId', '章节音效', { assetKind: 'audio' })}{inputField('effect', '动效', { hint: '留空沿用作品设置；ink 为笔触消散，fade 为淡入淡出，none 为无动画。' })}</>;
      case 'camera': return <>{inputField('x')}{inputField('y')}{inputField('zoom', '缩放', { min: 0.25, max: 4 })}{inputField('rotation', '旋转', { min: -180, max: 180 })}{inputField('duration', '时长', { min: 0, max: 60 })}{inputField('wait')}</>;
      case 'shake': return <>{selected.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => <Field key={pin.id} label={pin.name}><BlueprintInlineValue project={project} graph={graph} node={selected} pin={pin} edit={edit => editSelected('修改震动参数', edit)} /></Field>)}</>;
      case 'savedAction': { const action = rawSavedBlueprintAction(selected); return action ? <><p className="blueprint-note">这里编辑原始演出。节点输入和连线可覆盖对应内容；未修改的输入会保留。</p><ActionEditor project={project} action={action} entranceOffsets={false} onChange={next => editSelected('修改源演出', node => updateSavedBlueprintAction(node, next))} /></> : <p className="blueprint-note">此演出数据无效，请重新封装。</p>; }
      case 'switchScene': return <>{inputField('sceneId', '目标场景', { type: 'scene' })}{transitionField(true)}{inputField('duration', '转场秒数', { type: 'number', fallback: 0.5, min: 0, max: 60, step: 0.1 })}<Field label="转场颜色"><input type="color" value={String(selected.properties.color ?? '#000000')} onChange={event => setProperty('color', event.target.value)} /></Field></>;
      case 'showCharacter': case 'hideCharacter': return <>
        {graph.links.some(link => link.toNodeId === selected.id && link.toPinId === 'characterId') ? inputField('characterId', '角色', { type: 'character' }) : resourceField('角色', 'characterId', project.characters, (node, id) => { node.properties.expressionId = effectiveCharacter(project, id)?.expressions[0]?.id ?? ''; })}
        {selected.type === 'showCharacter' && <>
          {graph.links.some(link => link.toNodeId === selected.id && link.toPinId === 'expressionId') ? inputField('expressionId', '表情', { type: 'string' }) : resourceField('表情', 'expressionId', selectedCharacter?.expressions ?? [])}
          {!selectedCharacter?.expressions.length && <p className="blueprint-note">先在“角色”中为角色添加立绘表情。</p>}
          <div className="blueprint-position-presets" aria-label="角色站位"><span>快捷站位</span>{[['左侧', 0.2], ['中间', 0.5], ['右侧', 0.8]].map(([name, x]) => <button key={name} disabled={graph.links.some(link => link.toNodeId === selected.id && link.toPinId === 'x')} onClick={() => editSelected('选择角色站位预设', node => { node.properties.presetId = Number(x) < .5 ? 'left' : Number(x) > .5 ? 'right' : 'center'; })}>{name}</button>)}</div>
          {inputField('presetId', '站位预设', { hint: '使用预设时跟随角色设置；手动位置才使用下面的构图、坐标和缩放。' })}{inputField('useDefaultFraming', '手动时使用默认构图')}
          {inputField('x', '横向位置', { type: 'number', fallback: 0.5, step: 0.05, hint: '0 是左边缘，1 是右边缘；可填写负数或大于 1 的位置。' })}
          {inputField('y', '纵向位置', { type: 'number', fallback: 1, step: 0.05, hint: '1 表示脚底在画面底部；大于 1 可将下半身移出画面。' })}{inputField('scale', '角色大小', { type: 'number', fallback: 1, min: 0.05, max: 4, step: 0.05, hint: '1 为原始大小，0.5 为一半。' })}{inputField('layer', '前后层级', { type: 'number', fallback: 10, min: 0, max: 100, step: 1 })}
        </>}{transitionField()}</>;
      case 'playMusic': return <>{inputField('assetId', '音乐素材', { type: 'asset', assetKind: 'audio' })}{inputField('loop', '循环播放', { type: 'boolean', fallback: true })}{inputField('fade', '淡入秒数', { type: 'number', fallback: 0.3, min: 0, max: 30, step: 0.1 })}</>;
      case 'playSound': return <>{inputField('assetId', '音效素材', { type: 'asset', assetKind: 'audio' })}<Field label="播放通道"><select aria-label="播放通道" value={String(selected.properties.channel ?? 'sound')} onChange={event => setProperty('channel', event.target.value)}><option value="sound">音效</option><option value="ambient">环境音</option></select></Field>{inputField('loop', '循环播放', { type: 'boolean', fallback: false })}</>;
      case 'setPlayerPreference': case 'getPlayerPreference': {
        const preference = (selected.properties.preference ?? 'musicVolume') as PlayerPreference;
        const info = playerPreferences[preference];
        return <><Field label="玩家设置"><select aria-label="玩家设置" value={preference} onChange={event => editSelected('选择玩家设置', node => {
          node.properties.preference = event.target.value;
          node.properties.value = playerPreferences[event.target.value as PlayerPreference].initial;
          delete node.properties.characterId;
        })}>{playerPreferenceKeys.map(key => <option key={key} value={key}>{playerPreferences[key].name}</option>)}</select></Field>
          {preference === 'characterVolume' && inputField('characterId', '配音角色', { type: 'character', hint: '留空时调节旁白及其他配音。' })}
          {selected.type === 'setPlayerPreference' && (info?.options && !graph.links.some(link => link.toNodeId === selected.id && link.toPinId === 'value') ? <Field label="设置值"><PreferenceValueInput preference={preference} value={blueprintInputValue(selected, 'value')} onChange={value => setProperty('value', value)} /></Field> : inputField('value', '设置值', { type: info?.type ?? 'number', fallback: info?.initial, min: info?.min, max: info?.max, step: info?.max === 1 ? 0.01 : 1, hint: preference === 'textSpeed' ? '每秒字数；0 表示立即显示。' : info?.max === 1 ? '0 至 1，1 为最大值。' : undefined }))}
        </>;
      }
      case 'confirmMessage': return inputField('message', '提示文字', { type: 'string', fallback: '确认继续吗？', hint: '在界面编辑器的“消息框”页配置外观，分别连接确定和取消路线。' });
      case 'setMinigameValue': return <><Field label="状态名称" hint="同一小游戏内使用相同名称即可读写，例如 score、progress 或 status。"><input maxLength={64} value={String(selected.properties.key ?? '')} onChange={event => setProperty('key', event.target.value)} /></Field>{inputField('value', '状态值', { type: 'any', fallback: 0 })}</>;
      case 'getMinigameValue': {
        const output = selected.pins.find(pin => pin.id === 'value');
        return <><Field label="状态名称"><input maxLength={64} value={String(selected.properties.key ?? '')} onChange={event => setProperty('key', event.target.value)} /></Field><Field label="值类型">{typeSelect(output?.dataType ?? 'any', '小游戏值类型', type => editSelected('修改小游戏值类型', node => { const pin = node.pins.find(item => item.id === 'value'); if (pin) pin.dataType = type; node.properties.defaultValue = defaultBlueprintValue(type); }), ['number', 'string', 'boolean', 'any'])}</Field><Field label="没有值时"><BlueprintValueInput project={project} type={output?.dataType ?? 'any'} label="小游戏默认值" value={selected.properties.defaultValue ?? 0} onChange={value => setProperty('defaultValue', value)} /></Field></>;
      }
      case 'finishMinigame': return <Field label="剧情结果"><select value={String(selected.properties.result ?? 'success')} onChange={event => setProperty('result', event.target.value)}><option value="success">成功</option><option value="failure">失败</option><option value="cancel">取消</option></select></Field>;
      case 'setUiProperty': case 'getUiProperty': return <>{inputField('componentId', '界面组件', { type: 'component' })}
        <Field label="组件属性"><select value={String(selected.properties.property ?? 'visible')} onChange={event => editSelected('选择组件属性', node => { node.properties.property = event.target.value; node.properties.value = uiProperties[event.target.value as UiProperty].initial; })}>{Object.entries(uiProperties).map(([key, entry]) => <option key={key} value={key} disabled={!!selectedComponent && !graph.links.some(link => link.toNodeId === selected.id && link.toPinId === 'componentId') && !uiPropertyApplies(selectedComponent, key as UiProperty)}>{entry.name}</option>)}</select></Field>
        {selected.type === 'setUiProperty' && inputField('value', '属性值', { type: uiProperties[selected.properties.property as UiProperty]?.type ?? 'boolean', min: 0, max: 1, step: 0.01 })}</>;
      case 'playUiAnimation': case 'stopUiAnimationPlayback': return <><BlueprintNodeFields project={project} graph={graph} node={selected} edit={edit=>editSelected('修改界面动画调用',edit)}/>{selected.type==='playUiAnimation'?<>{inputField('loops','循环次数（0为无限）',{type:'number'})}{inputField('speed','播放速度',{type:'number'})}{inputField('fromCurrent','沿用当前进度',{type:'boolean'})}{inputField('wait','等待结束',{type:'boolean'})}<p className="muted">往返一次包含正放和倒放。沿用当前进度只作用于仍完整播放的同一动画；轨道被替换或动画已停止时从方向起点播放。无限循环等待至停止或替换。</p></>:<>{inputField('finish','到达方向终点',{type:'boolean'})}<p className="muted">正放落在末帧，倒放和往返落在首帧。</p></>}{onOpenUiAnimation&&project.ui.animations?.some(a=>a.id===selected.properties.animationId)&&<button className="small-button" onClick={()=>onOpenUiAnimation(String(selected.properties.animationId),selected.id)}>编辑控件动画</button>}</>;
      case 'animateUiProperty': case 'stopUiAnimation': return <>{inputField('componentId','界面组件',{type:'component'})}<BlueprintNodeFields project={project} graph={graph} node={selected} edit={edit=>editSelected('修改控件动画',edit)}/>{selected.type==='animateUiProperty'?<>{inputField('value','目标值',{type:'number',step:.01})}{inputField('duration','持续秒数',{type:'number',min:0,max:3600,step:.1})}{inputField('wait','等待结束',{type:'boolean'})}</>:inputField('finish','到达目标值',{type:'boolean'})}</>;
      case 'resetUiComponent': return inputField('componentId', '界面组件', { type: 'component' });
      case 'playSpine': return <>{inputField('componentId', '骨骼组件', { type: 'component', componentKind: 'spine' })}
        {selectedSpine && !graph.links.some(link => link.toNodeId === selected.id && ['componentId', 'animation'].includes(link.toPinId)) ? resourceField('动画', 'animation', selectedSpine.animations.map(animation => ({ id: animation.name, name: `${animation.name} · ${animation.duration.toFixed(2)} 秒` }))) : inputField('animation', '动画名称', { type: 'string' })}
        {inputField('loop', '循环播放', { type: 'boolean', fallback: true })}{inputField('restart', '重新开始', { type: 'boolean', fallback: true })}</>;
      case 'pauseSpine': return <>{inputField('componentId', '骨骼组件', { type: 'component', componentKind: 'spine' })}{inputField('paused', '暂停', { type: 'boolean', fallback: true })}</>;
      case 'setSpineSpeed': return <>{inputField('componentId', '骨骼组件', { type: 'component', componentKind: 'spine' })}{inputField('speed', '播放速度', { type: 'number', fallback: 1, min: 0, max: 8, step: 0.1 })}</>;
      case 'stopMusic': return <><Field label="停止通道"><select aria-label="停止通道" value={String(selected.properties.channel ?? 'music')} onChange={event => setProperty('channel', event.target.value)}><option value="music">背景音乐</option><option value="sound">音效</option><option value="ambient">环境音</option></select></Field>{inputField('fade', '淡出秒数', { type: 'number', fallback: 0.3, min: 0, max: 30, step: 0.1 })}</>;
      case 'delay': return inputField('seconds', '等待秒数', { type: 'number', fallback: 1, min: 0, max: 120, step: 0.1 });
      case 'uiAction': return inputField('screen', '游戏界面', { type: 'ui', fallback: 'pause_menu' });
      case 'effect': return <>{resourceField('演出效果', 'effectId', project.effects)}{!project.effects.length && <p className="blueprint-note">在舞台编辑器中把一组演出保存为效果后，就能在这里复用。</p>}</>;
      case 'getVariable': case 'setVariable': return <>{resourceField('作品状态', 'variableId', project.variables, (node, id) => { node.properties.value = project.variables.find(item => item.id === id)?.initial ?? 0; })}{!project.variables.length && <p className="blueprint-note">先在“状态”中创建好感度、开关或文字状态。</p>}{selected.type === 'setVariable' && inputField('value', '新的状态值', { type: selectedVariable?.type ?? 'any', fallback: selectedVariable?.initial })}</>;
      case 'getInput': return <>{resourceField('输入参数', 'inputId', graph.exposedInputs)}{!graph.exposedInputs.length && <button className="text-button" onClick={() => setInspectorTab('interface')}>添加这个蓝图的输入参数</button>}</>;
      case 'setOutput': return <>{resourceField('输出结果', 'outputId', graph.exposedOutputs)}{inputField('value', '输出的值', { type: graph.exposedOutputs.find(pin => pin.id === selected.properties.outputId)?.dataType ?? 'any' })}{!graph.exposedOutputs.length && <button className="text-button" onClick={() => setInspectorTab('interface')}>添加这个蓝图的输出结果</button>}</>;
      case 'callFunction': case 'callMacro': return <>{resourceField(isTimelineComponent(selectedCall) ? '时间轴预设' : '调用蓝图', 'graphId', graphs.filter(item => item.id !== graph.id && (selected.type !== 'callMacro' || item.kind === 'macro') && isTimelineComponent(item) === isTimelineComponent(selectedCall)), node => { node.pins = callablePins(graphs.find(item => item.id === node.properties.graphId)); })}
        {selectedCall && <button className="text-button" onClick={() => chooseGraph(selectedCall.id)}>{isTimelineComponent(selectedCall) ? '编辑时间轴' : `编辑“${selectedCall.name}”`}</button>}
        {selectedCall && graphShowsActors(project, selectedCall.id) && <ActorTransitionFields label="本次角色过渡" inheritLabel="蓝图与角色设置" value={parseActorTransitions(selected.properties.actorTransitions)} onChange={value => setProperty('actorTransitions', value ? JSON.stringify(value) : '')} />}
        {selectedCall?.exposedInputs.map((pin, index) => inputField(`arg_${pin.id}`, `${pin.name}${pin.required ? '（必填）' : ''}`, { type: pin.dataType, fallback: selected.properties[`arg_${index}`] ?? pin.defaultValue }))}
        {selectedCall && selectedCall.exposedInputs.length === 0 && <p className="blueprint-note">这个流程不需要输入参数，接上执行线即可使用。</p>}
      </>;
      case 'literal': return <><Field label="固定值类型">{typeSelect(selected.pins.find(pin => pin.direction === 'output')?.dataType ?? 'string', '固定值类型', type => editSelected('修改固定值类型', node => { node.pins.forEach(pin => { pin.dataType = type; }); node.properties.value = defaultBlueprintValue(type); }))}</Field><Field label="固定值"><BlueprintValueInput project={project} type={selected.pins[0]?.dataType ?? 'string'} value={selected.properties.value} label="固定值" onChange={value => setProperty('value', value)} /></Field></>;
      case 'math': return <><Field label="计算方式"><select value={String(selected.properties.operation ?? 'add')} onChange={event => setProperty('operation', event.target.value)}>{Object.entries({ add: '相加 ＋', subtract: '相减 −', multiply: '相乘 ×', divide: '相除 ÷', modulo: '取余数', min: '取较小值', max: '取较大值' }).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>{inputField('a', '第一个数', { type: 'number', fallback: 0 })}{inputField('b', '第二个数', { type: 'number', fallback: 0 })}</>;
      case 'compare': return <><Field label="比较的数据类型">{typeSelect(selected.pins.find(pin => pin.id === 'a')?.dataType ?? 'number', '比较的数据类型', type => editSelected('修改比较类型', node => { for (const pin of node.pins) if (pin.id === 'a' || pin.id === 'b') { pin.dataType = type; pin.defaultValue = defaultBlueprintValue(type); delete node.properties[pin.id]; } node.properties.operator = 'eq'; }), ['number', 'string', 'boolean'])}</Field><Field label="比较方式"><select value={String(selected.properties.operator ?? 'eq')} onChange={event => setProperty('operator', event.target.value)}>{Object.entries({ eq: '等于', ne: '不等于', gt: '大于', gte: '大于或等于', lt: '小于', lte: '小于或等于' }).filter(([key]) => selected.pins.find(pin => pin.id === 'a')?.dataType !== 'string' && selected.pins.find(pin => pin.id === 'a')?.dataType !== 'boolean' || key === 'eq' || key === 'ne').map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>{inputField('a', '第一个值')}{inputField('b', '第二个值')}</>;
      case 'select': return <>{inputField('condition', '是否满足条件', { type: 'boolean', fallback: false })}{inputField('true_value', '满足时的值')}{inputField('false_value', '不满足时的值')}</>;
      case 'branch': return inputField('condition', '是否满足条件', { type: 'boolean', fallback: true, hint: '可以直接选择是或否，也可以接入“比较”或“读取状态”的结果。' });
      case 'forLoop': return <>{inputField('first_index', '起始数', { type: 'number', fallback: 0, min: -100000, max: 100000, step: 1 })}{inputField('last_index', '结束数', { type: 'number', fallback: 3, min: -100000, max: 100000, step: 1 })}<p className="blueprint-note">例如从 1 到 3 会执行三次。“当前计数”可以传给计算节点。</p></>;
      case 'sceneAction': return <Field label="中文演出指令" hint="使用文本编辑器中的中文指令，例如 @等待：1。"><input value={String(selected.properties.command ?? '')} placeholder="@等待：1" onChange={event => setProperty('command', event.target.value)} /></Field>;
      case 'comment': return <Field label="说明内容"><textarea rows={7} value={String(selected.properties.text ?? '')} onChange={event => setProperty('text', event.target.value)} placeholder="写下这段流程的用途，方便以后阅读。" /></Field>;
      default: return <p className="blueprint-note">这个节点无需额外参数，连接执行线即可。</p>;
    }
  };
  const editInterface = (direction: BlueprintPin['direction'], id: string, edit: (pin: BlueprintPin) => void) => editGraph('修改蓝图接口', target => { const pin = (direction === 'input' ? target.exposedInputs : target.exposedOutputs).find(item => item.id === id); if (pin) edit(pin); });
  const interfaceSection = (direction: BlueprintPin['direction']) => {
    if (!graph) return null;
    const pins = direction === 'input' ? graph.exposedInputs : graph.exposedOutputs;
    const label = direction === 'input' ? '输入参数' : '输出结果';
    return <section className="blueprint-interface-section"><div className="blueprint-section-heading"><strong>{label}</strong><button className="text-button" disabled={pins.length >= (direction === 'input' ? maxBlueprintInputs : maxBlueprintOutputs)} onClick={() => editGraph(`添加${label}`, target => { (direction === 'input' ? target.exposedInputs : target.exposedOutputs).push({ id: makeId(direction === 'input' ? 'bpin' : 'bpout'), name: `${label} ${pins.length + 1}`, direction, dataType: 'number', required: false, defaultValue: 0 }); })}><Plus size={13} />添加{direction === 'input' ? '输入' : '输出'}</button></div>
      <p className="blueprint-note">{direction === 'input' ? '调用者可以传入这些值，在图中用“读取输入”使用。' : '在图中用“写入输出”赋值，调用者可以读取结果。'}</p>
      {pins.map(pin => <div className="blueprint-interface-card" key={pin.id}>
        <div className="blueprint-interface-name"><input aria-label={`${label}名称 ${pin.name}`} maxLength={120} value={pin.name} onChange={event => { if (event.target.value.trim()) editInterface(direction, pin.id, target => { target.name = event.target.value; }); }} /><IconButton title={`删除${label} ${pin.name}`} onClick={() => editGraph(`删除${label}`, target => { if (direction === 'input') target.exposedInputs = target.exposedInputs.filter(item => item.id !== pin.id); else target.exposedOutputs = target.exposedOutputs.filter(item => item.id !== pin.id); })}><Trash2 size={13} /></IconButton></div>
        {typeSelect(pin.dataType, `${pin.name}的数据类型`, type => editInterface(direction, pin.id, target => { target.dataType = type; target.defaultValue = ['asset', 'scene', 'character', 'ui', 'component'].includes(type) ? undefined : defaultBlueprintValue(type); }))}
        <label className="blueprint-check"><input type="checkbox" checked={pin.defaultValue !== undefined} onChange={event => editInterface(direction, pin.id, target => { target.defaultValue = event.target.checked ? defaultBlueprintValue(target.dataType) : undefined; })} />使用默认值</label>
        {pin.defaultValue !== undefined && (direction === 'input' ? <BlueprintParameterValue project={project} graph={graph!} label={`${pin.name}的默认值`} pin={pin} value={pin.defaultValue} onChange={value => editInterface(direction, pin.id, target => { target.defaultValue = value; })} /> : <BlueprintValueInput project={project} label={`${pin.name}的默认值`} type={pin.dataType} value={pin.defaultValue} onChange={value => editInterface(direction, pin.id, target => { target.defaultValue = value; })} />)}
        {direction === 'input' && <label className="blueprint-check"><input type="checkbox" checked={pin.required} onChange={event => editInterface(direction, pin.id, target => { target.required = event.target.checked; })} />调用时必填</label>}
      </div>)}
    </section>;
  };
  const query = search.trim().toLocaleLowerCase();
  const userNodes = graphs.filter(item => item.kind === 'macro' && item.id !== graph?.id && (!query || item.name.toLocaleLowerCase().includes(query)));
  const compatibleNode = (type: BlueprintNodeType, called?: BlueprintGraph) => {
    if (!contextMenu?.wire) return true;
    const pin = graph?.nodes.find(node => node.id === contextMenu.wire!.nodeId)?.pins.find(pin => pin.id === contextMenu.wire!.pinId);
    const pins = called ? callablePins(called) : adaptBlueprintNodeToPin(blueprintNodeDefaults(type), pin).pins;
    return !!pin && pins.some(candidate => pin.direction === 'output' ? blueprintPinsCompatible(pin, candidate) : blueprintPinsCompatible(candidate, pin));
  };
  const pickerItems: NodePickerItem[] = contextMenu ? [
    { id: 'new_timeline_component', name: '时间轴', category: '常用演出', hint: '安排素材、角色、镜头和声音；需要复用的素材可设为输入参数。', choose: addTimeline, disabled: !graph || !!contextMenu.wire },
    ...blueprintCategories.flatMap(category => Object.entries(blueprintCatalog).filter(([type, info]) => !['showChapter', 'savedAction'].includes(type) && info.category === category && uiNodeAllowed(type) && compatibleNode(type as BlueprintNodeType)).map(([type, info]) => ({ id: type, ...info, disabled: !graph || graph.nodes.length >= 512 || (type === 'event' && graph.nodes.some(node => node.type === 'event')), choose: () => addNode(type as BlueprintNodeType, undefined, contextMenu?.position, undefined, contextMenu?.wire) }))),
    ...graphs.filter(item => item.id !== graph?.id && compatibleNode(item.kind === 'macro' ? 'callMacro' : 'callFunction', item)).map(item => ({ id: item.id, name: item.name, hint: isTimelineComponent(item) ? '使用已有时间轴，未传入的素材参数使用默认素材' : '调用这张蓝图，并读取输出结果', category: isTimelineComponent(item) ? '时间轴预设' : blueprintGroup(project, item.id) || '我的蓝图', choose: () => addNode(item.kind === 'macro' ? 'callMacro' : 'callFunction', item, contextMenu?.position, undefined, contextMenu?.wire) })),
  ] : [];
  const canvasHandlers = useStableCallbacks({
    onSelectionEnd: () => { setContextMenu(undefined); setInspectorTab(getFlowNodes().some(node => node.selected) ? 'node' : 'links'); },
    onNodeClick: () => { setContextMenu(undefined); setInspectorTab('node'); setPropertiesOpen(true); },
    onPaneClick: () => { selectNode(); setContextMenu(undefined); },
    onPaneContextMenu: event => { event.preventDefault(); selectNode(); openNodePicker({ x: event.clientX, y: event.clientY }); },
    onEdgeClick: inspectEdge,
    onEdgeContextMenu: (event, edge) => { event.preventDefault(); selectEdge(edge.id); },
    onNodeDoubleClick: (_, node) => { const actual=graph?.nodes.find(n=>n.id===node.id);if(actual&&['playUiAnimation','stopUiAnimationPlayback'].includes(actual.type)&&project.ui.animations?.some(a=>a.id===actual.properties.animationId)&&onOpenUiAnimation){onOpenUiAnimation(String(actual.properties.animationId),node.id);return;} const timeline = timelineForNode(project, graph?.nodes.find(item => item.id === node.id)); if (timeline && graph && onOpenTimeline) { onOpenTimeline(timeline.id, graph.id, node.id); return; } void flow.setCenter(node.position.x + 125, node.position.y + 90, { zoom: 1, duration: 160 }); },
    onNodeDragStop: (_, node, moved) => editGraph('移动蓝图节点', target => {
      const positions = new Map((moved.length ? moved : [node]).map(item => [item.id, item.position]));
      for (const item of target.nodes) { const position = positions.get(item.id); if (position) { item.x = position.x; item.y = position.y; } }
    }),
    onConnect: connection => { if (!connection.sourceHandle || !connection.targetHandle) return; let problem: string | undefined; const accepted = editGraph('连接蓝图节点', target => { problem = connectBlueprintPins(target, connection.source, connection.sourceHandle!, connection.target, connection.targetHandle!); }); if (accepted) setMessage(problem ?? '连线已保存。选中连线后按删除键可以断开。'); },
    onConnectEnd: (event, state) => {
      if (state.isValid || state.toNode || !state.fromHandle?.id) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      if (!point || !canvas.current) return;
      const bounds = canvas.current.getBoundingClientRect();
      if (point.clientX < bounds.left || point.clientX > bounds.right || point.clientY < bounds.top || point.clientY > bounds.bottom) return;
      const at = { x: point.clientX, y: point.clientY };
      setContextMenu({ ...at, position: flow.screenToFlowPosition(at), wire: { nodeId: state.fromHandle.nodeId, pinId: state.fromHandle.id, direction: state.fromHandle.type === 'source' ? 'output' : 'input' } });
    },
    onReconnect: (oldEdge, connection) => { if (!connection.sourceHandle || !connection.targetHandle) return; let problem: string | undefined; const accepted = editGraph('改接蓝图连线', target => { const candidate = structuredClone(target); candidate.links = candidate.links.filter(link => link.id !== oldEdge.id); problem = connectBlueprintPins(candidate, connection.source, connection.sourceHandle!, connection.target, connection.targetHandle!); if (!problem) { candidate.links.at(-1)!.id = oldEdge.id; target.links = candidate.links; } }); if (accepted) setMessage(problem ?? '连线已改接，可撤销。'); },
    onDelete: ({ nodes, edges }) => editGraph('删除蓝图所选内容', target => { const ids = new Set(nodes.map(node => node.id)), links = new Set(edges.map(edge => edge.id)); target.nodes = target.nodes.filter(node => !ids.has(node.id)); target.links = target.links.filter(link => !links.has(link.id) && !ids.has(link.fromNodeId) && !ids.has(link.toNodeId)); }),
  } satisfies Pick<ReactFlowProps<FlowNode, StudioEdge>, 'onSelectionEnd' | 'onNodeClick' | 'onPaneClick' | 'onPaneContextMenu' | 'onEdgeClick' | 'onEdgeContextMenu' | 'onNodeDoubleClick' | 'onNodeDragStop' | 'onConnect' | 'onConnectEnd' | 'onReconnect' | 'onDelete'>);
  const renderPanels=(palette:ReactNode,canvasContent:ReactNode,properties:ReactNode)=>uiWorkspace?
    <UiDock storageKey="vns-ui-logic-dock-v1" label="高级界面面板布局" compactSettings={!uiWorkspace.auxiliaryOpen} labels={{hierarchy:'我的界面',canvas:'事件图',inspector:'详细信息',settings:'参数绑定'}} panels={{hierarchy:uiWorkspace.library((type,properties)=>addNode(type,undefined,undefined,properties)),canvas:canvasContent,inspector:properties,settings:uiWorkspace.auxiliary}}/>:
    <div data-panels-reversed={panelLayout.reversed} ref={panelLayout.root} style={panelLayout.style} className={`blueprint-editor-body ${paletteOpen?'':'palette-hidden'} ${propertiesOpen?'':'properties-hidden'}`}>{paletteOpen&&palette}{paletteOpen&&panelLayout.divider('palette')}{canvasContent}{propertiesOpen&&panelLayout.divider('properties')}{propertiesOpen&&properties}</div>;
  return <div className="blueprint-workspace generic-blueprint-workspace">
    <div className="workspace-toolbar blueprint-toolbar">{onBack && <IconButton title="切换到时间轴" onClick={onBack}><ArrowLeft size={16} /></IconButton>}<strong className="blueprint-title"><Workflow size={16} />{uiWorkspace?'事件图':'节点编程'}</strong>{uiWorkspace?.toolbar}{!uiWorkspace&&!fixedGraph&&<>
      {!hideGraphPicker && <><select aria-label="选择通用蓝图" value={graph?.id ?? ''} onChange={event => chooseGraph(event.target.value)}>{!graphs.length && <option value="">还没有蓝图</option>}{graphs.filter(item => !isTimelineComponent(item) || item.id === graph?.id).map(item => <option key={item.id} value={item.id}>{item.name} · {blueprintKindNames[item.kind]}</option>)}</select>
      <button className="small-button" onClick={() => createGraph('function')}><Plus size={14} />新建蓝图</button></>}<button className="small-button" onClick={() => createGraph('macro')}><LibraryBig size={14} />新建用户节点</button><select className="blueprint-example-select" aria-label="添加蓝图示例" value="" onChange={event => addExample(event.target.value)}><option value="">添加示例…</option><option value="interaction">交互 · 限时点亮</option><option value="motion">演出 · 镜头与震动同播</option></select></>}<div className="spacer" />
      <IconButton title={allParametersCollapsed ? '展开全部节点参数' : '收起全部节点参数'} aria-expanded={!allParametersCollapsed} disabled={!graph} onClick={() => setCollapsed(previous => { const next = new Set(previous); for (const node of graph?.nodes ?? []) allParametersCollapsed ? next.delete(node.id) : next.add(node.id); return next; })}><ListCollapse size={16} /></IconButton><IconButton title="自动排列蓝图" disabled={arranging || !graph} onClick={()=>{void editorCommand('arrangeBlueprint');}}><LayoutGrid size={16} /></IconButton><IconButton title="定位选中节点" disabled={!selected} onClick={()=>{if(selected)void frameNode(selected.id);}}><Crosshair size={16}/></IconButton><IconButton title="框选全部节点" onClick={() => { void flow.fitView({ padding: 0.22, maxZoom: 1, duration: 180 }); }}><ZoomIn size={16} /></IconButton>{!uiWorkspace&&<IconButton title={propertiesOpen ? '收起蓝图属性' : '展开蓝图属性'} onClick={() => setPropertiesOpen(!propertiesOpen)}>{propertiesOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</IconButton>}<IconButton title="蓝图入门" aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}><CircleHelp size={17} /></IconButton>
    </div>
    {graph && <div className="blueprint-tools">{!uiWorkspace&&<button className="small-button" aria-expanded={paletteOpen} onClick={() => setPaletteOpen(!paletteOpen)}>{paletteOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}{paletteOpen ? '收起节点库' : '展开节点库'}</button>}<button className="small-button" onClick={() => openNodePicker()}><Plus size={14} />添加节点 <kbd>空格</kbd></button><button className="small-button" disabled={isTimelineComponent(graph)} onClick={addTimeline}><Plus size={14} />添加时间轴</button><label className="blueprint-check"><input type="checkbox" checked={autoConnect} onChange={event => setAutoConnect(event.target.checked)} />自动接线</label>{uiWorkspace&&<label className="blueprint-check"><input type="checkbox" checked={uiContextOnly} onChange={e=>setUiContextOnly(e.target.checked)}/>仅界面相关</label>}<div className="spacer" /><button className="text-button" onClick={() => { setInspectorTab('links'); setPropertiesOpen(true); }}><Link2 size={14} />连线列表 · {graph.links.length}</button><small>{uiWorkspace?'拖入左侧控件 → 选择读取或设置 · 白线控制执行顺序':'右键搜索节点 · 拖入资源直接使用'}</small></div>}
    {helpOpen && <div className="blueprint-help"><strong>从一条执行线开始</strong><ol><li>在画布空白处右键或按空格搜索节点，也可以展开节点库。</li><li>拖动连接点接线；点击连线高亮选中，拖动两端改接，按 Delete 断开。点击左侧事件或“定位选中节点”查看节点；详情中的参数来源可点击定位。</li><li>从资源管理器拖入图片、音频、角色、状态或其他蓝图。{uiWorkspace?'在左侧添加控件点击事件，连接设置属性等节点；保存界面后在游戏中生效。':'在对白演出、场景事件或界面按钮中调用这张蓝图。'}</li></ol>{!uiWorkspace&&!fixedGraph&&<button className="text-button" onClick={() => createGraph('function', true)}>创建已连线的入门示例</button>}</div>}
    {!graph ? <div className="blueprint-welcome"><Workflow size={40} /><h2>用节点搭出你的演出和逻辑</h2><p>添加中文节点、选择参数、连接流程，就能制作角色入场、音乐播放和条件判断。</p><div><button className="primary-button" onClick={() => createGraph('function', true)}>从入门示例开始</button><button className="small-button" onClick={() => createGraph('function')}>创建空白蓝图</button></div><small>已有的剧情流程、对白和素材可以继续使用。</small></div> : <>
      {renderPanels(<aside className="blueprint-palette" aria-label="节点库"><div {...panelLayout.handle('palette')} className="blueprint-panel-heading"><LibraryBig size={15} /><strong>节点库</strong></div><div className="search"><Search size={13} /><input aria-label="搜索蓝图节点" placeholder="搜索节点或用途" value={search} onChange={event => setSearch(event.target.value)} /></div>
          <label className="blueprint-check"><input type="checkbox" checked={autoConnect} onChange={event => setAutoConnect(event.target.checked)} />添加时自动接线</label>
          {blueprintCategories.map(category => {
            const entries = Object.entries(blueprintCatalog).filter(([type, info]) => !['showChapter', 'savedAction'].includes(type) && info.category === category && (!query || `${info.name} ${info.hint} ${category}`.toLocaleLowerCase().includes(query)));
            return entries.length > 0 && <details key={`${category}:${!!query}`} open={!!query || category === '常用演出' || category === '流程控制'}><summary>{category}<span>{entries.length}</span></summary>{entries.map(([type, info]) => <button key={type} className="blueprint-library-node" title={info.hint} disabled={graph.nodes.length >= 512 || (type === 'event' && graph.nodes.some(node => node.type === 'event'))} onClick={() => addNode(type as BlueprintNodeType)}><Plus size={12} /><span>{info.name}</span></button>)}</details>;
          })}
          <details open className="blueprint-user-library"><summary>我的用户节点<span>{userNodes.length}</span></summary>{userNodes.map(item => <button key={item.id} className="blueprint-library-node" onClick={() => addNode('callMacro', item)} title="插入这个可复用节点"><Workflow size={12} /><span>{item.name}</span></button>)}{!userNodes.length && <p className="blueprint-note">{query ? '没有匹配的用户节点。' : '把常用流程保存为用户节点，之后一键插入。'}</p>}{!fixedGraph&&<button className="text-button" onClick={() => createGraph('macro')}><Plus size={12} />创建用户节点</button>}</details>
        </aside>, <div className="flow-container" ref={canvas} onDragOver={event => { if (['application/vns-ui-animation', 'application/vns-ui-component', 'application/vns-asset', 'application/vns-character', 'application/vns-blueprint', 'application/vns-timeline', 'application/vns-variable', 'application/vns-scene'].some(type => event.dataTransfer.types.includes(type))) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDrop={event => {
          event.preventDefault(); const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          const droppedAnimation=(uiWorkspace?uiPageAnimations(project,uiWorkspace.pageId):project.ui.animations)?.find(a=>a.id===event.dataTransfer.getData('application/vns-ui-animation'));
          const droppedComponent=uiWorkspace&&uiPageComponents(project,uiWorkspace.pageId).find(c=>c.id===event.dataTransfer.getData('application/vns-ui-component'));
          if(droppedAnimation){addNode('playUiAnimation',undefined,position,{animationId:droppedAnimation.id});return;}
          if(droppedComponent){setContextMenu(undefined);setVariableDrop(undefined);setComponentDrop({id:droppedComponent.id,x:event.clientX,y:event.clientY,position});return;}
          const asset = project.assets.find(item => item.id === event.dataTransfer.getData('application/vns-asset'));
          const called = graphs.find(item => item.id === (event.dataTransfer.getData('application/vns-blueprint') || event.dataTransfer.getData('application/vns-timeline')));
          const character = project.characters.find(item => item.id === event.dataTransfer.getData('application/vns-character'));
          const variable = project.variables.find(item => item.id === event.dataTransfer.getData('application/vns-variable'));
          const scene = project.scenes.find(item => item.id === event.dataTransfer.getData('application/vns-scene'));
          if (asset?.kind === 'image' || asset?.kind === 'audio') addNode(asset.kind === 'image' ? 'showBackground' : ['sound', 'voice'].includes(assetCategories(project).get(asset.id) ?? '') ? 'playSound' : 'playMusic', undefined, position, { assetId: asset.id });
          else if (called && called.id !== graph.id) addNode(called.kind === 'macro' ? 'callMacro' : 'callFunction', called, position);
          else if (character) addNode('showCharacter', undefined, position, { characterId: character.id, expressionId: effectiveCharacter(project, character.id)?.expressions[0]?.id ?? '' });
          else if (variable&&uiWorkspace) {setContextMenu(undefined);setComponentDrop(undefined);setVariableDrop({id:variable.id,x:event.clientX,y:event.clientY,position});}
          else if (variable) addNode('getVariable', undefined, position, { variableId: variable.id });
          else if (scene) addNode('switchScene', undefined, position, { sceneId: scene.id });
          else setMessage(called ? '不能在蓝图中调用自身。' : '图片、音频、角色、状态、场景和其他蓝图可以拖入画布。');
        }}><ReactFlow<FlowNode, StudioEdge> defaultNodes={initialNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={studioEdgeTypes} {...canvasHandlers}
          onSelectionChange={onSelectionChange} onEdgesChange={onEdgesChange}
          fitView minZoom={0.18} maxZoom={1.6} deleteKeyCode={null} reconnectRadius={18} connectionRadius={26} panOnDrag={[1, 2]} selectionOnDrag selectionMode={SelectionMode.Partial} proOptions={{ hideAttribution: true }}
          ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': '放大画布', 'controls.zoomOut.ariaLabel': '缩小画布', 'controls.fitView.ariaLabel': '显示全部节点', 'minimap.ariaLabel': '蓝图缩略图' }}
        ><Background gap={24} size={1} color="#3b4552" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={node => node.selected ? '#dab279' : '#587081'} /></ReactFlow>{contextMenu && <NodePicker key={`${contextMenu.x}:${contextMenu.y}`} x={contextMenu.x} y={contextMenu.y} items={pickerItems} onClose={() => setContextMenu(undefined)} />}{componentDrop&&<NodePicker x={componentDrop.x} y={componentDrop.y} title="控件操作" onClose={()=>setComponentDrop(undefined)} items={[
          ...controlValueItems,
          {id:'read',name:'读取控件属性',category:'当前控件',hint:'读取显示状态、文字或位置，连接到判断和计算。',choose:()=>addNode('getUiProperty',undefined,componentDrop.position,{componentId:componentDrop.id})},
          {id:'write',name:'设置控件属性',category:'当前控件',hint:'接入执行线，修改这个控件的显示状态、文字或位置。',choose:()=>addNode('setUiProperty',undefined,componentDrop.position,{componentId:componentDrop.id})},
          {id:'animate',name:'控件属性动画',category:'当前控件',hint:'让这个控件移动、改变大小或淡入淡出。',choose:()=>addNode('animateUiProperty',undefined,componentDrop.position,{componentId:componentDrop.id})},
          {id:'stop',name:'停止控件动画',category:'当前控件',hint:'保留当前值，或立即完成这个控件的动画。',choose:()=>addNode('stopUiAnimation',undefined,componentDrop.position,{componentId:componentDrop.id})}
        ]}/>}{variableDrop&&<NodePicker x={variableDrop.x} y={variableDrop.y} title="变量操作" onClose={()=>setVariableDrop(undefined)} items={[
          {id:'read-variable',name:'读取变量',category:'当前变量',hint:'把这个变量的当前值接入判断、计算或控件属性。',choose:()=>{if(project.variables.some(v=>v.id===variableDrop.id))addNode('getVariable',undefined,variableDrop.position,{variableId:variableDrop.id});}},
          {id:'write-variable',name:'设置变量',category:'当前变量',hint:'接上执行线，写入一个新值。',choose:()=>{const v=project.variables.find(v=>v.id===variableDrop.id);if(v)addNode('setVariable',undefined,variableDrop.position,{variableId:v.id,value:v.initial});}}
        ]}/>}<div className="blueprint-canvas-legend"><i className="exec" />执行<i className="data" />数据<span>左键框选节点与连线（碰到即选） · Ctrl 多选 · 中键平移 · Delete 删除</span></div></div>, <aside className="blueprint-properties" aria-label="蓝图属性"><div {...panelLayout.handle('properties')} className="blueprint-property-tabs"><button className={inspectorTab === 'node' ? 'active' : ''} onClick={() => setInspectorTab('node')}>节点参数</button><button className={inspectorTab === 'interface' ? 'active' : ''} onClick={() => setInspectorTab('interface')}><Settings2 size={13} />输入与输出</button><button className={inspectorTab === 'links' ? 'active' : ''} onClick={() => setInspectorTab('links')}>连线</button></div><div className="blueprint-properties-scroll">
          {inspectorTab === 'links' ? <><h3>连线 · {graph.links.length}</h3>{selectedEdgeIds.size > 1 && <div className="connection-details"><strong>已选中 {selectedEdgeIds.size} 条连线</strong><button className="small-button" onClick={() => { if (editGraph('断开所选蓝图连线', target => { target.links = target.links.filter(link => !selectedEdgeIds.has(link.id)); })) setSelectedEdgeId(); }}><Unplug size={14} />断开所选连线</button></div>}{selectedLink && <div className="connection-details"><strong>已选中连线</strong><p>{linkDescription(selectedLink)}</p><button className="small-button" onClick={() => disconnectLink(selectedLink.id)}><Unplug size={14} />断开此连线</button><small>也可按 Delete；拖动两端圆点可改接。</small></div>}<p className="blueprint-note">点击下方条目即可定位连线两端。</p><div className="connection-list">{graph.links.map(link => <button key={link.id} data-link-id={link.id} className={selectedEdgeIds.has(link.id) ? 'active' : ''} onClick={() => { selectEdge(link.id); void flow.fitView({ nodes: [{ id: link.fromNodeId }, { id: link.toNodeId }], padding: 0.35, maxZoom: 1, duration: 180 }); }}><Link2 size={14} /><span>{linkDescription(link)}</span></button>)}</div>{!graph.links.length && <p className="blueprint-note">拖动节点两侧的连接点建立第一条连线。</p>}</>
          : inspectorTab === 'interface' ? <><h3>蓝图设置</h3><BlueprintNameField project={project} graph={graph} mode="name" commit={commit} message={setMessage} /><BlueprintNameField project={project} graph={graph} mode="callName" commit={commit} message={setMessage} /><GraphGroupField project={project} graph={graph} commit={commit} message={setMessage} /><Field label="蓝图用途"><select value={graph.kind} onChange={event => editGraph('蓝图用途', target => { target.kind = event.target.value as BlueprintGraph['kind']; })}>{Object.entries(blueprintKindNames).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select></Field><p className="blueprint-note">选择“用户节点”后，这张蓝图会出现在其他蓝图的节点库里。</p>{interfaceSection('input')}{interfaceSection('output')}</>
            : selected ? <><div className="blueprint-section-heading"><h3>{isTimelineComponent(selectedCall) ? '时间轴预设' : blueprintCatalog[selected.type].name}</h3><div><IconButton title="复制选中节点" disabled={selected.type === 'event' || graph.nodes.length >= 512} onClick={duplicateSelected}><Copy size={14} /></IconButton><IconButton title="删除选中节点" onClick={deleteSelected}><Trash2 size={14} /></IconButton></div></div><p className="blueprint-note">{isTimelineComponent(selectedCall) ? '接上执行线即可播放。素材参数可以接入蓝图变量；未传入时沿用时间轴内的默认素材。' : blueprintCatalog[selected.type].hint}</p><Field label="节点名称"><input maxLength={120} value={selected.name} onChange={event => { if (event.target.value.trim()) editSelected('节点名称', node => { node.name = event.target.value; }); }} /></Field>{renderProperties()}<EntranceOffsetsEditor node={selected} edit={change => editSelected("编辑入场偏移", change)} />{selectedIssues.length > 0 && <div className="blueprint-node-problems" role="status"><strong>还需要完成</strong>{selectedIssues.map((issue, index) => <p key={index}>{issue.message.replace(/^“.*?”：/, '')}</p>)}</div>}</>
              : <div className="blueprint-selection-empty"><GitBranch size={26} /><h3>选择节点或连线</h3><p>点击节点编辑参数；右键空白处添加节点。</p><button className="text-button" onClick={() => setInspectorTab('interface')}>设置蓝图名称与参数接口</button><div className="blueprint-node-outline"><strong>本图节点 · {graph.nodes.length}</strong>{graph.nodes.map(node => <button key={node.id} onClick={() => { selectNode(node.id); void flow.setCenter(node.x + 120, node.y + 70, { zoom: 0.9, duration: 180 }); }}>{node.name}</button>)}</div></div>}
        </div></aside>)}<div className="blueprint-status" role="status"><span>{message || `${graph.nodes.length} 个节点 · ${graph.links.length} 条连线`}</span><button onClick={() => setHelpOpen(!helpOpen)}>入门帮助</button></div>
    </>}
  </div>;
}
