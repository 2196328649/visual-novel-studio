import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type VisualObject } from '../src/core/model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, connectBlueprintPins } from '../src/core/blueprint';
import { arrangePerformanceTimeline, insertTimelineAction, performanceTimeline } from '../src/core/performance-timeline';
import { chapterCompositionBlueprint } from '../src/core/chapter-composition-blueprint';
import { createVisualObject, visualInputFields, visualPose } from '../src/core/visual-object';
import { editTimelineProject } from '../src/core/timeline-edit-validation';
import { addCompositionChild, compositionFieldBinding, compositionObject, compositionTimeline, duplicateCompositionChild, patchCompositionObject, removeCompositionChild, reorderCompositionChild, setCompositionCurve, setCompositionPose, setCompositionTiming, toggleCompositionKeyframe } from '../src/core/composition-timeline';

function fixture() {
  const project = createProject('组合剪辑');
  project.assets.push({ id: 'picture', name: '图片', kind: 'image', path: 'picture.png' });
  const text = { ...createVisualObject('text'), name: '标题', startAt: .5, duration: 1.5, layer: 1, retimeOnDuration: true };
  text.curves = { x: [{ at: 0, value: .2, easing: 'linear' }, { at: 1.5, value: .8, easing: 'linear' }] };
  const image = { ...createVisualObject('image', 'picture'), name: '图片', startAt: 1, layer: 0 };
  const hidden = { ...createVisualObject('solid'), name: '在范围外', startAt: 9, duration: 1, layer: 2 };
  const group = { ...createVisualObject('group'), name: '内层组合', startAt: 1, duration: 4, retimeOnDuration: true, children: [text, image, hidden] };
  const root = { ...createVisualObject('group'), name: '演出组合', duration: 10, retimeOnDuration: true, children: [group] };
  const graph = blueprintFromPerformance(project, [root], '组合时间轴'); addProjectGraphs(project, graph);
  const node = graph.nodes.find(node => node.type === 'savedAction')!;
  exposePerformanceInputs(graph, [performanceInputs(graph).find(field => field.nodeId === node.id && field.pinId === 'object_duration')!]);
  graph.exposedInputs[0].defaultValue = 20;
  const duration = visualInputFields(root).find(field => field.path.join('/') === 'children/0/duration')!;
  node.properties['object_' + duration.key] = 8;
  const timeline = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, timeline.clips.map(clip => ({ ...clip, at: 1.25 })), timeline.tracks);
  return { project, graph, node, root, group, text, image, hidden };
}

test('composition view keeps every child, painting order and resolved clocks without mutating a project', () => {
  const { project, graph, node, group, hidden } = fixture(), before = structuredClone(project);
  const model = compositionTimeline(project, graph, node.id, group.instanceId);
  assert.deepEqual(project, before);
  assert.equal(model.group.at, 3.25); assert.equal(model.group.action.duration, 16); assert.equal(model.group.scale, 4);
  assert.deepEqual(model.children.map(child => child.object.name), ['在范围外', '标题', '图片']);
  const outside = model.children.find(child => child.object.instanceId === hidden.instanceId)!;
  assert.equal(outside.at, 39.25); assert.equal(outside.until, 19.25);
  assert.equal(outside.action.duration, 4);
});

test('moving and trimming children uses parent scales and preserves authored curves and unrelated inputs', () => {
  const { project, graph, node, group, text } = fixture();
  const before = rawSavedBlueprintAction(node) as VisualObject, links = structuredClone(graph.links), inputs = structuredClone(graph.exposedInputs);
  const properties = { ...node.properties };
  setCompositionTiming(project, graph, node.id, text.instanceId, { startAt: 4, duration: 3 });
  const after = rawSavedBlueprintAction(node) as VisualObject, edited = after.children![0].children![0];
  assert.equal(edited.startAt, 1); assert.equal(edited.duration, text.duration);
  assert.deepEqual(edited.curves, text.curves); assert.deepEqual(after.children![0].children!.slice(1), before.children![0].children!.slice(1));
  assert.deepEqual(graph.links, links); assert.deepEqual(graph.exposedInputs, inputs);
  const resolved = compositionObject(project, graph, node.id, text.instanceId);
  assert.equal(resolved.at, 7.25); assert.equal(resolved.action.duration, 3); assert.equal(resolved.parentScale, 4); assert.equal(resolved.scale, 2);
  const duration = compositionFieldBinding(graph, resolved, ['duration']).pinId!;
  assert.equal(node.properties[duration], .75);
  for (const [key, value] of Object.entries(properties)) if (key !== 'action') assert.equal(node.properties[key], value);
  assert.equal(compositionObject(project, graph, node.id, group.instanceId).action.duration, 16);
  assert.equal(performanceTimeline(project, graph).clips[0].duration, 20);
  projectSchema.parse(project);
});

