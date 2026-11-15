import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Project, type UiComponent } from '../src/core/model';
import { galleryLayout, type CollectionRect } from '../src/core/gallery-layout';
import { musicCollectionLayout } from '../src/core/music-preview';
import { voiceCollectionLayout } from '../src/core/voice-preview';
import { collectionLayoutValues, collectionPartDefaultRect, collectionSupports, isCollectionRect, saveSlotLayout } from '../src/core/ui-collection-layout';

function project(): Project {
  const project = createProject('列表属性几何');
  project.width = 1000; project.height = 600; project.ui.fontSize = 24;
  return project;
}
function collection(kind: UiComponent['kind'], extra: Partial<UiComponent> = {}): UiComponent {
  const pages: Partial<Record<UiComponent['kind'], UiComponent['page']>> = {
    choiceList: 'choice', saveSlots: 'save', galleryGrid: 'gallery', musicTrackList: 'musicRoom',
    voiceCollection: 'voiceCollection', chapterList: 'chapterSelect', historyList: 'history',
  };
  return { id: kind, kind, page: pages[kind] ?? 'main', text: '', x: .05, y: 0, width: .9, height: 1, ...extra };
}
function pixels(rect: CollectionRect, width: number, height: number): CollectionRect {
  return { x: rect.x * width, y: rect.y * height, width: rect.width * width, height: rect.height * height };
}
function nearRect(actual: CollectionRect, expected: CollectionRect) {
  for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-8, `${key}: ${actual[key]} != ${expected[key]}`);
}

test('collection fields expose effective gallery pagination and omit controls unused by history and choices', () => {
  const p = project(), gallery = collection('galleryGrid'), before = structuredClone(p);
  const layout = collectionLayoutValues(p, gallery), rendered = galleryLayout(p, gallery);
  assert.equal(layout.columns, 3); assert.equal(layout.rows, 2); assert.equal(layout.pagination, 'fixed');
  assert.equal(layout.itemWidth, rendered.cells[0].width * 900); assert.equal(layout.itemHeight, rendered.cells[0].height * 600);
  const history = collectionLayoutValues(p, collection('historyList', { list: { columns: 7, rows: 4, itemWidth: 180, itemHeight: 100 } }));
  assert.deepEqual(history.fields, ['gapX', 'gapY']);
  assert.equal(history.columns, undefined); assert.equal(history.rows, undefined); assert.equal(history.itemWidth, undefined); assert.equal(history.itemHeight, undefined);
  assert.equal(history.pagination, 'none');
  assert.deepEqual(collectionLayoutValues(p, collection('choiceList')).fields, ['gapY', 'itemHeight']);
  for (const kind of ['choiceList', 'saveSlots', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'historyList'] as const) assert.equal(collectionSupports({ kind }), true);
  assert.equal(collectionSupports({ kind: 'button' }), false); assert.equal(collectionSupports({ kind: 'flowchart' }), false);
  assert.deepEqual(collectionLayoutValues(p, collection('button')).fields, []);
  assert.deepEqual(p, before); assert.equal(gallery.list, undefined);
});

test('save slots retain the runtime grid, footer, navigation and ten-pixel thumbnail inset', () => {
  const p = project(), component = collection('saveSlots'), layout = saveSlotLayout(p, component);
  assert.equal(layout.width, 900); assert.equal(layout.height, 600);
  assert.equal(layout.columns, 3); assert.equal(layout.rows, 2);
  assert.equal(layout.gridTop, 50); assert.equal(layout.gridHeight, 550); assert.equal(layout.gridLeft, 0);
  assert.equal(layout.cellWidth, 293); assert.equal(layout.cellHeight, 270); assert.equal(layout.captionHeight, 32); assert.equal(layout.bodyHeight, 238);
  assert.deepEqual(layout.navigation, { x: 0, y: 0, width: 900, height: 40 });
  assert.deepEqual(layout.navigationLabels, ['上一页', '自动', '快速', '1', '2', '3', '4', '5', '6', '下一页']);
  assert.equal(layout.navGap, 6); assert.equal(layout.navWidth, 84);
  nearRect(pixels(layout.thumbnail, layout.cellWidth, layout.bodyHeight), { x: 10, y: 10, width: 273, height: 218 });
  const bottom = saveSlotLayout(p, { ...component, list: { navigation: 'bottom' } });
  assert.equal(bottom.navigation.y, 560); assert.equal(bottom.gridTop, 0); assert.equal(bottom.gridHeight, layout.gridHeight);
});

