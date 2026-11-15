import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createCustomUiPage } from '../../src/core/game-flow';
import { createUiEventGraph, ensureUiClickEvent } from '../../src/core/ui-logic';

/** Ordinary pages and modules; no trace-specific runtime state or game mechanism. */
export function createBlueprintTraceFixture() {
  const project = createProject('蓝图执行轨迹验收'); project.id = 'blueprint_trace_fixture';
  project.variables.push({ id: 'trace_result', name: '作品观察结果', type: 'number', initial: -1, persistent: false });
  const root = createCustomUiPage(project, '执行轨迹测试页'), child = createCustomUiPage(project, '可取消的子页面');
  root.components[0].y = .06; root.components[1].y = .86;
  const rootGraph = project.blueprints.find(graph => graph.uiPageId === root.id)!;
  const node = (graph: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}, name?: string) => {
    const value = blueprintNodeDefaults(type); Object.assign(value.properties, properties); if (name) value.name = name; graph.nodes.push(value); return value;
  };
  const graph = (name: string) => { const value = createBlueprintGraph('function', name); project.blueprints.push(value); return value; };
  const wire = (graph: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, out = 'exec_out', input = 'exec_in') => {
    synchronizeBlueprintSignatures(project);
    assert.equal(connectBlueprintPins(graph, from.id, from.type.startsWith('event') && out === 'exec_out' ? 'exec' : out, to.id, input), undefined);
  };
  const chain = (graph: BlueprintGraph, ...nodes: BlueprintNode[]) => nodes.slice(1).forEach((next, index) => wire(graph, nodes[index], next));
  const values = graph('零值、假值与空文本');
  values.localVariables = [{ id: 'zero', name: '零值', type: 'number', initial: 8 }, { id: 'false', name: '假值', type: 'boolean', initial: true }, { id: 'empty', name: '空文本', type: 'string', initial: '初始文本' }];
  values.exposedOutputs = [blueprintPin('number', '返回零值', 'output', 'number', 0)];
  const writes = [node(values, 'setVariable', { scope: 'call', variableId: 'zero', value: 0 }, '写入零值'), node(values, 'setVariable', { scope: 'call', variableId: 'false', value: false }, '写入假值'), node(values, 'setVariable', { scope: 'call', variableId: 'empty', value: '' }, '写入空文本')];
  const pause = node(values, 'delay', { seconds: .4 }, '等待 0.4 秒');
  const readZero = node(values, 'getVariable', { scope: 'call', variableId: 'zero' }, '读取本次零值'), output = node(values, 'setOutput', { outputId: 'number', value: 0 }, '返回观察值');
  wire(values, readZero, output, 'value', 'value'); chain(values, values.nodes[0], ...writes, pause, output);
  const parent = graph('嵌套观察调用'), childCall = node(parent, 'callFunction', { graphId: values.id }, '调用值观察模块');
  const capture = node(parent, 'setVariable', { scope: 'project', variableId: 'trace_result', value: -1 }, '读取子调用返回值');
  wire(parent, childCall, capture, 'out_number', 'value'); chain(parent, parent.nodes[0], childCall, capture);
  project.ui.pageVariables = { [root.id]: [{ id: 'clicks', name: '已完成调用', type: 'number', initial: 0 }], 'ui:preferences': [{ id: 'clicks', name: '已完成调用', type: 'number', initial: 0 }] };
  const button = (id: string, text: string, page: UiComponent['page'], x: number, y: number): UiComponent => ({ id, name: text, text, page, kind: 'button', x, y, width: .4, height: .11 });
  const observe = button('trace_observe', '观察零值、假值和空文本', 'custom', .06, .27), concurrent = button('trace_concurrent', '并发执行同一模块', 'custom', .54, .27);
  const unsupported = button('trace_unsupported', '检查未支持的预览能力', 'custom', .06, .45), openChild = button('trace_open_child', '打开子页后等待', 'custom', .54, .45);
  root.components.push(observe, concurrent, unsupported, openChild);
  const install = (pageId: string, pageGraph: BlueprintGraph, component: UiComponent) => {
    const event = ensureUiClickEvent(project, pageGraph, component.id, pageId), call = node(pageGraph, 'callFunction', { graphId: parent.id }, '事件调用观察模块');
    const read = node(pageGraph, 'getVariable', { scope: 'page', pageId, variableId: 'clicks' }), add = node(pageGraph, 'math', { b: 1 }), write = node(pageGraph, 'setVariable', { scope: 'page', pageId, variableId: 'clicks', value: 0 }, '记录已完成调用');
    wire(pageGraph, read, add, 'value', 'a'); wire(pageGraph, add, write, 'result', 'value'); chain(pageGraph, event, call, write);
    return { event, call, write };
  };
  const primary = install(root.id, rootGraph, observe), second = install(root.id, rootGraph, concurrent);
  const unsupportedEvent = ensureUiClickEvent(project, rootGraph, unsupported.id, root.id), unsupportedNode = node(rootGraph, 'switchScene', { sceneId: project.scenes[0].id }, '实际游戏切换场景');
  chain(rootGraph, unsupportedEvent, unsupportedNode);
  const childEvent = ensureUiClickEvent(project, rootGraph, openChild.id, root.id), open = node(rootGraph, 'showUiPage', { pageId: child.id, wait: true }, '等待子页面关闭'); chain(rootGraph, childEvent, open);
  const template = button('trace_template', '模板页面调用观察模块', 'preferences', .3, .3), templateClose = button('trace_template_close', '返回', 'preferences', .3, .6); templateClose.action = 'return';
  project.ui.pages = { preferences: { layout: 'custom' } }; project.ui.components.push(template, templateClose);
  const templateGraph = createUiEventGraph(project, 'ui:preferences', '模板轨迹'); install('ui:preferences', templateGraph, template);
  const enter = graph('剧情打开轨迹测试页'); chain(enter, enter.nodes[0], node(enter, 'showUiPage', { pageId: root.id, wait: true }));
  const passage = project.nodes.find(node => node.kind === 'passage')!; if (passage.kind === 'passage') { passage.lines[0].text = '执行轨迹测试结束。'; passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: enter.id }]; }
  // Stable, separated positions make source-location acceptance readable as well as clickable.
  for (const g of project.blueprints) g.nodes.forEach((n, index) => { n.x = 60 + index % 4 * 330; n.y = 60 + Math.floor(index / 4) * 310; });
  synchronizeBlueprintSignatures(project);
  return { project, root, child, rootGraph, values, writes, pause, readZero, output, parent, childCall, capture, primary, second, unsupportedNode, open, observe, concurrent, unsupported, openChild, template, templateGraph };
}
