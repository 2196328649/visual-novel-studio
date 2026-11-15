import { type BlueprintNode, type Condition, type Diagnostic, type Project, type UiComponent, type Variable } from './model';
import { projectGraphs } from './project-resources';
import { blueprintStateScope } from './blueprint-state';
import { parameterKind, parameterNameProblem, setParameterKind, type ParameterKind } from './parameter-sets';
import { parameterTextReferences, rewriteParameterReferences } from './parameter-references';
import { uiPageNames, componentName } from './ui-names';
import { uiProperties, type UiProperty } from './ui-properties';

export type ParameterUsageLocation =
  | { kind: 'story'; nodeId: string }
  | { kind: 'blueprint'; graphId: string; nodeId: string }
  | { kind: 'ui'; target: NonNullable<Diagnostic['ui']> }
  | { kind: 'text'; sourceLine: number };
export interface ParameterUsage { key: string; label: string; location: ParameterUsageLocation }

/** Visit typed references, never arbitrary text values or page/call-local state. */
function visit(project: Project, id: string, found: (usage: ParameterUsage, replace: (variable: Variable) => void) => void) {
  const condition = (value: Condition | undefined, usage: ParameterUsage) => {
    if (!value) return;
    if (value.kind === 'compare') {
      if (value.variableId === id) found(usage, variable => { value.variableId = variable.id; });
    } else if (value.kind === 'not') condition(value.condition, usage);
    else value.conditions.forEach(item => condition(item, usage));
  };
  for (const node of project.nodes) {
    const scene = project.scenes.find(scene => scene.id === node.sceneId);
    const usage: ParameterUsage = { key: 'story:' + node.id, label: ['剧情', scene?.name, node.name].filter(Boolean).join(' / '), location: { kind: 'story', nodeId: node.id } };
    if (node.kind === 'set') {
      if (node.variableId === id) found(usage, variable => { node.variableId = variable.id; });
      condition(node.when, usage);
    } else if (node.kind === 'condition') condition(node.condition, usage);
    else if (node.kind === 'choice') node.choices.forEach(choice => condition(choice.condition, usage));
    else if (node.kind === 'interaction') node.hotspots.forEach(hotspot => condition(hotspot.condition, usage));
  }
  for (const graph of projectGraphs(project)) for (const node of graph.nodes) {
    if (!['getVariable', 'setVariable', 'branch'].includes(node.type) || node.properties.variableId !== id) continue;
    if (node.type !== 'branch' && ['call', 'page'].includes(blueprintStateScope(project, node))) continue;
    found({ key: 'blueprint:' + graph.id + ':' + node.id, label: (graph.uiPageId ? '界面事件' : '蓝图') + ' / ' + graph.name + ' / ' + node.name,
      location: { kind: 'blueprint', graphId: graph.id, nodeId: node.id } }, variable => {
      node.properties.variableId = variable.id;
      if (node.type !== 'branch' && ['project', 'player'].includes(String(node.properties.scope))) node.properties.scope = variable.persistent ? 'player' : 'project';
    });
  }
  const component = (value: UiComponent, label: string, target: NonNullable<Diagnostic['ui']>) => {
    const usage: ParameterUsage = { key: 'ui:' + (target.instanceId ?? target.customPageId ?? 'base') + ':' + value.id,
      label: label + ' / ' + componentName(value), location: { kind: 'ui', target: { ...target, componentId: value.id } } };
    if (value.parameterId === id) found(usage, variable => { value.parameterId = variable.id; });
    if (value.assetParameterId === id) found(usage, variable => { value.assetParameterId = variable.id; });
    for (const [property, control] of Object.entries(value.propertyControls ?? {})) if (control.parameterId === id) {
      const name = Object.hasOwn(uiProperties, property) ? uiProperties[property as UiProperty].name : property;
      found({ ...usage, key: usage.key + ':property:' + property, label: usage.label + ' / 属性关联：' + name }, variable => { control.parameterId = variable.id; });
    }
    condition(value.visibleWhen, usage); condition(value.enabledWhen, usage); condition(value.selectedWhen, usage);
    Object.values(value.list?.galleryUnlockWhen ?? {}).forEach(item => condition(item, usage));
    for (const group of value.list?.galleryGroups ?? []) {
      condition(group.unlockWhen, usage);
      Object.values(group.variantUnlockWhen ?? {}).forEach(item => condition(item, usage));
    }
  };
  // Read each owned definition once. Inherited copies use the owning scheme's
  // location, including hidden/inactive definitions that still need repair.
  project.ui.components.forEach(value => component(value, '基础界面 / ' + uiPageNames[value.page], { page: value.page }));
  for (const scheme of project.ui.instances ?? []) scheme.components.forEach(value => component(value, scheme.name + ' / ' + uiPageNames[value.page], { page: value.page, instanceId: scheme.id }));
  for (const page of project.ui.customPages) page.components.forEach(value => component(value, page.name, { page: 'custom', customPageId: page.id }));
}

