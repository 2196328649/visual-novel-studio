import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, connectBlueprintPins } from '../src/core/blueprint';
import { addTimelineActorAnimation, arrangePerformanceTimeline, performanceTimeline, performanceLifetimes, setTimelineActorEnd, moveTimelineActorLifetime, timelinePropertyObject } from '../src/core/performance-timeline';
import { createVisualObject, visualInputFields } from '../src/core/visual-object';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { initialPreviewStage, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { compileProject } from '../src/runtime/compiler';
import { validateProject } from '../src/core/validate';

test('property clocks follow linked parent and child retiming, including keys initially at zero', () => {
  const project = createProject();
  const child = { ...createVisualObject('image', 'portrait'), duration: 3, startAt: .5, retimeOnDuration: true, curves: { x: [{ at: 0, value: .2, easing: 'linear' as const }], rippleSpeed: [{ at: .5, value: 8, easing: 'linear' as const }] } };
  const group = { ...createVisualObject('group'), duration: 6, retimeOnDuration: true, children: [child] };
  const graph = blueprintFromPerformance(project, [group]); addProjectGraphs(project, graph);
  const source = graph.nodes.find(node => node.type === 'savedAction')!;
  const input = performanceInputs(graph).find(input => input.nodeId === source.id && input.pinId === 'object_duration')!;
  exposePerformanceInputs(graph, [input]); graph.exposedInputs[0].defaultValue = 12;
  const childDuration = visualInputFields(group).find(field => field.path.length > 1 && field.path.at(-1) === 'duration')!;
  source.properties['object_' + childDuration.key] = 6;
  const before = JSON.stringify(graph);
  const resolved = timelinePropertyObject(project, graph, source.id, [0], 3)!;
  assert.equal(resolved.at, 4); assert.equal(resolved.scale, 4);
  assert.equal(resolved.action.kind, 'visual');
  if (resolved.action.kind !== 'visual') return;
  assert.equal(resolved.action.duration, 12);
  assert.deepEqual(resolved.action.curves?.rippleSpeed, [{ at: 2, value: 2, easing: 'linear' }]);
  assert.equal(resolved.action.curves?.x?.[0].at, 0);
  assert.equal(JSON.stringify(graph), before);
  const model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, model.clips, model.tracks);
  assert.equal(JSON.parse(String(source.properties.action)).children[0].duration, 3);
  assert.equal(timelinePropertyObject(project, graph, source.id, [0], 3)!.scale, 4);
  const authored = JSON.parse(String(source.properties.action));
  authored.children[0].curves.x[0].at = 2 / resolved.scale;
  source.properties.action = JSON.stringify(authored);
  assert.equal(timelinePropertyObject(project, graph, source.id, [0], 3)!.action.curves?.x?.[0].at, 2);
  authored.children[0].retimeOnDuration = false;
  source.properties.action = JSON.stringify(authored);
  assert.equal(timelinePropertyObject(project, graph, source.id, [0], 3)!.scale, 2);
});

test('execution resolves parent overrides once without resetting scaled child defaults', () => {
  const project = createProject();
  const child = { ...createVisualObject('solid'), duration: 3, startAt: 1, retimeOnDuration: true, curves: { x: [{ at: 1, value: .8, easing: 'linear' as const }] } };
  const group = { ...createVisualObject('group'), duration: 6, retimeOnDuration: true, children: [child] };
  const graph = blueprintFromPerformance(project, [group]); addProjectGraphs(project, graph);
  const source = graph.nodes.find(node => node.type === 'savedAction')!;
  source.properties.object_duration = 12;
  const result = timelinePropertyObject(project, graph, source.id, [0], 0)!;
  assert.equal(result.action.kind, 'visual');
  if (result.action.kind !== 'visual') return;
  assert.equal(result.action.duration, 6); assert.equal(result.at, 2);
  assert.equal(result.action.curves?.x?.[0].at, 2); assert.equal(result.scale, 2);
  const snapshot = JSON.stringify(graph);
  assert.deepEqual(timelinePropertyObject(project, graph, source.id, [0], 0), result);
  assert.equal(JSON.stringify(graph), snapshot);
});

