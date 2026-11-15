import { uiSpineEvents } from '../core/ui-spine';
import { uiVideoEvents } from '../core/ui-video';
import { uiImageEvents } from '../core/ui-image';
import type { Project, UiComponent } from '../core/model';
import { uiProperties, uiPropertyApplies, uiPropertySources, uiOperations, uiOperationApplies, type UiProperty } from '../core/ui-properties';
import { uiControlValueType, uiTextInput } from '../core/ui-control-events';
import { uiPropertyControlFor, uiPropertyControlSourceProblem } from '../core/ui-property-control';

/** The same capability definitions used by graph fields and runtime validation. */
export function UiPropertyCapabilities({ project, component, embedded = false }: { project: Project; component: UiComponent; embedded?: boolean }) {
  const properties = (Object.entries(uiProperties) as [UiProperty, (typeof uiProperties)[UiProperty]][]).filter(([property]) => uiPropertyApplies(component, property, project));
  const valueType = uiControlValueType(project, component);
  const content = <>
    <p className="muted ui-field-help">默认设置允许蓝图覆盖当前页面实例；单向跟随只从参数读取，双向同步会将蓝图或玩家改动写回参数。每项独立设置，重置不解除参数关联；只读项不能写入或重置。</p>
    <p className="ui-field-help">事件：显示{component.kind === 'button' ? '、点击、悬停、离开、按下、释放' : ''}{component.kind === 'image' ? '、' + Object.values(uiImageEvents).join('、') : ''}{component.kind === 'spine' ? '、' + Object.values(uiSpineEvents).join('、') : ''}{component.kind === 'video' ? '、' + Object.values(uiVideoEvents).join('、') : ''}{valueType ? '、用户值改变' : ''}{uiTextInput(project, component) ? '、文字提交' : ''}。程序赋值不触发用户值改变。</p>
    <p className="ui-field-help" aria-label="控件蓝图操作">操作：{uiOperations.filter(operation=>uiOperationApplies(project,component,operation.id)).map(operation=>operation.name).join('、')}。</p>
    <dl>{properties.map(([property, info]) => {
      const target = uiPropertyControlFor(project, component, property), following = target?.control.mode === 'follow';
      const parameter = target && project.variables.find(item => item.id === target.control.parameterId);
      const problem = target && uiPropertyControlSourceProblem(project, component, property, target.control);
      return <div key={property} data-ui-property-capability={property}>
        <dt>{info.name}<span>{problem ? '来源待修复' : !info.writable ? '只读' : following ? '读取 / 单项重置 · 参数控制' : target ? '读 / 写回参数 / 单项重置' : '读 / 写 / 单项重置'}</span></dt>
        <dd>{[info.unit, info.min !== undefined || info.max !== undefined ? '范围：' + (info.min ?? '不限') + '～' + (info.max ?? '不限') : undefined, info.resource ? '引用素材：' + info.resource : undefined, info.animated ? following ? '动画受参数控制限制' : target ? '动画写回参数' : '可动画' : undefined].filter(Boolean).join(' · ')}</dd>
        <dd>{problem ? '原参数关联已保留，请在此属性的右键菜单中修复来源或恢复默认设置。' : target ? `${following ? '单向跟随' : '双向同步'}参数“${parameter?.name ?? target.control.parameterId}”。${following ? '蓝图不能直接写入此属性；需要改变时请修改来源参数。' : '蓝图和玩家对这一项的改动写回参数，共享此参数的属性随之更新。'}重置保留关联与参数值。` : uiPropertySources(component, property).join(' → ')}</dd>
        {problem && <dd role="status">{problem}</dd>}
        {info.description && <dd>{info.description}</dd>}
      </div>;
    })}</dl>
  </>;
  return embedded ? <div className="ui-blueprint-capabilities" aria-label="控件蓝图能力">{content}</div> : <details className="ui-property-group ui-blueprint-capabilities" aria-label="控件蓝图能力"><summary>蓝图属性能力 · {properties.length} 项</summary>{content}</details>;
}
