import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type StageAction } from '../src/core/model';
import { createVisualObject, visualPose } from '../src/core/visual-object';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { moveStageVisual, stageEditedProject, stageVisualObjects } from '../src/core/stage-edit';
import { linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { applyTextScript } from '../src/core/text-script';

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
