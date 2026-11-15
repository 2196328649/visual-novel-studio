import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativePageLifecycleFixture } from '../scripts/lib/native-page-lifecycle-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const advance = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
function fixture() {
  const f = createNativePageLifecycleFixture();
  const before = structuredClone(f.project);
  const sample = (events: UiPreviewEvent[]) => {
    const result = previewUiLogic(f.project, f.project.ui.components.filter(c => c.page === 'preferences'), 'ui:preferences', {}, events, { timed: true });
    assert.deepEqual(f.project, before); return result;
  };
  assert.deepEqual(compileProject(f.project).diagnostics.filter(d => d.severity === 'error'), []);
  return { ...f, sample };
}

test('native menu replacement cancels source waits immediately, not at the old deadline', () => {
  const f = fixture(), state = f.sample([click('native_delay'), advance(.2), click('native_gallery')]);
  assert.equal(state.pageId, 'ui:gallery');
  assert.equal(state.variables.after_wait, 0);
  assert.equal(state.stageWaiting, 0);
  assert.equal(state.incomplete, false);
  const later = f.sample([click('native_delay'), advance(.2), click('native_gallery'), advance(3)]);
  assert.equal(later.variables.after_wait, 0);
});

test('native menu replacement releases overrides and animations before reopening the same layout', () => {
  const f = fixture();
  const animated = f.sample([click('native_animate'), advance(.2)]);
  assert.ok(animated.components.find(c => c.component.id === 'native_target')!.component.style!.opacity! < 1);
  const state = f.sample([click('native_animate'), advance(.2), click('native_gallery'), click('native_back'), advance(9)]);
  assert.equal(state.pageId, 'ui:preferences');
  assert.equal(state.variables.preference_shows, 2);
  assert.equal(state.variables.gallery_shows, 1);
  assert.equal(state.components.find(c => c.component.id === 'native_target')?.component.style?.opacity, 1);
  assert.equal(state.incomplete, false);
});

test('replacing an owning native menu closes its modeless child with parentClosed', () => {
  const f = fixture(), state = f.sample([click('native_child'), click('native_gallery')]);
  assert.equal(state.pageId, 'ui:gallery');
  assert.equal(state.layers.some(layer => layer.pageId === f.child.id), false);
  assert.deepEqual(state.pageResults.filter(result => result.pageId === f.child.id).map(result => result.reason), ['parentClosed']);
  assert.equal(state.stageWaiting, 0);
});


test('replacing native menus preserves exactly one surviving external continuation', () => {
  const f = createNativePageLifecycleFixture(), main = f.project.ui.components.filter(c => c.page === 'main');
  const events: UiPreviewEvent[] = [click('native_external'), click('native_gallery'), click('native_back')];
  const before = previewUiLogic(f.project, main, 'ui:main', {}, events, { timed: true });
  assert.equal(before.variables.external_after, 0);
  assert.deepEqual(before.waitingPages, ['ui:preferences']);
  const after = previewUiLogic(f.project, main, 'ui:main', {}, [...events, click('native_return')], { timed: true });
  assert.equal(after.pageId, 'ui:main');
  assert.equal(after.variables.external_after, 1);
  assert.deepEqual(after.waitingPages, []);
  assert.equal(after.stageWaiting, 0);
});

test('return and Escape cancel native page work without executing delayed side effects', () => {
  const f = fixture();
  for (const leave of [click('native_return'), { kind: 'key', key: 'K_ESCAPE' } as UiPreviewEvent]) {
    const events = [click('native_delay'), advance(.2), leave];
    const state = f.sample(events);
    assert.equal(state.pageId, 'ui:main');
    assert.equal(state.stageWaiting, 0);
    assert.equal(f.sample([...events, advance(3)]).variables.after_wait, 0);
  }
});


test('an OnShow wait is cancelled by Return without replaying the hidden page', () => {
  const f = createNativePageLifecycleFixture(), say = f.project.ui.components.filter(c => c.page === 'say');
  const events = [click('native_show_wait'), advance(.2)];
  const pending = previewUiLogic(f.project, say, 'ui:say', {}, events, { timed: true });
  assert.equal(pending.stageWaiting, 1); assert.equal(pending.variables.waiting, 1);
  const after = previewUiLogic(f.project, say, 'ui:say', {}, [...events, click('native_return'), advance(3)], { timed: true });
  assert.equal(after.pageId, 'ui:say'); assert.equal(after.stageWaiting, 0);
  assert.equal(after.variables.after_wait, 0); assert.equal(after.variables.preference_shows, 1);
});


test('native navigation and page action wrappers keep held buttons stable across redraws', () => {
  const { project } = createNativePageLifecycleFixture();
  const generated = Object.values(compileProject(project).files).join('\n');
  assert.match(generated, /class VnUiNavigate\(Action, DictEquality\):/);
  assert.match(generated, /class VnUiActions\(Action, DictEquality\):/);
});

test('native layout and open-state queries do not create replacement sessions during teardown', () => {
  const { project } = createNativePageLifecycleFixture();
  const generated = Object.values(compileProject(project).files).join('\n');
  const currentMenu = generated.slice(generated.indexOf('    def vn_ui_native_current_menu():'), generated.indexOf('    def vn_ui_defer_native_navigation('));
  assert.match(currentMenu, /vn_ui_native_page_scope\(page_id, create=False\)/);
  assert.match(generated, /def vn_ui_native_page_is_open\(page_id\):\s+return vn_ui_native_page_alive\(vn_ui_native_page_scope\(page_id, create=False\)\)/);
});
