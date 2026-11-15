import type { Condition, Project } from '../core/model';
import { conditionParameterIds } from '../core/gallery';
import { ConditionEditor, Field } from './components';

export function GalleryUnlockFields({ project, condition, onChange, label = '解锁条件', inherited = false, inheritedLabel = '沿用分组条件' }: { project: Project; condition?: Condition; onChange: (condition?: Condition, options?: { separate?: boolean }) => void; label?: string; inherited?: boolean; inheritedLabel?: string }) {
  const first = project.variables.find(variable => variable.persistent) ?? project.variables[0];
  const local = condition ? conditionParameterIds(condition).map(id => project.variables.find(variable => variable.id === id)).filter(variable => variable && !variable.persistent) : [];
  return <div className="gallery-unlock-fields" aria-label={label}>
    <Field label={label}><select aria-label={label + '方式'} value={condition ? 'parameter' : 'seen'} onChange={event => onChange(event.target.value === 'parameter' && first ? { kind: 'compare', variableId: first.id, operator: first.type === 'number' ? 'gte' : 'eq', value: first.initial } : undefined, { separate: true })}><option value="seen">{inherited ? inheritedLabel : '剧情中显示后解锁'}</option><option value="parameter" disabled={!first}>参数条件</option></select></Field>
    {!condition && !inherited && <p className="muted">游戏按素材 ID 记录显示：剧情的背景或角色显示指令使用这张图片后解锁。只导入素材或编辑器预览不会解锁。</p>}
    {condition && <ConditionEditor project={project} condition={condition} onChange={onChange} groupBySet />}
    {!!local.length && <p className="muted" role="status">{local.map(variable => variable!.name).join('、')}：随存档保存。跨周目解锁需将变量的保存方式设为“保存在本机”。</p>}
  </div>;
}
