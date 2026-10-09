import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type VisualObject } from '../src/core/model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createVisualObject, visualInputFields, visualPose } from '../src/core/visual-object';
import { arrangePerformanceTimeline, insertTimelineAction, performanceTimeline } from '../src/core/performance-timeline';
import { compositionObject, duplicateCompositionChild, patchCompositionObject, setCompositionField } from '../src/core/composition-timeline';
import { addCompositionGlyphParticles, exposeCompositionProperty, groupCompositionSelection, groupTimelineSelection, insertCompositionResource, saveCompositionResource } from '../src/core/composition-authoring';
import { instantiateVisualComposition, materializeVisualCompositions } from '../src/core/visual-composition';
import { visualInstancePath } from '../src/core/visual-selection';
import { editTimelineProject } from '../src/core/timeline-edit-validation';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { createAudioClip } from '../src/core/audio-clip';
import { validateProject } from '../src/core/validate';
import { visualAssetKind } from '../src/core/visual-parameters';

function fixture() {
  const project = createProject('通用组合');
  for (const id of ['picture_a', 'picture_b']) project.assets.push({ id, name: id, kind: 'image', path: id + '.png' });
  const image = createVisualObject('image', 'picture_a'), text = createVisualObject('text'); text.text = '标题';
  const middle = { ...createVisualObject('group'), name: '内层', duration: 4, children: [image, text] };
  const root = { ...createVisualObject('group'), name: '演出组合', duration: 5, children: [middle] };
  const graph = blueprintFromPerformance(project, [root], '主时间轴'); graph.timelineComponent = true; addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph); arrangePerformanceTimeline(project, graph, model.clips, model.tracks);
  const node = graph.nodes.find(node => node.type === 'savedAction')!;
  return { project, graph, node, root, middle, image, text };
}

test('regrouping nested objects preserves live inputs, literal overrides, time and identities', () => {
  const { project, graph, node, root, middle, image, text } = fixture();
  const field = visualInputFields(root).find(field => field.path.join('/') === 'children/0/children/1/text')!;
  const input = performanceInputs(graph).find(input => input.pinId === 'object_' + field.key)!;
  exposePerformanceInputs(graph, [{ ...input, name: '标题' }]); graph.exposedInputs[0].defaultValue = '调用文字';
  const imageField = visualInputFields(root).find(field => field.path.join('/') === 'children/0/children/0/assetId')!;
  node.properties['object_' + imageField.key] = 'picture_b';
  const group = groupCompositionSelection(project, graph, node.id, middle.instanceId, [image.instanceId, text.instanceId]);
  assert.equal(compositionObject(project, graph, node.id, image.instanceId).action.assetId, 'picture_b');
  assert.equal(compositionObject(project, graph, node.id, text.instanceId).action.text, '调用文字');
  assert.equal(compositionObject(project, graph, node.id, group).at, 0);
  assert.equal(graph.links.filter(link => link.toNodeId === node.id && link.toPinId.startsWith('object_')).length, 1);
  assert.equal(projectSchema.safeParse(project).success, true);
});

test('outer grouping retains selected timing, stacking and bindings without moving unrelated clips', () => {
  const project = createProject(), graph = createBlueprintGraph('effect', '外层'); graph.timelineComponent = true; addProjectGraphs(project, graph);
  const a = createVisualObject('text'), b = createVisualObject('solid'); a.text = '原文'; b.duration = 4;
  const aId = insertTimelineAction(project, graph, a, 1, 'track_front'), bId = insertTimelineAction(project, graph, b, 2, 'track_back');
  const untouchedId = insertTimelineAction(project, graph, createVisualObject('text'), 8, 'track_other');
  exposePerformanceInputs(graph, [{ ...performanceInputs(graph).find(field => field.nodeId === aId && field.pinId === 'object_text')!, name: '标题' }]); graph.exposedInputs[0].defaultValue = '新标题';
  const newId = groupTimelineSelection(project, graph, [aId, bId]);
  const model = performanceTimeline(project, graph), clip = model.clips.find(clip => clip.nodeId === newId)!;
  assert.equal(clip.at, 1); assert.equal(clip.duration, 5);
  assert.equal(model.clips.find(clip => clip.nodeId === untouchedId)!.at, 8);
  const visual = model.actionsByNode.get(newId)!.find(action => action.kind === 'visual')! as VisualObject;
  assert.equal(visual.children![0].text, '新标题'); assert.equal(visual.children![1].startAt, 1);
  assert.ok(visual.children![0].layer > visual.children![1].layer);
  assert.equal(visualInstancePath(visual, a.instanceId)?.length, 1);
});

