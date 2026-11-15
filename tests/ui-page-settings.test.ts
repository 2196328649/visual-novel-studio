import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, effectiveUiTheme, projectSchema, uiComponentSchema, uiInstanceSchema } from '../src/core/model';
import { localUiPageAppearance, setUiPageAppearance, uiComponentTheme, uiPageTheme } from '../src/core/ui-page-settings';
import { uiPropertyDefault, uiPropertyDefaults } from '../src/core/ui-properties';
import { ensureUiPageEvent, createUiEventGraph, createUiParameterBinding } from '../src/core/ui-logic';
import { createUiPageParameter } from '../src/core/ui-page-interface';
import { createBlueprintVariable } from '../src/core/blueprint-state';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { nativePreferencePreview } from '../src/core/ui-native-preview';
import { validateProject } from '../src/core/validate';
import { createScreens } from '../src/runtime/screens';
import { createUiRuntime } from '../src/runtime/ui-runtime';
import { applyUiDraft } from '../src/core/ui-draft';
import { uiHoverSound } from '../src/core/ui-sound';
import { uiStateColor } from '../src/core/ui';
import { chapterComposition } from '../src/core/chapter-composition';
import { createChapterRuntime } from '../src/runtime/chapter-runtime';

function fixture() {
  const project = createProject('页面设置');
  project.ui.fontSize = 28; project.ui.textColor = '#eeeeee'; project.ui.accent = '#aa6633';
  project.ui.components = [uiComponentSchema.parse({ id: 'main_text', page: 'main', kind: 'text', text: '标题', x: .1, y: .1, width: .4, height: .2 }), uiComponentSchema.parse({ id: 'settings_text', page: 'preferences', kind: 'text', text: '设置', x: .1, y: .1, width: .4, height: .2 })];
  project.ui.customPages = ['first', 'second'].map(id => ({ id, name: id, modal: true, components: [uiComponentSchema.parse({ id: id + '_text', page: 'custom', kind: 'text', text: id, x: .1, y: .1, width: .4, height: .2 })] }));
  project.assets.push({ id: 'page_font', name: '页面字体', kind: 'font', path: 'assets/page.ttf' }, { id: 'page_sound', name: '页面音效', kind: 'audio', path: 'assets/page.wav' });
  return project;
}

test('page defaults remain optional and legacy projects retain their original appearance', () => {
  const project = fixture(), copy = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(copy.ui, project.ui);
  assert.equal(uiPageTheme(copy, 'ui:main').fontSize, 28);
  assert.equal(uiPageTheme(copy, 'first').textColor, '#eeeeee');
  assert.deepEqual(localUiPageAppearance(copy, 'ui:main'), {});
});

test('page appearance edits never bake values into controls or change another page or player preferences', () => {
  const project = fixture(), before = structuredClone(project);
  setUiPageAppearance(project, 'ui:main', 'fontSize', 42);
  setUiPageAppearance(project, 'ui:main', 'textColor', '#eebbaa');
  assert.equal(uiComponentTheme(project, project.ui.components[0]).fontSize, 42);
  assert.equal(uiComponentTheme(project, project.ui.components[1]).fontSize, 28);
  assert.equal(uiPageTheme(project, 'first').fontSize, 28);
  assert.deepEqual(project.ui.components, before.ui.components);
  assert.deepEqual(project.playerDefaults, before.playerDefaults);
  assert.equal(project.ui.fontSize, before.ui.fontSize);
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(project))).ui.pages, project.ui.pages);
});

