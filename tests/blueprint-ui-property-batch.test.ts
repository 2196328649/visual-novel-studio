import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintInputValue, blueprintNodeDefaults, blueprintNodeSummary, blueprintPin, createBlueprintGraph, synchronizeBlueprintNodeValuePins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintNodeAssetFilter } from '../src/core/blueprint-assets';
import { blueprintCardSummary } from '../src/core/blueprint-card-summary';
import { blueprintMeasuredNodeSize, blueprintNodeLayout } from '../src/core/blueprint-node-layout';
import { blueprintNumericPresentation } from '../src/core/blueprint-presentation';
import { blueprintUiPropertyDefinition, blueprintUiPropertyPins, blueprintUiPropertyRowForPin, blueprintUiPropertyRowId, blueprintUiPropertyRows, maxBlueprintUiPropertyRows, setBlueprintUiPropertyRows, type BlueprintUiPropertyRow } from '../src/core/blueprint-ui-property-batch';
import { createProject, projectSchema, type BlueprintNode } from '../src/core/model';
import { mutateProject } from '../src/core/project-mutation';
import { uiProperties } from '../src/core/ui-properties';
import { createUiParameterBinding } from '../src/core/ui-logic';
import { listUiParameterBindings, markUiParameterBindingGraph, uiParameterBindingMarker } from '../src/core/ui-parameter-links';

const row = (id: string, property: string, writeMode = 'override'): BlueprintUiPropertyRow => ({ id, property, writeMode });
function fixture() {
  const project = createProject('组件属性批量赋值');
  project.ui.customPages = [{ id: 'page', name: '属性页', modal: true, components: [{ id: 'button', name: '继续按钮', kind: 'button', page: 'custom', text: '继续', x: 0, y: 0, width: .2, height: .1 }] }];
  const graph = createBlueprintGraph('function', '同时修改属性'), node = blueprintNodeDefaults('setUiProperty');
  node.properties.componentId = 'button'; graph.nodes.push(node); project.blueprints = [graph];
  const literal = (id: string, value: number | boolean | string, dataType: 'number' | 'boolean' | 'string' | 'any' = typeof value as 'number' | 'boolean' | 'string') => {
    const source = blueprintNodeDefaults('literal'); source.id = id; source.properties.value = value; source.pins = [blueprintPin('value', '固定值', 'output', dataType, value)]; graph.nodes.push(source); return source;
  };
  const link = (source: BlueprintNode, pinId: string, id = 'link_' + graph.links.length) => {
    graph.links.push({ id, fromNodeId: source.id, fromPinId: 'value', toNodeId: node.id, toPinId: pinId });
  };
  return { project, graph, node, literal, link };
}

test('legacy node remains single-property storage until an explicit row edit upgrades it', () => {
  const f = fixture(), source = f.literal('visibility_source', false); f.node.properties.value = false; f.link(source, 'value');
  const previous = structuredClone(f.node);
  assert.deepEqual(blueprintUiPropertyDefinition(f.node), { rows: [row('value', 'visible')], problems: [], legacy: true });
  assert.deepEqual(f.node, previous);
  synchronizeBlueprintSignatures(f.project);
  assert.equal(f.node.properties.propertyBatchVersion, undefined);
  assert.equal(f.node.pins.find(pin => pin.id === 'value')!.name, '属性值');
  assert.equal(f.node.pins.find(pin => pin.id === 'value')!.defaultValue, true, 'legacy signature keeps its saved default despite authored override');
  const newId = blueprintUiPropertyRowId(f.node);
  assert.match(newId, /^value_[a-z][a-zA-Z0-9_]{0,47}$/);
  setBlueprintUiPropertyRows(f.node, [...blueprintUiPropertyRows(f.node), row(newId, 'text')]);
  synchronizeBlueprintSignatures(f.project);
  assert.equal(f.node.properties.propertyBatchVersion, 1); assert.equal(f.node.properties.property, undefined); assert.equal(f.node.properties.writeMode, undefined);
  assert.equal(f.node.properties.value, false); assert.equal(blueprintInputValue(f.node, newId), '');
  assert.equal(f.graph.links.find(link => link.fromNodeId === source.id)!.toPinId, 'value');
  assert.equal(blueprintUiPropertyDefinition(f.node).legacy, false);
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(f.project))).blueprints[0], JSON.parse(JSON.stringify(f.graph)));
});

