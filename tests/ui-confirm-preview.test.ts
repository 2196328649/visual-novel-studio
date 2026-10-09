import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiConfirmPreviewFixture } from '../scripts/lib/ui-confirm-preview-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
function fixture() {
 const setup = createUiConfirmPreviewFixture(), { project } = setup;
 return { ...setup, sample: (events: UiPreviewEvent[], timed = false) => previewUiLogic(project, project.ui.components.filter(c => c.page === 'main'), 'ui:main', {}, events, { timed }) };
}
test('confirmation binds the live literal prompt and takes exactly one selected route', () => {
 const { project, sample } = fixture(), before = structuredClone(project);
 const events: UiPreviewEvent[] = [{ kind: 'parameter', id: 'message', value: '测试 [name] {b}' }, click('ask')];
 const open = sample(events); assert.equal(open.pageId, 'ui:messageBox'); assert.equal(open.layers.at(-1)?.message, '测试 [name] {b}'); assert.equal(open.variables.after, 0);
 for (const [button, result] of [['yes', '已确认'], ['no', '已取消']]) { const end = sample([...events, click(button)]); assert.equal(end.pageId, 'ui:main'); assert.equal(end.variables.result, result); assert.equal(end.variables.after, 1); assert.equal(end.incomplete, false); }
 assert.deepEqual(project, before);
});
test('Escape, right-click cancellation and stale confirmation responses cannot accept accidentally', () => {
 const { sample } = fixture();
 for (const event of [{ kind: 'key', key: 'K_ESCAPE' }, { kind: 'cancelPage', pageId: 'ui:messageBox' }] as UiPreviewEvent[]) assert.equal(sample([click('ask'), event]).variables.result, '已取消');
 const open = sample([click('ask')]); const instance = open.layers.at(-1)!.instance;
 const stale = sample([click('ask'), click('no'), click('ask'), { kind: 'confirm', requestId: instance, value: true }]);
 assert.equal(stale.pageId, 'ui:messageBox'); assert.equal(stale.variables.after, 1);
});
test('standard confirmation uses its own buttons and ignores authored message-box handlers', () => {
 const { project, sample, add, increment, clocks } = fixture(); delete project.ui.pages!.messageBox;
 increment(clocks, add(clocks, 'eventTimer', { pageId: 'ui:messageBox', interval: .1, repeat: true }), 'after');
 const open = sample([click('ask')]); assert.equal(open.layers.at(-1)?.nativeConfirm, true); assert.equal(open.components.length, 0);
 const events: UiPreviewEvent[] = [click('ask'), { kind: 'advance', seconds: 1 }];
 const waiting = sample(events, true); assert.equal(waiting.variables.after, 0);
 const accepted = sample([...events, { kind: 'confirm', requestId: waiting.layers.at(-1)!.instance, value: true }], true); assert.equal(accepted.variables.result, '已确认'); assert.equal(accepted.variables.after, 1);
});
test('button callbacks wait for their nested confirmation before applying the outer response', () => {
 const { project, nestedGraph, sample } = fixture(); project.ui.components.find(c => c.id === 'yes')!.events = { onClick: nestedGraph.id };
 const open = sample([click('ask'), click('yes')]); assert.equal(open.layers.filter(p=>p.mode==='confirm').length, 2); assert.equal(open.layers.at(-1)?.message, '内层确认'); assert.equal(open.variables.after, 0);
 const end = sample([click('ask'), click('yes'), { kind: 'confirm', requestId: open.layers.at(-1)!.instance, value: true }]);
 assert.equal(end.pageId, 'ui:main'); assert.equal(end.variables.nested, '内层确认完成'); assert.equal(end.variables.result, '已确认'); assert.equal(end.variables.after, 1);
});
test('menu calls keep their continuation through settings navigation and return to their actual caller', () => {
 const { sample } = fixture(); const events = [click('original_page'), click('page_menu'), click('voices'), click('voices_return')];
 const menu = sample(events); assert.equal(menu.pageId, 'ui:preferences'); assert.equal(menu.variables.after, 0);
 const back = sample([...events, click('menu_return')]); assert.equal(back.pageId, 'waiting_page'); assert.equal(back.variables.after, 1); assert.deepEqual(back.waitingPages, ['waiting_page']);
 const done = sample([...events, click('menu_return'), click('close_button')]); assert.equal(done.pageId, 'ui:main'); assert.equal(done.variables.after, 2); assert.equal(done.incomplete, false);
});
test('confirmation inside a menu returns to that menu without closing its caller', () => {
 const { sample } = fixture(); const events = [click('open_menu'), click('menu_ask')];
 const accepted = sample([...events, click('yes')]); assert.equal(accepted.pageId, 'ui:preferences'); assert.equal(accepted.variables.after, 1);
 const returned = sample([...events, click('yes'), click('menu_return')]); assert.equal(returned.pageId, 'ui:main'); assert.equal(returned.variables.after, 2);
});

test('Escape and right-click in character settings return to preferences before ending the menu call', () => {
 const { sample } = fixture();
 for(const event of [{kind:'key',key:'K_ESCAPE'},{kind:'cancelPage',pageId:'ui:voiceSettings'}] as UiPreviewEvent[]){
  const events=[click('open_menu'),click('voices'),event], back=sample(events);
  assert.equal(back.pageId,'ui:preferences');assert.equal(back.variables.after,0);
  const end=sample([...events,{kind:'cancelPage',pageId:'ui:preferences'}]);assert.equal(end.pageId,'ui:main');assert.equal(end.variables.after,1);
 }
});
test('menus pause covered timers, retain preferences and resume the original timer schedule on return', () => {
 const { sample } = fixture(); const events: UiPreviewEvent[] = [{ kind: 'advance', seconds: .4 }, click('open_menu'), { kind: 'control', componentId: 'volume', value: .3 }, { kind: 'advance', seconds: 2 }];
 const menu = sample(events, true); assert.equal(menu.variables.base_ticks, 0); assert.equal(menu.variables.menu_ticks, 4);
 const back = sample([...events, click('menu_return'), { kind: 'advance', seconds: .6 }], true); assert.equal(back.variables.base_ticks, 1); assert.equal(back.variables.menu_ticks, 4); assert.equal(back.preferences.musicVolume, .3);
});
test('invalid menu names stop and static preview never skips a confirmation or menu wait', () => {
 const { project, menu, menuGraph, graph, sample } = fixture();
 for (const blueprint of [menuGraph, graph]) { const context = previewActionContext(project); expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: blueprint.id }], context); assert.equal(context.incomplete, true); assert.equal(context.variables.after, 0); }
 menu.properties.screen = 'missing'; const result = sample([click('open_menu')]); assert.equal(result.incomplete, true); assert.equal(result.variables.after, 0); assert.equal(result.pageId, 'ui:main');
});
