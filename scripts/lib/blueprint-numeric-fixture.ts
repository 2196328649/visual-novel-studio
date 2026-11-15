import assert from 'node:assert/strict';
import { createProject, newNode, type BlueprintGraph, type BlueprintNode, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { blueprintNumericOutputType, type BlueprintNumericType } from '../../src/core/blueprint-numeric';
import { createCustomUiPage } from '../../src/core/game-flow';

export interface NumericCase { id: string; type: BlueprintNumericType; inputs: Record<string, number | boolean>; mode?: string; expected: number | boolean }
/** Independent expected values, shared by authored preview/native fixtures. */
export const numericCases: readonly NumericCase[] = [
  { id: 'clamp_lower', type: 'clamp', inputs: { value: -3, min: 0, max: 10 }, expected: 0 },
  { id: 'clamp_upper', type: 'clamp', inputs: { value: 13, min: 0, max: 10 }, expected: 10 },
  { id: 'clamp_equal', type: 'clamp', inputs: { value: 13, min: 4, max: 4 }, expected: 4 },
  { id: 'absolute', type: 'abs', inputs: { value: -3.75 }, expected: 3.75 },
  { id: 'negative_zero', type: 'abs', inputs: { value: -0 }, expected: 0 },
  { id: 'round_positive', type: 'round', inputs: { value: 2.5 }, expected: 3 },
  { id: 'round_negative', type: 'round', inputs: { value: -2.5 }, expected: -3 },
  { id: 'round_negative_half', type: 'round', inputs: { value: -.5 }, expected: -1 },
  { id: 'round_below_half', type: 'round', inputs: { value: .49999999999999994 }, expected: 0 },
  { id: 'round_above_negative_half', type: 'round', inputs: { value: -.49999999999999994 }, expected: 0 },
  { id: 'round_large_integer', type: 'round', inputs: { value: 4503599627370497 }, expected: 4503599627370497 },
  { id: 'round_large_negative_integer', type: 'round', inputs: { value: -4503599627370497 }, expected: -4503599627370497 },
  { id: 'round_floor', type: 'round', inputs: { value: -1.2 }, mode: 'floor', expected: -2 },
  { id: 'round_ceil', type: 'round', inputs: { value: -1.2 }, mode: 'ceil', expected: -1 },
  { id: 'round_truncate', type: 'round', inputs: { value: -1.8 }, mode: 'truncate', expected: -1 },
  { id: 'range_min', type: 'inRange', inputs: { value: 0, min: 0, max: 1 }, expected: true },
  { id: 'range_min_exclusive', type: 'inRange', inputs: { value: 0, min: 0, max: 1, includeMin: false }, expected: false },
  { id: 'range_max', type: 'inRange', inputs: { value: 1, min: 0, max: 1 }, expected: true },
  { id: 'range_max_exclusive', type: 'inRange', inputs: { value: 1, min: 0, max: 1, includeMax: false }, expected: false },
  { id: 'nearly_boundary', type: 'nearlyEqual', inputs: { a: 1, b: 1.25, tolerance: .25 }, expected: true },
  { id: 'nearly_outside', type: 'nearlyEqual', inputs: { a: 1, b: 1.5, tolerance: .25 }, expected: false },
  { id: 'nearly_exact', type: 'nearlyEqual', inputs: { a: -5, b: -5, tolerance: 0 }, expected: true },
  { id: 'mapping', type: 'mapRange', inputs: { value: 25, inputMin: 0, inputMax: 100, outputMin: 0, outputMax: 1 }, expected: .25 },
  { id: 'mapping_reversed', type: 'mapRange', inputs: { value: 75, inputMin: 100, inputMax: 0, outputMin: 0, outputMax: 1 }, expected: .25 },
  { id: 'mapping_clamped', type: 'mapRange', inputs: { value: 150, inputMin: 0, inputMax: 100, outputMin: 0, outputMax: 2 }, expected: 2 },
  { id: 'mapping_extrapolate', type: 'mapRange', inputs: { value: 150, inputMin: 0, inputMax: 100, outputMin: 0, outputMax: 2, clamp: false }, expected: 3 },
  { id: 'lerp', type: 'lerp', inputs: { a: 10, b: 30, alpha: .25 }, expected: 15 },
  { id: 'lerp_clamped', type: 'lerp', inputs: { a: 10, b: 30, alpha: -1 }, expected: 10 },
  { id: 'lerp_extrapolate', type: 'lerp', inputs: { a: 10, b: 30, alpha: -1, clampAlpha: false }, expected: -10 },
];
export function createBlueprintNumericFixture(cases = numericCases) {
  const project = createProject('通用数值节点验收'); project.id = 'blueprint_numeric_matrix';
  const graph = createBlueprintGraph('function', '范围、取整与映射'); project.blueprints.push(graph);
  const wire = (owner: BlueprintGraph, a: BlueprintNode, from: string, b: BlueprintNode, to: string) => assert.equal(connectBlueprintPins(owner, a.id, from, b.id, to), undefined);
  let previous = graph.nodes[0];
  const rows = cases.map((entry, index) => {
    const variableId = 'numeric_' + entry.id, type = blueprintNumericOutputType(entry.type);
    project.variables.push({ id: variableId, name: variableId, type, initial: type === 'boolean' ? false : 0, persistent: false });
    const node = blueprintNodeDefaults(entry.type, index), write = blueprintNodeDefaults('setVariable', index);
    node.id = 'numeric_node_' + entry.id; Object.assign(node.properties, entry.inputs, entry.mode ? { mode: entry.mode } : {});
    node.x = 80; node.y = 80 + index * 390; write.x = 620; write.y = node.y;
    write.properties = { variableId }; graph.nodes.push(node, write); synchronizeBlueprintSignatures(project);
    wire(graph, previous, previous.type === 'event' ? 'exec' : 'exec_out', write, 'exec_in'); wire(graph, node, 'result', write, 'value'); previous = write;
    return { ...entry, variableId, node, write };
  });
  const page = createCustomUiPage(project, '数值页面');
  const pageGraph = project.blueprints.find(graph => graph.uiPageId === page.id)!;
  const call = blueprintNodeDefaults('callFunction'); call.properties.graphId = graph.id; pageGraph.nodes.push(call); synchronizeBlueprintSignatures(project);
  wire(pageGraph, pageGraph.nodes[0], 'exec', call, 'exec_in');
  const callPage = createBlueprintGraph('function', '打开数值页面'), show = blueprintNodeDefaults('showUiPage'); show.properties = { pageId: page.id, wait: true }; callPage.nodes.push(show); project.blueprints.push(callPage); wire(callPage, callPage.nodes[0], 'exec', show, 'exec_in');
  const start = project.nodes.find(node => node.kind === 'passage')!;
  if (start.kind !== 'passage') throw new Error('Missing fixture passage');
  start.lines[0].text = '数值运算准备完成。'; start.lines[0].actions = [{ kind: 'blueprint', blueprintId: graph.id }];
  const after = newNode('passage', start.sceneId); if (after.kind !== 'passage') throw new Error('Missing fixture passage');
  after.lines[0].text = '数值页面已返回。'; after.lines[0].actions = [{ kind: 'blueprint', blueprintId: callPage.id }]; after.next = start.next; start.next = after.id; project.nodes.push(after);
  synchronizeBlueprintSignatures(project);
  return { project, graph, rows, page, pageGraph, start, after };
}
