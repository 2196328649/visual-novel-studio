import type { Project, VariableValue } from '../core/model';
import { uiPageInterface, uiPageInterfaceKnown, uiPageParameterDefault, validUiPageParameterValue } from '../core/ui-page-interface';
import { BlueprintValueInput } from './BlueprintValueInput';
import './blueprint-page-interface.css';

/** Presence is distinct from a default. Never turn a displayed zero into an absent argument. */
export function UiPageArgumentsEditor({ project, pageId, values = {}, onChange, label = '页面输入' }: {
  project: Project; pageId: string; values?: Record<string, VariableValue>;
  onChange: (values: Record<string, VariableValue>) => void; label?: string;
}) {
  const definition = uiPageInterface(project, pageId);
  if (!uiPageInterfaceKnown(definition)) return <p role="alert">页面接口版本不受支持；先到页面接口面板恢复，旧实参保持不变。</p>;
  const remove = (id: string) => { const next = { ...values }; delete next[id]; onChange(next); };
  const old = Object.entries(values).filter(([id]) => !definition?.inputs.some(parameter => parameter.id === id));
  if (!definition?.inputs.length && !old.length) return null;
  return <fieldset className="ui-page-arguments" aria-label={label}><legend>{label}</legend>
    {(definition?.inputs ?? []).map(parameter => {
      const supplied = Object.hasOwn(values, parameter.id);
      return <div className="ui-page-argument" key={parameter.id} data-page-argument-id={parameter.id}>
        <label className="game-flow-check"><input type="checkbox" aria-label={label + ' · 提供 ' + parameter.name} checked={supplied} onChange={event => event.target.checked ? onChange({ ...values, [parameter.id]: uiPageParameterDefault(parameter) }) : remove(parameter.id)} />{parameter.name}{parameter.required ? '（必填）' : ''}</label>
        {supplied ? <BlueprintValueInput project={project} type={parameter.dataType} label={label + ' ' + parameter.name} value={values[parameter.id]} onChange={value => value === undefined ? remove(parameter.id) : onChange({ ...values, [parameter.id]: value })} /> : <p className="muted">{parameter.defaultValue !== undefined ? '未提供：沿用接口默认值。' : parameter.required ? '未提供：此输入必填且没有默认值。' : '未提供：使用该类型的初始值。'}</p>}
        {supplied && !validUiPageParameterValue(parameter.dataType, values[parameter.id]) && <p role="alert">旧实参类型不匹配，原值保留为 {JSON.stringify(values[parameter.id])}；请重新填写或取消提供。</p>}
      </div>;
    })}
    {!!old.length && <div className="ui-page-stale-arguments"><p className="muted">{definition ? '以下旧实参已无接口定义。未自动删除，请明确移除后再运行。' : '这是未声明接口的历史命名输入，仍按旧协议传递。'}</p>{old.map(([id, value]) => <p key={id}><code>{id}</code> = {JSON.stringify(value)} <button type="button" aria-label={label + ' · 移除旧实参 ' + id} onClick={() => remove(id)}>移除</button></p>)}</div>}
  </fieldset>;
}
