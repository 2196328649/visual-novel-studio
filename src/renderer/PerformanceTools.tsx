import { GraphResourceOptions } from './GraphResourceOptions';
import { projectGraphs, withProjectGraphs } from '../core/project-resources';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { BlueprintGraph, BlueprintPin, Project, StageAction } from '../core/model';
import { availablePerformanceBlueprints, blueprintFromPerformance, blueprintGroup, exposePerformanceInputs, performanceInputs } from '../core/blueprint-authoring';
import { BlueprintCallFields, BlueprintParameterValue } from './BlueprintCallFields';
import { ActionEditor, newAction } from './Inspector';
import { actionNames } from './editor';
import { Field } from './components';
import type { AssetUrl } from './StageEditor';
import './performance-tools.css';

export function EncapsulatePerformance({ project, actions, assetUrl, onClose, onCreate, timeline = false }: { project: Project; actions: StageAction[]; assetUrl: AssetUrl; onClose: () => void; onCreate: (graph: BlueprintGraph, group: string) => void; timeline?: boolean }) {
  const graph = useMemo(() => blueprintFromPerformance(project, actions), [project, actions]);
  const [name, setName] = useState(actions.some(action => action.kind === 'chapter') ? '章节入场' : '新的演出');
  const [group, setGroup] = useState('演出');
  const [parameters, setParameters] = useState(() => {
    const names = new Map<string, number>();
    return performanceInputs(graph).filter(input => !timeline || (input.pinId !== 'wait' && graph.nodes.find(node => node.id === input.nodeId)?.type !== 'delay')).map(input => { const count = (names.get(input.name) ?? 0) + 1; names.set(input.name, count); return { ...input, name: input.name + (count > 1 ? ` ${count}` : ''), enabled: true }; });
  });
  const [error, setError] = useState('');
  const create = () => {
    try {
      if (!name.trim()) throw new Error('请填写蓝图名称。');
      const next = structuredClone(graph); next.name = name.trim();
      for (const input of parameters) {
        const node = next.nodes.find(node => node.id === input.nodeId);
        if (node) node.properties[input.pinId] = input.defaultValue;
      }
      exposePerformanceInputs(next, parameters.filter(input => input.enabled));
      onCreate(next, group);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return createPortal(<div className="modal-backdrop" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') onClose(); }}><section className="performance-dialog" role="dialog" aria-modal="true" aria-label="封装演出为蓝图"><header><strong>封装演出为蓝图</strong><button className="icon-button" aria-label="关闭封装" onClick={onClose}><X size={17} /></button></header><div className="performance-dialog-body"><div className="field-row"><Field label="蓝图名称"><input aria-label="蓝图名称" autoFocus maxLength={120} value={name} onChange={event => setName(event.target.value)} /></Field><Field label="资源分组" hint="使用 / 嵌套分组，与资源管理器文件夹同步。"><input aria-label="资源分组" list="performance-groups" value={group} onChange={event => setGroup(event.target.value)} placeholder="演出 / 章节 / 入场" /><datalist id="performance-groups">{[...new Set(projectGraphs(project).map(graph => blueprintGroup(project, graph.id)).filter(Boolean))].map(path => <option key={path} value={path} />)}</datalist></Field></div><p>已选 {actions.length} 个演出。勾选的参数可在每次调用时单独填写，未填写时使用下方默认值。</p><div className="performance-parameters">{parameters.map((parameter, index) => {
    const parameterGraph = structuredClone(graph); exposePerformanceInputs(parameterGraph, [{ ...parameter, name: '参数' }]);
    const pin: BlueprintPin = { ...parameterGraph.exposedInputs[0], name: parameter.name };
    return <div className="performance-parameter" key={`${parameter.nodeId}/${parameter.pinId}`}><label><input type="checkbox" aria-label={`公开${parameter.name}`} checked={parameter.enabled} onChange={event => setParameters(current => current.map((input, i) => i === index ? { ...input, enabled: event.target.checked } : input))} />公开输入</label><input aria-label={`输入名称 ${index + 1}`} maxLength={120} value={parameter.name} disabled={!parameter.enabled} onChange={event => setParameters(current => current.map((input, i) => i === index ? { ...input, name: event.target.value } : input))} /><BlueprintParameterValue project={project} graph={parameterGraph} pin={pin} value={parameter.defaultValue} assetUrl={assetUrl} label={`${parameter.name}默认值`} onChange={value => setParameters(current => current.map((input, i) => i === index ? { ...input, defaultValue: value } : input))} /></div>;
  })}</div>{!parameters.length && <p>这组演出保留完整设置；可进入蓝图继续修改或添加输入。</p>}{error && <p role="alert" className="performance-error">{error}</p>}</div><footer><button onClick={onClose}>取消</button><button className="primary" onClick={create}>封装并替换选中演出</button></footer></section></div>, document.body);
}

