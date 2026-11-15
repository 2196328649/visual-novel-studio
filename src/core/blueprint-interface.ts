import { blueprintStateVariable } from './blueprint-state';
import { uiPage } from './ui-pages';
import { blueprintGraphSchema, declaredUiComponents, type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Project } from './model';
import { blueprintTypesCompatible, blueprintTypeNames, blueprintScreens, synchronizeBlueprintSignatures } from './blueprint';
import { cloneData, mutateProject, projectEditSnapshot } from './project-mutation';
import { projectGraphs } from './project-resources';
import { blueprintUsages, type BlueprintUsageLocation } from './blueprint-usages';

export type BlueprintInterfaceChange =
  | { kind: 'update'; direction: BlueprintPin['direction']; pinId: string; patch: Partial<Pick<BlueprintPin, 'name' | 'description' | 'dataType' | 'required' | 'defaultValue'>> }
  | { kind: 'remove'; direction: BlueprintPin['direction']; pinId: string }
  | { kind: 'add'; direction: BlueprintPin['direction']; pin: BlueprintPin };
export interface BlueprintInterfaceImpact {
  key: string; label: string; message: string; location: BlueprintUsageLocation; linkId?: string;
  kind: 'removedLink' | 'invalidLink' | 'removedValue' | 'invalidValue' | 'missingParameter';
}
export interface BlueprintInterfacePlan {
  graphId: string; change: BlueprintInterfaceChange; impacts: BlueprintInterfaceImpact[];
  callCount: number; confirmationKey: string; requiresConfirmation: boolean;
}

