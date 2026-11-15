import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type VisualObject } from '../src/core/model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createVisualObject, visualInputFields, visualPose } from '../src/core/visual-object';
import { arrangePerformanceTimeline, insertTimelineAction, performanceTimeline, timelinePath } from '../src/core/performance-timeline';
import { compositionObject, duplicateCompositionChild, patchCompositionObject, setCompositionField } from '../src/core/composition-timeline';
import { addCompositionGlyphParticles, duplicateTimelineSelection, exposeCompositionProperty, groupCompositionSelection, groupTimelineSelection, insertCompositionResource, saveCompositionResource } from '../src/core/composition-authoring';
import { instantiateVisualComposition, materializeVisualCompositions } from '../src/core/visual-composition';
import { visualInstancePath } from '../src/core/visual-selection';
import { editTimelineProject } from '../src/core/timeline-edit-validation';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { createAudioClip } from '../src/core/audio-clip';
import { validateProject } from '../src/core/validate';
import { visualAssetKind } from '../src/core/visual-parameters';
import { mutateProject } from '../src/core/project-mutation';
import { nestedTimelineEditFixture } from '../scripts/lib/nested-timeline-edit-fixture';

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

function linkedTimelineFixture() {
  const project = createProject('片段数据连线');
  const producers = ['原片段结果', '副本片段结果'].map(title => {
    const child = blueprintFromPerformance(project, [{ ...createVisualObject('solid'), duration: 1 }], title);
    child.timelineComponent = true;
    child.exposedOutputs = [{ id: 'title', name: '标题结果', direction: 'output', dataType: 'string', required: false, defaultValue: title }];
    addProjectGraphs(project, child);
    const model = performanceTimeline(project, child); arrangePerformanceTimeline(project, child, model.clips, model.tracks);
    return child;
  });
  const graph = createBlueprintGraph('effect', '有结果引用的时间轴'); graph.timelineComponent = true; addProjectGraphs(project, graph);
  const callId = insertTimelineAction(project, graph, { kind: 'blueprint', blueprintId: producers[0].id }, 0, 'producer_track');
  const text = { ...createVisualObject('text'), text: '未读取结果', duration: 2 };
  const group = { ...createVisualObject('group'), name: '接收结果的字幕', duration: 2, children: [text] };
  const textId = insertTimelineAction(project, graph, group, 1, 'text_track');
  const textPin = 'object_' + visualInputFields(group).find(field => field.path.join('/') === 'children/0/text')!.key;
  const sizePin = 'object_' + visualInputFields(group).find(field => field.path.join('/') === 'children/0/fontSize')!.key;
  assert.equal(connectBlueprintPins(graph, callId, 'out_title', textId, textPin), undefined);
  exposePerformanceInputs(graph, [{ ...performanceInputs(graph).find(input => input.nodeId === textId && input.pinId === sizePin)!, name: '共享字号' }]);
  graph.exposedInputs[0].defaultValue = 47;
  return { project, graph, producers, callId, textId, textPin, sizePin, group };
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

test('nested grouping rejects separated painting layers before changing any object or binding', () => {
  const { project, graph, node, root, middle } = fixture();
  const children = [2, 1, 0].map(layer => ({ ...createVisualObject('solid'), layer }));
  const source = rawSavedBlueprintAction(node) as VisualObject; source.children![0].children = children;
  node.properties.action = JSON.stringify(source); synchronizeBlueprintSignatures(project);
  const before = structuredClone(project), ids = [children[0].instanceId, children[2].instanceId];
  assert.throws(() => groupCompositionSelection(project, graph, node.id, middle.instanceId, ids), /前后遮挡.*一同选中/);
  assert.deepEqual(project, before);
  assert.throws(() => editTimelineProject(project, graph.id, (draft, target) => groupCompositionSelection(draft, target, node.id, middle.instanceId, ids)), /前后遮挡/);
  assert.deepEqual(project, before, 'failed grouping also leaves the outer transaction unchanged');
  assert.equal(compositionObject(project, graph, node.id, root.instanceId).object.children!.length, 1);
});

test('continuous nested grouping preserves equal-layer painting order and the remaining siblings', () => {
  for (const layers of [[0, 0, 0, 0], [-1, 0, 2, 3]]) {
    const { project, graph, node, middle } = fixture();
    const children = layers.map(layer => ({ ...createVisualObject('solid'), layer }));
    const source = rawSavedBlueprintAction(node) as VisualObject; source.children![0].children = children;
    node.properties.action = JSON.stringify(source); synchronizeBlueprintSignatures(project);
    const paintOrder = (object: VisualObject): string[] => object.content === 'group'
      ? (object.children ?? []).map((child, index) => ({ child, index })).sort((a, b) => b.child.layer - a.child.layer || b.index - a.index).flatMap(({ child }) => paintOrder(child))
      : [object.instanceId];
    const before = compositionObject(project, graph, node.id, middle.instanceId).action;
    const groupId = groupCompositionSelection(project, graph, node.id, middle.instanceId, [children[2].instanceId, children[1].instanceId]);
    const after = compositionObject(project, graph, node.id, middle.instanceId).action;
    assert.deepEqual(paintOrder(after), paintOrder(before));
    assert.deepEqual(after.children!.filter(child => child.instanceId !== groupId).map(child => child.instanceId), [children[0].instanceId, children[3].instanceId]);
    assert.equal(compositionObject(project, graph, node.id, groupId).action.children!.length, 2);
    projectSchema.parse(project);
  }
});

test('root grouping rejects both intermediate and front-row occlusion changes atomically', () => {
  for (const sameFrontRow of [false, true]) {
    const project = createProject(), graph = createBlueprintGraph('effect', '遮挡保持'); graph.timelineComponent = true; addProjectGraphs(project, graph);
    const front = insertTimelineAction(project, graph, { ...createVisualObject('solid'), duration: sameFrontRow ? 1 : 5 }, 0, 'front');
    const other = insertTimelineAction(project, graph, { ...createVisualObject('solid'), name: '未选中的前景', duration: 1 }, sameFrontRow ? 3 : 0, sameFrontRow ? 'front' : 'middle');
    const back = insertTimelineAction(project, graph, { ...createVisualObject('solid'), duration: 5 }, 0, 'back');
    const before = structuredClone(project);
    assert.throws(() => groupTimelineSelection(project, graph, [front, back]), /前后遮挡.*调整轨道/);
    assert.deepEqual(project, before);
    assert.throws(() => editTimelineProject(project, graph.id, (draft, target) => groupTimelineSelection(draft, target, [front, back])), /前后遮挡/);
    assert.deepEqual(project, before);
    assert.ok(graph.nodes.some(node => node.id === other));
  }
});

test('root grouping can cross an empty row, audio or a picture outside the selected display interval', () => {
  for (const middleKind of ['empty', 'audio', 'laterPicture'] as const) {
    const project = createProject(), graph = createBlueprintGraph('effect', '安全跨轨组合'); graph.timelineComponent = true; addProjectGraphs(project, graph);
    project.assets.push({ id: 'sound', name: '声音', kind: 'audio', path: 'sound.wav' });
    const front = insertTimelineAction(project, graph, { ...createVisualObject('text'), duration: 2 }, 0, 'front');
    let other: string | undefined;
    if (middleKind !== 'empty') other = insertTimelineAction(project, graph, middleKind === 'audio' ? createAudioClip('sound', '声音', 3) : { ...createVisualObject('solid'), duration: 1 }, middleKind === 'audio' ? 0 : 8, 'middle');
    const back = insertTimelineAction(project, graph, { ...createVisualObject('solid'), duration: 3 }, 0, 'back');
    arrangePerformanceTimeline(project, graph, performanceTimeline(project, graph).clips, ['front', 'middle', 'back'].map(id => ({ id, name: id })));
    const before = performanceTimeline(project, graph).clips.find(clip => clip.nodeId === other);
    const id = groupTimelineSelection(project, graph, [front, back]), after = performanceTimeline(project, graph);
    assert.equal(after.clips.find(clip => clip.nodeId === id)!.duration, 3);
    assert.deepEqual(after.clips.find(clip => clip.nodeId === other), before);
    assert.equal(after.reason, undefined);
    projectSchema.parse(project);
  }
});

test('root duplication remaps internal result wires and keeps external inputs shared through save and independent edits', () => {
  const { project, graph, producers, callId, textId, textPin, sizePin, group } = linkedTimelineFixture();
  const external = graph.links.find(link => link.toNodeId === textId && link.toPinId === sizePin)!;
  const before = structuredClone(project);
  const sourceContext = previewActionContext(project), sourceActions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], sourceContext);
  assert.equal(sourceContext.incomplete, false);
  assert.equal(sourceActions.find((action): action is VisualObject => action.kind === 'visual' && action.name === group.name)!.children![0].text, '原片段结果');
  const ids = editTimelineProject(project, graph.id, (draft, target) => duplicateTimelineSelection(draft, target, [textId, callId]));
  const updated = projectGraphs(project).find(item => item.id === graph.id)!;
  const copyCall = updated.nodes.find(node => ids.includes(node.id) && node.type === 'callFunction')!;
  const copyText = updated.nodes.find(node => ids.includes(node.id) && node.type === 'savedAction')!;
  const copyObject = rawSavedBlueprintAction(copyText) as VisualObject;
  const copyTextPin = 'object_' + visualInputFields(copyObject).find(field => field.path.join('/') === 'children/0/text')!.key;
  const copySizePin = 'object_' + visualInputFields(copyObject).find(field => field.path.join('/') === 'children/0/fontSize')!.key;
  assert.notEqual(copyTextPin, textPin); assert.notEqual(copySizePin, sizePin);
  const internal = updated.links.filter(link => link.toNodeId === copyText.id && link.toPinId === copyTextPin);
  assert.equal(internal.length, 1); assert.equal(internal[0].fromNodeId, copyCall.id); assert.equal(internal[0].fromPinId, 'out_title');
  assert.ok(updated.links.some(link => link.fromNodeId === external.fromNodeId && link.fromPinId === external.fromPinId && link.toNodeId === copyText.id && link.toPinId === copySizePin));
  assert.ok(updated.links.some(link => link.fromNodeId === callId && link.toNodeId === textId && link.toPinId === textPin));
  copyCall.properties.graphId = producers[1].id;
  const loaded = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const context = previewActionContext(loaded), actions = expandPreviewActions(loaded, [{ kind: 'blueprint', blueprintId: graph.id }], context);
  assert.equal(context.incomplete, false);
  const original = actions.find((action): action is VisualObject => action.kind === 'visual' && action.name === group.name)!;
  const copied = actions.find((action): action is VisualObject => action.kind === 'visual' && action.name === group.name + ' 副本')!;
  assert.equal(original.children![0].text, '原片段结果'); assert.equal(copied.children![0].text, '副本片段结果');
  assert.equal(original.children![0].fontSize, 47); assert.equal(copied.children![0].fontSize, 47);
  assert.deepEqual(projectGraphs(project).filter(item => item.id !== graph.id), projectGraphs(before).filter(item => item.id !== graph.id));
});

