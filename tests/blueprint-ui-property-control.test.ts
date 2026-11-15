import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type BlueprintNode, type UiComponent, type UiPropertyControl, type VariableValue } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createBlueprintUiPropertyControlAnalysis, blueprintUiPropertyWriteWarning } from '../src/core/blueprint-ui-property-control';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { createUiEventGraph } from '../src/core/ui-logic';
import { setBlueprintUiPropertyRows } from '../src/core/blueprint-ui-property-batch';

const link = (parameterId: string, mode: UiPropertyControl['mode'] = 'follow'): UiPropertyControl => ({ mode, parameterId });
function fixture() {
  const project = createProject('蓝图属性控制');
  project.blueprints = []; project.timelinePresets = [];
  project.ui.components = []; project.ui.instances = []; delete project.ui.activeInstanceId;
  project.variables.push(
    { id: 'alpha', name: '透明度参数', type: 'number', initial: .35, persistent: false },
    { id: 'visible_source', name: '显示参数', type: 'boolean', initial: true, persistent: false },
    { id: 'choice_source', name: '选项参数', type: 'string', initial: '甲', persistent: false, setting: { options: ['甲', '乙'] } },
    { id: 'range_source', name: '原数值', type: 'number', initial: 30, persistent: false, setting: { min: 0, max: 100, step: 1 } },
  );
  const component: UiComponent = { id: 'controlled', kind: 'button', page: 'custom', text: '示例', name: '受控按钮', x: .1, y: .1, width: .2, height: .1 };
  const page = { id: 'property_page', name: '属性页面', modal: true, components: [component] };
  project.ui.customPages = [page];
  const graph = createBlueprintGraph('function', '属性操作'); project.blueprints.push(graph);
  const add = (type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => {
    const node = blueprintNodeDefaults(type); Object.assign(node.properties, { componentId: component.id }, properties); graph.nodes.push(node); synchronizeBlueprintSignatures(project); return node;
  };
  const warnings = () => validateBlueprints(project).filter(issue => issue.code === 'ui-property-follow-write');
  return { project, component, page, graph, add, warnings };
}

test('single-direction writes warn without removing the node or turning the retained graph into an error', () => {
  const f = fixture(); f.component.propertyControls = { opacity: link('alpha') };
  const node = f.add('setUiProperty', { property: 'opacity', value: .8 });
  const before = structuredClone(f.project), diagnostics = validateBlueprints(f.project), warning = diagnostics.find(issue => issue.nodeId === node.id && issue.code === 'ui-property-follow-write');
  assert.equal(warning?.severity, 'warning');
  assert.match(warning!.message, /透明度参数.*单向跟随参数/);
  assert.match(warning!.message, /其他属性和控件事件仍可运行/);
  assert.deepEqual(diagnostics.filter(issue => issue.nodeId === node.id && issue.severity === 'error'), []);
  assert.deepEqual(f.project, before);
});

test('a multi-property node reports every controlled row and explains whole-batch rejection', () => {
  const f = fixture();
  f.component.propertyControls = { visible: link('visible_source'), opacity: link('alpha', 'sync') };
  const node = f.add('setUiProperty', { property: 'x', value: .25 });
  setBlueprintUiPropertyRows(node, [
    { id: 'value', property: 'x', writeMode: 'override' },
    { id: 'value_visible', property: 'visible', writeMode: 'override' },
    { id: 'value_opacity', property: 'opacity', writeMode: 'source' },
  ]);
  node.properties.value_visible = false; node.properties.value_opacity = .8;
  synchronizeBlueprintSignatures(f.project);
  const before = structuredClone(f.project), analysis = createBlueprintUiPropertyControlAnalysis(f.project);
  assert.deepEqual(analysis.writes(f.graph, node).map(item => [item.property, item.control.mode]), [['visible', 'follow'], ['opacity', 'sync']]);
  assert.equal(analysis.mayUsePropertySource(f.graph, node, 'opacity'), true);
  assert.equal(analysis.mayUsePropertySource(f.graph, node, 'x'), false);
  assert.match(blueprintUiPropertyWriteWarning(analysis, f.graph, node)!, /显示参数.*整组属性都不会修改/);
  assert.deepEqual(f.project, before, '检查来源不能改写行、值或连线');
});

test('unrelated properties, reads and resets do not report single-direction assignment conflicts', () => {
  const f = fixture(); f.component.propertyControls = { opacity: link('alpha') };
  f.add('setUiProperty', { property: 'visible', value: false });
  for (const type of ['getUiProperty', 'getUiDefault', 'resetUiProperty', 'resetUiComponent', 'stopUiAnimation'] as const) f.add(type, { property: 'opacity' });
  assert.deepEqual(f.warnings(), []);
});

test('normalized values and option indexes obey the primary current-value policy', () => {
  for (const [kind, parameterId, property, canonical, value] of [
    ['preference', 'range_source', 'normalizedValue', 'numberValue', .8],
    ['preferenceChoice', 'choice_source', 'optionIndex', 'stringValue', 1],
  ] as const) {
    const f = fixture(); Object.assign(f.component, { kind, parameterId, propertyControls: { [canonical]: link(parameterId) } });
    const node = f.add('setUiProperty', { property, value });
    const target = createBlueprintUiPropertyControlAnalysis(f.project).property(f.graph, node);
    assert.equal(target?.property, canonical); assert.equal(target?.problem, undefined);
    assert.equal(f.warnings().length, 1);
    f.component.propertyControls = { [property]: link(parameterId) };
    assert.equal(createBlueprintUiPropertyControlAnalysis(f.project).property(f.graph, node)?.property, canonical, '旧别名关联仍服从同一策略');
  }
});

test('explicit double-direction sources accept ordinary property writes and preserve legacy mode validation', () => {
  const f = fixture(); f.component.propertyControls = { opacity: link('alpha', 'sync') };
  const node = f.add('setUiProperty', { property: 'opacity', value: .8, writeMode: 'source' });
  let diagnostics = validateBlueprints(f.project).filter(issue => issue.nodeId === node.id);
  assert.deepEqual(diagnostics, []);
  delete f.component.propertyControls;
  diagnostics = validateBlueprints(f.project).filter(issue => issue.nodeId === node.id);
  assert.ok(diagnostics.some(issue => issue.severity === 'error' && issue.message.includes('没有可写')));
  f.component.propertyControls = { opacity: link('alpha') };
  assert.deepEqual(validateBlueprints(f.project).filter(issue => issue.nodeId === node.id && issue.severity === 'error'), [], '旧source选项不能把单向冲突变为阻断错误');
});

test('dynamic component inputs never inherit the stored component ID policy', () => {
  const f = fixture(); f.component.propertyControls = { opacity: link('alpha') };
  const node = f.add('setUiProperty', { property: 'opacity', value: .8, writeMode: 'source' });
  const input = blueprintNodeDefaults('getInput'); input.properties.inputId = 'target';
  f.graph.exposedInputs.push(blueprintPin('target', '目标组件', 'input', 'component', f.component.id));
  f.graph.nodes.push(input); synchronizeBlueprintSignatures(f.project);
  assert.equal(connectBlueprintPins(f.graph, input.id, 'value', node.id, 'componentId'), undefined);
  const analysis = createBlueprintUiPropertyControlAnalysis(f.project);
  assert.equal(analysis.property(f.graph, node), undefined); assert.equal(analysis.component(f.graph, node), undefined);
  assert.equal(analysis.contextDependent(f.graph, node), true);
  assert.deepEqual(f.warnings(), []);
  assert.deepEqual(validateBlueprints(f.project).filter(issue => issue.nodeId === node.id && issue.severity === 'error'), []);
});

test('graph ownership chooses its scheme instead of the current editor scheme', () => {
  const f = fixture(); f.component.page = 'main'; f.page.components = []; f.project.ui.components = [f.component];
  const controlled = { ...f.component, propertyControls: { opacity: link('alpha') } };
  f.project.ui.instances = [{ id: 'owner', name: '所属方案', components: [controlled] }, { id: 'other', name: '正在编辑', components: [] }];
  f.project.ui.activeInstanceId = 'other'; f.graph.uiPageId = 'ui:main'; f.graph.uiInstanceId = 'owner';
  const node = f.add('setUiProperty', { property: 'opacity', value: .8 });
  assert.equal(createBlueprintUiPropertyControlAnalysis(f.project).property(f.graph, node)?.component, controlled);
  assert.equal(f.warnings().length, 1);
  f.graph.uiInstanceId = 'base';
  assert.deepEqual(f.warnings(), [], '基础方案不继承另一个方案的限制');
  assert.equal(f.project.ui.activeInstanceId, 'other');
});

test('shared graphs avoid definite policy claims when scheme overrides disagree', () => {
  const f = fixture(); f.component.page = 'main'; f.component.propertyControls = { opacity: link('alpha') };
  f.page.components = []; f.project.ui.components = [f.component];
  f.project.ui.instances = [{ id: 'free', name: '自由方案', components: [{ ...f.component, propertyControls: {} }] }];
  const node = f.add('setUiProperty', { property: 'opacity', value: .8 });
  const analysis = createBlueprintUiPropertyControlAnalysis(f.project);
  assert.equal(analysis.contextDependent(f.graph, node), true); assert.equal(analysis.property(f.graph, node), undefined); assert.deepEqual(f.warnings(), []);
  f.project.ui.instances[0].components = [];
  assert.equal(f.warnings().length, 1, '所有可用方案共享同一关联时可明确提示');
});

test('shared graphs with multiple default definitions still reject source writes without a source', () => {
  const f = fixture(); f.component.page = 'main'; f.page.components = []; f.project.ui.components = [f.component];
  f.project.ui.instances = [{ id: 'variant', name: '变体', components: [{ ...f.component, text: '另一外观' }] }];
  const node = f.add('setUiProperty', { property: 'opacity', value: .8, writeMode: 'source' });
  assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === node.id && issue.severity === 'error' && issue.message.includes('没有可写')));
});

