import type { BlueprintNode, Condition, Project, UiComponent } from './model';
import { projectGraphs } from './project-resources';
import { uiControlValueType, uiTextInput } from './ui-control-events';
import { uiButtonEvents, type UiButtonEvent } from './ui-button-events';
import { uiImageEvents, type UiImageEvent } from './ui-image';
import { uiVideoEvents, type UiVideoEvent } from './ui-video';
import { uiSpineEvents, type UiSpineEvent } from './ui-spine';
import { uiPage } from './ui-pages';
import { actionName } from './ui-names';
import { uiClickHandlers, findUiControlEvent, uiEventAuthoringGraph, ownsUiEventGraph, ensureUiClickEvent, ensureUiButtonEvent, ensureUiValueChangedEvent, ensureUiTextCommittedEvent, ensureUiImageEvent, ensureUiVideoEvent, ensureUiSpineEvent } from './ui-logic';

export function uiInspectorPageId(project: Project, component: UiComponent, pageId?: string): string | undefined {
  return pageId ?? (component.page === 'custom' ? project.ui.customPages.find(page => page.components.some(item => item.id === component.id))?.id : 'ui:' + component.page);
}

/** Describe every existing condition without replacing it with a simpler rule. */
export function uiConditionDescription(project: Project, condition: Condition): string {
  if (condition.kind === 'compare') {
    const variable = project.variables.find(item => item.id === condition.variableId);
    const value = typeof condition.value === 'boolean' ? condition.value ? '开启' : '关闭' : typeof condition.value === 'string' ? '“' + condition.value + '”' : String(condition.value);
    const comparison = { eq: '等于', ne: '不等于', gt: '大于', gte: '大于或等于', lt: '小于', lte: '小于或等于' }[condition.operator];
    return (variable?.name ?? '已删除参数') + comparison + value;
  }
  if (condition.kind === 'not') return '不满足（' + uiConditionDescription(project, condition.condition) + '）';
  if (!condition.conditions.length) return condition.kind === 'all' ? '始终满足（没有限制）' : '始终不满足（没有候选条件）';
  return condition.conditions.map(child => child.kind === 'compare' ? uiConditionDescription(project, child) : '（' + uiConditionDescription(project, child) + '）').join(condition.kind === 'all' ? '，并且' : '，或者');
}

export interface UiInspectorControlEvent {
  id: string;
  label: string;
  type: Extract<BlueprintNode['type'], 'eventClick' | 'eventButton' | 'eventValueChanged' | 'eventTextCommitted' | 'eventImage' | 'eventVideo' | 'eventSpine'>;
  trigger?: UiButtonEvent | UiImageEvent | UiVideoEvent | UiSpineEvent;
}

/** Input modes depend on their binding, not on the original palette item. */
export function uiInspectorControlEvents(project: Project, component: UiComponent): UiInspectorControlEvent[] {
  const events: UiInspectorControlEvent[] = [];
  if (component.kind === 'button') {
    events.push({ id: 'click', label: '点击时', type: 'eventClick' });
    for (const [trigger, info] of Object.entries(uiButtonEvents)) events.push({ id: 'button:' + trigger, label: info.name, type: 'eventButton', trigger: trigger as UiButtonEvent });
  }
  if (uiControlValueType(project, component)) events.push({ id: 'value', label: '值改变时', type: 'eventValueChanged' });
  if (uiTextInput(project, component)) events.push({ id: 'commit', label: '文字提交时', type: 'eventTextCommitted' });
  if (component.kind === 'image') for (const [trigger, label] of Object.entries(uiImageEvents)) events.push({ id: 'image:' + trigger, label, type: 'eventImage', trigger: trigger as UiImageEvent });
  if (component.kind === 'video') for (const [trigger, label] of Object.entries(uiVideoEvents)) events.push({ id: 'video:' + trigger, label, type: 'eventVideo', trigger: trigger as UiVideoEvent });
  if (component.kind === 'spine') for (const [trigger, label] of Object.entries(uiSpineEvents)) events.push({ id: 'spine:' + trigger, label, type: 'eventSpine', trigger: trigger as UiSpineEvent });
  return events;
}

/** Reuse the existing entry; new entries never write into inherited/shared graphs. */
export function ensureUiInspectorEvent(project: Project, component: UiComponent, eventId: string, pageId?: string, independent = false) {
  const owner = uiInspectorPageId(project, component, pageId);
  const event = uiInspectorControlEvents(project, component).find(item => item.id === eventId);
  if (!owner || !event) throw new Error('此控件没有这个可用事件。');
  const existing = !independent && findUiControlEvent(project, owner, component.id, event.type, event.trigger);
  if (existing) return { graphId: existing.g.id, nodeId: existing.n.id, inherited: !ownsUiEventGraph(project, existing.g, owner) };
  const graph = uiEventAuthoringGraph(project, owner, uiPage(project, owner)?.name ?? '界面');
  const node = event.type === 'eventClick' ? ensureUiClickEvent(project, graph, component.id, owner)
    : event.type === 'eventButton' ? ensureUiButtonEvent(project, graph, component.id, owner, event.trigger as UiButtonEvent)
    : event.type === 'eventValueChanged' ? ensureUiValueChangedEvent(project, graph, component.id, owner)
    : event.type === 'eventTextCommitted' ? ensureUiTextCommittedEvent(project, graph, component.id, owner)
    : event.type === 'eventImage' ? ensureUiImageEvent(project, graph, component.id, owner, event.trigger as UiImageEvent)
    : event.type === 'eventVideo' ? ensureUiVideoEvent(project, graph, component.id, owner, event.trigger as UiVideoEvent)
    : ensureUiSpineEvent(project, graph, component.id, owner, event.trigger as UiSpineEvent);
  return { graphId: graph.id, nodeId: node.id, inherited: false };
}

/** Same page and scheme filtering and same execution order as the player. */
export function uiInspectorInteractionSummary(project: Project, component: UiComponent, pageId?: string, includeVisibility = true): string {
  const owner = uiInspectorPageId(project, component, pageId);
  if (component.kind !== 'button') {
    const events = owner ? uiInspectorControlEvents(project, component).filter(event => findUiControlEvent(project, owner, component.id, event.type, event.trigger)) : [];
    if (!includeVisibility) {
      const control = uiControlValueType(project, component);
      return [control && component.disabled && '已禁用', control && component.readOnly && '只读',
        control && component.enabledWhen && '按条件操作', events.length ? events.length + ' 项事件' : undefined,
        component.events?.onShow && '已绑定事件蓝图'].filter(Boolean).join(' · ') || '事件与反馈';
    }
    return [component.visibleWhen ? '按条件显示' : '始终显示', component.readOnly && '只读', events.length ? events.length + ' 项事件' : undefined].filter(Boolean).join(' · ');
  }
  const handlers = owner ? uiClickHandlers(project, owner, component.id) : [];
  const events = handlers.filter(handler => handler.source !== 'action');
  const missing = handlers.some(handler => !projectGraphs(project).some(graph => graph.id === handler.graphId));
  const action = component.action === 'blueprint' ? component.blueprintId ? '执行蓝图' : '蓝图未选择' : component.action ? actionName(component.action) : undefined;
  const steps = [events.length ? events.length === 1 ? '执行事件' : events.length + ' 项事件' : undefined, action].filter(Boolean);
  return [component.disabled && '已禁用', steps.length ? '点击 → ' + steps.join(' → ') : '尚未设置点击行为', missing && '含失效引用'].filter(Boolean).join(' · ');
}
