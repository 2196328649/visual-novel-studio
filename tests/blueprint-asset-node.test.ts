import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintAssetKindNames, blueprintAssetNodeKind, blueprintAssetNodePresentation, createBlueprintAssetNode, type BlueprintAssetNodeKind } from '../src/core/blueprint-asset-node';
import { blueprintNodeAssetFilter } from '../src/core/blueprint-assets';
import { blueprintNodeDefaults, blueprintNodeSummary, blueprintOutputLabel, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { prepareBlueprintInsertion } from '../src/core/blueprint-insertion';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { blueprintCardSummary } from '../src/core/blueprint-card-summary';
import { blueprintMeasuredNodeSize, blueprintNodeLayout } from '../src/core/blueprint-node-layout';
import { blueprintNodePresentation } from '../src/core/blueprint-presentation';
import { blueprintStaticOutput, unknownBlueprintValue } from '../src/core/blueprint-static-values';
import { setBlueprintUiPropertyRows } from '../src/core/blueprint-ui-property-batch';
import { projectForExport } from '../src/core/export-assets';
import { createProject, projectSchema, type Asset, type BlueprintNode } from '../src/core/model';

const asset = (kind: BlueprintAssetNodeKind): Asset => ({ id: 'resource_' + kind, kind, name: '真实素材名称_' + kind, path: 'assets/' + kind });

test('all supported media drops create one typed data reference with no execution ports or action', () => {
  for (const kind of Object.keys(blueprintAssetKindNames) as BlueprintAssetNodeKind[]) {
    const resource = asset(kind), before = structuredClone(resource), node = createBlueprintAssetNode(resource, { x: -100, y: 203.5 })!;
    assert.equal(node.type, 'literal'); assert.equal(node.x, -100); assert.equal(node.y, 203.5);
    assert.deepEqual(node.properties, { value: resource.id, assetKind: kind });
    assert.deepEqual(node.pins, [{ id: 'value', name: blueprintAssetKindNames[kind], direction: 'output', dataType: 'asset', required: false }]);
    assert.equal(blueprintAssetNodeKind(node), kind); assert.equal(blueprintNodePresentation(node).family, 'value');
    assert.match(node.name, new RegExp(blueprintAssetKindNames[kind])); assert.ok(node.name.includes(resource.name)); assert.ok(!node.name.includes(resource.id));
    assert.deepEqual(blueprintNodeAssetFilter(node, 'value'), { kind, category: 'all' }); assert.equal(blueprintNodeAssetFilter(node, 'other'), undefined);
    assert.deepEqual(blueprintNodeLayout(node).estimatedSize, { width: 232, height: 72 });
    assert.deepEqual(blueprintMeasuredNodeSize(node, {}, { width: 232, height: 68 }), { width: 232, height: 68 });
    assert.deepEqual(resource, before);
  }
  assert.equal(createBlueprintAssetNode({ id: 'script_resource', kind: 'script', name: '脚本', path: 'assets/script.rpy' }), undefined);
});

test('media literal values synchronize and serialize without creating execution routes or changing identities', () => {
  const project = createProject(), graph = createBlueprintGraph('function', '素材引用');
  project.assets = (Object.keys(blueprintAssetKindNames) as BlueprintAssetNodeKind[]).map(asset);
  graph.nodes.push(...project.assets.map(resource => createBlueprintAssetNode(resource)!)); project.blueprints = [graph];
  const before = structuredClone(graph);
  synchronizeBlueprintSignatures(project); assert.deepEqual(graph, before); assert.deepEqual(graph.links, []);
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.blueprints[0], graph);
  for (const node of graph.nodes.filter(node => node.type === 'literal')) {
    assert.equal(blueprintStaticOutput({ project, graph, inputs: new Map(), results: new Map(), onRead: () => undefined, uiValue: () => unknownBlueprintValue }, node, 'value'), node.properties.value);
  }
  assert.deepEqual(projectForExport(project).assets.map(resource => resource.id), project.assets.map(resource => resource.id));
});

