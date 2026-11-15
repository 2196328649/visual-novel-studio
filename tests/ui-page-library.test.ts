import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type Project, type UiComponent, type VisualObject } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createCustomUiPage, connectPageToButton } from '../src/core/game-flow';
import { createUiEventGraph, ensureUiClickEvent } from '../src/core/ui-logic';
import { builtinUiPages, builtinUiPageId, type BuiltinUiPage } from '../src/core/ui-page-catalog';
import { collectUiPageUsages, pageConnectionButtons, uiPageUsageSummary } from '../src/core/ui-page-usages';
import { chapterEditorEntries, enableUiPage, uiPickerPages, uiSelectionContext, uiSelectionFallback } from '../src/core/ui-page-authoring';
import { uiMenuShortcut, uiMenuShortcutScreen } from '../src/core/ui-availability';
import { nativePreferencePreview } from '../src/core/ui-native-preview';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';
import { createScreens } from '../src/runtime/screens';
import { chapterBlueprintPair, createChapterPerformance } from '../src/core/chapter-performances';
import { addProjectGraphs } from '../src/core/project-resources';
import { chapterTitleRect } from '../src/core/chapter';
import { chapterComposition } from '../src/core/chapter-composition';
import { createChapterRuntime } from '../src/runtime/chapter-runtime';

const button = (id: string, page: UiComponent['page'], action?: UiComponent['action']): UiComponent => ({ id, page, action, kind: 'button', text: id, x: .1, y: .1, width: .2, height: .1 });
function project() {
  const p = createProject(); p.ui.components = []; p.ui.disabledPages = [];
  p.ui.pages = Object.fromEntries(Object.keys(builtinUiPages).map(id => [id, { layout: 'custom', showQuickMenu: false }]));
  p.ui.menuShortcutPage = 'preferences';
  return p;
}
function wire(graph: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = from.type.startsWith('event') ? 'exec' : 'exec_out', input = 'exec_in') {
  assert.equal(connectBlueprintPins(graph, from.id, output, to.id, input), undefined);
}
function callGraph(p: Project, pageId: string, type: 'showUiPage' | 'uiAction' = 'showUiPage') {
  const graph = createBlueprintGraph('function', '打开 ' + pageId), open = blueprintNodeDefaults(type);
  open.properties[type === 'uiAction' ? 'screen' : 'pageId'] = pageId;
  graph.nodes.push(open); p.blueprints.push(graph); wire(graph, graph.nodes[0], open);
  return { graph, open };
}
const rows = (p: Project, id: string) => collectUiPageUsages(p).get(id) ?? [];
const entries = (p: Project, id: string) => rows(p, id).filter(use => !use.reference && !use.inactive);

test('page picker separates optional and legacy pages, retaining an explicitly browsed page without mutation', () => {
  const p = project(), custom = createCustomUiPage(p, '我的页面'); p.ui.disabledPages = ['staff'];
  const before = structuredClone(p), usages = collectUiPageUsages(p);
  const picker = uiPickerPages(p, 'ui:main', usages).map(page => page.id);
  assert.ok(picker.includes('ui:messageBox') && picker.includes(custom.id));
  assert.ok(!picker.includes('ui:pause') && !picker.includes('ui:chapterTitle') && !picker.includes('ui:staff'));
  assert.ok(uiPickerPages(p, 'ui:pause', usages).some(page => page.id === 'ui:pause'));
  assert.ok(uiPickerPages(p, 'ui:chapterTitle', usages).some(page => page.id === 'ui:chapterTitle'));
  assert.ok(uiPickerPages(p, 'ui:staff', usages).some(page => page.id === 'ui:staff' && page.disabled));
  assert.deepEqual(p, before);
  p.ui.components.push(button('open_pause', 'say', 'pause'));
  assert.ok(uiPickerPages(p, 'ui:main', collectUiPageUsages(p)).some(page => page.id === 'ui:pause'));
});

