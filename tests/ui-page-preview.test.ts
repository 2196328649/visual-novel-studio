import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiPagePreviewFixture } from '../scripts/lib/ui-page-preview-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
function fixture() {
 const setup = createUiPagePreviewFixture(), { project } = setup;
 const sample = (events: UiPreviewEvent[], timed = false) => previewUiLogic(project, project.ui.components, 'ui:main', {}, events, { timed });
 return { ...setup, sample };
}

test('waiting page defers the continuation, returns the close result and preserves project state', () => {
 const { project, sample } = fixture(), before = structuredClone(project);
 const opened = sample([click('open_button')]);
 assert.equal(opened.pageId, 'waiting_page'); assert.equal(opened.variables.result, '尚未返回'); assert.equal(opened.variables.after, 0); assert.equal(opened.variables.opens, 1);
 assert.deepEqual(opened.waitingPages, ['waiting_page']); assert.equal(opened.incomplete, false); assert.equal(opened.layers[0].interactive, false);
 const closed = sample([click('open_button'), click('close_button')]);
 assert.equal(closed.pageId, 'ui:main'); assert.equal(closed.variables.result, '已确认'); assert.equal(closed.variables.after, 1); assert.equal(closed.incomplete, false);
 assert.deepEqual(closed.waitingPages, []); assert.deepEqual(project, before);
});

test('nested waiting pages resume their own caller; modal input blocks underlying clicks and keys', () => {
 const { sample } = fixture(); const events = [click('open_button'), click('base_button'), { kind: 'key', key: 'K_e' } as const, click('nested_button')];
 const nested = sample(events); assert.deepEqual(nested.waitingPages, ['waiting_page', 'nested_page']); assert.equal(nested.variables.base_clicks, 0);
 const blocked = sample([...events, click('close_button')]); assert.equal(blocked.pageId, 'nested_page'); assert.equal(blocked.variables.after, 0);
 const returned = sample([...events, click('nested_close')]); assert.equal(returned.pageId, 'waiting_page'); assert.equal(returned.variables.nested, '子页完成'); assert.equal(returned.variables.after, 0);
 const complete = sample([...events, click('nested_close'), click('close_button')]); assert.equal(complete.variables.after, 1); assert.equal(complete.incomplete, false);
});

test('page timers continue below a modal, stop on close and restart when reopened', () => {
 const { sample } = fixture(); const start = [click('open_button'), { kind: 'advance', seconds: 1 } as const];
 const first = sample(start, true); assert.equal(first.variables.base_ticks, 1); assert.equal(first.variables.page_ticks, 2);
 const left = [...start, click('close_button'), { kind: 'advance', seconds: 1 } as const];
 assert.equal(sample(left, true).variables.page_ticks, 2); assert.equal(sample(left, true).variables.base_ticks, 2);
 const back = sample([...left, click('open_button'), { kind: 'advance', seconds: .5 }], true); assert.equal(back.variables.page_ticks, 3); assert.equal(back.variables.opens, 2); assert.equal(back.incomplete, false);
});

test('escape and explicit cancellation return cancellation, while stale pages cannot close a different page', () => {
 const { sample, project } = fixture();
 for (const event of [{ kind: 'key', key: 'K_ESCAPE' }, { kind: 'cancelPage', pageId: 'waiting_page' }] as UiPreviewEvent[]) {
  const result = sample([click('open_button'), event]); assert.equal(result.variables.result, '取消'); assert.equal(result.variables.after, 1);
 }
 assert.equal(sample([click('open_button'), { kind: 'cancelPage', pageId: 'missing' }]).pageId, 'waiting_page');
 const page = project.ui.customPages[0];
 const direct = previewUiLogic(project, page.components, page.id, {}, [{ kind: 'cancelPage', pageId: page.id }]);
 assert.equal(direct.closed, true); assert.equal(direct.layers.length, 0);
});

test('nonwaiting pages continue immediately, permit lower input when nonmodal and do not duplicate initialization', () => {
 const { project, open, sample } = fixture(); open.properties.wait = false; project.ui.customPages[0].modal = false;
 const shown = sample([click('open_button')]); assert.equal(shown.variables.after, 1); assert.equal(shown.variables.result, ''); assert.deepEqual(shown.waitingPages, []); assert.equal(shown.layers[0].interactive, true);
 const repeated = sample([click('open_button'), click('open_button'), click('base_button'), { kind: 'key', key: 'K_e' }]);
 assert.equal(repeated.layers.length, 2); assert.equal(repeated.variables.opens, 1); assert.equal(repeated.variables.after, 2); assert.equal(repeated.variables.base_clicks, 2);
 const closed = sample([click('open_button'), click('close_button')]); assert.equal(closed.pageId, 'ui:main'); assert.equal(closed.variables.after, 1);
});