test('real asset renames and deletions update display while preserving an authored node title', () => {
  const project = createProject(), resource = asset('image'), graph = createBlueprintGraph('function', '图片数据'); project.assets = [resource];
  const node = createBlueprintAssetNode(resource)!; node.name = '作者自定义标题'; graph.nodes.push(node); project.blueprints = [graph];
  resource.name = '重命名后的画面';
  assert.deepEqual(blueprintAssetNodePresentation(project, node), { kind: 'image', kindName: '图片素材', name: resource.name, title: '图片素材 · 重命名后的画面', missing: false });
  for (const text of [blueprintNodeSummary(project, graph, node), blueprintOutputLabel(project, graph, node, 'value'), blueprintCardSummary(project, graph, node)!]) {
    assert.equal(text, '图片素材 · 重命名后的画面'); assert.ok(!text.includes(resource.id));
  }
  project.assets = [];
  assert.equal(blueprintAssetNodePresentation(project, node)!.missing, true);
  assert.equal(blueprintNodeSummary(project, graph, node), '图片素材 · 素材引用已失效'); assert.equal(node.name, '作者自定义标题');
});

test('typed media literals connect as asset data to separately executed consumers', () => {
  const project = createProject(), graph = createBlueprintGraph('function', '素材数据连接'), resource = asset('image'), source = createBlueprintAssetNode(resource)!;
  project.assets = [resource]; project.blueprints = [graph]; graph.nodes.push(source);
  const target = blueprintNodeDefaults('setUiProperty');
  setBlueprintUiPropertyRows(target, [{ id: 'value', property: 'image', writeMode: 'override' }]); target.properties.value = resource.id; graph.nodes.push(target); synchronizeBlueprintSignatures(project);
  assert.equal(connectBlueprintPins(graph, source.id, 'value', target.id, 'value'), undefined);
  assert.deepEqual(graph.links.map(link => [link.fromPinId, link.toPinId]), [['value', 'value']]);
  assert.equal(graph.links.some(link => link.fromNodeId === graph.nodes[0].id), false, 'a media drop does not start an execution route');
  const math = blueprintNodeDefaults('math'); graph.nodes.push(math);
  assert.match(connectBlueprintPins(graph, source.id, 'value', math.id, 'a')!, /素材不能传给数值/);
  assert.match(blueprintCardSummary(project, graph, target)!, /图片素材.*真实素材名称_image/);
});

test('existing literals remain generic and marker/type mismatches are never treated as media nodes', () => {
  const generic = blueprintNodeDefaults('literal'); generic.pins[0].dataType = 'asset'; generic.properties.value = 'resource_image';
  assert.equal(blueprintAssetNodeKind(generic), undefined); assert.equal(blueprintNodeAssetFilter(generic, 'value'), undefined);
  generic.properties.assetKind = 'image'; generic.pins[0].dataType = 'string'; assert.equal(blueprintAssetNodeKind(generic), undefined);
  const marked = createBlueprintAssetNode(asset('image'))!, project = createProject(); project.assets = [{ ...asset('image'), kind: 'audio' }];
  assert.equal(blueprintAssetNodePresentation(project, marked)!.title, '图片素材 · 素材类型不匹配');
  project.assets = [{ ...asset('image'), name: ' ' }]; assert.equal(blueprintAssetNodePresentation(project, marked)!.name, '未命名素材');
  const long = createBlueprintAssetNode({ ...asset('font'), name: '长名称'.repeat(100) })!; assert.equal(long.name.length, 120);
});

function mediaConsumerFixture(type: 'playMusic' | 'showBackground') {
  const project = createProject(), graph = createBlueprintGraph('function', '素材消费者检查'), target = blueprintNodeDefaults(type);
  project.assets = [asset('image'), asset('audio')]; project.blueprints = [graph]; graph.nodes.push(target);
  assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', target.id, 'exec_in'), undefined);
  const connect = (source: BlueprintNode) => {
    graph.nodes.push(source); synchronizeBlueprintSignatures(project);
    const output = source.pins.find(pin => pin.direction === 'output' && pin.dataType === 'asset');
    assert.ok(output); assert.equal(connectBlueprintPins(graph, source.id, output.id, target.id, 'assetId'), undefined);
  };
  const errors = () => validateBlueprints(project).filter(issue => issue.severity === 'error' && issue.nodeId === target.id);
  return { project, graph, target, connect, errors };
}

test('marked and generic asset literals diagnose wrong media kinds at connected consumers', () => {
  for (const marked of [true, false]) for (const [type, wrongKind, expectedName] of [
    ['playMusic', 'image', '音频'], ['showBackground', 'audio', '图片'],
  ] as const) {
    const f = mediaConsumerFixture(type), resource = asset(wrongKind);
    const source = marked ? createBlueprintAssetNode(resource)! : blueprintNodeDefaults('literal');
    if (!marked) { source.pins[0].dataType = 'asset'; source.properties.value = resource.id; }
    f.connect(source);
    const errors = f.errors(); assert.equal(errors.length, 1);
    assert.match(errors[0].message, /素材类型不匹配/); assert.ok(errors[0].message.includes(resource.name));
    assert.ok(errors[0].message.includes('需要' + expectedName));
  }
});

