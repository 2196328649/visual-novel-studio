import { uiPage, uiPageOpenProblem } from './ui-pages';
import { uiPageInterface, uiPageInterfaceKnown, uiPageInputValues } from './ui-page-interface';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from './blueprint';
import { gameFlowPathDiagnostics } from './game-flow-analysis';
import { availableBlueprintName } from './blueprint-names';
import { pageButtonProject, uiPageUsages } from './ui-page-usages';
export { pageButtonProject, pageConnectionButtons, uiPageUsages, type UiPageUsage } from './ui-page-usages';
import { addProjectGraphs, projectGraphs } from './project-resources';
import { createUiEventGraph, ensureUiClickEvent, uiClickHandlers, uiPageComponents } from './ui-logic';
import { editableUiComponent, makeId, maxBlueprintOutputs, type VariableValue, type BlueprintGraph, type CustomUiPage, type Diagnostic, type Project } from './model';
import { gameFlowPhaseNames, type GameFlowPhase } from './game-flow-schema';
import { flowStepNodeId, gameFlowAttachments, gameFlowSteps, gameFlowTopologyDiagnostics } from './game-flow-graph';
import { gameFlowTransitionDiagnostics } from './game-flow-transitions';
import { flowPageOpening, openingModalFromInput, resolveUiPageOpening, uiPageOpeningProblem, type UiPageOpening } from './ui-page-opening';
export { gameFlow, gameFlowSteps, editGameFlowSteps, addGameFlowStep } from './game-flow-graph';

/** New pages separate their event graph from external calls. Old mixed graphs are left untouched. */
export function createCustomUiPage(project: Project, name: string): CustomUiPage {
  if (project.ui.customPages.length >= 64) throw new Error('自定义页面数量已达到上限。');
  const id = makeId('custom_page'), buttonId = makeId('ui');
  const page = { id, name, modal: true, background: project.ui.background, components: [
    { id: makeId('ui'), page: 'custom' as const, kind: 'text' as const, text: name, name: '页面标题', x: .25, y: .2, width: .5, height: .15, style: { align: 'center' as const, fontSize: 32 } },
    { id: buttonId, page: 'custom' as const, kind: 'button' as const, text: '关闭', name: '关闭按钮', x: .4, y: .7, width: .2, height: .1 },
  ] };
  project.ui.customPages.push(page);
  const graph = createUiEventGraph(project, id, name), click = ensureUiClickEvent(project, graph, buttonId, id), close = blueprintNodeDefaults('closeUiPage');
  close.properties = { pageId: id, result: '完成', reason: 'completed' }; close.x = 500; close.y = click.y;
  graph.nodes.push(close); connectBlueprintPins(graph, click.id, 'exec', close.id, 'exec_in'); return page;
}

/** Delete only the page-owned definition; external graphs remain repairable. */
export function removeCustomUiPage(project: Project, pageId: string) {
  if (!project.ui.customPages.some(page => page.id === pageId)) throw new Error('页面已不存在。');
  if (project.minigames.some(game => game.uiPageId === pageId)) throw new Error('旧兼容定义仍引用此页面，请先移除该引用。');
  project.ui.customPages = project.ui.customPages.filter(page => page.id !== pageId);
  if (project.ui.pageInterfaces) {
    delete project.ui.pageInterfaces[pageId];
    if (!Object.keys(project.ui.pageInterfaces).length) delete project.ui.pageInterfaces;
  }
  if (project.ui.pageVariables) {
    delete project.ui.pageVariables[pageId];
    if (!Object.keys(project.ui.pageVariables).length) delete project.ui.pageVariables;
  }
}

