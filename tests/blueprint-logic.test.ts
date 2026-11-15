import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type VariableValue } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { type BlueprintLogicType } from '../src/core/blueprint-logic';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { compileProject } from '../src/runtime/compiler';

function fixture(type: BlueprintLogicType, a: VariableValue, b = false) {
  const project = createProject();
  project.variables.push({ id: 'logic_result', name: '逻辑结果', type: 'boolean', initial: false, persistent: false });
  const graph = createBlueprintGraph('function', '逻辑检查');
  const logic = blueprintNodeDefaults(type), write = blueprintNodeDefaults('setVariable');
  logic.properties = { a, ...(type === 'not' ? {} : { b }) };
  write.properties.variableId = 'logic_result';
  graph.nodes.push(logic, write); project.blueprints.push(graph);
  synchronizeBlueprintSignatures(project);
  assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', write.id, 'exec_in'), undefined);
  assert.equal(connectBlueprintPins(graph, logic.id, 'result', write.id, 'value'), undefined);
  return { project, graph, logic, write };
}

const truthTable = [
  [false, false, true, false, false, false],
  [false, true, true, false, true, true],
  [true, false, false, false, true, true],
  [true, true, false, true, true, false],
] as const;
for (const [offset, type] of (['not', 'and', 'or', 'xor'] as const).entries()) {
  test(`${type} evaluates its truth table through connected blueprint execution`, () => {
    for (const row of truthTable) {
      const { project, graph, logic } = fixture(type, row[0], row[1]);
      assert.equal(projectSchema.safeParse(project).success, true);
      assert.deepEqual(validateBlueprints(project), []);
      assert.ok(logic.pins.every(pin => pin.dataType === 'boolean'));
      const context = previewActionContext(project);
      expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
      assert.equal(context.incomplete, false);
      assert.equal(context.variables.logic_result, row[2 + offset]);
    }
  });
}

test('AND and OR read the second condition only when it can change the result', () => {
  for (const type of ['and', 'or'] as const) for (const a of [false, true]) {
    const { project, graph, logic } = fixture(type, a);
    const read = blueprintNodeDefaults('getUiProperty');
    read.properties.componentId = 'runtime_control'; graph.nodes.push(read);
    assert.equal(connectBlueprintPins(graph, read.id, 'value', logic.id, 'b'), undefined);
    const context = previewActionContext(project);
    let reads = 0;
    context.ui = { get: () => { reads++; return undefined; }, set: () => true, reset: () => true };
    expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
    const shouldRead = type === 'and' ? a : !a;
    assert.equal(reads, shouldRead ? 1 : 0);
    assert.equal(context.incomplete, shouldRead);
    if (!shouldRead) assert.equal(context.variables.logic_result, a);
  }
});

test('logic nodes reject truthy strings and numbers, and preserve their types across a save roundtrip', () => {
  for (const type of ['not', 'and', 'or', 'xor'] as const) for (const a of [0, 1, 'false', 'true']) {
    const { project, graph } = fixture(type, a);
    assert.ok(validateBlueprints(project).some(issue => issue.message.includes('开关')));
    const context = previewActionContext(project);
    expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
    assert.equal(context.incomplete, true);
  }
  const { project, logic } = fixture('not', true);
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(project))).blueprints[0].nodes.find(node => node.id === logic.id)?.pins, logic.pins);
});

test('compiled boolean operations use runtime type guards and Python short-circuit operators', () => {
  for (const type of ['not', 'and', 'or', 'xor'] as const) {
    const { project } = fixture(type, true, false);
    const compiled = compileProject(project);
    assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
    const code = Object.values(compiled.files).join('\n');
    const expression = type === 'not' ? /\(not vn_bp_boolean\(True,/ : new RegExp(`vn_bp_boolean\\(True,.*\\) ${type === 'xor' ? '!=' : type} vn_bp_boolean\\(False,`);
    assert.match(code, expression);
    assert.match(code, /def vn_bp_boolean\(value, name\):/);
    assert.match(code, /if not isinstance\(value, bool\):/);
  }
});

test('malformed logical pins cannot turn a typed calculation into an execution node', () => {
  const { project, logic } = fixture('not', true);
  logic.pins[0].dataType = 'number';
  assert.ok(validateBlueprints(project).some(issue => issue.message.includes('开关类型')));
  logic.pins[0].dataType = 'exec';
  assert.ok(validateBlueprints(project).some(issue => issue.message.includes('不使用执行连线')));
});
