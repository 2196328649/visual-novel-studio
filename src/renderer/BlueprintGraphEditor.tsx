import { completionScore } from '../core/text-completion';
import { isBlueprintModuleReference } from '../core/blueprint-tasks';
import { BlueprintDiagnosticCache } from './blueprint-diagnostics';
import { blueprintMeasuredNodeSize } from '../core/blueprint-node-layout';
import { BlueprintGraphNode, blueprintPinColors as pinColors, type BlueprintFlowNode as FlowNode } from './BlueprintGraphNode';
import { isBlueprintFlowControl } from '../core/blueprint-flow-control';
import { BlueprintVariables } from './BlueprintVariables';
import { BlueprintStateFields } from './BlueprintStateFields';
import { blueprintStateScope, blueprintStateVariable, blueprintStateVariables } from '../core/blueprint-state';
import { BLUEPRINT_MEMBER_MIME, blueprintMemberAccess, parseBlueprintMemberReference, type BlueprintMemberAccess, type BlueprintMemberReference } from '../core/blueprint-member-access';
import { blueprintMemberTypes } from './blueprint-member-types';
import { uiPages } from '../core/ui-pages';
import { BlueprintUsageList, BlueprintInterfaceChangeDialog, BlueprintInterfaceMembers } from './BlueprintInterface';
import { inspectBlueprintInterfaceChange, applyBlueprintInterfaceChange, type BlueprintInterfaceChange } from '../core/blueprint-interface';
import type { BlueprintUsage } from '../core/blueprint-usages';
import { BlueprintEncapsulationDialog } from './BlueprintEncapsulationDialog';
import { encapsulateBlueprintSelection } from '../core/blueprint-encapsulation';
import { cloneData, projectEditSnapshot, mutateProject } from "../core/project-mutation";
import { sameProjectValue } from "../core/project-history";
import { projectGraphs, addProjectGraphs, setProjectGraphs } from '../core/project-resources';
import { assertTimelineEditDoesNotOverlap } from '../core/timeline-edit-validation';
import { ActorTransitionFields, BlueprintActorTransitionFields } from './ActorTransitionFields';
import { parseActorTransitions, graphShowsActors } from '../core/actor-transitions';
import { uiControlValue } from '../core/ui-control-value';
import { uiControlDefinition, uiControlPrimaryProperty } from '../core/ui-control-properties';
import type { BlueprintSelectionRequest } from './blueprint-editor-selection';
import { canvasLocation, rememberBlueprintNodeClick, type BlueprintCanvasLocation, type BlueprintNodeClickOrigin, type BlueprintGraphOrigin, type OpenBlueprintGraph } from './blueprint-navigation';
import type { BlueprintSelection } from '../core/ai-selection';
import { uiControlValueType, uiTextInput } from '../core/ui-control-events';
import { uiPageAnimations } from '../core/ui-animation-clips';
import { UiEventWorkspace } from './UiEventWorkspace';
import { UiEventDetail, UiEventDetailHost, useUiEventSidebar } from './UiEventSidebar';
import { BlueprintToolbarMenu } from './BlueprintToolbarMenu';
import { BlueprintModuleLibrary, type BlueprintModuleLibraryState } from './BlueprintModuleLibrary';
import { uiPageComponents } from '../core/ui-logic';
import { useBlueprintPanelLayout } from './BlueprintPanelLayout';
import { availableBlueprintName } from '../core/blueprint-names';
import { EntranceOffsetsEditor } from './EntranceOffsetsEditor';
import { addTimelineComponent, isTimelineComponent, timelineForNode } from '../core/timeline-component';
import { CharacterPresetSelect } from './CharacterPresets';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, SelectionMode, useReactFlow, useNodesInitialized, useUpdateNodeInternals, type Edge, type OnSelectionChangeParams, type ReactFlowProps } from '@xyflow/react';
import { ArrowLeft, CircleHelp, Copy, GitBranch, LibraryBig, Plus, Search, Settings2, Trash2, Workflow, X, ZoomIn, LayoutGrid, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, ListCollapse, Crosshair, Clapperboard } from 'lucide-react';
import { layoutBlueprint } from './blueprint-layout';
import { allUiComponents, effectiveCharacter, makeId, type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Project, type VariableValue } from '../core/model';
import { uiProperties, uiPropertyApplies, type UiProperty } from '../core/ui';
import { playerPreferenceKeys, playerPreferences, preferenceInfo, type PlayerPreference } from '../core/preferences';
import { blueprintCatalog, blueprintCategories, blueprintInputValue, blueprintInputSource, blueprintOutputLabel, blueprintKindNames, blueprintNodeDefaults, blueprintPinsCompatible, blueprintTypeNames, callablePins, connectBlueprintPins, createBlueprintGraph, defaultBlueprintValue, synchronizeBlueprintSignatures, type BlueprintDataType, type BlueprintNodeType } from '../core/blueprint';
import { validateBlueprints } from '../core/blueprint-validation';
import type { Commit } from './editor';
import { Field, IconButton } from './components';
import { BlueprintValueInput } from './BlueprintValueInput';
import { blueprintNodeAssetFilter } from '../core/blueprint-assets';
import { blueprintAssetNodePresentation, createBlueprintAssetNode } from '../core/blueprint-asset-node';
import { PreferenceValueInput } from './PlayerPreferences';
import { studioEdgeTypes, type StudioEdge } from './SelectableEdge';
import { NodePicker, type NodePickerItem } from './NodePicker';
import { categoryAssets } from '../core/asset-library';
import { rawSavedBlueprintAction, updateSavedBlueprintAction, assignBlueprintGroup, blueprintGroup } from '../core/blueprint-authoring';
import { ActionEditor } from './Inspector';
import { BlueprintNameField } from './BlueprintNaming';
import { blueprintContext } from '../core/blueprint-context';
import { blueprintCapabilityCheck, blueprintCapabilityNames, blueprintCapabilitySummary } from '../core/blueprint-capabilities';
import { blueprintActorInputSnapshot, BlueprintActorInputMessages, BlueprintInlineValue, BlueprintNodeFields } from './BlueprintNodeFields';
import { BlueprintUiPropertyFields } from './BlueprintUiPropertyFields';
import { addInteractionBlueprintExample, addParallelMotionExample } from '../core/blueprint-examples';
import { prepareBlueprintInsertion, type BlueprintWireOrigin } from '../core/blueprint-insertion';
import { BlueprintViewCache, reuseBlueprintEdges } from './blueprint-view';
import { useBlueprintEdgeSelection } from './useBlueprintEdgeSelection';
import { useStableCallbacks } from './useStableCallbacks';
import { useBlueprintPinReconnect } from './useBlueprintPinReconnect';
import { blueprintWireShortcuts } from './blueprint-wire-interaction';
import { applyBlueprintWireConnection } from '../core/blueprint-wire-edit';
import { blueprintLayoutIsCurrent, registerBlueprintEditor, type BlueprintEditorCommand } from './blueprint-editor-actions';
import type { AiEditorResult } from '../core/ai-editor-commands';

const initialNodes: FlowNode[] = [];
type WireOrigin = BlueprintWireOrigin;
function GraphGroupField({ project, graph, commit, message }: { project: Project; graph: BlueprintGraph; commit: Commit; message: (value: string) => void }) {
  const saved = blueprintGroup(project, graph.id), [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved, graph.id]);
  return <Field label="资源分组" hint="用 / 嵌套分组；资源管理器和 / 调用菜单同步更新。"><input aria-label="蓝图资源分组" value={value} onChange={event => setValue(event.target.value)} onBlur={() => {
    if (value === saved) return;
    try { const copy = cloneData(project); assignBlueprintGroup(copy, graph.id, value); commit('修改蓝图分组', draft => { draft.contentBrowser = copy.contentBrowser; }); }
    catch (error) { message(error instanceof Error ? error.message : String(error)); setValue(saved); }
  }} /></Field>;
}
const nodeTypes = { blueprint: BlueprintGraphNode };
type InspectorTab = 'node' | 'interface' | 'state';
// Wires are selected and disconnected on the canvas; an older "links" tab opens node parameters.
const inspectorTabOf = (tab: BlueprintCanvasLocation['inspector']['tab'] | undefined): InspectorTab => tab === 'interface' || tab === 'state' ? tab : 'node';
export interface BlueprintFocus { restore?: BlueprintGraphOrigin; selection?:BlueprintSelectionRequest; graphId: string; nodeId?: string; objectInstanceId?:string; request: number }
export interface UiGraphWorkspace {
  pageId: string;
  moduleLibrary?: BlueprintModuleLibraryState;
  preferences?: { autoConnect: boolean; environmentOnly: boolean };
  session?: { active?: string; directoryScroll: { current: number }; detailScroll: Map<string, number> };
  onLocateComponent?: (id: string) => void;
  selectedComponentId?: string;
  toolbar: ReactNode;
  library: (add: (type: BlueprintNodeType, properties?: Record<string, VariableValue>) => void, modules?: ReactNode) => ReactNode;
}
interface Props { onRememberView?: (view: BlueprintCanvasLocation) => void; onLocateUsage?: (usage: BlueprintUsage) => void; onOpenGraph?: OpenBlueprintGraph; hideGraphPicker?: boolean; onOpenUiAnimation?:(id:string,nodeId?:string)=>void; fixedGraph?:boolean; uiWorkspace?:UiGraphWorkspace; onActiveSelection?: (selection?: BlueprintSelection) => void; project: Project; commit: Commit; onBack?: () => void; focus?: BlueprintFocus; compact?: boolean; onGraphChange?: (id: string) => void; onOpenTimeline?: (id: string, ownerId: string, callNodeId?: string) => void }

export const BlueprintGraphEditor = memo(function BlueprintGraphEditor(props: Props) {
  return <ReactFlowProvider key={props.project.id}><GraphEditor {...props} /></ReactFlowProvider>;
});

