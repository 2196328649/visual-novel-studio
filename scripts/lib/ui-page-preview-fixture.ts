import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../../src/core/blueprint';
import { createProject, type BlueprintGraph, type BlueprintNode, type UiComponent } from '../../src/core/model';

export function createUiPagePreviewFixture() {
 const project = createProject(); project.name = '等待页面预演验收';
 project.ui.components = []; project.ui.pages = { main: { layout: 'custom', background: '#15252f' } };
 project.variables = [
  { id: 'result', name: '关闭结果', type: 'string', initial: '尚未返回', persistent: false },
  { id: 'nested', name: '子页结果', type: 'string', initial: '尚未返回', persistent: false },
  ...['after', 'base_ticks', 'page_ticks', 'opens', 'base_clicks'].map(id => ({ id, name: id, type: 'number' as const, initial: 0, persistent: false })),
 ];
 const addGraph = (name: string) => { const graph = createBlueprintGraph('ui', name); project.blueprints.push(graph); return graph; };
 const add = (graph: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => { const node = blueprintNodeDefaults(type); Object.assign(node.properties, properties); graph.nodes.push(node); return node; };
 const link = (graph: BlueprintGraph, from: BlueprintNode, out: string, to: BlueprintNode, input: string) => { const error = connectBlueprintPins(graph, from.id, out, to.id, input); if (error) throw new Error(error); };
 const chain = (graph: BlueprintGraph, ...nodes: BlueprintNode[]) => nodes.slice(1).forEach((node, index) => link(graph, nodes[index], nodes[index].type.startsWith('event') ? 'exec' : 'exec_out', node, 'exec_in'));
 const increment = (graph: BlueprintGraph, start: BlueprintNode, variableId: string) => {
  const read = add(graph, 'getVariable', { variableId }), math = add(graph, 'math', { operation: 'add', b: 1 }), set = add(graph, 'setVariable', { variableId });
  link(graph, read, 'value', math, 'a'); link(graph, math, 'result', set, 'value'); chain(graph, start, set); return set;
 };
 const button = (id: string, text: string, page: UiComponent['page'], y: number, blueprintId?: string): UiComponent => ({ id, kind: 'button', page, text, x: .1, y, width: .36, height: .13, style: { fontSize: 36 }, ...(blueprintId ? { action: 'blueprint', blueprintId } : {}) });
 const opener = addGraph('等待页面');
 const open = add(opener, 'showUiPage', { pageId: 'waiting_page', wait: true }), result = add(opener, 'setVariable', { variableId: 'result' });
 chain(opener, opener.nodes[0], open, result); link(opener, open, 'result', result, 'value'); increment(opener, result, 'after');
 const closer = addGraph('确认关闭'); const close = add(closer, 'closeUiPage', { pageId: 'waiting_page', result: '已确认' }); chain(closer, closer.nodes[0], close);
 const nestedOpener = addGraph('等待子页'), nestedOpen = add(nestedOpener, 'showUiPage', { pageId: 'nested_page', wait: true }), nestedResult = add(nestedOpener, 'setVariable', { variableId: 'nested' });
 chain(nestedOpener, nestedOpener.nodes[0], nestedOpen, nestedResult); link(nestedOpener, nestedOpen, 'result', nestedResult, 'value');
 const nestedCloser = addGraph('子页关闭'); chain(nestedCloser, nestedCloser.nodes[0], add(nestedCloser, 'closeUiPage', { pageId: 'nested_page', result: '子页完成' }));
 const show = addGraph('页面初始化'); increment(show, show.nodes[0], 'opens');
 const clocks = addGraph('页面计时');
 increment(clocks, add(clocks, 'eventTimer', { pageId: 'ui:main', interval: 1, repeat: true }), 'base_ticks');
 increment(clocks, add(clocks, 'eventTimer', { pageId: 'waiting_page', interval: .5, repeat: true }), 'page_ticks');
 const baseClick = addGraph('底层点击'); increment(baseClick, baseClick.nodes[0], 'base_clicks');
 const underlying = button('base_button', '底层按钮', 'main', .62, baseClick.id); underlying.shortcut = 'e';
 project.ui.components.push(button('open_button', '打开等待页面', 'main', .2, opener.id), underlying);
 project.ui.customPages = [
  { id: 'waiting_page', name: '等待页面', modal: true, background: '#233448', onShowBlueprintId: show.id, components: [button('close_button', '确认关闭页面', 'custom', .2, closer.id), button('nested_button', '打开子页', 'custom', .4, nestedOpener.id)] },
  { id: 'nested_page', name: '子页', modal: true, background: '#472b39', components: [button('nested_close', '完成子页', 'custom', .4, nestedCloser.id)] },
 ];
 return { project, opener, open, closer, close, show, clocks, addGraph, add, link, chain, increment };
}
