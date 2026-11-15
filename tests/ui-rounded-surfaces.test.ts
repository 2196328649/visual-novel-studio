import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type UiComponent } from '../src/core/model';
import { uiPropertyApplies, uiPropertyDefaults } from '../src/core/ui-properties';
import { createScreens } from '../src/runtime/screens';
import { createUiRuntime, uiSkinData } from '../src/runtime/ui-runtime';

function component(id: string, kind: UiComponent['kind'], extra: Partial<UiComponent> = {}): UiComponent {
  return { id, kind, page: 'main', text: '', x: .1, y: .1, width: .25, height: .2, ...extra };
}

function screenBlock(source: string, id: string, page = 'main'): string {
  const header = `screen vn_components_${page}_component_${id}(`;
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `Missing authored screen ${id}`);
  return source.slice(start).split(/\n(?=screen )/)[0];
}

test('authored rounded media exposes only the supported appearance properties in runtime defaults', () => {
  const project = createProject('圆角与媒体边框');
  project.ui.components = (['text', 'button', 'panel', 'progress', 'image', 'video', 'spine'] as const).map(kind => component('round_' + kind, kind, {
    style: { radius: 24, borderWidth: 4, borderColor: '#3388cc80' },
  }));
  const defaults = uiPropertyDefaults(project, project.ui.components);
  for (const item of project.ui.components) {
    assert.equal(defaults[item.id].radius, 24, item.kind);
    assert.equal(defaults[item.id].borderWidth, 4, item.kind);
    assert.equal(defaults[item.id].borderColor, '#3388cc80', item.kind);
    if (['image', 'video', 'spine'].includes(item.kind)) assert.equal(uiPropertyApplies(item, 'background'), false, 'Media does not gain an unrelated editable background');
  }
});