test('enabling a page preserves authored data and selection never falls back to a disabled title', () => {
  const p = project(); p.ui.disabledPages = ['main', 'staff']; p.ui.components.push(button('staff_back', 'staff', 'return'));
  const before = structuredClone(p.ui.components), settings = structuredClone(p.ui.pages);
  assert.equal(uiSelectionFallback(p).page, 'say'); enableUiPage(p, 'staff');
  assert.deepEqual(p.ui.disabledPages, ['main']); assert.deepEqual(p.ui.components, before); assert.deepEqual(p.ui.pages, settings);
  p.ui.disabledPages = Object.keys(builtinUiPages) as BuiltinUiPage[];
  const custom = createCustomUiPage(p, '备用'); assert.deepEqual(uiSelectionFallback(p), { page: 'custom', customPageId: custom.id });
});

test('selection context restores only active, existing, enabled component pages and save mode', () => {
  const p = project(), base = button('shared', 'main'), save = button('save_slots', 'save'); save.saveMode = 'load';
  p.ui.components.push(base, save);
  p.ui.instances = [{ id: 'derived', name: '派生方案', components: [button('shared', 'save')] }]; p.ui.activeInstanceId = 'derived';
  assert.deepEqual(uiSelectionContext(p, 'shared'), { page: 'save' });
  assert.deepEqual(uiSelectionContext(p, 'save_slots'), { page: 'save', saveMode: 'load' });
  assert.equal(uiSelectionContext(p, 'deleted'), undefined);
  p.ui.disabledPages = ['save']; assert.equal(uiSelectionContext(p, 'shared'), undefined);
  const custom = createCustomUiPage(p, '存档管理'); custom.components.push(button('custom_slots', 'custom'));
  assert.deepEqual(uiSelectionContext(p, 'custom_slots'), { page: 'custom', customPageId: custom.id });
});

test('system aliases, native menus and Esc are counted while an unconnected pause page stays optional', () => {
  const p = createProject(); p.ui.menuShortcutPage = 'preferences'; p.ui.disabledPages = ['voiceSettings'];
  assert.equal(builtinUiPageId('load'), 'ui:save'); assert.equal(builtinUiPageId('music_room'), 'ui:musicRoom');
  assert.equal(builtinUiPageId('ui:pause'), 'ui:pause'); assert.equal(builtinUiPageId('missing'), undefined);
  assert.equal(builtinUiPages.messageBox.name, '确认对话框');
  assert.ok(entries(p, 'ui:main').some(use => use.system));
  assert.ok(entries(p, 'ui:preferences').some(use => use.setting === 'menuShortcut'));
  assert.ok(entries(p, 'ui:save').some(use => use.pageId === 'ui:main'));
  assert.equal(entries(p, 'ui:pause').length, 0); assert.equal(entries(p, 'ui:voiceSettings').length, 0);
});

test('usage analysis follows static screen links and never treats a variable initial value as its live target', () => {
  const p = project(), { graph, open } = callGraph(p, 'pause_menu', 'uiAction');
  const literal = blueprintNodeDefaults('literal'); literal.properties.value = 'voice_collection'; literal.pins[0].dataType = 'ui'; graph.nodes.push(literal);
  wire(graph, literal, open, literal.pins[0].id, 'screen');
  p.ui.components.push({ ...button('open', 'main', 'blueprint'), blueprintId: graph.id });
  assert.ok(entries(p, 'ui:voiceCollection').some(use => use.componentId === 'open'));
  assert.equal(entries(p, 'ui:pause').length, 0);
  graph.links = graph.links.filter(link => link.toPinId !== 'screen');
  const read = blueprintNodeDefaults('getVariable'); read.properties.variableId = 'destination'; read.pins[0].dataType = 'ui'; graph.nodes.push(read);
  p.variables.push({ id: 'destination', name: '目标页面', type: 'string', initial: 'pause_menu', persistent: false }); wire(graph, read, open, 'value', 'screen');
  assert.equal(entries(p, 'ui:pause').length, 0); assert.ok(rows(p, 'ui:pause').some(use => use.dynamic));
  assert.equal(uiPageUsageSummary(rows(p, 'ui:pause')), '存在动态调用');
});

