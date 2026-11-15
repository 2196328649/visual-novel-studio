import { makeId, maxBlueprintInputs, maxBlueprintOutputs, type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Project, type UiPageInterface, type UiPageParameter, type VariableValue } from './model';
import { projectGraphs } from './project-resources';
import { uiPage } from './ui-pages';
import { gameFlowSteps } from './game-flow-graph';
import { gameFlowPhaseNames, type GameFlowPhase } from './game-flow-schema';
import { blueprintPageOpening } from './ui-page-opening';

export const uiPageInterfaceVersion = 1;
export const uiPageParameterTypes = { boolean: '开关', number: '数值', string: '文字', asset: '素材', scene: '场景', character: '角色', ui: '页面', component: '控件' } as const;
export const uiPageLifecyclePhases = {
  created: { name: '页面创建时', hint: '实例创建后、显示事件前执行一次。输入已固定，页面状态已可用；重新显示或读档不会再次创建。' },
  focusGained: { name: '页面获得焦点时', hint: '成为最上层可交互页面时执行。模态子页关闭后可再次获得焦点；不是控件的鼠标悬停。' },
  focusLost: { name: '页面失去焦点时', hint: '被其他页面或系统菜单遮挡，或普通关闭前执行；强制退出直接派发关闭完成。页面仍打开时，失焦不会清空实例状态。' },
  closeRequested: { name: '请求关闭页面时', hint: '普通完成／取消请求会先执行这里。可等待确认，再用“阻止本次关闭”保留页面。父页关闭、流程跳转、读档替换不允许阻止。' },
  closed: { name: '页面关闭完成时', hint: '实例已经失效，结果为只读快照；可写作品状态，不能再读写已释放的页面状态或启动页面任务。等待调用者只恢复一次。' },
} as const;
export type UiPageLifecyclePhase = keyof typeof uiPageLifecyclePhases;
export const uiPageInterfaceCatalog = {
  eventPage: { keywords: ["Page Lifecycle","OnCreate","OnFocus","OnBlur","OnCloseRequested","OnClosed","页面事件","创建","销毁"], name: '页面生命周期事件', category: '界面与动画' as const, hint: '内置模板与新增页面共用创建、焦点、关闭请求和关闭完成事件。页面显示继续使用原有“页面显示时”。' },
  getPageInput: { keywords: ["Get Page Input","页面参数","输入快照"], name: '读取页面输入', category: '复用与参数' as const, hint: '读取打开当前页面时的类型化输入快照。不是作品变量，也不会随调用者后来改值。' },
  getPageOutput: { keywords: ["Get Page Output","返回值","结果快照"], name: '读取页面结果', category: '复用与参数' as const, hint: '读取本实例已写入的类型化结果；未写入时使用接口默认值。关闭完成事件读取关闭快照。' },
  setPageOutput: { keywords: ["Set Page Output","设置返回值","暂存结果"], name: '设置页面结果', category: '复用与参数' as const, hint: '设置本实例的类型化返回结果。只有正常完成才交给等待者；取消使用输出默认值。' },
  preventPageClose: { keywords: ["Prevent Close","Cancel Close","否决关闭","关闭确认"], name: '阻止本次关闭', category: '界面与动画' as const, hint: '仅在当前页面的关闭请求事件链中有效。可先等待确认；不阻止父页面关闭或流程退出。' },
};
export function uiPageInterface(project: Project, pageId: string): UiPageInterface | undefined { return project.ui.pageInterfaces?.[pageId]; }
export function uiPageInterfaceKnown(definition: UiPageInterface | undefined) { return !definition || definition.version === uiPageInterfaceVersion; }
export function uiPageNodeContractId(graph: BlueprintGraph, node: Pick<BlueprintNode, 'properties'>): string {
  return String(node.properties.interfacePageId || node.properties.pageId || graph.uiPageId || '');
}
export function uiPageNodePageId(graph: BlueprintGraph, node: Pick<BlueprintNode, 'properties'>): string { return String(node.properties.pageId || graph.uiPageId || ''); }
export function uiPageParameterDefault(parameter: Pick<UiPageParameter, 'dataType' | 'defaultValue'>): VariableValue { return parameter.defaultValue ?? (parameter.dataType === 'number' ? 0 : parameter.dataType === 'boolean' ? false : ''); }
export function validUiPageParameterValue(type: UiPageParameter['dataType'], value: unknown): value is VariableValue {
  return type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === (type === 'boolean' ? 'boolean' : 'string');
}
export function uiPageOutputDefaults(project: Project, pageId: string) { return Object.fromEntries((uiPageInterface(project, pageId)?.outputs ?? []).map(parameter => [parameter.id, uiPageParameterDefault(parameter)])); }
export function uiPageInputValues(project: Project, pageId: string, supplied: Record<string, VariableValue> = {}, system = false): Record<string, VariableValue> {
  const definition = uiPageInterface(project, pageId);
  if (!uiPageInterfaceKnown(definition)) throw new Error('页面接口版本不受支持，请先明确恢复接口。');
  // Legacy flow steps could pass untyped named inputs before author interfaces existed.
  if (!definition) return { ...supplied };
  const values: Record<string, VariableValue> = {};
  for (const parameter of definition?.inputs ?? []) {
    if (parameter.required && parameter.defaultValue === undefined && !Object.hasOwn(supplied, parameter.id)) throw new Error('缺少页面输入「' + parameter.name + '」。' + (system ? '系统打开需要接口默认值。' : ''));
    const value = Object.hasOwn(supplied, parameter.id) ? supplied[parameter.id] : uiPageParameterDefault(parameter);
    if (!validUiPageParameterValue(parameter.dataType, value)) throw new Error('页面输入「' + parameter.name + '」类型不匹配。');
    values[parameter.id] = value;
  }
  for (const id of Object.keys(supplied)) if (!definition?.inputs.some(parameter => parameter.id === id)) throw new Error('页面输入定义已不存在：' + id);
  return values;
}
export function uiPageContractProblem(project: Project, pageId: string, contractId: string): string | undefined {
  const actual = uiPageInterface(project, pageId), expected = uiPageInterface(project, contractId);
  if (!uiPage(project, pageId) || !uiPage(project, contractId)) return '页面或接口声明页已不存在。';
  if (!uiPageInterfaceKnown(actual) || !uiPageInterfaceKnown(expected)) return '页面接口版本不受支持，请先明确恢复接口。';
  for (const direction of ['inputs', 'outputs'] as const) for (const parameter of expected?.[direction] ?? []) {
    const found = actual?.[direction].find(item => item.id === parameter.id);
    if (!found || found.dataType !== parameter.dataType) return '目标页面与声明接口的' + (direction === 'inputs' ? '输入' : '输出') + '「' + parameter.name + '」不兼容。';
  }
}
const pin = (id: string, name: string, direction: BlueprintPin['direction'], dataType: BlueprintPin['dataType'] = 'exec', defaultValue?: VariableValue): BlueprintPin => ({ id, name, direction, dataType, required: false, ...(defaultValue === undefined ? {} : { defaultValue }) });
export function isUiPageInterfaceNode(type: BlueprintNode['type']) { return ['showUiPage', 'closeUiPage', ...Object.keys(uiPageInterfaceCatalog)].includes(type); }
export function uiPageNodePins(project: Project, graph: BlueprintGraph, node: BlueprintNode): BlueprintPin[] | undefined {
  if (!isUiPageInterfaceNode(node.type)) return;
  const pageId = uiPageNodeContractId(graph, node), definition = uiPageInterface(project, pageId);
  if (!uiPageInterfaceKnown(definition) || pageId && !uiPage(project, pageId)) return;
  const input = pin('exec_in', '执行', 'input'), output = pin('exec_out', '完成', 'output'), page = pin('pageId', '页面', 'input', 'ui', uiPageNodePageId(graph, node));
  if (node.type === 'showUiPage') return [input, page, pin('wait', '等待关闭', 'input', 'boolean', blueprintPageOpening(project, pageId, node).wait), pin('modalMode', '底层输入', 'input', 'string', 'page'),
    ...(definition?.inputs ?? []).map(parameter => ({ ...parameter, id: 'arg_' + parameter.id, direction: 'input' as const })),
    ...(node.properties.pageId === 'ui:save' || graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'pageId') ? [pin('saveMode', '存读档用途', 'input', 'string', 'load')] : []),
    output, pin('result', '关闭文字（兼容）', 'output', 'string', ''), pin('reason', '关闭原因', 'output', 'string', ''),
    ...(definition?.outputs ?? []).map(parameter => ({ ...parameter, id: 'out_' + parameter.id, direction: 'output' as const, required: false, defaultValue: uiPageParameterDefault(parameter) }))];
  if (node.type === 'closeUiPage') return [input, page, pin('result', '关闭文字（兼容）', 'input', 'string', '完成'), pin('reason', '关闭原因', 'input', 'string', 'completed'),
    ...(definition?.outputs ?? []).map(parameter => ({ ...parameter, id: 'out_' + parameter.id, direction: 'input' as const, required: false, defaultValue: undefined })), output];
  if (node.type === 'eventPage') return [pin('exec', '执行', 'output'), pin('result', '关闭文字（兼容）', 'output', 'string', ''), pin('reason', '原因', 'output', 'string', ''),
    ...(definition?.outputs ?? []).map(parameter => ({ ...parameter, id: 'out_' + parameter.id, direction: 'output' as const, required: false, defaultValue: uiPageParameterDefault(parameter) }))];
  if (node.type === 'preventPageClose') return [input, page, output];
  const parameter = (node.type === 'getPageInput' ? definition?.inputs : definition?.outputs)?.find(parameter => parameter.id === node.properties.parameterId);
  // Keep the last known value pin when a definition goes missing. It remains repairable.
  const previous = node.pins.find(pin => pin.id === 'value');
  const value = pin('value', parameter?.name ?? previous?.name ?? '值', node.type === 'setPageOutput' ? 'input' : 'output', parameter?.dataType ?? previous?.dataType ?? 'string', parameter ? uiPageParameterDefault(parameter) : previous?.defaultValue);
  return node.type === 'setPageOutput' ? [input, page, value, output] : [page, value];
}
export type UiPageInterfaceUsage = { key: string; label: string; links: number } & ({ kind: 'node'; graphId: string; nodeId: string } | { kind: 'flow'; phase: GameFlowPhase; stepId: string });
export function uiPageInterfaceUsages(project: Project, pageId: string, direction?: 'inputs' | 'outputs', parameterId?: string): UiPageInterfaceUsage[] {
  const nodes: UiPageInterfaceUsage[] = projectGraphs(project).flatMap(graph => graph.nodes.filter(node => isUiPageInterfaceNode(node.type) && uiPageNodeContractId(graph, node) === pageId).flatMap(node => {
    const selected = node.type === 'getPageInput' ? direction !== 'outputs' : ['getPageOutput', 'setPageOutput'].includes(node.type) ? direction !== 'inputs' : node.type === 'showUiPage' || direction !== 'inputs' && ['closeUiPage', 'eventPage'].includes(node.type);
    if (!selected || parameterId && ['getPageInput', 'getPageOutput', 'setPageOutput'].includes(node.type) && node.properties.parameterId !== parameterId) return [];
    const ids = new Set(parameterId ? [node.type === 'showUiPage' && direction === 'inputs' ? 'arg_' + parameterId : 'out_' + parameterId, 'value'] : node.pins.map(pin => pin.id));
    const links = graph.links.filter(link => link.fromNodeId === node.id && ids.has(link.fromPinId) || link.toNodeId === node.id && ids.has(link.toPinId));
    return [{ kind: 'node' as const, key: graph.id + '/' + node.id, label: graph.name + ' · ' + node.name, graphId: graph.id, nodeId: node.id, links: links.length }];
  }));
  const steps: UiPageInterfaceUsage[] = direction === 'outputs' ? [] : (['beforeTitle', 'beforeNewGame'] as const).flatMap(phase => gameFlowSteps(project, phase).filter(step => step.kind === 'page' && step.pageId === pageId).map(step => ({ kind: 'flow' as const, key: 'flow/' + step.id, phase, stepId: step.id, label: gameFlowPhaseNames[phase] + ' · ' + (step.name || uiPage(project, pageId)?.name || pageId) + (parameterId && step.kind === 'page' && Object.hasOwn(step.inputs ?? {}, parameterId) ? '（已填实参）' : '（使用接口默认值）'), links: 0 })));
  return [...nodes, ...steps];
}
function editableInterface(project: Project, pageId: string): UiPageInterface {
  if (!uiPage(project, pageId)) throw new Error('页面已不存在。');
  const definition = uiPageInterface(project, pageId);
  if (!uiPageInterfaceKnown(definition)) throw new Error('未知版本不可自动修改，请先明确恢复。');
  return definition ?? { version: uiPageInterfaceVersion, inputs: [], outputs: [] };
}
export function changeUiPageParameter(project: Project, pageId: string, direction: 'inputs' | 'outputs', parameter: UiPageParameter, creating = false) {
  const definition = editableInterface(project, pageId), parameters = definition[direction], name = parameter.name.trim();
  if (!name || name.length > 120 || parameters.some(other => other.id !== parameter.id && other.name === name)) throw new Error('请输入当前接口内未使用的名称，最多 120 字。');
  if (parameter.defaultValue !== undefined && !validUiPageParameterValue(parameter.dataType, parameter.defaultValue)) throw new Error('接口默认值与声明类型不匹配。');
  if (creating ? parameters.some(other => other.id === parameter.id) || parameters.length >= (direction === 'inputs' ? maxBlueprintInputs : maxBlueprintOutputs) : !parameters.some(other => other.id === parameter.id)) throw new Error('参数已不存在、标识重复或达到数量上限。');
  const next = { ...parameter, name, direction: direction === 'inputs' ? 'input' as const : 'output' as const, required: direction === 'inputs' && parameter.required };
  (project.ui.pageInterfaces ??= {})[pageId] = { ...definition, [direction]: creating ? [...parameters, next] : parameters.map(other => other.id === parameter.id ? next : other) };
  return next;
}
export function createUiPageParameter(project: Project, pageId: string, direction: 'inputs' | 'outputs', name: string, dataType: UiPageParameter['dataType']) {
  return changeUiPageParameter(project, pageId, direction, { id: makeId('pageparam'), name, dataType, direction: direction === 'inputs' ? 'input' : 'output', required: false, defaultValue: uiPageParameterDefault({ dataType }) }, true);
}
export function removeUiPageParameter(project: Project, pageId: string, direction: 'inputs' | 'outputs', parameterId: string) {
  const definition = editableInterface(project, pageId);
  (project.ui.pageInterfaces ??= {})[pageId] = { ...definition, [direction]: definition[direction].filter(parameter => parameter.id !== parameterId) };
}
export function recoverUiPageInterface(project: Project, pageId: string) {
  const old = uiPageInterface(project, pageId);
  (project.ui.pageInterfaces ??= {})[pageId] = { version: uiPageInterfaceVersion, inputs: [], outputs: [], recovery: JSON.stringify(old ?? null) };
}