test('save layout applies pixel rounding and gap limits, and supports a tiny control without invalid geometry', () => {
  const p = project(), component = collection('saveSlots', { width: .0604, height: .1004, list: { gapX: 1000, gapY: 1000 } });
  const layout = saveSlotLayout(p, component);
  assert.equal(layout.width, 60); assert.equal(layout.height, 60); assert.equal(layout.gapX, 10); assert.equal(layout.gapY, 10);
  assert.equal(layout.cellWidth, 13); assert.equal(layout.cellHeight, 8); assert.equal(layout.bodyHeight, 1);
  assert.ok(isCollectionRect(layout.thumbnail)); assert.ok(isCollectionRect(layout.navigation));
  const fractional = saveSlotLayout(p, collection('saveSlots', { list: { gapX: 2.6, gapY: 10.49, itemWidth: 200.9, itemHeight: 150.9 } }));
  assert.equal(fractional.gapX, 3); assert.equal(fractional.gapY, 10); assert.equal(fractional.cellWidth, 200); assert.equal(fractional.cellHeight, 150);
  const custom = saveSlotLayout(p, collection('saveSlots', { list: { navigationRect: { x: -.02, y: .05, width: 1.2, height: .1 } } }));
  assert.deepEqual(custom.navigation, { x: -17, y: 30, width: 917, height: 60 });
});

test('fixed automatic save and caption options keep their actual footer behavior', () => {
  const p = project();
  const fixed = saveSlotLayout(p, collection('saveSlots', { list: { fixedAutoSlot: true, pageCount: 3 } }));
  assert.equal(fixed.fixedAuto, true); assert.deepEqual(fixed.navigationLabels, ['1', '2', '3']);
  const one = saveSlotLayout(p, collection('saveSlots', { list: { fixedAutoSlot: true, columns: 1, rows: 1 } }));
  assert.equal(one.fixedAuto, false); assert.ok(one.navigationLabels.includes('自动'));
  const hidden = saveSlotLayout(p, collection('saveSlots', { list: { showDelete: false, showLabels: false } }));
  assert.equal(hidden.captionHeight, 0); assert.equal(hidden.bodyHeight, hidden.cellHeight);
  const customCaption = saveSlotLayout(p, collection('saveSlots', { list: { showDelete: false, caption: { x: .1, y: .1, width: .8, height: .8 } } }));
  assert.equal(customCaption.captionHeight, 0);
});

test('enabling custom save thumbnail and navigation preserves their physical placement', () => {
  const p = project();
  for (const navigation of ['top', 'bottom'] as const) {
    const component = collection('saveSlots', { list: { navigation, itemWidth: 243, itemHeight: 219 } });
    const before = structuredClone(component), initial = saveSlotLayout(p, component);
    const changed = { ...component, list: { ...component.list,
      thumbnail: collectionPartDefaultRect(p, component, 'thumbnail'), navigationRect: collectionPartDefaultRect(p, component, 'navigationRect'),
    } };
    const after = saveSlotLayout(p, changed);
    nearRect(after.navigation, initial.navigation); nearRect(after.thumbnail, initial.thumbnail);
    assert.equal(after.gridTop, initial.gridTop); assert.equal(after.gridHeight, initial.gridHeight); assert.equal(after.bodyHeight, initial.bodyHeight);
    assert.deepEqual(component, before);
  }
});

test('default gallery regions are identical to rendered geometry, including staggered cells', () => {
  const p = project(), component = collection('galleryGrid', { list: { layout: 'staggered', staggerX: 100, showLabels: false, itemHeight: 180 } });
  const geometry = galleryLayout(p, component);
  nearRect(collectionPartDefaultRect(p, component, 'thumbnail'), geometry.thumbnail);
  nearRect(collectionPartDefaultRect(p, component, 'navigationRect'), geometry.navigation);
  nearRect(collectionPartDefaultRect(p, component, 'lockedRect'), geometry.locked);
});

test('voice caption geometry preserves the existing ordinary or custom item content bounds', () => {
  const p = project(), component = collection('voiceCollection'), geometry = voiceCollectionLayout(p, component);
  nearRect(pixels(collectionPartDefaultRect(p, component, 'caption'), geometry.cellW, geometry.cellH), {
    x: 8, y: 8, width: geometry.cellW - geometry.favorite.width - 24, height: geometry.cellH - 16,
  });
  nearRect(pixels(collectionPartDefaultRect(p, component, 'voiceFavoriteRect'), geometry.cellW, geometry.cellH), geometry.favorite);
  const custom = { ...component, list: { voiceSingleLine: true } }, customGeometry = voiceCollectionLayout(p, custom);
  nearRect(pixels(collectionPartDefaultRect(p, custom, 'caption'), customGeometry.cellW, customGeometry.cellH), customGeometry.caption);
});