test('an image parameter passes through nested group interfaces into a caller without changing the defaults', () => {
  const { project, graph, node, root, middle, image } = fixture();
  const inner = exposeCompositionProperty(project, graph, node.id, middle.instanceId, image.instanceId, ['assetId'], '背景图片', 'asset', 'picture_a');
  const outer = exposeCompositionProperty(project, graph, node.id, root.instanceId, middle.instanceId, ['parameterValues', inner], '背景图片', 'asset', 'picture_a');
  const field = visualInputFields(rawSavedBlueprintAction(node) as VisualObject).find(field => field.path.join('/') === 'parameterValues/' + outer)!;
  exposePerformanceInputs(graph, [{ ...performanceInputs(graph).find(input => input.pinId === 'object_' + field.key)!, name: '调用图片' }]);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [graph.exposedInputs[0].id]: 'picture_b' } }], previewActionContext(project));
  const action = actions.find(action => action.kind === 'visual')! as VisualObject;
  assert.equal(action.children![0].children![0].assetId, 'picture_b');
  assert.equal(compositionObject(project, graph, node.id, image.instanceId).action.assetId, 'picture_a');
  setCompositionField(project, graph, node.id, image.instanceId, ['assetId'], 'picture_b');
  assert.equal(graph.exposedInputs[0].defaultValue, 'picture_b');
});

test('reusable compositions follow resource edits, retain per-instance parameters and isolate identities', () => {
  const { project, graph, node, root, middle, image } = fixture();
  const parameter = exposeCompositionProperty(project, graph, node.id, root.instanceId, image.instanceId, ['assetId'], '背景图片', 'asset', 'picture_a');
  const resourceId = saveCompositionResource(project, graph, node.id, root.instanceId, '可复用标题');
  const owner = createBlueprintGraph('effect', '其他时间轴'); owner.timelineComponent = true; addProjectGraphs(project, owner);
  const aId = insertCompositionResource(project, owner, resourceId, 0), bId = insertCompositionResource(project, owner, resourceId, 5);
  const a = rawSavedBlueprintAction(owner.nodes.find(node => node.id === aId)!) as VisualObject, b = rawSavedBlueprintAction(owner.nodes.find(node => node.id === bId)!) as VisualObject;
  setCompositionField(project, owner, aId, a.instanceId, ['parameterValues', parameter], 'picture_b');
  const resource = projectGraphs(project).find(graph => graph.id === resourceId)!, resourceNode = resource.nodes.find(node => node.type === 'savedAction')!;
  patchCompositionObject(project, resource, resourceNode.id, middle.instanceId, { name: '来源已更新', color: '#112233' });
  synchronizeBlueprintSignatures(project);
  const model = performanceTimeline(project, owner);
  const first = model.actionsByNode.get(aId)![0] as VisualObject, second = model.actionsByNode.get(bId)![0] as VisualObject;
  assert.equal(first.children![0].children![0].name, '来源已更新');
  assert.equal(first.children![0].children![0].children![0].assetId, 'picture_b');
  assert.equal(second.children![0].children![0].children![0].assetId, 'picture_a');
  assert.notEqual(first.children![0].instanceId, second.children![0].instanceId);
  const loaded = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.equal(performanceTimeline(loaded, projectGraphs(loaded).find(graph => graph.id === owner.id)!).clips.length, 2);
  assert.throws(() => insertCompositionResource(project, resource, resourceId, 0), /循环/);
});

test('duplicating a group remaps parameter targets instead of coupling the copy to its sibling', () => {
  const { project, graph, node, root, middle, image } = fixture();
  const parameter = exposeCompositionProperty(project, graph, node.id, middle.instanceId, image.instanceId, ['assetId'], '图片', 'asset', 'picture_a');
  const id = duplicateCompositionChild(project, graph, node.id, root.instanceId, middle.instanceId);
  setCompositionField(project, graph, node.id, id, ['parameterValues', parameter], 'picture_b');
  assert.equal(compositionObject(project, graph, node.id, id).action.children![0].assetId, 'picture_b');
  assert.equal(compositionObject(project, graph, node.id, image.instanceId).action.assetId, 'picture_a');
});

test('generated text particles share the public text and reproduce the title emission clock', () => {
  const { project, graph, node, middle, text } = fixture();
  const parameter = exposeCompositionProperty(project, graph, node.id, middle.instanceId, text.instanceId, ['text'], '标题', 'string', '标题');
  const id = addCompositionGlyphParticles(project, graph, node.id, middle.instanceId, text.instanceId);
  setCompositionField(project, graph, node.id, middle.instanceId, ['parameterValues', parameter], '替换的标题');
  const particle = compositionObject(project, graph, node.id, id).action;
  assert.equal(particle.text, '替换的标题'); assert.equal(particle.glyphParticles!.source, 'text');
  assert.equal(particle.duration, text.duration); assert.ok(particle.glyphParticles!.emissionStart < particle.duration);
});