test('actor property curves extend timing and override only the targeted properties', () => {
  const before = initialPreviewStage();
  before.actors.set('hero', { kind: 'show', characterId: 'hero', expressionId: 'normal', x: 0, y: 1, scale: 1, rotation: 0, opacity: 1, layer: 0, transition: 'none' });
  const action = { kind: 'animate' as const, characterId: 'hero', wait: true, repeat: false, keyframes: [{ x: .5, y: .8, scale: 2, rotation: 12, opacity: 1, duration: 1, easing: 'linear' as const }], curves: { x: [{ at: 0, value: 0, easing: 'linear' as const }, { at: 2, value: 1, easing: 'outquad' as const }] } };
  const plan = linePlaybackPlan(before, [action]);
  assert.equal(plan.until, 2000); assert.equal(plan.dialogueAt, 2000);
  const middle = sampleLinePlayback(before, plan, 1000).state.actors.get('hero')!;
  assert.equal(middle.x, .75); assert.equal(middle.y, .8); assert.equal(middle.rotation, 12);
  assert.equal(sampleLinePlayback(before, plan, 2000).state.actors.get('hero')!.x, 1);
  const repeated = { ...action, repeat: true };
  assert.equal(sampleLinePlayback(before, linePlaybackPlan(before, [repeated]), 3000).state.actors.get('hero')!.x, .75);
});

test('editing an actor end creates then moves only its own hide command', () => {
  const project = createProject();
  project.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'portrait.png' }];
  project.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [{ id: 'normal', name: '普通', assetId: 'portrait' }] }];
  const graph = blueprintFromPerformance(project, ['left', 'right'].map(instanceId => ({ kind: 'show', characterId: 'hero', expressionId: 'normal', instanceId, x: .5, y: 1, scale: 1, layer: 0, transition: 'none', duration: 0, wait: false, lifetime: 'persistent' })));
  addProjectGraphs(project, graph);
  const sourceId = performanceTimeline(project, graph).clips[0].nodeId;
  const hideId = setTimelineActorEnd(project, graph, sourceId, 2);
  assert.equal(graph.nodes.find(node => node.id === hideId)!.properties.instanceId, 'left');
  assert.equal(setTimelineActorEnd(project, graph, sourceId, 3), hideId);
  assert.equal(graph.nodes.filter(node => node.type === 'hideCharacter').length, 1);
  const rows = performanceLifetimes(project, graph);
  assert.equal(rows.find(row => row.instanceId === 'instance:left')!.until, 3);
  assert.equal(rows.find(row => row.instanceId === 'instance:right')!.openEnded, true);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project));
  const before = initialPreviewStage(), plan = linePlaybackPlan(before, actions);
  assert.ok(sampleLinePlayback(before, plan, 2900).state.actors.has('instance:left'));
  assert.ok(!sampleLinePlayback(before, plan, 3100).state.actors.has('instance:left'));
  assert.ok(sampleLinePlayback(before, plan, 3100).state.actors.has('instance:right'));
});

test('instance lifetime rows end on replacement, hide or background while persistent actors stay open', () => {
  const project = createProject();
  project.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'portrait.png' }];
  project.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [{ id: 'normal', name: '普通', assetId: 'portrait' }] }];
  const show = { kind: 'show' as const, characterId: 'hero', expressionId: 'normal', x: .5, y: 1, scale: 1, layer: 0, transition: 'none' as const, duration: 0, wait: false };
  const visual = createVisualObject('text'); visual.duration = 10;
  const graph = blueprintFromPerformance(project, [
    { ...show, instanceId: 'left' }, { ...show, instanceId: 'right', lifetime: 'persistent' }, visual,
    { ...visual, duration: 4 }, { kind: 'hide', characterId: 'hero', instanceId: 'left', transition: 'none', duration: 0, wait: false },
    { kind: 'background', assetId: 'portrait', transition: 'none', duration: 0, wait: false },
  ]); addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: [0, 0, 0, 2, 3, 4][index] })), model.tracks);
  const rows = performanceLifetimes(project, graph);
  assert.equal(rows.find(row => row.instanceId === 'instance:left')!.until, 3);
  assert.equal(rows.find(row => row.instanceId === 'instance:right')!.openEnded, true);
  const objects = rows.filter(row => row.kind === 'visual');
  assert.deepEqual(objects.map(row => [row.at, row.until]), [[0, 2], [2, 4]]);
});