export interface UiPageCallOptions { inputs?: Record<string, VariableValue>; saveMode?: 'save' | 'load'; opening?: UiPageOpening }
export function createPageCall(project: Project, pageId: string, wait?: boolean, modal?: boolean, options: UiPageCallOptions = {}): BlueprintGraph {
  const overrides = { ...(wait === undefined ? {} : { wait }), ...(modal === undefined ? {} : { input: modal ? 'block' as const : 'controls' as const }), ...options.opening };
  const settings = resolveUiPageOpening(project, pageId, overrides);
  const page = uiPage(project, pageId), problem = uiPageOpenProblem(project, pageId, settings.wait, openingModalFromInput(settings.input));
  if (!page || problem) throw new Error(problem ?? '页面已不存在。');
  if (projectGraphs(project).length >= 256) throw new Error('蓝图数量已达到上限。');
  const definition = uiPageInterface(project, pageId);
  const openingProblem = uiPageOpeningProblem(project, pageId, overrides);
  if (openingProblem) throw new Error(openingProblem);
  if (!uiPageInterfaceKnown(definition)) throw new Error('页面接口版本不受支持，请先明确恢复接口。');
  if ((definition?.outputs.length ?? 0) + 2 > maxBlueprintOutputs) throw new Error('此页面结果超过入口模块可公开的数量（包括关闭结果与原因）。请在已有蓝图中直接使用“打开页面”节点，不会截断页面结果。');
  const inputs = options.inputs === undefined ? undefined : uiPageInputValues(project, pageId, options.inputs);
  const graph = createBlueprintGraph('function', availableBlueprintName(project, '打开 · ' + page.name));
  const open = blueprintNodeDefaults('showUiPage'); open.properties = { pageId, ...(overrides.wait === undefined ? {} : { wait: overrides.wait }), modalMode: openingModalFromInput(overrides.input), saveMode: options.saveMode ?? 'load' }; open.x = 480;
  open.pageOpening = overrides;
  graph.nodes.push(open);
  graph.exposedInputs = (definition?.inputs ?? []).map(parameter => ({ ...parameter, direction: 'input', ...(inputs && Object.hasOwn(inputs, parameter.id) ? { defaultValue: inputs[parameter.id] } : {}) }));
  graph.exposedOutputs.push(blueprintPin('result', '关闭结果', 'output', 'string', ''), blueprintPin('reason', '关闭原因', 'output', 'string', ''));
  const outputPins = [{ id: 'result', source: 'result' }, { id: 'reason', source: 'reason' }];
  for (const parameter of definition?.outputs ?? []) {
    const id = graph.exposedOutputs.some(pin => pin.id === parameter.id) ? makeId('page_result') : parameter.id;
    graph.exposedOutputs.push({ ...parameter, id, direction: 'output', required: false }); outputPins.push({ id, source: 'out_' + parameter.id });
  }
  let previous = open;
  for (const field of outputPins) {
    const write = blueprintNodeDefaults('setOutput'); write.properties.outputId = field.id; write.x = previous.x + 420; graph.nodes.push(write);
    connectBlueprintPins(graph, previous.id, 'exec_out', write.id, 'exec_in'); previous = write;
  }
  for (const [index, parameter] of graph.exposedInputs.entries()) {
    const read = blueprintNodeDefaults('getInput'); read.properties.inputId = parameter.id; read.x = 60; read.y = 300 + index * 180; graph.nodes.push(read);
  }
  addProjectGraphs(project, graph); synchronizeBlueprintSignatures(project);
  connectBlueprintPins(graph, graph.nodes[0].id, 'exec', open.id, 'exec_in');
  for (const write of graph.nodes.filter(node => node.type === 'setOutput')) connectBlueprintPins(graph, open.id, outputPins.find(pin => pin.id === write.properties.outputId)!.source, write.id, 'value');
  for (const read of graph.nodes.filter(node => node.type === 'getInput')) connectBlueprintPins(graph, read.id, 'value', open.id, 'arg_' + read.properties.inputId);
  return graph;
}

export function connectPageToStory(project: Project, pageId: string, nodeId: string, lineId?: string, wait?: boolean, modal?: boolean, options: UiPageCallOptions = {}) {
  const node = project.nodes.find(n => n.id === nodeId); if (node?.kind !== 'passage') throw new Error('请先选择要插入页面的剧情段落或台词。');
  const line = node.lines.find(l => l.id === lineId) ?? node.lines[0]; if (!line) throw new Error('当前段落没有台词。');
  const graph = createPageCall(project, pageId, wait, modal, { ...options, inputs: options.inputs ?? {} }); line.actions.push({ kind: 'blueprint', blueprintId: graph.id }); return graph;
}

