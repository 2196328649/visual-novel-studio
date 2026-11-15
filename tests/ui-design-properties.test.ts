import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, uiComponentSchema, type UiComponent, type VariableValue } from '../src/core/model';
import { applyUiDesignProperty, readUiDesignProperty, resetUiDesignProperty, uiDesignProperties, uiDesignPropertyApplies } from '../src/core/ui-design-properties';
import { uiLayoutDefaults, uiLayoutPropertyFields } from '../src/core/ui-layout';
import { uiProperties, uiPropertyApplies, uiPropertyDefault, type UiProperty } from '../src/core/ui-properties';

function component(kind: UiComponent['kind'] = 'button', patch: Partial<UiComponent> = {}): UiComponent {
  return { id: 'design_' + kind, page: 'main', kind, text: '原文字', x: .1, y: .2, width: .3, height: .1, ...patch };
}

function fixture() {
  const project = createProject('设计字段');
  project.ui.components = [];
  project.ui.fontSize = 28; project.ui.textColor = '#eeeeee'; project.ui.accent = '#aabbcc';
  project.assets.push(
    { id: 'design_font', kind: 'font', name: '字体', path: 'assets/font.ttf' },
    { id: 'design_idle', kind: 'image', name: '普通图片', path: 'assets/idle.png' },
    { id: 'design_hover', kind: 'image', name: '经过图片', path: 'assets/hover.png' },
    { id: 'design_pressed', kind: 'image', name: '按住图片', path: 'assets/pressed.png' },
    { id: 'design_sound', kind: 'audio', name: '音效', path: 'assets/sound.wav' },
    { id: 'design_video', kind: 'video', name: '视频', path: 'assets/video.webm' },
  );
  project.ui.pages = { main: { appearance: { fontSize: 41, fontAssetId: 'design_font', textColor: '#abcdef', accent: '#124578', clickSoundId: 'design_sound' } } };
  return project;
}

test('design reads use page defaults and remain observational', () => {
  const project = fixture(), target = component(), before = structuredClone({ project, target });
  for (const [property, expected] of [['font', 'design_font'], ['fontSize', 41], ['textColor', '#abcdef'], ['align', 'center'], ['background', '#283133'], ['hoverBackground', '#124578']] as const) {
    const result = readUiDesignProperty(project, target, property);
    assert.equal(result.value, expected, property);
    assert.equal(result.value, uiPropertyDefault(project, target, property), property);
    assert.equal(result.localValue, undefined, property);
    assert.equal(result.canReset, false, property);
  }
  for (const property of ['font', 'fontSize', 'textColor', 'hoverBackground', 'clickSound'] as const) assert.equal(readUiDesignProperty(project, target, property).source, '页面默认');
  assert.equal(readUiDesignProperty(project, component('text'), 'background').source, '默认透明');
  assert.equal(readUiDesignProperty(project, component('panel'), 'background').value, '#00000000');
  assert.equal(readUiDesignProperty(project, component('text'), 'align').value, 'left');
  assert.deepEqual({ project, target }, before);
});

test('design-only static appearance does not grant runtime capabilities', () => {
  const project = fixture();
  for (const kind of ['choiceList', 'saveSlots', 'preference', 'preferenceChoice', 'pauseMenu', 'historyList', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'chapterTitle', 'staffRoll'] as const) {
    const target = component(kind);
    for (const property of ['font', 'fontSize', 'textColor'] as const) {
      assert.equal(uiDesignPropertyApplies(target, property, project), true, kind + '/' + property);
      assert.equal(uiPropertyApplies(target, property, project), false, kind + '/' + property);
      assert.equal(readUiDesignProperty(project, target, property).source, '页面默认');
    }
    assert.equal(applyUiDesignProperty(project, target, 'fontSize', 37), true);
    assert.equal(target.style?.fontSize, 37);
  }
  for (const kind of ['keyboard', 'messageBox', 'gameOver'] as const) {
    assert.equal(uiDesignPropertyApplies(component(kind), 'fontSize', project), true);
    assert.equal(uiDesignPropertyApplies(component(kind), 'textColor', project), true);
    assert.equal(uiDesignPropertyApplies(component(kind), 'font', project), false);
  }
  assert.equal(uiDesignPropertyApplies(component('choiceList'), 'align', project), true);
  assert.equal(uiDesignPropertyApplies(component('chapterTitle'), 'shadowBlur', project), true);
  assert.equal(uiDesignPropertyApplies(component('choiceList'), 'hoverTextColor', project), false);
  assert.equal(uiDesignPropertyApplies(component('flowchart'), 'fontSize', project), false);
});

