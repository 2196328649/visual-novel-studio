import test from 'node:test';
import assert from 'node:assert/strict';
import { createLegacyMinigameLifecycleFixture } from '../scripts/lib/legacy-minigame-lifecycle-fixture';
import { compileProject } from '../src/runtime/compiler';
import { uiPageRuntime } from '../src/runtime/ui-page-runtime';
import { blueprintTaskRuntime } from '../src/runtime/blueprint-task-runtime';

function generated() {
  const { project } = createLegacyMinigameLifecycleFixture(), before = structuredClone(project);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.deepEqual(project, before);
  return Object.values(compiled.files).join('\n');
}

test('legacy page lifecycle fixture compiles without mutating authored pages or script definitions', () => {
  const runtime = generated();
  assert.match(runtime, /call legacy_lifecycle_script|call expression "legacy_lifecycle_script"/);
  assert.match(runtime, /call screen vn_minigame_password/);
  assert.match(runtime, /call screen vn_minigame_timed_clicks/);
});

test('minigame completion and normal return both emit page resource release and owner pruning', () => {
  const runtime = generated();
  assert.match(runtime, /def vn_finish_minigame\(result\):[\s\S]*?vn_minigame_finished = result[\s\S]*?vn_ui_page_release\(page_id\)[\s\S]*?vn_bp_prune_task_resources\(\)/);
  assert.match(runtime, /def vn_minigame_close\(\):[\s\S]*?vn_minigame_context = \{\}[\s\S]*?vn_ui_page_release\(page_id\)[\s\S]*?vn_bp_prune_task_resources\(\)/);
  assert.match(runtime, /if vn_minigame_finished is not None:\n            return vn_minigame_finished/);
});

test('page children use a common task owner, including legacy initializer calls', () => {
  assert.match(uiPageRuntime, /owner_task = vn_bp_task or vn_bp_task_create\(\)/);
  assert.match(uiPageRuntime, /parentTask=owner_task if owner_task\.get\("page"\) and settings\["lifetime"\] == "owner" else None/);
  assert.match(uiPageRuntime, /def vn_ui_page_tasks_prune\(\):[\s\S]*?not vn_bp_task_alive\(parent_task\)[\s\S]*?vn_ui_close_page\(page_id, "", "parentClosed"\)/);
  assert.match(blueprintTaskRuntime, /if page_id is None and vn_minigame_finished is None:/);
  assert.match(blueprintTaskRuntime, /vn_ui_native_pages_prune\(\)\n        vn_ui_control_prune_popup\(\)\n        vn_ui_page_tasks_prune\(\)/);
});

test('an unrelated hidden page cannot edit or cancel an active minigame', () => {
  const runtime = generated();
  assert.match(runtime, /page not in vn_ui_open_pages and \(not vn_minigame_owns_page\(page\) or renpy\.get_screen\("vn_minigame_custom"\) is None\)/);
  assert.match(uiPageRuntime, /elif vn_minigame_owns_page\(page_id\):\n            vn_finish_minigame\("cancel"\)/);
});

test('synchronous callbacks restore focus only within an unchanged live page instance', () => {
  const runtime = generated();
  assert.match(runtime, /focus = vn_ui_focus_snapshot\(\)/);
  assert.match(runtime, /if vn_bp_task_alive\(task\):\n            vn_ui_restore_focus\(focus\)/);
  assert.match(runtime, /renpy.get_screen\(screen.screen_name\[0\]\) is not screen or vn_input_page_state\(\) != state/);
  assert.match(runtime, /tuple\(\(page, vn_ui_page_token\(page\)\) for page in vn_ui_page_order\) != pages/);
  assert.match(runtime, /isinstance\(focused, VnSkinButton\) and not focused.vn_available\(\)/);
});