test('mixed grouping refuses an output still used outside the group without losing any graph data', () => {
  const { project, graph, callId, textId, textPin } = linkedTimelineFixture();
  project.assets.push({ id: 'sound', name: '声音', kind: 'audio', path: 'sound.wav' });
  const audioId = insertTimelineAction(project, graph, createAudioClip('sound', '声音', .25), .5, 'sound_track');
  const before = structuredClone(project);
  assert.throws(() => groupTimelineSelection(project, graph, [callId, audioId]), /输出仍连接到组合外.*一同选中/);
  assert.deepEqual(project, before, 'the direct edit must not create a resource before rejecting the outgoing wire');
  assert.throws(() => editTimelineProject(project, graph.id, (draft, target) => groupTimelineSelection(draft, target, [callId, audioId])), /输出仍连接到组合外/);
  assert.deepEqual(project, before);
  assert.ok(graph.links.some(link => link.fromNodeId === callId && link.toNodeId === textId && link.toPinId === textPin));
});

test('root selection duplication retains nested inputs, literal typography, curves and relative track spacing in one transaction', () => {
  const project = createProject(), graph = createBlueprintGraph('effect', '多轨复制'); graph.timelineComponent = true; addProjectGraphs(project, graph);
  const text = createVisualObject('text'); text.text = '原始文字'; text.duration = 3;
  text.curves = { opacity: [{ at: 0, value: .25, easing: 'linear' }, { at: 1.5, value: .9, easing: 'linear' }, { at: 3, value: .4, easing: 'linear' }] };
  const inner = { ...createVisualObject('group'), duration: 3, children: [text] };
  const group = { ...createVisualObject('group'), name: '字幕组合', duration: 3, children: [inner] };
  const groupId = insertTimelineAction(project, graph, group, 4, 'track_front');
  const untouchedId = insertTimelineAction(project, graph, { ...createVisualObject('solid'), name: '未选背景', duration: 12 }, 0, 'track_middle');
  const backId = insertTimelineAction(project, graph, { ...createVisualObject('solid'), name: '后层色块', duration: 2 }, 1, 'track_back');
  const laterId = insertTimelineAction(project, graph, { ...createVisualObject('text'), name: '末尾字幕', duration: 2 }, 9, 'track_front');
  const tracks = [{ id: 'track_front', name: '前层' }, { id: 'track_middle', name: '中层' }, { id: 'track_back', name: '后层' }];
  arrangePerformanceTimeline(project, graph, performanceTimeline(project, graph).clips, tracks);
  const groupNode = graph.nodes.find(node => node.id === groupId)!;
  const textField = visualInputFields(group).find(field => field.path.join('/') === 'children/0/children/0/text')!;
  const sizeField = visualInputFields(group).find(field => field.path.join('/') === 'children/0/children/0/fontSize')!;
  exposePerformanceInputs(graph, [{ ...performanceInputs(graph).find(input => input.nodeId === groupId && input.pinId === 'object_' + textField.key)!, name: '共享字幕' }]);
  graph.exposedInputs[0].defaultValue = '公开参数中的标题'; groupNode.properties['object_' + sizeField.key] = 37;
  const sourceLink = graph.links.find(link => link.toNodeId === groupId && link.toPinId === 'object_' + textField.key)!;
  const before = structuredClone(project), sourceModel = performanceTimeline(project, graph);
  let ids: string[] = [];
  const after = mutateProject(project, draft => {
    ids = editTimelineProject(draft, graph.id, (candidate, target) => duplicateTimelineSelection(candidate, target, [laterId, backId, groupId, groupId]));
  });
  assert.deepEqual(project, before, 'one complete before-snapshot remains available for undo');
  assert.equal(ids.length, 3, 'repeated selection IDs do not produce extra copies');
  const updated = projectGraphs(after).find(item => item.id === graph.id)!, model = performanceTimeline(after, updated);
  assert.equal(model.reason, undefined); assert.equal(model.clips.length, sourceModel.clips.length + 3);
  const originals = new Set(sourceModel.clips.map(clip => clip.nodeId));
  assert.deepEqual(model.clips.filter(clip => originals.has(clip.nodeId)), sourceModel.clips);
  assert.deepEqual(model.clips.find(clip => clip.nodeId === untouchedId), sourceModel.clips.find(clip => clip.nodeId === untouchedId));
  const copiedNodes = ids.map(id => updated.nodes.find(node => node.id === id)!);
  const copyOf = (name: string) => copiedNodes.find(node => {
    const action = rawSavedBlueprintAction(node); return action?.kind === 'visual' && action.name === name + ' 副本';
  })!;
  const copies = new Map([[groupId, copyOf('字幕组合')], [backId, copyOf('后层色块')], [laterId, copyOf('末尾字幕')]]);
  const selected = sourceModel.clips.filter(clip => copies.has(clip.nodeId));
  const offset = Math.max(...selected.map(clip => clip.at + clip.duration)) - Math.min(...selected.map(clip => clip.at));
  let trackOffset: number | undefined;
  for (const source of selected) {
    const copied = model.clips.find(clip => clip.nodeId === copies.get(source.nodeId)!.id)!;
    assert.equal(copied.at - source.at, offset); assert.equal(copied.duration, source.duration);
    assert.notEqual(copied.trackId, source.trackId);
    const difference = model.tracks.findIndex(track => track.id === copied.trackId) - sourceModel.tracks.findIndex(track => track.id === source.trackId);
    trackOffset ??= difference; assert.equal(difference, trackOffset, 'track spacing survives a selection whose time order differs from painting order');
  }
  assert.equal(model.clips.find(clip => clip.nodeId === copies.get(groupId)!.id)!.trackId, model.clips.find(clip => clip.nodeId === copies.get(laterId)!.id)!.trackId);
  assert.equal(model.tracks.length, sourceModel.tracks.length + 3, 'one copied track per source row, including the gap between selected rows');
  assert.deepEqual(model.tracks.slice(0, sourceModel.tracks.length), sourceModel.tracks);
  const copiedNode = copies.get(groupId)!, copiedRoot = rawSavedBlueprintAction(copiedNode) as VisualObject;
  const copiedInner = copiedRoot.children![0], copiedText = copiedInner.children![0];
  assert.notEqual(copiedRoot.instanceId, group.instanceId); assert.notEqual(copiedInner.instanceId, inner.instanceId); assert.notEqual(copiedText.instanceId, text.instanceId);
  assert.equal(visualInstancePath(copiedRoot, text.instanceId), undefined);
  const resolvedText = compositionObject(after, updated, copiedNode.id, copiedText.instanceId).action;
  assert.equal(resolvedText.text, '公开参数中的标题'); assert.equal(resolvedText.fontSize, 37); assert.deepEqual(resolvedText.curves, text.curves);
  const copiedTextPin = 'object_' + visualInputFields(copiedRoot).find(field => field.path.join('/') === 'children/0/children/0/text')!.key;
  const copiedSizePin = 'object_' + visualInputFields(copiedRoot).find(field => field.path.join('/') === 'children/0/children/0/fontSize')!.key;
  assert.notEqual(copiedTextPin, 'object_' + textField.key); assert.notEqual(copiedSizePin, 'object_' + sizeField.key);
  assert.ok(copiedNode.pins.some(pin => pin.id === copiedTextPin)); assert.ok(copiedNode.pins.some(pin => pin.id === copiedSizePin));
  assert.equal(copiedNode.properties[copiedSizePin], 37); assert.equal(copiedNode.properties['object_' + sizeField.key], undefined);
  assert.ok(updated.links.some(link => link.fromNodeId === sourceLink.fromNodeId && link.fromPinId === sourceLink.fromPinId && link.toNodeId === copiedNode.id && link.toPinId === copiedTextPin));
  assert.equal(updated.nodes.filter(node => node.type === 'getInput').length, graph.nodes.filter(node => node.type === 'getInput').length);
  assert.ok(updated.links.every(link => updated.nodes.find(node => node.id === link.toNodeId)?.pins.some(pin => pin.id === link.toPinId)));
  const loaded = projectSchema.parse(JSON.parse(JSON.stringify(after))), loadedGraph = projectGraphs(loaded).find(item => item.id === graph.id)!;
  assert.equal(compositionObject(loaded, loadedGraph, copiedNode.id, copiedText.instanceId).action.fontSize, 37);
  assert.equal(compositionObject(loaded, loadedGraph, copiedNode.id, copiedText.instanceId).action.text, '公开参数中的标题');
});