test('pins use each property type and saved zero, false or empty value ahead of defaults', () => {
  const f = fixture();
  setBlueprintUiPropertyRows(f.node, [row('value', 'opacity'), row('value_selected', 'selected'), row('value_text', 'text'), row('value_image', 'image')]);
  Object.assign(f.node.properties, { value: 0, value_selected: false, value_text: '', value_image: '' });
  synchronizeBlueprintNodeValuePins(f.project, f.graph, f.node);
  assert.deepEqual(f.node.pins.filter(pin => pin.id.startsWith('value')).map(pin => [pin.id, pin.dataType, pin.defaultValue]), [
    ['value', 'number', 0], ['value_selected', 'boolean', false], ['value_text', 'string', ''], ['value_image', 'asset', ''],
  ]);
  assert.deepEqual(f.node.pins, blueprintUiPropertyPins(f.node));
  assert.deepEqual(f.node.pins.map(pin => pin.id), ['exec_in', 'componentId', 'value', 'value_selected', 'value_text', 'value_image', 'exec_out']);
  f.node.pins.find(pin => pin.id === 'value_text')!.defaultValue = '旧输入默认';
  delete f.node.properties.value_text;
  assert.equal(blueprintUiPropertyPins(f.node)!.find(pin => pin.id === 'value_text')!.defaultValue, '旧输入默认');
});

test('first batch edit preserves legacy values stored only in the existing value pin', () => {
  for (const [property, value] of [['visible', false], ['opacity', 0], ['text', '']] as const) {
    const f = fixture(); f.node.properties.property = property; delete f.node.properties.value;
    const pin = f.node.pins.find(pin => pin.id === 'value')!; pin.dataType = typeof value as 'boolean' | 'number' | 'string'; pin.defaultValue = value;
    setBlueprintUiPropertyRows(f.node, [...blueprintUiPropertyRows(f.node), row('value_more', 'x')]);
    synchronizeBlueprintSignatures(f.project);
    assert.equal(f.node.properties.value, value); assert.equal(blueprintInputValue(f.node, 'value'), value);
  }
});

test('valid v1 pin-only defaults survive import synchronization and serialized roundtrip', () => {
  const f = fixture();
  setBlueprintUiPropertyRows(f.node, [row('value', 'opacity'), row('value_flag', 'selected'), row('value_text', 'text')]);
  delete f.node.properties.value;
  f.node.pins = [blueprintPin('exec_in', '执行', 'input', 'exec'), blueprintPin('componentId', '界面组件', 'input', 'component'),
    blueprintPin('value', '不透明度', 'input', 'number', 0), blueprintPin('value_flag', '选中', 'input', 'boolean', false), blueprintPin('value_text', '文字', 'input', 'string', 'pin保存的文字'), blueprintPin('exec_out', '完成', 'output', 'exec')];
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(f.project)));
  synchronizeBlueprintSignatures(restored);
  const node = restored.blueprints[0].nodes.find(node => node.id === f.node.id)!;
  assert.deepEqual(['value', 'value_flag', 'value_text'].map(pin => blueprintInputValue(node, pin)), [0, false, 'pin保存的文字']);
  assert.equal(node.properties.value, undefined); assert.equal(node.properties.value_flag, undefined); assert.equal(node.properties.value_text, undefined);
});

test('synchronizing legacy automatic graphs preserves their captions and managed signatures', () => {
  for (const marked of [false, true]) {
    const f = fixture();
    f.project.variables.push({ id: 'show_button', name: '显示按钮', type: 'boolean', initial: false, persistent: false });
    const graph = createUiParameterBinding(f.project, 'button', 'visible', 'show_button', 'page');
    if (marked) markUiParameterBindingGraph(graph);
    else delete graph.nodes.find(node => node.type === 'event')!.properties[uiParameterBindingMarker];
    const before = structuredClone(graph);
    assert.equal(listUiParameterBindings(f.project, 'button', 'page').find(binding => binding.graphId === graph.id)!.managed, true);
    synchronizeBlueprintSignatures(f.project);
    assert.deepEqual(graph, before);
    assert.equal(listUiParameterBindings(f.project, 'button', 'page').find(binding => binding.graphId === graph.id)!.managed, true);
  }
});

