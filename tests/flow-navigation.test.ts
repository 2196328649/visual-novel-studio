import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { ensureStoryFlowScrollbar, setStoryFlowPaginationRect, setStoryFlowScrollbarRect, storyFlowBrowseLayout, storyFlowDirectoryLayout, storyFlowPaginationStyle } from '../src/core/story-flow';
import { compileProject } from '../src/runtime/compiler';

const flow = (list: UiComponent['list'] = {}): UiComponent => ({ id: 'flow_navigation', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow', ...list } });
const viewport = { x: .1, y: .2, width: .8, height: .6 };
const rail = { x: .3, y: .9, width: .4, height: .04 };
const skin = { idle: 'normal', selected: 'current', fit: 'nineSlice' as const, brightness: { pressed: .65 } };

test('restoring a flow rail position preserves the whole appearance and other browsing options', () => {
  const component = flow({ flowViewport: viewport, flowScrollbar: { rect: rail, trackId: 'rail', thumb: skin, trackHeight: 5, thumbHeight: 31 }, flowShowControls: false, flowShowVerticalScrollbar: false });
  const before = structuredClone(component);
  setStoryFlowScrollbarRect(component);
  assert.deepEqual(component, { ...before, list: { ...before.list, flowScrollbar: { trackId: 'rail', thumb: skin, trackHeight: 5, thumbHeight: 31 } } });
  setStoryFlowScrollbarRect(component, rail);
  assert.deepEqual(component, before);
  const untouched = flow();
  setStoryFlowScrollbarRect(untouched);
  assert.deepEqual(untouched, flow());
});

test('appearance can be configured on an automatic rail without moving or resizing its initial track', () => {
  const project = createProject(), component = flow();
  const original = storyFlowBrowseLayout(project, component);
  ensureStoryFlowScrollbar(component).trackId = 'rail';
  assert.equal(component.list?.flowScrollbar?.rect, undefined);
  assert.deepEqual(storyFlowBrowseLayout(project, component), original);
  assert.deepEqual(component.list?.flowScrollbar, { trackHeight: 16, thumbHeight: 16, trackId: 'rail' });
});

test('an automatic styled rail follows the live viewport, controls and component dimensions', () => {
  const project = createProject(); project.width = 1000; project.height = 800;
  const component = flow({ flowViewport: viewport, flowScrollbar: { thumb: skin, trackHeight: 5, thumbHeight: 31.5 }, flowShowControls: false, flowShowVerticalScrollbar: false });
  const first = storyFlowBrowseLayout(project, component);
  assert.deepEqual(first.view, { x: 100, y: 160, width: 800, height: 480 });
  assert.deepEqual(first.scrollbar, { x: 100, y: 609, width: 800, height: 31 });
  assert.equal(first.contentHeight, 441);
  component.list!.flowShowControls = true; component.list!.flowShowVerticalScrollbar = true;
  const controls = storyFlowBrowseLayout(project, component);
  assert.deepEqual(controls.scrollbar, { x: 100, y: 565, width: 776, height: 31 });
  component.width = .5; component.height = .5;
  const resized = storyFlowBrowseLayout(project, component);
  assert.deepEqual(resized.scrollbar, { x: 50, y: 245, width: 376, height: 31 });
  assert.equal(component.list!.flowScrollbar!.rect, undefined);
});

test('an existing custom flow rail keeps its authored geometry and leaves the viewport height unchanged', () => {
  const project = createProject(); project.width = 1000; project.height = 800;
  const component = flow({ flowViewport: viewport, flowScrollbar: { rect: rail, thumb: skin }, flowShowControls: false, flowShowVerticalScrollbar: false });
  const layout = storyFlowBrowseLayout(project, component);
  assert.deepEqual(layout.scrollbar, { x: 300, y: 720, width: 400, height: 32 });
  assert.equal(layout.contentHeight, 480);
  assert.equal(layout.contentWidth, 800);
  component.list!.flowViewport = { x: 0, y: 0, width: .5, height: .5 };
  assert.deepEqual(storyFlowBrowseLayout(project, component).scrollbar, layout.scrollbar);
});

test('legacy directory navigation resolves without migration and restoring its position preserves numeric pages', () => {
  const component = flow({ layout: 'grid', rows: 2, navigationRect: rail, pageSkin: skin });
  const original = structuredClone(component);
  assert.equal(storyFlowPaginationStyle(component.list), 'numbers');
  assert.deepEqual(component, original);
  setStoryFlowPaginationRect(component);
  assert.equal(component.list?.navigationRect, undefined);
  assert.equal(component.list?.flowPaginationStyle, 'numbers');
  assert.deepEqual(component.list?.pageSkin, skin);
  assert.equal(storyFlowPaginationStyle(component.list), 'numbers');
  setStoryFlowPaginationRect(component, rail);
  assert.equal(storyFlowPaginationStyle(component.list), 'numbers');
  assert.deepEqual(component.list?.pageSkin, skin);
});

test('moving previous/next pagination does not switch it to numeric pages and display styles share automatic geometry', () => {
  const project = createProject(); project.width = 1000; project.height = 800;
  const component = flow({ layout: 'grid', columns: 2, rows: 3, gapY: 12 });
  assert.equal(storyFlowPaginationStyle(component.list), 'previousNext');
  const automatic = storyFlowDirectoryLayout(project, component);
  assert.deepEqual(automatic.navigation, { x: 0, y: 760, width: 1000, height: 40 });
  setStoryFlowPaginationRect(component, rail);
  assert.equal(storyFlowPaginationStyle(component.list), 'previousNext');
  assert.deepEqual(storyFlowDirectoryLayout(project, component).navigation, { x: 300, y: 720, width: 400, height: 32 });
  setStoryFlowPaginationRect(component);
  assert.deepEqual(storyFlowDirectoryLayout(project, component), automatic);
  component.list!.flowPaginationStyle = 'numbers';
  assert.deepEqual(storyFlowDirectoryLayout(project, component), automatic);
  assert.equal(storyFlowPaginationStyle(component.list), 'numbers');
});

test('automatic rail appearance and explicit pagination survive the project format and runtime export', () => {
  const project = createProject();
  project.assets = ['rail', 'normal', 'current'].map(id => ({ id, name: id, kind: 'image', path: `assets/${id}.png` }));
  const component = flow({ flowViewport: viewport, flowScrollbar: { trackId: 'rail', thumb: skin, trackHeight: 5, thumbHeight: 31 }, flowCurrentMarker: { assetId: 'current', rect: { x: 0, y: 0, width: 1, height: 1 } } });
  const directory: UiComponent = { ...flow({ layout: 'grid', rows: 2, flowPaginationStyle: 'numbers', pageSkin: skin }), id: 'flow_directory' };
  project.ui.components.push(component, directory);
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.ui.components.find(c => c.id === component.id)!.list, component.list);
  assert.deepEqual(restored.ui.components.find(c => c.id === directory.id)!.list, directory.list);
  const result = compileProject(restored);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  const screens = result.files['game/screens.rpy'];
  assert.ok(screens.includes('"flowPaginationStyle": "numbers"'));
  for (const id of ['rail', 'normal', 'current']) assert.ok(screens.includes(`assets/${id}.png`));
  assert.ok(screens.includes('"flowScrollbar": {"trackId": "rail"'), 'the runtime receives the skin without requiring a saved rectangle');
});
