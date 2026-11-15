import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { createProject, type Condition, type UiComponent } from '../src/core/model';
import { createUiEventGraph, ensureUiClickEvent, uiClickHandlers } from '../src/core/ui-logic';
import { uiConditionDescription, uiInspectorControlEvents, uiInspectorInteractionSummary, ensureUiInspectorEvent } from '../src/core/ui-inspector-interaction';
import { uiShortcutKey, uiShortcutKeys } from '../src/core/ui-shortcuts';
import { previewUiLogic, uiPreviewKeyboardKey, uiPreviewKeys, uiPreviewShortcutKey } from '../src/core/ui-logic-preview';

function buttonFixture() {
  const project = createProject('交互检查');
  const component: UiComponent = { id: 'test_button', kind: 'button', page: 'main', text: '按钮', x: .1, y: .1, width: .3, height: .1 };
  project.ui.components.push(component);
  return { project, component };
}

test('click summaries reflect active roots, callbacks, and replacement in actual order', () => {
  const { project, component } = buttonFixture();
  assert.equal(uiInspectorInteractionSummary(project, component), '尚未设置点击行为');
  const graph = createUiEventGraph(project, 'ui:main', '主菜单');
  ensureUiClickEvent(project, graph, component.id, 'ui:main');
  assert.equal(uiInspectorInteractionSummary(project, component), '点击 → 执行事件');
  const first = createBlueprintGraph('ui', '页面接入'), callback = createBlueprintGraph('ui', '绑定'), action = createBlueprintGraph('ui', '主操作');
  project.blueprints.push(first, callback, action);
  component.events = { beforeClick: first.id, onClick: callback.id };
  component.action = 'blueprint'; component.blueprintId = action.id;
  assert.deepEqual(uiClickHandlers(project, 'ui:main', component.id).map(item => item.source), ['beforeClick', 'event', 'callback', 'action']);
  assert.equal(uiInspectorInteractionSummary(project, component), '点击 → 3 项事件 → 执行蓝图');
  component.clickMode = 'replace';
  assert.deepEqual(uiClickHandlers(project, 'ui:main', component.id).map(item => item.source), ['beforeClick', 'action']);
  assert.equal(uiInspectorInteractionSummary(project, component), '点击 → 执行事件 → 执行蓝图');
  component.blueprintId = 'deleted';
  assert.match(uiInspectorInteractionSummary(project, component), /含失效引用/);
});

test('another page or scheme does not make a button appear to have click behavior', () => {
  const { project, component } = buttonFixture();
  const graph = createUiEventGraph(project, 'ui:main', '主菜单');
  ensureUiClickEvent(project, graph, component.id, 'ui:main');
  graph.uiPageId = 'ui:preferences';
  assert.equal(uiInspectorInteractionSummary(project, component), '尚未设置点击行为');
  graph.uiPageId = 'ui:main'; graph.uiInstanceId = 'other';
  assert.equal(uiInspectorInteractionSummary(project, component), '尚未设置点击行为');
});

test('interaction summaries omit common visibility from the separated functional group', () => {
  const project = createProject('分组摘要');
  project.variables.push({ id: 'toggle_source', name: '允许操作', type: 'boolean', initial: true, persistent: false });
  const component: UiComponent = { id: 'summary_control', kind: 'panel', page: 'main', text: '', x: 0, y: 0, width: .5, height: .1 };
  project.ui.components.push(component);
  assert.equal(uiInspectorInteractionSummary(project, component), '始终显示');
  assert.equal(uiInspectorInteractionSummary(project, component, 'ui:main', false), '事件与反馈');
  component.visibleWhen = { kind: 'compare', variableId: 'toggle_source', operator: 'eq', value: true };
  assert.equal(uiInspectorInteractionSummary(project, component), '按条件显示', '默认调用保留旧摘要');
  assert.equal(uiInspectorInteractionSummary(project, component, 'ui:main', false), '事件与反馈');
  component.kind = 'preferenceChoice'; component.parameterId = 'toggle_source'; component.readOnly = true;
  ensureUiInspectorEvent(project, component, 'value', 'ui:main');
  assert.equal(uiInspectorInteractionSummary(project, component, 'ui:main', false), '只读 · 1 项事件');
  assert.equal(uiInspectorInteractionSummary(project, component, 'ui:save', false), '只读', '事件数量仍遵守页面作用域');
  const bound = createBlueprintGraph('ui', '已绑定入口'); project.blueprints.push(bound); component.events = { onShow: bound.id };
  assert.equal(uiInspectorInteractionSummary(project, component, 'ui:main', false), '只读 · 1 项事件 · 已绑定事件蓝图');
  assert.doesNotMatch(uiInspectorInteractionSummary(project, component, 'ui:main', false), /显示/);
  const { project: buttonProject, component: button } = buttonFixture();
  assert.equal(uiInspectorInteractionSummary(buttonProject, button, 'ui:main', false), uiInspectorInteractionSummary(buttonProject, button), '按钮点击执行摘要不受分组开关影响');
});

