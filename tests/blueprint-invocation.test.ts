import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueprintInvocationFixture } from '../scripts/lib/blueprint-invocation-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';
import { blueprintInvocationDefaults, blueprintInvocationRuntime } from '../src/runtime/blueprint-invocation-runtime';

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const advance = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
function fixture() {
  const f = createBlueprintInvocationFixture(), before = structuredClone(f.project);
  const sample = (events: UiPreviewEvent[]) => {
    const state = previewUiLogic(f.project, f.root.components, f.root.id, {}, events, { timed: true });
    assert.deepEqual(f.project, before); return state;
  };
  return { ...f, sample };
}

for (const kind of ['snapshot', 'cache', 'loop']) {
  test('preview isolates overlapping module ' + kind + ' invocations', () => {
    const f = fixture(), events = [click('invoke_' + kind + '_a'), advance(.1), click('invoke_' + kind + '_b')];
    const middle = f.sample(events);
    assert.equal(middle.variables.done_a, 0); assert.equal(middle.variables.done_b, 1);
    assert.equal(middle.variables[kind + '_b'], kind === 'loop' ? 1 : 22);
    const final = f.sample([...events, advance(1.2)]);
    assert.equal(final.variables[kind + '_a'], kind === 'loop' ? 6 : 11);
    assert.equal(final.variables.done_a, 1); assert.equal(final.variables.ready, 2);
    assert.equal(final.incomplete, false);
  });
}

test('preview keeps each module page result until that invocation resumes', () => {
  const f = fixture();
  const state = f.sample([click('invoke_page_a'), click(f.childA.components[1].id), advance(.1), click('invoke_page_b'), click(f.childB.components[1].id), advance(1)]);
  assert.equal(state.variables.page_a, 'A'); assert.equal(state.variables.page_b, 'B');
  assert.equal(state.variables.done_a, 1); assert.equal(state.variables.done_b, 1);
  assert.equal(state.incomplete, false);
});

test('compilation scopes generated execution slots while preserving legacy result mirrors', () => {
  const f = fixture(), before = structuredClone(f.project), result = compileProject(f.project);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  assert.deepEqual(f.project, before);
  const script = Object.values(result.files).join('\n');
  assert.ok(script.includes('renpy.dynamic("vn_bp_frame")'));
  assert.ok(script.includes('vn_bp_capture_local('));
  assert.ok(script.includes('vn_bp_local("vn_bp_result_'));
  assert.ok(script.includes('vn_bp_local("vn_bp_index_'));
  assert.ok(script.includes('vn_bp_local("vn_bp_page_result_'));
  assert.ok(script.includes('$ vn_bp_publish_frame()'));
  assert.ok(script.includes('default vn_bp_out_' + f.snapshot.id + '_value = 0'));
  assert.ok(script.includes('default vn_bp_result_'));
});

test('invocation defaults never localize project variables or player preferences', () => {
  const f = fixture(), byId = new Map(f.project.blueprints.map(g => [g.id, g]));
  const values = blueprintInvocationDefaults(f.cache, byId);
  assert.ok(Object.keys(values).some(key => key.startsWith('vn_bp_out_')));
  assert.ok(Object.keys(values).some(key => key.startsWith('vn_bp_result_')));
  assert.ok(Object.keys(values).every(key => /^vn_bp_(out|result|page_result|page_reason)_/.test(key)));
});

test('new invocation frames never read stale global slots while old unframed saves can continue', () => {
  assert.match(blueprintInvocationRuntime, /if vn_bp_frame is None:\n            return getattr\(renpy.store, name, fallback\)/);
  assert.ok(blueprintInvocationRuntime.includes('return vn_bp_frame.get("values", {}).get(name, fallback)'));
});

test('waits establish a soft save boundary after pre-wait side effects', () => {
  const f = fixture(), script = compileProject(f.project).files['game/story.rpy'];
  const label = script.split('label vn_blueprint_' + f.cache.id + '(')[1].split('\nlabel ')[0];
  const increment = label.indexOf('$ vn_parameter_set("ready", (vn_var_ready + 1), False)');
  const boundary = label.indexOf('$ renpy.checkpoint(hard=False)', increment);
  const wait = label.indexOf('$ vn_bp_pause(', boundary);
  assert.ok(increment >= 0 && boundary > increment && wait > boundary);
});
