import { memo, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { ArrowRight, ChevronDown, ChevronRight, Clapperboard, FileInput, Gamepad2, LayoutTemplate, Play, Power, Workflow } from 'lucide-react';
import type { GameFlowCanvasNode } from './game-flow-view';

export type GameFlowNode = Node<{ flow: GameFlowCanvasNode; collapsed: boolean; toggleCollapse: (id: string) => void; invalid: boolean }, 'gameFlow'>;

export const GameFlowGraphNode = memo(function GameFlowGraphNode({ id, data, selected }: NodeProps<GameFlowNode>) {
  const { flow, collapsed } = data;
  const updateInternals = useUpdateNodeInternals();
  const ports = flow.ports.map(p => p.id).join(',');
  useEffect(() => { updateInternals(id); }, [id, collapsed, ports, updateInternals]);
  const Icon = flow.kind === 'launch' ? Power : ['title', 'page', 'pageReference', 'pageEvents'].includes(flow.kind) ? LayoutTemplate : flow.kind === 'newGame' ? Gamepad2 : flow.kind === 'load' ? FileInput : flow.kind === 'video' ? Play : flow.kind === 'blueprint' ? Clapperboard : Workflow;
  return <div className={`graph-node game-flow-node ${flow.kind} ${selected ? 'selected' : ''} ${collapsed ? 'collapsed' : ''} ${data.invalid ? 'invalid' : ''}`}>
    {flow.kind !== 'pageEvents' && <Handle type="target" position={Position.Left} id="in" isConnectable={flow.inputEditable} />}
    <div className="graph-node-title"><Icon size={15} /><strong title={flow.name}>{flow.name}</strong>
      <button className="node-collapse nodrag nopan" title={collapsed ? '展开节点' : '折叠节点'} aria-label={collapsed ? '展开节点' : '折叠节点'} onClick={e => { e.stopPropagation(); data.toggleCollapse(id); }}>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
    </div>
    {!collapsed && <div className="graph-node-detail" title={flow.detail}>{flow.detail}</div>}
    {flow.ports.map(port => <div className={'graph-output' + (port.editable ? '' : ' runtime-output')} title={port.hint} key={port.id}><span>{port.label}</span><ArrowRight size={12} /><Handle type="source" position={Position.Right} id={port.id} isConnectable={port.editable} style={{ top: '50%' }} /></div>)}
  </div>;
});
