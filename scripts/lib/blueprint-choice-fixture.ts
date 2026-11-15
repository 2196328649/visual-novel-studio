import assert from 'node:assert/strict';
import { createProject, newNode, type BlueprintGraph, type BlueprintNode, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, blueprintPin, callablePins, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { blueprintChoicePinId, type BlueprintChoiceKeyType, type BlueprintChoiceValueType } from '../../src/core/blueprint-choice';
import { createCustomUiPage } from '../../src/core/game-flow';

const definitions: { id: string; keyType: BlueprintChoiceKeyType; valueType: BlueprintChoiceValueType; items: { id: string; key: VariableValue; value: VariableValue }[]; fallback: VariableValue; examples: { key: VariableValue; expected: VariableValue; route: string }[] }[] = [
  { id: 'text', keyType: 'string', valueType: 'number', items: [{ id: 'empty', key: '', value: 0 }, { id: 'a', key: 'A', value: 1 }, { id: 'hard', key: '困难', value: 7 }], fallback: -1, examples: [{ key: '', expected: 0, route: 'empty' }, { key: 'A', expected: 1, route: 'a' }, { key: '困难', expected: 7, route: 'hard' }, { key: 'other', expected: -1, route: 'default' }] },
  { id: 'number', keyType: 'number', valueType: 'string', items: [{ id: 'zero', key: 0, value: '' }, { id: 'negative', key: -2.5, value: '负数' }, { id: 'four', key: 4, value: '四' }], fallback: '未匹配', examples: [{ key: 0, expected: '', route: 'zero' }, { key: -2.5, expected: '负数', route: 'negative' }, { key: 4, expected: '四', route: 'four' }, { key: 3, expected: '未匹配', route: 'default' }] },
  { id: 'boolean', keyType: 'boolean', valueType: 'boolean', items: [{ id: 'no', key: false, value: false }, { id: 'yes', key: true, value: true }], fallback: false, examples: [{ key: false, expected: false, route: 'no' }, { key: true, expected: true, route: 'yes' }] },
];

export function createBlueprintChoiceFixture() {
  const project = createProject('多路分支与选择验收'); project.id = 'blueprint_choice_fixture';
  const wire = (graph: BlueprintGraph, from: BlueprintNode, output: string, to: BlueprintNode, input: string) => assert.equal(connectBlueprintPins(graph, from.id, output, to.id, input), undefined);
  const groups = definitions.map(definition => {
    const graph = createBlueprintGraph('function', definition.id + ' 类型多路选择'); graph.id = 'choice_' + definition.id; project.blueprints.push(graph);
    graph.exposedInputs = [blueprintPin('key', '匹配值', 'input', definition.keyType, definition.examples[0].key)];
    const resultVariable = 'choice_result_' + definition.id, routeVariable = 'choice_route_' + definition.id;
    project.variables.push({ id: resultVariable, name: resultVariable, type: definition.valueType as 'string' | 'number' | 'boolean', initial: definition.fallback, persistent: false }, { id: routeVariable, name: routeVariable, type: 'string', initial: '', persistent: false });
    const read = blueprintNodeDefaults('getInput'); read.properties.inputId = 'key';
    const select = blueprintNodeDefaults('selectByKey'), branch = blueprintNodeDefaults('switchValue'), write = blueprintNodeDefaults('setVariable');
    select.id = graph.id + '_select'; branch.id = graph.id + '_branch';
    const properties = { choiceVersion: 1, keyType: definition.keyType, valueType: definition.valueType, cases: JSON.stringify(definition.items.map(item => ({ id: item.id, name: item.id, key: item.key }))) };
    select.properties = { ...properties, ...Object.fromEntries(definition.items.map(item => [blueprintChoicePinId(item.id), item.value])), default: definition.fallback };
    branch.properties = { ...properties }; write.properties = { variableId: resultVariable };
    const routes = [...definition.items.map(item => item.id), 'default'].map(id => {
      const node = blueprintNodeDefaults('setVariable'); node.properties = { variableId: routeVariable, value: id }; return { id, node };
    });
    graph.nodes.push(read, select, write, branch, ...routes.map(row => row.node)); synchronizeBlueprintSignatures(project);
    wire(graph, read, 'value', select, 'key'); wire(graph, read, 'value', branch, 'key');
    wire(graph, graph.nodes[0], 'exec', write, 'exec_in'); wire(graph, select, 'result', write, 'value'); wire(graph, write, 'exec_out', branch, 'exec_in');
    for (const row of routes) wire(graph, branch, row.id === 'default' ? 'default' : blueprintChoicePinId(row.id), row.node, 'exec_in');
    graph.nodes.forEach((node, index) => { node.x = index % 4 * 400; node.y = Math.floor(index / 4) * 520; });
    return { ...definition, graph, read, select, branch, write, routes, resultVariable, routeVariable };
  });
  const page = createCustomUiPage(project, '多路节点页面'); page.components[0].y = .04; page.components[1].y = .88;
  const pageGraph = project.blueprints.find(graph => graph.uiPageId === page.id)!;
  let ordinal = 0;
  const cases = groups.flatMap(group => group.examples.map((example, index) => {
    const id = group.id + '_' + index, buttonId = 'choice_button_' + id;
    page.components.push({ ...page.components[1], id: buttonId, name: id, text: id, x: .05 + (ordinal % 3) * .31, y: .23 + Math.floor(ordinal++ / 3) * .15, width: .28, height: .10 });
    const click = blueprintNodeDefaults('eventClick'), call = blueprintNodeDefaults('callFunction'); click.properties.componentId = buttonId;
    call.properties = { graphId: group.graph.id, arg_key: example.key }; call.pins = callablePins(group.graph);
    pageGraph.nodes.push(click, call); wire(pageGraph, click, 'exec', call, 'exec_in');
    return { id, ...example, group, buttonId };
  }));
  const openGraph = createBlueprintGraph('function', '打开多路节点页面'), open = blueprintNodeDefaults('showUiPage'); open.properties = { pageId: page.id, wait: true };
  openGraph.nodes.push(open); project.blueprints.push(openGraph); wire(openGraph, openGraph.nodes[0], 'exec', open, 'exec_in');
  const start = project.nodes.find(node => node.kind === 'passage')!; if (start.kind !== 'passage') throw new Error('Missing initial passage.');
  start.lines[0].text = '多路选择准备完成。'; start.lines[0].actions = groups.map(group => ({ kind: 'blueprint', blueprintId: group.graph.id }));
  const after = newNode('passage', start.sceneId); if (after.kind !== 'passage') throw new Error('Missing second passage.');
  after.lines[0].text = '多路节点页面已返回。'; after.lines[0].actions = [{ kind: 'blueprint', blueprintId: openGraph.id }]; after.next = start.next; start.next = after.id; project.nodes.push(after);
  synchronizeBlueprintSignatures(project); return { project, groups, cases, page, pageGraph, openGraph, after };
}