export function BatchPerformance({ project, selectedIds, assetUrl, onClose, onApply }: { project: Project; selectedIds?: Set<string>; assetUrl: AssetUrl; onClose: () => void; onApply: (action: StageAction, includeNarration: boolean, graph?: BlueprintGraph) => void }) {
  const graphs = useMemo(() => availablePerformanceBlueprints(project), [project]);
  const choices = useMemo(() => (withProjectGraphs({ ...project }, graphs)), [project, graphs]);
  const [includeNarration, setIncludeNarration] = useState(false);
  const [action, setAction] = useState<StageAction>(() => newAction('show', project)!);
  const lines = project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).filter(line => !line.silent && (!selectedIds || selectedIds.has(line.id)) && (includeNarration || line.speakerId));
  const affected = lines.filter(line => !line.actions.some(existing => action.kind === 'blueprint' && existing.kind === 'blueprint' ? existing.blueprintId === action.blueprintId : JSON.stringify(existing) === JSON.stringify(action))).length;
  return createPortal(<div className="modal-backdrop" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') onClose(); }}><section className="performance-dialog compact" role="dialog" aria-modal="true" aria-label="批量添加演出"><header><strong>{selectedIds ? '为选中台词添加演出' : '为全部台词添加演出'}</strong><button className="icon-button" aria-label="关闭批量演出" onClick={onClose}><X size={17} /></button></header><div className="performance-dialog-body"><Field label="演出类型"><select aria-label="批量演出类型" value={action.kind} onChange={event => { const next = newAction(event.target.value as StageAction['kind'], choices); if (next) setAction(next); }}>{Object.entries(actionNames).filter(([kind]) => newAction(kind as StageAction['kind'], choices)).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select></Field>{action.kind === 'blueprint' ? <><Field label="蓝图 / 时间轴预设"><select aria-label="批量演出蓝图" value={action.blueprintId} onChange={event => setAction({ kind: 'blueprint', blueprintId: event.target.value })}><GraphResourceOptions project={project} graphs={graphs} paths /></select></Field><BlueprintCallFields project={choices} graph={graphs.find(graph => graph.id === action.blueprintId)} inputs={action.inputs} onChange={inputs => setAction({ ...action, inputs })} assetUrl={assetUrl} /></> : <ActionEditor project={choices} action={action} onChange={setAction} assetUrl={assetUrl} />}<label className="performance-narration"><input type="checkbox" checked={includeNarration} onChange={event => setIncludeNarration(event.target.checked)} />包含旁白</label><p>将为 {affected} 句台词添加演出。已有相同演出的台词会跳过，保留逐句设置。</p></div><footer><button onClick={onClose}>取消</button><button className="primary" disabled={!affected} onClick={() => onApply(action, includeNarration, action.kind === 'blueprint' ? graphs.find(graph => graph.id === action.blueprintId) : undefined)}>添加到 {affected} 句台词</button></footer></section></div>, document.body);
}
