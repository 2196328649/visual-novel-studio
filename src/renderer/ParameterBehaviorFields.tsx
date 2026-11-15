import type { ParameterDefaults } from '../core/model';
import './parameter-behavior.css';

/** Storage and reset are independent policies, shared by every parameter entry. */
export function ParameterBehaviorFields({ value, onChange, storageReadOnly = false, compact = false, labelPrefix = '' }: {
  value: ParameterDefaults;
  onChange: (value: ParameterDefaults) => void;
  storageReadOnly?: boolean;
  compact?: boolean;
  labelPrefix?: string;
}) {
  return <div className={`parameter-behavior-fields${compact ? ' is-compact' : ''}`} role="group" aria-label={`${labelPrefix}保存与恢复`}>
    <label className="parameter-behavior-row"><span>保存方式</span>
      {storageReadOnly
        ? <output aria-label={`${labelPrefix}保存方式`}>{value.persistent ? '保存在本机' : '随存档保存'}</output>
        : <select aria-label={`${labelPrefix}保存方式`} value={value.persistent ? 'local' : 'save'} onChange={event => onChange({ ...value, persistent: event.target.value === 'local' })}>
          <option value="save">随存档保存</option><option value="local">保存在本机</option>
        </select>}
    </label>
    <details className="parameter-behavior-reset">
      <summary>恢复初始设置<span>{value.resetWithSettings ? '参与' : '不参与'}</span></summary>
      <label className="parameter-behavior-checkbox"><input type="checkbox" aria-label={`${labelPrefix}参与恢复初始设置`} checked={value.resetWithSettings} onChange={event => onChange({ ...value, resetWithSettings: event.target.checked })} />参与恢复初始设置</label>
      <p>玩家执行“恢复初始设置”时，将这个参数恢复为初始值。此选项不改变保存方式。</p>
    </details>
  </div>;
}
