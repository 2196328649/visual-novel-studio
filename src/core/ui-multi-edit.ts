import { effectiveUiComponents, localUiComponents, uiComponentLimit, type Project, type UiComponent, type VariableValue } from './model';
import { cloneData } from './project-mutation';
import { applyUiDesignProperty, readUiDesignProperty, resetUiDesignProperty, uiDesignPropertyApplies } from './ui-design-properties';
import { componentName } from './ui-names';
import { uiPropertyValueProblem } from './ui-properties';
import { uiPropertyControlFor, uiPropertyControlModes, uiPropertyControlProblem } from './ui-property-control';

export const uiMultiProperties = ['opacity', 'font', 'fontSize', 'textColor'] as const;
export type UiMultiProperty = typeof uiMultiProperties[number];
export interface UiMultiEditScope { projectId: string; page: UiComponent['page']; ownerId?: string }
export type UiMultiEdit = { property: UiMultiProperty; mode: 'set'; value: VariableValue } | { property: UiMultiProperty; mode: 'reset' };
export interface UiMultiEditProblem { id?: string; property?: UiMultiProperty; message: string }
export interface UiMultiTargetValue {
  id: string;
  name: string;
  value: VariableValue;
  designValue: VariableValue;
  source: string;
  sourceKey: string;
  inherited: boolean;
  canReset: boolean;
  problem?: string;
}
export interface UiMultiField {
  property: UiMultiProperty;
  value?: VariableValue;
  mixed: boolean;
  mixedSources: boolean;
  targets: UiMultiTargetValue[];
  problems: UiMultiEditProblem[];
  canReset: boolean;
}
export interface UiMultiSelection {
  ids: string[];
  fields: UiMultiField[];
  inheritedCount: number;
  problems: UiMultiEditProblem[];
  textUnavailable: boolean;
}
interface SelectionContext {
  ids: string[];
  components: UiComponent[];
  local: UiComponent[];
  targets: UiComponent[];
  problems: UiMultiEditProblem[];
}

/** Repeated/native captions are a different editing surface, even at the same property ID. */
export function uiMultiPropertyApplies(project: Project, component: UiComponent, property: UiMultiProperty): boolean {
  if (property !== 'opacity' && (component.kind !== 'text' && component.kind !== 'button' || component.kind === 'button' && component.skin?.hideText)) return false;
  return uiDesignPropertyApplies(component, property, project);
}

function selectionContext(project: Project, scope: UiMultiEditScope, selectedIds: readonly string[]): SelectionContext {
  const ids = [...new Set(selectedIds)], problems: UiMultiEditProblem[] = [];
  const fail = (message: string): SelectionContext => ({ ids, components: [], local: [], targets: [], problems: [{ message }] });
  if (project.id !== scope.projectId) return fail('工程已切换，请重新选择控件。');
  if (ids.length < 2) return fail('请选择至少两个控件进行共同属性编辑。');
  const custom = scope.page === 'custom' ? project.ui.customPages.find(page => page.id === scope.ownerId) : undefined;
  if (scope.page === 'custom' && !custom) return fail('自定义页面已不存在，请重新选择。');
  if (scope.page !== 'custom' && (project.ui.activeInstanceId !== scope.ownerId
    || scope.ownerId !== undefined && !project.ui.instances?.some(instance => instance.id === scope.ownerId))) return fail('界面方案已切换或不存在，请重新选择。');
  const components = custom?.components ?? effectiveUiComponents(project.ui), local = custom?.components ?? localUiComponents(project.ui);
  const byId = new Map(components.map(component => [component.id, component]));
  const targets: UiComponent[] = [];
  for (const id of ids) {
    const component = byId.get(id);
    if (!component || component.page !== scope.page) problems.push({ id, message: '控件已删除或不属于当前页面：' + (component ? componentName(component) : id) });
    else targets.push(component);
  }
  return { ids, components, local, targets, problems };
}

