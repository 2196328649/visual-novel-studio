import { useId } from 'react';
import { actorInstanceIds, actorInstanceLabel, actorInstanceNumber, actorInstanceProblem, actorLifetimes, type ShowActor } from '../core/actor-instance';
import type { Project } from '../core/model';
import { NumberInput } from './NumberInput';

// Renderer projects are immutable snapshots. Reuse suggestions across the
// inspector and all node cards; core allocation still reads mutable drafts.
const instanceSuggestions = new WeakMap<Project, Map<string, string[]>>();
function suggestions(project: Project, characterId?: string) {
  let byCharacter = instanceSuggestions.get(project);
  if (!byCharacter) { byCharacter = new Map(); instanceSuggestions.set(project, byCharacter); }
  const key = characterId || '';
  let values = byCharacter.get(key);
  if (!values) { values = actorInstanceIds(project, characterId || undefined); byCharacter.set(key, values); }
  return values;
}

export function ActorLifetimeSelect({ value, onChange, label = '显示范围' }: { value?: ShowActor['lifetime']; onChange: (value?: ShowActor['lifetime']) => void; label?: string }) {
  return <select aria-label={label} value={value ?? ''} onChange={event => onChange((event.target.value || undefined) as ShowActor['lifetime'])}>
    {!value && <option value="">场景内（原行为）</option>}
    {Object.entries(actorLifetimes).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
  </select>;
}

export function ActorInstanceField({ project, characterId, value, onChange, label = '第几个' }: { project: Project; characterId?: string; value?: string; onChange: (value?: string) => void; label?: string }) {
  const id = useId(), number = actorInstanceNumber(value);
  const invalid = !!actorInstanceProblem(value);
  const references = [...new Set([...suggestions(project, characterId), ...(value ? [value] : [])])];
  const legacyIds = references.filter(reference => actorInstanceNumber(reference) === undefined);
  const numbered = number !== undefined;
  return <span className="actor-instance-field" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0, width: '100%' }}>
    {numbered && <NumberInput aria-label={label} title="填写从1开始的整数。同一角色按固定编号区分；隐藏一个后，其余编号不变。" value={number} step={1} list={id} style={{ flex: '1 1 64px', minWidth: 0 }} onChange={event => {
      const next = event.target.valueAsNumber;
      if (Number.isSafeInteger(next) && next >= 1) onChange(next === 1 ? undefined : String(next));
    }} />}
    <datalist id={id}>{references.filter(reference => actorInstanceNumber(reference) !== undefined).map(reference => <option key={reference} value={actorInstanceNumber(reference)}>{actorInstanceLabel(reference)}</option>)}</datalist>
    {!!legacyIds.length && <select aria-label={numbered ? `${label} · 旧实例兼容` : label} aria-invalid={invalid || undefined} title="旧实例保留原有名称；也可改用固定编号。" value={numbered ? '' : value} style={{ flex: '1 1 126px', minWidth: 0 }} onChange={event => onChange(event.target.value || undefined)}>
      <option value="">{numbered ? '旧实例兼容…' : '按编号 · 第1个'}</option>
      {legacyIds.map(reference => <option key={reference} value={reference} disabled={invalid && reference === value}>{invalid && reference === value ? `原值不可用：${reference}` : actorInstanceLabel(reference)}</option>)}
    </select>}
  </span>;
}
