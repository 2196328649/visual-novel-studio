import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type Project, type UiComponent } from '../src/core/model';
import { formatNumber, playerPreferenceKeys, playerPreferenceOptions, playerPreferences, preferenceInfo, preferenceInRange, preferenceRangeProblem, validPlayerPreference } from '../src/core/preferences';
import { parameterDisplayValue } from '../src/core/parameter-sets';
import { uiControlDefinition, uiControlFromRatio, uiControlRatio } from '../src/core/ui-control-properties';
import { nativePreferencePreview } from '../src/core/ui-native-preview';
import { validateProject } from '../src/core/validate';
import { compileProject } from '../src/runtime/compiler';

const speed: UiComponent = { id: 'speed', kind: 'preference', page: 'preferences', text: '', preference: 'textSpeed', x: 0, y: 0, width: 1, height: .1 };

test('without adjustments every built-in setting behaves as before', () => {
  const p = createProject();
  for (const key of playerPreferenceKeys) {
    const info = preferenceInfo(p, key), base = playerPreferences[key];
    assert.equal(info.name, base.name); assert.equal(info.initial, base.initial); assert.equal(info.visible, true);
    if (base.type === 'number') { assert.equal(info.min, base.min); assert.equal(info.max, base.max); assert.equal(info.step, base.step); }
  }
  assert.deepEqual([preferenceInfo(p, 'textSpeed').max, preferenceInfo(p, 'autoForwardTime').step, preferenceInfo(p, 'musicVolume').step], [200, .3, .01]);
  assert.ok(projectSchema.safeParse(p).success);
});

test('authors change name, range, visibility and initial value; other settings stay', () => {
  const p = createProject();
  p.playerDefaults = { textSpeed: 300 };
  p.playerPreferenceSettings = { textSpeed: { name: '打字速度', min: 10, max: 500, step: 10, unit: 'cps' }, ambientVolume: { visible: false } };
  const info = preferenceInfo(p, 'textSpeed');
  assert.deepEqual([info.name, info.min, info.max, info.step, info.unit, info.initial], ['打字速度', 10, 500, 10, 'cps', 300]);
  assert.equal(preferenceInfo(p, 'ambientVolume').visible, false);
  assert.equal(preferenceInfo(p, 'musicVolume').max, 1);
  assert.ok(projectSchema.safeParse(p).success);
  // Sliders and player choices read the same range.
  const control = uiControlDefinition(p, speed)!;
  assert.deepEqual(control.range, { min: 10, max: 500, step: 10 });
  assert.equal(uiControlRatio(control, 255), .5);
  assert.equal(uiControlFromRatio(control, 1), 500);
  assert.deepEqual(playerPreferenceOptions('textSpeed', p).map(option => option.label), ['10 cps', '300 cps', '500 cps']);
});

test('only values the engine cannot use are refused', () => {
  assert.equal(preferenceRangeProblem('textSpeed', { min: 0, max: 5000, step: 1 }), undefined);
  assert.ok(preferenceRangeProblem('textSpeed', { min: -1, max: 100, step: 1 }));
  assert.ok(preferenceRangeProblem('textSpeed', { min: 50, max: 50, step: 1 }));
  assert.ok(preferenceRangeProblem('textSpeed', { min: 0, max: 100, step: 0 }));
  assert.ok(preferenceRangeProblem('musicVolume', { min: 0, max: 1.5, step: .1 })?.includes('100%'));
  assert.equal(preferenceRangeProblem('musicVolume', { min: .2, max: .8, step: .1 }), undefined);
  // Scripts may set anything the engine accepts, even past the player's slider.
  assert.ok(validPlayerPreference('textSpeed', 900)); assert.ok(!validPlayerPreference('textSpeed', -1));
  assert.ok(!validPlayerPreference('musicVolume', 1.5));
});