test('scheme inheritance merges page appearance per field and resetting one field reveals live inherited values', () => {
  const project = fixture();
  project.ui.pages = { main: { appearance: { fontSize: 30, textColor: '#112233' } } };
  project.ui.instances = [uiInstanceSchema.parse({ id: 'parent', name: '父方案', pages: { main: { appearance: { fontSize: 32, accent: '#223344' } } } }), uiInstanceSchema.parse({ id: 'child', name: '子方案', baseUiId: 'parent' })];
  project.ui.activeInstanceId = 'child';
  setUiPageAppearance(project, 'ui:main', 'textColor', '#445566');
  setUiPageAppearance(project, 'ui:main', 'fontSize', 44);
  assert.deepEqual(effectiveUiTheme(project.ui).pages?.main?.appearance, { fontSize: 44, textColor: '#445566', accent: '#223344' });
  setUiPageAppearance(project, 'ui:main', 'fontSize', undefined);
  project.ui.instances[0].pages!.main!.appearance!.fontSize = 36;
  assert.equal(uiPageTheme(project, 'ui:main').fontSize, 36);
  assert.deepEqual(localUiPageAppearance(project, 'ui:main'), { textColor: '#445566' });
  assert.equal(project.ui.pages.main!.appearance!.textColor, '#112233');
  assert.equal(uiPageTheme(project, 'ui:preferences').fontSize, 28);
});

test('custom pages own their appearance independently and can explicitly choose built-in font and silence', () => {
  const project = fixture(); project.ui.fontAssetId = 'page_font'; project.ui.hoverSoundId = 'page_sound';
  setUiPageAppearance(project, 'first', 'fontAssetId', '');
  setUiPageAppearance(project, 'first', 'hoverSoundId', '');
  setUiPageAppearance(project, 'first', 'fontSize', 39);
  assert.equal(uiPageTheme(project, 'first').fontAssetId, undefined);
  assert.equal(uiPageTheme(project, 'first').hoverSoundId, undefined);
  assert.equal(uiPageTheme(project, 'second').fontAssetId, 'page_font');
  assert.equal(uiPageTheme(project, 'second').hoverSoundId, 'page_sound');
  assert.equal(uiComponentTheme(project, project.ui.customPages[0].components[0]).fontSize, 39);
  setUiPageAppearance(project, 'first', 'fontAssetId', undefined);
  assert.equal(uiPageTheme(project, 'first').fontAssetId, 'page_font');
});

test('invalid page edits cannot fall through to the base theme or partially mutate it', () => {
  const project = fixture(), before = structuredClone(project);
  assert.throws(() => setUiPageAppearance(project, 'missing', 'fontSize', 40), /页面已不存在/);
  assert.throws(() => setUiPageAppearance(project, 'ui:main', 'fontSize', NaN));
  assert.deepEqual(project, before);
  project.ui.activeInstanceId = 'missing';
  const invalid = structuredClone(project);
  assert.throws(() => setUiPageAppearance(project, 'ui:main', 'fontSize', 40), /方案已不存在/);
  assert.deepEqual(project, invalid);
});

test('blueprint property defaults use page appearance while explicit component styles retain priority', () => {
  const project = fixture(), component = project.ui.components[0];
  setUiPageAppearance(project, 'ui:main', 'fontSize', 40); setUiPageAppearance(project, 'ui:main', 'fontAssetId', 'page_font');
  setUiPageAppearance(project, 'ui:main', 'textColor', '#334455'); setUiPageAppearance(project, 'ui:main', 'hoverSoundId', 'page_sound');
  assert.equal(uiPropertyDefault(project, component, 'fontSize'), 40);
  assert.equal(uiPropertyDefault(project, component, 'textColor'), '#334455');
  assert.equal(uiPropertyDefault(project, component, 'font'), 'page_font');
  const button = { ...component, id: 'button', kind: 'button' as const };
  assert.equal(uiPropertyDefault(project, button, 'hoverSound'), 'page_sound');
  assert.equal(uiPropertyDefault(project, { ...button, hoverSoundId: null }, 'hoverSound'), '');
  component.style = { fontSize: 19, textColor: '#abcdef' };
  const values = uiPropertyDefaults(project, project.ui.components);
  assert.equal(values[component.id].fontSize, 19); assert.equal(values[component.id].textColor, '#abcdef');
  assert.equal(values.settings_text.fontSize, 28); assert.equal(values.settings_text.textColor, '#eeeeee');
});

