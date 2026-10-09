import { graphResourceKey, projectGraphs } from './project-resources';
import { applyAudioClipInputs, audioClipFields, syncAudioClipPins, patchAudioClipNode } from './audio-clip';
import { maxBlueprintInputs, actionSchema, effectiveCharacter, makeId, type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Project, type StageAction, type VariableValue } from './model';
import { blueprintInputValue, blueprintNodeDefaults, blueprintPin, callablePins, connectBlueprintPins, createBlueprintGraph } from './blueprint';
import { createContentFolder, folderTrail, moveContent } from './content-browser';
import { textCommandAction } from './text-script';
import { commandSignature } from './command-parameters';
import { argumentText, bindArguments } from './text-arguments';
import { applyVisualInputs, syncVisualPins, visualInputFields, updateVisualNodeObject } from './visual-object';

export { availablePerformanceBlueprints, installPerformanceBlueprint } from './builtin-performances';
export interface PerformanceInput { nodeId: string; pinId: string; name: string; defaultValue: VariableValue; dataType: BlueprintPin['dataType'] }

export function performanceFromText(project: Project, source: string): StageAction[] {
  const actions: StageAction[] = [];
  for (const line of source.split('\n').map(line => line.trim()).filter(Boolean)) {
    const match = line.match(/^@([^：:]+?)(?:[:：]\s*(.*))?$/);
    if (!match) throw new Error('请选择完整的 @ 演出指令；台词、目录和跳转不参与封装。');
    const [, name] = match;
    let value = match[2] ?? '';
    if (name === '独立演出') continue;
    const action = textCommandAction(project, line, true);
    if (!action) throw new Error(`“${name}”不是可封装的演出，或引用的资源不存在。`);
    actions.push(action);
  }
  if (!actions.length) throw new Error('先选中要封装的演出指令。');
  if (actions.length > 64) throw new Error('一次最多封装 64 个演出。');
  return actions;
}

export function performanceNode(project: Project, action: StageAction): BlueprintNode {
  const types: Partial<Record<StageAction['kind'], BlueprintNode['type']>> = { background: 'showBackground', show: 'showCharacter', hide: 'hideCharacter', music: 'playMusic', sound: 'playSound', stopMusic: 'stopMusic', pause: 'delay', startDialogue: 'startDialogue', chapter: 'showChapter', camera: 'camera', shake: 'shake', effect: 'effect', blueprint: 'callFunction' };
  const node = blueprintNodeDefaults(action.kind === 'camera' && action.curves ? 'savedAction' : types[action.kind] ?? 'savedAction');
  if (action.kind === 'blueprint') {
    node.properties = { graphId: action.blueprintId, ...Object.fromEntries(Object.entries(action.inputs ?? {}).map(([id, value]) => [`arg_${id}`, value])) };
    node.pins = callablePins(projectGraphs(project).find(graph => graph.id === action.blueprintId));
  } else if (node.type === 'savedAction') node.properties.action = JSON.stringify(action);
  else for (const [key, value] of Object.entries(action)) if (key !== 'kind' && value !== undefined) node.properties[key] = value as VariableValue;
  if (action.kind === 'show') { if (action.afterOffsets) node.properties.afterOffsets = JSON.stringify(action.afterOffsets); if (action.moveOffsets) node.properties.moveOffsets = JSON.stringify(action.moveOffsets); node.properties.presetId = action.presetId ?? ''; node.properties.lifetime = action.lifetime ?? ''; }
  if ('transition' in action && action.duration === undefined) node.properties.duration = action.transition === 'fade' ? 1 : .5;
  if (action.kind === 'audioClip') syncAudioClipPins(node, action);
  if ((action.kind === 'show' || action.kind === 'blueprint') && action.actorTransitions) node.properties.actorTransitions = JSON.stringify(action.actorTransitions);
  if (action.kind === 'visual') syncVisualPins(node, action);
  return node;
}