test('connected consumers accept same-kind literals and use the actual resource rather than its marker', () => {
  for (const marked of [true, false]) for (const [type, kind] of [
    ['playMusic', 'audio'], ['showBackground', 'image'],
  ] as const) {
    const f = mediaConsumerFixture(type), resource = asset(kind);
    const source = marked ? createBlueprintAssetNode(resource)! : blueprintNodeDefaults('literal');
    if (!marked) { source.pins[0].dataType = 'asset'; source.properties.value = resource.id; }
    f.connect(source); assert.deepEqual(f.errors(), []);
  }
  const f = mediaConsumerFixture('playMusic'), source = createBlueprintAssetNode(asset('image'))!;
  source.properties.value = asset('audio').id;
  f.connect(source); assert.deepEqual(f.errors(), [], '消费者按真实音频素材检查，图片marker不会制造误报');
  source.properties.value = asset('image').id;
  assert.ok(f.errors().some(issue => /素材类型不匹配/.test(issue.message)));
});

test('unknown runtime asset inputs do not borrow a wrong-kind default for static diagnosis', () => {
  const f = mediaConsumerFixture('playMusic');
  f.graph.exposedInputs.push(blueprintPin('media', '运行时素材', 'input', 'asset', asset('image').id));
  const source = blueprintNodeDefaults('getInput'); source.properties.inputId = 'media'; f.connect(source);
  assert.deepEqual(f.errors(), [], '接口默认图片不能当作调用时一定传入的音乐值');
});

test('declared variable asset kinds still diagnose incompatibility when the runtime value is unknown', () => {
  const f = mediaConsumerFixture('playMusic');
  f.project.variables.push({ id: 'media_variable', name: '运行时素材参数', type: 'asset', assetKind: 'image', initial: asset('image').id, persistent: false });
  const source = blueprintNodeDefaults('getVariable'); source.properties.variableId = 'media_variable'; f.connect(source);
  assert.ok(f.errors().some(issue => /素材类型不匹配.*运行时素材参数/.test(issue.message)));
  f.project.variables.find(variable => variable.id === 'media_variable')!.assetKind = 'audio';
  assert.deepEqual(f.errors(), [], '相同种类的动态参数继续允许接线，不使用初始图片推断当前值');
});

test('consumer media diagnostics evaluate constant selected asset expressions', () => {
  const f = mediaConsumerFixture('playMusic'), source = blueprintNodeDefaults('select'), condition = blueprintNodeDefaults('literal'), picture = createBlueprintAssetNode(asset('image'))!;
  condition.pins[0].dataType = 'boolean'; condition.properties.value = true;
  source.pins.find(pin => pin.id === 'result')!.dataType = 'asset';
  source.properties.false_value = asset('audio').id;
  f.graph.nodes.push(condition, picture); f.connect(source);
  assert.equal(connectBlueprintPins(f.graph, condition.id, 'value', source.id, 'condition'), undefined);
  assert.equal(connectBlueprintPins(f.graph, picture.id, 'value', source.id, 'true_value'), undefined);
  assert.ok(f.errors().some(issue => /素材类型不匹配/.test(issue.message)));
  condition.properties.value = false;
  assert.deepEqual(f.errors(), [], '静态分支切换到合法音频后不再报图片类型错误');
});

test('media insertion preserves its reference and refuses incompatible data pins', () => {
  const f = mediaConsumerFixture('showBackground'), source = createBlueprintAssetNode(asset('image'))!, before = structuredClone(source);
  const plain = prepareBlueprintInsertion(f.project, f.graph, source);
  assert.equal(plain.node.properties.value, asset('image').id); assert.equal(blueprintAssetNodeKind(plain.node), 'image');
  const pending = prepareBlueprintInsertion(f.project, f.graph, source, { nodeId: f.target.id, pinId: 'assetId', direction: 'input' });
  assert.equal(pending.problem, undefined); assert.equal(pending.node.properties.value, asset('image').id);
  assert.equal(blueprintAssetNodeKind(pending.node), 'image'); assert.deepEqual(source, before);
  const wrong = prepareBlueprintInsertion(f.project, f.graph, source, { nodeId: f.target.id, pinId: 'duration', direction: 'input' });
  assert.match(wrong.problem!, /没有兼容的连接点/); assert.deepEqual(wrong.node, source); assert.deepEqual(source, before);
});
