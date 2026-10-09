import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, projectSchema, type StoryNode, type UiComponent } from '../src/core/model';
import { galleryLayout } from '../src/core/gallery-layout';
import { storyFlowLayout } from '../src/core/story-flow';
import { compileProject } from '../src/runtime/compiler';
import { validateProject } from '../src/core/validate';

test('template flow viewport and scrollbar retain the extracted independent geometry', () => {
  const project = projectSchema.parse(JSON.parse(readFileSync(new URL('../resources/templates/aihong/project.vns.json', import.meta.url), 'utf8')));
  const flow = project.ui.components.find(component => component.id === 'ai_flowchart_items')!;
  const nav = flow.list!.flowScrollbar!;
  assert.deepEqual([flow.x, flow.y, flow.width, flow.height], [0, 0, 1, 1]);
  assert.equal(flow.list!.flowViewport!.y * project.height, 200);
  assert.equal(flow.list!.flowViewport!.height * project.height, 736);
  assert.equal(nav.rect.width * project.width, 733);
  assert.ok(Math.abs((nav.rect.x + nav.rect.width / 2) * project.width - 960) < .01);
  assert.deepEqual([nav.trackHeight, nav.thumbHeight, flow.list!.flowShowControls, flow.list!.flowShowVerticalScrollbar], [5, 31, false, false]);
  assert.deepEqual(validateProject(project).filter(item => item.severity === 'error'), []);
});

test('flow navigation edits serialize, export image paths and diagnose missing assets', () => {
  const project = createProject();
  project.assets = ['rail', 'idle', 'hover', 'pressed', 'disabled'].map(id => ({ id, name: id, kind: 'image', path: `assets/${id}.png` }));
  const flow: UiComponent = { id: 'flow', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow', flowViewport: { x: .1, y: .2, width: .8, height: .6 }, flowShowControls: false, flowShowVerticalScrollbar: true, flowScrollbar: { rect: { x: .3, y: .9, width: .4, height: .03 }, trackId: 'rail', trackHeight: 4.5, thumbHeight: 28.5, thumb: { idle: 'idle', hover: 'hover', pressed: 'pressed', disabled: 'disabled', brightness: { pressed: .7 } } } } };
  project.ui.components.push(flow);
  flow.list!.flowCurrentMarker = { assetId: 'idle', rect: { x: -.05, y: -.1, width: 1.1, height: 1.2 } };
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.ui.components.find(c => c.id === 'flow')!.list, flow.list);
  const result = compileProject(restored);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  for (const name of ['rail', 'idle', 'hover', 'pressed', 'disabled']) assert.ok(result.files['game/screens.rpy'].includes(`assets/${name}.png`));
  flow.list!.flowScrollbar!.trackId = 'missing_rail';
  flow.list!.flowScrollbar!.thumb!.disabled = 'missing_disabled';
  flow.list!.flowCurrentMarker!.assetId = 'missing_current_marker';
  const errors = validateProject(project).filter(d => d.severity === 'error');
  assert.ok(errors.some(d => d.message.includes('missing_rail')));
  assert.ok(errors.some(d => d.message.includes('missing_disabled')));
  assert.ok(errors.some(d => d.message.includes('missing_current_marker')));
});

test('original gallery cards, thumbnails and staggered second row use prefab coordinates', () => {
  const project = projectSchema.parse(JSON.parse(readFileSync(new URL('../resources/templates/aihong/project.vns.json', import.meta.url), 'utf8')));
  const gallery = project.ui.components.find(component => component.id === 'ai_gallery_items')!;
  const layout = galleryLayout(project, gallery), width = gallery.width * project.width, height = gallery.height * project.height;
  const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < .05, actual + ' != ' + expected);
  assert.equal(layout.cells.length, 8);
  near(layout.cells[0].width * width, 401); near(layout.cells[0].height * height, 226);
  near(gallery.x * project.width, 24.99); near(gallery.y * project.height, 322);
  near((gallery.x * project.width) + layout.cells[4].x * width, 180.4);
  near((gallery.y * project.height) + layout.cells[4].y * height, 600.66);
  near(layout.thumbnail.x * 401, 8.3945); near(layout.thumbnail.y * 226, 21.952);
  near(layout.thumbnail.width * 401, 376); near(layout.thumbnail.height * 226, 184);
  for (const cell of layout.cells) {
    assert.ok(cell.x >= 0 && cell.x + cell.width <= 1);
    assert.ok(cell.y + cell.height < layout.navigation.y);
  }
});

test('story map preserves hidden branches, shared destinations, merges and loop exits', () => {
  const project = createProject();
  const sceneId = project.scenes[0].id;
  const base = (id: string) => ({ id, name: id, sceneId, x: 0, y: 0 });
  const passage = (id: string, next: string): StoryNode => ({ ...base(id), kind: 'passage', lines: [{ id: id + '_line', text: id, actions: [] }], next });
  project.nodes = [
    passage('entry', 'hidden_choice'),
    { ...base('hidden_choice'), kind: 'choice', textHeading: false, prompt: '', choices: [{ id: 'a', text: '接受', target: 'left' }, { id: 'b', text: '拒绝', target: 'right' }, { id: 'c', text: '再想想', target: 'left' }] },
    passage('left', 'merge'), passage('right', 'merge'), passage('merge', 'hidden_loop'),
    { ...base('hidden_loop'), kind: 'choice', textHeading: false, prompt: '', choices: [{ id: 'again', text: '重试', target: 'entry' }, { id: 'done', text: '结束', target: 'end' }] },
    { ...base('end'), kind: 'end' },
  ];
  project.nodes.forEach(node => { if (node.textHeading !== false) node.flowchart = { visible: true }; });
  project.entryId = 'entry';
  const component: UiComponent = { id: 'flow', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow' } };
  const graph = storyFlowLayout(project, component);
  assert.deepEqual(new Set(graph.nodes.map(node => node.id)), new Set(['entry', 'left', 'right', 'merge', 'end']));
  assert.deepEqual(new Set(graph.edges.map(edge => edge.from + ':' + edge.to)), new Set(['entry:left', 'entry:right', 'left:merge', 'right:merge', 'merge:entry', 'merge:end']));
  assert.equal(graph.edges.find(edge => edge.to === 'left')!.label, '接受 / 再想想');
  assert.equal(graph.locations.hidden_choice, 'entry');
  assert.equal(graph.locations.hidden_loop, 'merge');
  for (const edge of graph.edges) for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1], b = edge.points[i];
    assert.ok(a[0] === b[0] || a[1] === b[1]);
    assert.ok(b[0] >= 0 && b[0] <= graph.width && b[1] >= 0 && b[1] <= graph.height);
  }
  for (const [index, a] of graph.nodes.entries()) for (const b of graph.nodes.slice(index + 1)) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  project.nodes = [];
  assert.deepEqual(storyFlowLayout(project, component).nodes, []);
});
