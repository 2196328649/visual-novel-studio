import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { blueprintContext } from '../src/core/blueprint-context';
import { createUiEventGraph, standardUiEventPages, uiPageGraphs } from '../src/core/ui-logic';
import { diagnosticLocation } from '../src/core/diagnostic-location';
import { applyUiDraft } from '../src/core/ui-draft';
import { mutateProject } from '../src/core/project-mutation';
import { resolveUiPreviewAction } from '../src/core/ui-preview-actions';
import { resolveAiEditorTarget } from '../src/core/ai-editor-targets';
import { blueprintCapabilityProblem } from '../src/core/blueprint-capabilities';

test('graph, node and selection navigation agree on the owning scheme without changing its active setting', () => {
  const p = createProject();
  p.ui.instances = [{ id: 'other', name: '其他', components: [] }, { id: 'owner', name: '所属', components: [] }];
  p.ui.activeInstanceId = 'owner'; const graph = createUiEventGraph(p, 'ui:main', '标题');
  p.ui.activeInstanceId = 'other';
  const direct = blueprintContext(p, graph.id).ui;
  assert.deepEqual(direct, { page: 'main', instanceId: 'owner' });
  assert.deepEqual(resolveAiEditorTarget(p, { kind: 'blueprint', graphId: graph.id }).ui, direct);
  assert.deepEqual(resolveAiEditorTarget(p, { kind: 'blueprintSelection', graphId: graph.id, nodeIds: [graph.nodes[0].id], linkIds: [] }).ui, direct);
  assert.equal(p.ui.activeInstanceId, 'other');
});

test('legacy mixed page graphs retain their call entry and only infer navigation from unique bindings', () => {
  const p = createProject(), graph = createBlueprintGraph('ui', '旧页面');
  p.ui.customPages.push({ id: 'legacy', name: '旧页面', modal: true, components: [{ id: 'close', kind: 'button', page: 'custom', text: '关闭', x: 0, y: 0, width: 1, height: 1 }] });
  const open = blueprintNodeDefaults('showUiPage'), click = blueprintNodeDefaults('eventClick');
  open.properties.pageId = 'legacy'; click.properties.componentId = 'close';
  graph.nodes.push(open, click); p.blueprints.push(graph);
  const before = structuredClone(p);
  assert.deepEqual(blueprintContext(p, graph.id, click.id).ui, { page: 'custom', customPageId: 'legacy', componentId: 'close' });
  assert.deepEqual(p, before); assert.equal(graph.uiPageId, undefined);
  p.ui.customPages.push({ id: 'another', name: '另一页', modal: true, components: [], onShowBlueprintId: graph.id });
  assert.equal(blueprintContext(p, graph.id).ui, undefined);
  assert.match(blueprintContext(p, graph.id).problem!, /多个页面/);
});

test('capabilities follow module calls and distinguish music from minigame state', () => {
  const p = createProject(), graph = createBlueprintGraph('function', '小游戏工具'); p.blueprints.push(graph);
  const finish = blueprintNodeDefaults('finishMinigame'); graph.nodes.push(finish);
  assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', finish.id, 'exec_in'), undefined);
  assert.equal(blueprintCapabilityProblem(p, { type: 'playMusic' }, 'ui'), undefined);
  assert.match(blueprintCapabilityProblem(p, { type: 'callFunction', properties: { graphId: graph.id } }, 'ui')!, /小游戏会话/);
  assert.equal(blueprintCapabilityProblem(p, { type: 'callFunction', properties: { graphId: graph.id } }, 'minigame'), undefined);
  assert.match(blueprintCapabilityProblem(p, { type: 'startDialogue' }, 'startup')!, /当前台词/);
});

test('every built-in page resolves graph, selection, diagnostic and trace entries to its explicit owner', () => {
  for (const page of standardUiEventPages) for (const owner of [undefined, 'owner', 'derived']) {
    const p = createProject(), kind = page.id.slice(3) as typeof p.ui.components[number]['page'];
    const component = { id: 'context_control', page: kind, kind: 'button' as const, text: '上下文', x: 0, y: 0, width: 100, height: 40 };
    p.ui.components = [component];
    p.ui.instances = [{ id: 'owner', name: '原方案', components: [{ ...component }] }, { id: 'derived', name: '派生方案', baseUiId: 'owner', components: [] }, { id: 'other', name: '其他方案', components: [] }];
    p.ui.activeInstanceId = owner;
    const graph = createUiEventGraph(p, page.id, page.name), event = blueprintNodeDefaults('eventClick');
    event.properties = { componentId: component.id, uiInstanceId: owner ?? 'base' }; graph.nodes.push(event);
    p.ui.activeInstanceId = 'other';
    const before = structuredClone(p), expected = { page: kind, instanceId: owner, componentId: component.id };
    assert.deepEqual(blueprintContext(p, graph.id, event.id).ui, expected, page.id);
    assert.deepEqual(resolveAiEditorTarget(p, { kind: 'blueprint', graphId: graph.id, nodeId: event.id }).ui, expected);
    assert.deepEqual(resolveAiEditorTarget(p, { kind: 'blueprintSelection', graphId: graph.id, nodeIds: [event.id], linkIds: [] }).ui, expected);
    const issue = diagnosticLocation(p, { severity: 'error', message: '测试定位', nodeId: event.id, ui: { page: kind, instanceId: 'other' } });
    assert.deepEqual(issue.destination, { kind: 'blueprint', graphId: graph.id, nodeId: event.id });
    assert.deepEqual(resolveUiPreviewAction(p, { kind: 'locate', projectId: p.id, graphId: graph.id, nodeId: event.id }).ui, expected);
    assert.deepEqual(p, before, 'Navigation is read-only and cannot change the game scheme or call entry.');
  }
});