export function parameterUsages(project: Project, id: string): ParameterUsage[] {
  const found = new Map<string, ParameterUsage>();
  const represented = new Map<string, number>();
  visit(project, id, usage => {
    found.set(usage.key, usage);
    represented.set(usage.key, (represented.get(usage.key) ?? 0) + 1);
  });
  let nodeId: string | undefined;
  let definitionOpen = false;
  for (const [index, line] of (project.scriptText?.content ?? '').split('\n').entries()) {
    if (/^\s*[@／/]?效果定义\s*[:：]/.test(line)) definitionOpen = true;
    if (/^\s*[@／/]?效果结束\s*$/.test(line)) definitionOpen = false;
    if (definitionOpen) continue;
    if (/^\s*(?:#|@节点标记)/.test(line)) nodeId = line.match(/【([a-z][a-z0-9_]{0,63})】\s*$/)?.[1];
    const count = parameterTextReferences(project, line).filter(ref => ref.variableId === id).length;
    if (!count) continue;
    const key = 'story:' + nodeId, remaining = represented.get(key) ?? 0;
    represented.set(key, Math.max(0, remaining - count));
    // Only suppress the references already represented by the structured node.
    // Additional commands typed under the same heading remain navigable.
    if (remaining >= count) continue;
    found.set('text:' + index, { key: 'text:' + index, label: `剧本文本 / 第 ${index + 1} 行 · ${line.trim().slice(0, 70)}`, location: { kind: 'text', sourceLine: index + 1 } });
  }
  return [...found.values()];
}

export function renameParameter(project: Project, id: string, name: string) {
  const problem = parameterNameProblem(project, name, id);
  if (problem) throw new Error(problem);
  const variable = project.variables.find(variable => variable.id === id);
  if (!variable) throw new Error('参数已不存在。');
  if (project.scriptText) project.scriptText.content = rewriteParameterReferences(project, project.scriptText.content, id, { id, name: name.trim() });
  variable.name = name.trim();
}

export function changeParameterStorage(project: Project, id: string, persistent: boolean) {
  const variable = project.variables.find(variable => variable.id === id);
  if (!variable) throw new Error('参数已不存在。');
  if (variable.persistent === persistent) return;
  const readers: BlueprintNode[] = projectGraphs(project).flatMap(graph => graph.nodes.filter(node =>
    ['getVariable', 'setVariable'].includes(node.type) && node.properties.variableId === id && ['project', 'player'].includes(blueprintStateScope(project, node))));
  variable.persistent = persistent;
  for (const node of readers) if (node.properties.scope !== undefined) node.properties.scope = persistent ? 'player' : 'project';
}

export function changeParameterKind(project: Project, id: string, kind: ParameterKind) {
  const variable = project.variables.find(variable => variable.id === id);
  if (!variable) throw new Error('参数已不存在。');
  if (parameterKind(variable) !== kind) setParameterKind(variable, kind);
}

export function removeParameter(project: Project, id: string, replacementId?: string) {
  const variable = project.variables.find(variable => variable.id === id);
  if (!variable) throw new Error('参数已不存在。');
  const replacement = replacementId ? project.variables.find(variable => variable.id === replacementId) : undefined;
  if (replacementId && (!replacement || replacement.id === id || parameterKind(replacement) !== parameterKind(variable))) throw new Error('请选择另一个同类型参数。');
  if (project.scriptText) {
    // Even without replacement, pin old name-only references to the deleted ID
    // so applying a text draft reports them instead of creating a new variable.
    project.scriptText.content = rewriteParameterReferences(project, project.scriptText.content, id, replacement ?? variable);
  }
  if (replacement) visit(project, id, (_usage, replace) => replace(replacement));
  project.variables = project.variables.filter(variable => variable.id !== id);
}