test('missing sources keep their repair problem instead of pretending to be a working follow link', () => {
  const f = fixture(); f.component.propertyControls = { opacity: link('deleted') };
  const node = f.add('setUiProperty', { property: 'opacity', value: .8 });
  const target = createBlueprintUiPropertyControlAnalysis(f.project).property(f.graph, node);
  assert.match(target!.problem!, /来源参数已删除/); assert.equal(target?.parameterName, 'deleted');
  assert.deepEqual(f.warnings(), [], '损坏来源交由控件关联诊断，不重复报告正常follow限制');
});

test('property animation conflicts and whole-range rejection describe the actual affected scope', () => {
  const f = fixture(); f.component.propertyControls = { opacity: link('alpha') };
  const animation = f.add('animateUiProperty', { property: 'opacity', value: .8 });
  assert.match(blueprintUiPropertyWriteWarning(createBlueprintUiPropertyControlAnalysis(f.project), f.graph, animation)!, /这项属性动画不会启动/);
  Object.assign(f.component, { kind: 'preference', parameterId: 'range_source', propertyControls: { minimum: link('alpha') } });
  const range = f.add('setUiControlRange', { minimum: 0, maximum: 100, step: 1 });
  assert.match(blueprintUiPropertyWriteWarning(createBlueprintUiPropertyControlAnalysis(f.project), f.graph, range)!, /范围设置不会写入任何一项/);
  f.component.propertyControls = { minimum: link('alpha', 'sync') };
  assert.equal(blueprintUiPropertyWriteWarning(createBlueprintUiPropertyControlAnalysis(f.project), f.graph, range), undefined);
});