test('distinct click roots do not cross-contaminate usage, and disconnected open nodes are references only', () => {
  const p = project(), a = button('a', 'main'), b = button('b', 'main'); p.ui.components.push(a, b);
  const graph = createUiEventGraph(p, 'ui:main', '主菜单');
  const pause = blueprintNodeDefaults('showUiPage'); pause.properties.pageId = 'ui:pause';
  const voices = blueprintNodeDefaults('showUiPage'); voices.properties.pageId = 'ui:voiceCollection';
  const spare = blueprintNodeDefaults('showUiPage'); spare.properties.pageId = 'ui:staff';
  graph.nodes.push(pause, voices, spare); wire(graph, ensureUiClickEvent(p, graph, a.id, 'ui:main'), pause); wire(graph, ensureUiClickEvent(p, graph, b.id, 'ui:main'), voices);
  assert.deepEqual(entries(p, 'ui:pause').filter(use => use.componentId).map(use => use.componentId), ['a']);
  assert.deepEqual(entries(p, 'ui:voiceCollection').filter(use => use.componentId).map(use => use.componentId), ['b']);
  assert.equal(entries(p, 'ui:staff').length, 0); assert.ok(rows(p, 'ui:staff').every(use => use.reference));
});

test('task and macro callers retain their story origin, and cycles terminate', () => {
  const p = project(), leaf = callGraph(p, 'ui:pause');
  let callee = leaf.graph;
  for (const type of ['callMacro', 'startTask', 'debounce'] as const) {
    const graph = createBlueprintGraph(type === 'callMacro' ? 'macro' : 'function', type), node = blueprintNodeDefaults(type);
    node.properties.graphId = callee.id; graph.nodes.push(node); p.blueprints.push(graph); synchronizeBlueprintSignatures(p); wire(graph, graph.nodes[0], node); callee = graph;
  }
  const line = p.nodes.find(node => node.kind === 'passage')!.lines[0]; line.actions.push({ kind: 'blueprint', blueprintId: callee.id });
  assert.ok(entries(p, 'ui:pause').some(use => use.lineId === line.id));
  const recurse = blueprintNodeDefaults('callFunction'); recurse.properties.graphId = callee.id; leaf.graph.nodes.push(recurse); synchronizeBlueprintSignatures(p); wire(leaf.graph, leaf.open, recurse);
  assert.ok(entries(p, 'ui:pause').some(use => use.lineId === line.id));
});

test('disabled sources and other schemes stay visible as references without becoming current entries', () => {
  const p = project(); p.ui.components.push(button('from_staff', 'staff', 'pause'));
  p.ui.disabledPages = ['staff']; p.ui.instances = [{ id: 'alternate', name: '另一方案', components: [button('alternate_pause', 'main', 'pause')] }];
  assert.equal(entries(p, 'ui:pause').length, 0);
  assert.ok(rows(p, 'ui:pause').some(use => use.componentId === 'from_staff' && use.inactive));
  assert.ok(rows(p, 'ui:pause').some(use => use.instanceId === 'alternate' && use.inactive));
  assert.ok(!pageConnectionButtons(p).some(row => row.pageId === 'ui:staff'));
  p.ui.activeInstanceId = 'alternate'; assert.ok(entries(p, 'ui:pause').some(use => use.componentId === 'alternate_pause'));
});