test('optional collections show scrolling accurately and seed pagination from its rendered position', () => {
  const p = project();
  for (const kind of ['musicTrackList', 'voiceCollection', 'chapterList'] as const) {
    const component = collection(kind), unpaged = collectionLayoutValues(p, component);
    assert.equal(unpaged.rows, 0); assert.equal(unpaged.pagination, 'optional'); assert.equal(component.list, undefined);
    const paged = { ...component, list: { columns: 2, rows: 3 } };
    const geometry = kind === 'voiceCollection' ? voiceCollectionLayout(p, paged) : musicCollectionLayout(p, paged);
    nearRect(pixels(collectionPartDefaultRect(p, paged, 'navigationRect'), 900, 600), geometry.navigation);
    assert.ok(isCollectionRect(collectionPartDefaultRect(p, component, 'navigationRect')));
  }
});

test('page typography determines effective choice and music height, and choice caption seeds keep padding', () => {
  const p = project();
  p.ui.pages = { choice: { appearance: { fontSize: 76 } }, musicRoom: { appearance: { fontSize: 48 } } };
  const choice = collection('choiceList'), layout = collectionLayoutValues(p, choice);
  assert.equal(layout.itemHeight, 100);
  nearRect(pixels(collectionPartDefaultRect(p, choice, 'caption'), 900, layout.itemHeight!), { x: 12, y: 6, width: 876, height: 88 });
  assert.equal(collectionLayoutValues(p, collection('musicTrackList')).itemHeight, 76);
  assert.equal(collectionLayoutValues(p, collection('musicTrackList', { style: { fontSize: 30 } })).itemHeight, 58);
});

test('history custom scrollbar starts at the native right edge and save overlays have distinct locations', () => {
  const p = project();
  nearRect(pixels(collectionPartDefaultRect(p, collection('historyList'), 'historyScrollbar'), 900, 600), { x: 880, y: 0, width: 20, height: 600 });
  const parts = (['chapter', 'caption', 'number', 'slotAction'] as const).map(part => collectionPartDefaultRect(p, collection('saveSlots'), part));
  for (const part of parts) assert.ok(isCollectionRect(part));
  assert.equal(new Set(parts.map(rect => JSON.stringify(rect))).size, parts.length);
  const [chapter, caption, number, action] = parts;
  assert.ok(chapter.x + chapter.width <= number.x);
  assert.ok(chapter.y + chapter.height <= caption.y); assert.ok(caption.y + caption.height <= action.y);
});

test('seeding preserves authored offsets without mutating or silently repairing stored values', () => {
  const p = project(), authored = { x: -.3, y: 1.1, width: 1.8, height: .25 };
  const component = collection('saveSlots', { list: { thumbnail: authored } });
  const seeded = collectionPartDefaultRect(p, component, 'thumbnail');
  assert.deepEqual(seeded, authored); assert.notEqual(seeded, authored);
  seeded.x = 0; assert.equal(authored.x, -.3);
  const legacyZero = { ...component, list: { caption: { x: 0, y: 0, width: 0, height: 0 } } };
  assert.deepEqual(collectionPartDefaultRect(p, legacyZero, 'caption'), legacyZero.list.caption);
});

test('zero-area controls still produce finite positive geometry seeds without changing stored dimensions', () => {
  const p = project();
  for (const [kind, part] of [['saveSlots', 'thumbnail'], ['galleryGrid', 'thumbnail'], ['voiceCollection', 'caption'], ['musicTrackList', 'navigationRect'], ['choiceList', 'caption'], ['historyList', 'historyScrollbar']] as const) {
    const component = collection(kind, { width: 0, height: 0 }), before = structuredClone(component);
    assert.ok(isCollectionRect(collectionPartDefaultRect(p, component, part)), `${kind}/${part}`);
    assert.deepEqual(component, before);
  }
});

test('rectangle edits permit offscreen areas and reject nonfinite or empty dimensions', () => {
  assert.equal(isCollectionRect({ x: -2, y: 3, width: 4, height: .001 }), true);
  for (const invalid of [null, undefined, [], { x: 0, y: 0, width: 1 }, { x: '0', y: 0, width: 1, height: 1 },
    ...(['x', 'y', 'width', 'height'] as const).flatMap(key => [NaN, Infinity, -Infinity].map(value => ({ x: 0, y: 0, width: 1, height: 1, [key]: value }))),
    { x: 0, y: 0, width: 0, height: 1 }, { x: 0, y: 0, width: 1, height: 0 }, { x: 0, y: 0, width: -1, height: 1 },
  ]) assert.equal(isCollectionRect(invalid), false);
});