function targetProblem(component: UiComponent, byId: ReadonlyMap<string, UiComponent>): string | undefined {
  const seen = new Set<string>();
  let current: UiComponent | undefined = component;
  while (current) {
    if (seen.has(current.id)) return '父子关系存在循环，请先修复层级。';
    seen.add(current.id);
    if (current.editor?.locked) return current.id === component.id ? '控件已锁定，请先解锁。' : '父对象“' + componentName(current) + '”已锁定，请先解锁。';
    if (!current.parentId) break;
    const parent: UiComponent | undefined = byId.get(current.parentId);
    if (!parent || parent.page !== component.page) return '父对象不存在或不在同一页面，请先修复层级。';
    current = parent;
  }
}

function ownerSource(project: Project, scope: UiMultiEditScope, component: UiComponent, inherited: boolean) {
  if (scope.page === 'custom') return { key: 'custom:' + scope.ownerId, label: '本页面控件' };
  const seen = new Set<string>();
  let instance = project.ui.instances?.find(item => item.id === scope.ownerId);
  while (instance && !seen.has(instance.id)) {
    seen.add(instance.id);
    if (instance.components.some(item => item.id === component.id)) return { key: 'scheme:' + instance.id, label: inherited ? '继承自“' + instance.name + '”' : '当前方案控件' };
    const baseId = instance.baseUiId;
    instance = project.ui.instances?.find(item => item.id === baseId);
  }
  return { key: 'base', label: inherited ? '继承自基础界面' : '基础界面控件' };
}

function fieldState(project: Project, scope: UiMultiEditScope, context: SelectionContext, property: UiMultiProperty): UiMultiField {
  const localIds = new Set(context.local.map(component => component.id)), byId = new Map(context.components.map(component => [component.id, component]));
  const targets = context.targets.map((component): UiMultiTargetValue => {
    const design = readUiDesignProperty(project, component, property), inherited = !localIds.has(component.id);
    const owner = ownerSource(project, scope, component, inherited), link = uiPropertyControlFor(project, component, property);
    const parameter = link && project.variables.find(item => item.id === link.control.parameterId);
    const linkProblem = link && uiPropertyControlProblem(project, component, property, link.control);
    const controlSource = link ? (uiPropertyControlModes[link.control.mode] ?? '参数关联无效') + '：' + (parameter?.name ?? '来源参数已删除') : undefined;
    const value = link && parameter && !linkProblem ? parameter.initial : design.value;
    const problem = targetProblem(component, byId)
      ?? (link ? (linkProblem ? linkProblem + ' ' : '') + controlSource + '。请单独调整来源；批量编辑不会解除关联或写回参数。' : undefined);
    return {
      id: component.id, name: componentName(component), value, designValue: design.value, inherited,
      source: owner.label + ' · ' + (controlSource ?? design.source),
      sourceKey: JSON.stringify([owner.key, design.source, link?.control.mode, link?.control.parameterId]),
      canReset: design.canReset, problem,
    };
  });
  const mixed = targets.some(target => !Object.is(target.value, targets[0]?.value));
  return {
    property, targets, mixed, value: mixed ? undefined : targets[0]?.value,
    mixedSources: targets.some(target => target.sourceKey !== targets[0]?.sourceKey),
    problems: targets.flatMap(target => target.problem ? [{ id: target.id, property, message: '“' + target.name + '”：' + target.problem }] : []),
    canReset: targets.some(target => target.canReset),
  };
}

/** Observe author values and parameter initial values without materializing defaults or snapshots. */
export function readUiMultiSelection(project: Project, scope: UiMultiEditScope, selectedIds: readonly string[]): UiMultiSelection {
  const context = selectionContext(project, scope, selectedIds);
  const localIds = new Set(context.local.map(component => component.id));
  const properties = context.problems.length ? [] : uiMultiProperties.filter(property => context.targets.every(component => uiMultiPropertyApplies(project, component, property)));
  return {
    ids: context.ids, problems: context.problems,
    fields: properties.map(property => fieldState(project, scope, context, property)),
    inheritedCount: context.targets.filter(component => !localIds.has(component.id)).length,
    textUnavailable: !properties.includes('font'),
  };
}