test('reorder, same-type property edit and delete preserve only the intended values and links', () => {
  const f = fixture();
  setBlueprintUiPropertyRows(f.node, [row('value', 'visible'), row('value_text', 'text'), row('value_opacity', 'opacity')]);
  Object.assign(f.node.properties, { value: false, value_text: '原文字', value_opacity: .4, unrelated: '保留' });
  synchronizeBlueprintSignatures(f.project);
  f.link(f.literal('bool', true), 'value', 'bool_link'); f.link(f.literal('text', '新文字'), 'value_text', 'text_link'); f.link(f.literal('opacity', .5), 'value_opacity', 'opacity_link');
  const links = f.graph.links;
  const reordered = mutateProject(f.project, draft => {
    const node = draft.blueprints[0].nodes.find(node => node.id === f.node.id)!;
    setBlueprintUiPropertyRows(node, [row('value_opacity', 'x'), row('value_text', 'text'), row('value', 'visible')]);
    synchronizeBlueprintSignatures(draft, f.project);
  });
  assert.equal(reordered.blueprints[0].links, links);
  assert.equal(reordered.blueprints[0].nodes.find(node => node.id === f.node.id)!.properties.value_opacity, .4);
  const deleted = mutateProject(reordered, draft => {
    const node = draft.blueprints[0].nodes.find(node => node.id === f.node.id)!;
    setBlueprintUiPropertyRows(node, blueprintUiPropertyRows(node).filter(row => row.id !== 'value_text'));
    synchronizeBlueprintSignatures(draft, reordered);
  });
  const node = deleted.blueprints[0].nodes.find(node => node.id === f.node.id)!;
  assert.deepEqual(deleted.blueprints[0].links.map(link => link.id), ['bool_link', 'opacity_link']);
  assert.equal(node.properties.value_text, undefined); assert.equal(node.properties.value, false); assert.equal(node.properties.unrelated, '保留');
});

test('type edits drop incompatible links on that changed input and preserve compatible any links', () => {
  const f = fixture(); setBlueprintUiPropertyRows(f.node, [row('value', 'visible'), row('value_second', 'enabled')]); synchronizeBlueprintSignatures(f.project);
  f.link(f.literal('bool', true), 'value', 'bool'); f.link(f.literal('dynamic', '文字', 'any'), 'value', 'dynamic');
  f.link(f.literal('old_bad', 99), 'value_second', 'retained_bad');
  const before = structuredClone(f.project);
  setBlueprintUiPropertyRows(f.node, [row('value', 'text'), row('value_second', 'enabled')]); synchronizeBlueprintSignatures(f.project, before);
  assert.deepEqual(f.graph.links.map(link => link.id), ['dynamic', 'retained_bad']);
  assert.equal(f.node.pins.find(pin => pin.id === 'value')!.dataType, 'string');
  assert.equal(f.node.properties.value, true, 'an incompatible authored value stays repairable');
  const links = f.graph.links;
  synchronizeBlueprintSignatures(f.project);
  assert.equal(f.graph.links, links);
});

test('imports and unrelated resource sync retain previously invalid links while refreshing property types', () => {
  for (const resourceEdit of [false, true]) {
    const f = fixture(); setBlueprintUiPropertyRows(f.node, [row('value', 'text')]);
    f.link(f.literal('old_bool', true), 'value', 'imported_bad_link');
    const before = structuredClone(f.project), links = f.graph.links;
    if (resourceEdit) f.project.name = '仅作品名称改变';
    synchronizeBlueprintSignatures(f.project, resourceEdit ? before : undefined);
    assert.equal(f.node.pins.find(pin => pin.id === 'value')!.dataType, 'string');
    assert.equal(f.graph.links, links); assert.equal(f.graph.links.length, 1);
  }
});

test('a joint source and property type edit checks final signatures independently of node order', () => {
  const f = fixture(); f.project.variables.push({ id: 'input_parameter', name: '属性来源', type: 'number', initial: .4, persistent: false });
  setBlueprintUiPropertyRows(f.node, [row('value', 'opacity')]);
  const source = blueprintNodeDefaults('getVariable'); source.properties.variableId = 'input_parameter'; f.graph.nodes.push(source);
  synchronizeBlueprintSignatures(f.project); f.link(source, 'value', 'joint_edit');
  const before = structuredClone(f.project);
  f.project.variables[0].type = 'string'; f.project.variables[0].initial = '新的文字';
  setBlueprintUiPropertyRows(f.node, [row('value', 'text')]); f.node.properties.value = '';
  synchronizeBlueprintSignatures(f.project, before);
  assert.equal(f.graph.links.find(link => link.id === 'joint_edit')?.toPinId, 'value');
  assert.equal(source.pins.find(pin => pin.id === 'value')!.dataType, 'string');
  assert.equal(f.node.pins.find(pin => pin.id === 'value')!.dataType, 'string');
});

