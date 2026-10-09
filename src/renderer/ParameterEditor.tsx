import { NumberInput } from './NumberInput';
import { useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { VariableValue } from '../core/model';
import { IconButton } from './components';

type Parameters = Record<string, VariableValue>;
export function ParameterEditor({ value = {}, inherited = {}, onChange }: { value?: Parameters; inherited?: Parameters; onChange: (value: Parameters) => void }) {
  const entries = Object.entries({ ...inherited, ...value });
  return <div className="parameter-editor">
    {entries.map(([name, item]) => <ParameterRow key={name} name={name} value={item} local={Object.hasOwn(value, name)} inherited={Object.hasOwn(inherited, name)} names={entries.map(([key]) => key)} onRename={next => {
      const changed = { ...value };
      delete changed[name];
      changed[next] = item;
      onChange(changed);
    }} onChange={next => onChange({ ...value, [name]: next })} onRemove={() => { const changed = { ...value }; delete changed[name]; onChange(changed); }} />)}
    <button className="text-button" onClick={() => {
      let name = 'arg';
      for (let index = 2; entries.some(([key]) => key === name); index++) name = `arg_${index}`;
      onChange({ ...value, [name]: '' });
    }}><Plus size={14} />添加参数</button>
  </div>;
}

function ParameterRow({ name, value, local, inherited, names, onRename, onChange, onRemove }: {
  name: string; value: VariableValue; local: boolean; inherited: boolean; names: string[];
  onRename: (name: string) => void; onChange: (value: VariableValue) => void; onRemove: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState('');
  return <div className="parameter-row">
    <div className="field-row"><input aria-label={`参数名称 ${name}`} value={draft} disabled={inherited} onChange={event => setDraft(event.target.value)} onBlur={() => {
      const next = draft.trim();
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(next) || (next !== name && names.includes(next))) { setError('参数名需以英文字母开头，且不能重复'); return; }
      setError('');
      if (next !== name) onRename(next);
    }} /><select aria-label={`参数类型 ${name}`} value={typeof value} onChange={event => onChange(event.target.value === 'number' ? 0 : event.target.value === 'boolean' ? false : '')}><option value="string">文字</option><option value="number">数值</option><option value="boolean">开关</option></select></div>
    <div className="field-row">{typeof value === 'boolean' ? <label className="check-field"><input aria-label={`参数值 ${name}`} type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} />{value ? '是' : '否'}</label> : <NumberInput aria-label={`参数值 ${name}`} type={typeof value === 'number' ? 'number' : 'text'} step="any" value={value} onChange={event => { const next = typeof value === 'number' ? Number(event.target.value) : event.target.value; if (typeof next !== 'number' || Number.isFinite(next)) onChange(next); }} />}
      <IconButton title={inherited ? `恢复参数 ${name}` : `删除参数 ${name}`} disabled={!local} onClick={onRemove}>{inherited ? <RotateCcw size={14} /> : <Trash2 size={14} />}</IconButton>
    </div>{error && <span role="alert" className="danger-text">{error}</span>}
  </div>;
}
