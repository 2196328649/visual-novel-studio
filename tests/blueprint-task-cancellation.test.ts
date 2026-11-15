import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiPagePreviewFixture } from '../scripts/lib/ui-page-preview-fixture';
import { uiStageFixture } from '../scripts/lib/ui-stage-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { compileProject } from '../src/runtime/compiler';

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const advance = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
function fixture() {
  const f = createUiPagePreviewFixture();
  const sample = (events: UiPreviewEvent[]) => previewUiLogic(f.project, f.project.ui.components, 'ui:main', {}, events, { timed: true });
  return { ...f, sample };
}

test('closing the source page cancels the active chain and remaining click actions, not its external caller', () => {
  const f = fixture();
  f.chain(f.closer, f.close, f.add(f.closer, 'setVariable', { variableId: 'base_clicks', value: 99 }));
  const primary = f.addGraph('不应再执行的主操作');
  f.chain(primary, primary.nodes[0], f.add(primary, 'setVariable', { variableId: 'base_clicks', value: 100 }));
  const button = f.project.ui.customPages[0].components[0];
  button.events = { onClick: f.closer.id }; button.blueprintId = primary.id;
  const state = f.sample([click('open_button'), click('close_button')]);
  assert.equal(state.variables.base_clicks, 0);
  assert.equal(state.variables.after, 1);
  assert.equal(state.variables.result, '已确认');
  assert.equal(state.incomplete, false);
  assert.deepEqual(state.pageResults.map(({ pageId, result, reason }) => ({ pageId, result, reason })), [
    { pageId: 'waiting_page', result: '已确认', reason: 'completed' },
  ]);
});

test('closing and reopening a page cannot revive its previous delayed on-show task', () => {
  const f = fixture();
  const last = f.show.nodes.find(node => node.type === 'setVariable')!;
  const delay = f.add(f.show, 'delay', { seconds: 1 });
  f.chain(f.show, last, delay); f.increment(f.show, delay, 'base_clicks');
  const events = [click('open_button'), advance(.25), click('close_button'), click('open_button'), advance(.8)];
  const pending = f.sample(events);
  assert.equal(pending.variables.opens, 2);
  assert.equal(pending.variables.after, 1);
  assert.equal(pending.variables.base_clicks, 0);
  assert.equal(pending.stageWaiting, 1);
  const completed = f.sample([...events, advance(.2)]);
  assert.equal(completed.variables.base_clicks, 1);
  assert.equal(completed.stageWaiting, 0);
  assert.equal(completed.incomplete, false);
});

test('closing a parent cancels nested page chains while resuming only the surviving caller', () => {
  const f = fixture(), child = f.project.ui.customPages[1];
  const closeParent = f.addGraph('子页关闭父页');
  const close = f.add(closeParent, 'closeUiPage', { pageId: 'waiting_page', result: '父页完成' });
  f.chain(closeParent, closeParent.nodes[0], close, f.add(closeParent, 'setVariable', { variableId: 'base_clicks', value: 99 }));
  child.components[0].blueprintId = closeParent.id;
  const state = f.sample([click('open_button'), click('nested_button'), click('nested_close')]);
  assert.equal(state.pageId, 'ui:main');
  assert.equal(state.variables.after, 1);
  assert.equal(state.variables.nested, '尚未返回');
  assert.equal(state.variables.result, '父页完成');
  assert.equal(state.variables.base_clicks, 0);
  assert.deepEqual(state.pageResults.map(p => [p.pageId, p.reason]), [['nested_page', 'parentClosed'], ['waiting_page', 'completed']]);
  assert.equal(state.incomplete, false);
});

test('page-owned animation continuations stop on close and a new instance starts independently', () => {
  const f = fixture(), page = f.project.ui.customPages[0];
  const animation = f.addGraph('页面动画等待');
  const animate = f.add(animation, 'animateUiProperty', { componentId: 'nested_button', property: 'opacity', value: 0, duration: 1, wait: true });
  f.chain(animation, animation.nodes[0], animate); f.increment(animation, animate, 'base_clicks');
  page.onShowBlueprintId = animation.id;
  const events = [click('open_button'), advance(.25), click('close_button'), click('open_button'), advance(.8)];
  assert.equal(f.sample(events).variables.base_clicks, 0);
  const state = f.sample([...events, advance(.2)]);
  assert.equal(state.variables.base_clicks, 1);
  assert.equal(state.variables.after, 1);
  assert.equal(state.incomplete, false);
});

test('an external animation waiter resumes once when its target page closes', () => {
  const f = fixture(); f.open.properties.wait = false; f.project.ui.customPages[0].modal = false;
  const external = f.addGraph('外部动画等待');
  const animate = f.add(external, 'animateUiProperty', { componentId: 'nested_button', property: 'opacity', value: 0, duration: 1, wait: true });
  f.chain(external, external.nodes[0], animate); f.increment(external, animate, 'base_clicks');
  f.project.ui.components.find(c => c.id === 'base_button')!.blueprintId = external.id;
  const state = f.sample([click('open_button'), click('base_button'), advance(.2), click('close_button'), advance(2)]);
  assert.equal(state.variables.base_clicks, 1);
  assert.equal(state.variables.after, 1);
  assert.equal(state.incomplete, false);
});