export const uiPageClosedOperations = ['showUiPage', 'closeUiPage', 'preventPageClose', 'setPageOutput', 'delay', 'confirmMessage', 'uiAction', 'switchScene', 'startDialogue', 'sceneAction', 'savedAction', 'effect', 'showBackground', 'showCharacter', 'hideCharacter', 'showChapter', 'camera', 'shake', 'getUiControlOption', 'editUiControlOptions', 'focusUiComponent', 'setUiControlRange', 'resetUiControlRange', 'setUiProperty', 'getUiProperty', 'getUiDefault', 'resetUiProperty', 'animateUiProperty', 'playUiAnimation', 'stopUiAnimation', 'stopUiAnimationPlayback', 'resetUiComponent', 'playUiVideo', 'pauseUiVideo', 'stopUiVideo', 'playSpine', 'pauseSpine', 'setSpineSpeed', 'startTask', 'debounce', 'waitTask', 'finishMinigame', 'getMinigameValue', 'setMinigameValue'] as const;
export function uiPageClosedOperationProblem(node: Pick<BlueprintNode, 'type' | 'properties'>): string | undefined {
  if ((uiPageClosedOperations as readonly string[]).includes(node.type) || node.properties.scope === 'page' && ['getVariable', 'setVariable', 'doOnce', 'gate', 'throttle'].includes(node.type)) return '页面关闭完成事件只允许同步通知与结果快照读取；等待、导航或页面资源操作请放在打开页面的完成路线。';
}
