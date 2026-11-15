import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, uiComponentSchema, type UiComponent } from '../src/core/model';
import { collectionTextStyle, editCollectionTextStyle } from '../src/core/ui-collection-text';
import { setCollectionOption } from '../src/core/ui-collection-edit';

function fixture() {
  const project = createProject('列表部件文字');
  project.width = 1000; project.height = 600;
  project.assets = [
    { id: 'page_font', name: '页面字体', kind: 'font', path: 'assets/page.ttf' },
    { id: 'part_font', name: '部件字体', kind: 'font', path: 'assets/part.ttf' },
  ];
  project.ui.fontSize = 28; project.ui.textColor = '#eeeeee';
  project.ui.pages = { save: { appearance: { fontAssetId: 'page_font', fontSize: 30, textColor: '#dddddd' } }, history: { appearance: { fontSize: 32 } } };
  const component: UiComponent = { id: 'slots', kind: 'saveSlots', page: 'save', text: '', x: 0, y: 0, width: .9, height: 1,
    list: { caption: { x: .1, y: .3, width: .8, height: .4 }, summaryFontSize: 23 } };
  return { project, component };
}

test('part edits and reset preserve legacy summary size and independent chapter typography', () => {
  const { project, component } = fixture();
  component.list!.textStyles = { chapter: { fontSize: 40, align: 'right' } };
  editCollectionTextStyle(component, 'caption', style => { style.fontSize = 31; style.fontAssetId = 'part_font'; });
  assert.equal(collectionTextStyle(project, component, 'caption').fontSize, 31);
  assert.equal(collectionTextStyle(project, component, 'caption').fontAssetId, 'part_font');
  editCollectionTextStyle(component, 'caption', style => { delete style.fontSize; });
  assert.equal(collectionTextStyle(project, component, 'caption').fontSize, 23);
  assert.equal(component.list!.summaryFontSize, 23);
  assert.deepEqual(component.list!.textStyles!.chapter, { fontSize: 40, align: 'right' });
  assert.equal(component.list!.textStyles!.caption!.fontAssetId, 'part_font');
  editCollectionTextStyle(component, 'caption', style => { delete style.fontAssetId; });
  assert.equal(Object.hasOwn(component.list!.textStyles!, 'caption'), false);
  assert.equal(collectionTextStyle(project, component, 'caption').fontAssetId, 'page_font');
});

test('saving only a caption override accepts RGBA without creating other part overrides', () => {
  const { component } = fixture();
  const parsed = uiComponentSchema.parse({ ...component, list: { ...component.list, textStyles: { caption: { textColor: '#12345680' } } } });
  assert.deepEqual(parsed.list!.textStyles, { caption: { textColor: '#12345680' } });
  assert.equal(parsed.list!.summaryFontSize, 23);
  assert.equal(uiComponentSchema.safeParse({ ...component, list: { textStyles: { caption: { fontSize: 0 } } } }).success, false);
});

test('automatic footer uses time-label defaults, while custom summary keeps its legacy size', () => {
  const { project, component } = fixture();
  assert.equal(collectionTextStyle(project, component, 'caption').fontSize, 23);
  assert.equal(collectionTextStyle(project, component, 'caption').align, 'center');
  setCollectionOption(component, 'caption', undefined);
  const footer = collectionTextStyle(project, component, 'caption');
  assert.equal(footer.fontSize, 19); // 900px, 3 columns, 10px gaps => 293px cards, time labels use floor(width / 15).
  assert.equal(footer.align, 'left');
  assert.equal(component.list!.summaryFontSize, 23);
  editCollectionTextStyle(component, 'caption', style => { style.fontSize = 37; style.align = 'right'; });
  assert.equal(collectionTextStyle(project, component, 'caption').fontSize, 37);
  assert.equal(collectionTextStyle(project, component, 'caption').align, 'right');
});

test('missing part font falls back to the current base without altering the saved reference', () => {
  const { project, component } = fixture();
  component.list!.textStyles = { caption: { fontAssetId: 'missing_font', fontSize: 35 } };
  const before = structuredClone(component);
  assert.equal(collectionTextStyle(project, component, 'caption').fontAssetId, 'page_font');
  assert.equal(collectionTextStyle(project, component, 'caption').fontSize, 35);
  assert.deepEqual(component, before);
  component.style = { fontAssetId: 'missing_base' };
  assert.equal(collectionTextStyle(project, component, 'caption').fontAssetId, undefined);
});

test('history name typography is effective in stacked and column layouts and reset follows the page', () => {
  const { project, component } = fixture();
  component.kind = 'historyList'; component.page = 'history'; component.list = { historyNameFontSize: 38 };
  assert.equal(collectionTextStyle(project, component, 'historyName').fontSize, 38);
  assert.equal(collectionTextStyle(project, component, 'historyName').align, 'left');
  component.list.historyLayout = 'columns';
  assert.equal(collectionTextStyle(project, component, 'historyName').align, 'right');
  editCollectionTextStyle(component, 'historyText', style => { style.fontSize = 18; });
  editCollectionTextStyle(component, 'historyText', style => { style.fontSize = undefined; });
  assert.equal(Object.hasOwn(component.list, 'textStyles'), false);
  project.ui.pages!.history!.appearance!.fontSize = 34;
  assert.equal(collectionTextStyle(project, component, 'historyText').fontSize, 34);
});

test('restoring collection options deletes numeric overrides and preserves false and zero', () => {
  const { component } = fixture();
  setCollectionOption(component, 'itemWidth', 280);
  setCollectionOption(component, 'itemHeight', 120);
  setCollectionOption(component, 'showLabels', false);
  setCollectionOption(component, 'gapY', 0);
  setCollectionOption(component, 'itemWidth', undefined);
  setCollectionOption(component, 'itemHeight', undefined);
  assert.equal(Object.hasOwn(component.list!, 'itemWidth'), false);
  assert.equal(Object.hasOwn(component.list!, 'itemHeight'), false);
  assert.equal(component.list!.showLabels, false);
  assert.equal(component.list!.gapY, 0);
  assert.equal(component.list!.summaryFontSize, 23);
});