test('page accent and sound defaults match canvas and blueprint defaults, including explicit silence', () => {
  const project = fixture(), component = { ...project.ui.components[0], kind: 'button' as const };
  setUiPageAppearance(project, 'ui:main', 'accent', '#667788');
  setUiPageAppearance(project, 'ui:main', 'hoverSoundId', 'page_sound');
  for (const [state, property] of [['hover', 'hoverBackground'], ['pressed', 'pressedBackground'], ['selected', 'selectedBackground']] as const) {
    assert.equal(uiStateColor(component, state, uiComponentTheme(project, component).accent), '#667788');
    assert.equal(uiPropertyDefault(project, component, property), '#667788');
  }
  assert.equal(uiHoverSound(project, component), 'page_sound');
  assert.equal(uiHoverSound(project, { ...component, hoverSoundId: null }), undefined);
  assert.equal(uiHoverSound(project, { ...component, page: 'preferences' }), undefined);
  project.ui.hoverSoundId = 'page_sound'; setUiPageAppearance(project, 'ui:messageBox', 'hoverSoundId', '');
  assert.equal(uiHoverSound(project, undefined, 'ui:messageBox'), undefined);
  assert.equal(uiHoverSound(project, undefined, 'ui:preferences'), 'page_sound');
});

test('inactive component definitions retain their owning scheme page defaults', () => {
  const project = fixture();
  project.ui.instances = [uiInstanceSchema.parse({ id: 'active', name: '当前方案', parameters: { fontSize: 25 } }),
    uiInstanceSchema.parse({ id: 'other', name: '另一方案', pages: { main: { appearance: { fontSize: 41, textColor: '#314159' } } }, components: [{ ...project.ui.components[0], id: 'other_text' }] })];
  project.ui.activeInstanceId = 'active';
  const values = uiPropertyDefaults(project, [...project.ui.components, ...project.ui.instances[1].components]);
  assert.equal(values.main_text.fontSize, 25); assert.equal(values.other_text.fontSize, 41); assert.equal(values.other_text.textColor, '#314159');
});