test('named clips inspect all tracks in the clip own scheme before reporting whole-clip rejection', () => {
  const f = fixture(); f.component.page = 'main'; f.component.propertyControls = { opacity: link('alpha') };
  f.page.components = []; f.project.ui.components = [f.component];
  f.project.ui.instances = [{ id: 'free', name: '自由方案', components: [{ ...f.component, propertyControls: { opacity: link('alpha', 'sync') } }] }];
  f.project.ui.activeInstanceId = 'free';
  f.project.ui.animations = [{ id: 'fade', name: '淡出', pageId: 'ui:main', uiInstanceId: 'base', duration: 1, tracks: [
    { id: 'alpha_track', componentId: f.component.id, property: 'opacity', keys: [{ id: 'alpha_end', time: 1, value: 0, easing: 'linear' }] },
    { id: 'x_track', componentId: f.component.id, property: 'x', keys: [{ id: 'x_end', time: 1, value: .5, easing: 'linear' }] },
  ] }];
  const node = f.add('playUiAnimation', { animationId: 'fade' }); delete node.properties.componentId;
  assert.match(blueprintUiPropertyWriteWarning(createBlueprintUiPropertyControlAnalysis(f.project), f.graph, node)!, /这段动画不会启动/);
  f.project.ui.animations[0].uiInstanceId = 'free';
  assert.deepEqual(f.warnings(), []);
  assert.equal(createBlueprintUiPropertyControlAnalysis(f.project).writes(f.graph, node)[0].control.mode, 'sync');
});

