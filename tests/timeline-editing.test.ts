import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeTimelineClip, trimTimelineClip, trimTimelineClipLeft, timelineOverlap } from '../src/core/timeline-editing';
import { createProject, projectSchema } from '../src/core/model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, insertTimelineAction, performanceTimeline, timelinePreviewLayout } from '../src/core/performance-timeline';
import { createVisualObject } from '../src/core/visual-object';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { initialPreviewStage, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { compileProject } from '../src/runtime/compiler';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../src/core/blueprint';

test('moving and trimming fit whole clips into same-track gaps without moving neighbours', () => {
  const clips = [{ nodeId: 'a', trackId: 'one', at: 0, duration: 2 }, { nodeId: 'b', trackId: 'one', at: 4, duration: 2 }, { nodeId: 'overlay', trackId: 'two', at: 0, duration: 9 }];
  const original = structuredClone(clips);
  assert.equal(placeTimelineClip({ nodeId: 'new', trackId: 'one', at: 1, duration: 2 }, clips).at, 2);
  assert.equal(placeTimelineClip({ nodeId: 'new', trackId: 'one', at: 3, duration: 3 }, clips).at, 6);
  assert.equal(placeTimelineClip({ ...clips[0], trackId: 'empty', at: 1 }, clips).at, 1);
  assert.equal(trimTimelineClip({ ...clips[0], duration: 10 }, clips).duration, 4);
  assert.deepEqual(clips, original);
  assert.equal(timelineOverlap(clips), undefined);
  assert.ok(timelineOverlap([...clips, { nodeId: 'bad', trackId: 'one', at: 1, duration: 1 }]));
});

test('left trim keeps the right edge, respects the previous clip, and enforces a minimum duration', () => {
  const clips = [
    { nodeId: 'before', trackId: 'media', at: 0, duration: 2 },
    { nodeId: 'clip', trackId: 'media', at: 4, duration: 3 },
  ];
  const clipped = trimTimelineClipLeft({ ...clips[1], offset: 1 }, clips, 1);
  assert.deepEqual(clipped, { nodeId: 'clip', trackId: 'media', at: 2, duration: 5, offset: 1 });
  const media = trimTimelineClipLeft({ ...clips[1], offset: 1 }, clips, 5);
  assert.deepEqual(media, { nodeId: 'clip', trackId: 'media', at: 5, duration: 2, offset: 1 });
  const sourceBound = trimTimelineClipLeft({ ...clips[1], offset: 1 }, clips, 6, 2);
  assert.equal(sourceBound.at, 5);
  assert.equal(sourceBound.duration, 2);
});

test('picture clips have independent duration, expire, and inserts in occupied tracks find a gap', () => {
  const project = createProject(), graph = blueprintFromPerformance(project, []); addProjectGraphs(project, graph);
  project.assets.push({ id: 'pic', name: 'Picture', kind: 'image', path: 'pic.png' });
  const first = createVisualObject('image', 'pic'); first.duration = 2;
  const id = insertTimelineAction(project, graph, first, 0, performanceTimeline(project, graph).tracks[0].id);
  const second = createVisualObject('image', 'pic'); second.duration = 1;
  insertTimelineAction(project, graph, second, .5, performanceTimeline(project, graph).clips[0].trackId);
  const model = performanceTimeline(project, graph);
  assert.deepEqual(model.clips.map(c => [c.at, c.duration]), [[0, 2], [2, 1]]);
  const before = structuredClone(graph);
  assert.throws(() => arrangePerformanceTimeline(project, graph, model.clips.map(c => ({ ...c, at: 0 })), model.tracks), /不能重叠/);
  assert.deepEqual(graph, before);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project));
  assert.equal(actions.some(a => a.kind === 'background'), false);
  const stage = initialPreviewStage(), plan = linePlaybackPlan(stage, actions);
  assert.ok(sampleLinePlayback(stage, plan, 1000).state.visuals.has(first.instanceId));
  assert.ok(!sampleLinePlayback(stage, plan, 2100).state.visuals.has(first.instanceId));
  assert.equal(projectGraphs(projectSchema.parse(project))[0].nodes.some(n => n.id === id), true);
});

test('video clips keep their source in-point in preview and native output', () => {
  const project = createProject(), video = { id: 'video_asset', name: '片头', kind: 'video' as const, path: 'assets/intro.webm' };
  project.assets.push(video);
  const object = createVisualObject('video', video.id); object.sourceDuration = 10; object.mediaOffset = 3; object.duration = 4;
  const graph = blueprintFromPerformance(project, [object], '视频演出'); addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph); assert.equal(model.clips[0].duration, 4);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project)).filter(action => action.kind === 'visual');
  assert.equal(actions.length, 1); assert.equal(actions[0].content, 'video'); assert.equal(actions[0].mediaOffset, 3);
  const compiled = compileProject(project); assert.equal(compiled.diagnostics.some(item => item.severity === 'error'), false, JSON.stringify(compiled.diagnostics));
  assert.match(Object.values(compiled.files).join('\n'), /Movie\(play=/);
});