export function blueprintFromPerformance(project: Project, actions: StageAction[], name = '新的演出'): BlueprintGraph {
  const graph = createBlueprintGraph('effect', name);
  let previous = graph.nodes[0]; previous.x = 360; previous.y = 40;
  for (const [index, action] of actions.entries()) {
    const node = performanceNode(project, action); node.x = 360 + index * 350; node.y = 220;
    graph.nodes.push(node);
    connectBlueprintPins(graph, previous.id, previous.type === 'event' ? 'exec' : 'exec_out', node.id, 'exec_in'); previous = node;
  }
  return graph;
}

export function performanceInputs(graph: BlueprintGraph): PerformanceInput[] {
  return graph.nodes.flatMap(node => node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => ({ nodeId: node.id, pinId: pin.id, name: pin.name, dataType: pin.dataType, defaultValue: blueprintInputValue(node, pin.id) ?? (pin.dataType === 'number' ? 0 : pin.dataType === 'boolean' ? false : '') })));
}

function placeInputReader(graph: BlueprintGraph, read: BlueprintNode, targetId: string) {
  const target = graph.nodes.find(node => node.id === targetId);
  read.x = target ? target.x - 420 : 40;
  read.y = target?.y ?? 70;
  // Reserve full expanded node bounds, as in the node editor's automatic
  // placement. Repeated single-input calls must also avoid earlier readers.
  const height = (node: BlueprintNode) => 150 + Math.max(node.pins.filter(pin => pin.direction === 'input').length, node.pins.filter(pin => pin.direction === 'output').length) * 65;
  for (let attempt = 0; attempt <= graph.nodes.length; attempt++) {
    const overlap = graph.nodes.find(node => read.x < node.x + 350 && read.x + 350 > node.x && read.y < node.y + height(node) + 28 && read.y + height(read) + 28 > node.y);
    if (!overlap) return;
    read.y = overlap.y + height(overlap) + 40;
  }
}

export function exposePerformanceInputs(graph: BlueprintGraph, inputs: PerformanceInput[]) {
  if (graph.exposedInputs.length + inputs.length > maxBlueprintInputs) throw new Error(`一张蓝图最多公开 ${maxBlueprintInputs} 个输入。`);
  const names = new Set(graph.exposedInputs.map(pin => pin.name));
  inputs.forEach(input => {
    const name = input.name.trim();
    if (!name || /[\n，,=：:【】]/.test(name) || names.has(name)) throw new Error('输入名称不能为空、重复或包含逗号、冒号与等号。');
    names.add(name);
    const pin = blueprintPin(makeId('input'), name, 'input', input.dataType, input.defaultValue);
    graph.exposedInputs.push(pin);
    const read = blueprintNodeDefaults('getInput'); read.properties.inputId = pin.id; read.name = `输入 · ${name}`; read.pins[0].dataType = pin.dataType;
    placeInputReader(graph, read, input.nodeId);
    graph.nodes.push(read);
    const error = connectBlueprintPins(graph, read.id, 'value', input.nodeId, input.pinId);
    if (error) throw new Error(error);
  });
}

export function blueprintGroup(project: Project, id: string) {
  const graph = projectGraphs(project).find(graph => graph.id === id);
  return folderTrail(project, graph && project.contentBrowser?.assignments[graphResourceKey(graph)]).map(folder => folder.name).join(' / ');
}
export function assignBlueprintGroup(project: Project, id: string, path: string) {
  let parentId: string | undefined;
  for (const part of path.split(/[/\\]/).map(part => part.trim()).filter(Boolean)) {
    parentId = project.contentBrowser?.folders.find(folder => folder.name === part && folder.parentId === parentId)?.id ?? createContentFolder(project, part, parentId);
    if (!parentId) throw new Error('分组创建失败，名称最多 80 字，文件夹总数最多 512 个。');
  }
  const graph = projectGraphs(project).find(graph => graph.id === id);
  if (!graph || moveContent(project, [graphResourceKey(graph)], parentId) !== 1) throw new Error('资源已不存在，无法移动到文件夹。');
}

