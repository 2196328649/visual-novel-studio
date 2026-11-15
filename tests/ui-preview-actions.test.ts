import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { createUiEventGraph } from '../src/core/ui-logic';
import { checkedUiPreviewAction, resolveUiPreviewAction } from '../src/core/ui-preview-actions';
import { createBlueprintTraceFixture } from '../scripts/lib/blueprint-trace-fixture';

test('preview actions are narrow, project-scoped and never replace stale targets with a fallback', () => {
  const f = createBlueprintTraceFixture(), p = f.project, locate = { kind: 'locate', projectId: p.id, graphId: f.rootGraph.id, nodeId: f.primary.call.id, pageId: f.root.id };
  assert.deepEqual(checkedUiPreviewAction(p, locate), locate);
  for (const raw of [{ kind: 'delete', projectId: p.id }, { ...locate, projectId: 'old' }, { ...locate, graphId: 'gone' }, { ...locate, nodeId: 'gone' }, { ...locate, pageId: 'gone' }, { ...locate, uiInstanceId: 'gone' }, { kind: 'locate', projectId: p.id }, { kind: 'locate', projectId: p.id, nodeId: f.primary.call.id }]) assert.throws(() => checkedUiPreviewAction(p, raw));
  const before = JSON.stringify(p); assert.deepEqual(checkedUiPreviewAction(p, { kind: 'play', projectId: p.id }), { kind: 'play', projectId: p.id }); assert.equal(JSON.stringify(p), before);
});

test('page and component navigation keep the original page and reject moved or removed controls', () => {
  const f = createBlueprintTraceFixture(), p = f.project;
  const action = { kind: 'locate', projectId: p.id, pageId: f.root.id, componentId: f.observe.id };
  assert.deepEqual(resolveUiPreviewAction(p, action).ui, { page: 'custom', customPageId: f.root.id, componentId: f.observe.id });
  assert.throws(() => checkedUiPreviewAction(p, { ...action, pageId: f.child.id }), /原页面/);
  f.root.components = f.root.components.filter(c => c.id !== f.observe.id); f.child.components.push(f.observe);
  assert.throws(() => checkedUiPreviewAction(p, action), /原页面/);
  assert.deepEqual(resolveUiPreviewAction(p, { kind: 'locate', projectId: p.id, graphId: f.parent.id }).ui, undefined);
});

test('base and derived schemes resolve explicitly without changing the project active scheme', () => {
  const p = createProject(); p.ui.instances = [{ id: 'owner', name: '所属方案', components: [{ id: 'button', page: 'preferences', kind: 'button', text: '按钮', x: 0, y: 0, width: 1, height: 1 }] }, { id: 'derived', name: '派生方案', baseUiId: 'owner', components: [] }, { id: 'other', name: '其他方案', components: [] }];
  p.ui.activeInstanceId = 'owner'; const graph = createUiEventGraph(p, 'ui:preferences', '所属图'); p.ui.activeInstanceId = 'other';
  const action = { kind: 'locate', projectId: p.id, graphId: graph.id, nodeId: graph.nodes[0].id, pageId: 'ui:preferences', uiInstanceId: 'derived', componentId: 'button' };
  const before = JSON.stringify(p); assert.deepEqual(resolveUiPreviewAction(p, action).ui, { page: 'preferences', instanceId: 'derived', componentId: 'button' }); assert.equal(JSON.stringify(p), before);
  assert.throws(() => checkedUiPreviewAction(p, { ...action, uiInstanceId: 'other' }), /原页面／方案/);
  assert.throws(() => checkedUiPreviewAction(p, { ...action, uiInstanceId: 'base' }), /原页面／方案/);
  assert.deepEqual(resolveUiPreviewAction(p, { kind: 'locate', projectId: p.id, pageId: 'ui:preferences', uiInstanceId: 'base' }).ui, { page: 'preferences', instanceId: undefined });
});

test('an owned event graph cannot be redirected by an unrelated component callback binding', () => {
  const f = createBlueprintTraceFixture(); f.child.components[1].events = { onClick: f.rootGraph.id };
  assert.throws(() => checkedUiPreviewAction(f.project, { kind: 'locate', projectId: f.project.id, graphId: f.rootGraph.id, pageId: f.child.id }), /不属于原页面/);
});

test('legacy shared event graphs use the observed page instead of guessing a unique owner', () => {
  const f = createBlueprintTraceFixture(), legacy = createBlueprintGraph('ui', '旧共用事件图'); f.project.blueprints.push(legacy);
  f.root.components[1].events = { onClick: legacy.id }; f.child.components[1].events = { onClick: legacy.id };
  assert.throws(() => checkedUiPreviewAction(f.project, { kind: 'locate', projectId: f.project.id, graphId: legacy.id }), /多个页面/);
  assert.deepEqual(resolveUiPreviewAction(f.project, { kind: 'locate', projectId: f.project.id, graphId: legacy.id, pageId: f.child.id }).ui, { page: 'custom', customPageId: f.child.id });
});

test('discarding an unsaved graph invalidates the queued action instead of navigating another graph', () => {
  const f = createBlueprintTraceFixture(), saved = structuredClone(f.project), onlyDraft = createBlueprintGraph('function', '只在草稿中'); f.project.blueprints.push(onlyDraft);
  const action = { kind: 'locate', projectId: f.project.id, graphId: onlyDraft.id, nodeId: onlyDraft.nodes[0].id };
  assert.equal(checkedUiPreviewAction(f.project, action).kind, 'locate'); assert.throws(() => checkedUiPreviewAction(saved, action), /蓝图已不存在/);
});

test('explicit scheme is checked even when the action omits a page and uses graph ownership', () => {
  const p = createProject(); p.ui.instances = [{ id: 'owner', name: '所属', components: [] }, { id: 'other', name: '另一个', components: [] }, { id: 'derived', name: '派生', baseUiId: 'owner', components: [] }];
  p.ui.activeInstanceId = 'owner'; const graph = createUiEventGraph(p, 'ui:preferences', '方案图'); p.ui.activeInstanceId = 'other';
  assert.throws(() => checkedUiPreviewAction(p, { kind: 'locate', projectId: p.id, graphId: graph.id, uiInstanceId: 'other' }), /原界面方案/);
  assert.deepEqual(resolveUiPreviewAction(p, { kind: 'locate', projectId: p.id, graphId: graph.id, uiInstanceId: 'derived' }).ui, { page: 'preferences', instanceId: 'derived' });
});