test('mixed root duplication preserves audio source settings and linked and literal child-call arguments', () => {
  const project = createProject(); project.assets.push({ id: 'sound_source', name: '音乐素材', kind: 'audio', path: 'sound.wav' });
  const childText = { ...createVisualObject('text'), text: '子默认文字', duration: 2 };
  const child = blueprintFromPerformance(project, [childText], '子字幕时间轴'); child.timelineComponent = true; addProjectGraphs(project, child);
  arrangePerformanceTimeline(project, child, performanceTimeline(project, child).clips, performanceTimeline(project, child).tracks);
  exposePerformanceInputs(child, ['object_text', 'object_fontSize'].map((pinId, index) => ({ ...performanceInputs(child).find(input => input.pinId === pinId)!, name: index ? '子字号' : '子标题' })));
  const [textInput, sizeInput] = child.exposedInputs;
  const graph = createBlueprintGraph('effect', '混合片段复制'); graph.timelineComponent = true; addProjectGraphs(project, graph);
  const visualId = insertTimelineAction(project, graph, { ...createVisualObject('solid'), name: '前景色块', duration: 2 }, 0, 'visual_track');
  const audio = { ...createAudioClip('sound_source', '片段配乐', 12, 'music'), duration: 3, offset: 2, volume: .42, fadeIn: .25, fadeOut: .75 };
  const audioId = insertTimelineAction(project, graph, audio, 1, 'audio_track');
  const callId = insertTimelineAction(project, graph, { kind: 'blueprint', blueprintId: child.id, inputs: { [textInput.id]: '调用时文字', [sizeInput.id]: 42 } }, 2, 'call_track');
  exposePerformanceInputs(graph, [
    { ...performanceInputs(graph).find(input => input.nodeId === audioId && input.pinId === 'clip_volume')!, name: '共享音量' },
    { ...performanceInputs(graph).find(input => input.nodeId === callId && input.pinId === 'arg_' + sizeInput.id)!, name: '共享字号' },
  ]);
  graph.exposedInputs[0].defaultValue = .65; graph.exposedInputs[1].defaultValue = 48;
  const before = structuredClone(project), sourceModel = performanceTimeline(project, graph);
  let ids: string[] = [];
  const after = mutateProject(project, draft => {
    ids = editTimelineProject(draft, graph.id, (candidate, target) => duplicateTimelineSelection(candidate, target, [callId, audioId, visualId]));
  });
  assert.deepEqual(project, before); assert.equal(ids.length, 3);
  const updated = projectGraphs(after).find(item => item.id === graph.id)!, model = performanceTimeline(after, updated);
  assert.equal(model.reason, undefined); assert.equal(model.clips.length, 6);
  const copiedNodes = ids.map(id => updated.nodes.find(node => node.id === id)!);
  const copiedAudioNode = copiedNodes.find(node => rawSavedBlueprintAction(node)?.kind === 'audioClip')!, copiedCall = copiedNodes.find(node => node.type === 'callFunction')!;
  const originalAudio = sourceModel.actionsByNode.get(audioId)!.find(action => action.kind === 'audioClip')!;
  const copiedAudio = model.actionsByNode.get(copiedAudioNode.id)!.find(action => action.kind === 'audioClip')!;
  const { instanceId: originalInstance, name: originalName, ...originalAudioSettings } = originalAudio;
  const { instanceId: copiedInstance, name: copiedName, ...copiedAudioSettings } = copiedAudio;
  assert.notEqual(copiedInstance, originalInstance); assert.equal(copiedName, originalName + ' 副本'); assert.deepEqual(copiedAudioSettings, originalAudioSettings);
  assert.equal(copiedAudio.volume, .65); assert.equal(copiedAudio.offset, 2); assert.equal(copiedAudio.sourceDuration, 12);
  assert.equal(copiedCall.properties.graphId, child.id); assert.equal(copiedCall.properties['arg_' + textInput.id], '调用时文字'); assert.equal(copiedCall.properties['arg_' + sizeInput.id], 42);
  for (const [sourceId, copiedId, pinId] of [[audioId, copiedAudioNode.id, 'clip_volume'], [callId, copiedCall.id, 'arg_' + sizeInput.id]]) {
    const sourceLink = graph.links.find(link => link.toNodeId === sourceId && link.toPinId === pinId)!;
    assert.ok(updated.links.some(link => link.fromNodeId === sourceLink.fromNodeId && link.fromPinId === sourceLink.fromPinId && link.toNodeId === copiedId && link.toPinId === pinId));
  }
  const originalCallText = sourceModel.actionsByNode.get(callId)!.find(action => action.kind === 'visual')!;
  const copiedCallText = model.actionsByNode.get(copiedCall.id)!.find(action => action.kind === 'visual')!;
  assert.equal(copiedCallText.text, '调用时文字'); assert.equal(copiedCallText.fontSize, 48); assert.notEqual(copiedCallText.instanceId, originalCallText.instanceId);
  assert.deepEqual(projectGraphs(after).find(item => item.id === child.id), projectGraphs(before).find(item => item.id === child.id));
  const context = previewActionContext(after), actions = expandPreviewActions(after, [{ kind: 'blueprint', blueprintId: graph.id }], context);
  assert.equal(context.incomplete, false);
  const sounds = actions.filter(action => action.kind === 'audioClip'), titles = actions.filter((action): action is VisualObject => action.kind === 'visual' && action.content === 'text');
  assert.equal(sounds.length, 2); assert.notEqual(sounds[0].instanceId, sounds[1].instanceId);
  assert.equal(titles.length, 2); assert.notEqual(titles[0].instanceId, titles[1].instanceId);
  assert.ok(titles.every(action => action.kind === 'visual' && action.text === '调用时文字' && action.fontSize === 48));
  projectSchema.parse(after);
});

