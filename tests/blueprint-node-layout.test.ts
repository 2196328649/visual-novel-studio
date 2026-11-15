import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeLayout, blueprintMeasuredNodeSize, type BlueprintNodeLayout, type BlueprintNodeLayoutOptions } from '../src/core/blueprint-node-layout';
import { blueprintCatalog, blueprintNodeDefaults, blueprintPin, callablePins, createBlueprintGraph, type BlueprintNodeType } from '../src/core/blueprint';
import { blueprintChoicePins } from '../src/core/blueprint-choice';
import { blueprintTaskPins } from '../src/core/blueprint-tasks';
import type { BlueprintNode, BlueprintPin } from '../src/core/model';

const advancedIds: Partial<Record<BlueprintNodeType, readonly string[]>> = {
  showCharacter: ['instanceId', 'useDefaultFraming', 'x', 'y', 'scale', 'layer'],
  showChapter: ['backgroundId', 'titleImageId', 'soundId', 'effect'],
  camera: ['rotation'],
};
function ids(pins: readonly BlueprintPin[]) { return pins.map(pin => pin.id); }
function rowPins(layout: BlueprintNodeLayout, direction: BlueprintPin['direction'], execution: boolean) {
  return (execution ? layout.executionRows : layout.dataRows).flatMap(row => row[direction] ? [row[direction]!] : []);
}
function assertPartition(node: BlueprintNode, layout: BlueprintNodeLayout) {
  for (const direction of ['input', 'output'] as const) for (const execution of [true, false]) {
    const expected = node.pins.filter(pin => pin.direction === direction && (pin.dataType === 'exec') === execution && !layout.hiddenInputs.includes(pin));
    assert.deepEqual(rowPins(layout, direction, execution), expected, node.type + ' ' + direction);
    for (const [index, pin] of rowPins(layout, direction, execution).entries()) assert.equal(pin, expected[index]);
  }
  assert.equal(layout.visiblePinIds.length + layout.hiddenInputs.length, node.pins.length);
  assert.deepEqual(layout.visiblePinIds, ids(node.pins.filter(pin => !layout.hiddenInputs.includes(pin))));
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

test('every catalog node retains execution ports, outputs, and inputs outside the explicit advanced list', () => {
  for (const type of Object.keys(blueprintCatalog) as BlueprintNodeType[]) {
    const node = blueprintNodeDefaults(type), layout = blueprintNodeLayout(node);
    const allowed = advancedIds[type] ?? [];
    assertPartition(node, layout);
    assert.deepEqual(ids(layout.advancedInputs), ids(node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec' && allowed.includes(pin.id))));
    for (const pin of node.pins) if (pin.dataType === 'exec' || pin.direction === 'output' || !allowed.includes(pin.id)) assert.ok(layout.visiblePinIds.includes(pin.id), type + ':' + pin.id);
    assert.ok(layout.hiddenInputs.every(pin => pin.direction === 'input' && pin.dataType !== 'exec' && allowed.includes(pin.id)));
    const expanded = blueprintNodeLayout(node, { advancedExpanded: true });
    assert.deepEqual(expanded.hiddenInputs, []); assert.deepEqual(expanded.visiblePinIds, ids(node.pins)); assertPartition(node, expanded);
    assert.deepEqual(blueprintNodeLayout(node, { parametersCollapsed: true }).visiblePinIds, layout.visiblePinIds);
  }
});

test('unchanged advanced defaults hide while changed false, zero, and empty values stay available', () => {
  const character = blueprintNodeDefaults('showCharacter');
  assert.deepEqual(ids(blueprintNodeLayout(character).hiddenInputs), advancedIds.showCharacter);
  character.properties.x = 0; character.properties.y = 0; character.properties.scale = 0; character.properties.layer = 0;
  for (const id of ['x', 'y', 'scale', 'layer']) assert.ok(blueprintNodeLayout(character).visiblePinIds.includes(id));
  character.pins.find(pin => pin.id === 'useDefaultFraming')!.defaultValue = true; character.properties.useDefaultFraming = false;
  character.pins.find(pin => pin.id === 'instanceId')!.defaultValue = 'second'; character.properties.instanceId = '';
  const changed = blueprintNodeLayout(character);
  assert.ok(changed.visiblePinIds.includes('useDefaultFraming')); assert.ok(changed.visiblePinIds.includes('instanceId'));
  const camera = blueprintNodeDefaults('camera');
  camera.properties.rotation = -0; assert.ok(blueprintNodeLayout(camera).visiblePinIds.includes('rotation'));
  camera.properties.rotation = 0; assert.deepEqual(ids(blueprintNodeLayout(camera).hiddenInputs), ['rotation']);
  const chapter = blueprintNodeDefaults('showChapter'); chapter.properties.effect = 'fade'; chapter.properties.backgroundId = 'chapter_bg';
  assert.ok(blueprintNodeLayout(chapter).visiblePinIds.includes('effect')); assert.ok(blueprintNodeLayout(chapter).visiblePinIds.includes('backgroundId'));
});

test('required, connected, and problem inputs reveal unchanged advanced values without changing parameter collapse', () => {
  const node = blueprintNodeDefaults('showCharacter');
  node.pins.find(pin => pin.id === 'x')!.required = true;
  const options = { parametersCollapsed: true, connectedInputs: new Set(['y', 'unknown_connection']) };
  const layout = blueprintNodeLayout(node, options);
  assert.ok(layout.visiblePinIds.includes('x')); assert.ok(layout.visiblePinIds.includes('y'));
  assert.ok(!layout.visiblePinIds.includes('scale'));
  for (const parametersCollapsed of [false, true]) {
    const problematic = blueprintNodeLayout(node, { parametersCollapsed, hasProblem: true });
    assert.deepEqual(problematic.visiblePinIds, ids(node.pins)); assert.deepEqual(problematic.hiddenInputs, []);
  }
  assert.deepEqual(blueprintNodeLayout(node, { ...options, parametersCollapsed: false }).visiblePinIds, layout.visiblePinIds);
});

test('missing baselines and malformed values remain repairable instead of being hidden by equality', () => {
  const noBaseline = blueprintNodeDefaults('camera');
  delete noBaseline.pins.find(pin => pin.id === 'rotation')!.defaultValue;
  assert.ok(blueprintNodeLayout(noBaseline).visiblePinIds.includes('rotation'));
  noBaseline.properties.rotation = 0; assert.ok(blueprintNodeLayout(noBaseline).visiblePinIds.includes('rotation'));
  for (const invalid of [NaN, Infinity, -Infinity, '0', false, null, {}, []]) {
    const node = blueprintNodeDefaults('camera'), pin = node.pins.find(pin => pin.id === 'rotation')!;
    // Damaged imports may violate the model before validation; preserve the pin.
    (pin as { defaultValue?: unknown }).defaultValue = invalid;
    (node.properties as Record<string, unknown>).rotation = invalid;
    assert.ok(blueprintNodeLayout(node).visiblePinIds.includes('rotation'));
  }
  for (const invalid of ['0', false, NaN, Infinity, {}, []]) {
    const node = blueprintNodeDefaults('camera'); (node.properties as Record<string, unknown>).rotation = invalid;
    assert.ok(blueprintNodeLayout(node).visiblePinIds.includes('rotation'));
  }
  const nullish = blueprintNodeDefaults('camera'); (nullish.properties as Record<string, unknown>).rotation = null;
  assert.deepEqual(ids(blueprintNodeLayout(nullish).hiddenInputs), ['rotation'], 'nullish properties follow blueprintInputValue fallback');
  const unknownType = blueprintNodeDefaults('showChapter');
  (unknownType.pins.find(pin => pin.id === 'effect')! as { dataType: string }).dataType = 'future_type';
  assert.ok(blueprintNodeLayout(unknownType).visiblePinIds.includes('effect'));
});

test('explicit advanced ids only apply to actual data inputs and never swallow unknown or output pins', () => {
  const node = blueprintNodeDefaults('showCharacter');
  node.pins.find(pin => pin.id === 'x')!.direction = 'output';
  node.pins.find(pin => pin.id === 'y')!.dataType = 'exec';
  node.pins.push(blueprintPin('future_optional', '扩展参数', 'input', 'number', 0), blueprintPin('future_branch', '扩展执行', 'output'));
  const layout = blueprintNodeLayout(node);
  for (const id of ['x', 'y', 'future_optional', 'future_branch']) assert.ok(layout.visiblePinIds.includes(id));
  assert.ok(!ids(layout.advancedInputs).includes('x')); assert.ok(!ids(layout.advancedInputs).includes('y')); assertPartition(node, layout);
  const other = blueprintNodeDefaults('showBackground'); other.pins.push(blueprintPin('rotation', '额外旋转', 'input', 'number', 0));
  assert.ok(blueprintNodeLayout(other).visiblePinIds.includes('rotation')); assert.deepEqual(blueprintNodeLayout(other).advancedInputs, []);
});

test('multiple control ports, callable arguments, task outcomes and page interfaces retain stable ids and order', () => {
  const module = createBlueprintGraph('function', '动态模块');
  module.exposedInputs = [blueprintPin('flag', '开关参数', 'input', 'boolean', false), blueprintPin('count', '数量参数', 'input', 'number', 0)];
  module.exposedOutputs = [blueprintPin('text', '返回文字', 'output', 'string', '')];
  const call = blueprintNodeDefaults('callFunction'); call.pins = callablePins(module);
  const task = blueprintNodeDefaults('waitTask'); task.pins = blueprintTaskPins(task, module);
  const page = blueprintNodeDefaults('showUiPage');
  page.pins.push(blueprintPin('arg_flag', '页面输入', 'input', 'boolean', false), blueprintPin('out_count', '页面输出', 'output', 'number', 0));
  const close = blueprintNodeDefaults('closeUiPage'); close.pins.push(blueprintPin('out_count', '页面关闭结果', 'input', 'number', 0));
  const choice = blueprintNodeDefaults('switchValue'); choice.pins = blueprintChoicePins(choice)!;
  for (const node of [call, task, page, close, choice, ...(['gate', 'sequence', 'forLoop'] as const).map(type => blueprintNodeDefaults(type))]) {
    const before = structuredClone(node);
    for (const options of [{}, { parametersCollapsed: true }, { advancedExpanded: true }] as BlueprintNodeLayoutOptions[]) {
      const layout = blueprintNodeLayout(node, options);
      assert.deepEqual(layout.visiblePinIds, ids(node.pins)); assert.deepEqual(layout.hiddenInputs, []); assertPartition(node, layout);
    }
    assert.deepEqual(node, before);
  }
  assert.deepEqual(ids(rowPins(blueprintNodeLayout(task), 'output', true)), ['completed', 'cancelled', 'failed', 'missing']);
  assert.ok(blueprintNodeLayout(call).visiblePinIds.includes('arg_flag')); assert.ok(blueprintNodeLayout(task).visiblePinIds.includes('out_text'));
});

test('visible layout signatures are deterministic and refresh when handle layout or editor state changes', () => {
  const node = blueprintNodeDefaults('showCharacter'), initial = blueprintNodeLayout(node);
  assert.equal(blueprintNodeLayout(structuredClone(node)).signature, initial.signature);
  for (const options of [{ parametersCollapsed: true }, { advancedExpanded: true }, { connectedInputs: new Set(['x']) }, { hasProblem: true }]) assert.notEqual(blueprintNodeLayout(node, options).signature, initial.signature);
  assert.equal(blueprintNodeLayout(node, { connectedInputs: new Set(['x', 'y']) }).signature, blueprintNodeLayout(node, { connectedInputs: new Set(['y', 'x']) }).signature);
  node.properties.x = 0; assert.notEqual(blueprintNodeLayout(node).signature, initial.signature);
  const changed = blueprintNodeLayout(node).signature;
  node.pins.push(blueprintPin('future', '新接口', 'output', 'string')); assert.notEqual(blueprintNodeLayout(node).signature, changed);
  const named = blueprintNodeLayout(node).signature; node.pins.at(-1)!.name = '更新后的接口名称'; assert.notEqual(blueprintNodeLayout(node).signature, named);
  node.x += 100; node.y += 100; node.name = '节点改名';
  const moved = blueprintNodeLayout(node).signature; node.properties.unrelated = 7; assert.equal(blueprintNodeLayout(node).signature, moved);
});

test('estimated dimensions account for visible rows, property editors, and the advanced footer', () => {
  assert.deepEqual(blueprintNodeLayout(blueprintNodeDefaults('getVariable')).estimatedSize, { width: 240, height: 40 });
  for (const type of ['event', 'return', 'startDialogue'] as const) assert.equal(blueprintNodeLayout(blueprintNodeDefaults(type)).estimatedSize.width, 224);
  for (const type of ['math', 'round', 'compare', 'literal', 'clamp'] as const) assert.equal(blueprintNodeLayout(blueprintNodeDefaults(type)).estimatedSize.width, 232);
  for (const [type, fieldHeight] of [['math', 28], ['round', 28], ['compare', 56], ['literal', 56]] as const) {
    const node = blueprintNodeDefaults(type), expanded = blueprintNodeLayout(node), collapsed = blueprintNodeLayout(node, { parametersCollapsed: true });
    assert.equal(expanded.estimatedSize.height - collapsed.estimatedSize.height, fieldHeight);
  }
  const camera = blueprintNodeDefaults('camera'), compact = blueprintNodeLayout(camera), expanded = blueprintNodeLayout(camera, { advancedExpanded: true });
  assert.equal(compact.estimatedSize.width, 264);
  assert.equal(compact.estimatedSize.height, 32 + compact.executionRows.length * 26 + compact.dataRows.length * 28 + 28 + 24 + 8);
  assert.equal(expanded.estimatedSize.height - compact.estimatedSize.height, 28);
  const both = blueprintNodeDefaults('callFunction'); both.pins = [blueprintPin('exec_in', '执行', 'input'), blueprintPin('arg', '参数', 'input', 'any', ''), blueprintPin('out', '结果', 'output', 'any'), blueprintPin('exec_out', '完成', 'output')];
  assert.equal(blueprintNodeLayout(both).estimatedSize.width, 280);
  assert.equal(blueprintNodeLayout(both).estimatedSize.height - blueprintNodeLayout(both, { parametersCollapsed: true }).estimatedSize.height, 12);
  both.pins[1].dataType = 'asset'; both.pins[1].defaultValue = 'a'.repeat(30); both.pins[2].dataType = 'asset';
  assert.equal(blueprintNodeLayout(both).estimatedSize.width, 280);
  assert.equal(blueprintNodeLayout(blueprintNodeDefaults('select')).estimatedSize.width, 280, 'any data selectors override pure compact width');
  const keyed = blueprintNodeDefaults('selectByKey'); keyed.pins.find(pin => pin.id === 'default')!.dataType = 'asset'; keyed.pins.find(pin => pin.id === 'default')!.defaultValue = 'a'.repeat(30);
  assert.equal(blueprintNodeLayout(keyed).estimatedSize.width, 280, 'long reference selectors override pure compact width');
  const widePure = blueprintNodeDefaults('math'); widePure.pins[0].dataType = 'any';
  assert.equal(blueprintNodeLayout(widePure).estimatedSize.width, 280);
  widePure.pins[0].dataType = 'asset'; widePure.pins[0].defaultValue = 'a'.repeat(30);
  assert.equal(blueprintNodeLayout(widePure).estimatedSize.width, 280);
  const loop = blueprintNodeDefaults('forLoop'), normalHeight = blueprintNodeLayout(loop).estimatedSize.height;
  loop.properties.first_index = 'ignored'.repeat(6); assert.equal(blueprintNodeLayout(loop).estimatedSize.height, normalHeight);
  loop.properties.firstIndex = 'long imported value'.repeat(3); assert.equal(blueprintNodeLayout(loop).estimatedSize.height, normalHeight + 12);
});

test('comment estimates cover wrapped and multiline prose with a bounded body while getters stay one row', () => {
  const note = blueprintNodeDefaults('comment'), empty = blueprintNodeLayout(note).estimatedSize;
  assert.equal(empty.width, 280);
  note.properties.text = '第一段\n第二段\n第三段';
  const multiline = blueprintNodeLayout(note).estimatedSize;
  assert.ok(multiline.height > empty.height); assert.equal(multiline.width, 280);
  note.properties.text = '说'.repeat(80); assert.ok(blueprintNodeLayout(note).estimatedSize.height > multiline.height);
  note.properties.text = '很长的注释\n'.repeat(100); assert.equal(blueprintNodeLayout(note).estimatedSize.height, 280);
  assert.deepEqual(blueprintNodeLayout(note, { parametersCollapsed: true }).estimatedSize, blueprintNodeLayout(note).estimatedSize);
  const getter = blueprintNodeDefaults('getVariable'); getter.properties.value = '长引用'.repeat(100);
  assert.equal(blueprintNodeLayout(getter, { parametersCollapsed: true, advancedExpanded: true, hasProblem: true }).estimatedSize.height, 40);
});

test('finite positive measurements take precedence per dimension and damaged measurements use the fallback', () => {
  const node = blueprintNodeDefaults('showCharacter'), options = { advancedExpanded: true }, fallback = blueprintNodeLayout(node, options).estimatedSize;
  assert.deepEqual(blueprintMeasuredNodeSize(node, options), fallback);
  assert.deepEqual(blueprintMeasuredNodeSize(node, options, { width: 200, height: 40 }), { width: 200, height: 40 });
  assert.deepEqual(blueprintMeasuredNodeSize(node, options, { width: 200 }), { width: 200, height: fallback.height });
  assert.deepEqual(blueprintMeasuredNodeSize(node, options, { height: 40 }), { width: fallback.width, height: 40 });
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    assert.deepEqual(blueprintMeasuredNodeSize(node, options, { width: invalid, height: invalid }), fallback);
    assert.deepEqual(blueprintMeasuredNodeSize(node, options, { width: 200, height: invalid }), { width: 200, height: fallback.height });
  }
});

test('layout and measurement preserve frozen nodes, pin references, properties and connection sets', () => {
  const node = deepFreeze(blueprintNodeDefaults('showCharacter')), before = structuredClone(node);
  const connectedInputs = new Set(['x', 'exec_in']), options = deepFreeze({ connectedInputs, parametersCollapsed: true });
  const connections = [...connectedInputs], layout = blueprintNodeLayout(node, options);
  assertPartition(node, layout); blueprintMeasuredNodeSize(node, options, { width: 220 });
  assert.deepEqual(node, before); assert.deepEqual([...connectedInputs], connections);
  for (const pin of [...layout.advancedInputs, ...layout.hiddenInputs]) assert.equal(node.pins.find(candidate => candidate.id === pin.id), pin);
  const independent = blueprintNodeLayout(node, options); layout.visiblePinIds.push('not_a_real_pin'); layout.dataRows.pop();
  assert.ok(!independent.visiblePinIds.includes('not_a_real_pin')); assertPartition(node, independent);
});