test('unknown versions, unreadable JSON and malformed identity retain saved pins, values and links', () => {
  const rawDefinitions: unknown[] = [[], {}, [row('exec_in', 'visible')], [row('value_1bad', 'visible')], [row('value_bad-name', 'visible')], [row('value', 'visible'), row('value', 'text')], [row('value', '')], [{ id: 'value', property: 'visible' }], [row('value_' + 'a'.repeat(49), 'visible')], Array.from({ length: maxBlueprintUiPropertyRows + 1 }, (_, index) => row('value_r' + index, 'p' + index))];
  for (const properties of [{ propertyBatchVersion: 42, propertyWrites: '[]' }, { propertyBatchVersion: 1, propertyWrites: '{bad' }, { propertyWrites: '[]' }, ...rawDefinitions.map(raw => ({ propertyBatchVersion: 1, propertyWrites: JSON.stringify(raw) }))]) {
    const f = fixture(); f.link(f.literal('source', true), 'value'); Object.assign(f.node.properties, properties); const before = structuredClone(f.node), links = f.graph.links;
    assert.ok(blueprintUiPropertyDefinition(f.node).problems.length);
    assert.deepEqual(blueprintUiPropertyRows(f.node), []); assert.equal(blueprintUiPropertyPins(f.node), undefined);
    assert.throws(() => setBlueprintUiPropertyRows(f.node, [row('value', 'visible')]));
    synchronizeBlueprintSignatures(f.project); assert.deepEqual(f.node, before); assert.equal(f.graph.links, links);
  }
});

test('unknown properties, modes and duplicate properties expose complete rows for explicit repair', () => {
  const f = fixture();
  setBlueprintUiPropertyRows(f.node, [row('value', 'futureProperty'), row('value_other', 'anotherFuture', 'futureMode')]);
  const initialPin = f.node.pins.find(pin => pin.id === 'value')!;
  assert.equal(blueprintUiPropertyDefinition(f.node).rows!.length, 2);
  assert.deepEqual(blueprintUiPropertyRows(f.node), []); assert.equal(blueprintUiPropertyRowForPin(f.node, 'value')!.property, 'futureProperty');
  assert.equal(blueprintUiPropertyPins(f.node)!.find(pin => pin.id === 'value'), initialPin);
  setBlueprintUiPropertyRows(f.node, [row('value', 'visible'), row('value_other', 'anotherFuture', 'futureMode')]);
  assert.ok(blueprintUiPropertyDefinition(f.node).problems.length);
  setBlueprintUiPropertyRows(f.node, [row('value', 'visible'), row('value_other', 'text')]);
  assert.deepEqual(blueprintUiPropertyDefinition(f.node).problems, []);
  f.node.properties.propertyWrites = JSON.stringify([row('value', 'visible'), row('value_other', 'visible')]);
  assert.equal(blueprintUiPropertyDefinition(f.node).rows!.length, 2); assert.deepEqual(blueprintUiPropertyRows(f.node), []); assert.equal(blueprintUiPropertyPins(f.node), undefined);
  setBlueprintUiPropertyRows(f.node, [row('value', 'visible'), row('value_other', 'visible')]);
  assert.deepEqual(blueprintUiPropertyRows(f.node), []);
  setBlueprintUiPropertyRows(f.node, [row('value', 'visible'), row('value_other', 'text')]);
  assert.deepEqual(blueprintUiPropertyDefinition(f.node).problems, []);
});