test('extending actor lifetimes moves crossed duplicate hides without hiding a later replacement', () => {
  const project = createProject();
  project.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [{ id: 'normal', name: '普通', assetId: 'portrait' }] }];
  const show = { kind: 'show' as const, characterId: 'hero', expressionId: 'normal', x: .5, y: 1, scale: 1, layer: 0, transition: 'none' as const, duration: 0, wait: false };
  const hide = { kind: 'hide' as const, characterId: 'hero', transition: 'none' as const, duration: 0, wait: false };
  const graph = blueprintFromPerformance(project, [show, hide, hide, { ...show, x: .8 }]); addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: [0, 2, 3, 6][index] })), model.tracks);
  const source = model.clips[0].nodeId;
  setTimelineActorEnd(project, graph, source, 5);
  const updated = performanceTimeline(project, graph);
  assert.deepEqual(model.clips.slice(1, 3).map(clip => updated.clips.find(item => item.nodeId === clip.nodeId)!.at), [5, 5]);
  assert.equal(graph.nodes.filter(node => node.type === 'hideCharacter').length, 2);
  const sample = (seconds: number) => {
    const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project));
    return sampleLinePlayback(initialPreviewStage(), linePlaybackPlan(initialPreviewStage(), actions), seconds * 1000).state;
  };
  assert.ok(sample(4).actors.has('hero')); assert.ok(!sample(5.1).actors.has('hero'));
  setTimelineActorEnd(project, graph, source, 6);
  assert.equal(sample(6.1).actors.get('hero')!.x, .8);
  const before = structuredClone(graph);
  assert.throws(() => setTimelineActorEnd(project, graph, source, 7), /替换/);
  assert.deepEqual(graph, before);
});

test('end edits use inherited persistence and preserve same-time replacement without adding a hide', () => {
  const project = createProject();
  project.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [{ id: 'normal', name: '普通', assetId: 'portrait' }] }];
  const show = { kind: 'show' as const, characterId: 'hero', expressionId: 'normal', x: .5, y: 1, scale: 1, layer: 0, transition: 'none' as const, duration: 0, wait: false };
  const graph = blueprintFromPerformance(project, [{ ...show, lifetime: 'persistent' }, show, { kind: 'background', assetId: 'background', transition: 'none', duration: 0, wait: false }]); addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: index })), model.tracks);
  const before = structuredClone(graph);
  setTimelineActorEnd(project, graph, model.clips[0].nodeId, 1);
  assert.deepEqual(graph, before);
  setTimelineActorEnd(project, graph, model.clips[1].nodeId, 3);
  assert.equal(performanceLifetimes(project, graph).find(row => row.nodeId === model.clips[1].nodeId)!.until, 3);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project));
  const plan = linePlaybackPlan(initialPreviewStage(), actions);
  assert.ok(sampleLinePlayback(initialPreviewStage(), plan, 2500).state.actors.has('hero'));
  assert.ok(!sampleLinePlayback(initialPreviewStage(), plan, 3500).state.actors.has('hero'));
});

