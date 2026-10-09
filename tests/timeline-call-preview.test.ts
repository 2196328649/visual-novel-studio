import assert from 'node:assert/strict';
import test from 'node:test';
import { blueprintNodeDefaults, connectBlueprintPins } from '../src/core/blueprint';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { chapterBlueprintPair, createChapterPerformance } from '../src/core/chapter-performances';
import { createProject, type StageAction, type VisualObject } from '../src/core/model';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { performanceTiming } from '../src/core/performance-timing';
import { timelineCallPreviewProject } from '../src/core/timeline-call-preview';

const visualObjects = (action: StageAction): VisualObject[] => action.kind === 'visual' ? [action, ...(action.children ?? []).flatMap(visualObjects)] : [];

test('child preview forwards edited chapter defaults to both visible text and glyph emitters', () => {
  const project = createProject();
  const [owner, child] = chapterBlueprintPair(createChapterPerformance(project, 'text'));
  owner.exposedInputs.find(pin => pin.id === 'title')!.defaultValue = '第三章 · 故城重逢';
  owner.exposedInputs.find(pin => pin.id === 'right_text')!.defaultValue = '无需制作新题图';
  project.blueprints.push(owner, child);
  const before = structuredClone(project), call = owner.nodes.find(node => node.type === 'callFunction')!;
  const view = timelineCallPreviewProject(project, child.id, [{ graphId: owner.id, callNodeId: call.id }]);
  const objects = expandPreviewActions(view, [{ kind: 'blueprint', blueprintId: child.id }], previewActionContext(view)).flatMap(visualObjects);
  for (const text of ['第三章 · 故城重逢', '无需制作新题图']) {
    assert.ok(objects.some(object => object.content === 'text' && object.text === text));
    assert.ok(objects.some(object => object.content === 'particles' && object.text === text && object.glyphParticles?.source === 'text'));
  }
  const override = timelineCallPreviewProject(project, child.id, [{ graphId: owner.id, callNodeId: call.id }], { title: '本次调用覆盖', subtitle: '', duration: 9 });
  const actions = expandPreviewActions(override, [{ kind: 'blueprint', blueprintId: child.id }], previewActionContext(override));
  assert.equal(performanceTiming(actions).until, 9);
  assert.ok(actions.flatMap(visualObjects).some(object => object.text === '本次调用覆盖'));
  assert.deepEqual(project, before);
  assert.equal(timelineCallPreviewProject(project, child.id, []), project);
});

test('nested preview samples the selected call and calculated inputs before its later continuation', () => {
  const project = createProject();
  project.variables.push({ id: 'delay', name: '时长增量', type: 'number', initial: 2, persistent: false });
  const [owner, child] = chapterBlueprintPair(createChapterPerformance(project, 'text')); project.blueprints.push(owner, child);
  const outer = blueprintFromPerformance(project, [
    { kind: 'blueprint', blueprintId: owner.id, inputs: { title: '第一次调用' } },
    { kind: 'blueprint', blueprintId: owner.id, inputs: { title: '所选第二次调用' } },
  ]);
  const calls = outer.nodes.filter(node => node.type === 'callFunction'), selected = calls[1];
  const read = blueprintNodeDefaults('getVariable'); read.properties.variableId = 'delay'; read.pins[0].dataType = 'number';
  const sum = blueprintNodeDefaults('math'); sum.properties.b = 7;
  const later = blueprintNodeDefaults('setVariable'); later.properties.variableId = 'delay'; later.properties.value = 100; later.pins.find(pin => pin.id === 'value')!.dataType = 'number';
  outer.nodes.push(read, sum, later);
  assert.equal(connectBlueprintPins(outer, read.id, 'value', sum.id, 'a'), undefined);
  assert.equal(connectBlueprintPins(outer, sum.id, 'result', selected.id, 'arg_duration'), undefined);
  assert.equal(connectBlueprintPins(outer, selected.id, 'exec_out', later.id, 'exec_in'), undefined);
  project.blueprints.push(outer);
  const before = structuredClone(project), innerCall = owner.nodes.find(node => node.type === 'callFunction')!;
  const view = timelineCallPreviewProject(project, child.id, [{ graphId: outer.id, callNodeId: selected.id }, { graphId: owner.id, callNodeId: innerCall.id }]);
  const actions = expandPreviewActions(view, [{ kind: 'blueprint', blueprintId: child.id }], previewActionContext(view));
  assert.ok(actions.flatMap(visualObjects).some(object => object.text === '所选第二次调用'));
  assert.equal(performanceTiming(actions).until, 9);
  assert.equal(view.variables.find(variable => variable.id === 'delay')!.initial, 2);
  assert.deepEqual(project, before);
});
