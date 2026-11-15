import { memo, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, ChevronRight, Folder, FolderOpen, Gamepad2, AlertCircle, Flag } from 'lucide-react';
import type { StoryContainerView } from '../core/story-graph';

export type StoryContainerNode = Node<{ container: StoryContainerView; enter: (id: string) => void }, 'storyContainer'>;

export const StoryContainerGraphNode = memo(function StoryContainerGraphNode({ id, data, selected }: NodeProps<StoryContainerNode>) {
  const card = data.container, update = useUpdateNodeInternals();
  const ports = card.inputs.map(port => port.id).join(',') + '/' + card.outputs.map(port => port.id).join(',');
  useEffect(() => { update(id); }, [id, ports, update]);
  const reference = !['content', 'scene', 'group'].includes(card.kind);
  const Icon = card.kind === 'content' ? Gamepad2 : card.kind === 'scene' ? FolderOpen : card.kind === 'group' ? Folder : card.kind === 'input' ? ArrowDownToLine : ArrowUpRight;
  return <div className={`graph-node story-container-node ${card.kind} ${selected ? 'selected' : ''} ${reference ? 'story-reference' : ''}`}>
    <div className="graph-node-title"><Icon size={17} /><strong title={card.name}>{card.name}</strong>
      {(card.scope || card.targetNodeId) && <button className="node-collapse nodrag nopan" title={'进入 ' + card.name} aria-label={'进入 ' + card.name} onClick={event => { event.stopPropagation(); data.enter(id); }}><ChevronRight size={16} /></button>}
    </div>
    <div className="story-container-detail" title={card.detail}>{card.detail}</div>
    {!reference && <div className="story-container-badges">
      <span>{card.nodeIds.size} 个节点</span>{card.containsEntry && <span className="entry"><Flag size={11} />含故事入口</span>}
      {card.issues.length > 0 && <span className="warning"><AlertCircle size={11} />{card.issues.length} 个问题</span>}
    </div>}
    {Array.from({ length: Math.max(card.inputs.length, card.outputs.length) }, (_, i) => <div className="story-container-ports" key={i}>
      <div className="story-container-port input">{card.inputs[i] && <><Handle type="target" position={Position.Left} id={card.inputs[i].id} isConnectable={!card.inputs[i].readonly} /><span title={card.inputs[i].label}>{card.inputs[i].label}</span></>}</div>
      <div className="story-container-port output">{card.outputs[i] && <><span title={card.outputs[i].label}>{card.outputs[i].label}</span><ArrowRight size={11} /><Handle type="source" position={Position.Right} id={card.outputs[i].id} isConnectable={!card.outputs[i].readonly} /></>}</div>
    </div>)}
  </div>;
});