test('moving a show beyond its old hide creates a new visible lifetime with an independent end', () => {
  const project = createProject();
  project.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [{ id: 'normal', name: '普通', assetId: 'portrait' }] }];
  const graph = blueprintFromPerformance(project, [
    { kind: 'show', characterId: 'hero', expressionId: 'normal', x: .5, y: 1, scale: 1, layer: 0, transition: 'none', duration: 0, wait: false },
    { kind: 'hide', characterId: 'hero', transition: 'none', duration: 0, wait: false },
  ]); addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: index ? 2 : 4 })), model.tracks);
  const row = performanceLifetimes(project, graph)[0];
  assert.equal(row.at, 4); assert.equal(row.openEnded, true);
  const hideId = setTimelineActorEnd(project, graph, model.clips[0].nodeId, 5);
  assert.notEqual(hideId, model.clips[1].nodeId);
  assert.equal(performanceTimeline(project, graph).clips.find(clip => clip.nodeId === model.clips[1].nodeId)!.at, 2);
  assert.equal(performanceLifetimes(project, graph)[0].until, 5);
});

test('moving an actor lifetime shifts its animations and hides together while preserving siblings', () => {
  const project = createProject();
  project.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [{ id: 'normal', name: '普通', assetId: 'portrait' }] }];
  const show = { kind: 'show' as const, characterId: 'hero', instanceId: 'left', expressionId: 'normal', x: .2, y: 1, scale: 1, layer: 0, transition: 'none' as const, duration: 0, wait: false };
  const hide = { kind: 'hide' as const, characterId: 'hero', instanceId: 'left', transition: 'none' as const, duration: 0, wait: false };
  const graph = blueprintFromPerformance(project, [show,
    { kind: 'animate', characterId: 'hero', instanceId: 'left', wait: false, repeat: false, keyframes: [{ x: .8, y: 1, scale: 1, rotation: 0, opacity: 1, duration: 2, easing: 'linear' }] },
    { ...show, instanceId: 'right', x: .9 }, hide, hide, { ...show, x: .1 },
  ]); addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: [1, 2, 2.5, 4, 5, 10][index] })), model.tracks);
  const source = model.clips[0].nodeId;
  moveTimelineActorLifetime(project, graph, source, 4);
  const moved = performanceTimeline(project, graph);
  assert.deepEqual(model.clips.map(clip => moved.clips.find(item => item.nodeId === clip.nodeId)!.at), [4, 5, 2.5, 7, 8, 10]);
  assert.equal(performanceLifetimes(project, graph).find(row => row.nodeId === source)!.until, 7);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project));
  const plan = linePlaybackPlan(initialPreviewStage(), actions);
  assert.equal(sampleLinePlayback(initialPreviewStage(), plan, 6000).state.actors.get('instance:left')!.x, .5);
  assert.equal(sampleLinePlayback(initialPreviewStage(), plan, 6000).state.actors.get('instance:right')!.x, .9);
  assert.ok(!sampleLinePlayback(initialPreviewStage(), plan, 7100).state.actors.has('instance:left'));
  const before = structuredClone(graph);
  assert.throws(() => moveTimelineActorLifetime(project, graph, source, 8), /边界|替换|区间/);
  assert.deepEqual(graph, before);
  moveTimelineActorLifetime(project, graph, source, 1);
  assert.deepEqual(model.clips.map(clip => performanceTimeline(project, graph).clips.find(item => item.nodeId === clip.nodeId)!.at), [1, 2, 2.5, 4, 5, 10]);
});

test('moving a background-bounded actor earlier creates its own end without moving the shared background', () => {
  const project = createProject();
  project.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [{ id: 'normal', name: '普通', assetId: 'portrait' }] }];
  const graph = blueprintFromPerformance(project, [
    { kind: 'show', characterId: 'hero', expressionId: 'normal', x: .5, y: 1, scale: 1, layer: 0, transition: 'none', duration: 0, wait: false },
    { kind: 'background', assetId: 'background', transition: 'none', duration: 0, wait: false },
  ]); addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: index ? 4 : 1 })), model.tracks);
  moveTimelineActorLifetime(project, graph, model.clips[0].nodeId, 0);
  assert.equal(performanceLifetimes(project, graph)[0].until, 3);
  assert.equal(performanceTimeline(project, graph).clips.find(clip => clip.nodeId === model.clips[1].nodeId)!.at, 4);
  const before = structuredClone(graph);
  assert.throws(() => moveTimelineActorLifetime(project, graph, model.clips[0].nodeId, 2), /边界/);
  assert.deepEqual(graph, before);
});

