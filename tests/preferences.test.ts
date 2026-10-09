import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, effectiveUiComponents, projectSchema, uiComponentLimit, type UiComponent } from '../src/core/model';
import { playerPreferenceKeys, playerPreferenceOptions, playerPreferences, validPlayerPreference } from '../src/core/preferences';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { compileProject } from '../src/runtime/compiler';

test('player settings reject wrong types, non-finite numbers, out-of-range values and unsupported resolutions', () => {
  for (const key of playerPreferenceKeys) {
    assert.ok(validPlayerPreference(key, playerPreferences[key].initial), key);
    assert.ok(playerPreferenceOptions(key).every(option => validPlayerPreference(key, option.value)), key);
  }
  for (const value of [-0.1, 1.1, NaN, Infinity, '0.5', true]) assert.equal(validPlayerPreference('musicVolume', value), false);
  assert.equal(validPlayerPreference('fullscreen', 1), false);
  assert.equal(validPlayerPreference('windowSize', '1280x720'), true);
  assert.equal(validPlayerPreference('windowSize', '1280, 720'), false);
  assert.equal(validPlayerPreference('missing', 1), false);
});

test('multiple character controls and inherited skins preserve distinct targets and real setting types', () => {
  const project = createProject();
  project.characters = ['first', 'second'].map(id => ({ id, name: id, color: '#ffffff', expressions: [] }));
  project.assets = [{ id: 'track', name: '滑条图', kind: 'image', path: 'assets/track.png' }];
  project.playerDefaults = { voiceVolume: 0.5, characterVolume: 0.8, voiceSustain: false, windowSize: '960x540' };
  const control = (id: string, characterId: string): UiComponent => ({ id, page: 'voiceSettings', kind: 'preference', preference: 'characterVolume', preferenceCharacterId: characterId, text: '', x: 0.1, y: 0.2, width: 0.5, height: 0.1, slider: { trackId: 'track', thumb: { idle: 'track' }, showLabel: false } });
  project.ui.components = [control('first_volume', 'first'), control('second_volume', 'second')];
  project.ui.instances = [{ id: 'child', name: '派生设置页', components: [{ ...control('second_volume', 'second'), y: 0.5 }] }];
  project.ui.activeInstanceId = 'child';
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.playerDefaults, project.playerDefaults);
  assert.deepEqual(effectiveUiComponents(restored.ui).map(c => c.preferenceCharacterId), ['first', 'second']);
  assert.deepEqual(compileProject(restored).diagnostics.filter(d => d.severity === 'error'), []);
  assert.ok(uiComponentLimit > 128, 'a multi-page interface fits the same editor and persisted component limit');
});

test('broken slider/selector assets and character references are diagnosed before export', () => {
  const project = createProject();
  project.playerDefaults = { voiceVolume: 5 };
  project.ui.components = [{ id: 'broken', page: 'voiceSettings', kind: 'preference', preference: 'characterVolume', preferenceCharacterId: 'missing_character', text: '', x: 0, y: 0, width: 0.5, height: 0.1,
    slider: { trackId: 'missing_track', thumb: { pressed: 'missing_thumb' } } },
  { id: 'selector', page: 'preferences', kind: 'preferenceChoice', preference: 'windowSize', text: '', x: 0, y: 0.2, width: 0.5, height: 0.1,
    selector: { options: [{ label: '小窗口', value: '640x360' }], arrowId: 'missing_arrow' } }];
  const errors = compileProject(project).diagnostics.filter(d => d.severity === 'error');
  for (const token of ['初始设置', '配音角色', 'missing_track', 'missing_thumb', 'missing_arrow']) assert.ok(errors.some(d => d.message.includes(token)), token);
  project.ui.components[1].selector!.options[0].value = 'bad-size';
  assert.equal(projectSchema.safeParse(project).success, false);
});

test('preference nodes synchronize value types and optional character inputs without losing authored values', () => {
  const project = createProject();
  const graph = createBlueprintGraph('ui', '玩家设置');
  const write = blueprintNodeDefaults('setPlayerPreference'), read = blueprintNodeDefaults('getPlayerPreference');
  write.properties = { preference: 'fullscreen', value: false };
  read.properties.preference = 'characterVolume';
  graph.nodes.push(write, read); project.blueprints = [graph];
  connectBlueprintPins(graph, graph.nodes[0].id, 'exec', write.id, 'exec_in');
  synchronizeBlueprintSignatures(project);
  assert.equal(write.pins.find(pin => pin.id === 'value')?.dataType, 'boolean');
  assert.equal(write.properties.value, false);
  assert.equal(read.pins.find(pin => pin.id === 'characterId')?.dataType, 'character');
  assert.deepEqual(validateBlueprints(project).filter(d => d.severity === 'error'), []);
  read.properties.characterId = '';
  assert.deepEqual(validateBlueprints(project).filter(d => d.severity === 'error'), []);
  read.properties.characterId = 'unknown';
  assert.ok(validateBlueprints(project).some(d => d.nodeId === read.id && d.message.includes('角色')));
  read.properties.preference = 'windowSize';
  synchronizeBlueprintSignatures(project);
  assert.equal(read.pins.some(pin => pin.id === 'characterId'), false);
  assert.equal(read.pins.find(pin => pin.id === 'value')?.dataType, 'string');
});

test('a custom confirmation page requires a live prompt and both response actions', () => {
  const project = createProject();
  project.ui.pages = { messageBox: { layout: 'custom' } };
  const before = compileProject(project).diagnostics.filter(d => d.severity === 'error');
  assert.equal(before.filter(d => d.message.includes('自定义消息框')).length, 3);
  project.ui.components = [
    { id: 'prompt', kind: 'text', page: 'messageBox', binding: 'confirmation', text: '', x: 0.2, y: 0.3, width: 0.6, height: 0.2 },
    ...(['confirmYes', 'confirmNo'] as const).map((action, index): UiComponent => ({ id: `response_${index}`, kind: 'button', page: 'messageBox', text: action, action, x: 0.2 + index * 0.4, y: 0.6, width: 0.2, height: 0.1 })),
  ];
  assert.deepEqual(compileProject(project).diagnostics.filter(d => d.severity === 'error'), []);
  project.ui.components[1].page = 'main';
  assert.equal(projectSchema.safeParse(project).success, false);
});