test('closing a page stops its finite stage media at the close time without mutating authored durations', () => {
  const f = uiStageFixture(), p = f.project;
  const page = { id: 'stage_page', name: '演出页面', modal: true, components: p.ui.components.map(c => ({ ...c, page: 'custom' as const })) };
  p.ui.customPages.push(page); p.ui.components = []; f.graph.uiPageId = page.id;
  const before = structuredClone(p);
  const state = previewUiLogic(p, page.components, page.id, {}, [click('play'), advance(.75), { kind: 'cancelPage', pageId: page.id }, advance(.5)], { timed: true });
  assert.equal(state.closed, true);
  assert.equal(state.stageWaiting, 0);
  assert.equal(state.stage.sample.visuals.length, 0);
  assert.equal(state.stage.audio[0].duration, 500);
  assert.equal(state.incomplete, false);
  assert.deepEqual(p, before);
});

test('returning to title discards page tasks and pending media instead of drawing them over the title', () => {
  const f = uiStageFixture(), p = f.project;
  const page = { id: 'stage_page', name: '演出页面', modal: true, components: p.ui.components.map(c => ({ ...c, page: 'custom' as const })) };
  page.components.push({ id: 'back', kind: 'button', page: 'custom', text: '返回标题', action: 'mainMenu', x: .5, y: .8, width: .2, height: .1 });
  p.ui.customPages.push(page); p.ui.components = []; f.graph.uiPageId = page.id;
  const state = previewUiLogic(p, page.components, page.id, {}, [click('play'), advance(.75), click('back'), advance(2)], { timed: true });
  assert.equal(state.pageId, 'ui:main');
  assert.equal(state.stageWaiting, 0);
  assert.equal(state.stage.sample.visuals.length, 0);
  assert.equal(state.stage.audio[0].duration, 500);
  assert.equal(state.pageResults[0].reason, 'navigated');
  assert.equal(state.incomplete, false);
});

test('shared callbacks are guarded per page instance, not globally by graph label', () => {
  const f = fixture();
  const shared = f.addGraph('两个页面共用的延迟初始化'), delay = f.add(shared, 'delay', { seconds: 1 });
  f.chain(shared, shared.nodes[0], delay); f.increment(shared, delay, 'base_clicks');
  f.project.ui.customPages[0].onShowBlueprintId = shared.id;
  f.project.ui.customPages[1].onShowBlueprintId = shared.id;
  const state = f.sample([click('open_button'), click('nested_button'), advance(1)]);
  assert.equal(state.variables.base_clicks, 2);
  assert.equal(state.stageWaiting, 0);
  assert.equal(state.incomplete, false);
});

test('a button callback stays busy while its earlier run waits on a page it opened', () => {
  const f = fixture();
  // The opener still waits on the page; a button there must not start it again.
  f.project.ui.customPages[1].components[0].events = { onClick: f.opener.id };
  const state = f.sample([click('open_button'), click('nested_button'), click('nested_close')]);
  assert.equal(state.variables.nested, '子页完成');
  assert.equal(state.variables.result, '尚未返回');
  assert.equal(state.variables.after, 0);
  assert.equal(state.incomplete, false);
});

test('repeated nonwaiting opens report alreadyOpen without replaying initialization', () => {
  const f = fixture(); f.open.properties.wait = false; f.project.ui.customPages[0].modal = false;
  const write = f.opener.nodes.find(n => n.type === 'setVariable' && n.properties.variableId === 'result')!;
  f.opener.links = f.opener.links.filter(link => link.toNodeId !== write.id || link.toPinId !== 'value');
  f.link(f.opener, f.open, 'reason', write, 'value');
  assert.equal(f.sample([click('open_button')]).variables.result, 'shown');
  const state = f.sample([click('open_button'), click('open_button')]);
  assert.equal(state.variables.result, 'alreadyOpen');
  assert.equal(state.variables.opens, 1);
});

test('generated callbacks capture page tokens and cancellation guards cover loops, nested calls and confirmations', () => {
  const f = fixture();
  const outer = f.addGraph('循环调用'), loop = f.add(outer, 'forLoop', { firstIndex: 0, lastIndex: 2 });
  const call = f.add(outer, 'callFunction', { graphId: f.opener.id });
  f.chain(outer, outer.nodes[0], loop); f.link(outer, loop, 'loop_body', call, 'exec_in');
  const confirm = f.add(outer, 'confirmMessage'); f.link(outer, loop, 'completed', confirm, 'exec_in');
  synchronizeBlueprintSignatures(f.project);
  const built = compileProject(f.project);
  assert.deepEqual(built.diagnostics.filter(d => d.severity === 'error'), []);
  const script = built.files['game/story.rpy'], screens = built.files['game/screens.rpy'];
  assert.ok(script.includes('$ renpy.dynamic("vn_bp_task", "vn_bp_wait")'));
  assert.ok(script.includes('while vn_bp_task_alive(vn_bp_task) and vn_bp_local("vn_bp_index_'));
  assert.match(script, /call vn_blueprint_.* from vn_blueprint_nested_.*\n\s+if not vn_bp_task_alive\(vn_bp_task\):\n\s+\$ vn_bp_leave_frame\(\)\n\s+return/);
  assert.match(script, /call vn_confirm_prompt.*\n\s+if not vn_bp_task_alive\(vn_bp_task\):\n\s+\$ vn_bp_leave_frame\(\)\n\s+return/);
  assert.ok(screens.includes(`Function(vn_run_ui_show, "${f.show.id}", page_id="waiting_page")`));
  assert.ok(screens.includes(`Function(vn_run_blueprint, "${f.closer.id}", page_id="waiting_page")`));
  assert.ok(screens.includes('timer 0.5 repeat True action Function(vn_run_blueprint,'));
});