test('root duplication connects a legacy execution chain with a return before arranging its first timeline', () => {
  const project = createProject(), graph = blueprintFromPerformance(project, [{ ...createVisualObject('text'), duration: 2 }], '尚未排轨的演出'); addProjectGraphs(project, graph);
  const source = graph.nodes.find(node => node.type === 'savedAction')!, end = blueprintNodeDefaults('return'); graph.nodes.push(end);
  assert.equal(connectBlueprintPins(graph, source.id, 'exec_out', end.id, 'exec_in'), undefined);
  assert.equal(graph.timeline, undefined); assert.equal(timelinePath(graph, project).reason, undefined);
  const ids = editTimelineProject(project, graph.id, (draft, target) => duplicateTimelineSelection(draft, target, [source.id]));
  const updated = projectGraphs(project).find(item => item.id === graph.id)!, model = performanceTimeline(project, updated), path = timelinePath(updated, project);
  assert.equal(ids.length, 1); assert.equal(path.reason, undefined); assert.equal(model.reason, undefined);
  assert.deepEqual(model.clips.map(clip => [clip.nodeId, clip.at, clip.duration]), [[source.id, 0, 2], [ids[0], 2, 2]]);
  assert.ok(updated.timeline?.tailNodeId); assert.equal(path.nodes.at(-1)!.id, updated.timeline!.tailNodeId);
  assert.equal(path.nodes.filter(node => node.id === ids[0]).length, 1);
  projectSchema.parse(project);
});