export function connectPageToButton(project: Project, pageId: string, buttonPageId: string, componentId: string, mode: 'append' | 'replace', wait?: boolean, modal?: boolean, instanceId?: string, options: UiPageCallOptions = {}) {
  const scoped = pageButtonProject(project, instanceId);
  if (!uiPageComponents(scoped, buttonPageId).some(c => c.id === componentId && c.kind === 'button')) throw new Error('按钮已不存在或不属于所选页面。');
  if (buttonPageId === pageId) throw new Error('页面不能通过自己的按钮重复打开自身，请选择其他页面的按钮。');
  const targetInstance = buttonPageId.startsWith('ui:') ? scoped.ui.activeInstanceId ?? 'base' : 'base';
  if (uiPageUsages(project, pageId).some(use => use.componentId === componentId && use.pageId === buttonPageId && (use.instanceId ?? 'base') === targetInstance && !(mode === 'replace' && use.key.endsWith(':action')))) throw new Error('此按钮已经接入该页面，请修改现有调用。');
  // Resolve inherited controls into the chosen scheme without changing the active game scheme.
  let component;
  if (buttonPageId.startsWith('ui:')) {
    const active = project.ui.activeInstanceId;
    try { project.ui.activeInstanceId = scoped.ui.activeInstanceId; component = editableUiComponent(project.ui, componentId); }
    finally { project.ui.activeInstanceId = active; }
  } else component = project.ui.customPages.find(p => p.id === buttonPageId)!.components.find(c => c.id === componentId);
  if (!component) throw new Error('按钮已不存在。');
  const previous = component.events?.beforeClick, graph = createPageCall(project, pageId, wait, modal, { ...options, inputs: options.inputs ?? {} });
  if (mode === 'replace') { component.action = 'blueprint'; component.blueprintId = graph.id; component.clickMode = 'replace'; if (component.events) delete component.events.beforeClick; }
  else {
    if (previous) {
      const call = blueprintNodeDefaults('callFunction'); call.properties.graphId = previous; graph.nodes.push(call); synchronizeBlueprintSignatures(project);
      const entry = graph.nodes[0], link = graph.links.find(l => l.fromNodeId === entry.id && l.fromPinId === 'exec');
      if (link) { const target = link.toNodeId; graph.links = graph.links.filter(l => l !== link); connectBlueprintPins(graph, entry.id, 'exec', call.id, 'exec_in'); connectBlueprintPins(graph, call.id, 'exec_out', target, 'exec_in'); }
    }
    component.events = { ...component.events, beforeClick: graph.id };
  }
  return graph;
}

export function gameFlowDiagnostics(project: Project): Diagnostic[] {
  const result: Diagnostic[] = [...gameFlowTopologyDiagnostics(project), ...gameFlowTransitionDiagnostics(project)], ids = new Set<string>(), attachments = gameFlowAttachments(project);
  for (const phase of ['beforeTitle', 'beforeNewGame'] as const) for (const step of gameFlowSteps(project, phase)) {
    const issue = (message: string, nodeId?: string) => result.push({ severity: 'error', code: 'gameFlow.' + phase, message: gameFlowPhaseNames[phase] + '：' + message, nodeId, gameFlow: { phase, stepId: step.id } });
    if (ids.has(step.id)) issue('步骤标识重复。'); ids.add(step.id);
    if (step.kind === 'page') {
      const settings = flowPageOpening(project, step);
      const page = uiPage(project, step.pageId), problem = uiPageOpenProblem(project, step.pageId, settings.wait, openingModalFromInput(settings.input)) ?? uiPageOpeningProblem(project, step.pageId, settings);
      if (problem) issue(problem);
      if (attachments.get(flowStepNodeId(step.id)) === 'beforeTitle' && step.pageId === 'ui:save' && step.saveMode === 'save') issue('标题前没有可保存的游戏进度；请选择读取存档，保存应在进入游戏后进行。');
      if (page?.template && step.completion !== 'close') issue('系统模板由其菜单宿主关闭；自动完成或附加确认只用于普通页面。');
      try { uiPageInputValues(project, step.pageId, step.inputs); } catch (error) { issue(error instanceof Error ? error.message : String(error)); }
      if (!settings.wait && step.completion !== 'close') issue('显示后继续的页面请用“自动关闭”设置停留时间；确认完成需要等待关闭。');
    } else if (step.kind === 'video') {
      if (!project.assets.some(a => a.id === step.assetId && a.kind === 'video')) issue('请选择有效的视频素材。');
    } else {
      const graph = projectGraphs(project).find(g => g.id === step.graphId);
      if (!graph) { issue('调用的蓝图已不存在。'); continue; }
      if (graph.uiPageId) issue('页面事件图由页面触发，请添加页面步骤或使用外部调用流程。', graph.nodes[0]?.id);
      // Runtime requirements are checked only on reachable routes, below.
      if (!graph.nodes.some(n => n.type === 'event')) issue('蓝图缺少调用入口。');
    }
  }
  return [...result, ...gameFlowPathDiagnostics(project)];
}