test('inspector event creation reuses entries and adds local events beside inherited logic', () => {
  const { project, component } = buttonFixture();
  project.ui.instances = [{ id: 'parent_scheme', name: '父方案', components: [component] }, { id: 'child_scheme', name: '子方案', baseUiId: 'parent_scheme', components: [] }];
  project.ui.components = [];
  project.ui.activeInstanceId = 'parent_scheme';
  const parent = ensureUiInspectorEvent(project, component, 'click');
  const before = JSON.stringify(project);
  assert.deepEqual(ensureUiInspectorEvent(project, component, 'click'), parent);
  assert.equal(JSON.stringify(project), before);
  project.ui.activeInstanceId = 'child_scheme';
  const inherited = ensureUiInspectorEvent(project, component, 'click');
  assert.equal(inherited.graphId, parent.graphId); assert.equal(inherited.inherited, true);
  const local = ensureUiInspectorEvent(project, component, 'click', 'ui:main', true);
  assert.notEqual(local.graphId, parent.graphId);
  assert.equal(project.blueprints.find(graph => graph.id === local.graphId)?.uiInstanceId, 'child_scheme');
  assert.equal(uiClickHandlers(project, 'ui:main', component.id).length, 2);
});

test('available inspector events change with a source type and never advertise input for invalid bindings', () => {
  const project = createProject();
  project.variables.push({ id: 'name', name: '名字', type: 'string', initial: '', persistent: false }, { id: 'toggle', name: '开关', type: 'boolean', initial: true, persistent: false });
  const component: UiComponent = { id: 'input', page: 'preferences', kind: 'preferenceChoice', text: '', parameterId: 'name', x: 0, y: 0, width: .3, height: .1 };
  assert.deepEqual(uiInspectorControlEvents(project, component).map(event => event.id), ['value', 'commit']);
  component.parameterId = 'toggle';
  assert.deepEqual(uiInspectorControlEvents(project, component).map(event => event.id), ['value']);
  component.parameterId = 'deleted';
  assert.deepEqual(uiInspectorControlEvents(project, component), []);
  component.kind = 'video';
  assert.deepEqual(uiInspectorControlEvents(project, component).map(event => event.id), ['video:ended', 'video:failed']);
});

test('condition summaries preserve groups, missing references, and empty group meanings', () => {
  const project = createProject();
  project.variables.push({ id: 'seen', name: '看过结局', type: 'boolean', initial: false, persistent: false });
  const condition: Condition = { kind: 'all', conditions: [{ kind: 'compare', variableId: 'seen', operator: 'eq', value: true }, { kind: 'not', condition: { kind: 'any', conditions: [] } }] };
  const before = structuredClone(condition);
  assert.equal(uiConditionDescription(project, { kind: 'all', conditions: [] }), '始终满足（没有限制）');
  assert.equal(uiConditionDescription(project, { kind: 'any', conditions: [] }), '始终不满足（没有候选条件）');
  assert.match(uiConditionDescription(project, condition), /看过结局等于开启.*并且.*不满足.*始终不满足/);
  assert.match(uiConditionDescription(project, { kind: 'compare', variableId: 'missing', operator: 'gt', value: 3 }), /已删除参数大于3/);
  assert.deepEqual(condition, before);
});

test('one shortcut catalogue normalizes every authored key and dispatches new keys in preview', () => {
  for (const key of Object.keys(uiShortcutKeys)) {
    assert.equal(uiShortcutKey(key), key);
    assert.equal(uiPreviewShortcutKey(key), key);
  }
  for (const [dom, normalized] of [['F5', 'K_F5'], ['F12', 'K_F12'], ['Z', 'K_z'], ['8', 'K_8'], [' ', 'K_SPACE'], ['Enter', 'K_RETURN'], ['Escape', 'K_ESCAPE'], ['ArrowDown', 'K_DOWN']]) assert.equal(uiPreviewKeyboardKey(dom), normalized);
  for (const unsupported of ['Control', 'F13', 'K_unknown', 'meta+a']) assert.equal(uiShortcutKey(unsupported), undefined);
  for (const key of ['K_z', 'K_8', 'K_F5', 'K_F12']) {
    const { project, component } = buttonFixture();
    component.shortcut = key;
    project.variables.push({ id: 'count', name: '点击次数', type: 'number', initial: 0, persistent: false });
    const graph = createUiEventGraph(project, 'ui:main', '键盘');
    const event = ensureUiClickEvent(project, graph, component.id, 'ui:main');
    const setter = blueprintNodeDefaults('setVariable'); setter.properties = { variableId: 'count', value: 1 }; graph.nodes.push(setter);
    assert.equal(connectBlueprintPins(graph, event.id, 'exec', setter.id, 'exec_in'), undefined);
    assert.deepEqual(uiPreviewKeys(project, 'ui:main'), [key]);
    const before = structuredClone(project), result = previewUiLogic(project, [component], 'ui:main', {}, [{ kind: 'key', key }]);
    assert.equal(result.variables.count, 1, key);
    assert.equal(result.incomplete, false, key);
    assert.deepEqual(project, before);
  }
});
