import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintNumericCatalog, blueprintNumericInputs, blueprintNumericOutputType, evaluateBlueprintNumeric, type BlueprintNumericType } from '../src/core/blueprint-numeric';
import { blueprintNodePresentation } from '../src/core/blueprint-presentation';
import { createBlueprintNumericFixture, numericCases } from '../scripts/lib/blueprint-numeric-fixture';
import { previewActionContext, expandPreviewActions } from '../src/core/preview-actions';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { BlueprintTraceRecorder, type BlueprintTraceEntry } from '../src/core/blueprint-trace';
import { blueprintStaticOutput, unknownBlueprintValue, type StaticValueContext } from '../src/core/blueprint-static-values';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { projectSchema } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';

for (const type of Object.keys(blueprintNumericCatalog) as BlueprintNumericType[]) test(type + ' is a typed, compact pure node with stable inputs', () => {
  const node = blueprintNodeDefaults(type), before = structuredClone(node);
  assert.deepEqual(node.pins.filter(pin => pin.direction === 'input').map(({ id, dataType, defaultValue }) => ({ id, dataType, defaultValue })), blueprintNumericInputs[type].map(({ id, dataType, defaultValue }) => ({ id, dataType, defaultValue })));
  assert.equal(node.pins.at(-1)?.id, 'result'); assert.equal(node.pins.at(-1)?.dataType, blueprintNumericOutputType(type));
  assert.ok(node.pins.every(pin => pin.dataType !== 'exec'));
  assert.deepEqual(blueprintNodePresentation(node), { family: 'value', compact: true }); assert.deepEqual(node, before);
});
for (const entry of numericCases) test('numeric value contract: ' + entry.id, () => {
  const values = { ...Object.fromEntries(blueprintNumericInputs[entry.type].map(pin => [pin.id, pin.defaultValue])), ...entry.inputs }, reads: string[] = [];
  const result = evaluateBlueprintNumeric(entry.type, id => { reads.push(id); return values[id]; }, entry.mode);
  assert.deepEqual(result, { ok: true, value: entry.expected }); assert.deepEqual(reads, blueprintNumericInputs[entry.type].map(pin => pin.id));
});
test('all numeric nodes work through connected execution, page events, trace and save parsing', () => {
  const { project, graph, rows, page } = createBlueprintNumericFixture(), before = structuredClone(project);
  assert.deepEqual(validateBlueprints(project), []);
  const context = previewActionContext(project); context.trace = new BlueprintTraceRecorder();
  expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
  assert.equal(context.incomplete, false);
  for (const row of rows) {
    assert.equal(context.variables[row.variableId], row.expected, row.id);
    const inputs: BlueprintTraceEntry[] = context.trace.snapshot().entries.filter(entry => entry.kind === 'input' && entry.nodeId === row.node.id);
    assert.deepEqual(inputs.map(entry => entry.pinId), blueprintNumericInputs[row.type].map(pin => pin.id), row.id);
    assert.ok(context.trace.snapshot().entries.some(entry => entry.kind === 'output' && entry.nodeId === row.node.id && entry.value === row.expected && entry.available === true));
  }
  const preview = previewUiLogic(project, page.components, page.id, {}, [], { trace: true });
  assert.equal(preview.incomplete, false); for (const row of rows) assert.equal(preview.variables[row.variableId], row.expected, row.id);
  assert.deepEqual(project, before);
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(saved.blueprints.find(item => item.id === graph.id)?.nodes, JSON.parse(JSON.stringify(graph.nodes)));
});
test('invalid numeric bounds, modes, overflow and coercions remain diagnostic failures', () => {
  const invalid: { type: BlueprintNumericType; inputs: Record<string, unknown>; mode?: string; message: RegExp }[] = [
    { type: 'clamp', inputs: { min: 4, max: 2 }, message: /最小值/ },
    { type: 'inRange', inputs: { min: 4, max: 2 }, message: /最小值/ },
    { type: 'nearlyEqual', inputs: { tolerance: -1 }, message: /误差/ },
    { type: 'mapRange', inputs: { inputMin: 1, inputMax: 1 }, message: /不能相等/ },
    { type: 'round', inputs: { value: 2 }, mode: 'bankers', message: /取整方式/ },
    { type: 'lerp', inputs: { a: 1e308, b: -1e308, alpha: 4, clampAlpha: false }, message: /有限数值/ },
    { type: 'mapRange', inputs: { inputMin: -1e308, inputMax: 1e308 }, message: /有限数值/ },
    ...[true, '12', NaN, Infinity, undefined].map(value => ({ type: 'abs' as const, inputs: { value }, message: /有限数值/ })),
    { type: 'inRange', inputs: { includeMin: 1 }, message: /开关/ },
  ];
  for (const entry of invalid) {
    const values: Record<string, unknown> = { ...Object.fromEntries(blueprintNumericInputs[entry.type].map(pin => [pin.id, pin.defaultValue])), ...entry.inputs };
    const result = evaluateBlueprintNumeric(entry.type, id => values[id], entry.mode);
    assert.equal(result.ok, false); if (!result.ok) assert.match(result.message, entry.message);
  }
  for (const entry of invalid.slice(0, 7)) {
    const { project, rows } = createBlueprintNumericFixture([{ id: 'invalid', type: entry.type, inputs: entry.inputs as Record<string, number | boolean>, mode: entry.mode, expected: 0 }]);
    assert.ok(validateBlueprints(project).some(issue => entry.message.test(issue.message)), entry.type);
    const context = previewActionContext(project); expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: project.blueprints[0].id }], context); assert.equal(context.incomplete, true);
    assert.equal(context.variables[rows[0].variableId], blueprintNumericOutputType(entry.type) === 'boolean' ? false : 0);
  }
});
test('static analysis never replaces a live numeric input with its initial value', () => {
  const { project, graph, rows } = createBlueprintNumericFixture([numericCases[3]]), input = blueprintNodeDefaults('getInput');
  graph.exposedInputs.push(blueprintPin('external', '输入值', 'input', 'number', -3.75)); input.properties.inputId = 'external'; graph.nodes.push(input); synchronizeBlueprintSignatures(project);
  assert.equal(connectBlueprintPins(graph, input.id, 'value', rows[0].node.id, 'value'), undefined);
  const context: StaticValueContext = { project, graph, inputs: new Map<string, typeof unknownBlueprintValue>([['external', unknownBlueprintValue]]), results: new Map(), onRead: () => undefined, uiValue: () => unknownBlueprintValue };
  assert.equal(blueprintStaticOutput(context, rows[0].node, 'result'), unknownBlueprintValue);
});
test('native expressions guard every evaluated argument and preserve zero and false results', () => {
  const { project, rows } = createBlueprintNumericFixture(), before = structuredClone(project), compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(project, before);
  const code = Object.values(compiled.files).join('\n');
  for (const type of Object.keys(blueprintNumericCatalog)) assert.ok(code.includes('vn_bp_numeric("' + type + '", {'), type);
  assert.match(code, /def vn_bp_numeric/); assert.match(code, /vn_bp_number\(/); assert.match(code, /vn_bp_boolean\(/); assert.match(code, /not isinstance\(result, bool\)/);
  rows[0].node.pins[0].dataType = 'exec';
  assert.ok(validateBlueprints(project).some(issue => issue.message.includes('数值运算是数据节点')));
});
