import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, uiComponentSchema, type UiComponent } from '../src/core/model';
import { prepareUiComponentsForPaste, uiComponentPageProblems } from '../src/core/ui-component-page';
import { duplicateUiSubtree } from '../src/core/ui-hierarchy';

function component(id: string, fields: Partial<UiComponent> = {}): UiComponent {
  return { id, kind: 'text', page: 'main', text: id, x: 0, y: 0, width: .2, height: .1, ...fields };
}

test('specialized controls use the same destination-page rules for paste and saved projects', () => {
  const pages: Partial<Record<UiComponent['kind'], UiComponent['page']>> = {
    choiceList: 'choice', saveSlots: 'save', pauseMenu: 'pause', historyList: 'history', galleryGrid: 'gallery',
    musicTrackList: 'musicRoom', voiceCollection: 'voiceCollection', chapterList: 'chapterSelect', chapterTitle: 'chapterTitle',
    messageBox: 'messageBox', staffRoll: 'staff', keyboard: 'keyboard', flowchart: 'flowchart', gameOver: 'gameOver',
  };
  for (const [kind, page] of Object.entries(pages) as [UiComponent['kind'], UiComponent['page']][]) {
    const original = component('special', { kind, page });
    assert.doesNotThrow(() => prepareUiComponentsForPaste([original], page), kind);
    assert.deepEqual(uiComponentPageProblems(original), [], kind);
    assert.throws(() => prepareUiComponentsForPaste([original], 'main'), /不能粘贴/, kind);
    const parsed = uiComponentSchema.safeParse({ ...original, page: 'main' });
    assert.equal(parsed.success, false, kind);
    if (!parsed.success) assert.ok(parsed.error.issues.some(issue => issue.path[0] === 'page'), kind);
  }
});

test('page-bound text and confirmation actions remain intact when a destination is incompatible', () => {
  const originals = [
    component('dialogue', { page: 'say', binding: 'dialogue' }),
    component('speaker', { page: 'say', binding: 'speaker' }),
    component('title', { binding: 'title' }),
    component('confirmation', { page: 'messageBox', binding: 'confirmation' }),
    component('minigame', { page: 'custom', binding: 'minigamePrompt' }),
    component('confirm', { kind: 'button', page: 'messageBox', action: 'confirmYes' }),
    component('cancel', { kind: 'button', page: 'messageBox', action: 'confirmNo' }),
  ];
  const before = structuredClone(originals);
  for (const original of originals) {
    const page = original.page === 'main' ? 'save' : 'main';
    assert.throws(() => prepareUiComponentsForPaste([original], page), /不能粘贴/);
    assert.equal(uiComponentSchema.safeParse({ ...original, page }).success, false);
  }
  assert.deepEqual(originals, before, '拒绝时不能去掉内容来源或按钮动作');
});

test('ordinary hierarchies and parameter-backed controls paste across pages without losing relationships or bindings', () => {
  const project = createProject('跨页粘贴'), originals = [
    component('button', { kind: 'button', action: 'start', editor: { hidden: true, locked: true, listOrder: 2 } }),
    component('caption', { parentId: 'button', childLayer: 'foreground', text: '开始' }),
    component('picture', { kind: 'image', parentId: 'button', childLayer: 'background', assetId: 'picture_asset' }),
    component('tooltip', { parentId: 'button', binding: 'tooltip' }),
    component('slider', { kind: 'preference', parameterId: 'value_source' }),
    component('input', { kind: 'preferenceChoice', parameterId: 'text_source', input: { maxLength: 30 } }),
  ];
  const before = structuredClone(originals);
  let nextId = 0;
  const copied = ['button', 'slider', 'input'].flatMap(root => duplicateUiSubtree(originals, root, () => 'copy_' + ++nextId));
  const pasted = prepareUiComponentsForPaste(copied, 'custom');
  assert.ok(pasted.every(item => item.page === 'custom' && item.editor?.hidden === false && item.editor.locked === false));
  assert.equal(pasted[1].parentId, pasted[0].id);
  assert.equal(pasted[2].assetId, 'picture_asset');
  assert.equal(pasted[3].binding, 'tooltip');
  assert.equal(pasted[4].parameterId, 'value_source');
  assert.equal(pasted[5].parameterId, 'text_source');
  project.assets.push({ id: 'picture_asset', name: '图片', kind: 'image', path: 'assets/picture.png' });
  project.variables.push({ id: 'value_source', name: '数值', type: 'number', initial: 0, persistent: false }, { id: 'text_source', name: '文字', type: 'string', initial: '', persistent: false });
  project.ui.components = [];
  project.ui.customPages.push({ id: 'custom_page', name: '自定义', modal: true, components: pasted });
  assert.equal(projectSchema.safeParse(project).success, true);
  assert.deepEqual(originals, before);
});

test('built-in preference controls keep their native-page constraint while unfinished same-page drafts remain copyable', () => {
  const native = component('native', { page: 'preferences', kind: 'preference', preference: 'musicVolume' });
  assert.equal(prepareUiComponentsForPaste([native], 'voiceSettings')[0].preference, 'musicVolume');
  assert.throws(() => prepareUiComponentsForPaste([native], 'main'), /玩家设置/);
  const unfinished = component('unfinished', { kind: 'button', action: 'blueprint' });
  assert.equal(uiComponentSchema.safeParse(unfinished).success, false, '完整保存检查仍要求选定蓝图');
  for (const page of ['main', 'custom'] as const) {
    const [pasted] = prepareUiComponentsForPaste([unfinished], page);
    assert.equal(pasted.action, 'blueprint');
    assert.equal(pasted.blueprintId, undefined, '粘贴只检查换页造成的问题，保留未完成草稿');
  }
});

test('an incompatible descendant or another selected root rejects the whole paste before any mutation', () => {
  for (const placement of ['child', 'root'] as const) {
    const originals = [
      component('first', { page: 'save', kind: 'button' }),
      component('second', { page: 'save', kind: 'panel' }),
      component('slots', { name: '本机存档', page: 'save', kind: 'saveSlots', ...(placement === 'child' ? { parentId: 'second' } : {}) }),
    ];
    const before = structuredClone(originals), destination = [component('existing')];
    assert.throws(() => destination.push(...prepareUiComponentsForPaste(originals, 'main')), /本机存档.*标题.*存读档/);
    assert.deepEqual(destination, [component('existing')]);
    assert.deepEqual(originals, before, '前面的合法对象也不能先改页、改锁定或改选择');
  }
});
