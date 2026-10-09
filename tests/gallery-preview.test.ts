import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type UiComponent } from '../src/core/model';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const key = (key: string): UiPreviewEvent => ({ kind: 'key', key });
const page = (page: number): UiPreviewEvent => ({ kind: 'gallery', componentId: 'gallery', action: 'page', page });
const open = (groupId: string): UiPreviewEvent => ({ kind: 'gallery', componentId: 'gallery', action: 'open', groupId });
const action = (action: 'next' | 'previous' | 'close'): UiPreviewEvent => ({ kind: 'gallery', componentId: 'gallery', action });
function fixture() {
  const p = createProject();
  p.assets = ['a', 'b', 'c', 'thumb'].map(id => ({ id, name: id, kind: 'image', path: 'assets/' + id + '.png' }));
  const gallery: UiComponent = { id: 'gallery', kind: 'galleryGrid', page: 'gallery', text: '', x: 0, y: 0, width: 1, height: .9, list: { columns: 4, rows: 2, galleryGroups: Array.from({ length: 94 }, (_, i) => ({ id: 'group_' + i, name: '组' + i, thumbnailAssetId: 'thumb', assetIds: i === 0 ? ['c', 'a', 'b'] : i === 1 ? ['b'] : ['a'] })) } };
  p.ui.components = [{ id: 'start', kind: 'button', page: 'main', text: '图鉴', action: 'gallery', x: 0, y: 0, width: 1, height: 1 }, gallery,
    { id: 'back', kind: 'button', page: 'gallery', text: '返回', action: 'return', shortcut: 'e', x: 0, y: .9, width: 1, height: .1 }];
  const sample = (events: UiPreviewEvent[], galleryUnlocks?: string[], timed = false) => previewUiLogic(p, p.ui.components.filter(c => c.page === 'main'), 'ui:main', {}, events, { galleryUnlocks, timed });
  return { p, gallery, sample };
}

test('gallery preview pages 94 groups and opens only unlocked variants in authored order', () => {
  const { p, sample } = fixture(), before = structuredClone(p);
  const first = sample([click('start'), open('group_0')], ['a', 'c']);
  assert.deepEqual(first.gallery.detail?.assetIds, ['c', 'a']); assert.equal(first.gallery.detail?.index, 0); assert.equal(first.incomplete, false);
  const second = sample([click('start'), open('group_0'), action('next')], ['a', 'c']);
  assert.equal(second.gallery.detail?.index, 1);
  assert.equal(sample([click('start'), open('group_0'), action('next'), action('next')], ['a', 'c']).gallery.detail, undefined);
  const last = sample([click('start'), page(11), open('group_93'), action('close')]);
  assert.equal(last.gallery.pages.gallery, 11); assert.equal(last.pageId, 'ui:gallery');
  assert.equal(sample([click('start'), page(11), open('group_93'), action('close'), open('group_93')]).gallery.detail?.index, 0);
  assert.deepEqual(p, before);
});

test('gallery preview rejects locked, missing, off-page and inactive events', () => {
  const { sample } = fixture();
  for (const events of [[open('group_0')], [click('start'), open('group_1')], [click('start'), open('missing')], [click('start'), open('group_93')]]) assert.equal(sample(events, ['a']).gallery.detail, undefined);
  assert.equal(sample([click('start'), open('group_0')], []).gallery.detail, undefined);
  for (const n of [-1, 12, NaN, .5]) assert.equal(sample([click('start'), page(n)]).gallery.pages.gallery, undefined);
  assert.equal(sample([click('start'), page(1), { kind: 'gallery', componentId: 'missing', action: 'open', groupId: 'group_8' }]).gallery.detail, undefined);
});

test('gallery detail consumes page buttons and shortcuts, supports loop and backwards keys', () => {
  const { gallery, sample } = fixture(); gallery.list!.galleryEndAction = 'loop'; gallery.list!.galleryFit = 'cover'; gallery.list!.galleryShowControls = false;
  const events = [click('start'), open('group_0'), action('previous'), key('K_RIGHT'), key('K_LEFT'), action('next'), action('next'), action('next'), click('back'), key('K_e'), page(11)];
  const result = sample(events);
  assert.equal(result.pageId, 'ui:gallery'); assert.equal(result.gallery.detail?.index, 0); assert.equal(result.gallery.pages.gallery, 0);
  assert.equal(result.gallery.detail?.fit, 'cover'); assert.equal(result.gallery.detail?.showControls, false);
  assert.equal(sample([...events, key('K_ESCAPE')]).gallery.detail, undefined);
});

test('gallery page resets on leaving, while returning from its detail preserves the page', () => {
  const { sample } = fixture();
  const events = [click('start'), page(11), open('group_93'), key('K_ESCAPE')];
  assert.equal(sample(events).gallery.pages.gallery, 11);
  const reenter = sample([...events, click('back'), click('start')]);
  assert.deepEqual(reenter.gallery.pages, {}); assert.equal(reenter.gallery.detail, undefined);
});

test('gallery preview replays against changed groups and ignores deleted assets without mutating source', () => {
  const { p, gallery, sample } = fixture();
  const events = [click('start'), page(11), open('group_93')];
  gallery.list!.galleryGroups!.splice(8);
  assert.equal(sample(events).gallery.detail, undefined);
  p.assets = p.assets.filter(asset => asset.id !== 'c');
  assert.deepEqual(sample([click('start'), open('group_0')]).gallery.detail?.assetIds, ['a', 'b']);
  delete gallery.list!.galleryGroups; gallery.list!.assetIds = ['b', 'a'];
  assert.deepEqual(sample([click('start'), open('b')]).gallery.detail?.assetIds, ['b']);
});

test('gallery detail leaves page timers running and blocks underlying keyboard blueprints', () => {
  const { p, sample } = fixture();
  p.variables = [{ id: 'timer', name: '计时', type: 'number', initial: 0, persistent: false }, { id: 'key', name: '按键', type: 'number', initial: 0, persistent: false }];
  for (const [type, variableId] of [['eventTimer', 'timer'], ['eventKey', 'key']] as const) {
    const graph = createBlueprintGraph('ui', type), event = blueprintNodeDefaults(type), set = blueprintNodeDefaults('setVariable');
    event.properties = { pageId: 'ui:gallery', interval: .5, repeat: true, key: 'K_RIGHT' }; set.properties = { variableId, value: 10 };
    graph.nodes.push(event, set); connectBlueprintPins(graph, event.id, 'exec', set.id, 'exec_in'); p.blueprints.push(graph);
  }
  const result = sample([click('start'), open('group_0'), key('K_RIGHT'), { kind: 'advance', seconds: 1 }], undefined, true);
  assert.equal(result.variables.timer, 10); assert.equal(result.variables.key, 0); assert.equal(result.gallery.detail?.index, 1); assert.equal(result.fired, 2);
  const closed = sample([click('start'), open('group_0'), key('K_ESCAPE'), key('K_RIGHT')], undefined, true);
  assert.equal(closed.variables.key, 10);
});

