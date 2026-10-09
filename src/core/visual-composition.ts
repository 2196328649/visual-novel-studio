import { projectGraphs } from './project-resources';
import { actionSchema, type Project, type VisualObject } from './model';
import { applyVisualInputs, createVisualObject, retimeVisualObject, visualInputFields } from './visual-object';

export function assertCompositionInsertion(project: Pick<Project, 'blueprints' | 'timelinePresets'>, parentId: string, resourceId: string) {
  const visit = (id: string, stack: string[]) => {
    if (id === parentId || stack.includes(id) || stack.length >= 16) throw new Error('组合资源不能循环嵌套，最多嵌套 16 层。');
    const graph = projectGraphs(project).find(item => item.id === id);
    if (!graph) throw new Error('组合资源已不存在。');
    const references = new Set<string>();
    const visual = (object: VisualObject) => { if (object.compositionId) references.add(object.compositionId); else object.children?.forEach(visual); };
    for (const node of graph.nodes) {
      if (node.type === 'callFunction' && node.properties.graphId) references.add(String(node.properties.graphId));
      if (node.type === 'savedAction') {
        const action = actionSchema.safeParse(JSON.parse(String(node.properties.action)));
        if (action.success && action.data.kind === 'visual') visual(action.data);
        if (action.success && action.data.kind === 'blueprint') references.add(action.data.blueprintId);
      }
    }
    for (const reference of references) visit(reference, [...stack, id]);
  };
  visit(resourceId, []);
}

export function compositionResourceRoot(project: Pick<Project, 'blueprints' | 'timelinePresets'>, id: string): VisualObject {
  const graph = projectGraphs(project).find(item => item.id === id && item.visualComposition);
  const node = graph?.nodes.find(item => item.type === 'savedAction');
  const root = node && actionSchema.parse(JSON.parse(String(node.properties.action)));
  if (!root || root.kind !== 'visual' || root.content !== 'group') throw new Error('组合资源已不存在。');
  const values: Record<string, import('./model').VariableValue> = {};
  for (const field of visualInputFields(root)) {
    const link = graph!.links.find(item => item.toNodeId === node!.id && item.toPinId === 'object_' + field.key);
    const reader = graph!.nodes.find(item => item.id === link?.fromNodeId && item.type === 'getInput');
    const value = reader ? graph!.exposedInputs.find(item => item.id === reader.properties.inputId)?.defaultValue : node!.properties['object_' + field.key];
    if (value !== undefined) values[field.key] = value;
  }
  return applyVisualInputs(root, values);
}

function derivedId(instanceId: string, sourceId: string) {
  let a = 2166136261, b = 5381;
  for (const char of instanceId + '/' + sourceId) { a = Math.imul(a ^ char.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ char.charCodeAt(0); }
  return 'object_' + (a >>> 0).toString(16) + '_' + (b >>> 0).toString(16);
}

export function instantiateVisualComposition(project: Pick<Project, 'blueprints' | 'timelinePresets'>, id: string, instanceId: string): VisualObject {
  const root = structuredClone(compositionResourceRoot(project, id)), ids = new Map<string, string>();
  const identify = (object: VisualObject) => { ids.set(object.instanceId, derivedId(instanceId, object.instanceId)); object.children?.forEach(identify); };
  identify(root);
  const renew = (object: VisualObject) => {
    object.instanceId = ids.get(object.instanceId)!;
    object.parameters?.forEach(parameter => parameter.targets.forEach(target => { target.instanceId = ids.get(target.instanceId) ?? target.instanceId; }));
    object.children?.forEach(renew);
  };
  renew(root); delete root.startAt;
  const wrapper = createVisualObject('group'); wrapper.instanceId = instanceId; wrapper.name = projectGraphs(project).find(item => item.id === id)!.name;
  wrapper.duration = root.duration; wrapper.retimeOnDuration = true; wrapper.compositionId = id; wrapper.children = [root];
  wrapper.parameters = root.parameters?.map(parameter => ({ ...parameter, defaultValue: root.parameterValues?.[parameter.id] ?? parameter.defaultValue, targets: [{ instanceId: root.instanceId, path: ['parameterValues', parameter.id] }] }));
  return wrapper;
}

/** Expand resources at playback/export, so instances follow edits without shared identities. */
export function materializeVisualCompositions(project: Pick<Project, 'blueprints' | 'timelinePresets'>, root: VisualObject, stack: string[] = []): VisualObject {
  let result = structuredClone(root);
  if (root.compositionId) {
    if (stack.includes(root.compositionId) || stack.length >= 16) throw new Error('组合资源不能循环嵌套，最多嵌套 16 层。');
    const source = instantiateVisualComposition(project, root.compositionId, root.instanceId);
    result = root.duration === source.duration ? source : retimeVisualObject(source, root.duration);
    Object.assign(result, { name: root.name, layer: root.layer, startAt: root.startAt, width: root.width, height: root.height, keyframes: root.keyframes, parameterValues: root.parameterValues, wait: root.wait });
    result.maskAssetId = root.maskAssetId; result.dissolve = root.dissolve;
    // Instance animation is an additional transform; source effects remain authored in the resource.
    result.curves = root.curves;
    stack = [...stack, root.compositionId];
  }
  if (result.children) result.children = result.children.map(child => materializeVisualCompositions(project, child, stack));
  return result;
}
