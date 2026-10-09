import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  SelectionMode,
  useReactFlow,
  type Node,
  type NodeProps,
  type Edge,
  useUpdateNodeInternals,
} from "@xyflow/react";
import { layoutBlueprint } from './blueprint-layout';
import {
  ArrowRight,
  GitBranch,
  LayoutGrid,
  MessageSquare,
  Clapperboard,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Workflow,
  Minimize2,
  Maximize2,
  MousePointer2,
  Gamepad2,
  Unplug,
} from "lucide-react";
import {
  connectNode,
  targets,
  type NodeKind,
  type Project,
  type StoryNode,
} from "../core/model";
import { formatCondition, nodeNames, removeNodes, type Commit } from "./editor";
import { isStandaloneNode, standaloneChapter } from '../core/standalone-performance';
import { makeId } from "../core/model";
import { IconButton } from "./components";
import { studioEdgeTypes, type StudioEdge } from './SelectableEdge';
import { useBlueprintEdgeSelection } from './useBlueprintEdgeSelection';
import "@xyflow/react/dist/style.css";

type StoryFlowNode = Node<{ story: StoryNode; project: Project; collapsed: boolean; toggleCollapse: (id: string) => void; openLinkedNode: (id: string, sourceId?: string) => void }, "story">;
const initialStoryNodes: StoryFlowNode[] = [];
const StoryGraphNode = memo(function StoryGraphNode({ id, data, selected }: NodeProps<StoryFlowNode>) {
  const { story: node, project } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  const ports = targets(node);
  const portIds = ports.map(port => port.port).join(",");
  useEffect(() => { updateNodeInternals(id); }, [id, data.collapsed, portIds, updateNodeInternals]);
  const detail =
    isStandaloneNode(node) ? `独立演出 · ${standaloneChapter(node)?.title ?? node.name}` : node.kind === "passage"
      ? (node.lines.find((l) => l.text)?.text ?? "空白段落")
      : node.kind === "condition"
        ? formatCondition(project, node.condition)
        : node.kind === "choice"
          ? node.prompt || `${node.choices.length} 个选项`
          : node.kind === "end"
            ? '返回标题界面'
            : node.kind === "set"
              ? (project.variables.find((v) => v.id === node.variableId)
                  ?.name ?? "未选择状态")
              : node.kind === "interaction"
                ? node.prompt || `${node.hotspots.length} 个互动区域`
                : node.kind === "minigame"
                  ? `${node.template === "password" ? "密码锁" : node.template === "custom" ? "自定义小游戏" : "限时点击"} · ${node.title}`
                  : nodeNames[node.kind];
  return (
    <div className={`graph-node ${node.kind} ${selected ? "selected" : ""} ${data.collapsed ? "collapsed" : ""}`}>
      {node.kind !== "start" && (
        <Handle type="target" position={Position.Left} id="in" />
      )}
      <div className="graph-node-title">
        {isStandaloneNode(node) ? <Clapperboard size={15} /> : node.kind === "passage" ? (
          <MessageSquare size={15} />
        ) : node.kind === "interaction" ? (
          <MousePointer2 size={15} />
        ) : node.kind === "minigame" ? (
          <Gamepad2 size={15} />
        ) : (
          <GitBranch size={15} />
        )}
        <strong>{node.name}</strong>
        <button className="node-collapse nodrag nopan" title={data.collapsed ? "展开节点" : "折叠节点"} aria-label={data.collapsed ? "展开节点" : "折叠节点"} onClick={event => { event.stopPropagation(); data.toggleCollapse(node.id); }}>{data.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
      </div>
      {!data.collapsed && <div className="graph-node-detail">{detail}</div>}
      {ports.map((port, i) => (
        <div className="graph-output" key={port.port}>
          <span>
            {node.kind === "choice"
              ? node.choices[i].text
              : node.kind === "interaction" && node.hotspots.some(hotspot => hotspot.id === port.port)
                ? node.hotspots.find(hotspot => hotspot.id === port.port)!.name || `区域 ${i + 1}`
              : port.port === "success"
                ? "成功"
              : port.port === "failure"
                ? "失败"
              : port.port === "cancel"
                ? "取消"
              : port.port === "timeout"
                ? "超时"
              : port.port === "yes"
                ? "满足"
                : port.port === "no"
                  ? "不满足"
                  : port.port === "target"
                    ? "前往"
                    : "继续"}
          </span>
          {port.target && project.nodes.find(target => target.id === port.target)?.sceneId !== node.sceneId && <button className="graph-external nodrag nopan" title={`进入 ${project.nodes.find(target => target.id === port.target)?.name ?? "目标"}`} onClick={event => { event.stopPropagation(); data.openLinkedNode(port.target!, node.id); }}><ExternalLink size={12} /></button>}
          <ArrowRight size={12} />
          <Handle
            type="source"
            position={Position.Right}
            id={port.port}
            style={{ top: (data.collapsed ? 54 : 79) + i * 29 }}
          />
        </div>
      ))}
    </div>
  );
}, (previous, next) => previous.data === next.data && previous.selected === next.selected);
const nodeTypes = { story: StoryGraphNode };


interface BlueprintProps {
  project: Project;
  sceneId: string;
  selectedNodeId?: string;
  commit: Commit;
  select: (id: string) => void;
  addNode: (kind: NodeKind) => void;
  openPassage: (id: string) => void;
  createSubgraph: () => void;
  openLinkedNode: (id: string, sourceId?: string) => void;
}

export function Blueprint(props: BlueprintProps) {
  return <ReactFlowProvider key={props.project.id}><StoryBlueprint {...props} /></ReactFlowProvider>;
}

function StoryBlueprint({ project, sceneId, selectedNodeId, commit, select, addNode, openPassage, createSubgraph, openLinkedNode }: BlueprintProps) {
  const sceneNodes = useMemo(
    () => project.nodes.filter((n) => n.sceneId === sceneId),
    [project.nodes, sceneId],
  );
  const { setNodes: setFlowNodes } = useReactFlow<StoryFlowNode, StudioEdge>();
  const clickedNode = useRef<string | undefined>(undefined);
  const openLinkedRef = useRef(openLinkedNode);
  openLinkedRef.current = openLinkedNode;
  const followLink = useCallback((id: string, sourceId?: string) => openLinkedRef.current(id, sourceId), []);
  const [search, setSearch] = useState("");
  const [arranging, setArranging] = useState(false);
  const [layoutError, setLayoutError] = useState('');
  const { selectedEdgeId, selectedEdgeIds, setSelectedEdgeId, setSelectedEdgeIds, onEdgesChange } = useBlueprintEdgeSelection<StoryFlowNode>(sceneId);
  const clearNodes = useCallback(() => setFlowNodes(previous => previous.map(node => node.selected ? { ...node, selected: false } : node)), [setFlowNodes]);
  const selectEdge = (id?: string) => { clearNodes(); setSelectedEdgeId(id); };
  const disconnectEdge = (id: string) => {
    commit('断开剧情连线', draft => { draft.nodes = draft.nodes.map(node => {
      const port = targets(node).find(port => `${node.id}:${port.port}` === id);
      return port ? connectNode(node, port.port) : node;
    }); });
    setSelectedEdgeIds(new Set([...selectedEdgeIds].filter(value => value !== id)));
  };
  const collapseKey = `vns:collapsed:${project.id}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(collapseKey) ?? "[]")); } catch { return new Set(); }
  });
  const toggleCollapse = useCallback((id: string) => setCollapsed(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; }), []);
  useEffect(() => { localStorage.setItem(collapseKey, JSON.stringify([...collapsed])); }, [collapsed, collapseKey]);
  useEffect(() => {
    setFlowNodes(previous => {
      const before = new Map(previous.map(node => [node.id, node]));
      return sceneNodes.map((story) => ({
        ...before.get(story.id),
        id: story.id,
        type: "story",
        position: { x: story.x, y: story.y },
        selected: before.get(story.id)?.selected ?? story.id === selectedNodeId,
        deletable: story.id !== project.entryId && story.kind !== 'start',
        data: { story, project, collapsed: collapsed.has(story.id), toggleCollapse, openLinkedNode: followLink },
        style: {
          opacity:
            !search ||
            `${story.name} ${story.kind === "passage" ? story.lines.map((l) => l.text).join(" ") : ""}`.includes(
              search,
            )
              ? 1
              : 0.3,
        },
      }));
    });
  }, [sceneNodes, project, search, collapsed, setFlowNodes, toggleCollapse, followLink]);
  useEffect(() => {
    if (clickedNode.current === selectedNodeId) { clickedNode.current = undefined; return; }
    setSelectedEdgeId();
    setFlowNodes(previous => previous.map(node => node.selected === (node.id === selectedNodeId) ? node : { ...node, selected: node.id === selectedNodeId }));
  }, [selectedNodeId, sceneId, setFlowNodes, setSelectedEdgeId]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"], .modal-backdrop')) { clearNodes(); setSelectedEdgeId(); }
    };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [clearNodes, setSelectedEdgeId]);
  const edges: StudioEdge[] = useMemo(
    () =>
      sceneNodes.flatMap((node) =>
        targets(node)
          .filter((p) => p.target && sceneNodes.some((n) => n.id === p.target))
          .map((port) => ({
            id: `${node.id}:${port.port}`,
            source: node.id,
            sourceHandle: port.port,
            target: port.target!,
            targetHandle: "in",
            type: 'studio' as const,
            selected: selectedEdgeIds.has(`${node.id}:${port.port}`),
            reconnectable: true,
            ariaLabel: `连线：${node.name} → ${sceneNodes.find(target => target.id === port.target)?.name}`,
            data: { label: `${node.name} → ${sceneNodes.find(target => target.id === port.target)?.name}`, disconnect: (id: string) => disconnectEdge(id), showLabel: selectedEdgeIds.size === 1 },
            style: { stroke: selectedEdgeIds.has(`${node.id}:${port.port}`) ? '#ffd38a' : '#7fbeb6', strokeWidth: selectedEdgeIds.has(`${node.id}:${port.port}`) ? 3 : 2 },
          })),
      ),
    [sceneNodes, selectedEdgeIds],
  );
  useEffect(() => { setSelectedEdgeIds(new Set([...selectedEdgeIds].filter(id => edges.some(edge => edge.id === id)))); }, [edges, selectedEdgeIds, setSelectedEdgeIds]);
  const arrange = async () => {
    if (arranging) return;
    setArranging(true);
    setLayoutError('');
    try {
      const result = await layoutBlueprint({
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.spacing.nodeNode": "50",
          "elk.layered.spacing.nodeNodeBetweenLayers": "85",
        },
        children: sceneNodes.map((n) => ({
          id: n.id,
          width: 242,
          height: (collapsed.has(n.id) ? 40 : 65) + targets(n).length * 29,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          sources: [e.source],
          targets: [e.target],
        })),
      });
      commit("自动布局", (p) => {
        for (const positioned of result.children ?? []) {
          const n = p.nodes.find((n) => n.id === positioned.id);
          if (n) {
            n.x = positioned.x ?? n.x;
            n.y = positioned.y ?? n.y;
          }
        }
      });
    } catch {
      setLayoutError('自动布局未完成，请稍后重试。');
    } finally {
      setArranging(false);
    }
  };
  return (
    <div className="blueprint-workspace">
      <div className="workspace-toolbar">
        <span>
          <GitBranch size={16} />
          剧情流程图
        </span>
        <div className="search compact">
          <Search size={14} />
          <input
            aria-label="搜索蓝图"
            placeholder="查找节点或对白"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="spacer" />
        <IconButton title="创建可复用段落" onClick={createSubgraph}><Workflow size={17} /></IconButton>
        <IconButton title={sceneNodes.every(n => collapsed.has(n.id)) ? "展开全部节点" : "折叠全部节点"} onClick={() => { const allCollapsed = sceneNodes.every(n => collapsed.has(n.id)); setCollapsed(previous => { const next = new Set(previous); for (const node of sceneNodes) allCollapsed ? next.delete(node.id) : next.add(node.id); return next; }); }}>{sceneNodes.every(n => collapsed.has(n.id)) ? <Maximize2 size={17} /> : <Minimize2 size={17} />}</IconButton>
        <IconButton title="自动布局" disabled={arranging} aria-busy={arranging} onClick={arrange}>
          <LayoutGrid size={17} className={arranging ? 'spin' : undefined} />
        </IconButton>
        <select
          aria-label="新建蓝图节点"
          value=""
          onChange={(e) => {
            if (e.target.value) addNode(e.target.value as NodeKind);
          }}
        >
          <option value="">添加节点</option>
          {Object.entries(nodeNames)
            .filter(([kind]) => kind !== "start")
            .map(([kind, name]) => (
              <option key={kind} value={kind}>
                {name}
              </option>
            ))}
        </select>
      </div>
      <div className="story-connections"><select aria-label="选择剧情连线" value={selectedEdgeId ?? ''} onChange={event => selectEdge(event.target.value || undefined)}><option value="">{selectedEdgeIds.size > 1 ? `已选中 ${selectedEdgeIds.size} 条连线` : `连线列表 · ${edges.length} 条`}</option>{edges.map(edge => <option key={edge.id} value={edge.id}>{edge.data?.label}</option>)}</select>{selectedEdgeIds.size > 0 && <button className="small-button" onClick={() => { commit('断开所选剧情连线', draft => { for (const edge of edges.filter(edge => selectedEdgeIds.has(edge.id))) draft.nodes = draft.nodes.map(node => node.id === edge.source ? connectNode(node, edge.sourceHandle ?? 'next') : node); }); setSelectedEdgeId(); }}><Unplug size={14} />断开选中连线</button>}<span>左键框选（碰到即选） · Ctrl 多选 · 中键平移 · Delete 删除</span></div>
      {layoutError && <p className="muted" role="alert">{layoutError}</p>}
      <div className="flow-container">
        <ReactFlow<StoryFlowNode, StudioEdge>
          defaultNodes={initialStoryNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={studioEdgeTypes}
          onNodeClick={(_, node) => { clickedNode.current = node.id !== selectedNodeId ? node.id : undefined; select(node.id); }}
          onPaneClick={() => { clearNodes(); setSelectedEdgeId(); }}
          onEdgeContextMenu={(event, edge) => { event.preventDefault(); selectEdge(edge.id); }}
          onEdgesChange={onEdgesChange}
          onReconnect={(oldEdge, connection) => { if (!connection.sourceHandle || !connection.target) return; commit('改接剧情连线', draft => {
            const source = draft.nodes.find(node => node.id === connection.source);
            if (!source || !targets(source).some(port => port.port === connection.sourceHandle) || draft.nodes.find(node => node.id === connection.target)?.kind === 'start') return;
            draft.nodes = draft.nodes.map(node => node.id === oldEdge.source ? connectNode(node, oldEdge.sourceHandle ?? 'next') : node);
            draft.nodes = draft.nodes.map(node => node.id === connection.source ? connectNode(node, connection.sourceHandle!, connection.target!) : node);
          }); setSelectedEdgeId(`${connection.source}:${connection.sourceHandle}`); }}
          onNodeDoubleClick={(_, node) => {
            if (node.data.story.kind === "passage") openPassage(node.id);
            else if ((node.data.story.kind === "call" || node.data.story.kind === "jump") && node.data.story.target) openLinkedNode(node.data.story.target);
          }}
          onNodeDragStop={(_, node, moved) =>
            commit("移动节点", (p) => {
              const positions = new Map((moved.length ? moved : [node]).map(item => [item.id, item.position]));
              for (const item of p.nodes) { const position = positions.get(item.id); if (position) { item.x = position.x; item.y = position.y; } }
            })
          }
          onConnect={(connection) => {
            if (
              connection.source &&
              connection.target &&
              connection.sourceHandle
            )
              commit("连接剧情", (p) => {
                p.nodes = p.nodes.map((n) =>
                  n.id === connection.source
                    ? connectNode(
                        n,
                        connection.sourceHandle!,
                        connection.target!,
                      )
                    : n,
                );
              });
          }}
          onDelete={({ nodes, edges }) => commit('删除剧情所选内容', draft => {
            for (const edge of edges) draft.nodes = draft.nodes.map(node => node.id === edge.source ? connectNode(node, edge.sourceHandle ?? 'next') : node);
            removeNodes(draft, nodes.filter(node => node.id !== draft.entryId && node.data.story.kind !== 'start').map(node => node.id));
          })}
          fitView
          fitViewOptions={{ padding: 0.1, minZoom: 0.8, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.6}
          reconnectRadius={18}
          connectionRadius={26}
          panOnDrag={[1, 2]}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="#cbd4d3" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => (node.selected ? "#1b8a78" : "#bacdc8")}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