test('nested lifecycle rows use absolute starts and clip to every ancestor and replacement', () => {
  const project = createProject(), group = createVisualObject('group'), nested = createVisualObject('group'), child = createVisualObject('text');
  group.duration = 10; nested.startAt = 1; nested.duration = 5; child.startAt = 2; child.duration = 8;
  nested.children = [child, { ...createVisualObject('text'), startAt: 10 }]; group.children = [nested];
  const graph = blueprintFromPerformance(project, [group, { ...group, children: [], duration: 1 }]); addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: index ? 7 : 2 })), model.tracks);
  const rows = performanceLifetimes(project, graph);
  assert.deepEqual(rows.map(row => [row.at, row.until, row.depth ?? 0]), [[2, 7, 0], [3, 7, 1], [5, 7, 2], [7, 8, 0]]);
  assert.equal(rows[2].instanceId, child.instanceId);
  assert.deepEqual(rows[2].objectPath, [0, 0]);
});

function fixture() {
  const project = createProject();
  const graph = blueprintFromPerformance(project, [
    { kind: 'chapter', title: '第一章', subtitle: '', duration: 4, effect: 'ink' },
    { kind: 'camera', x: .4, y: -.2, zoom: 1.5, rotation: 0, duration: 2, easing: 'linear', wait: false },
    { kind: 'shake', direction: 'horizontal', duration: 1, amplitude: 30, wait: true },
  ], '入场演出');
  addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: index === 0 ? 0 : 1 })), model.tracks);
  return { project, graph };
}

