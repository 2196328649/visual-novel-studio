import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiControlOptionsFixture } from '../scripts/lib/ui-control-options-fixture';
import { editUiControlOptions, readUiControlOption, uiControlOptionMatches, uiControlOptionsKey, uiControlOptionPins, maxUiControlOptions, maxUiControlOptionLabel } from '../src/core/ui-control-options';
import { uiControlDefinition, uiControlValueProblem } from '../src/core/ui-control-properties';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { uiPropertyDefault, uiOperationApplies } from '../src/core/ui-properties';
import { blueprintNodeDefaults, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { declaredUiComponents, projectSchema } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';
import { uiControlOptionEditExpression } from '../src/runtime/ui-control-options-runtime';
import { blueprintTaskProblems } from '../src/core/blueprint-tasks';

const click = (name: string): UiPreviewEvent => ({ kind: 'click', componentId: 'option_act_' + name });
const componentClick = (id: string): UiPreviewEvent => ({ kind: 'click', componentId: id });
const sample = (f: ReturnType<typeof createUiControlOptionsFixture>, events: UiPreviewEvent[] = []) => previewUiLogic(f.project, f.page.components, f.page.id, {}, events, { timed: true, trace: true });
const info = (f: ReturnType<typeof createUiControlOptionsFixture>, id = 'choice') => uiControlDefinition(f.project, declaredUiComponents(f.project).find(item => item.id === id)!)!;

// These cases are intentionally saved for the final, unified validation pass.
test('options have typed stable pins and are offered only to choice controls', () => {
  const f = createUiControlOptionsFixture();
  assert.equal(info(f).choice, true); assert.equal(info(f, 'free_input').choice, false);
  assert.equal(uiOperationApplies(f.project, f.page.components[0], 'editUiControlOptions'), true);
  assert.equal(uiOperationApplies(f.project, f.page.components.find(item => item.id === 'free_input')!, 'editUiControlOptions'), false);
  assert.deepEqual(f.reader.pins.filter(pin => pin.direction === 'output').map(pin => [pin.id, pin.dataType]), [['found', 'boolean'], ['label', 'string'], ['value', 'string']]);
  for (const valueType of ['string', 'number', 'boolean']) {
    const node = blueprintNodeDefaults('getUiControlOption'); node.properties.valueType = valueType;
    assert.equal(uiControlOptionPins(node)!.find(pin => pin.id === 'value')!.dataType, valueType);
  }
  assert.deepEqual(validateBlueprints(f.project).filter(issue => issue.severity === 'error'), []);
});

test('pure list edits are copy-on-write, preserve explicit scalar values, and define final-index moves', () => {
  const f = createUiControlOptionsFixture(), original = info(f), before = structuredClone(original);
  const added = editUiControlOptions(original, 'insert', { index: 2, label: '空文字', value: '', valueType: 'string' })!;
  const moved = editUiControlOptions({ ...original, options: added }, 'move', { index: 0, toIndex: 2 })!;
  assert.deepEqual(moved.map(option => option.value), ['另一个', '', '初始']);
  assert.deepEqual(readUiControlOption({ ...original, options: moved }, 1, 'string'), { found: true, label: '空文字', value: '' });
  assert.deepEqual(original, before); assert.notEqual(added[0], original.options[0]);
  for (const [id, valueType, value] of [['boolean_choice', 'boolean', false], ['number_choice', 'number', 0]] as const) {
    const definition = info(f, id), next = editUiControlOptions(definition, 'insert', { index: definition.options.length, label: '显式值', value, valueType })!;
    assert.equal(readUiControlOption({ ...definition, options: next }, next.length - 1, valueType).value, value);
  }
  assert.equal(uiControlOptionMatches(false, 0), false); assert.equal(uiControlOptionMatches(.5, .500000001), true);
});

test('invalid edits refuse all mutation, including bounds, labels, scalar types and engine options', () => {
  const f = createUiControlOptionsFixture(), definition = info(f), before = structuredClone(definition);
  for (const index of [NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1, -1, 3]) assert.throws(() => editUiControlOptions(definition, 'insert', { index, label: '新', value: '新', valueType: 'string' }));
  for (const label of ['', '😀'.repeat(maxUiControlOptionLabel + 1)]) assert.throws(() => editUiControlOptions(definition, 'replace', { index: 0, label, value: '新', valueType: 'string' }));
  assert.throws(() => editUiControlOptions(definition, 'replace', { index: 0, label: '新', value: false, valueType: 'string' }));
  assert.throws(() => editUiControlOptions(definition, 'remove', { index: 2 }));
  assert.throws(() => editUiControlOptions(definition, 'move', { index: 0, toIndex: 2 }));
  assert.throws(() => editUiControlOptions(info(f, 'free_input'), 'clear', {}));
  assert.throws(() => editUiControlOptions(info(f, 'number_choice'), 'insert', { index: 0, label: '超限', value: 2, valueType: 'number' }));
  const full = { ...definition, options: Array.from({ length: maxUiControlOptions }, (_, index) => ({ label: String(index), value: String(index) })) };
  assert.throws(() => editUiControlOptions(full, 'insert', { index: 0, label: '超额', value: '新', valueType: 'string' }));
  assert.equal(editUiControlOptions(full, 'remove', { index: 0 })!.length, maxUiControlOptions - 1);
  assert.deepEqual(definition, before);
});

test('reads distinguish a missing option from empty/zero/false, and require safe-integer indices', () => {
  const f = createUiControlOptionsFixture();
  for (const [id, type, fallback] of [['choice', 'string', ''], ['boolean_choice', 'boolean', false], ['number_choice', 'number', 0]] as const) {
    for (const index of [-1, Number.MAX_SAFE_INTEGER]) assert.deepEqual(readUiControlOption(info(f, id), index, type), { found: false, label: '', value: fallback });
  }
  for (const index of [NaN, Infinity, 1.5, '0', false]) assert.throws(() => readUiControlOption(info(f), index, 'string'));
  assert.throws(() => readUiControlOption(info(f), 0, 'boolean'));
});

test('list edits expose current count, labels and order without modifying source, mirror or design', () => {
  const f = createUiControlOptionsFixture(), original = structuredClone(f.project);
  const result = sample(f, [click('append'), click('rename'), click('move'), click('observe')]);
  assert.equal(result.incomplete, false); assert.deepEqual(result.controlOptions.choice.map(option => option.value), ['另一个', '初始', '动态']);
  assert.equal(result.variables.observed_count, 3); assert.equal(result.variables.observed_index, 1); assert.equal(result.variables.observed_label, '初始改名');
  assert.deepEqual([result.variables.read_found, result.variables.read_label, result.variables.read_value], [true, '另一个', '另一个']);
  assert.equal(result.variables.choice_source, '初始'); assert.equal(result.variables.changed_count, 0);
  assert.deepEqual(result.controlOptions.mirror, info(f).options); assert.deepEqual(f.project, original);
  assert.equal(uiPropertyDefault(f.project, f.page.components[0], 'optionCount'), 2);
});

test('remove and clear retain the value with no selection; an empty list never becomes free text', () => {
  const f = createUiControlOptionsFixture();
  const removed = sample(f, [click('remove')]); assert.equal(removed.variables.observed_index, -1); assert.equal(removed.controlValues.choice, '初始');
  const cleared = sample(f, [click('clear'), click('observe')]);
  assert.equal(cleared.incomplete, false); assert.deepEqual(cleared.controlOptions.choice, []); assert.equal(cleared.controlValues.choice, '初始');
  assert.deepEqual([cleared.variables.observed_count, cleared.variables.observed_index, cleared.variables.observed_label], [0, -1, '']);
  assert.deepEqual([cleared.variables.read_found, cleared.variables.read_label, cleared.variables.read_value], [false, '', '']);
  assert.ok(uiControlValueProblem({ ...info(f), options: [] }, '自由写入'));
  assert.equal(info(f).textInput, false); assert.equal(cleared.variables.changed_count, 0);
});

test('resetting a list preserves value overrides, while whole reset clears both independently of mirrors', () => {
  const f = createUiControlOptionsFixture();
  const reset = sample(f, [click('append'), click('override'), click('reset')]);
  assert.equal(reset.incomplete, false); assert.equal(reset.controlValues.choice, '动态'); assert.equal(reset.variables.observed_index, -1);
  assert.equal(reset.controlValues.mirror, '初始'); assert.equal(reset.variables.choice_source, '初始'); assert.equal(reset.variables.changed_count, 0);
  const whole = sample(f, [click('append'), click('override'), click('whole')]);
  assert.equal(whole.controlValues.choice, '初始'); assert.deepEqual(whole.controlOptions.choice, info(f).options);
  const source = sample(f, [click('append'), click('source'), click('reset')]);
  assert.equal(source.variables.choice_source, '动态'); assert.equal(source.controlValues.mirror, '动态'); assert.equal(source.variables.changed_count, 0);
});

test('real choice events use a current list snapshot; stale selections and read-only input do not write', () => {
  const f = createUiControlOptionsFixture(), inserted = sample(f, [click('append')]);
  const selection: UiPreviewEvent = { kind: 'control', componentId: 'choice', pageInstance: inserted.layers[0].instance, value: '动态', optionIndex: 2, optionsKey: uiControlOptionsKey(inserted.controlOptions.choice) };
  const chosen = sample(f, [click('append'), selection]); assert.equal(chosen.incomplete, false); assert.equal(chosen.variables.choice_source, '动态'); assert.equal(chosen.controlValues.mirror, '动态'); assert.equal(chosen.variables.changed_count, 1);
  const stale = sample(f, [click('append'), click('move'), selection]); assert.equal(stale.incomplete, false); assert.equal(stale.variables.choice_source, '初始'); assert.equal(stale.variables.changed_count, 0);
  const readonly = sample(f, [click('readonly'), click('append'), selection]); assert.equal(readonly.incomplete, false); assert.equal(readonly.controlOptions.choice.length, 3); assert.equal(readonly.variables.choice_source, '初始'); assert.equal(readonly.variables.changed_count, 0);
});

test('list errors remain atomic in the interpreter and dynamic assignments are not checked against the design list', () => {
  for (const patch of [{ index: 99 }, { valueType: 'boolean', value: false }, { label: '' }, { optionsVersion: 99 }]) {
    const f = createUiControlOptionsFixture(); Object.assign(f.operations.append.properties, patch); synchronizeBlueprintSignatures(f.project);
    const result = sample(f, [click('append')]); assert.equal(result.incomplete, true); assert.deepEqual(result.controlOptions.choice, info(f).options); assert.equal(result.variables.choice_source, '初始');
  }
  const f = createUiControlOptionsFixture(); const write = f.graph.nodes.find(node => node.type === 'setUiProperty' && node.properties.property === 'optionIndex')!;
  assert.equal(validateBlueprints(f.project).some(issue => issue.nodeId === write.id), false);
  write.properties.property = 'stringValue'; write.properties.value = '动态'; synchronizeBlueprintSignatures(f.project);
  assert.equal(validateBlueprints(f.project).some(issue => issue.nodeId === write.id), false);
  assert.equal(sample(f, [click('append'), click('override')]).controlValues.choice, '动态');
});

test('three scalar bindings retain type and empty/zero/false through the interpreter', () => {
  for (const [target, valueType, value] of [['choice', 'string', ''], ['number_choice', 'number', 0], ['boolean_choice', 'boolean', false]] as const) {
    const f = createUiControlOptionsFixture();
    const operation = target === 'choice' ? f.operations.append : f.nativeGraph.nodes.find(node => node.type === 'editUiControlOptions')!;
    Object.assign(operation.properties, { componentId: target, valueType, index: 0, label: '显式值', value }); synchronizeBlueprintSignatures(f.project);
    assert.deepEqual(validateBlueprints(f.project).filter(issue => issue.severity === 'error'), []);
    const result = sample(f, target === 'choice' ? [click('append')] : [click('native'), componentClick('native_append')]); assert.equal(result.incomplete, false); assert.equal(result.controlOptions[target][0].value, value); assert.equal(result.variables.changed_count, 0);
  }
});

test('child and template instances share the same list semantics and reject old instance events after reopen', () => {
  const f = createUiControlOptionsFixture();
  const initial = [click('child'), componentClick('child_append')]; const opened = sample(f, initial);
  const instance = opened.layers.find(layer => layer.pageId === f.child.id)!.instance;
  const events = [...initial, componentClick('child_close'), click('child')]; const reopened = sample(f, events);
  assert.deepEqual(reopened.controlOptions.child_choice, info(f).options); assert.notEqual(reopened.layers.find(layer => layer.pageId === f.child.id)!.instance, instance);
  const stale = sample(f, [...events, { kind: 'control', componentId: 'child_choice', pageInstance: instance, value: '另一个', optionIndex: 1, optionsKey: uiControlOptionsKey(info(f).options) }]);
  assert.equal(stale.variables.choice_source, '初始');
  const native = sample(f, [click('native'), componentClick('native_append')]); assert.equal(native.incomplete, false); assert.equal(native.controlOptions.native_choice.length, 3); assert.equal(native.preferences.skipAll, false);
  const nativeAgain = sample(f, [click('native'), componentClick('native_append'), componentClick('native_close'), click('native')]); assert.equal(nativeAgain.controlOptions.native_choice.length, 2);
});

test('background edits use the same implementation and page exit cancels pending work and releases list overrides', () => {
  const f = createUiControlOptionsFixture(); assert.deepEqual(blueprintTaskProblems(f.project, f.background.id), []);
  const result = sample(f, [click('background'), { kind: 'advance', seconds: .5 }]); assert.equal(result.incomplete, false); assert.equal(result.variables.job_done, true); assert.equal(result.controlOptions.choice[2].value, '任务'); assert.equal(result.variables.changed_count, 0);
  const closed = sample(f, [click('append'), click('background'), click('close'), { kind: 'advance', seconds: .5 }]); assert.equal(closed.variables.job_done, false); assert.deepEqual(closed.controlOptions.choice, info(f).options);
});

test('operation changes remove only inapplicable pins, while unknown versions retain original properties and pins', () => {
  const f = createUiControlOptionsFixture(), before = structuredClone(f.editorEdit.pins);
  f.editorEdit.properties.operation = 'move'; synchronizeBlueprintSignatures(f.project);
  assert.deepEqual(f.editorEdit.pins.map(pin => pin.id), ['exec_in', 'componentId', 'index', 'toIndex', 'exec_out']);
  assert.equal(f.editGraph.links.some(link => link.toNodeId === f.editorEdit.id && link.toPinId === 'label'), false);
  assert.equal(f.editorEdit.properties.label, '原标签');
  f.editorEdit.pins = before; f.editorEdit.properties.optionsVersion = 8; const unknown = structuredClone(f.editorEdit); synchronizeBlueprintSignatures(f.project);
  assert.deepEqual(f.editorEdit, unknown); assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === unknown.id && issue.message.includes('版本')));
  const roundtrip = projectSchema.parse(JSON.parse(JSON.stringify(f.project))); assert.deepEqual(roundtrip.blueprints.find(graph => graph.id === f.editGraph.id)!.nodes.find(node => node.id === unknown.id)!.properties, unknown.properties);
});

