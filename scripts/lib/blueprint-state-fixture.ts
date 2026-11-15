import assert from 'node:assert/strict';
import { createBlueprintInvocationFixture } from './blueprint-invocation-fixture';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import type { BlueprintGraph, BlueprintNode, UiComponent, VariableValue } from '../../src/core/model';

/** The same fixture is interpreted in the editor and compiled for Ren'Py. */
export function createBlueprintStateFixture() {
  const fixture = createBlueprintInvocationFixture(), { project, root, childA, childB } = fixture;
  project.id = 'blueprint_author_state'; project.name = '通用页面与作者状态验收';
  for (const id of ['state_event_local', 'state_last_page', 'state_shared_read', 'state_native_done']) project.variables.push({ id, name: id, type: 'number', initial: 0, persistent: false });
  project.variables.push({ id: 'state_native_result', name: '菜单返回结果', type: 'string', initial: '', persistent: false });
  const node = (graph: BlueprintGraph, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => {
    const item = blueprintNodeDefaults(type); Object.assign(item.properties, properties); graph.nodes.push(item); return item;
  };
  const wire = (graph: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = 'exec_out', input = 'exec_in') => {
    synchronizeBlueprintSignatures(project);
    assert.equal(connectBlueprintPins(graph, from.id, from.type.startsWith('event') && output === 'exec_out' ? 'exec' : output, to.id, input), undefined);
  };
  const chain = (graph: BlueprintGraph, ...nodes: BlueprintNode[]) => nodes.slice(1).forEach((next, index) => wire(graph, nodes[index], next));
  const graph = (name: string) => { const item = createBlueprintGraph('function', name); project.blueprints.push(item); return item; };
  // Preserve the existing concurrency/save scenarios, but now the return value
  // is read from an author-declared local AFTER its wait, not a generated slot.
  for (const target of [fixture.snapshot, fixture.cache]) {
    target.localVariables = [{ id: 'captured', name: '本次快照', type: 'number', initial: -99, description: '跨等待保留，下一次调用重新初始化。' }];
    const result = target.nodes.find(node => node.type === 'setOutput')!, pause = target.nodes.find(node => node.type === 'delay')!;
    const valueLink = target.links.find(link => link.toNodeId === result.id && link.toPinId === 'value')!;
    const write = node(target, 'setVariable', { scope: 'call', variableId: 'captured', value: 0 });
    const read = node(target, 'getVariable', { scope: 'call', variableId: 'captured' });
    valueLink.toNodeId = write.id;
    wire(target, read, result, 'value', 'value');
    if (target === fixture.snapshot) {
      const incoming = target.links.find(link => link.toNodeId === result.id && link.toPinId === 'exec_in')!;
      const outgoing = target.links.find(link => link.fromNodeId === result.id && link.fromPinId === 'exec_out')!;
      incoming.toNodeId = write.id; outgoing.fromNodeId = write.id;
      const afterPause = target.links.find(link => link.fromNodeId === pause.id && link.fromPinId === 'exec_out')!;
      const final = target.nodes.find(node => node.id === afterPause.toNodeId)!;
      afterPause.toNodeId = result.id; wire(target, result, final);
    } else {
      const cached = target.nodes.find(node => node.type === 'callFunction')!;
      const outgoing = target.links.find(link => link.fromNodeId === cached.id && link.fromPinId === 'exec_out')!;
      const next = target.nodes.find(node => node.id === outgoing.toNodeId)!;
      outgoing.toNodeId = write.id; wire(target, write, next);
    }
  }
  const counterId = 'page_counter';
  project.ui.pageVariables = Object.fromEntries([[root.id, 0], [childA.id, 10], [childB.id, 20], ['ui:preferences', 100]].map(([pageId, initial]) => [pageId, [{ id: counterId, name: '页面计数', type: 'number' as const, initial: initial as number }]]));
  const readPage = graph('读取传入页面的状态');
  readPage.exposedInputs = [blueprintPin('page', '目标页面', 'input', 'ui', root.id)];
  readPage.exposedOutputs = [blueprintPin('value', '页面当前值', 'output', 'number', 0)];
  const pageInput = node(readPage, 'getInput', { inputId: 'page' });
  const pageRead = node(readPage, 'getVariable', { scope: 'page', pageId: root.id, variableId: counterId });
  const pageOutput = node(readPage, 'setOutput', { outputId: 'value' });
  wire(readPage, pageInput, pageRead, 'value', 'pageId'); wire(readPage, pageRead, pageOutput, 'value', 'value'); chain(readPage, readPage.nodes[0], pageOutput);
  const button = (id: string, text: string, page: UiComponent['page'], x: number, y: number, width = .3): UiComponent => ({ id, text, page, kind: 'button', x, y, width, height: .075 });
  const pageGraphs: BlueprintGraph[] = [];
  const installCounter = (pageId: string, component: UiComponent) => {
    const g = graph(component.text + '事件'); g.kind = 'ui'; g.uiPageId = pageId; if (pageId.startsWith('ui:')) g.uiInstanceId = 'base'; pageGraphs.push(g);
    g.localVariables = [{ id: 'event_counter', name: '本事件计数', type: 'number', initial: 0 }];
    const event = node(g, 'eventClick', { componentId: component.id });
    const localRead = node(g, 'getVariable', { scope: 'call', variableId: 'event_counter' });
    const localAdd = node(g, 'math', { b: 1 }), localWrite = node(g, 'setVariable', { scope: 'call', variableId: 'event_counter', value: 0 });
    wire(g, localRead, localAdd, 'value', 'a'); wire(g, localAdd, localWrite, 'result', 'value');
    const pageRead = node(g, 'getVariable', { scope: 'page', pageId, variableId: counterId });
    const pageAdd = node(g, 'math', { b: 1 }), pageWrite = node(g, 'setVariable', { scope: 'page', pageId, variableId: counterId, value: 0 });
    wire(g, pageRead, pageAdd, 'value', 'a'); wire(g, pageAdd, pageWrite, 'result', 'value');
    const localCapture = node(g, 'setVariable', { variableId: 'state_event_local', value: 0 }); wire(g, localRead, localCapture, 'value', 'value');
    const call = node(g, 'callFunction', { graphId: readPage.id, arg_page: pageId });
    const capture = node(g, 'setVariable', { variableId: 'state_shared_read', value: 0 }); wire(g, call, capture, 'out_value', 'value');
    const pageCapture = node(g, 'setVariable', { variableId: 'state_last_page', value: 0 }); wire(g, pageRead, pageCapture, 'value', 'value');
    chain(g, event, localWrite, pageWrite, localCapture, call, capture, pageCapture);
    return g;
  };
  root.components[1].y = .88;
  const rootIncrement = button('state_root_increment', '页面状态 +1', 'custom', .07, .74, .26); root.components.push(rootIncrement); installCounter(root.id, rootIncrement);
  const childIncrement = button('state_child_increment', '子页面状态 +1', 'custom', .35, .5); childA.components.push(childIncrement); installCounter(childA.id, childIncrement);
  project.ui.pages = { ...project.ui.pages, preferences: { layout: 'custom' } };
  const nativeIncrement = button('state_native_increment', '模板页面状态 +1', 'preferences', .35, .3);
  const nativeChild = button('state_native_child', '打开子页面', 'preferences', .35, .45);
  const nativeClose = button('state_native_close', '返回并给出结果', 'preferences', .35, .65);
  project.ui.components.push(nativeIncrement, nativeChild, nativeClose);
  installCounter('ui:preferences', nativeIncrement);
  const openChild = graph('模板调用普通页面'); chain(openChild, openChild.nodes[0], node(openChild, 'showUiPage', { pageId: childA.id, wait: true })); nativeChild.action = 'blueprint'; nativeChild.blueprintId = openChild.id;
  const closeNative = graph('关闭模板页面'); chain(closeNative, closeNative.nodes[0], node(closeNative, 'closeUiPage', { pageId: 'ui:preferences', result: 'native-ok' })); nativeClose.action = 'blueprint'; nativeClose.blueprintId = closeNative.id;
  const nativeCaller = graph('通用打开页面调用模板'), openNative = node(nativeCaller, 'showUiPage', { pageId: 'ui:preferences', wait: true });
  const nativeResult = node(nativeCaller, 'setVariable', { variableId: 'state_native_result', value: '' }); wire(nativeCaller, openNative, nativeResult, 'result', 'value');
  chain(nativeCaller, nativeCaller.nodes[0], openNative, nativeResult, node(nativeCaller, 'setVariable', { variableId: 'state_native_done', value: 1 }));
  const nativeButton = button('state_open_native', '打开模板页面', 'custom', .36, .74, .28); nativeButton.action = 'blueprint'; nativeButton.blueprintId = nativeCaller.id; root.components.push(nativeButton);
  const childButton = button('state_open_child', '打开子页面', 'custom', .67, .74, .26); childButton.action = 'blueprint'; childButton.blueprintId = openChild.id; root.components.push(childButton);
  synchronizeBlueprintSignatures(project);
  return { ...fixture, counterId, readPage, pageGraphs, rootIncrement, childIncrement, nativeIncrement, nativeChild, nativeClose, nativeCaller };
}
