import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type StageAction } from '../src/core/model';
import { createVisualObject, visualInputFields, visualPose } from '../src/core/visual-object';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { moveStageVisual, stageEditedProject, stageVisualObjects } from '../src/core/stage-edit';
import { linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { applyTextScript } from '../src/core/text-script';
import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { instantiateVisualComposition } from '../src/core/visual-composition';

test('stage visual edits trace current, prior and scene sources including scaled shared nested objects', () => {
  for (const shared of [false, true]) for (const location of ['current', 'prior', 'scene']) {
    const project = createProject(), passage = project.nodes.find(node => node.kind === 'passage')!;
    const child = { ...createVisualObject('solid'), startAt: .25 };
    child.keyframes.push({ ...child.keyframes[0], duration: 3, x: .9 });
    const root = { ...createVisualObject('group'), duration: 4, retimeOnDuration: true, children: [child] };
    const graph = blueprintFromPerformance(project, [root], '共享对象');
    if (shared) {
      project.blueprints.push(graph);
      exposePerformanceInputs(graph, [performanceInputs(graph).find(field => field.pinId === 'object_duration')!]);
      graph.exposedInputs[0].defaultValue = 8;
    }
    const action: StageAction = shared ? { kind: 'blueprint', blueprintId: graph.id } : root;
    passage.lines = [{ id: 'prior', text: '前文', actions: location === 'prior' ? [action, { kind: 'pause', seconds: .5 }] : [] }, { id: 'current', text: '对象', actions: location === 'current' ? [action] : [] }];
    if (location === 'scene') project.scenes[0].entryActions = [action];
    const selection = { nodeId: passage.id, lineId: 'current' };
    const edited = stageEditedProject(project, draft => moveStageVisual(draft, selection, root.instanceId, child.instanceId, { x: .2, rotation: 25 }, 1000))!;
    assert.ok(edited, `${shared}/${location}`);
    const restored = applyTextScript(projectSchema.parse(edited.project), edited.source).project;
    const snapshot = linePreviewSnapshot(restored, selection), state = sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, snapshot.actions), 1000).state;
    const visible = stageVisualObjects(state).find(item => item.object.instanceId === child.instanceId)!;
    assert.equal(visualPose(visible.object, visible.elapsed).x, .2);
    assert.equal(visualPose(visible.object, visible.elapsed).rotation, 25);
    const source = shared ? rawSavedBlueprintAction(restored.blueprints[0].nodes.find(node => node.type === 'savedAction')!) : location === 'scene' ? restored.scenes[0].entryActions![0] : restored.nodes.find(node => node.id === passage.id)!.kind === 'passage' ? (restored.nodes.find(node => node.id === passage.id) as typeof passage).lines[location === 'prior' ? 0 : 1].actions[0] : undefined;
    assert.equal(source?.kind, 'visual'); if (source?.kind !== 'visual') continue;
    const local = (1 + (location === 'prior' ? .5 : 0)) / (shared ? 2 : 1) - .25;
    assert.equal(source.children![0].curves!.x![1].at, local);
    assert.deepEqual(source.children![0].keyframes, child.keyframes);
  }
});

test('expired or replaced stage visual instances cannot be edited', () => {
  const project = createProject(), passage = project.nodes.find(node => node.kind === 'passage')!;
  const object = createVisualObject('solid'); object.duration = .5;
  passage.lines = [{ id: 'line', text: '对象', actions: [object] }];
  const before = structuredClone(project);
  assert.throws(() => moveStageVisual(project, { nodeId: passage.id, lineId: 'line' }, object.instanceId, object.instanceId, { x: .3 }, 1000), /不存在/);
  assert.deepEqual(project, before);
});