test('page show, lifecycle and state references have distinct ownership and legacy uiAction can open custom pages', () => {
  const p = project(), custom = createCustomUiPage(p, '额外界面'), onShow = callGraph(p, custom.id, 'uiAction');
  p.ui.customPages[0].onShowBlueprintId = onShow.graph.id;
  assert.ok(entries(p, custom.id).some(use => use.pageId === custom.id && use.label.includes('显示时')));
  const graph = createUiEventGraph(p, 'ui:main', '关闭事件'), event = blueprintNodeDefaults('eventPage'), open = blueprintNodeDefaults('showUiPage');
  event.properties = { pageId: 'ui:main', phase: 'closed' }; open.properties.pageId = 'ui:pause'; graph.nodes.push(event, open); wire(graph, event, open);
  assert.ok(entries(p, 'ui:pause').some(use => use.nodeId === event.id));
  const read = blueprintNodeDefaults('getVariable'); read.properties = { scope: 'page', pageId: 'ui:voiceCollection', variableId: 'hits' }; graph.nodes.push(read);
  p.ui.pageVariables = { 'ui:voiceCollection': [{ id: 'hits', name: '浏览次数', type: 'number', initial: 0 }] };
  assert.ok(rows(p, 'ui:voiceCollection').some(use => use.reference && use.nodeId === read.id));
  assert.equal(entries(p, 'ui:voiceCollection').length, 0);
});

test('replacing a native page action is allowed for inputs, while appending the same destination remains blocked', () => {
  const p = project(), c = button('settings', 'main', 'preferences'); p.ui.components.push(c);
  assert.throws(() => connectPageToButton(p, 'ui:preferences', 'ui:main', c.id, 'append'), /已经接入/);
  const graph = connectPageToButton(p, 'ui:preferences', 'ui:main', c.id, 'replace');
  assert.equal(c.action, 'blueprint'); assert.equal(c.blueprintId, graph.id);
  assert.throws(() => connectPageToButton(p, 'ui:preferences', 'ui:main', c.id, 'append'), /已经接入/);
});

test('chapter shortcuts use resource identity and preserve directly used child timelines', () => {
  const p = project(), pair = chapterBlueprintPair(createChapterPerformance(p, 'text')); addProjectGraphs(p, ...pair);
  const line = p.nodes.find(node => node.kind === 'passage')!.lines[0]; line.actions = [{ kind: 'blueprint', blueprintId: pair[0].id }];
  pair[0].name = '我的开场'; const before = JSON.stringify(p), entries = chapterEditorEntries(p);
  assert.equal(entries.length, 1); assert.equal(entries[0].name, '我的开场'); assert.equal(entries[0].used, true);
  assert.deepEqual(entries[0].target, { nodeId: p.nodes.find(node => node.kind === 'passage')!.id, lineId: line.id, graphId: pair[0].id, actionIndex: 0, editorMode: 'timeline' });
  assert.equal(JSON.stringify(p), before);
  line.actions.push({ kind: 'blueprint', blueprintId: pair[1].id }); assert.equal(chapterEditorEntries(p).length, 2);
});

test('Esc falls back only to enabled menus, and missing authored targets are inert in preview', () => {
  const p = createProject(); p.ui.components = []; p.ui.menuShortcutPage = 'pause'; p.ui.disabledPages = ['pause'];
  assert.equal(uiMenuShortcut(p.ui), 'save'); p.ui.disabledPages.push('save'); assert.equal(uiMenuShortcutScreen(p.ui), 'preferences');
  p.ui.disabledPages.push('preferences'); assert.equal(uiMenuShortcut(p.ui), undefined);
  const c = button('removed', 'main', 'pause'); p.ui.components.push(c);
  const preview = previewUiLogic(p, [c], 'ui:main', {}, [{ kind: 'click', componentId: c.id }]);
  assert.equal(preview.pageId, 'ui:main'); assert.equal(preview.components[0].state, 'disabled'); assert.equal(preview.incomplete, false);
  const compiled = compileProject(p); assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.match(compiled.files['game/options.rpy'], /_game_menu_screen = None/);
});

