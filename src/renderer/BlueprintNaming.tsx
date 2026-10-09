import { useEffect, useState } from 'react';
import type { BlueprintGraph, Project } from '../core/model';
import { blueprintCallName, renameBlueprint } from '../core/blueprint-names';
import type { Commit } from './editor';
import { Field } from './components';

export function BlueprintNameField({ project, graph, mode, commit, message }: { project: Project; graph: BlueprintGraph; mode: 'name' | 'callName'; commit: Commit; message: (text: string) => void }) {
  const resourceType = graph.timelineComponent || graph.timeline ? '时间轴预设' : '蓝图';
  const nameLabel = resourceType + '名称';
  const saved = graph[mode] ?? '', [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved, graph.id]);
  const apply = () => {
    if (value === saved) return;
    try {
      renameBlueprint(structuredClone(project), graph.id, { [mode]: value });
      commit(mode === 'name' ? '修改' + nameLabel : '修改' + resourceType + '调用名', draft => renameBlueprint(draft, graph.id, { [mode]: value }));
      message('名称已更新，已有指令同步替换。Ctrl+Z 可一起撤销。');
    } catch (error) { message(error instanceof Error ? error.message : String(error)); setValue(saved); }
  };
  return <Field label={mode === 'name' ? nameLabel : '调用名称'} hint={mode === 'callName' ? `留空时跟随资源名称；在文本中输入 @${blueprintCallName(graph)}` : undefined}><input aria-label={mode === 'name' ? nameLabel : resourceType + '调用名称'} maxLength={120} value={value} placeholder={mode === 'callName' ? graph.name : undefined} onChange={event => setValue(event.target.value)} onBlur={apply} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setValue(saved); }} /></Field>;
}

export function BlueprintRenameDialog({ project, graph, mode, onApply, onClose }: { project: Project; graph: BlueprintGraph; mode: 'name' | 'callName'; onApply: (project: Project) => void; onClose: () => void }) {
  const nameLabel = graph.timelineComponent || graph.timeline ? '时间轴预设名称' : '蓝图名称';
  const title = mode === 'name' ? '修改' + nameLabel : '修改调用名称';
  const [value, setValue] = useState(mode === 'name' ? graph.name : graph.callName ?? '');
  const [error, setError] = useState('');
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><form className="modal blueprint-rename-dialog" role="dialog" aria-label={title} onSubmit={event => { event.preventDefault(); try { const next = structuredClone(project); renameBlueprint(next, graph.id, { [mode]: value }); onApply(next); onClose(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } }} onKeyDown={event => { if (event.key === 'Escape') onClose(); }}><h3>{title}</h3><p>已有的文本指令、演出和蓝图调用会同步更新，可以一起撤销。</p><Field label={mode === 'name' ? nameLabel : '调用名称'} hint={mode === 'callName' ? '留空时使用资源名称。' : undefined}><input autoFocus maxLength={120} value={value} placeholder={graph.name} onChange={event => setValue(event.target.value)} /></Field>{error && <p role="alert">{error}</p>}<footer><button type="button" className="small-button" onClick={onClose}>取消</button><button type="submit" className="primary-button">修改并替换调用</button></footer></form></div>;
}
