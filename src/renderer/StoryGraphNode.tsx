import { memo, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { ArrowRight, GitBranch, MessageSquare, Clapperboard, ChevronDown, ChevronRight, ExternalLink, MousePointer2, Gamepad2 } from 'lucide-react';
import { targets, type Project, type StoryNode } from '../core/model';
import { formatCondition, nodeNames } from './editor';
import { isStandaloneNode, standaloneChapter } from '../core/standalone-performance';
import { storyNodeReturnsTitle, storyPortLabel } from '../core/story-graph';

export type StoryFlowNode = Node<{ story: StoryNode; project: Project; collapsed: boolean; issueCount?: number; toggleCollapse: (id: string) => void; openLinkedNode: (id: string, sourceId?: string) => void }, "story">;
export const StoryGraphNode = memo(function StoryGraphNode({ id, data, selected }: NodeProps<StoryFlowNode>) {
  const { story: node, project } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  const ports = storyNodeReturnsTitle(node, project) ? [{ port: "returnTitle", target: undefined }] : node.kind === 'return' ? [{ port: 'returnCall', target: undefined }] : targets(node);
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
      <Handle type="target" position={Position.Left} id="in" isConnectable={node.kind !== 'start'} />
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
      <div className="story-node-meta"><span>{nodeNames[node.kind]}</span>{node.id === project.entryId && <span className="entry">故事入口</span>}{!!data.issueCount && <span className="warning">{data.issueCount} 个问题</span>}</div>
      {!data.collapsed && <div className="graph-node-detail">{detail}</div>}
      {ports.map((port, i) => (
        <div className="graph-output" key={port.port}>
          <span>
            {storyPortLabel(node, port.port)}
          </span>
          {port.target && project.nodes.find(target => target.id === port.target)?.sceneId !== node.sceneId && <button className="graph-external nodrag nopan" title={`进入 ${project.nodes.find(target => target.id === port.target)?.name ?? "目标"}`} onClick={event => { event.stopPropagation(); data.openLinkedNode(port.target!, node.id); }}><ExternalLink size={12} /></button>}
          <ArrowRight size={12} />
          <Handle
            type="source"
            position={Position.Right}
            id={port.port}
            isConnectable={!['returnTitle', 'returnCall'].includes(port.port)}
            style={{ top: '50%' }}
          />
        </div>
      ))}
    </div>
  );
}, (previous, next) => previous.data === next.data && previous.selected === next.selected);
