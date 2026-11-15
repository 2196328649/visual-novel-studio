import { createProject, type BlueprintGraph, type BlueprintNode, type CustomUiPage, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createCustomUiPage } from '../../src/core/game-flow';
import { ensureUiClickEvent } from '../../src/core/ui-logic';
import { setBlueprintPageOpening, uiPageOpeningPresets } from '../../src/core/ui-page-opening';

/** Authored graphs shared by unit and isolated desktop acceptance. Every route
 * originates in an actual button, execution wire and existing page resource. */
export function uiFlowRouteExplanationFixture() {
  const project = createProject('页面路线说明验收'); project.id = 'ui_flow_route_explanation';
  project.variables.push({ id: 'route_progress', name: '章节进度', type: 'number', initial: 0, persistent: false },
    { id: 'route_count', name: '后台完成次数', type: 'number', initial: 0, persistent: false });
  const parent = createCustomUiPage(project, '路线说明示例'), first = createCustomUiPage(project, '详细说明'), second = createCustomUiPage(project, '简短说明');
  first.opening = { ...uiPageOpeningPresets.dialog.value }; second.opening = { ...uiPageOpeningPresets.notice.value, autoClose: 0 };
  parent.components = [];
  const graph = project.blueprints.find(graph => graph.uiPageId === parent.id)!;
  graph.nodes = graph.nodes.filter(node => node.type === 'event'); graph.links = [];
  const node = (owner: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => {
    const value = blueprintNodeDefaults(type, owner.nodes.length); Object.assign(value.properties, properties); owner.nodes.push(value); return value;
  };
  const wire = (owner: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = from.type.startsWith('event') ? 'exec' : 'exec_out', input = 'exec_in') => {
    synchronizeBlueprintSignatures(project);
    const error = connectBlueprintPins(owner, from.id, output, to.id, input); if (error) throw new Error(error);
  };
  const button = (id: string, name: string) => {
    const index = parent.components.length;
    const component: UiComponent = { id, kind: 'button', page: 'custom', name, text: name, x: .08 + (index % 2) * .45, y: .08 + Math.floor(index / 2) * .16, width: .38, height: .1, flowEvent: { visible: true } };
    parent.components.push(component);
    const entry = ensureUiClickEvent(project, graph, component.id, parent.id); return { component, entry };
  };
  const open = (owner: BlueprintGraph, page: CustomUiPage) => node(owner, 'showUiPage', { pageId: page.id });
  const comparison = () => {
    const value = node(graph, 'getVariable', { variableId: 'route_progress' }), compare = node(graph, 'compare', { operator: 'gte', b: 2 }), branch = node(graph, 'branch');
    wire(graph, value, compare, 'value', 'a'); wire(graph, compare, branch, 'result', 'condition'); return { value, compare, branch };
  };

  const conditional = { ...button('route_conditional', '按进度选择说明'), ...comparison(), first: open(graph, first), second: open(graph, second) };
  wire(graph, conditional.entry, conditional.branch); wire(graph, conditional.branch, conditional.first, 'true'); wire(graph, conditional.branch, conditional.second, 'false');

  const merged = { ...button('route_merged', '分支合流后打开'), ...comparison(), open: open(graph, first) };
  const mergeYes = node(graph, 'setVariable', { variableId: 'route_count', value: 1 }), mergeNo = node(graph, 'setVariable', { variableId: 'route_count', value: 2 });
  wire(graph, merged.entry, merged.branch); wire(graph, merged.branch, mergeYes, 'true'); wire(graph, merged.branch, mergeNo, 'false');
  wire(graph, mergeYes, merged.open); wire(graph, mergeNo, merged.open);

  const sequence = { ...button('route_sequence', '依次完成两步'), sequence: node(graph, 'sequence'), first: open(graph, first), second: open(graph, second) };
  wire(graph, sequence.entry, sequence.sequence); wire(graph, sequence.sequence, sequence.first, 'then_0'); wire(graph, sequence.sequence, sequence.second, 'then_1');

  const continued = { ...button('route_continued', '关闭说明后继续'), first: open(graph, first), second: open(graph, second) };
  wire(graph, continued.entry, continued.first); wire(graph, continued.first, continued.second);

  const shared = createBlueprintGraph('function', '共享说明模块'); project.blueprints.push(shared);
  const nested = { ...button('route_nested', '调用共享说明'), call: node(graph, 'callFunction', { graphId: shared.id }), open: open(shared, first), graph: shared };
  wire(graph, nested.entry, nested.call); wire(shared, shared.nodes[0], nested.open);

  const dynamicGraph = createBlueprintGraph('function', '由输入指定页面'); project.blueprints.push(dynamicGraph);
  dynamicGraph.exposedInputs = [{ id: 'target', name: '目标页面', direction: 'input', dataType: 'ui', required: false, defaultValue: first.id }];
  const dynamic = { ...button('route_dynamic', '由输入决定去向'), call: node(graph, 'callFunction', { graphId: dynamicGraph.id }), open: open(dynamicGraph, first), input: node(dynamicGraph, 'getInput', { inputId: 'target' }), graph: dynamicGraph };
  wire(graph, dynamic.entry, dynamic.call); wire(dynamicGraph, dynamicGraph.nodes[0], dynamic.open); wire(dynamicGraph, dynamic.input, dynamic.open, 'value', 'pageId');

  const taskGraph = createBlueprintGraph('function', '后台准备信息'); project.blueprints.push(taskGraph);
  const delay = node(taskGraph, 'delay', { seconds: .01 }), set = node(taskGraph, 'setVariable', { variableId: 'route_count', value: 3 });
  wire(taskGraph, taskGraph.nodes[0], delay); wire(taskGraph, delay, set);
  const asynchronous = { ...button('route_async', '等待后台任务结果'), task: node(graph, 'startTask', { graphId: taskGraph.id }), wait: node(graph, 'waitTask', { graphId: taskGraph.id }), first: open(graph, first), second: open(graph, second), graph: taskGraph };
  wire(graph, asynchronous.entry, asynchronous.task); wire(graph, asynchronous.task, asynchronous.wait); wire(graph, asynchronous.task, asynchronous.wait, 'handle', 'handle');
  wire(graph, asynchronous.wait, asynchronous.first, 'completed'); wire(graph, asynchronous.wait, asynchronous.second, 'cancelled');

  const dynamicOpeningGraph = createBlueprintGraph('function', '由输入指定打开方式'); project.blueprints.push(dynamicOpeningGraph);
  dynamicOpeningGraph.exposedInputs = [{ id: 'wait', name: '是否等待玩家关闭', direction: 'input', dataType: 'boolean', required: false, defaultValue: true },
    { id: 'input', name: '输入接管方式', direction: 'input', dataType: 'string', required: false, defaultValue: 'modal' }];
  const dynamicOpening = { ...button('route_dynamic_opening', '打开方式由输入控制'), call: node(graph, 'callFunction', { graphId: dynamicOpeningGraph.id }), open: open(dynamicOpeningGraph, first), graph: dynamicOpeningGraph };
  setBlueprintPageOpening(dynamicOpening.open, { wait: false, input: 'none' });
  wire(graph, dynamicOpening.entry, dynamicOpening.call); wire(dynamicOpeningGraph, dynamicOpeningGraph.nodes[0], dynamicOpening.open);
  wire(dynamicOpeningGraph, node(dynamicOpeningGraph, 'getInput', { inputId: 'wait' }), dynamicOpening.open, 'value', 'wait');
  wire(dynamicOpeningGraph, node(dynamicOpeningGraph, 'getInput', { inputId: 'input' }), dynamicOpening.open, 'value', 'modalMode');

  synchronizeBlueprintSignatures(project);
  return { project, parent, first, second, graph, conditional, merged, sequence, continued, nested, dynamic, asynchronous, dynamicOpening, node, wire, open, button };
}
