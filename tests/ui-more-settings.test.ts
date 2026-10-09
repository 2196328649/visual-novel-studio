import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveUiComponents, sortUiComponents } from '../src/core/model';
import { nativeParameterSettingsPage, nativePreferencePreview } from '../src/core/ui-native-preview';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { uiMoreSettingsFixture } from '../scripts/lib/ui-more-settings-fixture';

test('more settings keeps typed test values and resumes a blueprint only after returning from settings', () => {
  for (const mode of ['custom', 'replaced'] as const) {
    const project = uiMoreSettingsFixture(mode), before = structuredClone(project), events: UiPreviewEvent[] = [{ kind: 'click', componentId: 'open_wait' }];
    const sample = () => previewUiLogic(project, project.ui.components.filter(c => c.page === 'main'), 'ui:main', {}, events);
    const id = (text: string) => sample().components.find(c => c.component.text === text)!.component.id;
    const click = (text: string) => events.push({ kind: 'click', componentId: id(text) });
    click('更多设置'); assert.equal(sample().pageId, nativeParameterSettingsPage); assert.equal(sample().variables.story, 3);
    assert.deepEqual(sample().components.flatMap(c => c.component.parameterId ? [c.component.parameterId] : []), ['custom', 'enabled', 'language', 'nickname', 'bottom']);
    for (const [name, value] of [['字幕字号', 44], ['显示提示', false], ['字幕语言', 'English'], ['称呼', 'Guest']] as const) {
      const row = sample().components.find(c => c.component.text === name && c.component.kind === 'preference')!;
      events.push({ kind: 'control', componentId: row.component.id, value });
    }
    assert.equal(sample().variables.language, 'English'); assert.equal(sample().variables.nickname, 'Guest'); assert.equal(sample().variables.enabled, false);
    events.push({ kind: 'key', key: 'K_ESCAPE' }); assert.equal(sample().pageId, 'ui:preferences'); assert.equal(sample().variables.story, 3);
    click('更多设置'); assert.equal(sample().variables.custom, 44); click('返回设置'); assert.equal(sample().pageId, 'ui:preferences');
    click('完成设置'); assert.equal(sample().pageId, 'ui:main'); assert.equal(sample().variables.story, 9); assert.equal(sample().incomplete, false); assert.deepEqual(project, before);
  }
});

test('more settings follows active scheme and draft placement, stays above authored panels and hides when empty', () => {
  const project = uiMoreSettingsFixture('replaced'), authored = effectiveUiComponents(project.ui).filter(c => c.page === 'preferences');
  let layout = nativePreferencePreview(project, 'ui:preferences', authored)!;
  assert.equal(layout.bodyIds.length, 0); assert.equal(sortUiComponents([...layout.components, ...authored]).at(-1)!.id, layout.moreSettingsId);
  // A real component whose ID resembles the temporary shortcut must retain its identity.
  authored.push({ ...authored[0], id: layout.moreSettingsId! });
  layout = nativePreferencePreview(project, 'ui:preferences', authored)!; assert.notEqual(layout.moreSettingsId, authored.at(-1)!.id);
  project.ui.instances = [{ id: 'scheme', name: '设置方案', components: [{ id: 'scheme_placed', kind: 'preference', page: 'preferences', text: '', parameterId: 'custom', x: 0, y: 0, width: .2, height: .1 }], pages: { preferences: { layout: 'custom' } } }];
  project.ui.activeInstanceId = 'scheme';
  const more = nativePreferencePreview(project, nativeParameterSettingsPage, [])!;
  assert.equal(more.components.some(c => c.parameterId === 'custom'), false);
  assert.equal(more.components.some(c => c.parameterId === 'placed'), false); // The scheme inherits the base control.
  for (const variable of project.variables) if (variable.parameterSetId === 'parameters_game') variable.setting = { ...variable.setting, visible: false };
  assert.equal(nativePreferencePreview(project, 'ui:preferences', []), undefined);
  // Initial-page components can be a UI draft and must determine which settings are unplaced.
  project.variables.find(v => v.id === 'custom')!.setting!.visible = true;
  const draft = effectiveUiComponents(project.ui), events: UiPreviewEvent[] = [];
  assert.equal(previewUiLogic(project, draft, 'ui:preferences', {}, events).components.some(c => c.component.text === '更多设置'), false);
});
