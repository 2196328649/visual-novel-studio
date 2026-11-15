import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type BlueprintNode, type UiComponent, type VariableValue } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { setBlueprintUiPropertyRows, type BlueprintUiPropertyRow } from '../src/core/blueprint-ui-property-batch';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { createUiEventGraph } from '../src/core/ui-logic';

function fixture(events = false) {
  const project = createProject('批量属性验证');
  project.blueprints = []; project.timelinePresets = [];
  project.ui.components = []; project.ui.instances = []; delete project.ui.activeInstanceId;
  project.variables.push(
    { id: 'number_source', name: '数值来源', type: 'number', initial: 30, persistent: false, setting: { min: 0, max: 100, step: 1 } },
    { id: 'boolean_source', name: '开关来源', type: 'boolean', initial: true, persistent: false },
    { id: 'choice_source', name: '选项来源', type: 'string', initial: '甲', persistent: false, setting: { options: ['甲', '乙'] } },
    { id: 'audio_source', name: '音频来源', type: 'asset', assetKind: 'audio', initial: '', persistent: false },
  );
  project.assets = [{ id: 'picture', name: '图片', kind: 'image', path: 'image.png' }];
  const component: UiComponent = { id: 'target', kind: 'button', page: 'custom', name: '目标按钮', text: '示例', x: .1, y: .2, width: .2, height: .1 };
  const page = { id: 'batch_page', name: '批量属性页', modal: true, components: [component] };
  project.ui.customPages = [page];
  const graph = events ? createUiEventGraph(project, page.id, '批量属性事件') : createBlueprintGraph('function', '批量属性模块');
  if (!events) project.blueprints.push(graph);
  const add = (type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => {
    const node = blueprintNodeDefaults(type); Object.assign(node.properties, { componentId: component.id }, properties); graph.nodes.push(node);
    synchronizeBlueprintSignatures(project); return node;
  };
  const batch = (items: { property: string; value: VariableValue; mode?: string }[]) => {
    const node = blueprintNodeDefaults('setUiProperty'); node.properties.componentId = component.id;
    const rows: BlueprintUiPropertyRow[] = items.map((item, index) => ({ id: 'value_row' + index, property: item.property, writeMode: item.mode ?? 'override' }));
    setBlueprintUiPropertyRows(node, rows);
    rows.forEach((row, index) => { node.properties[row.id] = items[index].value; });
    graph.nodes.push(node); synchronizeBlueprintSignatures(project); return node;
  };
  const wire = (from: BlueprintNode, output: string, to: BlueprintNode, input = 'exec_in') => {
    assert.equal(connectBlueprintPins(graph, from.id, output, to.id, input), undefined);
  };
  const issues = (node: BlueprintNode) => validateBlueprints(project).filter(issue => issue.nodeId === node.id);
  const errors = (node: BlueprintNode) => issues(node).filter(issue => issue.severity === 'error');
  return { project, component, page, graph, add, batch, wire, issues, errors };
}

test('multiple ordinary rows validate without migrating or modifying saved data', () => {
  const f = fixture(), node = f.batch([{ property: 'visible', value: false }, { property: 'x', value: -.2 }, { property: 'text', value: '' }]);
  const before = structuredClone(f.project);
  assert.deepEqual(f.errors(node), []); assert.deepEqual(f.project, before);
});

test('batch diagnostics retain structural errors for versions, JSON, duplicate row IDs and properties', () => {
  for (const [properties, message] of [
    [{ propertyBatchVersion: 9 }, /版本/],
    [{ propertyWrites: '{broken' }, /无法读取/],
    [{ propertyWrites: JSON.stringify([{ id: 'value_row0', property: 'x', writeMode: 'override' }, { id: 'value_row0', property: 'y', writeMode: 'override' }]) }, /标识重复/],
    [{ propertyWrites: JSON.stringify([{ id: 'value_row0', property: 'x', writeMode: 'override' }, { id: 'value_row1', property: 'x', writeMode: 'override' }]) }, /属性不能重复/],
  ] as const) {
    const f = fixture(), node = f.batch([{ property: 'x', value: .2 }, { property: 'y', value: .3 }]);
    Object.assign(node.properties, properties);
    const before = structuredClone(node);
    assert.ok(f.errors(node).some(issue => message.test(issue.message)), String(message)); assert.deepEqual(node, before);
  }
});

test('each row rejects unknown properties, read-only observations, bad modes and inapplicable fields', () => {
  for (const [property, mode, message] of [
    ['missing_property', 'override', /不存在/], ['videoStatus', 'override', /只读/],
    ['visible', 'unknown_mode', /赋值方式无效/], ['imageCropX', 'override', /不适用于/],
  ] as const) {
    const f = fixture(), node = f.batch([{ property, value: property === 'visible' ? true : 0, mode }]);
    assert.ok(f.errors(node).some(issue => message.test(issue.message)), property);
  }
});

test('batch pins diagnose stale types and extra saved pins rather than treating them as valid inputs', () => {
  const f = fixture(), node = f.batch([{ property: 'visible', value: false }, { property: 'opacity', value: .5 }]);
  node.pins.find(pin => pin.id === 'value_row0')!.dataType = 'string';
  node.pins.push(blueprintPin('value_old', '旧值', 'input', 'number', 0));
  assert.ok(f.errors(node).some(issue => /连接点与属性列表不同步/.test(issue.message)));
});

test('effective row defaults and constant linked values receive property validation', () => {
  const f = fixture(), node = f.batch([{ property: 'visible', value: false }, { property: 'opacity', value: .5 }]);
  delete node.properties.value_row1;
  node.pins.find(pin => pin.id === 'value_row1')!.defaultValue = 2;
  assert.ok(f.errors(node).some(issue => /不透明度.*范围不正确/.test(issue.message)));
  const literal = f.add('literal', { value: 2 });
  literal.pins.find(pin => pin.id === 'value')!.dataType = 'number';
  f.wire(literal, 'value', node, 'value_row1');
  assert.ok(f.errors(node).some(issue => /不透明度.*范围不正确/.test(issue.message)));
});

test('a stale spare numeric default does not override an effective row value or connection', () => {
  const f = fixture(), node = f.batch([{ property: 'opacity', value: .5 }]);
  node.pins.find(pin => pin.id === 'value_row0')!.defaultValue = 2;
  assert.deepEqual(f.errors(node), [], '存储值.5优先于备用默认值2');
  const literal = f.add('literal', { value: .2 });
  literal.pins.find(pin => pin.id === 'value')!.dataType = 'number';
  f.wire(literal, 'value', node, 'value_row0');
  node.pins.find(pin => pin.id === 'value_row0')!.defaultValue = 2;
  assert.deepEqual(f.errors(node), [], '接线值.2优先于备用默认值2');
});

test('resource values and connected asset parameters use the property of their own row', () => {
  const f = fixture(), node = f.batch([{ property: 'idleImage', value: 'picture' }, { property: 'clickSound', value: 'picture' }]);
  assert.ok(f.errors(node).some(issue => /点击音效.*素材/.test(issue.message)));
  node.properties.value_row1 = '';
  const read = f.add('getVariable', { variableId: 'audio_source' });
  f.wire(read, 'value', node, 'value_row0');
  assert.ok(f.errors(node).some(issue => /素材类型不匹配/.test(issue.message)));
});

test('individual row source modes inspect their own explicit controls', () => {
  const f = fixture(); f.component.propertyControls = { opacity: { mode: 'sync', parameterId: 'number_source' } };
  const node = f.batch([{ property: 'opacity', value: .5, mode: 'source' }, { property: 'x', value: .4, mode: 'source' }]);
  const messages = f.errors(node).map(issue => issue.message).join('\n');
  assert.match(messages, /横向位置.*没有可写/); assert.doesNotMatch(messages, /不透明度.*没有可写/);
});

test('a single-direction row warns that the complete group is rejected and preserves legacy warnings', () => {
  const f = fixture(); f.component.propertyControls = { visible: { mode: 'follow', parameterId: 'boolean_source' } };
  const node = f.batch([{ property: 'visible', value: false }, { property: 'x', value: .4 }]);
  assert.deepEqual(f.errors(node), []);
  assert.match(f.issues(node).find(issue => issue.code === 'ui-property-follow-write')!.message, /整组属性都不会修改/);
  const legacy = f.add('setUiProperty', { property: 'visible', value: false, writeMode: 'source' });
  assert.deepEqual(f.errors(legacy), []); assert.equal(f.issues(legacy).find(issue => issue.code === 'ui-property-follow-write')?.severity, 'warning');
});

test('ranges compare only the bounds supplied in the batch and still reject internal contradictions', () => {
  const f = fixture(); Object.assign(f.component, { kind: 'preference', parameterId: 'number_source' });
  const single = f.batch([{ property: 'minimum', value: 200 }]);
  assert.deepEqual(f.errors(single), [], '旧上限100可能已被前序节点修改，不能拒绝200');
  const valid = f.batch([{ property: 'minimum', value: 200 }, { property: 'maximum', value: 300 }, { property: 'numberValue', value: 250 }]);
  assert.deepEqual(f.errors(valid), [], '通用数值参数的设计范围不是蓝图值约束');
  const invalid = f.batch([{ property: 'minimum', value: 300 }, { property: 'maximum', value: 200 }]);
  assert.ok(f.errors(invalid).some(issue => /下限不能大于上限/.test(issue.message)));
  const step = f.batch([{ property: 'step', value: 0 }]); assert.ok(f.errors(step).some(issue => /步长必须大于/.test(issue.message)));
});

test('current-value aliases cannot be written twice and option existence waits for the runtime list', () => {
  const f = fixture(); Object.assign(f.component, { kind: 'preference', parameterId: 'number_source' });
  const number = f.batch([{ property: 'numberValue', value: 30 }, { property: 'normalizedValue', value: .3 }]);
  assert.ok(f.errors(number).some(issue => /别名重复/.test(issue.message)));
  Object.assign(f.component, { kind: 'preferenceChoice', parameterId: 'choice_source' });
  const choice = f.batch([{ property: 'optionIndex', value: 100 }]); assert.deepEqual(f.errors(choice), []);
  const duplicate = f.batch([{ property: 'stringValue', value: '甲' }, { property: 'optionIndex', value: 0 }]);
  assert.ok(f.errors(duplicate).some(issue => /别名重复/.test(issue.message)));
});

test('engine boundaries remain distinct from a built-in slider design range', () => {
  const f = fixture(); Object.assign(f.component, { kind: 'preference', preference: 'textSpeed' });
  const expanded = f.batch([{ property: 'minimum', value: 300 }, { property: 'maximum', value: 500 }, { property: 'numberValue', value: 400 }]);
  assert.deepEqual(f.errors(expanded), [], '文字速度默认200上限可以由前序或本组扩展');
  f.component.preference = 'musicVolume';
  const bounded = f.batch([{ property: 'maximum', value: 2 }]);
  assert.ok(f.errors(bounded).some(issue => /引擎边界/.test(issue.message)), '音量的引擎上限1仍然必须满足');
});

test('definite same-parameter conflicts include explicit sync and implicit source writes', () => {
  const f = fixture(); f.component.propertyControls = { x: { mode: 'sync', parameterId: 'number_source' }, y: { mode: 'sync', parameterId: 'number_source' } };
  const conflicting = f.batch([{ property: 'x', value: .2 }, { property: 'y', value: .4 }]);
  assert.ok(f.errors(conflicting).some(issue => /同一参数.*不同的值/.test(issue.message)));
  const equal = f.batch([{ property: 'x', value: .2 }, { property: 'y', value: .2 }]); assert.deepEqual(f.errors(equal), []);
  Object.assign(f.component, { kind: 'preference', parameterId: 'number_source', propertyControls: { x: { mode: 'sync', parameterId: 'number_source' } } });
  const implicit = f.batch([{ property: 'x', value: 10 }, { property: 'numberValue', value: 20, mode: 'source' }]);
  assert.ok(f.errors(implicit).some(issue => /同一参数.*不同的值/.test(issue.message)));
});

test('dynamic component inputs do not inherit stale component policies or applicability', () => {
  const f = fixture(); f.component.propertyControls = { visible: { mode: 'follow', parameterId: 'boolean_source' } };
  const node = f.batch([{ property: 'visible', value: false }, { property: 'imageCropX', value: .2 }]);
  f.graph.exposedInputs.push(blueprintPin('target_input', '动态组件', 'input', 'component', f.component.id));
  const input = f.add('getInput', { inputId: 'target_input' }); f.wire(input, 'value', node, 'componentId');
  assert.deepEqual(f.issues(node), []);
});

function capabilityBranch(f: ReturnType<typeof fixture>, last: BlueprintNode, property: string, expected?: number) {
  const read = f.add('getUiProperty', { property }), branch = f.add('branch'), bad = f.add('startDialogue');
  f.wire(last, 'exec_out', branch); f.wire(branch, 'true', bad);
  if (expected === undefined) f.wire(read, 'value', branch, 'condition');
  else {
    const compare = f.add('compare', { operator: 'eq', b: expected });
    f.wire(read, 'value', compare, 'a'); f.wire(compare, 'result', branch, 'condition');
  }
  return () => validateBlueprints(f.project).some(issue => issue.nodeId === bad.id && issue.code === 'blueprint.path.capability');
}

test('execution analysis reads the complete pre-write snapshot when swapping two values', () => {
  const f = fixture(true), initial = f.batch([{ property: 'x', value: .1 }, { property: 'y', value: .8 }]);
  const swap = f.batch([{ property: 'x', value: 0 }, { property: 'y', value: 0 }]);
  const x = f.add('getUiProperty', { property: 'x' }), y = f.add('getUiProperty', { property: 'y' });
  f.wire(f.graph.nodes[0], 'exec', initial); f.wire(initial, 'exec_out', swap);
  f.wire(y, 'value', swap, 'value_row0'); f.wire(x, 'value', swap, 'value_row1');
  assert.equal(capabilityBranch(f, swap, 'y', .8)(), false, '交换后y为原x的.1，错误的逐row读写会变成.8');
});

test('a rejected, invalid or uncertain row never makes the other batch row a definite successful override', () => {
  for (const reason of ['follow', 'unknown', 'invalid', 'source', 'bad_json'] as const) {
    const f = fixture(true), node = f.batch([{ property: 'visible', value: false }, { property: 'opacity', value: .5 }]);
    if (reason === 'follow') f.component.propertyControls = { opacity: { mode: 'follow', parameterId: 'number_source' } };
    if (reason === 'unknown') {
      const input = f.add('getVariable', { variableId: 'number_source' }); f.wire(input, 'value', node, 'value_row1');
    }
    if (reason === 'invalid') node.properties.value_row1 = 2;
    if (reason === 'source') f.component.propertyControls = { opacity: { mode: 'sync', parameterId: 'number_source' } };
    if (reason === 'bad_json') node.properties.propertyWrites = '{broken';
    f.wire(f.graph.nodes[0], 'exec', node);
    assert.equal(capabilityBranch(f, node, 'visible')(), true, reason + '整组不得推断visible=false成功裁剪真实能力路径');
  }
});
