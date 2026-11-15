import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ParameterDefaults, Project } from '../core/model';
import { parameterNameProblem, parameterSets } from '../core/parameter-sets';
import { ParameterBehaviorFields } from './ParameterBehaviorFields';

function nextSetName(project: Project) {
  const names = new Set(parameterSets(project).map(set => set.name));
  let name = '新参数集', suffix = 2;
  while (names.has(name)) name = `新参数集 ${suffix++}`;
  return name;
}

export function ParameterSetCreateDialog({ project, close, create }: {
  project: Project;
  close: () => void;
  create: (name: string, defaults: ParameterDefaults) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  const [name, setName] = useState(() => nextSetName(project));
  const [defaults, setDefaults] = useState<ParameterDefaults>({ persistent: false, resetWithSettings: false });
  const [error, setError] = useState<string>();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector('input')?.select();
    return () => {
      element?.close();
      requestAnimationFrame(() => { if (previous.current?.isConnected) previous.current.focus({ preventScroll: true }); });
    };
  }, []);
  const submit = () => {
    const problem = parameterNameProblem(project, name, undefined, 'set');
    if (problem) { setError(problem); return; }
    try { create(name.trim(), defaults); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  return createPortal(<dialog ref={dialog} className="dialog parameter-set-create-dialog" aria-label="新建参数集"
    onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === 'Enter') event.preventDefault(); return; }
      if (['F5', 'F6'].includes(event.key) || (event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault();
    }}>
    <form onSubmit={event => { event.preventDefault(); submit(); }}>
      <h2>新建参数集</h2>
      <p className="parameter-help">参数集用于整理变量，可用于剧情、蓝图或界面。</p>
      <label className="parameter-inline-field"><span>名称</span><input aria-label="参数集名称" autoFocus maxLength={120} value={name} aria-invalid={!!error} onChange={event => { setName(event.target.value); setError(undefined); }} /></label>
      {error && <p className="parameter-form-error" role="alert">{error}</p>}
      <section><h3>新参数默认配置</h3><ParameterBehaviorFields value={defaults} onChange={setDefaults} labelPrefix="新参数默认" compact />
        <p className="parameter-help">之后在此分组新建的参数沿用这些配置，每个参数都能单独修改。</p>
      </section>
      <footer><button type="button" onClick={close}>取消</button><button type="submit" className="primary">创建参数集</button></footer>
    </form>
  </dialog>, document.body);
}