test('native previews and generated native screens use the same resolved page defaults', () => {
  const project = fixture(); setUiPageAppearance(project, 'ui:preferences', 'textColor', '#345678'); setUiPageAppearance(project, 'ui:preferences', 'fontSize', 18); setUiPageAppearance(project, 'ui:preferences', 'fontAssetId', 'page_font');
  const layout = nativePreferencePreview(project, 'ui:preferences', []);
  assert.equal(layout?.components[0].style?.textColor, '#345678'); assert.equal(layout?.components[0].style?.fontSize, 18);
  const before = structuredClone(project), screens = createScreens(project), runtime = createUiRuntime(project);
  assert.match(screens, /style vn_page_preferences_text is default/);
  assert.match(screens, /style vn_page_preferences_text:\s+font "assets\/page.ttf"\s+size 18\s+color "#345678"/);
  assert.match(screens, /screen preferences\(\):\s+style_prefix vn_ui_native_prefix\("preferences"\)/);
  assert.match(runtime, /"settings_text": \{[^\n]*"textColor": "#345678"/);
  assert.deepEqual(project, before);
});

test('appearance asset references are validated, including inactive schemes and custom pages', () => {
  const project = fixture(); project.ui.instances = [uiInstanceSchema.parse({ id: 'unused', name: '未启用', pages: { main: { appearance: { fontAssetId: 'missing_font' } } } })];
  setUiPageAppearance(project, 'first', 'hoverSoundId', 'missing_sound');
  const messages = validateProject(project).map(item => item.message).join('\n');
  assert.match(messages, /missing_font/); assert.match(messages, /missing_sound/);
});

test('chapter conversion and particle fonts respect page defaults without changing other pages', () => {
  const project = fixture();
  setUiPageAppearance(project, 'ui:chapterTitle', 'fontSize', 40);
  setUiPageAppearance(project, 'ui:chapterTitle', 'accent', '#234567');
  setUiPageAppearance(project, 'ui:chapterTitle', 'fontAssetId', 'page_font');
  const before = structuredClone(project);
  const composition = chapterComposition(project, { title: '第一章', subtitle: '', duration: 4, effect: 'none' });
  const title = composition.actions.find(action => action.kind === 'visual')?.children?.flatMap(child => child.children ?? []).find(child => child.name === '章节标题');
  assert.ok(title);
  assert.equal(title.fontSize, 52); assert.equal(title.color, '#234567'); assert.equal(title.fontAssetId, 'page_font');
  assert.match(createChapterRuntime(project), /Text\(title, font="assets\/page.ttf"/);
  assert.equal(uiPageTheme(project, 'ui:main').fontSize, 28);
  assert.deepEqual(project, before);
});

test('design-side page event shortcuts are idempotent and never modify inherited graphs', () => {
  const project = fixture(), inherited = createUiEventGraph(project, 'ui:main', '基础页面');
  project.ui.instances = [uiInstanceSchema.parse({ id: 'derived', name: '派生' })]; project.ui.activeInstanceId = 'derived';
  const before = structuredClone(inherited), event = ensureUiPageEvent(project, 'ui:main', '标题', 'closeRequested');
  assert.notEqual(event.graph.id, inherited.id); assert.equal(event.graph.uiInstanceId, 'derived');
  assert.equal(event.node.properties.pageId, 'ui:main'); assert.equal(event.node.properties.phase, 'closeRequested');
  assert.equal(ensureUiPageEvent(project, 'ui:main', '标题', 'closeRequested').node.id, event.node.id);
  assert.deepEqual(inherited, before);
  const show = ensureUiPageEvent(project, 'ui:main', '标题', 'show');
  show.graph.nodes = show.graph.nodes.filter(node => node.type !== 'event');
  assert.equal(ensureUiPageEvent(project, 'ui:main', '标题', 'show').node.type, 'event');
});

test('page interface, local state and shared parameter bindings coexist without duplicating shared state', () => {
  const project = fixture(); project.variables.push({ id: 'visible', name: '可见', type: 'boolean', initial: true, persistent: false });
  const input = createUiPageParameter(project, 'first', 'inputs', '奖励', 'number');
  createBlueprintVariable(project, { scope: 'page', pageId: 'first' }, '次数', 'number', 0);
  const graph = createUiParameterBinding(project, 'first_text', 'visible', 'visible', 'first');
  assert.equal(graph.uiPageId, 'first'); assert.equal(project.variables.filter(variable => variable.id === 'visible').length, 1);
  const run = previewUiLogic(project, project.ui.customPages[0].components, 'first', { visible: false }, [], { pageInputs: { [input.id]: 3 } });
  assert.equal(run.layers[0].components.find(row => row.component.id === 'first_text')?.visible, false);
  assert.equal(project.ui.pageVariables?.first?.length, 1); assert.equal(project.ui.pageVariables?.second, undefined);
});

test('page drafts merge without overwriting unrelated global preferences or another page', () => {
  const base = fixture(), value = structuredClone(base), current = structuredClone(base);
  setUiPageAppearance(value, 'first', 'fontSize', 43);
  setUiPageAppearance(current, 'second', 'textColor', '#123456'); current.playerDefaults = { musicVolume: .3 };
  const merged = applyUiDraft(current, { base, value });
  assert.equal(uiPageTheme(merged, 'first').fontSize, 43); assert.equal(uiPageTheme(merged, 'second').textColor, '#123456');
  assert.equal(merged.playerDefaults?.musicVolume, .3); assert.deepEqual(merged.ui.customPages.map(page => page.components), base.ui.customPages.map(page => page.components));
});