test('Spine loop follow preserves the playback action while dedicated speed assignment is constrained', () => {
  const f = fixture(); Object.assign(f.component, { kind: 'spine', propertyControls: { spineLoop: link('visible_source'), spineSpeed: link('alpha') } });
  const play = f.add('playSpine', { animation: 'idle', loop: false }), speed = f.add('setSpineSpeed', { speed: 2 });
  const analysis = createBlueprintUiPropertyControlAnalysis(f.project);
  assert.match(blueprintUiPropertyWriteWarning(analysis, f.graph, play)!, /播放仍会执行，循环输入会被忽略/);
  assert.match(blueprintUiPropertyWriteWarning(analysis, f.graph, speed)!, /这次赋值不会改写这一项/);
});

test('property links cannot prune reachable capability paths using a rejected or stale assignment', () => {
  for (const mode of ['follow', 'sync'] as const) {
    const f = fixture(), owner = createUiEventGraph(f.project, f.page.id, '来源分支');
    f.component.propertyControls = { visible: link('visible_source', mode) };
    const write = blueprintNodeDefaults('setUiProperty'), read = blueprintNodeDefaults('getUiProperty'), branch = blueprintNodeDefaults('branch'), invalidAction = blueprintNodeDefaults('startDialogue');
    Object.assign(write.properties, { componentId: f.component.id, property: 'visible', value: false });
    Object.assign(read.properties, { componentId: f.component.id, property: 'visible' });
    owner.nodes.push(write, read, branch, invalidAction); synchronizeBlueprintSignatures(f.project);
    for (const [from, output, to, input] of [
      [owner.nodes[0], 'exec', write, 'exec_in'], [write, 'exec_out', branch, 'exec_in'],
      [read, 'value', branch, 'condition'], [branch, 'true', invalidAction, 'exec_in'],
    ] as const) assert.equal(connectBlueprintPins(owner, from.id, output, to.id, input), undefined);
    const hasCapabilityProblem = () => validateBlueprints(f.project).some(issue => issue.nodeId === invalidAction.id && issue.code === 'blueprint.path.capability');
    assert.equal(hasCapabilityProblem(), true, mode + '关联值不能当成稳定的false覆盖');
    delete f.component.propertyControls;
    assert.equal(hasCapabilityProblem(), false, '默认设置的同步false覆盖仍可精确裁剪');
  }
});

test('following visibility and synced enabled state do not hide real button event paths from analysis', () => {
  for (const [property, mode] of [['visible', 'follow'], ['enabled', 'sync']] as const) {
    const f = fixture(), owner = createUiEventGraph(f.project, f.page.id, '来源交互');
    f.component.propertyControls = { [property]: link('visible_source', mode) };
    if (property === 'enabled') f.component.disabled = true;
    const write = blueprintNodeDefaults('setUiProperty'), click = blueprintNodeDefaults('eventClick'), invalidAction = blueprintNodeDefaults('startDialogue');
    Object.assign(write.properties, { componentId: f.component.id, property, value: false }); click.properties.componentId = f.component.id;
    owner.nodes.push(write, click, invalidAction); synchronizeBlueprintSignatures(f.project);
    assert.equal(connectBlueprintPins(owner, owner.nodes[0].id, 'exec', write.id, 'exec_in'), undefined);
    assert.equal(connectBlueprintPins(owner, click.id, 'exec', invalidAction.id, 'exec_in'), undefined);
    assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === invalidAction.id && issue.code === 'blueprint.path.capability'), property);
    delete f.component.propertyControls;
    assert.equal(validateBlueprints(f.project).some(issue => issue.nodeId === invalidAction.id && issue.code === 'blueprint.path.capability'), false, '默认隐藏/禁用仍正确排除点击');
  }
});