test('track order controls preview and exported image layers without changing authored values or retiming twice', () => {
  const project = createProject();
  const top = { ...createVisualObject('solid'), name: 'top', layer: -999, duration: 2, retimeOnDuration: true, curves: { x: [{ at: 0, value: 0, easing: 'linear' as const }, { at: 2, value: 1, easing: 'linear' as const }] } };
  const bottom = { ...createVisualObject('solid'), name: 'bottom', layer: 999, duration: 4 };
  const graph = blueprintFromPerformance(project, [top, bottom]); addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, model.clips.map(c => ({ ...c, at: 0 })), model.tracks);
  const pin = performanceInputs(graph).find(p => p.nodeId === model.clips[0].nodeId && p.pinId === 'object_duration')!;
  exposePerformanceInputs(graph, [pin]); graph.exposedInputs[0].defaultValue = 4;
  const before = structuredClone(project);
  const visual = () => expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project)).filter(a => a.kind === 'visual');
  const actions = visual();
  assert.ok(actions[0].layer > actions[1].layer);
  assert.equal(actions[0].curves?.x?.at(-1)?.at, 4);
  const compiled = compileProject(project); assert.ok(!compiled.diagnostics.some(d => d.severity === 'error'));
  assert.match(Object.values(compiled.files).join('\n'), new RegExp('layer=vn_bp_layer_base_' + graph.id + ' \\+ 1'));
  assert.deepEqual(project, before);
  arrangePerformanceTimeline(project, graph, performanceTimeline(project, graph).clips, [...model.tracks].reverse());
  assert.ok(visual()[0].layer < visual()[1].layer);
});

test('nested timelines reserve one parent layer range for immediate and delayed playback', () => {
  for (const delay of [0, .25]) {
    const project = createProject();
    const child = blueprintFromPerformance(project, [createVisualObject('solid'), createVisualObject('text')], '内部'); addProjectGraphs(project, child);
    const inside = performanceTimeline(project, child); arrangePerformanceTimeline(project, child, inside.clips.map(c => ({ ...c, at: delay })), inside.tracks);
    const front = { ...createVisualObject('solid'), name: 'front' }, back = { ...createVisualObject('solid'), name: 'back' };
    const parent = blueprintFromPerformance(project, [front, back], '外部'); addProjectGraphs(project, parent);
    const call = blueprintNodeDefaults('callFunction'); call.properties = { graphId: child.id, wait: false }; call.pins = callablePins(child);
    const last = parent.nodes.at(-1)!; parent.nodes.push(call); connectBlueprintPins(parent, last.id, 'exec_out', call.id, 'exec_in');
    const model = performanceTimeline(project, parent), callTrack = model.clips.find(c => c.nodeId === call.id)!.trackId;
    const tracks = [model.tracks[0], model.tracks.find(t => t.id === callTrack)!, model.tracks[1]];
    arrangePerformanceTimeline(project, parent, model.clips.map(c => ({ ...c, at: 0 })), tracks);
    const before = structuredClone(project), context = previewActionContext(project);
    const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: parent.id }], context).filter(a => a.kind === 'visual');
    assert.equal(context.incomplete, false);
    const foreground = actions.find(a => a.name === 'front')!, background = actions.find(a => a.name === 'back')!;
    const nested = actions.filter(a => !['front', 'back'].includes(a.name));
    assert.ok(nested.length === 2 && nested[0].layer > nested[1].layer);
    assert.ok(nested.every(a => a.layer < foreground.layer && a.layer > background.layer));
    const compiled = compileProject(project); assert.equal(compiled.diagnostics.some(d => d.severity === 'error'), false, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(project, before);
  }
});

test('old overlapping rows keep their timing while preview uses the separated display rows', () => {
  const project = createProject(), graph = blueprintFromPerformance(project, [createVisualObject('solid'), createVisualObject('solid')]); addProjectGraphs(project, graph);
  const nodes = graph.nodes.filter(n => n.type === 'savedAction');
  graph.timeline = { tracks: [{ id: 'legacy', name: '旧轨道' }], clips: nodes.map(node => ({ nodeId: node.id, trackId: 'legacy' })) };
  const before = structuredClone(project), model = performanceTimeline(project, graph);
  assert.deepEqual(model.clips.map(c => c.at), [0, 0]); assert.equal(model.tracks.length, 2);
  const preview = timelinePreviewLayout(project, graph, model);
  const actions = expandPreviewActions(preview, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(preview)).filter(a => a.kind === 'visual');
  assert.ok(actions[0].layer > actions[1].layer); assert.deepEqual(project, before);
  arrangePerformanceTimeline(project, graph, model.clips, model.tracks);
  assert.equal(projectGraphs(projectSchema.parse(project))[0].timeline?.tracks.length, 2);
});