test('a broken range falls back to the default and warns instead of blocking the game', () => {
  const p = createProject();
  p.playerPreferenceSettings = { musicVolume: { min: .5, max: 3 } };
  assert.equal(preferenceInfo(p, 'musicVolume').max, 1);
  const warning = validateProject(p).find(item => item.message.includes('音乐音量'));
  assert.equal(warning?.severity, 'warning');
  p.playerPreferenceSettings = { textSpeed: { min: 50, max: 100 } }; p.playerDefaults = { textSpeed: 10 };
  const outside = validateProject(p).find(item => item.message.includes('初始值'));
  assert.equal(outside?.severity, 'warning');
  assert.ok(!preferenceInRange(preferenceInfo(p, 'textSpeed'), 10));
  // Instant text only exists on a range that starts at zero.
  assert.ok(preferenceInRange(preferenceInfo(createProject(), 'textSpeed'), 0));
  assert.ok(!preferenceInRange(preferenceInfo(p, 'textSpeed'), 0));
});

function compiled(p: Project) { const built = compileProject(p); assert.deepEqual(built.diagnostics.filter(d => d.severity === 'error'), []); return built.files; }

test('the game menu follows names and visibility and carries the authored range', () => {
  const p = createProject();
  p.playerPreferenceSettings = { textSpeed: { name: '打字速度', max: 500 }, ambientVolume: { visible: false }, fullscreen: { visible: false }, skipAll: { visible: false }, windowSize: { visible: false }, characterVolume: { visible: false } };
  const files = compiled(p), screens = files['game/screens.rpy'], runtime = files['game/00-vn-preferences.rpy'];
  assert.ok(screens.includes('label "打字速度"') && !screens.includes('label "文字速度"'));
  assert.ok(!screens.includes('VnPreferenceValue("ambientVolume")'));
  assert.ok(screens.includes('VnPreferenceValue("musicVolume")'));
  assert.ok(!screens.includes('label "显示"') && !screens.includes('label "跳过范围"') && !screens.includes('label "窗口大小"') && !screens.includes('textbutton "角色音量"'));
  assert.ok(screens.includes('label "语音停止方式"'));
  assert.ok(runtime.includes('"name": "打字速度"') && runtime.includes('"max": 500'));
  assert.ok(runtime.includes('config.start_callbacks.append(vn_fit_preferences)'));
  // The editor's preview of that menu matches.
  const preview = nativePreferencePreview(p, 'ui:preferences', [])!;
  const texts = preview.components.map(component => component.text);
  assert.ok(texts.includes('打字速度') && !texts.includes('文字速度') && !texts.includes('环境音量') && !texts.includes('显示') && !texts.includes('跳过范围') && !texts.includes('窗口大小'));
});

test('a plain project compiles to the same settings menu', () => {
  const screens = compiled(createProject())['game/screens.rpy'];
  for (const text of ['label "显示"', 'label "文字速度"', 'label "跳过范围"', 'label "环境音量"', 'textbutton "角色音量"', 'label "窗口大小"']) assert.ok(screens.includes(text), text);
});

test('numbers read with their display format', () => {
  assert.equal(formatNumber(.35, { display: 'percent' }), '35%');
  assert.equal(formatNumber(35, { unit: '字/秒' }), '35 字/秒');
  assert.equal(formatNumber(.1 + .2), '0.3');
  const p = createProject();
  p.variables.push({ id: 'var_a', name: '亮度', type: 'number', initial: .5, persistent: true, setting: { display: 'percent', min: 0, max: 1, step: .01 } }, { id: 'var_b', name: '金币', type: 'number', initial: 3, persistent: false, setting: { unit: '枚' } }, { id: 'var_c', name: '开', type: 'boolean', initial: true, persistent: false });
  assert.equal(parameterDisplayValue(p, p.variables[0]), '50%');
  assert.equal(parameterDisplayValue(p, p.variables[1]), '3 枚');
  assert.equal(parameterDisplayValue(p, p.variables[2]), '开启');
  assert.ok(projectSchema.safeParse(p).success);
});