test('timeline motion targets a named instance and survives blueprint and saved-project round trips', () => {
  const project = createProject();
  project.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'portrait.png' }];
  project.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [{ id: 'normal', name: '普通', assetId: 'portrait' }] }];
  const graph = blueprintFromPerformance(project, ['left', 'right'].map((instanceId, index) => ({ kind: 'show' as const, characterId: 'hero', expressionId: 'normal', instanceId, x: index ? .8 : .2, y: 1, scale: 1, layer: 0, transition: 'none' as const, duration: 0, wait: false })));
  addProjectGraphs(project, graph);
  const before = performanceTimeline(project, graph);
  assert.notEqual(before.clips[0].trackId, before.clips[1].trackId);
  const animationId = addTimelineActorAnimation(project, graph, before.clips[0].nodeId);
  const animation = graph.nodes.find(node => node.id === animationId)!;
  const action = JSON.parse(String(animation.properties.action));
  assert.equal(action.instanceId, 'left');
  action.keyframes[1].x = .6; action.keyframes[1].easing = 'linear';
  animation.properties.action = JSON.stringify(action);
  const parsed = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const expanded = expandPreviewActions(parsed, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(parsed));
  const plan = linePlaybackPlan(initialPreviewStage(), expanded);
  const sample = sampleLinePlayback(initialPreviewStage(), plan, 500);
  assert.ok(Math.abs(sample.state.actors.get('instance:left')!.x - .4) < .001);
  assert.equal(sample.state.actors.get('instance:right')!.x, .8);
  assert.equal(performanceTimeline(parsed, projectGraphs(parsed)[0]).until, 1);
  assert.deepEqual(compileProject(parsed).diagnostics.filter(d => d.severity === 'error'), []);
});
test('tracks overlap ordinary nodes and finish after the longest effect', () => {
  const { project, graph } = fixture(), model = performanceTimeline(project, graph);
  assert.equal(model.reason, undefined); assert.deepEqual(model.clips.map(clip => clip.at), [0, 1, 1]); assert.equal(model.until, 4);
  const expanded = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project));
  const plan = linePlaybackPlan(initialPreviewStage(), expanded);
  assert.deepEqual(plan.steps.filter(step => step.action.kind !== 'pause').map(step => [step.action.kind, step.at]), [['chapter', 0], ['camera', 1000], ['shake', 1000]]);
  assert.equal(plan.dialogueAt, 4000); assert.equal(plan.until, 4000);
  assert.deepEqual(validateProject(project).filter(item => item.severity === 'error'), []);
});
test('public duration overrides change the final wait without breaking track starts', () => {
  const { project, graph } = fixture();
  const input = performanceInputs(graph).find(pin => pin.pinId === 'duration' && graph.nodes.find(node => node.id === pin.nodeId)?.type === 'showChapter')!;
  exposePerformanceInputs(graph, [input]);
  const expanded = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [graph.exposedInputs[0].id]: 7.5 } }], previewActionContext(project));
  const plan = linePlaybackPlan(initialPreviewStage(), expanded);
  assert.equal(plan.dialogueAt, 7500);
  assert.equal(plan.steps.find(step => step.action.kind === 'camera')?.at, 1000);
  const code = compileProject(project); assert.deepEqual(code.diagnostics.filter(item => item.severity === 'error'), []);
  assert.ok(code.files['game/story.rpy'].includes('vn_bp_timeline_end_' + graph.id));
  assert.match(code.files['game/story.rpy'], /renpy\.show_screen\("vn_chapter_title",.*_vn_wait=False.*_layer="master".*_zorder=/);
  assert.match(code.files['game/story.rpy'], /vn_performance_pause\(max\(0.0, vn_bp_timeline_end_/);
  assert.match(code.files['game/screens.rpy'], /timer duration action \(Return\(True\) if _vn_wait else Hide/);
});
test('moving a clip preserves resource inputs, IDs and saved timeline metadata', () => {
  const { project, graph } = fixture();
  exposePerformanceInputs(graph, [performanceInputs(graph).find(pin => pin.pinId === 'title')!]);
  const publicLink = graph.links.find(link => link.toPinId === 'title')!;
  const model = performanceTimeline(project, graph), id = model.clips[1].nodeId;
  arrangePerformanceTimeline(project, graph, model.clips.map(clip => clip.nodeId === id ? { ...clip, at: 5 } : clip), model.tracks);
  assert.ok(graph.links.some(link => link.id === publicLink.id && link.toNodeId === publicLink.toNodeId));
  assert.equal(performanceTimeline(project, graph).until, 7);
  const parsed = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(performanceTimeline(parsed, projectGraphs(parsed)[0]).clips, performanceTimeline(project, graph).clips);
});
test('branching or unconnected execution paths cannot be silently flattened', () => {
  const { project, graph } = fixture();
  const branch = blueprintNodeDefaults('branch'); graph.nodes.push(branch);
  const snapshot = JSON.stringify(graph);
  const model = performanceTimeline(project, graph);
  assert.match(model.reason ?? '', /未连接/);
  assert.throws(() => arrangePerformanceTimeline(project, graph, model.clips, model.tracks), /未连接/);
  assert.equal(JSON.stringify(graph), snapshot);
  connectBlueprintPins(graph, graph.nodes[0].id, 'exec', branch.id, 'exec_in');
  assert.ok(performanceTimeline(project, graph).reason);
});
test('sampling midway evaluates camera, shaking and the chapter at the same time', () => {
  const { project, graph } = fixture();
  const before = initialPreviewStage(), plan = linePlaybackPlan(before, expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project)));
  const sample = sampleLinePlayback(before, plan, 1530);
  assert.ok(Math.abs(sample.state.camera.x - .106) < .00001);
  assert.equal(sample.chapter?.elapsed, 1.53);
  assert.ok(Math.abs(sample.shake.x) > 1);
  assert.equal(sampleLinePlayback(before, plan, 4000).chapter, undefined);
});
test('removing multiple clips retains a legal event and completion path', () => {
  const { project, graph } = fixture(), model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, [], model.tracks);
  assert.equal(performanceTimeline(project, graph).clips.length, 0);
  assert.deepEqual(validateProject(project).filter(item => item.severity === 'error'), []);
  assert.equal(graph.nodes.filter(node => node.type === 'event').length, 1);
});