test('root duplication that extends a child into the next caller clip rejects the entire edit', () => {
  const { project, parent, child, clipId, secondId } = nestedTimelineEditFixture();
  editTimelineProject(project, parent.id, (draft, target) => {
    const model = performanceTimeline(draft, target);
    arrangePerformanceTimeline(draft, target, model.clips.map(clip => clip.nodeId === secondId ? { ...clip, at: 3 } : clip), model.tracks);
  });
  const before = structuredClone(project);
  assert.throws(() => editTimelineProject(project, child.id, (draft, target) => duplicateTimelineSelection(draft, target, [clipId])), /外层时间轴.*同一轨道/);
  assert.deepEqual(project, before, 'failed copies publish no nodes, tracks, links or caller signature changes');
});

test('root duplication rejects an existing disconnected execution node without changing the graph', () => {
  const { project, graph, node } = fixture(); graph.nodes.push(blueprintNodeDefaults('delay'));
  const before = structuredClone(project);
  assert.match(performanceTimeline(project, graph).reason!, /未连接的执行节点/);
  assert.throws(() => duplicateTimelineSelection(project, graph, [node.id]), /未连接的执行节点/);
  assert.deepEqual(project, before, 'validating the original execution path must precede inserting any copies');
  assert.throws(() => editTimelineProject(project, graph.id, (draft, target) => duplicateTimelineSelection(draft, target, [node.id])), /未连接的执行节点/);
  assert.deepEqual(project, before);
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
