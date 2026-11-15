import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createProject, projectSchema, uiInstanceSchema, type UiComponent } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { addGameFlowStep, createCustomUiPage, createPageCall } from '../src/core/game-flow';
import { flowPageOpening, setBlueprintPageOpening, setFlowPageOpening, uiPageOpeningDefaults, uiPageOpeningPresets, uiPageOpeningProblem } from '../src/core/ui-page-opening';
import { setUiFlowTarget, uiFlowEventStatus, uiFlowTargetKey, uiPageFlowEvents } from '../src/core/ui-page-flow';
import { nativeMainButtons } from '../src/core/ui-native-main';
import { gameFlowCanvasEdges, pageFlowCanvas } from '../src/renderer/game-flow-view';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { mutateProject } from '../src/core/project-mutation';
import { applyUiDraft } from '../src/core/ui-draft';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { uiFlowOverlayFixture } from '../scripts/lib/ui-flow-overlay-fixture';
import { compileProject } from '../src/runtime/compiler';
import { storyScopeBreadcrumbs, storyScopeKey, validStoryScope } from '../src/core/story-graph';

test('menu exits reflect actual authored buttons, preserve stable native identity when retargeted, and use one behavior source', () => {
  const p = createProject(), before = structuredClone(p), start = uiPageFlowEvents(p, 'ui:main').find(e => e.routes.some(r => uiFlowTargetKey(r.target) === 'system:start'))!;
  assert.equal(start.editable, true); assert.deepEqual(p, before);
  const custom = createCustomUiPage(p, '目的地');
  setUiFlowTarget(p, 'ui:main', start.id, { kind: 'page', pageId: custom.id });
  const button = p.ui.components.find(c => c.nativeSlot === 'main:start')!;
  assert.equal(button.action, 'blueprint'); assert.equal(nativeMainButtons(p).some(c => c.nativeSlot === 'main:start'), false);
  const event = uiPageFlowEvents(p, 'ui:main').find(e => e.id === start.id)!;
  assert.equal(event.componentId, button.id); assert.equal(event.routes[0].target.kind, 'page'); assert.equal(event.editable, true);
  assert.equal(gameFlowCanvasEdges(p).some(e => e.source === 'flow:title' && e.target === 'flow:newGame'), false);
  setUiFlowTarget(p, 'ui:main', start.id);
  assert.equal(uiPageFlowEvents(p, 'ui:main').find(e => e.id === start.id)?.routes.length, 0);
  assert.equal(nativeMainButtons(p).some(c => c.nativeSlot === 'main:start'), false);
});

test('shared or multi-step button graphs stay inspectable without being overwritten by simple flow edits', () => {
  const p = createProject(), page = createCustomUiPage(p, '目标'), call = createPageCall(p, page.id);
  p.ui.components.push(...['a', 'b'].map(id => ({ id, kind: 'button' as const, page: 'main' as const, text: id, x: .4, y: .4, width: .2, height: .1, action: 'blueprint' as const, blueprintId: call.id })));
  const event = uiPageFlowEvents(p, 'ui:main').find(e => e.componentId === 'a')!;
  assert.equal(event.editable, false); assert.equal(event.routes[0].graphId, call.id);
  const before = structuredClone(p); assert.throws(() => setUiFlowTarget(p, 'ui:main', event.id, { kind: 'system', action: 'start' }), /共享|事件/); assert.deepEqual(p, before);
  p.ui.components[0].flowEvent = { visible: false }; assert.equal(uiPageFlowEvents(p, 'ui:main').some(e => e.componentId === 'a'), false);
});

test('settings language placeholders never become navigation exits, including unchanged legacy projects', () => {
  const p = projectSchema.parse(JSON.parse(readFileSync(new URL('../resources/templates/aihong/project.vns.json', import.meta.url), 'utf8')));
  const arrows = p.ui.components.filter(component => /^ai_settings_(voice)?languagesetting_btn(pre|next)$/.test(component.id));
  assert.equal(arrows.length, 4);
  assert.equal(new Set(arrows.map(component => component.name)).size, 4);
  for (const arrow of arrows) { assert.equal(arrow.disabled, true); assert.equal(arrow.action, undefined); }
  const arrowIds = new Set(arrows.map(component => 'button:' + component.id));
  const checkExits = () => {
    const events = uiPageFlowEvents(p, 'ui:preferences'), canvas = pageFlowCanvas(p, 'ui:preferences');
    assert.equal(events.some(event => arrowIds.has(event.id)), false);
    assert.equal(canvas.nodes[0].ports.some(port => arrowIds.has(port.id)), false);
    assert.equal(canvas.edges.some(edge => arrowIds.has(edge.sourceHandle)), false);
    for (const target of ['system:return', 'system:mainMenu', 'system:quit']) {
      assert.ok(events.some(event => event.routes.some(route => uiFlowTargetKey(route.target) === target)), target);
    }
  };
  checkExits();
  // Released projects keep their original data; filtering belongs to the editor view.
  for (const arrow of arrows) { arrow.action = 'return'; delete arrow.name; }
  const before = structuredClone(p); checkExits(); assert.deepEqual(p, before);
});

