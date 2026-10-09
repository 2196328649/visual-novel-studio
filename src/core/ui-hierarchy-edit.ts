import { effectiveUiComponents, type Project } from './model';
import { uiSubtreeIds } from './ui-hierarchy';

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
    if (inherited && active.components.some(c => c.id === id)) { active.components = active.components.filter(c => c.id !== id); return; }
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