test('three duplicate loaded properties can be removed one at a time with only removed row links deleted', () => {
  const f = fixture();
  setBlueprintUiPropertyRows(f.node, [row('value', 'visible'), row('value_two', 'enabled'), row('value_three', 'selected')]);
  synchronizeBlueprintSignatures(f.project);
  f.link(f.literal('source_one', true), 'value', 'link_one'); f.link(f.literal('source_two', false), 'value_two', 'link_two'); f.link(f.literal('source_three', false), 'value_three', 'link_three');
  f.node.properties.value_two = false; f.node.properties.value_three = false;
  f.node.properties.propertyWrites = JSON.stringify([row('value', 'visible'), row('value_two', 'visible'), row('value_three', 'visible')]);
  setBlueprintUiPropertyRows(f.node, blueprintUiPropertyDefinition(f.node).rows!.filter(row => row.id !== 'value_two'));
  synchronizeBlueprintSignatures(f.project);
  assert.equal(blueprintUiPropertyDefinition(f.node).rows!.length, 2); assert.ok(blueprintUiPropertyDefinition(f.node).problems.length);
  assert.deepEqual(f.graph.links.map(link => link.id), ['link_one', 'link_three']);
  assert.equal(f.node.properties.value_two, undefined); assert.equal(f.node.properties.value_three, false);
  assert.ok(!f.node.pins.some(pin => pin.id === 'value_two'));
  setBlueprintUiPropertyRows(f.node, blueprintUiPropertyDefinition(f.node).rows!.filter(row => row.id !== 'value_three'));
  synchronizeBlueprintSignatures(f.project);
  assert.deepEqual(blueprintUiPropertyDefinition(f.node).problems, []); assert.deepEqual(f.graph.links.map(link => link.id), ['link_one']);
});

test('the row limit accepts 64 complete unique rows and refuses an empty explicit edit atomically', () => {
  const f = fixture();
  const properties = Object.keys(uiProperties).slice(0, maxBlueprintUiPropertyRows);
  assert.equal(properties.length, maxBlueprintUiPropertyRows);
  setBlueprintUiPropertyRows(f.node, properties.map((property, index) => row('value_r' + index, property)));
  assert.equal(blueprintUiPropertyRows(f.node).length, maxBlueprintUiPropertyRows);
  assert.equal(blueprintUiPropertyPins(f.node)!.length, maxBlueprintUiPropertyRows + 3);
  const before = structuredClone(f.node);
  assert.throws(() => setBlueprintUiPropertyRows(f.node, []));
  assert.deepEqual(f.node, before);
});

test('all property rows supply asset, numeric, layout and independently linked summary metadata', () => {
  const f = fixture();
  setBlueprintUiPropertyRows(f.node, [row('value', 'visible'), row('value_opacity', 'opacity'), row('value_font', 'font'), row('value_video', 'video'), row('value_image', 'image'), row('value_text', 'text', 'source')]);
  f.node.properties.value_opacity = .5; f.node.properties.value_text = '新台词'; synchronizeBlueprintSignatures(f.project);
  assert.deepEqual(blueprintNodeAssetFilter(f.node, 'value_font'), { kind: 'font', category: 'all' });
  assert.deepEqual(blueprintNodeAssetFilter(f.node, 'value_video'), { kind: 'video', category: 'all' });
  assert.deepEqual(blueprintNodeAssetFilter(f.node, 'value_image'), { kind: 'image', category: 'all' });
  assert.equal(blueprintNodeAssetFilter(f.node, 'value_text'), undefined);
  assert.deepEqual(blueprintNumericPresentation(f.node, 'value_opacity'), { unit: uiProperties.opacity.unit, min: 0, max: 1, step: 'any' });
  assert.deepEqual(blueprintNumericPresentation(f.node, 'value'), {});
  assert.deepEqual(blueprintNodeLayout(f.node).dataRows.map(row => row.input!.id), ['componentId', 'value', 'value_opacity', 'value_font', 'value_video', 'value_image', 'value_text']);
  assert.equal(blueprintNodeLayout(f.node).estimatedSize.width, 320);
  const collapsed = blueprintNodeLayout(f.node, { parametersCollapsed: true });
  assert.deepEqual(collapsed.visiblePinIds, f.node.pins.map(pin => pin.id));
  assert.ok(blueprintNodeLayout(f.node).estimatedSize.height > collapsed.estimatedSize.height);
  assert.deepEqual(blueprintMeasuredNodeSize(f.node, {}, { width: 320, height: 100 }), { width: 320, height: 100 });
  f.link(f.literal('opacity_source', .25), 'value_opacity');
  for (const summary of [blueprintNodeSummary(f.project, f.graph, f.node), blueprintCardSummary(f.project, f.graph, f.node)!]) {
    assert.match(summary, /继续按钮/); assert.match(summary, /显示/); assert.match(summary, /不透明度/); assert.match(summary, /0\.25/); assert.match(summary, /新台词/); assert.match(summary, /修改绑定源/);
    assert.ok(!summary.includes('0.5'), 'inactive row value is replaced by its source description');
  }
});
