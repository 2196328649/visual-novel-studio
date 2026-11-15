import { effectiveUiComponents, inheritanceReaches, type Project, type UiComponent } from './model';
import { uiHierarchyProblems, uiSubtreeIds } from './ui-hierarchy';
import { componentName } from './ui-names';

/** Hide an inherited subtree without discarding this scheme's authored overrides. */
export function hideInheritedUiObject(project: Project, id: string): void {
  const active = project.ui.instances?.find(instance => instance.id === project.ui.activeInstanceId);
  if (!active || active.hiddenComponentIds?.includes(id)) return;
  const inherited = effectiveUiComponents({ ...project.ui, activeInstanceId: active.baseUiId });
  if (!inherited.some(component => component.id === id)) return;
  active.hiddenComponentIds = [...(active.hiddenComponentIds ?? []), id];
}

/** Restore one override without introducing hierarchy problems in any affected scheme. */
export function restoreInheritedUiObject(project: Project, id: string): void {
  const instances = project.ui.instances ?? [];
  const active = instances.find(instance => instance.id === project.ui.activeInstanceId);
  if (!active || !active.components.some(component => component.id === id)) return;
  const inherited = effectiveUiComponents({ ...project.ui, activeInstanceId: active.baseUiId });
  if (!inherited.some(component => component.id === id)) return;

  const components = active.components.filter(component => component.id !== id);
  const projected = { ...project.ui, instances: instances.map(instance => instance === active ? { ...instance, components } : instance) };
  const affected = [active, ...instances.filter(instance => instance !== active
    && inheritanceReaches(instances, instance.baseUiId, active.id, item => item.baseUiId))];
  for (const instance of affected) {
    const effective = effectiveUiComponents({ ...projected, activeInstanceId: instance.id });
    const problems = uiHierarchyProblems(effective);
    if (!problems.length) continue;
    const before = effectiveUiComponents({ ...project.ui, activeInstanceId: instance.id });
    const previousProblems = new Map(uiHierarchyProblems(before).map(problem => [problem.id, problem.message]));
    const previousById = new Map(before.map(component => [component.id, component]));
    const nextById = new Map(effective.map(component => [component.id, component]));
    // An unrelated invalid draft must not prevent restoration; a changed bad chain must.
    const problem = problems.find(item => previousProblems.get(item.id) !== item.message
      || !sameParentChain(previousById, nextById, item.id));
    if (problem) {
      const component = nextById.get(problem.id)!;
      throw new Error(`无法恢复继承控件：方案“${instance.name}”中的“${componentName(component)}”层级无效。${problem.message}请先调整父对象关系。`);
    }
  }
  active.components = components;
}

function sameParentChain(before: Map<string, UiComponent>, after: Map<string, UiComponent>, id: string): boolean {
  const seen = new Set<string>();
  let current: string | undefined = id;
  while (current && !seen.has(current)) {
    const previous = before.get(current), next = after.get(current);
    if (!!previous !== !!next || previous?.parentId !== next?.parentId || previous?.page !== next?.page) return false;
    seen.add(current);
    current = next?.parentId;
  }
  return true;
}

/** Delete a local object as one subtree; removing an override still restores its base. */
export function removeUiObject(project: Project, id: string): void {
  const custom = project.ui.customPages.find(p => p.components.some(c => c.id === id));
  if (custom) {
    const ids = uiSubtreeIds(custom.components, id);
    custom.components = custom.components.filter(c => !ids.has(c.id));
    return;
  }
  const active = project.ui.instances?.find(i => i.id === project.ui.activeInstanceId);
  if (active) {
    const inherited = effectiveUiComponents({ ...project.ui, activeInstanceId: active.baseUiId }).some(c => c.id === id);
    if (inherited && active.components.some(c => c.id === id)) { restoreInheritedUiObject(project, id); return; }
    if (inherited) { active.hiddenComponentIds = [...new Set([...(active.hiddenComponentIds ?? []), id])]; return; }
    const affected = new Set([active.id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const instance of project.ui.instances ?? []) if (instance.baseUiId && affected.has(instance.baseUiId) && !affected.has(instance.id)) {
        affected.add(instance.id); changed = true;
      }
    }
    const instances = project.ui.instances!.filter(instance => affected.has(instance.id));
    const ids = uiSubtreeIds([...effectiveUiComponents(project.ui), ...instances.flatMap(instance => instance.components)], id);
    for (const instance of instances) {
      instance.components = instance.components.filter(c => !ids.has(c.id));
      instance.hiddenComponentIds = instance.hiddenComponentIds?.filter(childId => !ids.has(childId));
    }
    return;
  }
  const ids = uiSubtreeIds([...project.ui.components, ...(project.ui.instances ?? []).flatMap(i => i.components)], id);
  project.ui.components = project.ui.components.filter(c => !ids.has(c.id));
  for (const instance of project.ui.instances ?? []) {
    instance.components = instance.components.filter(c => !ids.has(c.id));
    instance.hiddenComponentIds = instance.hiddenComponentIds?.filter(id => !ids.has(id));
  }
}