test('list backgrounds report their own surfaces and history columns stay transparent', () => {
  const project = fixture();
  for (const kind of ['choiceList', 'saveSlots', 'preferenceChoice', 'pauseMenu', 'historyList', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList'] as const) {
    const target = component(kind);
    assert.equal(readUiDesignProperty(project, target, 'background').value, '#283133', kind);
    assert.equal(applyUiDesignProperty(project, target, 'background', '#12345680'), true);
    assert.equal(readUiDesignProperty(project, target, 'background').source, '本控件');
    assert.equal(resetUiDesignProperty(target, 'background'), true);
    assert.equal(readUiDesignProperty(project, target, 'background').value, '#283133');
  }
  for (const kind of ['preference', 'chapterTitle', 'staffRoll', 'keyboard', 'messageBox', 'gameOver'] as const) assert.equal(readUiDesignProperty(project, component(kind), 'background').source, '默认透明', kind);
  const history = component('historyList', { list: { historyLayout: 'columns' } });
  assert.equal(readUiDesignProperty(project, history, 'background').value, '#00000000');
  assert.equal(readUiDesignProperty(project, history, 'background').source, '默认透明');
});

test('explicit writes track ownership even at the inherited value and equal writes are no-ops', () => {
  const project = fixture(), target = component();
  assert.equal(applyUiDesignProperty(project, target, 'fontSize', 41), true);
  assert.deepEqual(readUiDesignProperty(project, target, 'fontSize'), { value: 41, localValue: 41, source: '本控件', canReset: true, applies: true });
  const style = target.style;
  assert.equal(applyUiDesignProperty(project, target, 'fontSize', 41), false);
  assert.equal(target.style, style);
  project.ui.pages!.main!.appearance!.fontSize = 52;
  assert.equal(readUiDesignProperty(project, target, 'fontSize').value, 41);
  assert.equal(resetUiDesignProperty(target, 'fontSize'), true);
  assert.equal(resetUiDesignProperty(target, 'fontSize'), false);
  assert.equal(readUiDesignProperty(project, target, 'fontSize').value, 52);
  assert.equal(readUiDesignProperty(project, target, 'fontSize').source, '页面默认');
});

test('single appearance reset preserves image fitting, effects and sibling fields', () => {
  const project = fixture(), target = component('image', {
    style: { imageFit: 'cover', opacity: .4, borderWidth: 3, borderColor: '#112233', radius: 18 },
    skin: { hover: 'design_hover', fit: 'nineSlice', borders: { left: 4, right: 4, top: 4, bottom: 4 } },
    imageEffects: { cropX: .2, flipX: true },
  });
  const skin = structuredClone(target.skin), effects = structuredClone(target.imageEffects);
  assert.equal(resetUiDesignProperty(target, 'borderWidth'), true);
  assert.equal(resetUiDesignProperty(target, 'radius'), true);
  assert.deepEqual(target.style, { imageFit: 'cover', opacity: .4, borderColor: '#112233' });
  assert.deepEqual(target.skin, skin); assert.deepEqual(target.imageEffects, effects);
  assert.equal(readUiDesignProperty(project, target, 'imageFit').value, 'cover');
  assert.equal(uiComponentSchema.safeParse(target).success, true);
});

test('media backgrounds and borders share design fields and keep source and playback unchanged', () => {
  const project = fixture();
  for (const kind of ['image', 'video', 'spine'] as const) {
    const target = component(kind, { assetId: kind === 'video' ? 'design_video' : 'design_idle', loop: false, spine: { speed: .5 } });
    const before = structuredClone(target);
    assert.equal(readUiDesignProperty(project, target, 'background').value, '#00000000', 'Static media underlays begin transparent');
    assert.equal(uiDesignPropertyApplies(target, 'background', project), true);
    assert.equal(uiPropertyApplies(target, 'background'), false, 'Design underlays do not imply dynamic background support');
    for (const [property, value] of [['background', '#44556680'], ['borderWidth', 2], ['borderColor', '#11223380'], ['radius', 17.5]] as const) {
      assert.equal(uiDesignPropertyApplies(target, property, project), true, kind + '/' + property);
      assert.equal(applyUiDesignProperty(project, target, property, value), true);
      assert.equal(readUiDesignProperty(project, target, property).value, value);
    }
    assert.equal(resetUiDesignProperty(target, 'background'), true);
    assert.equal(readUiDesignProperty(project, target, 'background').value, '#00000000');
    assert.deepEqual(target.style, { borderWidth: 2, borderColor: '#11223380', radius: 17.5 });
    assert.equal(target.assetId, before.assetId); assert.equal(target.loop, before.loop); assert.deepEqual(target.spine, before.spine);
  }
});

test('every author layout field is supported without losing version, recovery or future metadata', () => {
  const project = fixture(), target = component('panel', { layout: { version: 1, recovery: 'original-layout', futureLayout: { keep: true } } });
  const values: Record<keyof typeof uiLayoutPropertyFields, VariableValue> = {
    anchorX: .2, anchorY: .8, pivotX: .3, pivotY: .7, layoutRotation: 45, scaleX: -1, scaleY: .5,
    layoutFlow: 'horizontal', layoutOrder: -2, childGap: 14, paddingLeft: 11, paddingTop: 12, paddingRight: 13, paddingBottom: 14,
    clipChildren: true, scrollMode: 'both', scrollX: -25, scrollY: 90,
  };
  for (const [property, field] of Object.entries(uiLayoutPropertyFields) as [keyof typeof uiLayoutPropertyFields, keyof typeof uiLayoutDefaults][]) {
    assert.ok((uiDesignProperties as readonly UiProperty[]).includes(property));
    assert.equal(applyUiDesignProperty(project, target, property, values[property]), true, property);
    assert.equal(target.layout?.[field], values[property]);
  }
  for (const [property, field] of Object.entries(uiLayoutPropertyFields) as [keyof typeof uiLayoutPropertyFields, keyof typeof uiLayoutDefaults][]) {
    assert.equal(resetUiDesignProperty(target, property), true, property);
    assert.equal(readUiDesignProperty(project, target, property).value, uiLayoutDefaults[field]);
  }
  assert.deepEqual(target.layout, { version: 1, recovery: 'original-layout', futureLayout: { keep: true } });
  assert.equal(uiComponentSchema.safeParse(target).success, true);
  const absent = component('panel');
  assert.equal(resetUiDesignProperty(absent, 'anchorX'), false);
  assert.equal(absent.layout, undefined);
  assert.equal(applyUiDesignProperty(project, absent, 'anchorX', .5), true);
  assert.deepEqual(absent.layout, { version: 1, anchorX: .5 });
});

test('future layout writes are rejected without rewriting the recovery version', () => {
  const project = fixture(), target = component('panel', { layout: { version: 9, anchorX: .3, recovery: 'keep', newMode: 'future' } }), before = structuredClone(target);
  assert.throws(() => applyUiDesignProperty(project, target, 'anchorX', .8), /布局版本暂不支持/);
  assert.throws(() => resetUiDesignProperty(target, 'anchorX'), /布局版本暂不支持/);
  assert.equal(readUiDesignProperty(project, target, 'anchorX').canReset, false);
  assert.deepEqual(target, before);
  assert.equal(applyUiDesignProperty(project, target, 'opacity', .5), true);
  assert.deepEqual(target.layout, before.layout);
});

test('state image reads resolve pressed and selected through hover then ordinary without authoring them', () => {
  const project = fixture(), target = component('button', { skin: { idle: 'design_idle', hover: 'design_hover', fit: 'contain', hideText: true } });
  const before = structuredClone(target);
  for (const property of ['pressedImage', 'selectedImage'] as const) assert.deepEqual(readUiDesignProperty(project, target, property), { value: 'design_hover', localValue: undefined, source: '沿用鼠标经过状态', canReset: false, applies: true });
  assert.equal(readUiDesignProperty(project, target, 'disabledImage').value, 'design_idle');
  assert.equal(readUiDesignProperty(project, target, 'disabledImage').source, '沿用普通状态');
  assert.deepEqual(target, before);
  assert.equal(applyUiDesignProperty(project, target, 'pressedImage', 'design_pressed'), true);
  assert.equal(readUiDesignProperty(project, target, 'pressedImage').source, '本控件');
  assert.equal(resetUiDesignProperty(target, 'pressedImage'), true);
  assert.equal(readUiDesignProperty(project, target, 'pressedImage').value, 'design_hover');
  assert.equal(applyUiDesignProperty(project, target, 'hoverImage', ''), true);
  for (const property of ['hoverImage', 'pressedImage', 'selectedImage'] as const) {
    assert.equal(readUiDesignProperty(project, target, property).value, 'design_idle');
    assert.equal(readUiDesignProperty(project, target, property).source, '沿用普通状态');
  }
  assert.deepEqual(target.skin, { idle: 'design_idle', fit: 'contain', hideText: true });
});

test('state colors retain the core fallback order and progress fill stays independent', () => {
  const project = fixture(), target = component('button', { style: { background: '#abcdef' } });
  assert.equal(readUiDesignProperty(project, target, 'hoverBackground').source, '沿用普通状态');
  assert.equal(readUiDesignProperty(project, target, 'pressedBackground').value, '#124578');
  assert.equal(readUiDesignProperty(project, target, 'pressedBackground').source, '页面默认');
  assert.equal(readUiDesignProperty(project, target, 'disabledBackground').value, '#22282a');
  assert.equal(applyUiDesignProperty(project, target, 'hoverBackground', '#135790'), true);
  assert.equal(readUiDesignProperty(project, target, 'pressedBackground').value, '#135790');
  assert.equal(readUiDesignProperty(project, target, 'selectedBackground').source, '沿用鼠标经过状态');
  assert.equal(applyUiDesignProperty(project, target, 'textColor', '#123456'), true);
  assert.equal(readUiDesignProperty(project, target, 'disabledTextColor').source, '沿用普通状态');
  const panel = component('panel', { style: { background: '#234567' } });
  assert.equal(readUiDesignProperty(project, panel, 'pressedBackground').source, '沿用普通状态');
  const progress = component('progress', { style: { background: '#abcdef', hoverBackground: '#456789' } });
  assert.equal(readUiDesignProperty(project, progress, 'selectedBackground').value, '#124578');
  assert.equal(readUiDesignProperty(project, progress, 'selectedBackground').source, '页面默认');
});

test('slider defaults and thumb image inheritance reflect the bound control', () => {
  const project = fixture(), target = component('preference', { page: 'preferences', preference: 'musicVolume', slider: { thumb: { idle: 'design_idle', hover: 'design_hover', fit: 'cover' } } });
  assert.equal(readUiDesignProperty(project, target, 'sliderFillColor').value, '#aabbcc');
  assert.equal(readUiDesignProperty(project, target, 'sliderFillColor').source, '页面默认');
  assert.equal(readUiDesignProperty(project, target, 'sliderPressedThumbImage').value, 'design_hover');
  assert.equal(readUiDesignProperty(project, target, 'sliderDisabledThumbImage').value, 'design_idle');
  assert.equal(applyUiDesignProperty(project, target, 'sliderTrackImage', 'design_idle'), true);
  assert.equal(readUiDesignProperty(project, target, 'sliderFillColor').value, '#00000000');
  assert.equal(readUiDesignProperty(project, target, 'sliderFillColor').source, '默认透明');
  assert.equal(resetUiDesignProperty(target, 'sliderHoverThumbImage'), true);
  assert.deepEqual(target.slider?.thumb, { idle: 'design_idle', fit: 'cover' });
  assert.equal(readUiDesignProperty(project, target, 'sliderPressedThumbImage').source, '沿用普通状态');
  const missing = component('preference', { page: 'preferences', parameterId: 'missing_parameter' });
  assert.equal(readUiDesignProperty(project, missing, 'sliderTrackHeight').applies, false);
  assert.throws(() => applyUiDesignProperty(project, missing, 'sliderTrackHeight', 8), /不适用于/);
});

test('empty resource writes remove optional IDs and preserve other design settings', () => {
  const project = fixture(), text = component('text', { style: { fontAssetId: 'design_font', outlineWidth: 2 } });
  assert.equal(applyUiDesignProperty(project, text, 'font', ''), true);
  assert.deepEqual(text.style, { outlineWidth: 2 });
  assert.equal(readUiDesignProperty(project, text, 'font').value, 'design_font');
  assert.equal(readUiDesignProperty(project, text, 'font').source, '页面默认');
  assert.equal(applyUiDesignProperty(project, text, 'font', ''), false);
  const image = component('image', { assetId: 'design_idle', style: { imageFit: 'cover' } });
  assert.equal(applyUiDesignProperty(project, image, 'image', ''), true);
  assert.equal(Object.hasOwn(image, 'assetId'), false); assert.equal(image.style?.imageFit, 'cover');
  const video = component('video', { assetId: 'design_video', posterId: 'design_idle', loop: false });
  assert.equal(applyUiDesignProperty(project, video, 'videoPoster', ''), true);
  assert.equal(video.assetId, 'design_video'); assert.equal(video.loop, false);
  const button = component('button', { clickSoundId: null });
  assert.equal(readUiDesignProperty(project, button, 'clickSound').value, '');
  assert.equal(readUiDesignProperty(project, button, 'clickSound').source, '本控件');
  assert.equal(readUiDesignProperty(project, button, 'clickSound').canReset, true);
  assert.equal(applyUiDesignProperty(project, button, 'clickSound', ''), true);
  assert.equal(readUiDesignProperty(project, button, 'clickSound').value, 'design_sound');
  for (const target of [text, image, video, button]) assert.equal(uiComponentSchema.safeParse(target).success, true);
});

test('bound text cannot silently become fixed text and required geometry cannot be deleted', () => {
  const project = fixture(), target = component('text', { page: 'say', binding: 'dialogue' }), before = structuredClone(target);
  assert.throws(() => applyUiDesignProperty(project, target, 'text', '替代文字'), /此文字由.*当前对白.*提供，请先.*固定文字/);
  assert.deepEqual(target, before);
  assert.match(readUiDesignProperty(project, target, 'text').source, /当前对白/);
  for (const property of ['text', 'x', 'y', 'width', 'height'] as const) {
    assert.equal(readUiDesignProperty(project, target, property).canReset, false);
    assert.throws(() => resetUiDesignProperty(target, property), /保留明确的设计值/);
  }
  assert.deepEqual(target, before);
  const fixed = component('text');
  assert.equal(applyUiDesignProperty(project, fixed, 'text', ''), true);
  assert.equal(fixed.text, '');
  assert.equal(applyUiDesignProperty(project, fixed, 'x', -.2), true);
  assert.equal(fixed.x, -.2);
});

test('Spine skin edits validate the current source without disturbing animation or playback', () => {
  const project = fixture();
  project.assets.push({ id: 'design_spine', kind: 'spine', name: '骨骼', path: 'assets/spine.json', spine: {
    version: '4.2', atlasPath: 'assets/spine.atlas', pages: [{ name: 'spine.png', path: 'assets/spine.png', width: 32, height: 32 }],
    animations: [{ name: 'idle', duration: 1 }], skins: ['default', 'alternate'], bounds: { x: 0, y: 0, width: 32, height: 32 },
  } });
  const target = component('spine', { assetId: 'design_spine', spine: { animation: 'idle', loop: false, speed: .5, autoplay: false, fit: 'manual' } }), before = structuredClone(target);
  assert.throws(() => applyUiDesignProperty(project, target, 'spineSkin', 'unknown_skin'), /当前骨骼素材没有所选皮肤/);
  assert.throws(() => applyUiDesignProperty(project, target, 'spineAsset', 'design_spine'), /专用设置/);
  assert.deepEqual(target, before);
  assert.equal(applyUiDesignProperty(project, target, 'spineSkin', 'alternate'), true);
  assert.deepEqual(target.spine, { ...before.spine, skin: 'alternate' });
  assert.equal(resetUiDesignProperty(target, 'spineSkin'), true);
  assert.deepEqual(target.spine, before.spine);
  assert.equal(uiComponentSchema.safeParse(target).success, true);
});

test('invalid and unsupported edits are rejected before mutation', () => {
  const project = fixture(), target = component('button'), before = structuredClone({ project, target });
  for (const [property, value] of [
    ['fontSize', 0], ['fontSize', 2.5], ['opacity', Infinity], ['opacity', 1.1], ['radius', -1], ['radius', NaN],
    ['borderColor', 'red'], ['outlineColor', '#12345'], ['align', 'stretch'], ['font', 'design_idle'],
    ['font', 'missing_font'], ['hoverImage', 'design_video'], ['width', -1], ['clipChildren', 'true'],
    ['image', 'design_idle'], ['hovered', false], ['enabled', true], ['visible', true], ['numberValue', 1],
    ['minimum', 0], ['maximum', 1], ['step', .1],
  ] as [UiProperty, VariableValue][]) assert.throws(() => applyUiDesignProperty(project, target, property, value), property);
  for (const property of ['hovered', 'visible', 'minimum', 'image'] as const) {
    assert.equal(readUiDesignProperty(project, target, property).applies, false);
    assert.throws(() => resetUiDesignProperty(target, property));
  }
  assert.throws(() => applyUiDesignProperty(project, target, '__proto__' as UiProperty, 'bad'), /属性不存在/);
  assert.throws(() => readUiDesignProperty(project, target, 'missing' as UiProperty), /属性不存在/);
  assert.deepEqual({ project, target }, before);
  assert.equal(applyUiDesignProperty(project, target, 'radius', 250), true);
  assert.equal(applyUiDesignProperty(project, target, 'borderColor', '#12345680'), true);
  assert.equal(target.style?.radius, 250);
  assert.equal(uiProperties.radius.min, 0);
});