test('all native menus and pause widgets omit disabled targets, preserving the underlying system hosts', () => {
  const p = project(); p.ui.disabledPages = ['save', 'preferences', 'gallery', 'voiceSettings', 'say', 'choice', 'messageBox', 'chapterTitle', 'keyboard'];
  p.ui.components.push({ ...button('pause_widget', 'pause'), kind: 'pauseMenu' }, { ...button('say_text', 'say'), kind: 'text', binding: 'dialogue' }, { ...button('choices', 'choice'), kind: 'choiceList' });
  const source = createScreens(p);
  for (const name of ['save', 'load', 'preferences', 'gallery', 'voice_settings']) assert.doesNotMatch(source, new RegExp('^screen ' + name + '\\(', 'm'));
  const pause = source.split('elif kind == "pauseMenu":')[1].split('elif ')[0];
  assert.doesNotMatch(pause, /保存进度|读取存档|设置/); assert.match(pause, /继续游戏/);
  assert.match(source, /screen say\(who, what\):[\s\S]*?vn_dialogue_text what id "what"/);
  assert.match(source, /screen choice\(items\):\n[\s\S]*?for item in items:/);
  assert.match(source, /screen confirm\([\s\S]*?textbutton "确认" action yes_action/);
  assert.match(source, /screen input\(prompt\):/); assert.match(source, /screen vn_chapter_title\(/);
  assert.doesNotMatch(source, /use vn_components_(?:say|choice|messageBox|chapterTitle|keyboard)\b/);
});

test('disabled authored system pages use native fallbacks without requiring unfinished controls', () => {
  const p = project(); p.ui.disabledPages = ['say', 'choice', 'messageBox'];
  const disabled = compileProject(p);
  assert.deepEqual(disabled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.match(disabled.files['game/screens.rpy'], /screen confirm\(/);
  const expected = { say: ['当前对白'], choice: ['选项列表'], messageBox: ['确认提示', '确认”按钮', '取消”按钮'] } as const;
  for (const page of ['say', 'choice', 'messageBox'] as const) {
    const enabled = structuredClone(p); enableUiPage(enabled, page);
    const errors = compileProject(enabled).diagnostics.filter(issue => issue.severity === 'error');
    assert.equal(errors.length, expected[page].length);
    for (const required of expected[page]) assert.ok(errors.some(issue => issue.message.includes(required)));
  }
});

test('native settings preview removes disabled role-volume entry and returns safely when its parent is disabled', () => {
  const p = createProject(); p.ui.components = []; p.ui.disabledPages = ['voiceSettings'];
  const preview = nativePreferencePreview(p, 'ui:preferences', [])!;
  assert.ok(!preview.components.some(c => c.action === 'voiceSettings'));
  p.ui.disabledPages = ['preferences']; p.ui.components.push(button('voices', 'main', 'voiceSettings'), button('back', 'voiceSettings', 'return'));
  const state = previewUiLogic(p, p.ui.components.filter(c => c.page === 'main'), 'ui:main', {}, [{ kind: 'click', componentId: 'voices' }, { kind: 'click', componentId: 'back' }]);
  assert.equal(state.pageId, 'ui:main'); assert.equal(state.incomplete, false);
});

test('derived chapter geometry, color and runtime glyph font follow the effective scheme', () => {
  const p = project(), base: UiComponent = { ...button('chapter', 'chapterTitle'), kind: 'chapterTitle', style: { textColor: '#112233' } };
  const derived = { ...base, x: .25, y: .35, width: .5, height: .2, style: { textColor: '#abcdef', fontSize: 71, fontAssetId: 'derived_font' } };
  p.ui.components.push(base); p.ui.instances = [{ id: 'derived', name: '派生', components: [derived] }]; p.ui.activeInstanceId = 'derived';
  p.assets.push({ id: 'derived_font', name: '章节字体', path: 'assets/chapter.ttf', kind: 'font' });
  assert.deepEqual(chapterTitleRect(p), { x: .25, y: .35, width: .5, height: .2 });
  const result = chapterComposition(p, { title: '第一章', subtitle: '', duration: 3, effect: 'none' }, {}, { fourPartText: true });
  const root = result.actions.at(-1) as VisualObject;
  const texts = root.children![1].children!.filter(child => child.content === 'text'); assert.equal(texts.length, 4);
  assert.ok(texts.every(child => child.color === '#abcdef'));
  assert.match(createChapterRuntime(p), /Text\(title, font="assets\/chapter.ttf", size=71\)/);
});
