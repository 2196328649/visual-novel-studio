import assert from 'node:assert/strict';
import { createProject, newNode, type BlueprintGraph, type BlueprintNode, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createCustomUiPage } from '../../src/core/game-flow';

/** Empty-body loops must yield exactly like authored loops with visible work. */
export function createBlueprintTaskBoundaryFixture() {
  const project = createProject('任务调度边界验收'); project.id = 'blueprint_task_boundaries';
  project.variables.push({ id: 'boundary_handle', name: '长任务标识', type: 'string', initial: '', persistent: false }, { id: 'short_done', name: '短任务完成', type: 'number', initial: 0, persistent: false });
  const graph = (name: string) => { const g = createBlueprintGraph('function', name); project.blueprints.push(g); return g; };
  const node = (g: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => { const n = blueprintNodeDefaults(type, g.nodes.length); Object.assign(n.properties, properties); g.nodes.push(n); return n; };
  const wire = (g: BlueprintGraph, a: BlueprintNode, b: BlueprintNode, from = 'exec_out', to = 'exec_in') => { synchronizeBlueprintSignatures(project); assert.equal(connectBlueprintPins(g, a.id, a.type.startsWith('event') && from === 'exec_out' ? 'exec' : from, b.id, to), undefined); };
  const chain = (g: BlueprintGraph, ...nodes: BlueprintNode[]) => nodes.slice(1).forEach((n, i) => wire(g, nodes[i], n));
  const worker = graph('空体循环任务');
  worker.exposedInputs = [blueprintPin('first', '起始', 'input', 'number', 0), blueprintPin('last', '结束', 'input', 'number', 599)];
  worker.exposedOutputs = [blueprintPin('final_index', '结束索引', 'output', 'number', -1), blueprintPin('completed', '到达完成出口', 'output', 'boolean', false)];
  const loop = node(worker, 'forLoop'), index = node(worker, 'setOutput', { outputId: 'final_index' }), completed = node(worker, 'setOutput', { outputId: 'completed', value: true });
  wire(worker, node(worker, 'getInput', { inputId: 'first' }), loop, 'value', 'first_index');
  wire(worker, node(worker, 'getInput', { inputId: 'last' }), loop, 'value', 'last_index');
  wire(worker, worker.nodes[0], loop); wire(worker, loop, index, 'completed'); wire(worker, loop, index, 'index', 'value'); wire(worker, index, completed);
  const early = graph('循环体显式返回'); early.exposedOutputs = worker.exposedOutputs.map(pin => ({ ...pin }));
  const earlyLoop = node(early, 'forLoop', { firstIndex: 2, lastIndex: 4 }), earlyIndex = node(early, 'setOutput', { outputId: 'final_index' });
  wire(early, early.nodes[0], earlyLoop); wire(early, earlyLoop, earlyIndex, 'loop_body'); wire(early, earlyLoop, earlyIndex, 'index', 'value'); wire(early, earlyIndex, node(early, 'return'));
  wire(early, earlyLoop, node(early, 'setOutput', { outputId: 'completed', value: true }), 'completed');
  const short = graph('调度中的短任务'); chain(short, short.nodes[0], node(short, 'setVariable', { variableId: 'short_done', value: 1 }));
  const page = createCustomUiPage(project, '任务边界工作台'), pageGraph = project.blueprints.find(g => g.uiPageId === page.id)!;
  page.components[0].y = .025; page.components[1].y = .88;
  const buttons: Record<string, BlueprintNode> = {};
  const button = (id: string, text: string, target: BlueprintGraph, first?: number, last?: number) => {
    const i = Object.keys(buttons).length, component: UiComponent = { id, text, kind: 'button', page: 'custom', x: .06 + i % 2 * .47, y: .16 + Math.floor(i / 2) * .17, width: .4, height: .11 };
    page.components.push(component);
    const start = node(pageGraph, 'startTask', { graphId: target.id, scope: 'page', pageId: page.id, conflict: 'parallel', seconds: 0, ...(first === undefined ? {} : { arg_first: first, arg_last: last! }) });
    wire(pageGraph, node(pageGraph, 'eventClick', { componentId: id }), start);
    if (target !== short) { const store = node(pageGraph, 'setVariable', { variableId: 'boundary_handle' }); wire(pageGraph, start, store); wire(pageGraph, start, store, 'handle', 'value'); }
    buttons[id] = start; return start;
  };
  button('boundary_normal', '空循环 600 次', worker, 0, 599);
  button('boundary_long', '空循环 6000 次', worker, 0, 5999);
  button('boundary_empty', '空范围 5 到 3', worker, 5, 3);
  button('boundary_early', '循环体直接返回', early);
  button('boundary_short', '并行短任务', short);
  button('boundary_limit', '任务总步数超限', worker, 0, 99999);
  page.components.push({ id: 'boundary_cancel', text: '取消当前长任务', kind: 'button', page: 'custom', x: .06, y: .67, width: .4, height: .11 });
  const cancel = node(pageGraph, 'cancelTask'); wire(pageGraph, node(pageGraph, 'eventClick', { componentId: 'boundary_cancel' }), cancel);
  wire(pageGraph, node(pageGraph, 'getVariable', { variableId: 'boundary_handle' }), cancel, 'value', 'handle');
  const open = graph('打开任务边界页'); chain(open, open.nodes[0], node(open, 'showUiPage', { pageId: page.id, wait: true }));
  const intro = project.nodes.find(n => n.kind === 'passage')!; assert.equal(intro.kind, 'passage'); intro.lines[0].text = '准备验收任务边界。';
  const interactive = newNode('passage', project.scenes[0].id); assert.equal(interactive.kind, 'passage');
  Object.assign(interactive, { id: 'task_boundary_interactive', next: intro.id }); interactive.lines[0].text = '任务边界页面已返回。'; interactive.lines[0].actions = [{ kind: 'blueprint', blueprintId: open.id }]; project.nodes.push(interactive);
  synchronizeBlueprintSignatures(project);
  return { project, graph, node, wire, chain, worker, loop, index, completed, early, earlyLoop, short, page, pageGraph, buttons, interactive };
}
