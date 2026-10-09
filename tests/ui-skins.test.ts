import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, effectiveUiComponents, effectiveUiTheme, projectSchema, type UiComponent } from '../src/core/model';
import { editableUiPages, uiPageBackgroundOpacity, uiSkinAsset } from '../src/core/ui';
import { compileProject } from '../src/runtime/compiler';

function fixture() {
  const project = createProject('中文图片界面');
  project.assets = ['idle', 'hover', 'pressed', 'selected', 'disabled'].map(name => ({ id: name, name, kind: 'image', path: `assets/${name}.png`, width: 80, height: 60 }));
  project.assets.push({ id: 'font', name: '正文宋体', kind: 'font', path: 'assets/body.otf' });
  project.ui.fontAssetId = 'font';
  project.ui.components = [{ id: 'image_button', kind: 'button', page: 'main', text: '设置', action: 'preferences', x: 0.1, y: 0.1, width: 0.2, height: 0.12,
    skin: { idle: 'idle', hover: 'hover', pressed: 'pressed', selected: 'selected', disabled: 'disabled', fit: 'nineSlice', borders: { left: 8, right: 10, top: 6, bottom: 12 }, hideText: true } }];
  return project;
}

test('history preserves scene transparency and explicit authored page backgrounds', () => {
  const theme = fixture().ui;
  assert.equal(uiPageBackgroundOpacity(theme, 'history'), 0.8);
  theme.pages = { history: { layout: 'custom' } };
  assert.equal(uiPageBackgroundOpacity(theme, 'history'), 0);
  assert.equal(uiPageBackgroundOpacity(theme, 'main'), 1);
  theme.pages.history!.backgroundOpacity = 0.4;
  assert.equal(uiPageBackgroundOpacity(theme, 'history'), 0.4);
  theme.pages.history = { layout: 'custom', background: '#15252f' };
  assert.equal(uiPageBackgroundOpacity(theme, 'history'), 1);
  const result = compileProject({ ...fixture(), ui: { ...theme, pages: { history: { layout: 'custom' } } } });
  assert.match(result.files['game/00-vn-ui.rpy'], /"history": \{"layout": "custom", "backgroundOpacity": 0[,}]/);
});

test('image states, font, and page overrides survive project serialization and inheritance', () => {
  const project = fixture();
  project.ui.pages = { main: { layout: 'custom', backgroundId: 'idle', background: '#ffffee' } };
  project.ui.instances = [{ id: 'parent', name: '基础', components: [], pages: { main: { backgroundId: 'hover' } } }, { id: 'child', name: '派生', baseUiId: 'parent', components: [] }];
  project.ui.activeInstanceId = 'child';
  editableUiPages(project.ui).main = { backgroundOpacity: 0.5 };
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(effectiveUiTheme(restored.ui).pages?.main, { layout: 'custom', backgroundId: 'hover', background: '#ffffee', backgroundOpacity: 0.5 });
  assert.equal(effectiveUiTheme(restored.ui).fontAssetId, 'font');
  assert.deepEqual(effectiveUiComponents(restored.ui)[0].skin, project.ui.components[0].skin);
  assert.equal(project.ui.pages.main?.backgroundOpacity, undefined);
});

test('pressed, selected, and disabled states keep separate pictures and safe fallbacks', () => {
  const skin = fixture().ui.components[0].skin;
  assert.equal(uiSkinAsset(skin, 'pressed'), 'pressed');
  assert.equal(uiSkinAsset(skin, 'selected'), 'selected');
  assert.equal(uiSkinAsset(skin, 'disabled'), 'disabled');
  assert.equal(uiSkinAsset({ idle: 'idle', hover: 'hover' }, 'pressed'), 'hover');
  assert.equal(uiSkinAsset({ idle: 'idle', pressed: 'pressed' }, 'selected'), 'idle');
  assert.equal(uiSkinAsset({ idle: 'idle' }, 'disabled'), 'idle');
});