test('disabled buttons are hidden automatically but explicit publication preserves their identity and disabled behavior', () => {
  const p = createProject(), page = createCustomUiPage(p, '禁用按钮');
  const button: UiComponent = { id: 'disabled_navigation', kind: 'button', page: 'custom', text: '禁用入口', action: 'return', x: .1, y: .4, width: .3, height: .1 };
  page.components.push(button);
  button.disabled = true;
  assert.equal(uiPageFlowEvents(p, page.id).some(event => event.componentId === button.id), false);
  button.flowEvent = { visible: true, name: '后续开放入口' };
  let event = uiPageFlowEvents(p, page.id).find(event => event.componentId === button.id)!;
  assert.equal(uiFlowEventStatus(event), '已禁用'); assert.equal(event.name, '后续开放入口');
  assert.equal(event.routes[0].target.kind, 'system');
  setUiFlowTarget(p, page.id, event.id, { kind: 'system', action: 'quit' });
  assert.equal(button.disabled, true); assert.equal(button.action, 'quit');
  event = uiPageFlowEvents(p, page.id).find(item => item.id === event.id)!;
  assert.equal(uiFlowEventStatus(event), '已禁用');
  button.action = 'return';
  const preview = previewUiLogic(p, page.components, page.id, {}, [{ kind: 'click', componentId: button.id }], { timed: true });
  assert.equal(preview.closed, false);
  button.flowEvent.visible = undefined; button.disabled = false;
  assert.equal(uiFlowEventStatus(uiPageFlowEvents(p, page.id).find(item => item.id === event.id)!), '');
  button.flowEvent.visible = false;
  assert.equal(uiPageFlowEvents(p, page.id).some(item => item.id === event.id), false);
});

test('page exits distinguish display and enable conditions from a disabled navigation target', () => {
  const p = createProject(), page = createCustomUiPage(p, '条件按钮');
  p.variables.push({ id: 'progress', name: '章节进度', type: 'number', initial: 0, persistent: false });
  const button: UiComponent = { id: 'conditional_navigation', kind: 'button', page: 'custom', name: '条件入口', text: '返回', action: 'return', x: .1, y: .4, width: .3, height: .1 };
  page.components.push(button);
  button.enabledWhen = { kind: 'compare', variableId: 'progress', operator: 'gte', value: 2 };
  let event = uiPageFlowEvents(p, page.id).find(item => item.componentId === button.id)!;
  assert.equal(uiFlowEventStatus(event), '有启用条件'); assert.deepEqual(event.enabledWhen, button.enabledWhen);
  assert.equal(event.disabled, undefined); assert.equal(event.visibleWhen, undefined);
  assert.equal(previewUiLogic(p, page.components, page.id, { progress: 0 }, [{ kind: 'click', componentId: button.id }], { timed: true }).closed, false);
  assert.equal(previewUiLogic(p, page.components, page.id, { progress: 2 }, [{ kind: 'click', componentId: button.id }], { timed: true }).closed, true);
  button.visibleWhen = { kind: 'compare', variableId: 'progress', operator: 'gt', value: 0 };
  event = uiPageFlowEvents(p, page.id).find(item => item.componentId === button.id)!;
  assert.equal(uiFlowEventStatus(event), '有显示条件 · 有启用条件');
  assert.deepEqual(event.visibleWhen, button.visibleWhen);
  const port = pageFlowCanvas(p, page.id).nodes[0].ports.find(item => item.id === event.id)!;
  assert.equal(port.label, '条件入口 · 有显示条件 · 有启用条件');
  delete button.visibleWhen; delete button.enabledWhen;
  button.selectedWhen = { kind: 'compare', variableId: 'progress', operator: 'gte', value: 2 };
  assert.equal(uiFlowEventStatus(uiPageFlowEvents(p, page.id).find(item => item.id === event.id)!), '');
  button.action = 'preferences'; p.ui.disabledPages = ['preferences'];
  event = uiPageFlowEvents(p, page.id).find(item => item.componentId === button.id)!;
  assert.equal(uiFlowEventStatus(event), '目标已停用');
  assert.equal(event.editable, true);
  setUiFlowTarget(p, page.id, event.id, { kind: 'system', action: 'return' });
  assert.equal(uiFlowEventStatus(uiPageFlowEvents(p, page.id).find(item => item.id === event.id)!), '');
});