test('out-of-range and zero-length objects can be recovered by moving and resizing', () => {
  const { project, graph, node, group, hidden } = fixture();
  setCompositionTiming(project, graph, node.id, hidden.instanceId, { duration: 0 });
  assert.ok(compositionTimeline(project, graph, node.id, group.instanceId).children.some(child => child.object.instanceId === hidden.instanceId));
  setCompositionTiming(project, graph, node.id, hidden.instanceId, { startAt: 0, duration: 4 });
  const recovered = compositionObject(project, graph, node.id, hidden.instanceId);
  assert.equal(recovered.at, 3.25); assert.equal(recovered.until, 7.25);
  assert.throws(() => setCompositionTiming(project, graph, node.id, hidden.instanceId, { startAt: Number.NaN }), /有限/);
  assert.equal(compositionObject(project, graph, node.id, hidden.instanceId).at, 3.25);
});

test('title text and size edit public defaults while preserving shared bindings and authored content', () => {
  const project = createProject(), { graph } = chapterCompositionBlueprint(project, { title: '第一章', subtitle: '归途', effect: 'ink', duration: 7 });
  addProjectGraphs(project, graph);
  const node = graph.nodes.find(node => rawSavedBlueprintAction(node)?.kind === 'visual')!;
  const original = rawSavedBlueprintAction(node) as VisualObject;
  const title = original.children![1].children!.find(child => child.name === '章节标题')!;
  const view = compositionObject(project, graph, node.id, title.instanceId), binding = compositionFieldBinding(graph, view, ['text']);
  assert.ok(binding.input);
  const links = structuredClone(graph.links), clips = structuredClone(performanceTimeline(project, graph).clips);
  patchCompositionObject(project, graph, node.id, title.instanceId, { text: '第二章', fontSize: 90 });
  assert.equal(binding.input!.defaultValue, '第二章');
  assert.equal(compositionObject(project, graph, node.id, title.instanceId).action.text, '第二章');
  assert.equal(compositionObject(project, graph, node.id, title.instanceId).action.fontSize, 90);
  assert.deepEqual(rawSavedBlueprintAction(node), original); assert.deepEqual(graph.links, links);
  assert.deepEqual(performanceTimeline(project, graph).clips, clips);
  const reader = graph.nodes.find(item => item.type === 'getInput' && item.properties.inputId === binding.input!.id)!;
  const sharedPins = graph.links.filter(link => link.fromNodeId === reader.id);
  assert.ok(sharedPins.length > 1, 'title and emission source must share this input');
  projectSchema.parse(project);
});

test('computed duration prevents trimming atomically but does not block movement or unrelated edits', () => {
  const { project, graph, node, group, text } = fixture();
  const view = compositionObject(project, graph, node.id, text.instanceId), pin = compositionFieldBinding(graph, view, ['duration']).pinId!;
  const reader = blueprintNodeDefaults('literal'); reader.properties.value = 2; reader.pins[0].dataType = 'number';
  graph.nodes.push(reader);
  assert.equal(connectBlueprintPins(graph, reader.id, 'value', node.id, pin), undefined);
  const before = structuredClone(project);
  assert.throws(() => editTimelineProject(project, graph.id, (draft, target) => setCompositionTiming(draft, target, node.id, text.instanceId, { startAt: 2, duration: 5 })), /蓝图计算/);
  assert.deepEqual(project, before);
  setCompositionTiming(project, graph, node.id, text.instanceId, { startAt: 1 });
  patchCompositionObject(project, graph, node.id, text.instanceId, { name: '可以移动' });
  assert.equal(compositionObject(project, graph, node.id, text.instanceId).at, compositionObject(project, graph, node.id, group.instanceId).at + 1);
  assert.ok(graph.links.some(link => link.toPinId === pin));
});

test('layer reorder and insertion preserve instance identities and literal targets', () => {
  const { project, graph, node, group, text, hidden } = fixture();
  const originalPins = node.pins.map(pin => pin.id), originalLinks = structuredClone(graph.links);
  reorderCompositionChild(project, graph, node.id, group.instanceId, text.instanceId, 0);
  assert.equal(compositionTimeline(project, graph, node.id, group.instanceId).children[0].object.instanceId, text.instanceId);
  assert.deepEqual(node.pins.map(pin => pin.id), originalPins); assert.deepEqual(graph.links, originalLinks);
  const object = createVisualObject('text');
  addCompositionChild(project, graph, node.id, group.instanceId, object, 4);
  const added = compositionObject(project, graph, node.id, object.instanceId);
  assert.equal(added.object.startAt, 1); assert.equal(added.action.duration, 3); assert.equal(added.at, 7.25);
  setCompositionTiming(project, graph, node.id, hidden.instanceId, { startAt: 2 });
  assert.equal(compositionObject(project, graph, node.id, text.instanceId).object.startAt, text.startAt);
  assert.equal(compositionObject(project, graph, node.id, hidden.instanceId).at, 5.25);
  projectSchema.parse(project);
});

