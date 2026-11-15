import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveUiComponents, type UiComponent } from '../src/core/model';
import { nativePreferencePreview } from '../src/core/ui-native-preview';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';
import { addResetValidationControl, placeParameterControls, uiMoreSettingsFixture } from '../scripts/lib/ui-more-settings-fixture';

test('variables never add settings rows or a more-settings menu in standard and authored layouts', () => {
  for (const mode of ['standard', 'custom', 'replaced'] as const) {
    const project = uiMoreSettingsFixture(mode === 'replaced' ? 'replaced' : 'custom');
    if (mode === 'standard') delete project.ui.pages?.preferences;
    const before = structuredClone(project), authored = project.ui.components.filter(c => c.page === 'preferences');
    const layout = nativePreferencePreview(project, 'ui:preferences', authored);
    assert.equal(layout?.components.some(c => c.parameterId), mode === 'custom' ? undefined : false);
    assert.equal(layout?.components.some(c => c.text === '更多设置'), mode === 'custom' ? undefined : false);
    if (mode === 'custom') assert.equal(layout, undefined);
    if (mode === 'replaced') assert.deepEqual(layout?.bodyIds, []);
    if (mode === 'standard') assert.ok(layout?.components.some(c => c.preference === 'musicVolume'));
    const result = previewUiLogic(project, authored, 'ui:preferences');
    assert.deepEqual(result.components.flatMap(row => row.component.parameterId ? [row.component.parameterId] : []), ['placed']);
    assert.equal(result.components.some(row => row.component.text === '更多设置'), false);
    const compiled = compileProject(project);
    assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
    assert.doesNotMatch(compiled.files['game/screens.rpy'], /textbutton "更多设置"|use vn_parameter_settings\(|vn_parameter_unplaced/);
    assert.doesNotMatch(compiled.files['game/00-vn-parameters.rpy'], /vn_parameter_groups|screen vn_parameter_settings\(/);
    assert.deepEqual(project, before);
  }
});

test('explicit parameter controls keep typed values and a blueprint waits until the settings page closes', () => {
  for (const mode of ['custom', 'replaced'] as const) {
    const project = uiMoreSettingsFixture(mode); placeParameterControls(project);
    const before = structuredClone(project), events: UiPreviewEvent[] = [{ kind: 'click', componentId: 'open_wait' }];
    const sample = () => previewUiLogic(project, project.ui.components.filter(c => c.page === 'main'), 'ui:main', {}, events);
    assert.equal(sample().pageId, 'ui:preferences'); assert.equal(sample().variables.story, 3);
    assert.equal(sample().components.some(row => row.component.parameterId === 'hidden'), false);
    for (const [id, value] of [['custom', 44], ['enabled', false], ['language', 'English'], ['nickname', 'Guest'], ['bottom', 18], ['placed', false]] as const) {
      events.push({ kind: 'control', componentId: id + '_control', value });
    }
    assert.equal(sample().variables.language, 'English'); assert.equal(sample().variables.nickname, 'Guest'); assert.equal(sample().variables.enabled, false);
    assert.equal(sample().variables.bottom, 18); assert.equal(sample().variables.placed, false); assert.equal(sample().variables.story, 3);
    events.push({ kind: 'click', componentId: 'settings_back' }); assert.equal(sample().pageId, 'ui:main'); assert.equal(sample().variables.story, 9);
    events.push({ kind: 'click', componentId: 'open_wait' }); assert.equal(sample().variables.custom, 44); assert.equal(sample().variables.nickname, 'Guest');
    events.push({ kind: 'key', key: 'K_ESCAPE' }); assert.equal(sample().pageId, 'ui:main'); assert.equal(sample().incomplete, false); assert.deepEqual(project, before);
  }
});

test('reset uses each variable choice, including blueprint-only data and legacy settings without adding controls', () => {
  const project = uiMoreSettingsFixture('custom');
  project.variables.find(variable => variable.id === 'custom')!.resetWithSettings = false;
  project.variables.find(variable => variable.id === 'story')!.resetWithSettings = true;
  project.variables.push({ id: 'blueprint_only', name: '蓝图内部计数', type: 'number', initial: 7, persistent: false, resetWithSettings: true });
  const before = structuredClone(project), events: UiPreviewEvent[] = [
    { kind: 'parameter', id: 'custom', value: 44 }, { kind: 'parameter', id: 'story', value: 8 },
    { kind: 'parameter', id: 'hidden', value: false }, { kind: 'parameter', id: 'blueprint_only', value: 19 },
  ];
  const sample = () => previewUiLogic(project, project.ui.components.filter(c => c.page === 'preferences'), 'ui:preferences', {}, events);
  events.push({ kind: 'click', componentId: 'settings_reset' });
  const stale = sample().layers.at(-1)!.instance;
  events.push({ kind: 'key', key: 'K_ESCAPE' }); assert.equal(sample().variables.blueprint_only, 19); assert.equal(sample().variables.hidden, false);
  events.push({ kind: 'click', componentId: 'settings_reset' }); const request = sample().layers.at(-1)!.instance;
  events.push({ kind: 'confirm', requestId: stale, value: true }); assert.equal(sample().variables.blueprint_only, 19);
  events.push({ kind: 'confirm', requestId: request, value: true });
  const result = sample();
  assert.equal(result.variables.custom, 44); assert.equal(result.variables.story, 3); assert.equal(result.variables.hidden, true); assert.equal(result.variables.blueprint_only, 7);
  assert.equal(result.components.some(row => row.component.parameterId === 'blueprint_only' || row.component.parameterId === 'hidden'), false);
  assert.equal(result.incomplete, false); assert.deepEqual(project, before);
});

test('explicit controls follow active schemes and UI drafts even for a legacy hidden parameter', () => {
  const project = uiMoreSettingsFixture('replaced');
  project.ui.instances = [{ id: 'scheme', name: '设置方案', components: [{ id: 'scheme_placed', kind: 'preference', page: 'preferences', text: '', parameterId: 'custom', x: 0, y: 0, width: .2, height: .1 }], pages: { preferences: { layout: 'custom' } } }];
  project.ui.activeInstanceId = 'scheme';
  const authored = effectiveUiComponents(project.ui).filter(component => component.page === 'preferences');
  assert.equal(nativePreferencePreview(project, 'ui:preferences', authored), undefined);
  const draft: UiComponent[] = [...authored.filter(component => component.id !== 'scheme_placed'),
    { id: 'draft_hidden', kind: 'preference', page: 'preferences', text: '蓝图开关', parameterId: 'hidden', x: .1, y: .4, width: .3, height: .1 }];
  const before = structuredClone(project);
  const result = previewUiLogic(project, draft, 'ui:preferences', {}, [{ kind: 'control', componentId: 'draft_hidden', value: false }]);
  assert.equal(result.components.some(row => row.component.id === 'scheme_placed'), false);
  assert.equal(result.components.some(row => row.component.id === 'draft_hidden'), true);
  assert.equal(result.components.some(row => row.component.text === '更多设置'), false);
  assert.equal(result.variables.hidden, false); assert.equal(result.incomplete, false); assert.deepEqual(project, before);
});

test('a dynamic control rejecting reset leaves all variables and built-in preferences unchanged', () => {
  const project = uiMoreSettingsFixture('custom'); addResetValidationControl(project);
  project.ui.components.push(
    { id: 'music', kind: 'preference', page: 'preferences', text: '音乐', preference: 'musicVolume', x: .5, y: .15, width: .3, height: .1 },
    { id: 'mute', kind: 'button', page: 'preferences', text: '静音', action: 'mute', x: .5, y: .25, width: .3, height: .08 },
  );
  const events: UiPreviewEvent[] = [
    { kind: 'parameter', id: 'reset_minimum', value: 10 }, { kind: 'parameter', id: 'custom', value: 44 },
    { kind: 'parameter', id: 'hidden', value: false }, { kind: 'parameter', id: 'story', value: 8 },
    { kind: 'click', componentId: 'narrow_range' }, { kind: 'control', componentId: 'music', value: .2 }, { kind: 'click', componentId: 'mute' },
  ];
  const sample = () => previewUiLogic(project, project.ui.components.filter(c => c.page === 'preferences'), 'ui:preferences', {}, events);
  const before = sample(); assert.equal(before.incomplete, false);
  assert.equal(before.components.find(row => row.component.id === 'reset_range')?.component.controlRange?.max, 20);
  events.push({ kind: 'click', componentId: 'settings_reset' }); const request = sample().layers.at(-1)!.instance;
  events.push({ kind: 'confirm', requestId: request, value: true }); const failed = sample();
  assert.equal(failed.incomplete, true); assert.deepEqual(failed.variables, before.variables); assert.deepEqual(failed.preferences, before.preferences);
  assert.equal(failed.muted, true); assert.equal(failed.variables.reset_minimum, 10); assert.equal(failed.preferences.musicVolume, .2);
  const compiled = compileProject(project); assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  const runtime = compiled.files['game/00-vn-preferences.rpy'];
  const reset = runtime.match(/    def vn_reset_preferences\(\):\n([\s\S]*?)(?=\n    def |\ninit |$)/)?.[1]; assert.ok(reset);
  const prepareIndex = reset.indexOf('parameter_reset = vn_parameter_prepare_settings_reset()'), firstMutation = reset.indexOf('for mixer in vn_preference_mixers.values():');
  assert.ok(prepareIndex >= 0 && firstMutation > prepareIndex);
  assert.match(reset, /vn_parameter_reset_settings\(refresh=False, _prepared=parameter_reset\)/);
});