test('dragging a scoped timeline instance edits its authored nested object at the scaled clock', () => {
  for (const childStart of [0, .5]) {
    const project = createProject(), passage = project.nodes.find(node => node.kind === 'passage')!;
    const text = { ...createVisualObject('text'), name: '可拖动标题', text: '标题', startAt: .25 };
    text.keyframes.push({ ...text.keyframes[0], duration: 3, x: .9 });
    const untouched = { ...createVisualObject('solid'), name: '未选元素' };
    const inner = { ...createVisualObject('group'), duration: 4, children: [text] };
    const root = { ...createVisualObject('group'), duration: 4, retimeOnDuration: true, children: [untouched, inner] };
    const resource = blueprintFromPerformance(project, [root], '共享字幕时间轴'); resource.timelineComponent = true;
    addProjectGraphs(project, resource);
    const initial = performanceTimeline(project, resource);
    arrangePerformanceTimeline(project, resource, initial.clips.map(clip => ({ ...clip, at: childStart })), initial.tracks);
    const sourceNode = resource.nodes.find(node => node.type === 'savedAction')!;
    const authored = rawSavedBlueprintAction(sourceNode); assert.ok(authored?.kind === 'visual');
    const sizeField = visualInputFields(authored).find(field => field.path.join('.') === 'children.1.children.0.fontSize')!;
    const inputs = performanceInputs(resource).filter(field => field.nodeId === sourceNode.id);
    exposePerformanceInputs(resource, [inputs.find(field => field.pinId === 'object_duration')!, inputs.find(field => field.pinId === 'object_' + sizeField.key)!]);
    const [durationInput, sizeInput] = resource.exposedInputs;
    const parent = blueprintFromPerformance(project, [
      { kind: 'blueprint', blueprintId: resource.id, inputs: { [durationInput.id]: 8, [sizeInput.id]: 42 } },
      { kind: 'blueprint', blueprintId: resource.id, inputs: { [durationInput.id]: 8, [sizeInput.id]: 56 } },
    ], '两次字幕调用'); parent.timelineComponent = true;
    addProjectGraphs(project, parent);
    const calls = performanceTimeline(project, parent);
    arrangePerformanceTimeline(project, parent, calls.clips.map((clip, index) => ({ ...clip, at: index * .2, trackId: 'call_' + index })), calls.clips.map((_, index) => ({ id: 'call_' + index, name: '调用 ' + index })));
    passage.lines = [{ id: 'line', text: '共享标题', actions: [{ kind: 'blueprint', blueprintId: parent.id }] }];
    const selection = { nodeId: passage.id, lineId: 'line' }, milliseconds = 2000;
    const snapshot = linePreviewSnapshot(project, selection), plan = linePlaybackPlan(snapshot.before, snapshot.actions);
    const objects = stageVisualObjects(sampleLinePlayback(snapshot.before, plan, milliseconds).state).filter(item => item.object.name === text.name);
    assert.equal(objects.length, 2);
    assert.notEqual(objects[0].rootId, objects[1].rootId);
    const selected = objects.find(item => item.object.fontSize === 56)!;
    assert.ok(selected); assert.notEqual(selected.object.instanceId, text.instanceId);
    const before = structuredClone(project);
    const edited = stageEditedProject(project, draft => moveStageVisual(draft, selection, selected.rootId, selected.object.instanceId, { x: .2, rotation: 25 }, milliseconds))!;
    assert.ok(edited); assert.deepEqual(project, before);
    const changed = projectGraphs(edited.project).find(graph => graph.id === resource.id)!;
    const source = rawSavedBlueprintAction(changed.nodes.find(node => node.type === 'savedAction')!);
    assert.ok(source?.kind === 'visual');
    const changedText = source.children![1].children![0];
    assert.equal(source.instanceId, root.instanceId); assert.equal(changedText.instanceId, text.instanceId);
    assert.deepEqual(source.children![0], authored.children![0]);
    assert.deepEqual(changedText.keyframes, text.keyframes);
    assert.equal(changedText.curves!.x!.find(frame => Math.abs(frame.at - selected.elapsed / 2) < .00001)!.value, .2);
    assert.deepEqual(changed.exposedInputs, resource.exposedInputs); assert.deepEqual(changed.links, resource.links);
    assert.deepEqual(projectGraphs(edited.project).find(graph => graph.id === parent.id), parent);
    const restored = applyTextScript(projectSchema.parse(edited.project), edited.source).project;
    const reopened = linePreviewSnapshot(restored, selection), state = sampleLinePlayback(reopened.before, linePlaybackPlan(reopened.before, reopened.actions), milliseconds).state;
    const visible = stageVisualObjects(state).find(item => item.rootId === selected.rootId && item.object.instanceId === selected.object.instanceId)!;
    assert.ok(visible); assert.equal(visible.object.fontSize, 56);
    assert.equal(visualPose(visible.object, visible.elapsed).x, .2);
    assert.equal(visualPose(visible.object, visible.elapsed).rotation, 25);
  }
});

test('stage edits stop at a linked composition boundary instead of changing its materialized children', () => {
  const project = createProject(), passage = project.nodes.find(node => node.kind === 'passage')!;
  const text = { ...createVisualObject('text'), name: '资源内部文字' };
  const resource = blueprintFromPerformance(project, [{ ...createVisualObject('group'), children: [text] }], '共享组合');
  resource.timelineComponent = true; resource.visualComposition = true; addProjectGraphs(project, resource);
  const model = performanceTimeline(project, resource); arrangePerformanceTimeline(project, resource, model.clips, model.tracks);
  const instance = instantiateVisualComposition(project, resource.id, 'resource_instance');
  passage.lines = [{ id: 'line', text: '组合', actions: [instance] }];
  const selection = { nodeId: passage.id, lineId: 'line' }, snapshot = linePreviewSnapshot(project, selection);
  const state = sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, snapshot.actions), 500).state;
  const child = stageVisualObjects(state).find(item => item.object.name === text.name)!;
  const before = structuredClone(project);
  assert.throws(() => moveStageVisual(project, selection, child.rootId, child.object.instanceId, { x: .2 }, 500), /组合资源/);
  assert.deepEqual(project, before);
  const edited = stageEditedProject(project, draft => moveStageVisual(draft, selection, instance.instanceId, instance.instanceId, { x: .3 }, 500))!;
  assert.ok(edited); assert.deepEqual(projectGraphs(edited.project).find(graph => graph.id === resource.id), resource);
});
