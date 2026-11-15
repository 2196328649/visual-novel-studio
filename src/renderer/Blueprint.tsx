import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, MarkerType, SelectionMode, useNodesInitialized, useReactFlow, type Connection, type OnSelectionChangeParams, type Viewport } from '@xyflow/react';
import { ArrowLeft, ChevronRight, FolderPlus, GitBranch, LayoutGrid, Search, Workflow, LocateFixed, PanelRightClose, PanelRightOpen, ExternalLink, FolderOpen, Ungroup, Pencil, Plus, X } from 'lucide-react';
import { connectNode, newNode, makeId, targets, type Diagnostic, type NodeKind, type Project } from '../core/model';
import { addGameFlowStep, createGameFlowStep, connectGameFlowNodes, flowEntry, flowNodeIds, flowSourcePhase, flowStepNodeId, gameFlow, removeGameFlowStep, gameFlowConnectionProblem } from '../core/game-flow-graph';
import type { GameFlowStep } from '../core/game-flow-schema';
import { addNodeToStoryGroup, createStoryGroup, storyGroupIndex, storyGroupNodeId, ungroupStoryGroup } from '../core/story-groups';
import { projectStoryGraph, storyNodeLocation, storyNodeScope, storyScopeBreadcrumbs, storyScopeKey, validStoryScope, type StoryGraphScope, type StoryGraphWire } from '../core/story-graph';
import { nodeNames, removeNodes, type Commit } from './editor';
import { layoutBlueprint } from './blueprint-layout';
import { IconButton } from './components';
import { studioEdgeTypes, type StudioEdge } from './SelectableEdge';
import { useBlueprintEdgeSelection } from './useBlueprintEdgeSelection';
import { StoryGraphNode, type StoryFlowNode } from './StoryGraphNode';
import { GameFlowGraphNode, type GameFlowNode } from './GameFlowNodes';
import { StoryContainerGraphNode, type StoryContainerNode } from './StoryContainerNode';
import { GameFlowModulePicker, GameFlowInspector, type GameFlowFocus } from './GameFlowInspector';
import { StoryGroupDialog, StoryTargetDialog } from './StoryGroupDialog';
import { flowInsertPosition, gameFlowCanvasEdges, gameFlowCanvasNodes, pageFlowCanvas, pageFlowNodeId } from './game-flow-view';
import { PageFlowInspector, pageEventForNode } from './PageFlowInspector';
import { setUiFlowTarget, uiFlowTargetKey, uiFlowTargets } from '../core/ui-page-flow';
import { uiPages } from '../core/ui-pages';
import { readStoryFlowSession, saveStoryFlowSession, saveStoryFlowView } from './story-flow-session';
import { flowTransitionSummary, storyTransition, storyTransitionPorts } from '../core/flow-transitions';
import { gameFlowTransition, gameFlowTransitionSupport } from '../core/game-flow-transitions';
import { FlowTransitionInspector, GameFlowInactiveTransitions, StoryInactiveTransitions } from './FlowTransitionInspector';
import { storyWireAtPointer } from './story-wire-hit';
import { useBlueprintPinReconnect } from './useBlueprintPinReconnect';
import { blueprintWireShortcuts } from './blueprint-wire-interaction';
import '@xyflow/react/dist/style.css';
import './game-flow.css';

type FlowNode = StoryFlowNode | GameFlowNode | StoryContainerNode;
const initialNodes: FlowNode[] = [];
const nodeTypes = { story: StoryGraphNode, gameFlow: GameFlowGraphNode, storyContainer: StoryContainerGraphNode };
const handledGameFlowFocus = new WeakSet<object>();
type PendingFocus = { viewport: Viewport } | { ids?: string[]; overview?: boolean };
interface BlueprintProps {
  project: Project; sceneId: string; selectedNodeId?: string; diagnostics: readonly Diagnostic[];
  commit: Commit; select: (id: string) => void;
  openPassage: (id: string) => void; createSubgraph: (groupId?: string, sceneId?: string, sourceId?: string) => void;
  focus?: GameFlowFocus;
  storyFocus?: { nodeId?: string; sceneId?: string; request: number };
  openPage: (id: string, saveMode?: 'save' | 'load', componentId?: string) => void; openBlueprint: (id: string, nodeId?: string) => void;
  preview: (start: 'launch' | 'title') => void; busy?: boolean; storyInspector: (nodeId: string) => ReactNode;
}

export function Blueprint(props: BlueprintProps) {
  return <ReactFlowProvider key={props.project.id}><FlowBlueprint {...props} /></ReactFlowProvider>;
}