export function blueprintInputTarget(graph: BlueprintGraph, id: string, project?: Pick<Project, 'blueprints' | 'timelinePresets'>): { node?: BlueprintNode; pinId?: string } {
  const visited = new Set<string>();
  while (!visited.has(graph.id + '/' + id)) {
    visited.add(graph.id + '/' + id);
    const read = graph.nodes.find(node => node.type === 'getInput' && node.properties.inputId === id);
    const link = graph.links.find(link => link.fromNodeId === read?.id);
    const node = graph.nodes.find(node => node.id === link?.toNodeId);
    const child = node && ['callFunction', 'callMacro'].includes(node.type) && link?.toPinId.startsWith('arg_') ? projectGraphs(project).find(item => item.id === node.properties.graphId) : undefined;
    if (!child) return { node, pinId: link?.toPinId };
    graph = child; id = link!.toPinId.slice(4);
  }
  return {};
}
export function speakerExpression(project: Project, speakerId: string | undefined, override?: VariableValue) {
  const character = effectiveCharacter(project, speakerId ?? '');
  if (!character?.expressions.length) return;
  return override ? character.expressions.find(expression => expression.id === override || expression.name === override) : character.expressions.find(expression => expression.id === character.defaultExpressionId) ?? character.expressions[0];
}
export function addPerformanceToLines(project: Project, action: StageAction, ids?: Set<string>, includeNarration = false) {
  let count = 0;
  for (const node of project.nodes) if (node.kind === 'passage') for (const line of node.lines) {
    if (line.silent || (ids && !ids.has(line.id)) || (!includeNarration && !line.speakerId)) continue;
    if (line.actions.some(existing => action.kind === 'blueprint' && existing.kind === 'blueprint' ? existing.blueprintId === action.blueprintId : JSON.stringify(existing) === JSON.stringify(action))) continue;
    line.actions.push(structuredClone(action)); count++;
  }
  return count;
}
export function savedBlueprintAction(node: BlueprintNode, timeScales?: Map<string, number>): StageAction | undefined {
  try {
    let action = JSON.parse(String(node.properties.action));
    if (action.kind === 'visual') action = applyVisualInputs(action, Object.fromEntries(visualInputFields(action).filter(field => node.properties['object_' + field.key] !== undefined).map(field => [field.key, node.properties['object_' + field.key]])), timeScales);
    if (action.kind === 'audioClip') action = applyAudioClipInputs(action, Object.fromEntries(audioClipFields(action).map(field => [field.key, node.properties['clip_' + field.key]])));
    return actionSchema.parse(action);
  } catch { return undefined; }
}
/** Template before input resolution; execution must apply all overrides together once. */
export function rawSavedBlueprintAction(node: BlueprintNode): StageAction | undefined {
  // Preview and validation inspect ordinary logic nodes too. Most have no
  // serialized action: avoid building and catching a JSON exception for each.
  if (node.type !== 'savedAction' || typeof node.properties.action !== 'string' || !node.properties.action) return undefined;
  try { return actionSchema.parse(JSON.parse(String(node.properties.action))); } catch { return undefined; }
}

/** Edit the authored action, preserving unrelated input overrides and their clocks. */
export function updateSavedBlueprintAction(node: BlueprintNode, action: StageAction) {
  const before = rawSavedBlueprintAction(node), next = actionSchema.parse(action);
  if (!before || before.kind !== next.kind) throw new Error('不能更改已保存演出的类型。');
  const candidate = structuredClone(node);
  if (next.kind === 'visual') updateVisualNodeObject(candidate, next);
  else if (next.kind === 'audioClip' && before.kind === 'audioClip') {
    const keys = new Set([...Object.keys(before), ...Object.keys(next)]) as Set<keyof typeof next>;
    const patch = Object.fromEntries([...keys].filter(key => before[key] !== next[key]).map(key => [key, next[key]]));
    patchAudioClipNode(candidate, patch);
  } else candidate.properties.action = JSON.stringify(next);
  Object.assign(node, candidate);
}