test('wait continuations retain function outputs and loop indices', () => {
 const { project, opener, open, add, addGraph, link, chain, sample } = fixture();
 opener.exposedOutputs = [{ id: 'returned', name: '结果', dataType: 'string', defaultValue: '', direction: 'output', required: false }];
 const output = add(opener, 'setOutput', { outputId: 'returned' });
 // Run this output after the existing chain by using the original open result.
 const last = opener.nodes.filter(n => n.type === 'setVariable').at(-1)!;
 chain(opener, last, output); link(opener, open, 'result', output, 'value');
 project.variables.push({ id: 'loop_index', name: '循环位置', type: 'number', initial: 0, persistent: false });
 const outer = addGraph('外层循环'), loop = add(outer, 'forLoop', { firstIndex: 1, lastIndex: 2 });
 const call = add(outer, 'callFunction', { graphId: opener.id }); call.pins.push({ id: 'out_returned', name: '结果', direction: 'output', dataType: 'string', required: false });
 const write = add(outer, 'setVariable', { variableId: 'nested' });
 chain(outer, outer.nodes[0], loop); link(outer, loop, 'loop_body', call, 'exec_in'); chain(outer, call, write); link(outer, call, 'out_returned', write, 'value');
 const index = add(outer, 'setVariable', { variableId: 'loop_index' }); chain(outer, write, index); link(outer, loop, 'index', index, 'value');
 project.ui.components.find(c => c.id === 'open_button')!.blueprintId = outer.id;
 const first = sample([click('open_button'), click('close_button')]); assert.equal(first.pageId, 'waiting_page'); assert.equal(first.variables.after, 1); assert.equal(first.variables.nested, '已确认'); assert.equal(first.variables.loop_index, 1);
 const second = sample([click('open_button'), click('close_button'), click('close_button')]); assert.equal(second.pageId, 'ui:main'); assert.equal(second.variables.after, 2); assert.equal(second.variables.loop_index, 2); assert.equal(second.incomplete, false);
});

test('closing event completes before the caller resumes; on-show close cannot lose its continuation', () => {
 const { project, closer, close, add, chain, sample } = fixture();
 chain(closer, close, add(closer, 'setVariable', { variableId: 'result', value: '关闭事件末尾' }));
 assert.equal(sample([click('open_button'), click('close_button')]).variables.result, '已确认');
 project.ui.customPages[0].onShowBlueprintId = closer.id;
 const immediate = sample([click('open_button')]); assert.equal(immediate.pageId, 'ui:main'); assert.equal(immediate.variables.result, '已确认'); assert.equal(immediate.variables.after, 1); assert.equal(immediate.incomplete, false);
});

test('static preview stops at waiting input and missing pages never execute the continuation', () => {
 const { project, opener, open, sample } = fixture(), context = previewActionContext(project);
 expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: opener.id }], context);
 assert.equal(context.incomplete, true); assert.equal(context.variables.after, 0); assert.equal(context.variables.result, '尚未返回');
 open.properties.pageId = 'deleted';
 const deleted = sample([click('open_button')]); assert.equal(deleted.variables.after, 0); assert.equal(deleted.incomplete, true); assert.equal(deleted.pageId, 'ui:main');
});

test('an event still waiting on a nonmodal page cannot reenter until its first invocation returns', () => {
 const { project, sample } = fixture(); project.ui.customPages[0].modal = false;
 const opened = sample([click('open_button'), click('open_button')]);
 assert.equal(opened.variables.after, 0); assert.equal(opened.variables.result, '尚未返回'); assert.equal(opened.variables.opens, 1);
 const closed = sample([click('open_button'), click('open_button'), click('close_button')]); assert.equal(closed.variables.after, 1);
 const reopened = sample([click('open_button'), click('close_button'), click('open_button')]); assert.equal(reopened.variables.opens, 2); assert.equal(reopened.variables.after, 1);
});