export interface UiMultiEditPlan {
  changedIds: string[];
  inheritedIds: string[];
  replacements: { id: string; component: UiComponent }[];
  problems: UiMultiEditProblem[];
}

/** Prepare the complete batch before touching even a mutable caller's project. */
export function planUiMultiEdit(project: Project, scope: UiMultiEditScope, selectedIds: readonly string[], edits: readonly UiMultiEdit[]): UiMultiEditPlan {
  const context = selectionContext(project, scope, selectedIds);
  const problems = [...context.problems];
  const failed = (): UiMultiEditPlan => ({ changedIds: [], inheritedIds: [], replacements: [], problems });
  if (problems.length || !edits.length) return failed();
  const seen = new Set<UiMultiProperty>();
  for (const edit of edits) {
    if (!uiMultiProperties.includes(edit.property) || seen.has(edit.property) || !['set', 'reset'].includes(edit.mode)) {
      problems.push({ message: '共同属性变更无效或重复，请重新编辑。' });
      continue;
    }
    seen.add(edit.property);
    if (edit.mode === 'set') {
      const problem = uiPropertyValueProblem(project, edit.property, edit.value);
      if (problem) problems.push({ property: edit.property, message: problem });
    }
    for (const component of context.targets) {
      if (!uiMultiPropertyApplies(project, component, edit.property)) problems.push({ id: component.id, property: edit.property,
        message: '“' + componentName(component) + '”不支持这项共同属性；列表条目和隐藏按钮文字需单独编辑。' });
    }
    if (context.targets.every(component => uiMultiPropertyApplies(project, component, edit.property))) problems.push(...fieldState(project, scope, context, edit.property).problems);
  }
  if (problems.length) return failed();
  const replacements: UiMultiEditPlan['replacements'] = [];
  for (const component of context.targets) {
    const next = cloneData(component);
    let changed = false;
    for (const edit of edits) {
      try {
        changed = (edit.mode === 'set' ? applyUiDesignProperty(project, next, edit.property, edit.value) : resetUiDesignProperty(next, edit.property)) || changed;
      } catch (error) {
        problems.push({ id: component.id, property: edit.property, message: '“' + componentName(component) + '”：' + (error instanceof Error ? error.message : String(error)) });
      }
    }
    if (changed) replacements.push({ id: component.id, component: next });
  }
  if (problems.length) return failed();
  const localIds = new Set(context.local.map(component => component.id)), inheritedIds = replacements.filter(item => !localIds.has(item.id)).map(item => item.id);
  if (context.local.length + inheritedIds.length > uiComponentLimit) {
    problems.push({ message: `当前方案还可建立 ${Math.max(0, uiComponentLimit - context.local.length)} 个控件覆盖，本次需要 ${inheritedIds.length} 个；未修改任何控件。` });
    return failed();
  }
  return { changedIds: replacements.map(item => item.id), inheritedIds, replacements, problems };
}

/** Re-plan against the current transaction, then publish only fully checked replacements. */
export function applyUiMultiEdit(project: Project, scope: UiMultiEditScope, selectedIds: readonly string[], edits: readonly UiMultiEdit[]): string[] {
  const plan = planUiMultiEdit(project, scope, selectedIds, edits);
  if (plan.problems.length) throw new Error(plan.problems.map(problem => problem.message).join('\n'));
  if (!plan.replacements.length) return [];
  const local = scope.page === 'custom' ? project.ui.customPages.find(page => page.id === scope.ownerId)!.components : localUiComponents(project.ui);
  for (const replacement of plan.replacements) {
    const index = local.findIndex(component => component.id === replacement.id);
    if (index === -1) local.push(replacement.component);
    else local[index] = replacement.component;
  }
  return plan.changedIds;
}