function GraphEditor({ onRememberView, onLocateUsage, onOpenGraph, hideGraphPicker, project, commit: commitProject, onBack, focus, compact, onGraphChange, onOpenTimeline, onActiveSelection, uiWorkspace, fixedGraph, onOpenUiAnimation }: Props) {
  const graphs = projectGraphs(project) ?? [];
  const [graphId, setGraphId] = useState(focus?.graphId ?? graphs.find(item => !isTimelineComponent(item))?.id ?? '');
  const graph = uiWorkspace || fixedGraph ? graphs.find(item=>item.id===focus?.graphId) : graphs.find(item => item.id === graphId) ?? graphs.find(item => !isTimelineComponent(item));
  const uiSidebar = useUiEventSidebar();
  const selectUiDetail = uiWorkspace ? uiSidebar?.select : undefined;
  const revealNodeDetails = useCallback((id?: string) => {
    if (graph) selectUiDetail?.(id ? `node:${graph.id}:${id}` : `graph:${graph.id}`);
  }, [graph?.id, selectUiDetail]);
  const [selectedId, setSelectedId] = useState<string | undefined>(focus?.nodeId);
  const { selectedEdgeIds, setSelectedEdgeIds, setSelectedEdgeId, onEdgesChange } = useBlueprintEdgeSelection<FlowNode>(graph?.id);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const pendingSelection = useRef<string | undefined>(focus?.nodeId);
  const collapseKey = `vns:blueprint-parameters:${project.id}`;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem(collapseKey) ?? '[]'); return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []); } catch { return new Set(); }
  });
  const toggleParameters = useCallback((id: string) => setCollapsed(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; }), []);
  useEffect(() => { try { localStorage.setItem(collapseKey, JSON.stringify([...collapsed])); } catch { /* Optional editor preference. */ } }, [collapsed, collapseKey]);
  const advancedKey = `vns:blueprint-advanced-pins:${project.id}`;
  const [advancedExpanded, setAdvancedExpanded] = useState<ReadonlySet<string>>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem(advancedKey) ?? '[]'); return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []); } catch { return new Set(); }
  });
  const toggleAdvanced = useCallback((id: string) => setAdvancedExpanded(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; }), []);
  useEffect(() => { try { localStorage.setItem(advancedKey, JSON.stringify([...advancedExpanded])); } catch { /* Optional editor preference. */ } }, [advancedExpanded, advancedKey]);
  const allParametersCollapsed = !!graph?.nodes.length && graph.nodes.every(node => collapsed.has(node.id));
  const [paletteOpen, setPaletteOpen] = useState(() => { try { return localStorage.getItem('vns:blueprint-palette') === 'true'; } catch { return false; } });
  const [propertiesOpen, setPropertiesOpen] = useState(focus?.restore?.inspector.open ?? !compact);
  const panelLayout = useBlueprintPanelLayout(paletteOpen, propertiesOpen);
  const [arranging, setArranging] = useState(false);
  const arrangingNow = useRef(false), mounted = useRef(true);
  const latestGraph = useRef({ projectId: project.id, graph });
  latestGraph.current = { projectId: project.id, graph };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const canvas = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [memberDrop, setMemberDrop] = useState<{ reference: BlueprintMemberReference; graphId: string; access: BlueprintMemberAccess; x: number; y: number; position: { x: number; y: number } }>();
  const [componentDrop,setComponentDrop]=useState<{id:string;x:number;y:number;position:{x:number;y:number}}>();
  const [memberDragging, setMemberDragging] = useState(false);
  useEffect(() => { setMemberDrop(undefined); setComponentDrop(undefined); setMemberDragging(false); }, [project.id, graph?.id]);
  useEffect(() => {
    const finish = () => setMemberDragging(false);
    window.addEventListener('dragend', finish); window.addEventListener('drop', finish); window.addEventListener('blur', finish);
    return () => { window.removeEventListener('dragend', finish); window.removeEventListener('drop', finish); window.removeEventListener('blur', finish); };
  }, []);
  const [helpOpen, setHelpOpen] = useState(false);
  const [uiContextOnly,setUiContextOnly]=useState(uiWorkspace?.preferences?.environmentOnly ?? true);
  const environment = uiWorkspace ? project.minigames?.some(game => game.uiPageId === uiWorkspace.pageId) ? 'minigame' : 'ui' : undefined;

  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(inspectorTabOf(focus?.restore?.inspector.tab));
  const nodeClickOrigin = useRef<BlueprintNodeClickOrigin | undefined>(undefined);
  const [autoConnect, setAutoConnect] = useState(uiWorkspace?.preferences?.autoConnect ?? true);
  useEffect(() => { if (uiWorkspace?.preferences) Object.assign(uiWorkspace.preferences, { autoConnect, environmentOnly: uiContextOnly }); }, [uiWorkspace?.preferences, autoConnect, uiContextOnly]);
  const [message, setMessage] = useState('');
  // Why the latest commit was rejected, for callers that report the result themselves.
  const commitFailure = useRef<string | undefined>(undefined);
  const commit = useCallback((label: string, edit: Parameters<Commit>[1], options?: Parameters<Commit>[2]) => {
    let applied = false, failure: unknown;
    try {
      commitProject(label, draft => {
        const before = projectEditSnapshot(draft);
        try { edit(draft); synchronizeBlueprintSignatures(draft, before); assertTimelineEditDoesNotOverlap(before, draft); }
        catch (error) { failure = error; throw error; }
        applied = true;
      }, options);
    } catch (error) { failure = error; }
    // Stage commits may catch the exception themselves; UI drafts propagate it.
    commitFailure.current = failure ? failure instanceof Error ? failure.message : String(failure) : undefined;
    if (commitFailure.current) setMessage(commitFailure.current);
    else if (applied) setMessage('');
    return applied && !failure;
  }, [commitProject]);
  const [encapsulation, setEncapsulation] = useState<{ graphId: string; nodeIds: string[] }>();
  const [interfaceChange, setInterfaceChange] = useState<{ graphId: string; change: BlueprintInterfaceChange }>();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; position: { x: number; y: number }; wire?: WireOrigin }>();
  const [viewCache] = useState(() => new BlueprintViewCache({ assumeImmutable: true }));
  const edgeCache = useRef<StudioEdge[]>([]);
  const flow = useReactFlow<FlowNode>();
  const { setNodes: setFlowNodes, getNodes: getFlowNodes } = flow;
  const nodesInitialized = useNodesInitialized();
  const framedRequest = useRef<string | undefined>(undefined);
  const frameNode = (id: string) => flow.fitView({ nodes: [{id}], padding: .2, minZoom: .65, maxZoom: 1, duration: 160 });
  const selectNode = useCallback((id?: string, revealDetails = true) => {
    pendingSelection.current = id && !getFlowNodes().some(node => node.id === id) ? id : undefined;
    setSelectedId(id); setSelectedEdgeId();
    setFlowNodes(previous => previous.map(node => node.selected === (node.id === id) ? node : { ...node, selected: node.id === id }));
    if (revealDetails) revealNodeDetails(id);
  }, [getFlowNodes, setFlowNodes, setSelectedEdgeId, revealNodeDetails]);
  const onSelectionChange = useCallback(({ nodes }: OnSelectionChangeParams<FlowNode, StudioEdge>) => {
    const ids = nodes.map(node => node.id);
    setSelectedNodeIds(previous => previous.length === ids.length && previous.every((id, i) => id === ids[i]) ? previous : ids);
    setSelectedId(previous => nodes.some(node => node.id === previous) ? previous : nodes[0]?.id);
  }, []);
  // Only a canvas gesture or explicit navigation takes over the detail area.
  // Restoring the React Flow selection must not replace a variable/component the user is editing.
  const revealCanvasSelection = (preferredId?: string) => {
    if (!uiWorkspace) return;
    const nodes = getFlowNodes().filter(node => node.selected);
    const id = nodes.find(node => node.id === preferredId)?.id ?? nodes.find(node => node.id === selectedId)?.id ?? nodes[0]?.id;
    setSelectedId(id); revealNodeDetails(id);
  };
  const updateNodeInternals = useUpdateNodeInternals();
  const [diagnosticCache] = useState(() => new BlueprintDiagnosticCache({ assumeImmutable: true }));
  const diagnostics = useMemo(() => diagnosticCache.update(project), [project, diagnosticCache]);
  const activeGraphId = graph?.id;
  const editNode = useCallback((id: string, edit: (node: BlueprintNode) => void) => commit('修改节点参数', draft => {
    const graph=projectGraphs(draft).find(item=>item.id===activeGraphId),target=graph?.nodes.find(item=>item.id===id);
    if (target) edit(target);
  }), [commit, activeGraphId]);
  const locateNodeFromPin = useCallback((id: string) => { selectNode(id); setInspectorTab('node'); setPropertiesOpen(true); void flow.fitView({ nodes: [{ id }], padding: .2, minZoom: .65, maxZoom: 1, duration: 160 }); }, [selectNode, flow]);
  const inspectNode = useCallback((id: string) => { selectNode(id); setInspectorTab('node'); setPropertiesOpen(true); }, [selectNode]);
  const { locateComponentFromPin } = useStableCallbacks({ locateComponentFromPin: (id: string) => {
    if (!uiWorkspace || !uiPageComponents(project, uiWorkspace.pageId).some(component => component.id === id)) { setMessage('此控件已不存在或不属于当前页面，未改变设计页面。'); return; }
    uiWorkspace.onLocateComponent?.(id);
  } });
  const viewActions = useMemo(() => ({ locateNode: locateNodeFromPin, inspectNode, locateComponent: uiWorkspace?.onLocateComponent ? locateComponentFromPin : undefined }), [locateNodeFromPin, inspectNode, !!uiWorkspace?.onLocateComponent, locateComponentFromPin]);
  const nodeViews = useMemo(() => graph ? viewCache.update(project, graph, diagnostics, editNode, collapsed, toggleParameters, viewActions, { expanded: advancedExpanded, toggle: toggleAdvanced }) : [], [project, graph, diagnostics, editNode, viewCache, collapsed, toggleParameters, viewActions, advancedExpanded, toggleAdvanced]);
  const pinLayouts = useMemo(() => new Map(nodeViews.map(({ node, data }) => [node.id, data.layout.signature + ':' + data.cardSummary])), [nodeViews]);
  const priorPinLayouts = useRef<{ graphId?: string; layouts: Map<string, string> }>({ layouts: new Map() });
  const pendingPinLayouts = useRef(new Set<string>());
  // Keep the queue across cancelled frames (including StrictMode's effect replay).
  // A fast follow-up render must not lose a handle layout awaiting measurement.
  useEffect(() => {
    const before = priorPinLayouts.current;
    if (before.graphId !== graph?.id) pendingPinLayouts.current.clear();
    for (const [id, layout] of pinLayouts) if (before.graphId !== graph?.id || before.layouts.get(id) !== layout) pendingPinLayouts.current.add(id);
    priorPinLayouts.current = { graphId: graph?.id, layouts: pinLayouts };
    if (!pendingPinLayouts.current.size) return;
    const frame = requestAnimationFrame(() => {
      const changed = [...pendingPinLayouts.current].filter(id => pinLayouts.has(id));
      pendingPinLayouts.current.clear();
      if (changed.length) updateNodeInternals(changed);
    });
    return () => cancelAnimationFrame(frame);
  }, [graph?.id, pinLayouts, updateNodeInternals]);
  const selected = graph?.nodes.find(node => node.id === selectedId);
  const activeNodeIds = graph?.nodes.filter(n => selectedNodeIds.includes(n.id)).map(n => n.id) ?? [];
  const activeLinkIds = graph?.links.filter(l => selectedEdgeIds.has(l.id)).map(l => l.id) ?? [];
  const activeSelectionKey = JSON.stringify([graph?.id, selected?.id, activeNodeIds, activeLinkIds]);
  useEffect(() => { onActiveSelection?.(graph ? {graphId:graph.id,nodeId:selected?.id,nodeIds:activeNodeIds,linkIds:activeLinkIds} : undefined); }, [activeSelectionKey, onActiveSelection]);
  useEffect(() => () => onActiveSelection?.(undefined), [onActiveSelection]);
  const selectedCall = selected && isBlueprintModuleReference(selected.type) ? graphs.find(item => item.id === selected.properties.graphId) : undefined;
  const selectedIssues = diagnostics.filter(issue => issue.nodeId === selectedId);
  const linkDescription = (link: BlueprintGraph['links'][number]) => {
    const from = graph?.nodes.find(node => node.id === link.fromNodeId), to = graph?.nodes.find(node => node.id === link.toNodeId);
    const fromPin = from?.pins.find(pin => pin.id === link.fromPinId);
    const label = from && graph && fromPin?.dataType !== 'exec' ? blueprintOutputLabel(project,graph,from,link.fromPinId) : `${from?.name ?? '缺失节点'} · ${fromPin?.name ?? link.fromPinId}`;
    return `${label} → ${to?.name ?? '缺失节点'} · ${to?.pins.find(pin => pin.id === link.toPinId)?.name ?? link.toPinId}`;
  };
  useEffect(() => { try { localStorage.setItem('vns:blueprint-palette', String(paletteOpen)); } catch { /* Optional preference. */ } }, [paletteOpen]);
  useEffect(() => { setSelectedEdgeIds(new Set([...selectedEdgeIds].filter(id => graph?.links.some(link => link.id === id)))); }, [graph, selectedEdgeIds, setSelectedEdgeIds]);

  useEffect(() => {
    // Even a no-op host commit may materialize a temporary performance. Only ask
    // for an authored migration when the interface data actually needs one.
    const normalized = mutateProject(project, draft => synchronizeBlueprintSignatures(draft));
    if (!sameProjectValue(project, normalized)) commit('更新蓝图接口', synchronizeBlueprintSignatures);
  }, [project.id]);
  const appliedFocusRequest = useRef<Pick<BlueprintFocus, 'graphId' | 'nodeId' | 'request'> | undefined>(undefined);
  useEffect(() => {
    if (!focus) return;
    const previous = appliedFocusRequest.current;
    if (previous?.graphId === focus.graphId && previous.nodeId === focus.nodeId && previous.request === focus.request) return;
    // Activity resumes effects when returning from an animation or timeline.
    // A previously handled location must not take over the current sidebar detail again.
    appliedFocusRequest.current = { graphId: focus.graphId, nodeId: focus.nodeId, request: focus.request };
    if (focus.selection || focus.restore) { setGraphId(focus.graphId); return; }
    // The host echoes graph selection. Keep the node selected by createGraph
    // so adding the first action still connects it to the new start event.
    if (focus.graphId === graphId && !focus.nodeId) return;
    // The event host restores member forms independently of the canvas. A
    // graph-only entry clears stale selection without taking over that detail.
    setGraphId(focus.graphId); selectNode(focus.nodeId, !uiWorkspace || !!focus.nodeId); setInspectorTab('node'); setPropertiesOpen(!compact || !!focus.nodeId);
  }, [focus?.request, focus?.graphId, focus?.nodeId]);
  useEffect(() => {
    setFlowNodes(previous => {
      const byId = new Map(previous.map(node => [node.id, node]));
      const requested = pendingSelection.current;
      if (nodeViews.some(({ node }) => node.id === requested)) pendingSelection.current = undefined;
      const next = nodeViews.map<FlowNode>(({ node, data }) => {
        const before = byId.get(node.id);
        const selected = requested ? node.id === requested : before?.selected ?? false;
        if (before?.data === data && before.position.x === node.x && before.position.y === node.y && before.selected === selected) return before;
        return { ...before, id: node.id, type: 'blueprint', position: { x: node.x, y: node.y }, selected, data };
      });
      return next.length === previous.length && next.every((node, index) => node === previous[index]) ? previous : next;
    });
  }, [nodeViews, setFlowNodes]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target as HTMLElement)?.closest('input, textarea, select, summary, [contenteditable="true"], .content-browser, .modal-backdrop, dialog, [role="alertdialog"], .sidebar, .node-picker, .blueprint-properties, .blueprint-palette, .ui-event-library, .ui-event-sidebar, [popover]:popover-open')) return;
      if (event.key === 'Escape') { setContextMenu(undefined); selectNode(); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedEdgeIds.size || getFlowNodes().some(node => node.selected))) { event.preventDefault(); deleteSelected(); }
      if (event.key.toLocaleLowerCase() === 'd' && (event.ctrlKey || event.metaKey) && selected) { event.preventDefault(); duplicateSelected(); }
      // Space adds nodes here, so React Flow's Space pan stays off: its window-wide listener would also swallow Space on every disclosure summary.
      if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target as HTMLElement)?.closest('button')) { event.preventDefault(); openNodePicker(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, selected, selectedEdgeIds, graph, getFlowNodes, selectNode]);
  useEffect(() => {
    if (!graph || !nodesInitialized || focus?.selection || focus?.restore) return;
    const request = JSON.stringify([graph.id, focus?.graphId, focus?.nodeId, focus?.request]);
    if (framedRequest.current === request) return;
    const frame = requestAnimationFrame(() => {
      framedRequest.current = request;
      const id = focus?.graphId === graph.id && graph.nodes.some(n=>n.id===focus.nodeId) ? focus.nodeId : undefined;
      if (id) void frameNode(id);
      // Opening a graph keeps text readable; "show all" can still zoom out.
      else void flow.fitView({ padding: .22, minZoom: .6, maxZoom: 1, duration: 160 });
    });
    return () => cancelAnimationFrame(frame);
  }, [graph?.id, focus?.graphId, focus?.nodeId, focus?.request, nodesInitialized]);
  const restoredRequest = useRef<BlueprintFocus | undefined>(undefined);
  const liveFocus = useRef(focus); liveFocus.current = focus;
  const rememberView = () => {
    if (!onRememberView || !graph || graph.nodes.length > 0 && !nodesInitialized || focus?.restore && restoredRequest.current !== focus || focus?.selection?.active()) return;
    const nodes = getFlowNodes(), nodeIds = new Set(graph.nodes.map(node => node.id));
    if (nodeIds.size !== nodes.length || nodes.some(node => !nodeIds.has(node.id))) return;
    onRememberView(canvasLocation(graph, nodes.filter(node => node.selected).map(node => node.id), [...selectedEdgeIds], flow.getViewport(), { open: propertiesOpen, tab: inspectorTab }, selectedId));
  };
  const rememberViewRef = useRef(rememberView); rememberViewRef.current = rememberView;
  useLayoutEffect(() => () => rememberViewRef.current(), []);
  useEffect(() => { rememberView(); }, [onRememberView, activeSelectionKey, propertiesOpen, inspectorTab, nodesInitialized]);
  useEffect(() => {
    if (!focus?.restore || !graph || focus.graphId !== graph.id || graph.nodes.length > 0 && !nodesInitialized || graph.nodes.some(node => !getFlowNodes().some(flowNode => flowNode.id === node.id))) return;
    if (restoredRequest.current === focus) return;
    const location = canvasLocation(graph, focus.restore.nodeIds, focus.restore.linkIds, focus.restore.viewport, focus.restore.inspector, focus.restore.primaryNodeId);
    pendingSelection.current = undefined; const ids = new Set(location.nodeIds);
    setFlowNodes(nodes => nodes.map(node => ({ ...node, selected: ids.has(node.id) })));
    setSelectedId(location.primaryNodeId); setSelectedEdgeIds(new Set(location.linkIds)); setContextMenu(undefined);
    setInspectorTab(inspectorTabOf(location.inspector.tab)); setPropertiesOpen(location.inspector.open);
    let second = 0, cancelled = false; const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      if (latestGraph.current.graph?.id !== graph.id || liveFocus.current !== focus) return;
      void flow.setViewport(location.viewport, { duration: 0 }).then(() => {
        if (cancelled || latestGraph.current.graph?.id !== graph.id || liveFocus.current !== focus) return;
        restoredRequest.current = focus; rememberViewRef.current();
      });
    }); });
    return () => { cancelled = true; cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [focus?.restore, focus?.request, graph?.id, nodesInitialized, nodeViews]);
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
    revealNodeDetails(request.nodeIds[0]);
    if(request.nodeIds.length){setInspectorTab('node');setPropertiesOpen(true);}
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
  const edges: StudioEdge[] = useMemo(() => edgeCache.current = reuseBlueprintEdges(edgeCache.current, (graph?.links ?? []).map<StudioEdge>(link => {
    const source = graph?.nodes.find(node => node.id === link.fromNodeId)?.pins.find(pin => pin.id === link.fromPinId);
    const target = graph?.nodes.find(node => node.id === link.toNodeId)?.pins.find(pin => pin.id === link.toPinId);
    const valid = source && target && blueprintPinsCompatible(source, target);
    return { id: link.id, source: link.fromNodeId, sourceHandle: link.fromPinId, target: link.toNodeId, targetHandle: link.toPinId, type: 'studio',
      selected: selectedEdgeIds.has(link.id), selectable: true, reconnectable: true, zIndex: 0,
      ariaLabel: `连线：${linkDescription(link)}`, data: { label: linkDescription(link) },
      style: { stroke: selectedEdgeIds.has(link.id) ? 'var(--editor-accent, #ffd38a)' : valid ? pinColors[source.dataType] : '#eb6f80', strokeWidth: selectedEdgeIds.has(link.id) ? 3 : source?.dataType === 'exec' ? 2.2 : 1.8, strokeDasharray: valid ? undefined : '5 4' } };
  }).sort((first, second) => Number(!!first.selected) - Number(!!second.selected))), [graph, selectedEdgeIds]);
  const editGraph = (label: string, edit: (target: BlueprintGraph) => void) => {
    return !!graph && commit(label, draft => { const target = projectGraphs(draft)?.find(item => item.id === graph.id); if (target) edit(target); });
  };
  const editSelected = (label: string, edit: (node: BlueprintNode) => void) => editGraph(label, target => { const node = target.nodes.find(item => item.id === selectedId); if (node) edit(node); });
  const setProperty = (key: string, value: VariableValue | undefined) => editSelected('修改节点参数', node => {
    if (value === undefined) delete node.properties[key]; else node.properties[key] = value;
  });
  const defaultSelections = (node: BlueprintNode) => {
    if (['eventKey', 'eventTimer', 'eventPage', 'getPageInput', 'getPageOutput', 'setPageOutput', 'preventPageClose', 'showUiPage', 'closeUiPage'].includes(node.type)) node.properties.pageId = project.ui.customPages[0]?.id ?? uiPages(project).find(page => !page.disabled && !page.openProblem)?.id ?? '';
    if (node.type === 'eventSpine') node.properties.componentId = allUiComponents(project).find(c => c.kind === 'spine')?.id ?? '';
    if (node.type === 'eventVideo') node.properties.componentId = allUiComponents(project).find(c => c.kind === 'video')?.id ?? '';
    if (node.type === 'eventImage') node.properties.componentId = allUiComponents(project).find(c => c.kind === 'image')?.id ?? '';
    if(node.type==='eventTextCommitted')node.properties.componentId=allUiComponents(project).find(c=>uiTextInput(project,c))?.id??'';
    if(node.type==='eventValueChanged')node.properties.componentId=allUiComponents(project).find(c=>uiControlValueType(project,c))?.id??'';
    if (['eventClick','eventButton'].includes(node.type)) node.properties.componentId = allUiComponents(project).find(component => component.kind === 'button')?.id ?? '';
    if (node.type === 'showBackground') node.properties.assetId = categoryAssets(project, 'image', 'scene')[0]?.id ?? '';
    if (node.type === 'playMusic' || node.type === 'playSound') node.properties.assetId = categoryAssets(project, 'audio', node.type === 'playMusic' ? 'bgm' : 'sound')[0]?.id ?? '';
    if (node.type === 'hideCharacter' || node.type === 'showCharacter' && uiWorkspace) {
      const character = project.characters[0];
      if (character) { node.properties.characterId = character.id;  }
    }
    if ((isBlueprintFlowControl(node.type) || ['throttle', 'startTask', 'debounce'].includes(node.type)) && graph?.uiPageId) { node.properties.scope = 'page'; node.properties.pageId = graph.uiPageId; }
    if (node.type === 'getVariable' || node.type === 'setVariable') {
      const variable = project.variables[0];
      if (variable) { node.properties.variableId = variable.id; if (node.type === 'setVariable') node.properties.value = variable.initial; }
    }
    if (node.type === 'effect' && project.effects[0]) node.properties.effectId = project.effects[0].id;
    if (node.type === 'getInput' && graph?.exposedInputs[0]) node.properties.inputId = graph.exposedInputs[0].id;
    if (node.type === 'setOutput' && graph?.exposedOutputs[0]) node.properties.outputId = graph.exposedOutputs[0].id;
    if (['setUiProperty', 'getUiProperty', 'getUiDefault', 'resetUiProperty', 'animateUiProperty', 'stopUiAnimation', 'resetUiComponent', 'playUiVideo', 'pauseUiVideo', 'stopUiVideo', 'playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type)) {
      const component = allUiComponents(project).find(item => ['playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type) ? item.kind === 'spine' : ['playUiVideo', 'pauseUiVideo', 'stopUiVideo'].includes(node.type) ? item.kind === 'video' : true);
      if (component) {
        node.properties.componentId = component.id;
        if (node.type === 'playSpine') node.properties.animation = project.assets.find(item => item.id === component.assetId)?.spine?.animations[0]?.name ?? '';
      }
    }
    if(['playUiAnimation','stopUiAnimationPlayback'].includes(node.type))node.properties.animationId=(uiWorkspace?uiPageAnimations(project,uiWorkspace.pageId):project.ui.animations)?.[0]?.id??'';
    if(uiWorkspace){
      const eventPageId=graph?.uiPageId??uiWorkspace.pageId,components=uiPageComponents(project,eventPageId),component=components.find(c=>c.id===uiWorkspace.selectedComponentId)??components[0];
      if(['eventKey','eventTimer','eventPage'].includes(node.type))Object.assign(node.properties,{pageId:eventPageId,uiInstanceId:graph?.uiInstanceId??(eventPageId.startsWith('ui:')?project.ui.activeInstanceId??'base':'')});
      if (node.type === 'eventSpine') Object.assign(node.properties, { componentId: (component?.kind === 'spine' ? component : components.find(c => c.kind === 'spine'))?.id ?? '', uiInstanceId: graph?.uiInstanceId ?? '' });
      if (node.type === 'eventVideo') Object.assign(node.properties, { componentId: (component?.kind === 'video' ? component : components.find(c => c.kind === 'video'))?.id ?? '', uiInstanceId: graph?.uiInstanceId ?? '' });
      if (node.type === 'eventImage') Object.assign(node.properties, { componentId: (component?.kind === 'image' ? component : components.find(c => c.kind === 'image'))?.id ?? '', uiInstanceId: graph?.uiInstanceId ?? '' });
      if(node.type==='eventTextCommitted')Object.assign(node.properties,{componentId:(uiTextInput(project,component)?component:components.find(c=>uiTextInput(project,c)))?.id??'',uiInstanceId:graph?.uiInstanceId??''});
      if(node.type==='eventValueChanged')Object.assign(node.properties,{componentId:(uiControlValueType(project,component)?component:components.find(c=>uiControlValueType(project,c)))?.id??'',uiInstanceId:graph?.uiInstanceId??''});
      if(['eventClick','eventButton'].includes(node.type))Object.assign(node.properties,{componentId:components.find(c=>c.id===component?.id&&c.kind==='button')?.id??components.find(c=>c.kind==='button')?.id??'',uiInstanceId:graph?.uiInstanceId??''});
      if(['getUiProperty','setUiProperty','getUiDefault','resetUiProperty','animateUiProperty','stopUiAnimation','resetUiComponent'].includes(node.type))node.properties.componentId=component?.id??'';
    }
  };
  const prepareNode = (type: BlueprintNodeType, called?: BlueprintGraph, properties?: Record<string, VariableValue>) => {
    const node = blueprintNodeDefaults(type, graph?.nodes.length ?? 0); defaultSelections(node);
    if (called) { node.name = called.name; node.properties.graphId = called.id; node.pins = callablePins(called); }
    if (properties) Object.assign(node.properties, properties);
    return node;
  };
  const capabilitySummary = useMemo(() => graph ? blueprintCapabilitySummary(project, graph) : undefined, [project, graph]);
  const openModule = (id: string, callNodeId?: string, inspector: BlueprintCanvasLocation['inspector'] = { open: propertiesOpen, tab: inspectorTab }) => {
    if (!graph || !onOpenGraph) return;
    const ids = getFlowNodes().filter(node => node.selected).map(node => node.id);
    if (callNodeId && !ids.includes(callNodeId)) ids.push(callNodeId);
    onOpenGraph(id, undefined, canvasLocation(graph, ids, [...selectedEdgeIds], flow.getViewport(), inspector, callNodeId ?? selectedId));
  };
  const chooseGraph = (id: string, fromCall = false) => { if (onOpenGraph && !isTimelineComponent(graphs.find(g => g.id === id))) { if (fromCall) openModule(id, selectedId); else onOpenGraph(id); return; } if (fixedGraph && !isTimelineComponent(graphs.find(item => item.id === id))) { setMessage('请在蓝图工作区编辑这个复用流程。'); return; } if (isTimelineComponent(graphs.find(item => item.id === id)) && onOpenTimeline && graph) { onOpenTimeline(id, graph.id, selected?.properties.graphId === id ? selected.id : undefined); return; } setGraphId(id); onGraphChange?.(id); selectNode(); setContextMenu(undefined); setInspectorTab('node'); setMessage(''); };
  const inspectEdge = () => { setContextMenu(undefined); revealCanvasSelection(); setMessage('连线已选中。按 Delete 断开。' + blueprintWireShortcuts); };
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
    const source = {projectId:project.id,graph:cloneData(graph)};
    try {
      const measured = new Map(getFlowNodes().map(item => [item.id, item.measured]));
      const connected = new Map<string, Set<string>>();
      for (const link of graph.links) { const pins = connected.get(link.toNodeId) ?? new Set<string>(); pins.add(link.toPinId); connected.set(link.toNodeId, pins); }
      const layout = await layoutBlueprint({ id: graph.id, layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '48', 'elk.layered.spacing.nodeNodeBetweenLayers': '84' }, children: graph.nodes.map(node => ({ id: node.id, ...blueprintMeasuredNodeSize(node, { parametersCollapsed: collapsed.has(node.id), advancedExpanded: advancedExpanded.has(node.id), connectedInputs: connected.get(node.id), hasProblem: diagnostics.some(issue => issue.nodeId === node.id) }, measured.get(node.id)) })), edges: graph.links.map(link => ({ id: link.id, sources: [link.fromNodeId], targets: [link.toNodeId] })) });
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
    if(command==='showBlueprintConnections'){
      if(!graph.links.length)return {status:'cancelled',message:'当前蓝图还没有连线。'};
      selectNode();setSelectedEdgeIds(new Set(graph.links.map(link=>link.id)));
      await flow.fitView({padding:.22,maxZoom:1,duration:180});
      return {status:'completed',message:'已在画布上选中「'+graph.name+'」的 '+graph.links.length+' 条连线，按 Delete 可全部断开。'};
    }
    setPropertiesOpen(true);setInspectorTab(command==='showBlueprintInterface'?'interface':'node');
    return {status:'completed',message:'已打开当前蓝图的'+(command==='showBlueprintInterface'?'输入与输出。':'节点属性。')};
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
    setMessage(starter ? '示例已连接好。选择节点修改参数，再把这张蓝图添加到对白演出或场景事件中。' : '点击“添加节点”开始。选中事件开始后添加常用演出，可以自动接线。');
  };
  const addExample = (kind: string) => {
    if (!kind) return;
    const next = cloneData(project);
    const id = kind === 'interaction' ? addInteractionBlueprintExample(next).graphId : addParallelMotionExample(next);
    if (!commit('添加蓝图示例', draft => { setProjectGraphs(draft, projectGraphs(next)); draft.ui.customPages = next.ui.customPages; draft.variables = next.variables; draft.contentBrowser = next.contentBrowser; })) return;
    chooseGraph(id);
    setMessage(kind === 'interaction' ? `已添加蓝图与自定义界面。在文本中输入 @${projectGraphs(next).find(item => item.id === id)!.name} 调用；在界面编辑器中修改按钮和布局。` : '镜头不等待 → 震动等待，两种演出同时播放。节点上可直接调整时长和幅度。');
  };
  const insertNode = (source: BlueprintNode, position?: { x: number; y: number }, wire?: WireOrigin) => {
    if (!graph) return;
    if (graph.nodes.length >= 512) { setMessage('这张蓝图已有 512 个节点，请先整理节点后再添加。'); return; }
    if (source.type === 'event' && graph.nodes.some(node => node.type === 'event')) return;
    const insertion = prepareBlueprintInsertion(project, graph, source, wire);
    const { node, destination } = insertion;
    if (insertion.problem) { setMessage(insertion.problem); return; }
    const available = selected?.pins.filter(pin => pin.direction === 'output' && pin.dataType === 'exec' && !graph.links.some(link => link.fromNodeId === selected.id && link.fromPinId === pin.id)) ?? [];
    const from = !wire && autoConnect && available.length === 1 && node.pins.some(pin => pin.id === 'exec_in') ? available[0] : undefined;
    const capability = environment ? blueprintCapabilityCheck(project, node, environment, insertion.graph) : undefined;
    if (capability?.problem) { setMessage(capability.problem); return; }
    const measured = new Map(getFlowNodes().map(item => [item.id, item.measured]));
    const size = (item: BlueprintNode) => blueprintMeasuredNodeSize(item, {
      parametersCollapsed: collapsed.has(item.id), advancedExpanded: advancedExpanded.has(item.id),
      connectedInputs: new Set(graph.links.filter(link => link.toNodeId === item.id).map(link => link.toPinId)),
      hasProblem: diagnostics.some(issue => issue.nodeId === item.id),
    }, measured.get(item.id));
    if (position) { node.x = position.x; node.y = position.y; }
    else if (selected && from) { node.x = selected.x + size(selected).width + 84; node.y = selected.y; }
    else {
      const viewport = document.querySelector('.generic-blueprint-workspace .flow-container')?.getBoundingClientRect();
      if (viewport) { const point = flow.screenToFlowPosition({ x: viewport.x + viewport.width / 2 - 100, y: viewport.y + viewport.height / 2 - 50 }); node.x = point.x; node.y = point.y; }
    }
    const newSize = size(node), sizes = new Map(graph.nodes.map(item => [item.id, size(item)]));
    // Keep the complete node rectangles apart, including their connection
    // points. Near-identical origins are not the only kind of overlap.
    for (let attempt = 0; attempt <= graph.nodes.length; attempt++) {
      const overlap = graph.nodes.find(other => { const bounds = sizes.get(other.id)!; return node.x < other.x + bounds.width + 16 && node.x + newSize.width + 16 > other.x && node.y < other.y + bounds.height + 24 && node.y + newSize.height + 24 > other.y; });
      if (!overlap) break;
      node.y = overlap.y + sizes.get(overlap.id)!.height + 40;
    }
    if (!editGraph('添加蓝图节点', target => {
      if (target.nodes.length >= 512) throw new Error('这张蓝图已有 512 个节点，请先整理节点后再添加。');
      target.nodes.push(node);
      if (selected && from) connectBlueprintPins(target, selected.id, from.id, node.id, 'exec_in');
      if (wire && destination) {
        const error = wire.direction === 'output' ? connectBlueprintPins(target, wire.nodeId, wire.pinId, node.id, destination.id) : connectBlueprintPins(target, node.id, destination.id, wire.nodeId, wire.pinId);
        if (error) throw new Error(error);
      }
    })) return;
    selectNode(node.id); setInspectorTab('node'); setPropertiesOpen(true);
    const assetReference = blueprintAssetNodePresentation(project, node);
    const notice = wire ? `已添加${node.name}并接线，可一次撤销。` : assetReference ? `已添加${assetReference.title}。将右侧素材端口连接到需要该素材的属性。` : from ? `已连接：${selected!.name} → ${node.name}` : `已添加${node.name}。拖动两侧连接点即可连线。`;
    setMessage(notice + (capability?.incomplete ? ' 含动态参数，运行要求需在实际调用时验证。' : ''));
    if (!position) void flow.setCenter(node.x + 120, node.y + 100, { zoom: Math.max(0.65, flow.getZoom()), duration: 180 });
  };
  const addNode = (type: BlueprintNodeType, called?: BlueprintGraph, position?: { x: number; y: number }, properties?: Record<string, VariableValue>, wire?: WireOrigin) => {
    if (graph) insertNode(prepareNode(type, called, properties), position, wire);
  };
  const addMember = (reference: BlueprintMemberReference, operation: 'read' | 'write', position: { x: number; y: number }, targetGraphId: string) => {
    try {
      if (!graph || graph.id !== targetGraphId) throw new Error('蓝图已切换，请重新拖出成员。');
      const current = blueprintMemberAccess(project, graph, reference), action = current.actions.find(action => action.action === operation);
      if (!action) throw new Error('这个成员不支持该操作。');
      addNode(action.type, undefined, position, action.properties);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const dropMember = (reference: BlueprintMemberReference, point: { x: number; y: number }, modifiers: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }) => {
    setContextMenu(undefined); setComponentDrop(undefined); setMemberDrop(undefined);
    try {
      if (!graph) throw new Error('请先打开一张蓝图。');
      if (graph.nodes.length >= 512) throw new Error('这张蓝图已有 512 个节点，请先整理节点后再添加。');
      const access = blueprintMemberAccess(project, graph, reference), position = flow.screenToFlowPosition(point);
      const shortcut = modifiers.altKey && !modifiers.ctrlKey && !modifiers.metaKey ? 'write' : (modifiers.ctrlKey || modifiers.metaKey) && !modifiers.altKey ? 'read' : undefined;
      const action = access.actions.length === 1 ? access.actions[0] : access.actions.find(action => action.action === shortcut);
      if (action) addMember(reference, action.action, position, graph.id);
      else setMemberDrop({ reference, graphId: graph.id, access, ...point, position });
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const droppedComponent = uiWorkspace && componentDrop ? uiPageComponents(project, uiWorkspace.pageId).find(c => c.id === componentDrop.id) : undefined;
  const droppedControlValue = uiControlValue(project, droppedComponent), droppedControlInfo = droppedComponent && uiControlDefinition(project, droppedComponent);
  const controlValueItems: NodePickerItem[] = droppedControlValue?.read && componentDrop ? [
    { id: 'read-control-value', name: '读取绑定源', category: '控件值', hint: '不含临时覆盖；读取：' + droppedControlValue.label, choose: () => addNode(droppedControlValue.read!.type, undefined, componentDrop.position, droppedControlValue.read!.properties) },
    { id: 'write-control-value', name: '设置绑定源', category: '控件值', hint: '修改：' + droppedControlValue.label + '；同步来源，但不解除控件已有的临时覆盖。', choose: () => addNode(droppedControlValue.write!.type, undefined, componentDrop.position, droppedControlValue.write!.properties) },
  ] : droppedControlValue?.error ? [{ id: 'missing-control-value', name: '控件值未就绪', category: '控件值', hint: droppedControlValue.error, disabled: true, choose: () => {} }] : [];
  if (droppedControlInfo && componentDrop) controlValueItems.push(
    { id: 'read-effective-control-value', name: '读取有效控件值', category: '控件值', hint: '读取该控件的绑定值或当前临时覆盖。', choose: () => addNode('getUiProperty', undefined, componentDrop.position, {componentId:componentDrop.id,property:uiControlPrimaryProperty(droppedControlInfo)}) },
    { id: 'override-control-value', name: '临时覆盖控件值', category: '控件值', hint: '只改该控件；节点中可切换为修改绑定源。', choose: () => addNode('setUiProperty', undefined, componentDrop.position, {componentId:componentDrop.id,property:uiControlPrimaryProperty(droppedControlInfo),value:droppedControlInfo.initial,writeMode:'override'}) },
  );
  if (droppedControlInfo?.choice && componentDrop) controlValueItems.push(
    { id: 'read-control-option', name: '读取控件选项', category: '控件选项', hint: '读取当前列表中指定索引的标签和值。', choose: () => addNode('getUiControlOption', undefined, componentDrop.position, { componentId: componentDrop.id, valueType: droppedControlInfo.type, index: 0 }) },
    { id: 'edit-control-options', name: '编辑控件选项', category: '控件选项', hint: '插入、修改、移除、移动、清空或恢复本实例的选项，不改变绑定源。', choose: () => addNode('editUiControlOptions', undefined, componentDrop.position, { componentId: componentDrop.id, valueType: droppedControlInfo.type, index: droppedControlInfo.options.length, label: '选项', value: droppedControlInfo.initial }) },
  );
  if (droppedControlInfo?.range && componentDrop) controlValueItems.push(
    { id: 'set-control-range', name: '设置控件范围', category: '控件值', hint: '一次设置上下限与步长，不改绑定源。', choose: () => addNode('setUiControlRange', undefined, componentDrop.position, {componentId:componentDrop.id,minimum:droppedControlInfo.range!.min,maximum:droppedControlInfo.range!.max,step:droppedControlInfo.range!.step}) },
    { id: 'reset-control-range', name: '重置控件范围', category: '控件值', hint: '恢复整个设计范围，值覆盖保持不变。', choose: () => addNode('resetUiControlRange', undefined, componentDrop.position, {componentId:componentDrop.id}) },
  );
  if (droppedControlInfo?.textInput && componentDrop) controlValueItems.push(
    { id: 'request-input-focus', name: '请求输入焦点', category: '控件值', hint: '排队到宿主刷新，不触发用户提交。', choose: () => addNode('focusUiComponent', undefined, componentDrop.position, {componentId:componentDrop.id,focused:true}) },
    { id: 'release-input-focus', name: '释放输入焦点', category: '控件值', hint: '只释放该输入框，不影响其他输入框。', choose: () => addNode('focusUiComponent', undefined, componentDrop.position, {componentId:componentDrop.id,focused:false}) },
  );
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
  const beginEncapsulation = () => {
    if (!graph) return;
    const nodeIds = getFlowNodes().filter(node => node.selected).map(node => node.id);
    if (!nodeIds.length) { setMessage('先选择需要封装的节点。'); return; }
    setContextMenu(undefined); setEncapsulation({ graphId: graph.id, nodeIds });
  };
  const createEncapsulation = (name: string): string | undefined => {
    if (!encapsulation) return '选择已失效，请重新选择。';
    let created: ReturnType<typeof encapsulateBlueprintSelection> | undefined, failure: string | undefined;
    const accepted = commit('封装为用户节点', draft => {
      try { created = encapsulateBlueprintSelection(draft, encapsulation.graphId, encapsulation.nodeIds, name); }
      catch (error) { failure = error instanceof Error ? error.message : String(error); throw error; }
    }, { separate: true });
    if (!accepted || !created) return failure ?? '未能提交封装，请检查原图中的问题。';
    setEncapsulation(undefined); selectNode(created.caller.id); setInspectorTab('node'); setPropertiesOpen(true);
    setMessage('已封装“' + name + '”：' + created.inputs + ' 个输入、' + created.outputs + ' 个输出。双击调用节点可编辑模块，一次撤销可恢复。');
    return undefined;
  };
  const duplicateSelected = () => {
    if (!selected || selected.type === 'event') return;
    const node = cloneData(selected); node.id = makeId('bpnode'); node.x += 50; node.y += 80; node.name = `${node.name} 副本`.slice(0, 120);
    if (editGraph('复制蓝图节点', target => { if (target.nodes.length < 512) target.nodes.push(node); })) selectNode(node.id);
  };
  const inputField = (pinId: string, label?: string, options: { type?: BlueprintDataType; fallback?: VariableValue; assetKind?: 'image' | 'audio'; componentKind?: 'spine' | 'video'; min?: number; max?: number; step?: number; hint?: string } = {}) => {
    if (!selected || !graph) return null;
    const pin = selected.pins.find(pin => pin.id === pinId);
    const connection = graph.links.find(link => link.toNodeId === selected.id && link.toPinId === pinId);
    const source = connection && graph.nodes.find(node => node.id === connection.fromNodeId);
    const sourceLabel = blueprintInputSource(project,graph,selected.id,pinId)?.label;
    const key = pinId === 'first_index' ? 'firstIndex' : pinId === 'last_index' ? 'lastIndex' : pinId;
    const title = label ?? pin?.name ?? pinId;
    const assetFilter = blueprintNodeAssetFilter(selected, pinId, project);
    return <Field key={pinId} label={title} hint={options.hint}>{connection ? <div className="blueprint-linked-value"><button type="button" className="blueprint-source-link" disabled={!source} title={sourceLabel} aria-label={`定位${title}来源：${sourceLabel}`} onClick={()=>{if(source){selectNode(source.id);void frameNode(source.id);}}}>来自：{sourceLabel}</button><IconButton title={`断开${title}的数据线`} onClick={() => editGraph('断开数据线', target => { target.links = target.links.filter(link => link.id !== connection.id); })}><X size={13} /></IconButton></div>
      : pin ? <BlueprintInlineValue project={project} graph={graph} node={selected} pin={pin} label={selected.type === 'setUiProperty' && pinId === 'value' ? undefined : title} inputOptions={options} onLocateComponent={viewActions.locateComponent} edit={edit => editSelected('修改节点参数', edit)} /> : <BlueprintValueInput componentIds={uiWorkspace?uiPageComponents(project,uiWorkspace.pageId).map(c=>c.id):undefined} project={project} assetKind={assetFilter?.kind} assetCategory={assetFilter?.category} type={options.type ?? 'string'} label={title} value={blueprintInputValue(selected, pinId) ?? options.fallback} onChange={value => setProperty(key, value)} {...options} />}</Field>;
  };
  const typeSelect = (value: BlueprintDataType, label: string, onChange: (type: BlueprintDataType) => void, types = Object.keys(blueprintTypeNames).filter(type => type !== 'exec') as BlueprintDataType[]) => <select aria-label={label} value={value} onChange={event => onChange(event.target.value as BlueprintDataType)}>{types.map(type => <option key={type} value={type}>{blueprintTypeNames[type]}</option>)}</select>;
  const transitionField = (scene = false) => selected && (['showCharacter'].includes(selected.type) && graph ? <BlueprintActorTransitionFields project={project} graph={graph} node={selected} onChange={value => setProperty('actorTransitions', value ? JSON.stringify(value) : '')} /> : <Field label={scene ? '转场方式' : '出现或离开方式'}><select value={String(selected.properties[scene ? 'mode' : 'transition'] ?? 'none')} onChange={event => setProperty(scene ? 'mode' : 'transition', event.target.value)}><option value="none">立即切换</option><option value="dissolve">渐变过渡</option><option value="fade">淡出再淡入</option>{!scene && selected.type !== 'showBackground' && <option value="move">移动过渡</option>}</select></Field>);
  const resourceField = (label: string, key: string, choices: { id: string; name: string }[], onSelected?: (node: BlueprintNode, id: string) => void) => selected && <Field label={label}><select value={String(selected.properties[key] ?? '')} onChange={event => editSelected(`选择${label}`, node => { node.properties[key] = event.target.value; onSelected?.(node, event.target.value); })}><option value="">请选择{label}</option>{choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>;
  const selectedActor = selected && graph && ['showCharacter', 'hideCharacter'].includes(selected.type) ? blueprintActorInputSnapshot(project, graph, selected) : undefined;
  const selectedVariable = graph && selected ? blueprintStateVariable(project, graph, selected) : undefined;
  const selectedComponent = allUiComponents(project).find(item => item.id === selected?.properties.componentId);
  const selectedSpine = project.assets.find(item => item.id === selectedComponent?.assetId)?.spine;
  const selectedAssetReference = selected && blueprintAssetNodePresentation(project, selected);
  const renderProperties = (): ReactNode => {
    if (!selected || !graph) return null;
    switch (selected.type) {
      case 'eventClick': case 'eventButton': case 'eventValueChanged': case 'eventTextCommitted': case 'eventImage': case 'eventVideo': case 'eventSpine': case 'eventKey': case 'eventTimer': return <BlueprintNodeFields surface="inspector" project={project} graph={graph} node={selected} edit={edit => editSelected('修改事件参数', edit)} />;
      case 'eventPage': case 'getPageInput': case 'getPageOutput': case 'setPageOutput': case 'preventPageClose': case 'showUiPage': case 'closeUiPage': return <><BlueprintNodeFields surface="inspector" project={project} graph={graph} node={selected} edit={edit => editSelected('修改页面接口节点', edit)} />{selected.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => graph.links.some(link => link.toNodeId === selected.id && link.toPinId === pin.id) ? inputField(pin.id) : <Field key={pin.id} label={pin.name}><BlueprintInlineValue project={project} graph={graph} node={selected} pin={pin} edit={edit => editSelected('修改页面参数', edit)} /></Field>)}</>;
      case 'focusUiComponent': case 'setUiControlRange': case 'resetUiControlRange': case 'editUiControlOptions': case 'getUiControlOption': return <><BlueprintNodeFields surface="inspector" project={project} graph={graph} node={selected} edit={edit => editSelected('修改控件操作', edit)} />{selected.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => graph.links.some(link => link.toNodeId === selected.id && link.toPinId === pin.id) ? inputField(pin.id) : <Field key={pin.id} label={pin.name}><BlueprintInlineValue project={project} graph={graph} node={selected} pin={pin} onLocateComponent={viewActions.locateComponent} edit={edit => editSelected('修改控件操作', edit)} /></Field>)}</>;
      case 'random': case 'formatText': return <>{selected.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => graph.links.some(l=>l.toNodeId===selected.id&&l.toPinId===pin.id)?inputField(pin.id):<Field key={pin.id} label={pin.name}><BlueprintInlineValue project={project} graph={graph} node={selected} pin={pin} edit={edit => editSelected('修改节点参数', edit)} /></Field>)}</>;
      case 'throttle': case 'startTask': case 'debounce': case 'waitTask': case 'cancelTask': case 'taskStatus': return <><BlueprintNodeFields surface="inspector" project={project} graph={graph} node={selected} edit={edit => editSelected('修改任务定义', edit)} />{selectedCall && <button className="text-button" onClick={() => chooseGraph(selectedCall.id, true)}>{'编辑“' + selectedCall.name + '”'}</button>}{selected.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => inputField(pin.id))}</>;
      case 'doOnce': case 'gate': return <><BlueprintNodeFields surface="inspector" project={project} graph={graph} node={selected} edit={edit => editSelected('修改状态控制', edit)} />{selected.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => graph.links.some(link => link.toNodeId === selected.id && link.toPinId === pin.id) ? inputField(pin.id) : <Field key={pin.id} label={pin.name}><BlueprintInlineValue project={project} graph={graph} node={selected} pin={pin} edit={edit => editSelected('修改状态所属页面', edit)} /></Field>)}</>;
      case 'event': return <p className="blueprint-note">选中这个节点，再添加演出节点，会自动接上第一条执行线。蓝图可从对白演出、场景事件或界面按钮调用。</p>;
      case 'showBackground': return <>{inputField('assetId', '背景素材', { type: 'asset', assetKind: 'image' })}{transitionField()}{inputField('duration', '时长')}{inputField('wait', '等待完成')}</>;
      case 'showChapter': return <>{inputField('title')}{inputField('subtitle')}{inputField('duration', '时长', {})}{inputField('backgroundId', '章节背景', { assetKind: 'image' })}{inputField('titleImageId', '章节题图', { assetKind: 'image' })}{inputField('soundId', '章节音效', { assetKind: 'audio' })}{inputField('effect', '动效', { hint: '留空沿用作品设置；ink 为笔触消散，fade 为淡入淡出，none 为无动画。' })}{inputField('wait', '等待完成')}</>;
      case 'camera': return <><BlueprintNodeFields surface="inspector" project={project} graph={graph} node={selected} edit={edit => editSelected('修改镜头参数', edit)} />{inputField('x')}{inputField('y')}{inputField('zoom', '缩放', {})}{inputField('rotation', '旋转', {})}{inputField('duration', '时长', {})}{inputField('wait')}</>;
      case 'shake': return <>{selected.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => inputField(pin.id))}</>;
      case 'savedAction': { const action = rawSavedBlueprintAction(selected); return action ? <><p className="blueprint-note">这里编辑原始演出。节点输入和连线可覆盖对应内容；未修改的输入会保留。</p><ActionEditor project={project} action={action} entranceOffsets={false} onChange={next => editSelected('修改源演出', node => updateSavedBlueprintAction(node, next))} />{selected.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => inputField(pin.id))}</> : <p className="blueprint-note">此演出数据无效，请重新封装。</p>; }
      case 'switchScene': return <>{inputField('sceneId', '目标场景', { type: 'scene' })}{transitionField(true)}{inputField('duration', '转场秒数', { type: 'number', fallback: 0.5 })}<Field label="转场颜色"><input type="color" value={String(selected.properties.color ?? '#000000')} onChange={event => setProperty('color', event.target.value)} /></Field></>;
      case 'showCharacter': case 'hideCharacter': return <>
        {inputField('characterId', '角色', { type: 'character' })}
        {inputField('instanceId', '第几个')}
        {selected.type === 'showCharacter' && <>
          {inputField('lifetime', '显示范围')}
          {inputField('expressionId', '表情', { type: 'string' })}
          <BlueprintActorInputMessages project={project} graph={graph} node={selected} />
          {selectedActor?.character && !selectedActor.character.expressions.length && <p className="blueprint-note">先在“角色”中为角色添加立绘表情。</p>}
          <div className="blueprint-position-presets" aria-label="角色站位"><span>快捷站位</span>{[['左侧', 'left'], ['中间', 'center'], ['右侧', 'right']].map(([name, presetId]) => <button key={presetId} disabled={selectedActor?.presetLinked} title={selectedActor?.presetLinked ? `站位预设来自：${selectedActor.presetSourceLabel}；断开预设数据线后可选择快捷站位。` : undefined} onClick={() => editSelected('选择角色站位预设', node => { node.properties.presetId = presetId; })}>{name}</button>)}</div>
          {inputField('presetId', '站位预设', { hint: '使用预设时跟随角色设置；手动位置才使用下面的构图、坐标和缩放。' })}{inputField('useDefaultFraming', '手动时使用默认构图')}
          {inputField('x', '横向位置', { type: 'number', fallback: 0.5, step: 0.05, hint: '0 是左边缘，1 是右边缘；可填写负数或大于 1 的位置。' })}
          {inputField('y', '纵向位置', { type: 'number', fallback: 1, step: 0.05, hint: '1 表示脚底在画面底部；大于 1 可将下半身移出画面。' })}{inputField('scale', '角色大小', { type: 'number', fallback: 1, hint: '1 为原始大小，0.5 为一半。' })}{inputField('layer', '前后层级', { type: 'number', fallback: 10 })}
        </>}{inputField('duration', '节点时长（秒）', { hint: '作为角色过渡的节点时长输入；角色或本次调用的阶段设置可覆盖它。' })}{inputField('wait', '等待完成')}{transitionField()}</>;
      case 'playMusic': return <>{inputField('assetId', '音乐素材', { type: 'asset', assetKind: 'audio' })}{inputField('loop', '循环播放', { type: 'boolean', fallback: true })}{inputField('fade', '淡入秒数', { type: 'number', fallback: 0.3 })}</>;
      case 'playSound': return <>{inputField('assetId', '音效素材', { type: 'asset', assetKind: 'audio' })}<Field label="播放通道"><select aria-label="播放通道" value={String(selected.properties.channel ?? 'sound')} onChange={event => setProperty('channel', event.target.value)}><option value="sound">音效</option><option value="ambient">环境音</option></select></Field>{inputField('loop', '循环播放', { type: 'boolean', fallback: false })}</>;
      case 'setPlayerPreference': case 'getPlayerPreference': {
        const preference = (selected.properties.preference ?? 'musicVolume') as PlayerPreference;
        const info = playerPreferences[preference];
        return <><Field label="玩家设置"><select aria-label="玩家设置" value={preference} onChange={event => editSelected('选择玩家设置', node => {
          node.properties.preference = event.target.value;
          node.properties.value = playerPreferences[event.target.value as PlayerPreference].initial;
          delete node.properties.characterId;
        })}>{playerPreferenceKeys.map(key => <option key={key} value={key}>{preferenceInfo(project, key).name}</option>)}</select></Field>
          {preference === 'characterVolume' && inputField('characterId', '配音角色', { type: 'character', hint: '留空时调节旁白及其他配音。' })}
          {selected.type === 'setPlayerPreference' && (info?.options && !graph.links.some(link => link.toNodeId === selected.id && link.toPinId === 'value') ? <Field label="设置值"><PreferenceValueInput preference={preference} value={blueprintInputValue(selected, 'value')} onChange={value => setProperty('value', value)} /></Field> : inputField('value', '设置值', { type: info?.type ?? 'number', fallback: info?.initial, hint: preference === 'textSpeed' ? '每秒字数；0 表示立即显示。' : info?.max === 1 ? '0 至 1，1 为最大值。' : undefined }))}
        </>;
      }
      case 'confirmMessage': return inputField('message', '提示文字', { type: 'string', fallback: '确认继续吗？', hint: '在界面编辑器的“消息框”页配置外观，分别连接确定和取消路线。' });
      case 'setMinigameValue': return <><Field label="状态名称" hint="同一小游戏内使用相同名称即可读写，例如 score、progress 或 status。"><input maxLength={64} value={String(selected.properties.key ?? '')} onChange={event => setProperty('key', event.target.value)} /></Field>{inputField('value', '状态值', { type: 'any', fallback: 0 })}</>;
      case 'getMinigameValue': {
        const output = selected.pins.find(pin => pin.id === 'value');
        return <><Field label="状态名称"><input maxLength={64} value={String(selected.properties.key ?? '')} onChange={event => setProperty('key', event.target.value)} /></Field><Field label="值类型">{typeSelect(output?.dataType ?? 'any', '小游戏值类型', type => editSelected('修改小游戏值类型', node => { const pin = node.pins.find(item => item.id === 'value'); if (pin) pin.dataType = type; node.properties.defaultValue = defaultBlueprintValue(type); }), ['number', 'string', 'boolean', 'any'])}</Field><Field label="没有值时"><BlueprintValueInput project={project} type={output?.dataType ?? 'any'} label="小游戏默认值" value={selected.properties.defaultValue ?? 0} onChange={value => setProperty('defaultValue', value)} /></Field></>;
      }
      case 'finishMinigame': return <Field label="剧情结果"><select value={String(selected.properties.result ?? 'success')} onChange={event => setProperty('result', event.target.value)}><option value="success">成功</option><option value="failure">失败</option><option value="cancel">取消</option></select></Field>;
      case 'setUiProperty': return <>{inputField('componentId', '界面组件', { type: 'component' })}<BlueprintUiPropertyFields surface="inspector" project={project} graph={graph} node={selected} edit={edit => editSelected('修改组件属性', edit)} onLocateNode={viewActions.locateNode} onDisconnect={pinId => editGraph('断开属性数据线', target => { target.links = target.links.filter(link => link.toNodeId !== selected.id || link.toPinId !== pinId); })} /></>;
      case 'getUiProperty': case 'getUiDefault': case 'resetUiProperty': return <>{inputField('componentId', '界面组件', { type: 'component' })}<BlueprintNodeFields surface="inspector" project={project} graph={graph} node={selected} edit={edit => editSelected('修改组件属性', edit)} /></>;
      case 'playUiAnimation': case 'stopUiAnimationPlayback': return <><BlueprintNodeFields surface="inspector" project={project} graph={graph} node={selected} edit={edit=>editSelected('修改界面动画调用',edit)}/>{selected.type==='playUiAnimation'?<>{inputField('loops','循环次数（0为无限）',{type:'number'})}{inputField('speed','播放速度',{type:'number'})}{inputField('fromCurrent','沿用当前进度',{type:'boolean'})}{inputField('wait','等待结束',{type:'boolean'})}<p className="muted">往返一次包含正放和倒放。沿用当前进度只作用于仍完整播放的同一动画；轨道被替换或动画已停止时从方向起点播放。无限循环等待至停止或替换。</p></>:<>{inputField('finish','到达方向终点',{type:'boolean'})}<p className="muted">正放落在末帧，倒放和往返落在首帧。</p></>}{onOpenUiAnimation&&project.ui.animations?.some(a=>a.id===selected.properties.animationId)&&<button className="small-button" onClick={()=>onOpenUiAnimation(String(selected.properties.animationId),selected.id)}>编辑控件动画</button>}</>;
      case 'animateUiProperty': case 'stopUiAnimation': return <>{inputField('componentId','界面组件',{type:'component'})}<BlueprintNodeFields surface="inspector" project={project} graph={graph} node={selected} edit={edit=>editSelected('修改控件动画',edit)}/>{selected.type==='animateUiProperty'?<>{inputField('value','目标值',{type:'number'})}{inputField('duration','持续秒数',{type:'number'})}{inputField('wait','等待结束',{type:'boolean'})}</>:inputField('finish','到达目标值',{type:'boolean'})}</>;
      case 'resetUiComponent': return inputField('componentId', '界面组件', { type: 'component' });
      case 'playUiVideo': return <>{inputField('componentId', '视频组件', { type: 'component', componentKind: 'video' })}{inputField('restart', '重新开始', { type: 'boolean' })}</>;
      case 'pauseUiVideo': return <>{inputField('componentId', '视频组件', { type: 'component', componentKind: 'video' })}{inputField('paused', '暂停', { type: 'boolean' })}</>;
      case 'stopUiVideo': return inputField('componentId', '视频组件', { type: 'component', componentKind: 'video' });
      case 'playSpine': return <>{inputField('componentId', '骨骼组件', { type: 'component', componentKind: 'spine' })}
        {selectedSpine && !graph.links.some(link => link.toNodeId === selected.id && ['componentId', 'animation'].includes(link.toPinId)) ? resourceField('动画', 'animation', selectedSpine.animations.map(animation => ({ id: animation.name, name: `${animation.name} · ${animation.duration.toFixed(2)} 秒` }))) : inputField('animation', '动画名称', { type: 'string' })}
        {inputField('loop', '循环播放', { type: 'boolean', fallback: true })}{inputField('restart', '重新开始', { type: 'boolean', fallback: true })}</>;
      case 'pauseSpine': return <>{inputField('componentId', '骨骼组件', { type: 'component', componentKind: 'spine' })}{inputField('paused', '暂停', { type: 'boolean', fallback: true })}</>;
      case 'setSpineSpeed': return <>{inputField('componentId', '骨骼组件', { type: 'component', componentKind: 'spine' })}{inputField('speed', '播放速度', { type: 'number', fallback: 1 })}</>;
      case 'stopMusic': return <><Field label="停止通道"><select aria-label="停止通道" value={String(selected.properties.channel ?? 'music')} onChange={event => setProperty('channel', event.target.value)}><option value="music">背景音乐</option><option value="sound">音效</option><option value="ambient">环境音</option></select></Field>{inputField('fade', '淡出秒数', { type: 'number', fallback: 0.3 })}</>;
      case 'delay': return inputField('seconds', '等待秒数', { type: 'number', fallback: 1 });
      case 'uiAction': return inputField('screen', '游戏界面', { type: 'ui', fallback: 'pause_menu' });
      case 'effect': return <>{resourceField('演出效果', 'effectId', project.effects)}{!project.effects.length && <p className="blueprint-note">在舞台编辑器中把一组演出保存为效果后，就能在这里复用。</p>}</>;
      case 'getVariable': case 'setVariable': return <><BlueprintStateFields project={project} graph={graph} node={selected} edit={edit => editSelected('修改状态引用', edit)} />{blueprintStateScope(project, selected) === 'page' && (graph.links.some(link => link.toNodeId === selected.id && link.toPinId === 'pageId') ? inputField('pageId') : <Field label="页面"><BlueprintInlineValue project={project} graph={graph} node={selected} pin={selected.pins.find(pin => pin.id === 'pageId')!} edit={edit => editSelected('修改状态页面', edit)} /></Field>)}{selected.type === 'setVariable' && inputField('value', '新的状态值', { type: selectedVariable?.type ?? 'any', fallback: selectedVariable?.initial })}</>;
      case 'getInput': return <>{resourceField('输入参数', 'inputId', graph.exposedInputs)}{!graph.exposedInputs.length && <button className="text-button" onClick={() => setInspectorTab('interface')}>添加这个蓝图的输入参数</button>}</>;
      case 'setOutput': return <>{resourceField('输出结果', 'outputId', graph.exposedOutputs)}{inputField('value', '输出的值', { type: graph.exposedOutputs.find(pin => pin.id === selected.properties.outputId)?.dataType ?? 'any' })}{!graph.exposedOutputs.length && <button className="text-button" onClick={() => setInspectorTab('interface')}>添加这个蓝图的输出结果</button>}</>;
      case 'callFunction': case 'callMacro': return <>{resourceField(isTimelineComponent(selectedCall) ? '时间轴预设' : '调用蓝图', 'graphId', graphs.filter(item => item.id !== graph.id && (selected.type !== 'callMacro' || item.kind === 'macro') && isTimelineComponent(item) === isTimelineComponent(selectedCall)), node => { node.pins = callablePins(graphs.find(item => item.id === node.properties.graphId)); })}
        {selectedCall && <button className="text-button" onClick={() => chooseGraph(selectedCall.id, true)}>{isTimelineComponent(selectedCall) ? '编辑时间轴' : `编辑“${selectedCall.name}”`}</button>}
        {selectedCall && graphShowsActors(project, selectedCall.id) && <ActorTransitionFields label="本次角色过渡" sources={{ label: '蓝图内角色与节点设置', unresolved: true }} value={parseActorTransitions(selected.properties.actorTransitions)} onChange={value => setProperty('actorTransitions', value ? JSON.stringify(value) : '')} />}
        {selectedCall?.description && <p className="blueprint-note">{selectedCall.description}</p>}{selectedCall?.exposedInputs.map((pin, index) => inputField(`arg_${pin.id}`, `${pin.name}${pin.required ? '（必填）' : ''}`, { type: pin.dataType, fallback: selected.properties[`arg_${index}`] ?? pin.defaultValue, hint: pin.description }))}
        {selectedCall && selectedCall.exposedInputs.length === 0 && <p className="blueprint-note">这个流程不需要输入参数，接上执行线即可使用。</p>}
      </>;
      case 'literal': return <BlueprintNodeFields surface="inspector" project={project} graph={graph} node={selected} edit={edit => editSelected(selectedAssetReference ? '选择素材引用' : '修改固定值', edit)} />;
      case 'math': case 'compare': return <><BlueprintNodeFields surface="inspector" project={project} graph={graph} node={selected} edit={edit => editSelected('修改计算节点', edit)} />{inputField('a', selected.type === 'math' ? '第一个数' : '第一个值')}{inputField('b', selected.type === 'math' ? '第二个数' : '第二个值')}</>;
      case 'switchValue': case 'selectByKey':
      case 'clamp': case 'abs': case 'round': case 'inRange': case 'nearlyEqual': case 'mapRange': case 'lerp': return <><BlueprintNodeFields surface="inspector" project={project} graph={graph} node={selected} edit={edit => editSelected('修改数值运算', edit)} />{selected.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => inputField(pin.id))}</>;
      case 'not': case 'and': case 'or': case 'xor': return <>{selected.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => inputField(pin.id))}</>;

      case 'select': return <>{inputField('condition', '是否满足条件', { type: 'boolean', fallback: false })}{inputField('true_value', '满足时的值')}{inputField('false_value', '不满足时的值')}</>;
      case 'branch': return inputField('condition', '是否满足条件', { type: 'boolean', fallback: true, hint: '可以直接选择是或否，也可以接入“比较”或“读取状态”的结果。' });
      case 'forLoop': return <>{inputField('first_index', '起始数', { type: 'number', fallback: 0 })}{inputField('last_index', '结束数', { type: 'number', fallback: 3 })}<p className="blueprint-note">例如从 1 到 3 会执行三次。“当前计数”可以传给计算节点。</p></>;
      case 'sceneAction': return <Field label="中文演出指令" hint="使用文本编辑器中的中文指令，例如 @等待：1。"><input value={String(selected.properties.command ?? '')} placeholder="@等待：1" onChange={event => setProperty('command', event.target.value)} /></Field>;
      case 'comment': return <Field label="说明内容"><textarea rows={7} value={String(selected.properties.text ?? '')} onChange={event => setProperty('text', event.target.value)} placeholder="写下这段流程的用途，方便以后阅读。" /></Field>;
      default: return selected.pins.some(pin => pin.direction === 'input' && pin.dataType !== 'exec') ? <>{selected.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => inputField(pin.id))}</> : <p className="blueprint-note">这个节点无需额外参数，连接执行线即可。</p>;
    }
  };
  const applyInterface = (graphId: string, change: BlueprintInterfaceChange, confirmationKey?: string): string | undefined => {
    let failure: string | undefined, count = 0;
    const applied = commit('修改蓝图接口', draft => {
      try { count = applyBlueprintInterfaceChange(draft, graphId, change, confirmationKey).callCount; }
      catch (error) { failure = error instanceof Error ? error.message : String(error); throw error; }
    }, { separate: true });
    // A timeline overlap is rejected after the edit itself succeeded; report that reason.
    if (!applied) return failure ?? commitFailure.current ?? '接口修改未应用，请检查当前图或演出边界。';
    setInterfaceChange(undefined); setMessage('接口已更新，' + count + ' 处调用或绑定同步使用；可一次撤销。');
  };
  const requestInterface = (change: BlueprintInterfaceChange) => {
    if (!graph) return false;
    try {
      const plan = inspectBlueprintInterfaceChange(project, graph.id, change);
      if (plan.requiresConfirmation) setInterfaceChange({ graphId: graph.id, change });
      else { const error = applyInterface(graph.id, change); if (error) { setMessage(error); return false; } }
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return false; }
  };
  const locateUsage = (usage: BlueprintUsage) => {
    const target = usage.location;
    if (target.kind !== 'blueprint') { onLocateUsage?.(usage); return; }
    if (!graph) return;
    if (target.graphId === graph.id) { selectNode(target.nodeId); setInspectorTab('node'); void frameNode(target.nodeId); return; }
    onOpenGraph?.(target.graphId, target.nodeId, canvasLocation(graph, getFlowNodes().filter(node => node.selected).map(node => node.id), [...selectedEdgeIds], flow.getViewport(), { open: propertiesOpen, tab: inspectorTab }, selectedId));
  };
  const interfaceSection = (direction: BlueprintPin['direction']) => graph && <BlueprintInterfaceMembers key={`${graph.id}/${direction}`} project={project} graph={graph} direction={direction} label={uiWorkspace ? direction === 'input' ? '调用输入' : '调用输出' : undefined} onChange={requestInterface} canAddNode={graph.nodes.length < 512} add={(type, properties) => addNode(type, undefined, undefined, properties)} />;
  const query = search.trim().toLocaleLowerCase();
  const pickerChecks = new Map<string, { compatible: boolean; problem?: string; incomplete?: boolean }>();
  const pickerCheck = (type: BlueprintNodeType, called?: BlueprintGraph) => {
    const key = type + ':' + (called?.id ?? '');
    const cached = pickerChecks.get(key); if (cached) return cached;
    if (!graph) return { compatible: false };
    const insertion = prepareBlueprintInsertion(project, graph, prepareNode(type, called), contextMenu?.wire);
    const capability = environment && !insertion.problem ? blueprintCapabilityCheck(project, insertion.node, environment, insertion.graph) : undefined;
    const result = { compatible: !insertion.problem, problem: capability?.problem, incomplete: capability?.incomplete };
    pickerChecks.set(key, result); return result;
  };
  const compatibleNode = (type: BlueprintNodeType, called?: BlueprintGraph) => pickerCheck(type, called).compatible;
  const legacyAuthoring = graph?.kind === 'minigame' || project.minigames.some(game => game.blueprintId === graph?.id || !!uiWorkspace && game.uiPageId === uiWorkspace.pageId);
  const authoringNodeAllowed = (type: string) => !['getMinigameValue', 'setMinigameValue', 'finishMinigame'].includes(type) || legacyAuthoring;
  const uiNodeAllowed = (type: string, called?: BlueprintGraph) => authoringNodeAllowed(type) && (!environment || !uiContextOnly || !pickerCheck(type as BlueprintNodeType, called).problem);
  const pickerHint = (type: BlueprintNodeType, hint: string, called?: BlueprintGraph) => {
    const check = pickerCheck(type, called);
    return hint + (check.problem ? ' ' + check.problem : check.incomplete ? ' 含动态参数，运行要求需在实际调用时验证。' : '');
  };
  const pickerItems: NodePickerItem[] = contextMenu ? [
    { id: 'new_timeline_component', name: '时间轴', category: '常用演出', hint: '安排素材、角色、镜头和声音；需要复用的素材可设为输入参数。', choose: addTimeline, disabled: !graph || !!contextMenu.wire },
    ...blueprintCategories.flatMap(category => Object.entries(blueprintCatalog).filter(([type, info]) => !['showChapter', 'savedAction'].includes(type) && info.category === category && uiNodeAllowed(type) && compatibleNode(type as BlueprintNodeType)).map(([type, info]) => ({ id: type, ...info, hint: pickerHint(type as BlueprintNodeType, info.hint), disabled: !graph || graph.nodes.length >= 512 || (type === 'event' && graph.nodes.some(node => node.type === 'event')), choose: () => addNode(type as BlueprintNodeType, undefined, contextMenu?.position, undefined, contextMenu?.wire) }))),
    ...graphs.filter(item => !isTimelineComponent(item) && item.id !== graph?.id && uiNodeAllowed(item.kind === 'macro' ? 'callMacro' : 'callFunction', item) && compatibleNode(item.kind === 'macro' ? 'callMacro' : 'callFunction', item)).map(item => ({ id: item.id, name: item.name, hint: pickerHint(item.kind === 'macro' ? 'callMacro' : 'callFunction', '调用这张蓝图，并读取输出结果', item), category: blueprintGroup(project, item.id) || '我的蓝图', choose: () => addNode(item.kind === 'macro' ? 'callMacro' : 'callFunction', item, contextMenu?.position, undefined, contextMenu?.wire) })),
  ] : [];
  const pinReconnect = useBlueprintPinReconnect({
    scopeKey: graph?.id, canvas, edges, notify: setMessage,
    disconnect: removed => {
      const ids = new Set(removed.map(edge => edge.id));
      if (editGraph('断开蓝图连线', target => { target.links = target.links.filter(link => !ids.has(link.id)); })) {
        setSelectedEdgeIds(new Set([...selectedEdgeIds].filter(id => !ids.has(id))));
        setMessage(`已断开 ${ids.size} 条连线，可撤销。`);
      }
    },
    reconnect: (oldEdge, connection) => {
      let problem: string | undefined;
      const accepted = editGraph('改接蓝图连线', target => { problem = applyBlueprintWireConnection(target, connection, oldEdge.id); });
      if (accepted) setMessage(problem ?? '连线已改接，可撤销。');
    },
  });
  const connectionChecks = useMemo(() => new Map<string, string | undefined>(), [graph]);
  const canvasHandlers = useStableCallbacks({
    onSelectionEnd: () => { setContextMenu(undefined); if (getFlowNodes().some(node => node.selected)) setInspectorTab('node'); revealCanvasSelection(); },
    onNodeClick: (event, node) => {
      if (graph) nodeClickOrigin.current = rememberBlueprintNodeClick(nodeClickOrigin.current, graph.id, node.id, event.detail, { open: propertiesOpen, tab: inspectorTab });
      setContextMenu(undefined); setInspectorTab('node'); setPropertiesOpen(true); revealCanvasSelection(node.id);
    },
    onNodeDragStart: (_, node) => { revealCanvasSelection(node.id); },
    onPaneClick: () => { selectNode(); setContextMenu(undefined); },
    onPaneContextMenu: event => { event.preventDefault(); selectNode(); openNodePicker({ x: event.clientX, y: event.clientY }); },
    onEdgeClick: inspectEdge,
    onEdgeContextMenu: (event, edge) => { event.preventDefault(); selectEdge(edge.id); },
    onNodeDoubleClick: (_, node) => { const actual=graph?.nodes.find(n=>n.id===node.id); if (actual && isBlueprintModuleReference(actual.type) && !isTimelineComponent(graphs.find(g => g.id === actual.properties.graphId)) && onOpenGraph) { const beforeClick = nodeClickOrigin.current; openModule(String(actual.properties.graphId), actual.id, beforeClick && beforeClick.graphId === graph?.id && beforeClick.nodeId === actual.id ? beforeClick.inspector : undefined); return; }if(actual&&['playUiAnimation','stopUiAnimationPlayback'].includes(actual.type)&&project.ui.animations?.some(a=>a.id===actual.properties.animationId)&&onOpenUiAnimation){onOpenUiAnimation(String(actual.properties.animationId),node.id);return;} const timeline = timelineForNode(project, graph?.nodes.find(item => item.id === node.id)); if (timeline && graph && onOpenTimeline) { onOpenTimeline(timeline.id, graph.id, node.id); return; } void flow.setCenter(node.position.x + 125, node.position.y + 90, { zoom: 1, duration: 160 }); },
    onNodeDragStop: (_, node, moved) => editGraph('移动蓝图节点', target => {
      const positions = new Map((moved.length ? moved : [node]).map(item => [item.id, item.position]));
      for (const item of target.nodes) { const position = positions.get(item.id); if (position) { item.x = position.x; item.y = position.y; } }
    }),
    onConnectStart: pinReconnect.onConnectStart,
    onConnect: connection => { if (!pinReconnect.acceptsConnection() || !connection.sourceHandle || !connection.targetHandle) return; let problem: string | undefined; const accepted = editGraph('连接蓝图节点', target => { problem = applyBlueprintWireConnection(target, connection); }); if (accepted) setMessage(problem ?? '连线已保存。' + blueprintWireShortcuts); },
    onConnectEnd: (event, state) => {
      if (pinReconnect.onConnectEnd(event, state)) return;
      if (state.isValid || state.toNode || !state.fromHandle?.id) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      if (!point || !canvas.current) return;
      const bounds = canvas.current.getBoundingClientRect();
      if (point.clientX < bounds.left || point.clientX > bounds.right || point.clientY < bounds.top || point.clientY > bounds.bottom) return;
      const at = { x: point.clientX, y: point.clientY };
      setContextMenu({ ...at, position: flow.screenToFlowPosition(at), wire: { nodeId: state.fromHandle.nodeId, pinId: state.fromHandle.id, direction: state.fromHandle.type === 'source' ? 'output' : 'input' } });
    },
    onReconnect: pinReconnect.onReconnect,
    onReconnectStart: pinReconnect.onReconnectStart,
    onReconnectEnd: pinReconnect.onReconnectEnd,
    isValidConnection: connection => {
      if (!graph || !pinReconnect.acceptsConnection()) return false;
      const key = JSON.stringify([pinReconnect.currentEdge.current?.id, connection.source, connection.sourceHandle, connection.target, connection.targetHandle]);
      if (!connectionChecks.has(key)) connectionChecks.set(key, applyBlueprintWireConnection({ ...graph, links: [...graph.links] }, { ...connection, sourceHandle: connection.sourceHandle ?? null, targetHandle: connection.targetHandle ?? null }, pinReconnect.currentEdge.current?.id));
      return !connectionChecks.get(key);
    },
    onDelete: ({ nodes, edges }) => editGraph('删除蓝图所选内容', target => { const ids = new Set(nodes.map(node => node.id)), links = new Set(edges.map(edge => edge.id)); target.nodes = target.nodes.filter(node => !ids.has(node.id)); target.links = target.links.filter(link => !links.has(link.id) && !ids.has(link.fromNodeId) && !ids.has(link.toNodeId)); }),
  } satisfies Pick<ReactFlowProps<FlowNode, StudioEdge>, 'onSelectionEnd' | 'onNodeClick' | 'onNodeDragStart' | 'onPaneClick' | 'onPaneContextMenu' | 'onEdgeClick' | 'onEdgeContextMenu' | 'onNodeDoubleClick' | 'onNodeDragStop' | 'onConnectStart' | 'onConnect' | 'onConnectEnd' | 'onReconnect' | 'onReconnectStart' | 'onReconnectEnd' | 'isValidConnection' | 'onDelete'>);
  const moduleLibrary = graph && <BlueprintModuleLibrary session={uiWorkspace?.moduleLibrary} graphs={graphs} graphId={graph.id} environmentOnly={!!environment && uiContextOnly} atLimit={graph.nodes.length >= 512}
    check={called => {
      const insertion = prepareBlueprintInsertion(project, graph, prepareNode(called.kind === 'macro' ? 'callMacro' : 'callFunction', called));
      return insertion.problem ? { problem: insertion.problem } : environment ? blueprintCapabilityCheck(project, insertion.node, environment, insertion.graph) : {};
    }} insert={called => addNode(called.kind === 'macro' ? 'callMacro' : 'callFunction', called)} open={onOpenGraph ? called => openModule(called.id) : undefined} create={!uiWorkspace && !fixedGraph ? () => createGraph('macro') : undefined} />;
  const graphDetails = graph && (uiWorkspace || inspectorTab === 'interface') && <>
            {interfaceSection('input')}{interfaceSection('output')}
            <details key={graph.id} className="blueprint-graph-settings"><summary>{uiWorkspace ? '图设置' : '模块设置'}<span title={graph.name}>{graph.name}</span></summary>
              <BlueprintNameField project={project} graph={graph} mode="name" commit={commit} message={setMessage} />
              <BlueprintNameField project={project} graph={graph} mode="callName" commit={commit} message={setMessage} />
              <GraphGroupField project={project} graph={graph} commit={commit} message={setMessage} />
              <Field label="模块说明"><textarea aria-label="模块说明" maxLength={4000} value={graph.description ?? ''} onChange={event => editGraph('修改模块说明', target => { target.description = event.target.value || undefined; })} placeholder="说明用途、输入输出约定和使用例子。" /></Field>
              <Field label="蓝图用途"><select value={graph.kind} onChange={event => editGraph('蓝图用途', target => { target.kind = event.target.value as BlueprintGraph['kind']; })}>{Object.entries(blueprintKindNames).filter(([kind]) => kind !== 'minigame' || graph.kind === 'minigame').map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select></Field>
              <p className="blueprint-note">主调用入口（默认参数）运行要求：{capabilitySummary?.required.map(c => blueprintCapabilityNames[c]).join('、') || '通用计算与操作'}</p>
              {capabilitySummary?.incomplete && <p className="blueprint-note">含动态参数或超出静态分析范围的路径，运行要求尚需实际调用验证。</p>}
              {graph.uiPageId && <p className="blueprint-note">页面和控件事件按实际触发入口分别检查；不把未执行节点当成调用要求。</p>}
              <p className="blueprint-note">选择“用户节点”后，这张蓝图会出现在其他蓝图的节点库里。</p>
            </details>
            <BlueprintUsageList project={project} graphId={graph.id} onLocate={locateUsage} canLocate={usage => usage.location.kind === 'blueprint' ? !!onOpenGraph || usage.location.graphId === graph.id : !!onLocateUsage && ['story', 'ui', 'gameFlow', 'character'].includes(usage.location.kind)} />
          </>;
  const nodeDetailKind = selected ? selectedAssetReference?.kindName ?? (isTimelineComponent(selectedCall) ? '时间轴预设' : blueprintCatalog[selected.type].name) : undefined;
  const nodeDetails = graph && selected && (uiWorkspace || inspectorTab === 'node') && <>
    <div className="blueprint-section-heading">
      {!uiWorkspace && <h3>{nodeDetailKind}</h3>}
      <div>
        <IconButton title="复制选中节点" disabled={selected.type === 'event' || graph.nodes.length >= 512} onClick={duplicateSelected}><Copy size={14} /></IconButton>
        <IconButton title="删除选中节点" onClick={deleteSelected}><Trash2 size={14} /></IconButton>
      </div>
    </div>
    <p className="blueprint-note">{selectedAssetReference ? '将右侧素材端口连接到界面属性、背景或其他需要该素材的输入。显示和播放时机由接收素材的节点控制。' : isTimelineComponent(selectedCall) ? '接上执行线即可播放。素材参数可以接入蓝图变量；未传入时沿用时间轴内的默认素材。' : blueprintCatalog[selected.type].hint}</p>
    <Field label="节点名称"><input maxLength={120} value={selected.name} onChange={event => { if (event.target.value.trim()) editSelected('节点名称', node => { node.name = event.target.value; }); }} /></Field>
    {renderProperties()}
    <EntranceOffsetsEditor node={selected} edit={change => editSelected('编辑入场偏移', change)} />
    {selectedIssues.length > 0 && <div className="blueprint-node-problems" role="status"><strong>还需要完成</strong>{selectedIssues.map((issue, index) => <p key={index}>{issue.message.replace(/^“.*?”：/, '')}</p>)}</div>}
  </>;
  const propertiesPanel = graph && (uiWorkspace ? <>
    <UiEventDetail id={`graph:${graph.id}`} title={graph.name} kind="事件图">
      <div className="blueprint-properties ui-event-graph-properties">{graphDetails}</div>
    </UiEventDetail>
    {selected && <UiEventDetail id={`node:${graph.id}:${selected.id}`} title={selected.name} kind={nodeDetailKind}>
      <div className="blueprint-properties ui-event-node-properties">{nodeDetails}</div>
    </UiEventDetail>}
  </> : <aside className="blueprint-properties" aria-label="蓝图属性"><div {...panelLayout.handle('properties')} className="blueprint-property-tabs"><button className={inspectorTab === 'node' ? 'active' : ''} onClick={() => setInspectorTab('node')}>节点参数</button><button className={inspectorTab === 'interface' ? 'active' : ''} onClick={() => setInspectorTab('interface')}><Settings2 size={13} />输入与输出</button><button className={inspectorTab === 'state' ? 'active' : ''} onClick={() => setInspectorTab('state')}>变量</button></div><div className="blueprint-properties-scroll">
          {inspectorTab === 'state' ? <BlueprintVariables key={graph.id} project={project} graph={graph} pageId={graph.uiPageId} commit={commit} canAddNode={graph.nodes.length < 512} add={(type, properties) => addNode(type, undefined, undefined, properties)} onNotice={setMessage} />
          : inspectorTab === 'interface' ? graphDetails
            : selected ? nodeDetails
              : <div className="blueprint-selection-empty"><GitBranch size={26} /><h3>选择节点</h3><p>点击节点编辑参数；右键空白处添加节点。</p>{selectedEdgeIds.size > 0 && <p className="blueprint-note" role="status">已选中 {selectedEdgeIds.size} 条连线：按 Delete 断开，拖动端点可改接。</p>}<button className="text-button" onClick={() => setInspectorTab('interface')}>设置蓝图名称与参数接口</button><div className="blueprint-node-outline"><strong>本图节点 · {graph.nodes.length}</strong>{graph.nodes.map(node => <button key={node.id} onClick={() => { selectNode(node.id); void flow.setCenter(node.x + 120, node.y + 70, { zoom: 0.9, duration: 180 }); }}>{node.name}</button>)}</div></div>}
        </div></aside>);
  const renderPanels = (palette: ReactNode, canvasContent: ReactNode, properties: ReactNode) => {
    if (uiWorkspace) return <>
      {properties}
      <UiEventWorkspace
        directory={uiWorkspace.library((type, properties) => addNode(type, undefined, undefined, properties), moduleLibrary)}
        canvas={canvasContent}
        details={<UiEventDetailHost />}
        directoryScroll={uiWorkspace.session?.directoryScroll}
        detailScrollKey={uiSidebar?.active}
        detailScroll={uiWorkspace.session?.detailScroll}
      />
    </>;
    const panels = [
      ...(paletteOpen ? [<Fragment key="palette">{palette}</Fragment>, panelLayout.divider('palette')] : []),
      <Fragment key="canvas">{canvasContent}</Fragment>,
      ...(propertiesOpen ? [panelLayout.divider('properties'), <Fragment key="properties">{properties}</Fragment>] : []),
    ];
    return <div data-panels-reversed={panelLayout.reversed} ref={panelLayout.root} style={panelLayout.style} className={`blueprint-editor-body ${paletteOpen ? '' : 'palette-hidden'} ${propertiesOpen ? '' : 'properties-hidden'}`}>{panelLayout.reversed ? panels.reverse() : panels}</div>;
  };
  const toolbarContext = graph ? blueprintContext(project, graph) : undefined;
  return <div className="blueprint-workspace generic-blueprint-workspace">
    <div className="workspace-toolbar blueprint-toolbar blueprint-commandbar" aria-label="蓝图工具栏">
      {onBack && <IconButton title="切换到时间轴" onClick={onBack}><ArrowLeft size={16} /></IconButton>}
      {uiWorkspace ? <><Workflow className="blueprint-graph-icon" size={16} aria-hidden="true" />{uiWorkspace.toolbar}</> : !hideGraphPicker && <strong className="blueprint-title"><Workflow size={16} />节点编程</strong>}
      {!uiWorkspace && !fixedGraph && !hideGraphPicker && <><select className="blueprint-graph-picker" aria-label="选择通用蓝图" title={graph?.name} value={graph?.id ?? ''} onChange={event => chooseGraph(event.target.value)}>{!graphs.length && <option value="">还没有蓝图</option>}{graphs.filter(item => !isTimelineComponent(item) || item.id === graph?.id).map(item => <option key={item.id} value={item.id}>{item.name} · {blueprintKindNames[item.kind]}</option>)}</select><IconButton title="新建蓝图" onClick={() => createGraph('function')}><Plus size={16} /></IconButton></>}
      {graph && <div className="blueprint-command-group blueprint-create-commands">
        {!uiWorkspace && <IconButton title={paletteOpen ? '收起节点库' : '展开节点库'} aria-expanded={paletteOpen} onClick={() => setPaletteOpen(!paletteOpen)}>{panelLayout.reversed ? paletteOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} /> : paletteOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</IconButton>}
        <button type="button" className="small-button blueprint-add-node" aria-label="添加节点" title="添加节点（空格或画布右键）" onClick={() => openNodePicker()}><Plus size={15} aria-hidden="true" /><span>添加节点</span><kbd>空格</kbd></button>
        <IconButton title="添加时间轴" disabled={isTimelineComponent(graph)} onClick={addTimeline}><Clapperboard size={16} /></IconButton>
        <IconButton title="封装所选节点" disabled={!selectedNodeIds.length && !selected} onClick={beginEncapsulation}><LibraryBig size={16} /></IconButton>
      </div>}
      <div className="spacer" />
      <div className="blueprint-command-group blueprint-view-commands">
        <IconButton title={allParametersCollapsed ? '展开全部节点参数' : '收起全部节点参数'} aria-expanded={!allParametersCollapsed} disabled={!graph} onClick={() => setCollapsed(previous => { const next = new Set(previous); for (const node of graph?.nodes ?? []) allParametersCollapsed ? next.delete(node.id) : next.add(node.id); return next; })}><ListCollapse size={16} /></IconButton>
        <IconButton title="自动排列蓝图" disabled={arranging || !graph} onClick={() => { void editorCommand('arrangeBlueprint'); }}><LayoutGrid size={16} /></IconButton>
        <IconButton title="定位选中节点" disabled={!selected} onClick={() => { if (selected) { revealNodeDetails(selected.id); void frameNode(selected.id); } }}><Crosshair size={16} /></IconButton>
        <IconButton title="框选全部节点" disabled={!graph} onClick={() => { void flow.fitView({ padding: 0.22, maxZoom: 1, duration: 180 }); }}><ZoomIn size={16} /></IconButton>
        {!uiWorkspace && <IconButton title={propertiesOpen ? '收起蓝图属性' : '展开蓝图属性'} aria-expanded={propertiesOpen} onClick={() => setPropertiesOpen(!propertiesOpen)}>{panelLayout.reversed ? propertiesOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} /> : propertiesOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</IconButton>}
        <BlueprintToolbarMenu key={graph?.id ?? 'empty'} warning={toolbarContext?.problem}>
          {graph && <section className="blueprint-menu-context"><strong>{graph.name}</strong><p className="blueprint-context-label">{toolbarContext?.label}</p>{toolbarContext?.problem && <p className="blueprint-context-warning" role="status">{toolbarContext.problem}</p>}</section>}
          {graph && <section className="blueprint-menu-settings">
            <label className="blueprint-check"><input type="checkbox" checked={autoConnect} onChange={event => setAutoConnect(event.target.checked)} />自动接线</label>
            {uiWorkspace && <label className="blueprint-check" title="隐藏已知不兼容的节点；动态参数会单独提示，仍需实际运行验证。"><input type="checkbox" checked={uiContextOnly} onChange={event => setUiContextOnly(event.target.checked)} />仅当前环境可用</label>}
          </section>}
          {!uiWorkspace && !fixedGraph && <section className="blueprint-menu-resources"><button type="button" className="text-button" onClick={() => createGraph('macro')}><LibraryBig size={14} />新建用户节点</button><label><span>添加蓝图示例</span><select className="blueprint-example-select" aria-label="添加蓝图示例" value="" onChange={event => addExample(event.target.value)}><option value="">选择示例…</option><option value="interaction">交互 · 限时点亮</option><option value="motion">演出 · 镜头与震动同播</option></select></label></section>}
          <p className="blueprint-menu-hint">{uiWorkspace ? '从“我的界面”拖入控件，选择读取或设置；白线控制执行顺序。' : '画布右键或空格搜索节点；拖入资源直接使用。'}</p>
        </BlueprintToolbarMenu>
        <IconButton title="蓝图入门" aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}><CircleHelp size={17} /></IconButton>
      </div>
    </div>
    {interfaceChange && <BlueprintInterfaceChangeDialog project={project} graphId={interfaceChange.graphId} change={interfaceChange.change} onClose={() => setInterfaceChange(undefined)} onApply={key => applyInterface(interfaceChange.graphId, interfaceChange.change, key)} />}
    {encapsulation && <BlueprintEncapsulationDialog project={project} graphId={encapsulation.graphId} nodeIds={encapsulation.nodeIds} onClose={() => setEncapsulation(undefined)} onCreate={createEncapsulation} />}
    {helpOpen && <div className="blueprint-help"><strong>从一条执行线开始</strong><ol><li>在画布空白处右键或按空格搜索节点，也可以展开节点库。</li><li>{blueprintWireShortcuts}端点接着多条线时，先选中要改接的那一条；点击连线后也可按 Delete 断开。点击事件列表或“定位选中节点”查看节点；详情中的参数来源可点击定位。</li><li>从资源管理器拖入图片、音频、视频、字体或 Spine，得到素材引用，再将素材端口连到需要它的属性。也可以拖入角色、状态或其他蓝图。{uiWorkspace?'在“我的界面”添加控件点击事件，连接设置属性等节点；保存界面后在游戏中生效。':'在对白演出、场景事件或界面按钮中调用这张蓝图。'}</li></ol>{!uiWorkspace&&!fixedGraph&&<button className="text-button" onClick={() => createGraph('function', true)}>创建已连线的入门示例</button>}</div>}
    {!graph ? <div className="blueprint-welcome"><Workflow size={40} /><h2>用节点搭出你的演出和逻辑</h2><p>添加中文节点、选择参数、连接流程，就能制作角色入场、音乐播放和条件判断。</p><div><button className="primary-button" onClick={() => createGraph('function', true)}>从入门示例开始</button><button className="small-button" onClick={() => createGraph('function')}>创建空白蓝图</button></div><small>已有的剧情流程、对白和素材可以继续使用。</small></div> : <>
      {renderPanels(<aside className="blueprint-palette" aria-label="节点库"><div {...panelLayout.handle('palette')} className="blueprint-panel-heading"><LibraryBig size={15} /><strong>节点库</strong></div><div className="search"><Search size={13} /><input aria-label="搜索蓝图节点" placeholder="搜索节点或用途" value={search} onChange={event => setSearch(event.target.value)} /></div>
          <label className="blueprint-check"><input type="checkbox" checked={autoConnect} onChange={event => setAutoConnect(event.target.checked)} />添加时自动接线</label>
          {blueprintCategories.map(category => {
            const entries = Object.entries(blueprintCatalog).filter(([type, info]) => !['showChapter', 'savedAction'].includes(type) && authoringNodeAllowed(type) && info.category === category && completionScore(info.name, query, [type, info.hint, category, ...(info.keywords ?? [])]) > 0);
            return entries.length > 0 && <details key={`${category}:${!!query}`} open={!!query || category === '常用演出' || category === '流程控制'}><summary>{category}<span>{entries.length}</span></summary>{entries.map(([type, info]) => <button key={type} className="blueprint-library-node" title={info.hint} disabled={graph.nodes.length >= 512 || (type === 'event' && graph.nodes.some(node => node.type === 'event'))} onClick={() => addNode(type as BlueprintNodeType)}><Plus size={12} /><span>{info.name}</span></button>)}</details>;
          })}
          {moduleLibrary}
        </aside>, <div className="flow-container" ref={canvas} onKeyDown={event => {
          const target = event.target as HTMLElement;
          if (event.key === 'Enter' && !event.defaultPrevented && !event.nativeEvent.isComposing && target.closest('.react-flow__node') && !target.closest('input, textarea, select, button, [contenteditable="true"]')) revealCanvasSelection(target.closest('.react-flow__node')?.getAttribute('data-id') ?? undefined);
        }} onMouseDownCapture={pinReconnect.onMouseDownCapture} onClickCapture={pinReconnect.onClickCapture} data-member-drop={memberDragging || undefined} onDragOver={event => { if ([BLUEPRINT_MEMBER_MIME, 'application/vns-blueprint-state', 'application/vns-ui-animation', 'application/vns-ui-component', 'application/vns-asset', 'application/vns-character', 'application/vns-blueprint', 'application/vns-timeline', 'application/vns-variable', 'application/vns-scene'].some(type => event.dataTransfer.types.includes(type))) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; if (event.dataTransfer.types.includes(BLUEPRINT_MEMBER_MIME)) setMemberDragging(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setMemberDragging(false); }} onDrop={event => {
          setMemberDragging(false);
          event.preventDefault(); const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          const memberData = event.dataTransfer.getData(BLUEPRINT_MEMBER_MIME);
          if (memberData) {
            try { dropMember(parseBlueprintMemberReference(memberData), { x: event.clientX, y: event.clientY }, event); }
            catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
            return;
          }
          const stateData = event.dataTransfer.getData('application/vns-blueprint-state');
          if (stateData) {
            try {
              const state = JSON.parse(stateData);
              const reference = parseBlueprintMemberReference(JSON.stringify({ version: 1, projectId: project.id, kind: 'variable', id: state?.variableId, scope: state?.scope, graphId: state?.graphId, pageId: state?.pageId }));
              dropMember(reference, { x: event.clientX, y: event.clientY }, event);
            } catch (error) { setMessage(error instanceof Error ? error.message : '状态数据无效。'); }
            return;
          }
          const droppedAnimation=(uiWorkspace?uiPageAnimations(project,uiWorkspace.pageId):project.ui.animations)?.find(a=>a.id===event.dataTransfer.getData('application/vns-ui-animation'));
          const droppedComponent=uiWorkspace&&uiPageComponents(project,uiWorkspace.pageId).find(c=>c.id===event.dataTransfer.getData('application/vns-ui-component'));
          if(droppedAnimation){addNode('playUiAnimation',undefined,position,{animationId:droppedAnimation.id});return;}
          if(droppedComponent){setContextMenu(undefined);setMemberDrop(undefined);setComponentDrop({id:droppedComponent.id,x:event.clientX,y:event.clientY,position});return;}
          const asset = project.assets.find(item => item.id === event.dataTransfer.getData('application/vns-asset'));
          const called = graphs.find(item => item.id === (event.dataTransfer.getData('application/vns-blueprint') || event.dataTransfer.getData('application/vns-timeline')));
          const character = project.characters.find(item => item.id === event.dataTransfer.getData('application/vns-character'));
          const variable = project.variables.find(item => item.id === event.dataTransfer.getData('application/vns-variable'));
          const scene = project.scenes.find(item => item.id === event.dataTransfer.getData('application/vns-scene'));
          if (asset) {
            const reference = createBlueprintAssetNode(asset, position);
            if (reference) insertNode(reference, position);
            else setMessage('此素材不能用作蓝图素材引用。');
          } else if (called && called.id !== graph.id) addNode(called.kind === 'macro' ? 'callMacro' : 'callFunction', called, position);
          else if (character) addNode('showCharacter', undefined, position, { characterId: character.id, expressionId: effectiveCharacter(project, character.id)?.expressions[0]?.id ?? '' });
          else if (variable) dropMember({ version: 1, projectId: project.id, kind: 'variable', id: variable.id, scope: variable.persistent ? 'player' : 'project' }, { x: event.clientX, y: event.clientY }, event);
          else if (scene) addNode('switchScene', undefined, position, { sceneId: scene.id });
          else setMessage(called ? '不能在蓝图中调用自身。' : '图片、音频、视频、字体、Spine、角色、状态、场景和其他蓝图可以拖入画布。');
        }}><ReactFlow<FlowNode, StudioEdge> defaultNodes={initialNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={studioEdgeTypes} {...canvasHandlers}
          onMoveEnd={() => rememberViewRef.current()} onSelectionChange={onSelectionChange} onEdgesChange={onEdgesChange}
          fitView fitViewOptions={{ padding: .15, minZoom: .6, maxZoom: 1 }} minZoom={0.01} maxZoom={1.6} deleteKeyCode={null} panActivationKeyCode={null} reconnectRadius={18} connectionRadius={26} elevateEdgesOnSelect={false} panOnDrag={[1, 2]} selectionOnDrag selectionMode={SelectionMode.Partial} proOptions={{ hideAttribution: true }}
          ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': '放大画布', 'controls.zoomOut.ariaLabel': '缩小画布', 'controls.fitView.ariaLabel': '显示全部节点', 'minimap.ariaLabel': '蓝图缩略图' }}
        ><Background gap={24} size={1} color="#3b4552" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={node => node.selected ? '#dab279' : '#587081'} /></ReactFlow>{contextMenu && <NodePicker key={`${contextMenu.x}:${contextMenu.y}`} x={contextMenu.x} y={contextMenu.y} items={pickerItems} onClose={() => setContextMenu(undefined)} />}{componentDrop&&<NodePicker x={componentDrop.x} y={componentDrop.y} title="控件操作" onClose={()=>setComponentDrop(undefined)} items={[
          ...controlValueItems,
          {id:'read',name:'读取控件属性',category:'当前控件',hint:'读取显示状态、文字或位置，连接到判断和计算。',choose:()=>addNode('getUiProperty',undefined,componentDrop.position,{componentId:componentDrop.id})},
          {id:'write',name:'设置控件属性',category:'当前控件',hint:'接入执行线，修改这个控件的显示状态、文字或位置。',choose:()=>addNode('setUiProperty',undefined,componentDrop.position,{componentId:componentDrop.id})},
          {id:'animate',name:'控件属性动画',category:'当前控件',hint:'让这个控件移动、改变大小或淡入淡出。',choose:()=>addNode('animateUiProperty',undefined,componentDrop.position,{componentId:componentDrop.id})},
          {id:'stop',name:'停止控件动画',category:'当前控件',hint:'保留当前值，或立即完成这个控件的动画。',choose:()=>addNode('stopUiAnimation',undefined,componentDrop.position,{componentId:componentDrop.id})}
        ]}/>}{memberDrop && memberDrop.graphId === graph.id && <NodePicker x={memberDrop.x} y={memberDrop.y} title={memberDrop.access.name + ' · 选择操作'} ariaLabel="蓝图成员操作" description={blueprintMemberTypes[memberDrop.access.dataType].name + ' · Ctrl 拖动读取，Alt 拖动设置'} onClose={() => setMemberDrop(undefined)} items={memberDrop.access.actions.map(action => ({ id: action.action + '-member', name: action.label, category: memberDrop.reference.kind === 'variable' ? '变量' : '页面结果', hint: action.hint, choose: () => addMember(memberDrop.reference, action.action, memberDrop.position, memberDrop.graphId) }))} />}{memberDragging && <div className="blueprint-member-drop-hint" aria-live="polite">松开鼠标，在这里使用成员<span>读取值连接彩色数据线；设置值还需要白色执行线</span></div>}<div className="blueprint-canvas-legend"><i className="exec" />执行<i className="data" />数据<span>左键框选节点与连线（碰到即选） · Ctrl 多选 · 中键平移 · Delete 删除</span></div></div>, propertiesPanel)}<div className="blueprint-status" role="status"><span>{message || `${graph.nodes.length} 个节点 · ${graph.links.length} 条连线`}</span><button onClick={() => setHelpOpen(!helpOpen)}>入门帮助</button></div>
    </>}
  </div>;
}