test('reconnecting a menu to its current page preserves opening overrides and only an explicit reset restores defaults', () => {
  const p = createProject(), page = createCustomUiPage(p, '可复用覆盖层'); page.opening = { ...uiPageOpeningPresets.hud.value };
  const eventId = uiPageFlowEvents(p, 'ui:main').find(event => event.nativeSlot === 'main:preferences')!.id;
  const target = { kind: 'page' as const, pageId: page.id }, opening = { ...uiPageOpeningPresets.dialog.value, autoClose: 4.5, closeOnEscape: false };
  setUiFlowTarget(p, 'ui:main', eventId, target, opening);
  const before = structuredClone(p), beforeFiles = compileProject(p).files;
  setUiFlowTarget(p, 'ui:main', eventId, target);
  assert.deepEqual(p, before); assert.deepEqual(compileProject(p).files, beforeFiles);
  const buttonId = uiPageFlowEvents(p, 'ui:main').find(event => event.id === eventId)!.componentId!;
  const preview = previewUiLogic(p, p.ui.components, 'ui:main', {}, [{ kind: 'click', componentId: buttonId }], { timed: true });
  assert.deepEqual(preview.layers.find(layer => layer.pageId === page.id)?.opening, opening);
  setUiFlowTarget(p, 'ui:main', eventId, target, {});
  assert.deepEqual(uiPageFlowEvents(p, 'ui:main').find(event => event.id === eventId)!.routes[0].opening, {});
  const restored = previewUiLogic(p, p.ui.components, 'ui:main', {}, [{ kind: 'click', componentId: buttonId }], { timed: true });
  assert.deepEqual(restored.layers.find(layer => layer.pageId === page.id)?.opening, uiPageOpeningPresets.hud.value);
});

test('reconnecting an unchanged system menu does not materialize a button or create an unused call graph', () => {
  const p = createProject(), event = uiPageFlowEvents(p, 'ui:main').find(item => item.nativeSlot === 'main:load')!, before = structuredClone(p);
  setUiFlowTarget(p, 'ui:main', event.id, event.routes[0].target);
  assert.deepEqual(p, before);
});

test('invalid opening edits are rejected before changing a native button or an existing page call', () => {
  const p = createProject(), page = createCustomUiPage(p, '打开方式校验'), eventId = uiPageFlowEvents(p, 'ui:main').find(item => item.nativeSlot === 'main:preferences')!.id;
  const target = { kind: 'page' as const, pageId: page.id }, invalid = { wait: true, lifetime: 'game' as const };
  let before = structuredClone(p);
  assert.throws(() => setUiFlowTarget(p, 'ui:main', eventId, target, invalid), /跟随/); assert.deepEqual(p, before);
  setUiFlowTarget(p, 'ui:main', eventId, target, uiPageOpeningPresets.dialog.value); before = structuredClone(p);
  assert.throws(() => setUiFlowTarget(p, 'ui:main', eventId, target, invalid), /跟随/); assert.deepEqual(p, before);
});

test('page scopes are navigation views, handle deleted pages and loops, and keep the page resource unchanged', () => {
  const p = createProject(), page = createCustomUiPage(p, '背包');
  const scope = validStoryScope(p, { kind: 'page', pageId: page.id, trail: ['ui:main', page.id, 'ui:main', 'missing'] });
  assert.equal(storyScopeKey(scope), 'page:' + page.id); assert.equal(storyScopeBreadcrumbs(p, scope).length, 3);
  const before = structuredClone(p); assert.ok(pageFlowCanvas(p, page.id).nodes.length > 0); assert.deepEqual(p, before);
  assert.deepEqual(validStoryScope(p, { kind: 'page', pageId: 'missing' }), { kind: 'game' });
});

test('legacy flow settings retain behavior; explicit inheritance and individual overrides follow changed page defaults', () => {
  const p = createProject(), page = createCustomUiPage(p, '覆盖层'); page.modal = false;
  assert.deepEqual(uiPageOpeningDefaults(p, page.id), { ...uiPageOpeningPresets.page.value, input: 'controls' });
  const step = addGameFlowStep(p, 'beforeNewGame', { kind: 'page', pageId: page.id, wait: true }); assert.equal(step.kind, 'page'); if (step.kind !== 'page') return;
  page.opening = { ...uiPageOpeningPresets.hud.value }; assert.equal(flowPageOpening(p, step).wait, true);
  setFlowPageOpening(step); assert.equal(flowPageOpening(p, step).wait, false);
  setFlowPageOpening(step, { lifetime: 'scene' }); assert.equal(flowPageOpening(p, step).presentation, 'overlay'); assert.equal(flowPageOpening(p, step).lifetime, 'scene');
  assert.match(uiPageOpeningProblem(p, page.id, { wait: true, lifetime: 'game' })!, /跟随/);
  assert.match(uiPageOpeningProblem(p, 'ui:save', uiPageOpeningPresets.hud.value)!, /系统/);
});