test('particles generated from a fading rotated image remain visible and retain the emission transform', () => {
  const { project, graph, node, middle, image } = fixture();
  const raw = rawSavedBlueprintAction(node) as VisualObject, source = raw.children![0].children![0];
  Object.assign(source.keyframes[0], { x: .7, y: .3, scale: 1.4, rotation: 25, opacity: .8 });
  source.curves = { opacity: [{ at: 0, value: .8, easing: 'linear' }, { at: source.duration, value: 0, easing: 'linear' }] };
  node.properties.action = JSON.stringify(raw);
  const id = addCompositionGlyphParticles(project, graph, node.id, middle.instanceId, image.instanceId);
  const particle = compositionObject(project, graph, node.id, id).action;
  const { x, y, scale, rotation, opacity } = visualPose(particle, 0);
  assert.deepEqual({ x, y, scale, rotation, opacity }, { x: .7, y: .3, scale: 1.4, rotation: 25, opacity: .8 });
  assert.deepEqual(particle.glyphParticles!.rect, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(particle.curves, undefined);
});

test('replacing a public video asset keeps its metadata and updates the containing timeline deadline', () => {
  const project = createProject(), graph = createBlueprintGraph('effect', '视频'); graph.timelineComponent = true; addProjectGraphs(project, graph);
  for (const id of ['long', 'short']) project.assets.push({ id, name: id, kind: 'video', path: id + '.webm' });
  const video = createVisualObject('video', 'long'); video.duration = video.sourceDuration = 6;
  const nodeId = insertTimelineAction(project, graph, video, 0);
  exposePerformanceInputs(graph, [{ ...performanceInputs(graph).find(input => input.nodeId === nodeId && input.pinId === 'object_assetId')!, name: '视频' }]);
  patchCompositionObject(project, graph, nodeId, video.instanceId, { assetId: 'short', sourceDuration: 2, mediaOffset: 0 });
  const model = performanceTimeline(project, graph), resolved = model.actionsByNode.get(nodeId)![0] as VisualObject;
  assert.equal(resolved.assetId, 'short'); assert.equal(resolved.sourceDuration, 2);
  assert.equal(graph.exposedInputs[0].defaultValue, 'short'); assert.equal(model.until, 2); assert.equal(model.clips[0].duration, 2);
  patchCompositionObject(project, graph, nodeId, video.instanceId, { assetId: 'long', sourceDuration: 6, mediaOffset: 0 });
  assert.equal(performanceTimeline(project, graph).until, 6);
});

test('parameter edits affecting a root duration keep the deadline correct and reject caller overlaps atomically', () => {
  const { project, graph, node, root } = fixture();
  setCompositionField(project, graph, node.id, root.instanceId, ['duration'], 8);
  assert.equal(performanceTimeline(project, graph).until, 8);
  const next = insertTimelineAction(project, graph, createVisualObject('text'), 8, graph.timeline!.tracks[0].id);
  const before = structuredClone(project);
  assert.throws(() => editTimelineProject(project, graph.id, (draft, target) => setCompositionField(draft, target, node.id, root.instanceId, ['duration'], 9)), /重叠/);
  assert.deepEqual(project, before); assert.ok(next);
});

test('mixed visual and sound selections retain timing and inputs, and overlapping calls have independent instances', () => {
  const { project, graph, node } = fixture();
  project.assets.push({ id: 'sound', name: '声音', kind: 'audio', path: 'sound.wav' });
  const soundId = insertTimelineAction(project, graph, createAudioClip('sound', '声音', 2, 'sound'), 1, 'audio_track');
  exposePerformanceInputs(graph, [{ ...performanceInputs(graph).find(input => input.nodeId === soundId && input.pinId === 'clip_volume')!, name: '音量' }]);
  graph.exposedInputs.at(-1)!.defaultValue = .6;
  const callId = groupTimelineSelection(project, graph, [node.id, soundId]);
  const childId = String(graph.nodes.find(node => node.id === callId)!.properties.graphId), child = projectGraphs(project).find(graph => graph.id === childId)!;
  assert.ok(child.compositionContainer);
  assert.deepEqual(performanceTimeline(project, child).clips.map(clip => clip.at), [0, 1]);
  assert.equal(performanceTimeline(project, graph).clips[0].duration, 5);
  insertCompositionResource(project, graph, childId, .5, 'second_call');
  const context = previewActionContext(project), actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
  assert.equal(context.incomplete, false);
  const visuals = actions.filter(action => action.kind === 'visual'), sounds = actions.filter(action => action.kind === 'audioClip');
  assert.equal(visuals.length, 2); assert.notEqual(visuals[0].instanceId, visuals[1].instanceId);
  assert.equal(sounds.length, 2); assert.notEqual(sounds[0].instanceId, sounds[1].instanceId); assert.equal(sounds[1].volume, .6);
  const byNode = performanceTimeline(project, graph).actionsByNode;
  assert.deepEqual([...byNode.values()].flat().filter(action => action.kind === 'visual').map(action => action.instanceId), visuals.map(action => action.instanceId));
  assert.equal(projectSchema.safeParse(project).success, true);
  assert.equal(validateProject(project).filter(row => row.severity === 'error').length, 0);
  assert.throws(() => insertCompositionResource(project, child, graph.id, 0), /循环/);
});

test('associating a property with an existing parameter keeps that parameter authoritative and removes duplicate input links', () => {
  const { project, graph, node, middle, image } = fixture();
  const second = createVisualObject('image', 'picture_b');
  const root = rawSavedBlueprintAction(node) as VisualObject; root.children![0].children!.push(second);
  node.properties.action = JSON.stringify(root); synchronizeBlueprintSignatures(project);
  const parameter = exposeCompositionProperty(project, graph, node.id, middle.instanceId, image.instanceId, ['assetId'], '共享图片', 'asset', 'picture_a');
  const raw = rawSavedBlueprintAction(node) as VisualObject;
  const field = visualInputFields(raw).find(field => field.path.join('/') === 'children/0/children/2/assetId')!;
  exposePerformanceInputs(graph, [{ ...performanceInputs(graph).find(input => input.pinId === 'object_' + field.key)!, name: '旧图片' }]);
  exposeCompositionProperty(project, graph, node.id, middle.instanceId, second.instanceId, ['assetId'], '共享图片', 'asset', 'picture_b', parameter);
  assert.equal(compositionObject(project, graph, node.id, second.instanceId).action.assetId, 'picture_a');
  setCompositionField(project, graph, node.id, middle.instanceId, ['parameterValues', parameter], 'picture_b');
  assert.equal(compositionObject(project, graph, node.id, image.instanceId).action.assetId, 'picture_b');
  assert.equal(graph.links.filter(link => link.toNodeId === node.id && link.toPinId === 'object_' + field.key).length, 0);
});

test('public video and font inputs retain their asset types through multiple interfaces', () => {
  const { project, graph, node, root, middle, image } = fixture();
  const action = rawSavedBlueprintAction(node) as VisualObject;
  const video = action.children![0].children![0]; video.content = 'video'; video.assetId = 'video';
  project.assets.push({ id: 'video', name: '视频', kind: 'video', path: 'video.webm' }, { id: 'font', name: '字体', kind: 'font', path: 'font.ttf' });
  node.properties.action = JSON.stringify(action); synchronizeBlueprintSignatures(project);
  const inner = exposeCompositionProperty(project, graph, node.id, middle.instanceId, image.instanceId, ['assetId'], '视频', 'asset', 'video');
  const outer = exposeCompositionProperty(project, graph, node.id, root.instanceId, middle.instanceId, ['parameterValues', inner], '视频', 'asset', 'video');
  const updated = rawSavedBlueprintAction(node) as VisualObject;
  assert.equal(visualAssetKind(updated, ['parameterValues', outer]), 'video');
  const field = visualInputFields(updated).find(field => field.path[0] === 'parameterValues' && field.path[1] === outer)!;
  exposePerformanceInputs(graph, [{ ...performanceInputs(graph).find(input => input.pinId === 'object_' + field.key)!, name: '视频' }]);
  const fontInner = exposeCompositionProperty(project, graph, node.id, middle.instanceId, image.instanceId, ['fontAssetId'], '字体', 'asset', 'font');
  const fontOuter = exposeCompositionProperty(project, graph, node.id, root.instanceId, middle.instanceId, ['parameterValues', fontInner], '字体', 'asset', 'font');
  const withFont = rawSavedBlueprintAction(node) as VisualObject;
  assert.equal(visualAssetKind(withFont, ['parameterValues', fontOuter]), 'font');
  const fontField = visualInputFields(withFont).find(field => field.path[0] === 'parameterValues' && field.path[1] === fontOuter)!;
  exposePerformanceInputs(graph, [{ ...performanceInputs(graph).find(input => input.pinId === 'object_' + fontField.key)!, name: '字体' }]);
  project.nodes[0].kind === 'passage' && project.nodes[0].lines[0].actions.push({ kind: 'blueprint', blueprintId: graph.id, inputs: { [graph.exposedInputs[0].id]: 'video' } });
  assert.equal(validateProject(project).some(row => row.message.includes('格式不匹配')), false);
});