test('legacy event inference shares effective inheritance and scoped binding rules with the page workspace', () => {
  const p = createProject(), graph = createBlueprintGraph('ui', '旧调用与事件共存');
  const button = { id: 'inherited_button', page: 'preferences' as const, kind: 'button' as const, text: '设置', x: 0, y: 0, width: 100, height: 40 };
  p.ui.components = [];
  p.ui.instances = [{ id: 'owner', name: '原方案', components: [button] }, { id: 'derived', name: '派生', baseUiId: 'owner', components: [] }, { id: 'other', name: '相同控件标识的另一方案', components: [{ ...button }] }];
  p.ui.activeInstanceId = 'other';
  const event = blueprintNodeDefaults('eventClick'); event.properties = { componentId: button.id, uiInstanceId: 'derived' }; graph.nodes.push(event); p.blueprints.push(graph);
  const before = structuredClone(p);
  assert.deepEqual(blueprintContext(p, graph, event.id).ui, { page: 'preferences', instanceId: 'derived', componentId: button.id });
  assert.equal(uiPageGraphs(p, 'ui:preferences').some(item => item.id === graph.id), false);
  assert.deepEqual(p, before);
  event.properties.uiInstanceId = '';
  assert.equal(blueprintContext(p, graph).ui, undefined);
  assert.match(blueprintContext(p, graph).problem!, /多个页面或方案/);
});

test('known page without a scheme means base, not the currently active or stale scheme', () => {
  const p = createProject(), graph = createUiEventGraph(p, 'ui:main', '基础事件');
  delete graph.uiInstanceId; p.ui.activeInstanceId = 'removed_active_scheme';
  const direct = resolveAiEditorTarget(p, { kind: 'blueprint', graphId: graph.id });
  const selection = resolveAiEditorTarget(p, { kind: 'blueprintSelection', graphId: graph.id, nodeIds: [graph.nodes[0].id], linkIds: [] });
  assert.deepEqual(direct.ui, { page: 'main', instanceId: undefined }); assert.deepEqual(selection.ui, direct.ui);
  graph.uiInstanceId = 'removed_owner';
  assert.equal(blueprintContext(p, graph).ui, undefined); assert.match(blueprintContext(p, graph).problem!, /方案已不存在/);
  assert.throws(() => resolveAiEditorTarget(p, { kind: 'blueprintSelection', graphId: graph.id, nodeIds: [], linkIds: [] }), /方案已不存在/);
  graph.uiInstanceId = 'base'; p.ui.disabledPages = ['main'];
  assert.equal(blueprintContext(p, graph).ui, undefined); assert.match(blueprintContext(p, graph).problem!, /已停用/);
});

test('resource lookup refuses duplicate graph IDs and never manufactures an owner for an unbound mixed graph', () => {
  const p = createProject(), graph = createBlueprintGraph('ui', '未归属旧图'); p.blueprints.push(graph);
  const original = structuredClone(graph);
  assert.equal(blueprintContext(p, graph.id).ui, undefined); assert.match(blueprintContext(p, graph.id).problem!, /不会自动使用当前页面/);
  assert.deepEqual(graph, original);
  p.blueprints.push(structuredClone(graph));
  assert.equal(blueprintContext(p, graph.id).ui, undefined); assert.match(blueprintContext(p, graph.id).problem!, /不唯一/);
});

test('draft routing uses new derived events while preserving concurrent project changes and stable IDs', () => {
  const base = createProject();
  base.ui.instances = [{ id: 'parent', name: '原方案', components: [] }, { id: 'derived', name: '派生', baseUiId: 'parent', components: [] }];
  base.ui.activeInstanceId = 'parent';
  const parent = createUiEventGraph(base, 'ui:main', '原方案事件');
  let derivedId = '';
  const value = mutateProject(base, draft => {
    draft.ui.activeInstanceId = 'derived'; derivedId = createUiEventGraph(draft, 'ui:main', '派生新事件').id;
    draft.ui.activeInstanceId = 'parent';
  });
  const current = mutateProject(base, draft => { draft.name = '同时修改的作品名称'; draft.assets.push({ id: 'concurrent_asset', name: '同时导入', kind: 'image', path: 'assets/concurrent.png' }); });
  const merged = applyUiDraft(current, { base, value }), before = structuredClone(merged);
  assert.deepEqual(blueprintContext(merged, derivedId).ui, { page: 'main', instanceId: 'derived' });
  assert.deepEqual(blueprintContext(merged, parent.id).ui, { page: 'main', instanceId: 'parent' });
  assert.equal(merged.name, current.name); assert.equal(merged.assets, current.assets); assert.deepEqual(merged, before);
  assert.equal(blueprintContext(applyUiDraft(current), derivedId).ui, undefined);
  assert.match(blueprintContext(applyUiDraft(current), derivedId).problem!, /已不存在/);
});