function FlowBlueprint({ project, sceneId, selectedNodeId, diagnostics, commit, select, openPassage, createSubgraph, focus, storyFocus, openPage, openBlueprint, preview, busy, storyInspector }: BlueprintProps) {
  const [session] = useState(() => readStoryFlowSession(project));
  const [requestedScope, setScope] = useState(session.scope);
  const scope = useMemo(() => validStoryScope(project, requestedScope), [project.scenes, project.storyGroups, project.ui, requestedScope]);
  const scopeKey = storyScopeKey(scope), scopeRef = useRef(scope); scopeRef.current = scope;
  const index = useMemo(() => storyGroupIndex(project), [project.storyGroups]);
  const graph = useMemo(() => projectStoryGraph(project, scope, diagnostics, index), [project, scope, diagnostics, index]);
  const pageCanvas = useMemo(() => scope.kind === 'page' ? pageFlowCanvas(project, scope.pageId) : undefined, [project, scope]);
  const gameNodes = useMemo(() => scope.kind === 'game' ? gameFlowCanvasNodes(project) : pageCanvas?.nodes ?? [], [project, scope.kind, pageCanvas]);
  const containers = useMemo(() => graph.containers.map(card => card.kind === 'content' ? { ...card, position: gameNodes.find(node => node.id === card.id)?.position ?? card.position } : card), [graph.containers, gameNodes]);
  const cards = useMemo(() => new Map(containers.map(card => [card.id, card])), [containers]);
  const { setNodes: setFlowNodes, getNodes, fitView, getViewport, setViewport, screenToFlowPosition } = useReactFlow<FlowNode, StudioEdge>();
  const initialized = useNodesInitialized();
  const [selection, setSelection] = useState<string | undefined>(session.views[scopeKey]?.selectedIds[0]);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [selectedIds, setSelectedIds] = useState<string[]>(session.views[scopeKey]?.selectedIds ?? []);
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | undefined>(() => session.views[scopeKey]?.viewport ? { viewport: session.views[scopeKey].viewport! } : { overview: false });
  const [search, setSearch] = useState(''), [searchOpen, setSearchOpen] = useState(false);
  const [arranging, setArranging] = useState(false), [error, setError] = useState('');
  const [propertiesOpen, setPropertiesOpen] = useState(session.propertiesOpen);
  const [adding, setAdding] = useState<{ kind?: GameFlowStep['kind']; after?: string; x: number; y: number; position: { x: number; y: number } }>();
  const [transitionSource, setTransitionSource] = useState<string>();
  const [groupDialog, setGroupDialog] = useState<{ id?: string; nodeIds: string[]; groupIds: string[] }>();
  const [targetDialog, setTargetDialog] = useState<{ options: { id: string; name: string; location: string }[]; choose: (id: string) => void; entryChange?: { previous: string; next: string } }>();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId?: string }>();
  useEffect(() => {
    if (!contextMenu) return;
    // The menu sits outside the canvas and focus can remain in an inspector
    // or return to the window body. Escape closes only this menu, preserving
    // the canvas selection, wherever keyboard focus currently resides.
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault(); event.stopPropagation(); setContextMenu(undefined);
    };
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [contextMenu]);
  const flowRef = useRef<HTMLDivElement>(null);
  const { selectedEdgeIds, setSelectedEdgeId, setSelectedEdgeIds, onEdgesChange } = useBlueprintEdgeSelection<FlowNode>(scopeKey);
  const selectedEdgeIdsRef = useRef(selectedEdgeIds); selectedEdgeIdsRef.current = selectedEdgeIds;
  // React Flow replays its selection effect when this callback changes. Keep it
  // stable so an old node selection cannot replace a newly created node's ID
  // before that node reaches the canvas store.
  const onSelectionChange = useCallback(({ nodes }: OnSelectionChangeParams<FlowNode, StudioEdge>) => {
    const ids = nodes.map(node => node.id);
    setSelectedIds(previous => previous.join('\0') === ids.join('\0') ? previous : ids);
    if (nodes.length === 1) { setSelection(nodes[0].id); selectionRef.current = nodes[0].id; }
    else if (!nodes.length && selectedEdgeIdsRef.current.size) { selectionRef.current = undefined; setSelection(undefined); }
  }, []);
  const collapseKey = 'vns:collapsed:' + project.id;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(collapseKey) ?? '[]')); } catch { return new Set(); } });
  const toggleCollapse = useCallback((id: string) => setCollapsed(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; }), []);
  useEffect(() => { try { localStorage.setItem(collapseKey, JSON.stringify([...collapsed])); } catch { /* Optional view preference. */ } }, [collapsed, collapseKey]);

  const captureView = useCallback(() => {
    session.scope = scopeRef.current;
    saveStoryFlowView(session, { viewport: getViewport(), selectedIds: getNodes().filter(node => node.selected).map(node => node.id) });
    saveStoryFlowSession(project.id, session);
  }, [session, getViewport, getNodes, project.id]);
  useEffect(() => () => captureView(), [captureView]);
  useEffect(() => { session.propertiesOpen = propertiesOpen; session.selectedStoryId = selectedNodeId; saveStoryFlowSession(project.id, session); }, [propertiesOpen, selectedNodeId, project.id, session]);
  const navigate = (next: StoryGraphScope, focusId?: string) => {
    captureView();
    const valid = validStoryScope(project, next), key = storyScopeKey(valid), saved = session.views[key];
    session.scope = valid; saveStoryFlowSession(project.id, session);
    selectionRef.current = focusId ?? saved?.selectedIds[0]; setSelection(selectionRef.current);
    setSelectedIds(focusId ? [focusId] : saved?.selectedIds ?? []);
    const ids = new Set(focusId ? [focusId] : saved?.selectedIds ?? []);
    setFlowNodes(previous => previous.map(node => ({ ...node, selected: ids.has(node.id) })));
    setSelectedEdgeId(); setTransitionSource(undefined); setContextMenu(undefined); setAdding(undefined); setScope(valid);
    setPendingFocus(focusId ? { ids: [focusId] } : saved?.viewport ? { viewport: saved.viewport } : {});
  };
  const enterPage = (pageId: string) => {
    const path = scope.kind === 'page' ? [...scope.trail ?? [], scope.pageId] : [];
    const existing = path.indexOf(pageId), trail = existing < 0 ? path : path.slice(0, existing);
    navigate({ kind: 'page', pageId, trail }, pageFlowNodeId(pageId));
  };
  const clearNodes = useCallback(() => { selectionRef.current = undefined; setSelection(undefined); setSelectedIds([]); setTransitionSource(undefined); setFlowNodes(previous => previous.map(node => node.selected ? { ...node, selected: false } : node)); }, [setFlowNodes]);
  const inspectEdge = useCallback((id: string) => { clearNodes(); setSelectedEdgeId(id); setContextMenu(undefined); setPropertiesOpen(true); }, [clearNodes, setSelectedEdgeId]);
  const selectCanvasNode = (id?: string, center = false) => {
    selectionRef.current = id; setSelection(id); setSelectedIds(id ? [id] : []); setSelectedEdgeId(); setTransitionSource(undefined);
    setFlowNodes(previous => previous.map(node => ({ ...node, selected: node.id === id })));
    if (id && center) setPendingFocus({ ids: [id] });
  };
  const clickedNode = useRef<string | undefined>(undefined);
  const locateStory = (id: string) => {
    const destination = storyNodeScope(project, id, index); if (!destination) return;
    clickedNode.current = id; select(id); navigate(destination, id); setPropertiesOpen(true);
    setSearchOpen(false); setSearch('');
  };
  const enterContainer = (id: string) => { const card = cards.get(id); if (card?.scope) navigate(card.scope); else if (card?.targetNodeId) locateStory(card.targetNodeId); };
  const enterRef = useRef(enterContainer); enterRef.current = enterContainer;
  const enter = useCallback((id: string) => enterRef.current(id), []);
  const locateRef = useRef(locateStory); locateRef.current = locateStory;
  const followLink = useCallback((id: string) => locateRef.current(id), []);
  const previousScope = useRef<string | undefined>(undefined);
  useEffect(() => {
    const changing = previousScope.current !== scopeKey;
    const restored = new Set(selectionRef.current ? [selectionRef.current] : session.views[scopeKey]?.selectedIds ?? []);
    previousScope.current = scopeKey;
    const issueCounts = new Map<string, number>();
    for (const issue of diagnostics) if (issue.nodeId) issueCounts.set(issue.nodeId, (issueCounts.get(issue.nodeId) ?? 0) + 1);
    setFlowNodes(previous => {
      const before = new Map(previous.map(node => [node.id, node]));
      const isSelected = (id: string) => changing ? id === selectionRef.current || restored.has(id) : before.get(id)?.selected ?? id === selectionRef.current;
      const story: StoryFlowNode[] = graph.stories.map(node => ({
        ...before.get(node.id), id: node.id, type: 'story', position: { x: node.x, y: node.y }, selected: isSelected(node.id),
        deletable: node.id !== project.entryId && node.kind !== 'start', ariaLabel: '剧情节点：' + node.name,
        data: { story: node, project, issueCount: issueCounts.get(node.id), collapsed: collapsed.has(node.id), toggleCollapse, openLinkedNode: followLink },
      }));
      const lifecycle: GameFlowNode[] = gameNodes.filter(node => node.kind !== 'storyPortal').map(node => ({
        ...before.get(node.id), id: node.id, type: 'gameFlow', position: node.position, selected: isSelected(node.id), deletable: !!node.step,
        ariaLabel: '流程节点：' + node.name,
        data: { flow: node, collapsed: collapsed.has(node.id), toggleCollapse, invalid: diagnostics.some(issue => issue.severity === 'error' && issue.gameFlow?.phase === node.phase && issue.gameFlow?.stepId === node.step?.id) },
      }));
      const groups: StoryContainerNode[] = containers.map(card => ({
        ...before.get(card.id), id: card.id, type: 'storyContainer', position: card.position, selected: isSelected(card.id), deletable: false,
        draggable: true, ariaLabel: (card.kind === 'group' ? '剧情组：' : '内容节点：') + card.name,
        data: { container: card, enter },
      }));
      return [...story, ...lifecycle, ...groups];
    });
  }, [graph.stories, gameNodes, containers, project, scopeKey, session, diagnostics, collapsed, setFlowNodes, toggleCollapse, followLink, enter]);
  const previousExternal = useRef({ nodeId: selectedNodeId, sceneId });
  useEffect(() => {
    const previous = previousExternal.current; previousExternal.current = { nodeId: selectedNodeId, sceneId };
    if (clickedNode.current === selectedNodeId) { clickedNode.current = undefined; return; }
    // The app chooses a surviving node after deletion. That fallback must not
    // pull an author out of the group where they are working.
    if (previous.nodeId && !project.nodes.some(node => node.id === previous.nodeId) && previous.sceneId === sceneId) return;
    if (previous.nodeId !== selectedNodeId || previous.sceneId !== sceneId) {
      if (selectedNodeId) { const destination = storyNodeScope(project, selectedNodeId, index); if (destination) navigate(destination, selectedNodeId); }
      else if (previous.sceneId !== sceneId) navigate({ kind: 'scene', sceneId });
    }
  }, [selectedNodeId, sceneId]);
  useEffect(() => {
    if (!focus || handledGameFlowFocus.has(focus)) return;
    handledGameFlowFocus.add(focus);
    navigate({ kind: 'game' }, focus.stepId ? flowStepNodeId(focus.stepId) : flowEntry[focus.phase]); setPropertiesOpen(true);
  }, [focus]);
  useEffect(() => {
    if (!storyFocus || handledGameFlowFocus.has(storyFocus)) return;
    handledGameFlowFocus.add(storyFocus);
    if (storyFocus.nodeId) { const destination = storyNodeScope(project, storyFocus.nodeId, index); if (destination) navigate(destination, storyFocus.nodeId); }
    else if (storyFocus.sceneId) navigate({ kind: 'scene', sceneId: storyFocus.sceneId });
  }, [storyFocus]);
  useEffect(() => {
    if (!initialized || !pendingFocus) return;
    if ('ids' in pendingFocus && pendingFocus.ids?.some(id => !getNodes().some(node => node.id === id))) return;
    const frame = requestAnimationFrame(() => {
      if ('viewport' in pendingFocus) void setViewport(pendingFocus.viewport);
      else {
        if (pendingFocus.ids?.length) {
          const ids = new Set(pendingFocus.ids);
          setFlowNodes(previous => previous.map(node => ({ ...node, selected: ids.has(node.id) })));
          selectionRef.current = pendingFocus.ids[0]; setSelection(pendingFocus.ids[0]); setSelectedIds(pendingFocus.ids);
        }
        void fitView({ nodes: pendingFocus.ids?.map(id => ({ id })), padding: pendingFocus.ids ? .65 : .15, minZoom: pendingFocus.overview ? .16 : .65, maxZoom: 1, duration: 160 });
      }
      setPendingFocus(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialized, pendingFocus, fitView, setViewport, setFlowNodes, getNodes, scopeKey, graph, gameNodes]);
  const [spacePan, setSpacePan] = useState(true);
  useEffect(() => {
    const track = (event: FocusEvent) => { const target = (event.type === 'focusout' ? event.relatedTarget : event.target) as Node | null; setSpacePan(!target || !!flowRef.current?.contains(target)); };
    document.addEventListener('focusin', track); document.addEventListener('focusout', track);
    return () => { document.removeEventListener('focusin', track); document.removeEventListener('focusout', track); };
  }, []);
  const attempt = (action: () => void) => { try { action(); setError(''); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } };
  const disconnectInDraft = (draft: Project, edge: StudioEdge) => {
    if (edge.data?.readonly) return;
    if (edge.data?.pageEvent) setUiFlowTarget(draft, edge.data.pageEvent.pageId, edge.data.pageEvent.eventId);
    else if (edge.data?.storySource) draft.nodes = draft.nodes.map(node => node.id === edge.data!.storySource ? connectNode(node, edge.data!.storyPort!) : node);
    else if (flowSourcePhase(draft, edge.source)) connectGameFlowNodes(draft, edge.source);
  };
  const edges: StudioEdge[] = useMemo(() => {
    const raw: (StoryGraphWire & { gameFlowSource?: string; pageEvent?: { pageId: string; eventId: string } })[] = scope.kind === 'game' || scope.kind === 'page' ? (pageCanvas?.edges ?? gameFlowCanvasEdges(project)).map(edge => ({ ...edge, caption: edge.caption ?? '', targetHandle: edge.targetHandle ?? 'in' })) : graph.wires;
    const stories = new Map(project.nodes.map(node => [node.id, node]));
    const rendered: StudioEdge[] = raw.map((edge, edgeIndex) => {
      const selected = selectedEdgeIds.has(edge.id), color = selected ? '#bd8331' : edge.readonly ? '#899bb1' : scope.kind === 'game' ? '#859fcc' : '#65a99d';
      const source = edge.storySource ? stories.get(edge.storySource) : undefined;
      const flowSource = edge.gameFlowSource;
      const configured = flowSource ? gameFlowTransition(project, flowSource) : source && edge.storyPort ? storyTransition(source, edge.storyPort) : undefined;
      const supported = flowSource ? gameFlowTransitionSupport(project, flowSource, edge.sourceHandle).supported : source && storyTransitionPorts(source, project).some(item => item.port === edge.storyPort);
      const transition = configured && !edge.readonly && supported ? configured : undefined;
      return { ...edge, type: 'studio', selected, reconnectable: edge.readonly ? false : edge.pageEvent ? 'target' : true, deletable: !edge.readonly,
        ariaLabel: '连线：' + edge.label, markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        data: { label: edge.label, caption: edge.caption, readonly: edge.readonly,
          transitionLabel: transition ? flowTransitionSummary(transition) : undefined, inspectTransition: inspectEdge,
          routeReturns: true, returnLane: edgeIndex % 3,
          storySource: edge.storySource, storyPort: edge.storyPort, storyTarget: edge.storyTarget, gameFlowSource: flowSource, pageEvent: edge.pageEvent },
        style: { stroke: color, strokeWidth: selected ? 3 : 2, strokeDasharray: edge.readonly ? '6 4' : undefined },
      };
    });
    // Shared endpoints must reconnect the selected wire. Paint it after its
    // siblings without elevating it above node controls or transition labels.
    // Keep routing lanes based on the original order so selection never bends a wire.
    return [...rendered.filter(edge => !edge.selected), ...rendered.filter(edge => edge.selected)];
  }, [scope.kind, project, graph.wires, pageCanvas, selectedEdgeIds, inspectEdge]);
  useEffect(() => { setSelectedEdgeIds(new Set([...selectedEdgeIds].filter(id => edges.some(edge => edge.id === id)))); }, [edges, selectedEdgeIds, setSelectedEdgeIds]);
  const connectFlow = (source: string, target?: string) => attempt(() => commit('连接流程节点', draft => connectGameFlowNodes(draft, source, target), { separate: true }));
  const resolveConnection = (connection: Connection, oldEdge?: StudioEdge) => {
    const sourceCard = cards.get(connection.source), targetCard = cards.get(connection.target);
    const output = sourceCard?.outputs.find(port => port.id === connection.sourceHandle), input = targetCard?.inputs.find(port => port.id === connection.targetHandle);
    const previousSource = oldEdge?.source === connection.source && oldEdge.sourceHandle === connection.sourceHandle ? oldEdge.data?.storySource : undefined;
    const source = output?.nodeId ?? (project.nodes.some(node => node.id === connection.source) ? connection.source : previousSource);
    const port = output?.port ?? (source === connection.source ? connection.sourceHandle : oldEdge?.data?.storyPort);
    const target = input?.nodeId ?? targetCard?.targetNodeId ?? (project.nodes.some(node => node.id === connection.target) ? connection.target : undefined);
    return { source, port, target, targetCard, input, output };
  };
  const connectionProblem = (connection: Connection, oldEdge?: StudioEdge) => {
    const event = pageEventForNode(project, gameNodes, connection.source, connection.sourceHandle);
    if (event) {
      if (!event.editable) return event.problem;
      if (oldEdge && (oldEdge.source !== connection.source || oldEdge.sourceHandle !== connection.sourceHandle)) return '请保留原按钮出口，只改接它的目标。';
      const target = gameNodes.find(node => node.id === connection.target)?.target;
      return target && uiFlowTargets(project, event.pageId).some(item => uiFlowTargetKey(item) === uiFlowTargetKey(target)) ? undefined : '请选择页面或系统操作；页面关闭后的顺序在调用位置设置。';
    }
    if (scope.kind === 'page') return '请选择本页的可编辑按钮出口。';
    if (scope.kind === 'game') return connection.sourceHandle !== 'next' ? '此出口由对应事件触发。' : gameFlowConnectionProblem(project, connection.source, connection.target, oldEdge?.source);
    const { source, port, target, targetCard, input, output } = resolveConnection(connection, oldEdge);
    const node = project.nodes.find(node => node.id === source);
    if (output?.readonly && !(oldEdge && oldEdge.source === connection.source && oldEdge.sourceHandle === connection.sourceHandle) || input?.readonly && !targetCard?.targetNodeId || !node || !port || !targets(node).some(item => item.port === port)) return '请选择可编辑的剧情出口。';
    if (targetCard && input?.id === 'choose') return [...targetCard.nodeIds].some(id => project.nodes.some(node => node.id === id && node.kind !== 'start')) ? undefined : '剧情组内还没有可用入口。';
    if (!target || !project.nodes.some(node => node.id === target && node.kind !== 'start')) return '请选择组内的具体剧情入口。';
  };
  const connectCanvas = (connection: Connection, oldEdge?: StudioEdge) => attempt(() => {
    if (oldEdge?.data?.readonly) throw new Error('此连线由运行时决定，不能改接。');
    const problem = connectionProblem(connection, oldEdge); if (problem) throw new Error(problem);
    const event = pageEventForNode(project, gameNodes, connection.source, connection.sourceHandle);
    if (event) {
      const target = gameNodes.find(node => node.id === connection.target)?.target;
      commit('改接按钮事件', draft => setUiFlowTarget(draft, event.pageId, event.id, target), { separate: true }); return;
    }
    if (scope.kind === 'game') {
      commit(oldEdge ? '改接流程连线' : '连接流程节点', draft => connectGameFlowNodes(draft, connection.source, connection.target, oldEdge?.source), { separate: true }); return;
    }
    const resolved = resolveConnection(connection, oldEdge);
    const apply = (target: string) => {
      commit(oldEdge ? '改接剧情连线' : '连接剧情节点', draft => {
        if (!draft.nodes.some(node => node.id === target && node.kind !== 'start')) throw new Error('入口节点已不存在。');
        if (oldEdge) disconnectInDraft(draft, oldEdge);
        draft.nodes = draft.nodes.map(node => node.id === resolved.source ? connectNode(node, resolved.port!, target) : node);
      }, { separate: true }); setTargetDialog(undefined); setSelectedEdgeId(resolved.source + ':' + resolved.port);
    };
    if (resolved.input?.id === 'choose' && resolved.targetCard) setTargetDialog({ options: project.nodes.filter(node => resolved.targetCard!.nodeIds.has(node.id) && node.kind !== 'start').map(node => ({ id: node.id, name: node.name, location: storyNodeLocation(project, node.id, index) })), choose: apply });
    else apply(resolved.target!);
  });
  const pinReconnect = useBlueprintPinReconnect({
    scopeKey, canvas: flowRef, edges, notify: setError, reconnect: (edge, connection) => connectCanvas(connection, edge),
    disconnect: removed => attempt(() => {
      commit('断开流程连线', draft => { for (const edge of removed) disconnectInDraft(draft, edge); }, { separate: true });
      const ids = new Set(removed.map(edge => edge.id));
      setSelectedEdgeIds(new Set([...selectedEdgeIds].filter(id => !ids.has(id))));
    }),
  });
  const preservePositions = (draft: Project) => {
    const positions = (draft.gameFlow ??= gameFlow(draft)).positions ??= {};
    for (const node of getNodes()) if (node.type === 'gameFlow' || node.type === 'storyContainer' && node.data.container.kind !== 'group') positions[node.id] = node.position;
  };
  const moveItems = (draft: Project, items: { id: string; position: { x: number; y: number } }[]) => {
    preservePositions(draft);
    for (const item of items) {
      const story = draft.nodes.find(node => node.id === item.id), groupId = cards.get(item.id)?.groupId;
      const group = draft.storyGroups?.find(group => group.id === groupId);
      if (story) { story.x = item.position.x; story.y = item.position.y; }
      else if (group) { group.x = item.position.x; group.y = item.position.y; }
      else draft.gameFlow!.positions![item.id] = item.position;
    }
  };
  const arrange = async () => {
    if (arranging) return;
    setArranging(true); setError(''); const requested = scopeKey;
    try {
      const nodes = getNodes();
      const result = await layoutBlueprint({ id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '55', 'elk.layered.spacing.nodeNodeBetweenLayers': '100' },
        children: nodes.map(node => ({ id: node.id, width: node.measured?.width ?? 280, height: node.measured?.height ?? 140 })),
        edges: edges.filter(edge => cards.get(edge.target)?.kind === 'return' || !['returnTitle', 'returnCall', 'cancel'].includes(edge.data?.storyPort ?? edge.sourceHandle ?? '')).map(edge => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
      });
      if (storyScopeKey(scopeRef.current) !== requested) return;
      commit('整理当前流程布局', draft => moveItems(draft, (result.children ?? []).map(node => ({ id: node.id, position: { x: node.x ?? 0, y: node.y ?? 0 } }))), { separate: true });
      setPendingFocus({ overview: true });
    } catch { setError('整理布局未完成，请稍后重试。'); } finally { setArranging(false); }
  };
  const groupSelection = () => {
    if (scope.kind !== 'scene') return;
    const selected = getNodes().filter(node => node.selected);
    if (!selected.length || selected.some(node => node.type !== 'story' && !(node.type === 'storyContainer' && node.data.container.kind === 'group'))) { setError('请框选当前层级的剧情节点或剧情组。'); return; }
    setGroupDialog({ nodeIds: selected.filter(node => node.type === 'story').map(node => node.id), groupIds: selected.flatMap(node => node.type === 'storyContainer' && node.data.container.groupId ? [node.data.container.groupId] : []) }); setContextMenu(undefined);
  };
  const ungroup = (id: string) => attempt(() => {
    const group = index.groups.get(id); if (!group) return;
    commit('解组剧情组', draft => ungroupStoryGroup(draft, id), { separate: true }); setContextMenu(undefined); selectCanvasNode();
    if (scope.kind === 'scene' && scope.groupId === id) navigate({ kind: 'scene', sceneId: group.sceneId, groupId: group.parentId });
  });
  const pendingCreated = useRef<string | undefined>(undefined);
  useEffect(() => { if (pendingCreated.current && project.nodes.some(node => node.id === pendingCreated.current)) { const id = pendingCreated.current; pendingCreated.current = undefined; clickedNode.current = id; select(id); selectCanvasNode(id, true); } }, [project.nodes]);
  const addStory = (kind: NodeKind) => attempt(() => {
    if (scope.kind !== 'scene') throw new Error('请先进入要编辑的小章节。');
    const node = kind === 'chapterTitle' ? { ...newNode('passage', scope.sceneId), kind: 'passage' as const, name: '独立演出', lines: [{ id: makeId('line'), text: '', silent: true, actions: [] }] } : newNode(kind, scope.sceneId, project.variables[0]?.id);
    const at = flowInsertPosition(getNodes(), selection ?? ''); node.x = at.x; node.y = at.y;
    commit('添加剧情节点', draft => { draft.nodes.push(node); addNodeToStoryGroup(draft, node.id, scope.groupId); }, { separate: true }); pendingCreated.current = node.id;
  });
  const openNode = (node: FlowNode) => {
    captureView();
    if (node.type === 'storyContainer') enterContainer(node.id);
    else if (node.type === 'story') { const story = node.data.story; if (story.kind === 'passage') openPassage(node.id); else if ((story.kind === 'call' || story.kind === 'jump') && story.target) locateStory(story.target); }
    else { const flow = node.data.flow; if (flow.step?.kind === 'page') enterPage(flow.step.pageId); else if (flow.step?.kind === 'blueprint') openBlueprint(flow.step.graphId); else if (flow.kind === 'pageEvents' && flow.pageId) openPage(flow.pageId, flow.pageId === 'ui:save' ? 'load' : undefined); else if (flow.pageId) enterPage(flow.pageId); else if (flow.target?.kind === 'logic') openBlueprint(flow.target.graphId, flow.target.nodeId); }
  };
  const crumbs = storyScopeBreadcrumbs(project, scope, index), selectedCard = cards.get(selection ?? ''), selectedGame = gameNodes.find(node => node.id === selection && node.kind !== 'storyPortal');
  const selectedStory = graph.stories.find(node => node.id === selection);
  const selectedEdges = selectedIds.length ? [] : edges.filter(edge => selectedEdgeIds.has(edge.id));
  const selectedEdge = selectedEdges.length === 1 ? selectedEdges[0] : undefined;
  const editFlowTransition = (source: string) => {
    const edge = edges.find(item => item.data?.gameFlowSource === source);
    if (edge) inspectEdge(edge.id);
    else { clearNodes(); setSelectedEdgeId(); setTransitionSource(source); setPropertiesOpen(true); }
  };
  const locateGameFlow = (id: string) => { selectCanvasNode(id, true); setPropertiesOpen(true); };
  const addFlowModule = (at?: { x: number; y: number }, after?: string, kind?: GameFlowStep['kind'], placement?: { x: number; y: number }) => {
    const bounds = flowRef.current?.getBoundingClientRect();
    const center = screenToFlowPosition({ x: bounds ? bounds.left + bounds.width / 2 : innerWidth / 2, y: bounds ? bounds.top + bounds.height / 2 : innerHeight / 2 });
    const position = after ? flowInsertPosition(getNodes(), after) : placement ?? { x: center.x - 121, y: center.y - 72 };
    setAdding({ kind, after, x: at?.x ?? (bounds?.left ?? 0) + 20, y: at?.y ?? (bounds?.top ?? 0) + 20, position }); setContextMenu(undefined);
  };
  useEffect(() => { if (selectedEdgeIds.size || selectedIds.length) setTransitionSource(undefined); }, [selectedEdgeIds, selectedIds]);
  const inspectEdgeSource = () => {
    if (!selectedEdge) return;
    if (selectedEdge.data?.storySource) locateStory(selectedEdge.data.storySource);
    else { selectCanvasNode(selectedEdge.source); setPropertiesOpen(true); }
  };
  const groupable = scope.kind === 'scene' && selectedIds.length > 0 && selectedIds.every(id => graph.stories.some(node => node.id === id) || cards.get(id)?.kind === 'group');
  const currentGroup = scope.kind === 'scene' && scope.groupId ? index.groups.get(scope.groupId) : undefined;
  const currentGroupCard = useMemo(() => currentGroup ? projectStoryGraph(project, { kind: 'scene', sceneId: currentGroup.sceneId, groupId: currentGroup.parentId }, diagnostics, index).containers.find(card => card.groupId === currentGroup.id) : undefined, [currentGroup, project, diagnostics, index]);
  const inspectCard = selectedCard ?? currentGroupCard;
  const entryOptions = inspectCard?.kind === 'content' || inspectCard?.kind === 'scene' || inspectCard?.kind === 'group'
    ? project.nodes.filter(node => inspectCard.nodeIds.has(node.id)).map(node => ({ id: node.id, name: node.name, location: storyNodeLocation(project, node.id, index) })) : [];
  const [requestedEntry, setRequestedEntry] = useState<string>();
  const confirmEntry = (id: string) => {
    const next = project.nodes.find(node => node.id === id); if (!next || id === project.entryId) return;
    setTargetDialog({ options: [{ id, name: next.name, location: storyNodeLocation(project, id, index) }],
      entryChange: { previous: project.nodes.find(node => node.id === project.entryId)?.name ?? '已不存在', next: next.name },
      choose: target => { commit('更改故事入口', draft => { if (!draft.nodes.some(node => node.id === target)) throw new Error('入口节点已不存在。'); draft.entryId = target; }, { separate: true }); setTargetDialog(undefined); },
    });
  };
  const searchItems = useMemo(() => {
    const q = search.trim().toLocaleLowerCase(); if (!q) return [];
    return [
      ...gameFlowCanvasNodes(project).map(node => ({ id: node.id, name: node.name, detail: node.detail, location: '流程图', scope: { kind: 'game' } as StoryGraphScope })),
      ...uiPages(project).map(page => ({ id: pageFlowNodeId(page.id), name: page.name + ' · 页面流程', detail: '', location: '页面与事件', scope: { kind: 'page', pageId: page.id } as StoryGraphScope })),
      ...project.scenes.map(scene => ({ id: 'story:scene:' + scene.id, name: scene.name, detail: '', location: project.chapters.find(chapter => chapter.id === scene.chapterId)?.name ?? '', scope: { kind: 'content' } as StoryGraphScope })),
      ...(project.storyGroups ?? []).map(group => ({ id: storyGroupNodeId(group.id), name: group.name, detail: '', location: index.ancestors(group.parentId).map(group => group.name).join(' / ') || project.scenes.find(scene => scene.id === group.sceneId)?.name || '', scope: { kind: 'scene', sceneId: group.sceneId, groupId: group.parentId } as StoryGraphScope })),
      ...project.nodes.map(node => ({ id: node.id, name: node.name, detail: node.kind === 'passage' ? node.lines.map(line => line.text).join(' ') : '', location: storyNodeLocation(project, node.id, index), scope: storyNodeScope(project, node.id, index)! })),
    ].filter(item => (item.name + ' ' + item.detail + ' ' + item.location).toLocaleLowerCase().includes(q));
  }, [project, index, search]);

  return <section className="blueprint-workspace unified-flow-workspace" aria-label="流程图" data-flow-scope={scopeKey}>
    <div className="workspace-toolbar unified-flow-toolbar">
      <nav className="story-flow-breadcrumbs" aria-label="流程图位置"><IconButton title="返回上一级" disabled={crumbs.length < 2} onClick={() => navigate(crumbs[crumbs.length - 2].scope)}><ArrowLeft size={16} /></IconButton>
        {crumbs.map((crumb, i) => <span key={storyScopeKey(crumb.scope)}>{i > 0 && <ChevronRight size={13} />}<button aria-current={i === crumbs.length - 1 ? 'page' : undefined} title={crumb.name} onClick={() => navigate(crumb.scope)}>{i === 0 && <GitBranch size={15} />}{crumb.name}</button></span>)}
      </nav><div className="spacer" />
      <div className="story-flow-search"><div className="search compact"><Search size={14} /><input aria-label="搜索流程图" placeholder="查找剧情、对白或组…" value={search} onChange={event => { setSearch(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onKeyDown={event => { if (event.key === 'Escape') { setSearchOpen(false); event.stopPropagation(); } }} />{search && <button aria-label="清空流程图搜索" onClick={() => { setSearch(''); setSearchOpen(false); }}><X size={13} /></button>}</div>
        {searchOpen && search.trim() && <div className="story-flow-search-results" role="region" aria-label="流程图搜索结果"><div className="story-search-count">{searchItems.length} 个结果{searchItems.length > 60 ? ' · 显示前 60 个，请继续输入' : ''}</div>{searchItems.slice(0, 60).map(item => <button key={item.id} onClick={() => { if (project.nodes.some(node => node.id === item.id)) locateStory(item.id); else { navigate(item.scope, item.id); setSearchOpen(false); setSearch(''); } }}><strong>{item.name}</strong><span>{item.location}</span>{item.detail && <small>{item.detail.slice(0, 110)}</small>}</button>)}{!searchItems.length && <p>没有匹配的内容。</p>}</div>}
      </div>
      <IconButton title="适应全图" onClick={() => setPendingFocus({ overview: true })}><LocateFixed size={17} /></IconButton>
      <IconButton title="整理当前布局" disabled={arranging} aria-busy={arranging} onClick={() => void arrange()}><LayoutGrid size={17} className={arranging ? 'spin' : undefined} /></IconButton>
      <IconButton title={propertiesOpen ? '隐藏节点属性' : '显示节点属性'} onClick={() => setPropertiesOpen(!propertiesOpen)}>{propertiesOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</IconButton>
    </div>
    <div className="story-flow-actions">
      {scope.kind === 'game' ? <><button type="button" className="small-button game-flow-add-module" onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); addFlowModule({ x: bounds.left, y: bounds.bottom + 6 }); }}><Plus size={16} />添加模块</button><span className="story-flow-context">页面 · 动画演出 · 视频</span></>
        : scope.kind === 'content' ? <span className="story-flow-context">双击小章节进入剧情</span> : scope.kind === 'page' ? <><span className="story-flow-context">页面按钮与目标</span><button className="small-button" onClick={() => openPage(scope.pageId, scope.pageId === 'ui:save' ? 'load' : undefined)}><ExternalLink size={14} />编辑界面</button></> : <>
          <select aria-label="添加剧情节点" value="" onChange={event => { if (event.target.value) addStory(event.target.value as NodeKind); }}><option value="">添加剧情节点…</option>{Object.entries(nodeNames).filter(([kind]) => kind !== 'start').map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select>
          <button className="small-button" disabled={!groupable} title="框选同级节点后打组 · Ctrl+G" onClick={groupSelection}><FolderPlus size={15} />打组</button>
          <IconButton title="创建可复用段落" onClick={() => createSubgraph(scope.groupId, scope.sceneId, selection)}><Workflow size={16} /></IconButton>
        </>}
      <div className="spacer" /><span className="story-flow-help" title={blueprintWireShortcuts + '端点接着多条线时，先选中要改接的那一条。'}>{scope.kind === 'scene' ? '框选打组 · 双击进入 · 中键平移' : scope.kind === 'game' ? '点击连线设置过渡 · 拖动端点改接' : '拖动端点改接 · 空白松开断线'}</span>
      {(scope.kind === 'game' || scope.kind === 'page') && <select aria-label="查看页面流程" value="" onChange={event => { if (event.target.value) enterPage(event.target.value); }}><option value="">查看页面流程…</option>{uiPages(project).filter(page => !page.disabled).map(page => <option key={page.id} value={page.id}>{page.name}</option>)}</select>}
      <select aria-label="预览流程起点" value="" disabled={busy} onChange={event => { if (event.target.value) preview(event.target.value as 'launch' | 'title'); }}><option value="">试玩…</option><option value="launch">从启动试玩</option><option value="title">从标题试玩</option></select>
    </div>
    {error && <p className="flow-edit-error" role="alert">{error}<button aria-label="关闭流程图提示" onClick={() => setError('')}><X size={13} /></button></p>}
    <div className={'unified-flow-body' + (propertiesOpen ? '' : ' properties-hidden')}>
      <div className="flow-container" ref={flowRef} onMouseDownCapture={pinReconnect.onMouseDownCapture} onClickCapture={pinReconnect.onClickCapture} onPointerDownCapture={() => { setSpacePan(true); setSearchOpen(false); }} onKeyDownCapture={event => {
        if ((event.target as HTMLElement).closest('input, textarea, select, button, [contenteditable="true"]')) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); event.stopPropagation(); groupSelection(); }
        else if (event.altKey && event.key === 'ArrowUp' && crumbs.length > 1) { event.preventDefault(); navigate(crumbs[crumbs.length - 2].scope); }
        else if (event.key === 'Enter') {
          const id = (event.target as HTMLElement).closest('.react-flow__node')?.getAttribute('data-id') ?? selection;
          const node = getNodes().find(node => node.id === id);
          if (node) { event.preventDefault(); event.stopPropagation(); openNode(node); }
        }
        else if (event.key === 'Escape') { clearNodes(); setSelectedEdgeId(); setContextMenu(undefined); }
      }}>
        <ReactFlow<FlowNode, StudioEdge> defaultNodes={initialNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={studioEdgeTypes}
          onSelectionChange={onSelectionChange}
          onNodeClick={(_, node) => { setSelection(node.id); setSelectedEdgeId(); setTransitionSource(undefined); setContextMenu(undefined); if (node.type === 'story') { clickedNode.current = node.id; select(node.id); } }}
          onPaneClick={() => { clearNodes(); setSelectedEdgeId(); setContextMenu(undefined); }}
          onEdgeClick={(event, edge) => inspectEdge(storyWireAtPointer(flowRef.current, event, edge.id))}
          onNodeContextMenu={(event, node) => { event.preventDefault(); if (!getNodes().find(item => item.id === node.id)?.selected) selectCanvasNode(node.id); setContextMenu({ x: Math.min(event.clientX, innerWidth - 230), y: Math.min(event.clientY, innerHeight - 190), nodeId: node.id }); }}
          onPaneContextMenu={event => { event.preventDefault(); const at = { x: event.clientX, y: event.clientY }; if (scope.kind === 'game') addFlowModule(at, undefined, undefined, screenToFlowPosition(at)); else setContextMenu({ x: Math.min(event.clientX, innerWidth - 230), y: Math.min(event.clientY, innerHeight - 190) }); }}
          onEdgeContextMenu={(event, edge) => { event.preventDefault(); inspectEdge(storyWireAtPointer(flowRef.current, event, edge.id)); }}
          onEdgesChange={onEdgesChange} onConnectStart={pinReconnect.onConnectStart} onConnect={connection => { if (pinReconnect.acceptsConnection()) connectCanvas(connection); }} onConnectEnd={pinReconnect.onConnectEnd} onReconnect={pinReconnect.onReconnect}
          isValidConnection={connection => pinReconnect.acceptsConnection() && !connectionProblem(connection as Connection, pinReconnect.currentEdge.current)}
          onReconnectStart={pinReconnect.onReconnectStart} onReconnectEnd={pinReconnect.onReconnectEnd}
          onNodeDoubleClick={(_, node) => openNode(node)} onMoveEnd={captureView}
          onBeforeDelete={async ({ nodes, edges: deletingEdges }) => {
            const protectedSelection = getNodes().some(node => node.selected && node.type === 'storyContainer');
            return protectedSelection ? { nodes: nodes.filter(node => node.type !== 'storyContainer'), edges: deletingEdges.filter(edge => !cards.has(edge.source) && !cards.has(edge.target)) } : true;
          }}
          onNodeDragStop={(_, node, moved) => commit('移动流程节点', draft => moveItems(draft, moved.length ? moved : [node]), { separate: true })}
          onDelete={({ nodes, edges: removedEdges }) => {
            commit('删除流程所选内容', draft => {
              const ids = new Set(nodes.map(node => node.id));
              for (const edge of removedEdges) if (!ids.has(edge.data?.storySource ?? edge.source) && !ids.has(edge.data?.storyTarget ?? edge.target)) disconnectInDraft(draft, edge);
              for (const node of nodes) if (node.type === 'gameFlow') removeGameFlowStep(draft, node.id);
              removeNodes(draft, nodes.filter(node => node.type === 'story' && node.id !== draft.entryId && node.data.story.kind !== 'start').map(node => node.id));
            }, { separate: true }); selectCanvasNode();
          }}
          minZoom={.1} maxZoom={1.6} reconnectRadius={18} connectionRadius={26} elevateEdgesOnSelect={false} panOnDrag={[1, 2]} selectionOnDrag selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode={['Control', 'Meta']} deleteKeyCode={['Backspace', 'Delete']} panActivationKeyCode={spacePan ? 'Space' : null} proOptions={{ hideAttribution: true }}>
          <Background gap={24} size={1} color="#84959055" /><Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={node => node.selected ? '#1b8a78' : node.type === 'storyContainer' ? '#c5a872' : node.type === 'gameFlow' ? '#9caed2' : '#bacdc8'} />
        </ReactFlow>
        {scope.kind === 'scene' && !graph.stories.length && !containers.some(card => card.kind === 'group') && <div className="story-flow-empty"><FolderOpen size={32} /><strong>这里还没有剧情</strong><span>从上方添加剧情节点，开始编排内容。</span></div>}
      </div>
      {propertiesOpen && <div className="flow-node-properties">{scope.kind === 'game' && <GameFlowInactiveTransitions project={project} commit={commit} onEdit={editFlowTransition} report={setError} />}
        {selectedEdges.length || transitionSource ? <FlowTransitionInspector key={selectedEdge?.id ?? transitionSource ?? 'multiple'} project={project} edge={selectedEdge} gameFlowSource={transitionSource} multiple={selectedEdges.length > 1} commit={commit} onLocateStory={locateStory} onLocateGameFlow={locateGameFlow} onInspectSource={inspectEdgeSource} report={setError} />
        : selectedGame && (selectedGame.events || selectedGame.event || ['pageEvents', 'pageReference', 'system', 'logic'].includes(selectedGame.kind)) ? <PageFlowInspector project={project} node={selectedGame} commit={commit} enterPage={enterPage} openPage={openPage} openBlueprint={openBlueprint} report={setError} />
        : selectedGame ? <GameFlowInspector key={selectedGame.id} project={project} nodeId={selectedGame.id} commit={commit} openPage={openPage} openBlueprint={openBlueprint} openStory={() => navigate({ kind: 'content' })} preview={preview} busy={busy} connect={connectFlow} add={(kind, after) => addFlowModule(undefined, after, kind)} editTransition={editFlowTransition} remove={id => { commit('删除流程节点并衔接', draft => removeGameFlowStep(draft, id), { separate: true }); selectCanvasNode(); }} />
        : selectedStory ? <div className="flow-story-inspector-stack"><StoryInactiveTransitions project={project} node={selectedStory} commit={commit} report={setError} />{storyInspector(selectedStory.id)}</div>
        : <aside className="inspector story-group-inspector"><div className="panel-heading"><FolderOpen size={16} /><h2>{inspectCard?.kind === 'group' ? '剧情组' : '流程导航'}</h2></div><div className="inspector-scroll">
          {inspectCard ? <><h3>{inspectCard.name}</h3><p className="muted">{inspectCard.detail}</p>
            {inspectCard.scope && <button className="small-button" onClick={() => navigate(inspectCard.scope!)}><FolderOpen size={15} />进入{inspectCard.kind === 'group' ? '剧情组' : inspectCard.name}</button>}
            {inspectCard.targetNodeId && <button className="small-button" onClick={() => locateStory(inspectCard.targetNodeId!)}><ExternalLink size={14} />定位原节点</button>}
            {inspectCard.groupId && <div className="story-group-operations"><button className="small-button" onClick={() => setGroupDialog({ id: inspectCard.groupId, nodeIds: [], groupIds: [] })}><Pencil size={14} />重命名</button><button className="small-button" onClick={() => ungroup(inspectCard.groupId!)}><Ungroup size={14} />解组，保留内容</button></div>}
            {inspectCard.containsEntry && <button className="text-button" onClick={() => locateStory(project.entryId)}>故事入口 · {project.nodes.find(node => node.id === project.entryId)?.name}</button>}
            {entryOptions.length > 0 && <details className="story-entry-setting"><summary>设置新游戏的故事入口</summary><select aria-label="新的故事入口" value={requestedEntry && entryOptions.some(option => option.id === requestedEntry) ? requestedEntry : entryOptions.some(option => option.id === project.entryId) ? project.entryId : ''} onChange={event => setRequestedEntry(event.target.value)}><option value="" disabled>选择具体剧情节点…</option>{entryOptions.map(option => <option key={option.id} value={option.id}>{option.name} · {option.location}</option>)}</select><button className="small-button" disabled={!requestedEntry || requestedEntry === project.entryId || !entryOptions.some(option => option.id === requestedEntry)} onClick={() => confirmEntry(requestedEntry!)}>设为故事入口…</button></details>}
            {inspectCard.inputs.filter(port => port.nodeId).length > 0 && <><h4>入口</h4>{inspectCard.inputs.filter(port => port.nodeId).map(port => <button key={port.id} className="story-boundary-link" onClick={() => locateStory(port.nodeId!)}>{port.label}<ExternalLink size={12} /></button>)}</>}
            {inspectCard.outputs.length > 0 && <><h4>出口</h4>{inspectCard.outputs.map(port => { const wire = edges.find(edge => edge.source === inspectCard.id && edge.sourceHandle === port.id || port.nodeId && edge.data?.storySource === port.nodeId && edge.data.storyPort === port.port); return <button key={port.id} className="story-boundary-link" disabled={!port.nodeId && !wire} onClick={() => { if (wire) inspectEdge(wire.id); else if (port.nodeId) locateStory(port.nodeId); }}><span>{port.label}<small>{wire?.data?.label ?? (port.readonly ? '运行时决定' : '未连接')}</small></span></button>; })}</>}
            {inspectCard.issues.length > 0 && <><h4>内部问题 · {inspectCard.issues.length}</h4>{inspectCard.issues.map((issue, i) => <button key={i} className="story-boundary-link warning" onClick={() => issue.nodeId && locateStory(issue.nodeId)}>{issue.message}</button>)}</>}
          </> : <><h3>{crumbs.at(-1)?.name}</h3><p className="muted">{scope.kind === 'game' ? '用上方“添加模块”或空白处右键，直接选择页面、动画演出或视频。放到画布后，拖动出口连接模块。' : scope.kind === 'page' ? '选中页面事件卡片可修改按钮目标。双击目标页面继续进入，用上方路径返回。' : scope.kind === 'content' ? '双击小章节进入。章节卡片保留跨章节的入口和出口。' : '框选剧情节点，右键打组。双击剧情组进入内部，用上方路径返回。'}</p>{scope.kind === 'game' && <p className="muted">点击开场模块到标题菜单的连线可设置过渡。双击“游戏内容”进入剧情，双击页面进入按钮流程。</p>}{scope.kind === 'scene' && <p className="muted">打组只整理编辑内容，游戏按原来的分支和连接运行。</p>}</>}
        </div></aside>}</div>}
    </div>
    {contextMenu && <><div className="story-context-dismiss" onPointerDown={() => setContextMenu(undefined)} /><div className="story-flow-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
      {scope.kind === 'game' ? <><button role="menuitem" onClick={() => addFlowModule(contextMenu, undefined, undefined, screenToFlowPosition(contextMenu))}><Plus size={15} />添加模块…</button>
        {contextMenu.nodeId && flowSourcePhase(project, contextMenu.nodeId) && <button role="menuitem" onClick={() => addFlowModule(contextMenu, contextMenu.nodeId)}><Plus size={15} />在此出口插入…</button>}</>
        : scope.kind === 'scene' && <button role="menuitem" disabled={!groupable} onClick={groupSelection}><FolderPlus size={15} />打组为剧情组<span>Ctrl+G</span></button>}
      {selectedCard?.scope && <button role="menuitem" onClick={() => enterContainer(selectedCard.id)}><FolderOpen size={15} />进入{selectedCard.kind === 'group' ? '剧情组' : selectedCard.name}</button>}
      {selectedCard?.groupId && <><button role="menuitem" onClick={() => { setGroupDialog({ id: selectedCard.groupId, nodeIds: [], groupIds: [] }); setContextMenu(undefined); }}><Pencil size={15} />重命名剧情组</button><button role="menuitem" onClick={() => ungroup(selectedCard.groupId!)}><Ungroup size={15} />解组，保留内容</button></>}
      <button role="menuitem" onClick={() => { setContextMenu(undefined); void arrange(); }}><LayoutGrid size={15} />整理当前布局</button>
    </div></>}
    {groupDialog && <StoryGroupDialog name={groupDialog.id ? index.groups.get(groupDialog.id)?.name : undefined} count={groupDialog.id ? undefined : groupDialog.nodeIds.length + groupDialog.groupIds.length} onClose={() => setGroupDialog(undefined)} onSave={name => {
      if (groupDialog.id) commit('重命名剧情组', draft => { const group = draft.storyGroups?.find(group => group.id === groupDialog.id); if (group) group.name = name; }, { separate: true });
      else if (scope.kind === 'scene') { let id = ''; commit('打组为剧情组', draft => { const group = createStoryGroup(draft, { name, sceneId: scope.sceneId, parentId: scope.groupId, nodeIds: groupDialog.nodeIds, groupIds: groupDialog.groupIds }); id = storyGroupNodeId(group.id); }, { separate: true }); selectCanvasNode(id, true); }
    }} />}
    {targetDialog && <StoryTargetDialog options={targetDialog.options} entryChange={targetDialog.entryChange} onClose={() => setTargetDialog(undefined)} onChoose={id => attempt(() => targetDialog.choose(id))} />}
    {adding && <GameFlowModulePicker project={project} {...adding} onClose={() => setAdding(undefined)} onAdd={(input, after) => attempt(() => {
      let id = ''; commit(after ? '插入流程节点' : '添加流程模块', draft => {
        preservePositions(draft);
        const phase = after ? flowSourcePhase(draft, after) : undefined;
        if (after && !phase) throw new Error('插入位置已不存在，请重新选择出口。');
        const step = after && phase ? addGameFlowStep(draft, phase, input, after) : createGameFlowStep(draft, input);
        id = flowStepNodeId(step.id); draft.gameFlow!.positions![id] = adding.position;
      }, { separate: true }); selectCanvasNode(id, !!after); if (after) setPropertiesOpen(true);
    })} />}
  </section>;
}
