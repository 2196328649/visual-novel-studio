import type { Condition, Project } from '../core/model';
import { conditionParameterIds } from '../core/gallery';
import { ConditionEditor, Field } from './components';

export function GalleryUnlockFields({ project, condition, onChange, label = '解锁条件', inherited = false }: { project: Project; condition?: Condition; onChange: (condition?: Condition) => void; label?: string; inherited?: boolean }) {
  const first = project.variables.find(variable => variable.persistent) ?? project.variables[0];
  const local = condition ? conditionParameterIds(condition).map(id => project.variables.find(variable => variable.id === id)).filter(variable => variable && !variable.persistent) : [];
  return <div className="gallery-unlock-fields" aria-label={label}>
    <Field label={label}><select aria-label={label + '方式'} value={condition ? 'parameter' : 'seen'} onChange={event => onChange(event.target.value === 'parameter' && first ? { kind: 'compare', variableId: first.id, operator: first.type === 'number' ? 'gte' : 'eq', value: first.initial } : undefined)}><option value="seen">{inherited ? '沿用分组条件' : '剧情中显示后解锁'}</option><option value="parameter" disabled={!first}>参数条件</option></select></Field>
    {!condition && !inherited && <p className="muted">游戏按素材 ID 记录显示：剧情的背景或角色显示指令使用这张图片后解锁。只导入素材或编辑器预览不会解锁。</p>}
    {condition && <ConditionEditor project={project} condition={condition} onChange={onChange} groupBySet />}
    {!!local.length && <p className="muted" role="status">{local.map(variable => variable!.name).join('、')}：随剧情存档。跨周目解锁需在参数集中开启“本地持久化”。</p>}
  </div>;
}