test('front/background generation shares only active operands, scalar reads, and saved page-owned list records', () => {
  const f = createUiControlOptionsFixture(), original = structuredClone(f.project), compiled = compileProject(f.project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, original);
  const source = Object.values(compiled.files).join('\n');
  assert.match(source, /def vn_ui_control_edit_options/); assert.match(source, /class VnSelectControlOption/); assert.match(source, /default vn_ui_control_option_overrides = {}/);
  assert.ok(source.includes('vn_ui_control_option("choice", 0, "string", 1)'));
  assert.ok(source.includes('value="任务"')); assert.ok(source.includes('create_native=False')); assert.ok(source.includes('substitute False'));
  const readPins: string[] = []; const edit = blueprintNodeDefaults('editUiControlOptions'); edit.properties.operation = 'remove';
  const expression = uiControlOptionEditExpression(edit, pin => { readPins.push(pin); return pin; }); assert.deepEqual(readPins.sort(), ['componentId', 'index']); assert.ok(!expression.includes('label='));
});

test('early-development exec identities survive synchronization and continue into following actions', () => {
  const f = createUiControlOptionsFixture();
  for (const graph of [f.graph, f.background]) for (const node of graph.nodes.filter(node => node.type === 'editUiControlOptions')) {
    node.pins.find(pin => pin.id === 'exec_out')!.id = 'exec';
    for (const link of graph.links.filter(link => link.fromNodeId === node.id && link.fromPinId === 'exec_out')) link.fromPinId = 'exec';
  }
  synchronizeBlueprintSignatures(f.project);
  assert.ok(f.operations.append.pins.some(pin => pin.id === 'exec' && pin.direction === 'output'));
  const foreground = sample(f, [click('append')]); assert.equal(foreground.incomplete, false); assert.equal(foreground.variables.observed_count, 3);
  const background = sample(f, [click('background'), { kind: 'advance', seconds: .5 }]); assert.equal(background.incomplete, false); assert.equal(background.variables.job_done, true);
  const source = Object.values(compileProject(f.project).files).join('\n'); assert.ok(source.includes('return ("next", ["exec"])'));
  assert.doesNotMatch(source, /text_substitute/);
  assert.match(source, /textbutton vn_ui_literal\(option\["label"\]\)[^\n]+ substitute False/);
});

test('numeric choice rows remain present but cannot select outside the current local range', () => {
  const f = createUiControlOptionsFixture(); f.project.ui.components.find(component => component.id === 'number_choice')!.controlRange = { min: .25, max: .75, step: .1 };
  const initial = sample(f, [click('native')]), result = sample(f, [click('native'), { kind: 'control', componentId: 'number_choice', pageInstance: initial.layers.at(-1)!.instance, optionsKey: uiControlOptionsKey(initial.controlOptions.number_choice), optionIndex: 0, value: 0 }]);
  assert.equal(result.incomplete, false); assert.equal(result.preferences.musicVolume, .5); assert.equal(result.variables.changed_count, 0); assert.equal(result.controlOptions.number_choice.length, 3);
});