test('flow buttons, native origins and overrides survive schema, UI draft merge and text roundtrip', () => {
  const p = createProject(), page = createCustomUiPage(p, '提示'), base = structuredClone(p);
  const event = uiPageFlowEvents(p, 'ui:main').find(e => e.nativeSlot === 'main:preferences')!;
  const edited = mutateProject(p, draft => { setUiFlowTarget(draft, 'ui:main', event.id, { kind: 'page', pageId: page.id }, uiPageOpeningPresets.notice.value); });
  const concurrent = mutateProject(p, draft => { draft.version = '2.0.0'; });
  const loaded = projectSchema.parse(applyUiDraft(concurrent, { base, value: edited }));
  assert.equal(loaded.version, '2.0.0'); assert.equal(uiPageFlowEvents(loaded, 'ui:main').find(e => e.id === event.id)?.routes[0].opening?.input, 'none');
  const text = applyTextScript(loaded, projectToText(loaded)); assert.deepEqual(text.issues, []);
  assert.deepEqual(text.project.ui, loaded.ui); assert.deepEqual(text.project.blueprints, loaded.blueprints);
});

test('a derived scheme gets its own button override and never rewrites the base action', () => {
  const p = createProject(); p.ui.components.push({ id: 'base_menu', kind: 'button', page: 'main', text: '设置入口', action: 'preferences', x: .5, y: .5, width: .2, height: .1 });
  p.ui.instances = [uiInstanceSchema.parse({ id: 'derived', name: '派生' })]; p.ui.activeInstanceId = 'derived';
  setUiFlowTarget(p, 'ui:main', 'button:base_menu', { kind: 'system', action: 'quit' });
  assert.equal(p.ui.components[0].action, 'preferences'); assert.equal(p.ui.instances[0].components[0].action, 'quit');
});

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const tick = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
test('passive overlays execute show/close lifecycle, pass clicks and keys, and auto-close without a second continuation', () => {
  const f = uiFlowOverlayFixture();
  const preview = previewUiLogic(f.project, f.parent.components, f.parent.id, {}, [click(f.openNotice.component.id), click(f.under.id), tick(1.5)], { timed: true });
  assert.equal(preview.incomplete, false); assert.equal(preview.variables.under_clicks, 1); assert.equal(preview.variables.notice_shows, 1);
  assert.equal(preview.variables.shown_returns, 1); assert.equal(preview.variables.page_closed, 1); assert.equal(preview.variables.passive_keys, 0);
  assert.equal(preview.layers.some(p => p.pageId === f.notice.id), false); assert.equal(preview.closed, false);
  const only = previewUiLogic(f.project, f.notice.components, f.notice.id, {}, [], { timed: true });
  assert.equal(only.closed, false); assert.equal(only.keys.includes('K_ESCAPE'), false); assert.equal(only.layers[0].interactive, false);
});

test('modal overlay waits and blocks lower controls; closing resumes once; game lifetime survives owner close', () => {
  const f = uiFlowOverlayFixture();
  const p = previewUiLogic(f.project, f.parent.components, f.parent.id, {}, [click(f.openDialog.component.id), click(f.under.id), click(f.dialog.components[1].id)], { timed: true });
  assert.equal(p.variables.under_clicks, 0); assert.equal(p.variables.wait_returns, 1);
  const hud = previewUiLogic(f.project, f.parent.components, f.parent.id, {}, [click(f.openHud.component.id), click(f.openHud.component.id), click(f.parent.components[1].id)], { timed: true });
  assert.equal(hud.variables.hud_shows, 1); assert.equal(hud.variables.shown_returns, 2); assert.equal(hud.layers.some(p => p.pageId === f.hud.id), true);
  assert.equal(hud.layers.some(p => p.pageId === f.parent.id), false); assert.equal(hud.pageResults.some(p => p.reason === 'alreadyOpen'), false);
});

test('compiled opening captures runtime defaults and preserves shared lifecycle and transparent drawing', () => {
  const f = uiFlowOverlayFixture(), source = compileProject(f.project);
  assert.deepEqual(source.diagnostics.filter(d => d.severity === 'error'), []);
  assert.match(source.files['game/story.rpy'], /vn_ui_opening\([^\n]+, None, /);
  assert.match(source.files['game/screens.rpy'], /get\("presentation"[^\n]+ != "overlay"/);
  assert.match(source.files['game/story.rpy'], /vn_ui_pages_enter_scene/);
});
