import { projectGraphs, addProjectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiTimelineOverlapFixture } from '../scripts/lib/ai-timeline-overlap-fixture';
import { performanceTimeline, timelinePlaybackLayout, arrangePerformanceTimeline } from '../src/core/performance-timeline';
import { createPreviewActionExpander, expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { linePreviewSnapshot } from '../src/core/line-preview';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../src/core/blueprint';
import { createVisualObject } from '../src/core/visual-object';
import { compileProject } from '../src/runtime/compiler';
import { createProject } from '../src/core/model';

test('legacy overlaps use displayed tracks for raw preview and export without changing timing or source', () => {
  const { project, graph, first } = aiTimelineOverlapFixture();
  graph.nodes.find(n => n.id === first)!.properties.object_duration = 5;
  const before = structuredClone(project), displayed = performanceTimeline(project, graph);
  const layout = timelinePlaybackLayout(project);
  assert.deepEqual(projectGraphs(layout)[0].timeline!.tracks, displayed.tracks);
  assert.deepEqual(performanceTimeline(layout, projectGraphs(layout)[0]).clips, displayed.clips);
  assert.deepEqual(displayed.clips.map(c => [c.at, c.duration]), [[0, 5], [3, 1]]);
  assert.strictEqual(timelinePlaybackLayout(layout), layout);
  const context = previewActionContext(project);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context).filter(a => a.kind === 'visual');
  assert.equal(context.incomplete, false);
  assert.ok(actions[0].layer > actions[1].layer);
  const compiled = compileProject(project), normalized = compileProject(layout);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.deepEqual(compiled.files, normalized.files);
  assert.deepEqual(project, before);
  // Callers may edit in place; layout must never reuse a stale identity cache.
  graph.nodes.find(n => n.id === first)!.properties.object_duration = 2;
  assert.equal(projectGraphs(timelinePlaybackLayout(project))[0].timeline!.tracks.length, 1);
});

test('legacy child lanes reserve their full range below a foreground parent track', () => {
  const { project, graph: child, first } = aiTimelineOverlapFixture();
  child.nodes.find(n => n.id === first)!.properties.object_duration = 5;
  const parent = blueprintFromPerformance(project, [{ ...createVisualObject('solid'), name: 'foreground', duration: 6 }], '父时间轴');
  addProjectGraphs(project, parent);
  const call = blueprintNodeDefaults('callFunction'); call.properties = { graphId: child.id, wait: false }; call.pins = callablePins(child);
  const last = parent.nodes.at(-1)!; parent.nodes.push(call); connectBlueprintPins(parent, last.id, 'exec_out', call.id, 'exec_in');
  const model = performanceTimeline(project, parent);
  arrangePerformanceTimeline(project, parent, model.clips.map(c => ({ ...c, at: 0 })), model.tracks);
  const before = structuredClone(project), context = previewActionContext(project);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: parent.id }], context).filter(a => a.kind === 'visual');
  assert.equal(context.incomplete, false);
  const foreground = actions.find(a => a.name === 'foreground')!, nested = actions.filter(a => a.name !== 'foreground');
  assert.ok(foreground.layer > nested[0].layer && nested[0].layer > nested[1].layer);
  assert.deepEqual(compileProject(project).files, compileProject(timelinePlaybackLayout(project)).files);
  assert.deepEqual(project, before);
});

test('chapter screens share image track depth in preview and native compilation', () => {
  const project = createProject();
  project.assets.push({ id: 'picture', name: '图片', kind: 'image', path: 'assets/picture.png' });
  const graph = blueprintFromPerformance(project, [createVisualObject('image', 'picture'), { kind: 'chapter', title: '章节', subtitle: '', duration: 4, wait: false }], '前景图片');
  graph.timelineComponent = true; addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, model.clips.map(clip => ({ ...clip, at: 0 })), model.tracks);
  const actions = () => expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project));
  const image = actions().find(action => action.kind === 'visual')!, chapter = actions().find(action => action.kind === 'chapter')!;
  assert.ok(image.kind === 'visual' && chapter.kind === 'chapter' && image.layer > chapter.layer!);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /renpy\.show_screen\("vn_chapter_title",[^\n]+_layer="master", _zorder=vn_bp_layer_base_/);
  arrangePerformanceTimeline(project, graph, model.clips, [...model.tracks].reverse());
  const reversed = actions(), front = reversed.find(action => action.kind === 'visual')!, back = reversed.find(action => action.kind === 'chapter')!;
  assert.ok(front.kind === 'visual' && back.kind === 'chapter' && front.layer < back.layer!);
});

test('unsupported dynamic timeline layout remains authored', () => {
  const { project, graph, gap } = aiTimelineOverlapFixture();
  const literal = blueprintNodeDefaults('literal'); literal.properties.value = 3; graph.nodes.push(literal);
  literal.pins.find(p => p.id === 'value')!.dataType = 'number';
  assert.equal(connectBlueprintPins(graph, literal.id, 'value', gap.id, 'seconds'), undefined);
  assert.match(performanceTimeline(project, graph).reason!, /数据连线/);
  assert.strictEqual(timelinePlaybackLayout(project), project);
});

test('shared traversal preparation preserves legacy lanes and per-line action origins', () => {
  const { project, graph, first } = aiTimelineOverlapFixture();
  graph.nodes.find(n => n.id === first)!.properties.object_duration = 5;
  const before = structuredClone(project), expand = createPreviewActionExpander(project);
  const shared = previewActionContext(project), independent = previewActionContext(project);
  shared.actionOrigins = new Map(); independent.actionOrigins = new Map();
  for (const lineId of ['first', 'second']) {
    const source = [{ kind: 'blueprint' as const, blueprintId: graph.id }];
    const origins = [{ nodeId: 'passage', lineId, actionIndex: 0 }];
    const actual = expand(source, shared, origins), expected = expandPreviewActions(project, source, independent, origins);
    assert.deepEqual(actual, expected);
    assert.deepEqual(shared, independent);
    assert.ok(actual.some(a => a.kind === 'visual'));
    assert.ok([...shared.actionOrigins.values()].some(origin => origin.lineId === lineId));
  }
  assert.deepEqual(project, before);
});

test('a new stage traversal sees in-place timeline edits instead of stale preparation', () => {
  const { project, graph, first } = aiTimelineOverlapFixture();
  const node = project.nodes.find(n => n.kind === 'passage')!;
  node.lines = [{ id: 'timeline', text: '演出', actions: [{ kind: 'blueprint', blueprintId: graph.id }] }, { id: 'after', text: '后段', actions: [] }];
  const selected = { nodeId: node.id, lineId: 'timeline' };
  const duration = (snapshot: ReturnType<typeof linePreviewSnapshot>) => snapshot.actions.find(a => a.kind === 'visual')?.duration;
  graph.nodes.find(n => n.id === first)!.properties.object_duration = 5;
  assert.equal(duration(linePreviewSnapshot(project, selected)), 5);
  graph.nodes.find(n => n.id === first)!.properties.object_duration = 2;
  assert.equal(duration(linePreviewSnapshot(project, selected)), 2);
  assert.equal(linePreviewSnapshot(project, selected, 0).actions.length, 0);
});