test('native background children paint below the complete parent button skin in every state', () => {
  const project = fixture();
  project.ui.components.push(
    { id: 'background_child', kind: 'image', page: 'main', parentId: 'image_button', childLayer: 'background', text: '', assetId: 'selected', x: 0, y: 0, width: 1, height: 1 },
    { id: 'foreground_child', kind: 'image', page: 'main', parentId: 'image_button', text: '', assetId: 'pressed', x: .1, y: .1, width: .2, height: .2 },
  );
  const result = compileProject(project);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  const screens = result.files['game/screens.rpy'];
  const afterBackground = screens.slice(screens.indexOf('id "vn_component_background_child"'));
  const ownSkinAt = afterBackground.indexOf('add VnUiStateSurface({"idle": "assets/idle.png"');
  const foregroundAt = afterBackground.indexOf('id "vn_component_foreground_child"');
  assert.ok(ownSkinAt > 0 && foregroundAt > ownSkinAt, 'Parent surface belongs between background and foreground children');
  const ownSkin = afterBackground.slice(ownSkinAt, foregroundAt);
  for (const state of ['idle', 'hover', 'pressed', 'selected', 'disabled']) assert.ok(ownSkin.includes(`"${state}": "assets/${state}.png"`));
  assert.match(ownSkin, /True, colors=\{/);
  assert.match(ownSkin, /"disabled": "#22282a"/);
});

test('custom pages compile native actions, typed conditions, fonts and private image paths', () => {
  const project = fixture();
  project.ui.pages = { main: { layout: 'custom' }, say: { layout: 'custom', showQuickMenu: false } };
  project.variables = [{ id: 'unlocked', name: '已经解锁', type: 'boolean', initial: false, persistent: true }];
  project.ui.components[0].enabledWhen = { kind: 'compare', variableId: 'unlocked', operator: 'eq', value: true };
  project.ui.components[0].style = { pressedBackground: '#111111', selectedBackground: '#223344' };
  project.ui.components.push({ id: 'dialogue', kind: 'text', page: 'say', binding: 'dialogue', text: '', x: 0.1, y: 0.7, width: 0.8, height: 0.2 });
  project.ui.continueIndicatorId = 'hover'; project.ui.continueIndicatorWidth = 40;
  const result = compileProject(project);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  const screens = result.files['game/screens.rpy'];
  assert.match(screens, /sensitive \(vn_ui_get\("image_button", "enabled"\) and renpy.display.behavior.is_sensitive\(ShowMenu\("preferences"\)\)\)/);
  assert.match(result.files['game/00-vn-ui.rpy'], /"enabled": lambda: \(persistent.vn_var_unlocked == True\)/);
  assert.match(screens, /font "assets\/body.otf"/);
  assert.match(screens, /"pressed": "assets\/pressed.png"/);
  assert.match(screens, /selected_background vn_ui_surface\([^\n]+"selected"[^\n]+"#223344"/);
  assert.doesNotMatch(screens.slice(screens.indexOf('screen main_menu():'), screens.indexOf('screen say(')), /vn_main_start/);
  assert.match(result.files['game/story.rpy'], /ctc_position="nestled-close"/);
  assert.match(result.files['game/00-vn-ui.rpy'], /register_sl_displayable\("vn_skin_button"/);
});

test('missing skin images, wrong font types, and custom dialogue without text are reported', () => {
  const project = fixture();
  project.ui.components[0].skin!.pressed = 'missing_image';
  project.ui.components[0].style = { fontAssetId: 'idle' };
  project.ui.pages = { say: { layout: 'custom' } };
  const errors = compileProject(project).diagnostics.filter(d => d.severity === 'error');
  assert.ok(errors.some(d => d.message.includes('missing_image')));
  assert.ok(errors.some(d => d.message.includes('idle')));
  assert.ok(errors.some(d => d.message.includes('当前对白')));
});

test('custom collection components invoke real native data and actions', () => {
  const project = fixture();
  const kinds: [UiComponent['page'], UiComponent['kind']][] = [['save', 'saveSlots'], ['gallery', 'galleryGrid'], ['musicRoom', 'musicTrackList'], ['history', 'historyList']];
  for (const [page, kind] of kinds) project.ui.components.push({ id: `list_${page.toLowerCase()}`, page, kind, text: '', x: 0.1, y: 0.2, width: 0.8, height: 0.7, skin: { idle: 'idle' }, list: { columns: 2, rows: 3 } });
  const result = compileProject(project);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  assert.match(result.files['game/screens.rpy'], /use vn_skin_slots\(/);
  assert.match(result.files['game/screens.rpy'], /FileAction\(slot, page=page\)/);
  assert.match(result.files['game/screens.rpy'], /for entry in _history_list:/);
  assert.match(result.files['game/screens.rpy'], /vn_music_room.Play\(entry_path\)/);
  assert.match(result.files['game/screens.rpy'], /action Show\("vn_gallery_image", asset_paths=unlocked_paths/);
});
