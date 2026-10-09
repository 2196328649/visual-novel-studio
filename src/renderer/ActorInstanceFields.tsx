import { useId } from 'react';
import { actorInstanceIds, actorLifetimes, type ShowActor } from '../core/actor-instance';
import type { Project } from '../core/model';

export function ActorLifetimeSelect({ value, onChange, label = '显示范围' }: { value?: ShowActor['lifetime']; onChange: (value?: ShowActor['lifetime']) => void; label?: string }) {
  return <select aria-label={label} value={value ?? ''} onChange={event => onChange((event.target.value || undefined) as ShowActor['lifetime'])}>
    {!value && <option value="">场景内（原行为）</option>}
    {Object.entries(actorLifetimes).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
  </select>;
}

export function ActorInstanceField({ project, characterId, value, onChange, label = '实例 ID' }: { project: Project; characterId?: string; value?: string; onChange: (value?: string) => void; label?: string }) {
  const id = useId(), valid = !value || /^[a-z][a-z0-9_]{0,63}$/.test(value);
  return <>
    <input aria-label={label} aria-invalid={!valid} value={value ?? ''} list={id} placeholder="留空使用角色默认实例" maxLength={64} onChange={event => onChange(event.target.value || undefined)} />
    <datalist id={id}>{actorInstanceIds(project, characterId).map(value => <option key={value} value={value} />)}</datalist>
    {!valid && <span className="error-text">使用小写字母开头的字母、数字或下划线，如 heroine_left。</span>}
  </>;
}