test('media paints its border in the frame foreground while the rounded mask remains on its own content', () => {
  const project = createProject('前景边框');
  project.ui.components = [
    ...(['image', 'video', 'spine'] as const).map(kind => component('round_' + kind, kind, { style: { radius: 18, borderWidth: 3, borderColor: '#ffffff80' } })),
    component('image_child', 'text', { parentId: 'round_image', x: -.1, y: -.1, text: '允许超出图片的子控件' }),
  ];
  const source = createScreens(project);
  for (const kind of ['image', 'video', 'spine'] as const) {
    const block = screenBlock(source, 'round_' + kind);
    assert.match(block, /foreground vn_ui_border\([^\n]+vn_ui_appearance\("round_/);
    assert.equal(block.match(/vn_ui_round\(/g)?.length, 1, 'Only the media displayable is rounded');
    assert.match(block, kind === 'image' ? /add vn_ui_round\(VnUiImageSurface\(/ : kind === 'video' ? /add vn_ui_round\(VnUiVideoSurface\(/ : /add vn_ui_round\(vns_spine\.player\(/);
    assert.match(block, /background None/, 'An unset background remains transparent');
  }
  const image = screenBlock(source, 'round_image');
  assert.ok(image.indexOf('vn_ui_layer_order(["image_child"])') > image.indexOf('add vn_ui_round('), 'Foreground child stays separate from the masked media');
  assert.doesNotMatch(screenBlock(source, 'image_child'), /vn_ui_round\(/, 'The parent does not clip text or its effects');
});

test('rounded progress has a single track surface and a border above the fill, including transparent tracks', () => {
  const project = createProject('进度圆角');
  project.ui.components = [component('progress', 'progress', {
    value: .5, style: { background: '#22558880', selectedBackground: '#66bb9980', radius: 30, borderWidth: 5 },
  })];
  const block = screenBlock(createScreens(project), 'progress');
  assert.match(block, /background None/);
  assert.match(block, /foreground vn_ui_border\(/);
  assert.match(block, /add vn_ui_progress_surface\(vn_ui_get\("progress", "value"\)/);
  assert.match(block, /vn_ui_get\("progress", "background"\), vn_ui_get\("progress", "selectedBackground"\)/);
  assert.doesNotMatch(block, /add Solid\(|background vn_ui_box\(/, 'Track alpha is not compounded by a duplicate frame background');
  const runtime = createUiRuntime(project);
  assert.match(runtime, /renpy\.register_shader\("vn\.ui_round"/);
  assert.match(runtime, /gl_FragColor \*= vn_ui_coverage;/, 'Rounded masks preserve premultiplied color alpha');
});

test('tooltip skins use the same rounded surface and keep text outside the mask', () => {
  const project = createProject('提示圆角');
  project.assets.push({ id: 'tip_bg', kind: 'image', name: '提示背景', path: 'assets/tip.png' });
  project.ui.components = [component('tip', 'text', { binding: 'tooltip', skin: { idle: 'tip_bg' }, style: { radius: 12, borderWidth: 2, shadowX: 5 } })];
  const block = screenBlock(createScreens(project), 'tip');
  assert.match(block, /foreground vn_ui_border\(/);
  assert.match(block, /with_border=False/);
  assert.match(block, /add vn_ui_round\(vn_ui_surface\(/);
  assert.match(block, /text vn_ui_literal\([^\n]+outlines vn_ui_outlines\("tip"\)/);
});

test('collection part styles serialize font paths and preserve absent fields for legacy fallback', () => {
  const project = createProject('列表部位字体');
  project.assets.push({ id: 'part_font', kind: 'font', name: '条目宋体', path: 'assets\\part-font.otf' });
  project.ui.components = [component('slots', 'saveSlots', { page: 'save', list: { textStyles: {
    chapter: { fontAssetId: 'part_font', fontSize: 42, textColor: '#ffccaa', align: 'left' },
    caption: { textColor: '#bbccdd' },
    number: {},
    navigation: { fontSize: 20 },
  } } })];
  const before = structuredClone(project.ui.components[0].list);
  const block = screenBlock(createScreens(project), 'slots', 'save');
  assert.match(block, /"chapter": \{"fontSize": 42, "textColor": "#ffccaa", "align": "left", "fontPath": "assets\/part-font\.otf"\}/);
  assert.match(block, /"caption": \{"textColor": "#bbccdd"\}/);
  assert.match(block, /"number": \{\}/);
  assert.match(block, /"navigation": \{"fontSize": 20\}/);
  assert.doesNotMatch(block, /"fontAssetId"|"historyName"|"historyText"/);
  assert.deepEqual(project.ui.components[0].list, before, 'Compilation cannot mutate authored part overrides');
});

test('reset fields in an unsaved draft compile like absent fields after JSON persistence', () => {
  const project = createProject('恢复默认后的预览');
  project.ui.components = [
    component('music', 'musicTrackList', { page: 'musicRoom', list: { rows: undefined, itemHeight: undefined, showLabels: false, gapY: 0, textStyles: undefined } }),
    component('choice', 'preferenceChoice', { page: 'preferences', preference: 'skipAll', selector: { itemHeight: undefined, options: [{ label: '关闭', value: false }, { label: '开启', value: true }] }, skin: { fit: undefined, brightness: { idle: .5, hover: undefined } } }),
    component('history', 'historyList', { page: 'history', list: { historyScrollbar: { rect: { x: .9, y: 0, width: .08, height: 1 }, trackWidth: undefined, thumb: { brightness: { hover: undefined } } } } }),
  ];
  const source = createScreens(project);
  assert.equal(createScreens(JSON.parse(JSON.stringify(project))), source);
  const music = screenBlock(source, 'music', 'musicRoom');
  assert.doesNotMatch(music, /"rows": None|"itemHeight": None|"textStyles": None/);
  assert.match(music, /"showLabels": False/);
  assert.match(music, /"gapY": 0/);
  const history = screenBlock(source, 'history', 'history');
  const historyOptions = history.match(/(\{"historyScrollbar": .*\}), "vn_component_history",/)?.[1];
  assert.ok(historyOptions, 'History options must be inspected separately from the collection root skin');
  assert.deepEqual(JSON.parse(historyOptions).historyScrollbar, {
    rect: { x: .9, y: 0, width: .08, height: 1 }, thumb: { brightness: {} },
  }, 'Reset track width and nested hover brightness are omitted, preserving the authored rectangle');
  const skin = uiSkinData(project, project.ui.components[1].skin);
  assert.equal(Object.hasOwn(skin, 'fit'), false);
  assert.deepEqual(skin.brightness, { idle: .5 });
});