function changeInterface(graph: BlueprintGraph, change: BlueprintInterfaceChange) {
  const key = change.direction === 'input' ? 'exposedInputs' : 'exposedOutputs';
  if (change.kind === 'add') {
    if (graph.exposedInputs.some(pin => pin.id === change.pin.id) || graph.exposedOutputs.some(pin => pin.id === change.pin.id)) throw new Error('参数标识重复，未修改接口。');
    graph[key].push(cloneData({ ...change.pin, direction: change.direction }));
  } else {
    const pin = graph[key].find(pin => pin.id === change.pinId);
    if (!pin) throw new Error('参数已删除或接口已改变，请重新选择。');
    if (change.kind === 'remove') graph[key] = graph[key].filter(pin => pin.id !== change.pinId);
    else Object.assign(pin, change.patch);
  }
  const pins = [...graph.exposedInputs, ...graph.exposedOutputs];
  if (pins.some(pin => pin.dataType === 'exec')) throw new Error('公开参数不能使用执行引脚类型。');
  if (pins.some(pin => !pin.name.trim())) throw new Error('公开参数名称不能为空。');
  const parsed = blueprintGraphSchema.safeParse(graph);
  if (!parsed.success) throw new Error('接口内容不合法或参数数量超过上限，未修改接口。');
}
function valueValid(project: Project, pin: BlueprintPin, value: unknown): boolean {
  if (value === undefined) return !pin.required;
  if (pin.dataType === 'any') return ['string', 'number', 'boolean'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
  if (pin.dataType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (pin.dataType === 'string' || pin.dataType === 'boolean') return typeof value === pin.dataType;
  if (value === '') return !pin.required;
  if (pin.dataType === 'asset') return project.assets.some(item => item.id === value);
  if (pin.dataType === 'scene') return project.scenes.some(item => item.id === value);
  if (pin.dataType === 'character') return project.characters.some(item => item.id === value);
  if (pin.dataType === 'ui') return typeof value === 'string' && (Object.hasOwn(blueprintScreens, value) || !!uiPage(project, value));
  if (pin.dataType === 'component') return declaredUiComponents(project).some(item => item.id === value);
  return false;
}
function actualType(project: Project, graph: BlueprintGraph, node: BlueprintNode, pin: BlueprintPin) {
  if (pin.dataType === 'exec') return pin.dataType;
  if (node.type === 'literal' && pin.dataType === 'any' && node.properties.value !== undefined) return typeof node.properties.value as 'string' | 'number' | 'boolean';
  if (node.type === 'getVariable') return blueprintStateVariable(project, graph, node)?.type ?? pin.dataType;
  if (node.type === 'getInput') return graph.exposedInputs.find(item => item.id === node.properties.inputId)?.dataType ?? pin.dataType;
  return pin.dataType;
}
function invalidLink(project: Project, graph: BlueprintGraph, fromId: string, fromPin: string, toId: string, toPin: string) {
  const from = graph.nodes.find(node => node.id === fromId), to = graph.nodes.find(node => node.id === toId);
  const a = from?.pins.find(pin => pin.id === fromPin), b = to?.pins.find(pin => pin.id === toPin);
  return !!(from && to && a && b && !blueprintTypesCompatible(actualType(project, graph, from, a), actualType(project, graph, to, b)));
}

/** Build an exact read-only impact preview using the same synchronizer as the edit. */
export function inspectBlueprintInterfaceChange(project: Project, graphId: string, change: BlueprintInterfaceChange): BlueprintInterfacePlan {
  const original = projectGraphs(project).find(graph => graph.id === graphId);
  if (!original) throw new Error('蓝图已不存在，未修改接口。');
  const changed = cloneData(original); changeInterface(changed, change);
  const candidate = mutateProject(project, draft => {
    const graph = projectGraphs(draft).find(graph => graph.id === graphId)!;
    graph.exposedInputs = changed.exposedInputs; graph.exposedOutputs = changed.exposedOutputs;
    synchronizeBlueprintSignatures(draft, project);
  });
  const impacts: BlueprintInterfaceImpact[] = [], graphs = projectGraphs(candidate);
  for (const before of projectGraphs(project)) {
    const after = graphs.find(graph => graph.id === before.id)!;
    for (const link of before.links) {
      const current = after.links.find(item => item.id === link.id);
      const from = before.nodes.find(node => node.id === link.fromNodeId), to = before.nodes.find(node => node.id === link.toNodeId);
      if (current && (!invalidLink(candidate, after, current.fromNodeId, current.fromPinId, current.toNodeId, current.toPinId) || invalidLink(project, before, link.fromNodeId, link.fromPinId, link.toNodeId, link.toPinId))) continue;
      if (!current || current.fromPinId === link.fromPinId && current.toPinId === link.toPinId) impacts.push({
        key: 'link:' + before.id + ':' + link.id, kind: current ? 'invalidLink' : 'removedLink', linkId: link.id,
        label: before.name + ' / ' + (from?.name ?? '缺失节点') + ' → ' + (to?.name ?? '缺失节点'),
        message: current ? '引脚类型改变后不兼容；连线保留并显示诊断，需手动修复。' : '参数被删除后，这条连线将断开；可撤销恢复。',
        location: { kind: 'blueprint', graphId: before.id, nodeId: to?.id ?? link.fromNodeId },
      });
    }
  }
  const uses = blueprintUsages(project, graphId);
  const changedId = change.kind === 'add' ? change.pin.id : change.pinId;
  const beforePin = original[change.direction === 'input' ? 'exposedInputs' : 'exposedOutputs'].find(pin => pin.id === changedId);
  const afterPin = changed[change.direction === 'input' ? 'exposedInputs' : 'exposedOutputs'].find(pin => pin.id === changedId);
  if (change.direction === 'input') for (const use of uses) {
    if (use.outputOnly) continue;
    const explicit = use.inputs?.[changedId];
    if (!afterPin && explicit !== undefined) impacts.push({ key: use.key + ':value:' + changedId, kind: 'removedValue', label: use.label, location: use.location, message: '已填写的参数“' + (beforePin?.name ?? changedId) + '”不再属于接口；调用将忽略它，支持清理的调用会同步移除。' });
    else if (afterPin && !use.linkedInputs?.includes(changedId) && !valueValid(candidate, afterPin, explicit ?? afterPin.defaultValue)
      && (!beforePin || valueValid(project, beforePin, explicit ?? beforePin.defaultValue))) impacts.push({
        key: use.key + ':value:' + changedId, kind: 'invalidValue', label: use.label, location: use.location,
        message: '“' + afterPin.name + '”需要' + blueprintTypeNames[afterPin.dataType] + '；此调用的填写值或默认值不再有效，保留原值并要求修复。',
      });
  }
  if (!afterPin) for (const node of original.nodes) if (change.direction === 'input' && node.type === 'getInput' && node.properties.inputId === changedId || change.direction === 'output' && node.type === 'setOutput' && node.properties.outputId === changedId) impacts.push({
    key: 'node:' + original.id + ':' + node.id, kind: 'missingParameter', label: original.name + ' / ' + node.name,
    message: '此节点引用的参数将不存在；节点保留并显示诊断，请重新绑定或删除。', location: { kind: 'blueprint', graphId: original.id, nodeId: node.id },
  });
  return { graphId, change, impacts, callCount: uses.length, requiresConfirmation: impacts.length > 0,
    confirmationKey: JSON.stringify([graphId, original.exposedInputs, original.exposedOutputs, change, impacts, uses]) };
}

/** Recheck against the current transaction so a stale confirmation cannot remove a newly added wire. */
export function applyBlueprintInterfaceChange(project: Project, graphId: string, change: BlueprintInterfaceChange, confirmationKey?: string): BlueprintInterfacePlan {
  const plan = inspectBlueprintInterfaceChange(project, graphId, change);
  if (plan.requiresConfirmation && plan.confirmationKey !== confirmationKey) throw new Error('接口修改会影响已有调用，请查看最新影响后确认。');
  const graph = projectGraphs(project).find(graph => graph.id === graphId)!;
  const before = projectEditSnapshot(project);
  changeInterface(graph, change); synchronizeBlueprintSignatures(project, before); return plan;
}