test('duplicated nested groups get fresh identities and retain linked and literal child inputs', () => {
  const { project, graph, node, root, group, text } = fixture();
  const textField = compositionFieldBinding(graph, compositionObject(project, graph, node.id, text.instanceId), ['text']).pinId!;
  exposePerformanceInputs(graph, [performanceInputs(graph).find(field => field.nodeId === node.id && field.pinId === textField)!]);
  const input = graph.exposedInputs.at(-1)!; input.defaultValue = '共享标题';
  const original = rawSavedBlueprintAction(node) as VisualObject;
  const duplicatedId = duplicateCompositionChild(project, graph, node.id, root.instanceId, group.instanceId);
  const duplicated = compositionObject(project, graph, node.id, duplicatedId);
  assert.notEqual(duplicated.object.instanceId, group.instanceId);
  assert.equal(duplicated.action.duration, 16);
  assert.equal(duplicated.action.children![0].text, '共享标题');
  assert.notEqual(duplicated.object.children![0].instanceId, text.instanceId);
  const duplicateTitle = duplicated.object.children![0].instanceId;
  patchCompositionObject(project, graph, node.id, duplicateTitle, { text: '同步修改' });
  assert.equal(compositionObject(project, graph, node.id, text.instanceId).action.text, '同步修改');
  assert.deepEqual((rawSavedBlueprintAction(node) as VisualObject).children![0].children, original.children![0].children);
  removeCompositionChild(project, graph, node.id, root.instanceId, duplicatedId);
  assert.ok(graph.links.every(link => link.toNodeId !== node.id || node.pins.some(pin => pin.id === link.toPinId)));
  assert.ok(graph.exposedInputs.some(item => item.id === input.id));
  assert.equal(compositionObject(project, graph, node.id, text.instanceId).action.text, '同步修改');
  projectSchema.parse(project);
});

test('preview movement and property-frame edits write back to the correct nested animation clock', () => {
  const { project, graph, node, text, image } = fixture();
  const view = compositionObject(project, graph, node.id, text.instanceId);
  setCompositionPose(project, graph, node.id, text.instanceId, view.at + 2, { x: .9, y: .6 });
  const edited = compositionObject(project, graph, node.id, text.instanceId);
  assert.equal(edited.object.curves!.x!.find(frame => frame.at === .5)!.value, .9);
  assert.equal(visualPose(edited.action, 2).x, .9);
  assert.equal(edited.object.keyframes[0].y, .6); assert.equal(edited.object.curves?.y, undefined);
  toggleCompositionKeyframe(project, graph, node.id, text.instanceId, view.at + 1, 'opacity');
  assert.equal(compositionObject(project, graph, node.id, text.instanceId).object.curves!.opacity![0].at, .25);
  setCompositionCurve(project, graph, node.id, text.instanceId, 'opacity', [{ at: 2, value: .4, easing: 'linear' }]);
  assert.equal(compositionObject(project, graph, node.id, text.instanceId).object.curves!.opacity![0].at, .5);
  assert.throws(() => setCompositionPose(project, graph, node.id, text.instanceId, view.until, { x: 0 }), /可见区间/);
  // Non-retimed objects can add a frame in a duration override beyond raw duration.
  setCompositionTiming(project, graph, node.id, image.instanceId, { startAt: 0, duration: 20 });
  const imageView = compositionObject(project, graph, node.id, image.instanceId);
  toggleCompositionKeyframe(project, graph, node.id, image.instanceId, imageView.at + 13, 'x');
  assert.equal(compositionObject(project, graph, node.id, image.instanceId).object.duration, image.duration);
  assert.equal(compositionObject(project, graph, node.id, image.instanceId).object.curves!.x![0].at, 3.25);
  projectSchema.parse(project);
});

test('changing a composition duration validates outer-track conflicts as a single atomic edit', () => {
  const { project, graph, node, root } = fixture();
  const second = createVisualObject('solid'); second.duration = 1;
  const model = performanceTimeline(project, graph), track = model.tracks[0];
  insertTimelineAction(project, graph, second, 21.25, track.id);
  const before = structuredClone(project);
  assert.throws(() => editTimelineProject(project, graph.id, (draft, target) => setCompositionTiming(draft, target, node.id, root.instanceId, { duration: 22 })), /同一轨道/);
  assert.deepEqual(project, before);
  editTimelineProject(project, graph.id, (draft, target) => setCompositionTiming(draft, target, node.id, root.instanceId, { duration: 18 }));
  const saved = projectGraphs(project).find(item => item.id === graph.id)!;
  assert.equal(performanceTimeline(project, saved).clips[0].duration, 18);
});
