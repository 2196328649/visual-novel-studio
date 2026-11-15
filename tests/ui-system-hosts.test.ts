import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type UiComponent } from '../src/core/model';
import { createCustomUiPage } from '../src/core/game-flow';
import { uiGameOverEnabled, uiPageHostScreens, uiPageOpenProblem, uiPages } from '../src/core/ui-pages';
import { compileProject } from '../src/runtime/compiler';
import { createUiRuntime } from '../src/runtime/ui-runtime';
import { uiSaveMigrationRuntime } from '../src/runtime/ui-save-migration-runtime';

const block = (source: string, name: string) => source.slice(source.indexOf('screen ' + name + '(')).split(/\n(?=screen |init |default |define |style )/)[0];
const control = (page: UiComponent['page']): UiComponent => ({ id: 'host_' + page.toLowerCase(), page, kind: 'text', text: page, x: .1, y: .1, width: .4, height: .1 });
test('every built-in page has an explicit native host, without making system templates free-openable', () => {
  const p = createProject(); assert.deepEqual(Object.keys(uiPageHostScreens).sort(), uiPages(p).filter(page => page.template).map(page => page.kind).sort());
  for (const page of ['main', 'say', 'choice', 'keyboard', 'chapterTitle', 'messageBox', 'gameOver']) assert.ok(uiPageOpenProblem(p, 'ui:' + page));
  for (const page of uiPages(p).filter(page => page.menuScreen)) { assert.equal(uiPageOpenProblem(p, page.id, true), undefined); assert.ok(uiPageOpenProblem(p, page.id, false)); }
});
test('default and custom confirmation/chapter layouts both attach authored controls and lifecycle exactly once', () => {
  for (const layout of ['native', 'custom'] as const) {
    const p = createProject(); p.ui.components = [control('messageBox'), control('chapterTitle'), control('keyboard')];
    if (layout === 'custom') {
      p.ui.components[0].binding = 'confirmation';
      for (const action of ['confirmYes', 'confirmNo'] as const) p.ui.components.push({ ...control('messageBox'), id: 'host_' + action.toLowerCase(), kind: 'button', action });
    }
    p.ui.pages = { messageBox: { layout }, chapterTitle: { layout } };
    const generated = compileProject(p); assert.deepEqual(generated.diagnostics.filter(row => row.severity === 'error'), []);
    const screens = generated.files['game/screens.rpy'];
    assert.equal(block(screens, 'confirm').split('use vn_components_messageBox(').length - 1, 1);
    assert.equal(block(screens, 'vn_chapter_title').split('use vn_components_chapterTitle(').length - 1, 1);
    assert.match(block(screens, 'input'), /input id "input"/); assert.match(block(screens, 'input'), /use vn_components_keyboard/);
    for (const page of ['messageBox', 'chapterTitle', 'keyboard']) assert.match(block(screens, 'vn_components_' + page), new RegExp('vn_ui_native_page_shown, "ui:' + page + '"'));
  }
});
test('the ending host is opt-in and respects effective inherited scheme and disabled pages', () => {
  const p = createProject(); assert.equal(uiGameOverEnabled(p), false); assert.doesNotMatch(compileProject(p).files['game/story.rpy'], /call screen vn_game_over/);
  p.ui.instances = [{ id: 'host_parent', name: '原方案', components: [control('gameOver')] }, { id: 'host_child', name: '派生方案', baseUiId: 'host_parent', components: [] }];
  assert.equal(uiGameOverEnabled(p), false); p.ui.activeInstanceId = 'host_child'; assert.equal(uiGameOverEnabled(p), true);
  assert.match(compileProject(p).files['game/story.rpy'], /call screen vn_game_over/);
  assert.match(createUiRuntime(p), /"ui:gameOver": \["vn_game_over"\]/);
  p.ui.disabledPages = ['gameOver']; assert.equal(uiGameOverEnabled(p), false); assert.doesNotMatch(compileProject(p).files['game/story.rpy'], /call screen vn_game_over/);
});
test('released waiting call identity is preserved without rendering a second page or looking up a reopened token', () => {
  const p = createProject(), page = createCustomUiPage(p, '历史页面'); const generated = compileProject(p);
  const runtime = Object.values(generated.files).join('\n');
  assert.ok(runtime.includes('call screen vn_custom_page_' + page.id + '(_vn_waiting=True)'));
  const wrapper = block(generated.files['game/screens.rpy'], 'vn_custom_page_' + page.id);
  assert.match(wrapper, /default _vn_wait_token = vn_ui_page_token/); assert.match(wrapper, /use vn_ui_page_wait/); assert.doesNotMatch(wrapper, /use vn_components_custom_/);
  assert.match(runtime, /Return\(dict\(vn_ui_page_completion\(token\), token=token\)\)/);
  assert.match(runtime, /_vn_page_token = _vn_page_completion.pop\("token"\)/);
});
test('save upgrade is explicit, preserves legacy recovery and is registered before after-load media readers', () => {
  assert.match(uiSaveMigrationRuntime, /default vn_ui_page_schema = 0/); assert.match(uiSaveMigrationRuntime, /version not in \(0, 1\)/);
  assert.match(uiSaveMigrationRuntime, /recovery\["legacy0"\]/); assert.match(uiSaveMigrationRuntime, /didShow=True/);
  assert.match(uiSaveMigrationRuntime, /migrating=True/); assert.match(uiSaveMigrationRuntime, /config.interact_callbacks.insert\(0, vn_ui_upgrade_saved_pages\)/);
  const runtime = createUiRuntime(createProject());
  assert.ok(runtime.lastIndexOf('config.after_load_callbacks.insert(0, vn_ui_upgrade_saved_pages)') > runtime.lastIndexOf('config.after_load_callbacks.insert(0, vn_ui_images_after_load)'));
});
