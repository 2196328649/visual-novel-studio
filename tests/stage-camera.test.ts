import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type StageAction } from '../src/core/model';
import { blueprintFromPerformance, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { moveStageCamera, stageEditedProject } from '../src/core/stage-edit';
import { projectToText, applyTextScript } from '../src/core/text-script';
import { linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { blueprintNodeDefaults } from '../src/core/blueprint';

const camera = (): Extract<StageAction, { kind: 'camera' }> => ({ kind: 'camera', x: .9, y: -.3, zoom: 1.5, rotation: 30, duration: 3, wait: false, easing: 'linear' });
test('camera playhead edits persist to direct, saved and native blueprint sources across lines and inherited scene entries', () => {
  for (const mode of ['direct', 'saved', 'node']) for (const location of ['current', 'prior', 'scene']) {
    const project = createProject(), node = project.nodes.find(node => node.kind === 'passage')!;
    const action = camera(); if (mode === 'saved') action.curves = { x: [{ at: 0, value: 0, easing: 'linear' }, { at: 3, value: .9, easing: 'linear' }] };
    const graph = blueprintFromPerformance(project, [action], '镜头来源');
    if (mode !== 'direct') project.blueprints.push(graph);
    const call: StageAction = mode === 'direct' ? action : { kind: 'blueprint', blueprintId: graph.id };
    node.lines = [{ id: 'prior', text: '前文', actions: location === 'prior' ? [call, { kind: 'pause', seconds: .5 }] : [] }, { id: 'current', text: '当前', actions: location === 'current' ? [call] : [] }];
    if (location === 'scene') {
      project.scenes[0].entryActions = [call];
      project.scenes.push({ id: 'child', name: '继承入口', chapterId: project.scenes[0].chapterId, baseSceneId: project.scenes[0].id });
      node.sceneId = 'child';
    }
    const selection = { nodeId: node.id, lineId: 'current' };
    project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
    const edited = stageEditedProject(project, draft => moveStageCamera(draft, selection, { x: .4, zoom: 1.7, rotation: -20 }, 1000))!;
    assert.ok(edited, `${mode}/${location}`);
    const restored = applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(edited.project))), edited.source).project;
    const snapshot = linePreviewSnapshot(restored, selection);
    const pose = sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, snapshot.actions), 1000).state.camera;
    assert.equal(pose.x, .4); assert.equal(pose.zoom, 1.7); assert.equal(pose.rotation, -20);
    assert.ok(Math.abs(pose.y - (location === 'prior' ? -.15 : -.1)) < 1e-9);
    if (mode !== 'direct') {
      const savedNode = restored.blueprints.find(item => item.id === graph.id)!.nodes.find(item => item.type === 'savedAction')!;
      assert.ok(savedNode);
      const saved = rawSavedBlueprintAction(savedNode)!;
      assert.equal(saved.kind, 'camera'); if (saved.kind !== 'camera') return;
      assert.deepEqual(saved.curves?.x?.map(frame => frame.at), [0, location === 'prior' ? 1.5 : 1, 3]);
    }
    if (location === 'scene') assert.equal(restored.scenes.find(scene => scene.id === 'child')!.entryActions, undefined);
  }
});

test('static camera editing creates a current-line curve without changing preceding or future camera actions', () => {
  const project = createProject(), node = project.nodes.find(node => node.kind === 'passage')!;
  node.lines = [{ id: 'prior', text: '', actions: [{ ...camera(), duration: 0 }] }, { id: 'current', text: '镜头', actions: [{ kind: 'pause', seconds: 2 }, camera()] }];
  const prior = structuredClone(node.lines[0]), future = structuredClone(node.lines[1].actions[1]);
  const selection = { nodeId: node.id, lineId: 'current' };
  moveStageCamera(project, selection, { x: .2 }, 500);
  assert.deepEqual(node.lines[0], prior); assert.deepEqual(node.lines[1].actions[2], future);
  const snapshot = linePreviewSnapshot(project, selection), plan = linePlaybackPlan(snapshot.before, snapshot.actions);
  assert.equal(plan.steps.at(-1)!.at, 2000);
  assert.equal(sampleLinePlayback(snapshot.before, plan, 500).state.camera.x, .2);
  assert.equal(node.lines[1].actions[0].kind, 'camera');
});

test('blocking scene entry camera can be edited before dialogue starts', () => {
  for (const blueprint of [false, true]) {
    const project = createProject(), node = project.nodes.find(node => node.kind === 'passage')!;
    const action = { ...camera(), wait: true };
    const graph = blueprintFromPerformance(project, [action], '入口镜头');
    if (blueprint) project.blueprints.push(graph);
    project.scenes[0].entryActions = [blueprint ? { kind: 'blueprint', blueprintId: graph.id } : action];
    node.lines = [{ id: 'current', text: '入口之后', actions: [] }];
    const selection = { nodeId: node.id, lineId: 'current' };
    const edited = stageEditedProject(project, draft => moveStageCamera(draft, selection, { rotation: 42 }, 500))!;
    assert.ok(edited);
    const restored = applyTextScript(projectSchema.parse(edited.project), edited.source).project;
    const snapshot = linePreviewSnapshot(restored, selection), plan = linePlaybackPlan(snapshot.before, snapshot.actions);
    assert.equal(plan.dialogueAt, 3000);
    assert.equal(sampleLinePlayback(snapshot.before, plan, 500).state.camera.rotation, 42);
    assert.equal(sampleLinePlayback(snapshot.before, plan, 3000).state.camera.rotation, 30);
    assert.deepEqual(restored.nodes.find(item => item.id === node.id), node);
  }
});

test('data-linked camera edits reject without changing the graph or dialogue', () => {
  const project = createProject(), node = project.nodes.find(node => node.kind === 'passage')!;
  const graph = blueprintFromPerformance(project, [camera()], '连线镜头');
  const target = graph.nodes.find(item => item.type === 'camera')!;
  const random = blueprintNodeDefaults('random');
  graph.nodes.push(random);
  graph.links.push({ id: 'camera_data', fromNodeId: random.id, fromPinId: 'value', toNodeId: target.id, toPinId: 'x' });
  project.blueprints.push(graph);
  node.lines = [{ id: 'current', text: '连线', actions: [{ kind: 'blueprint', blueprintId: graph.id }] }];
  const before = structuredClone(project);
  assert.throws(() => moveStageCamera(project, { nodeId: node.id, lineId: 'current' }, { x: .4 }, 500), /数据连线/);
  assert.deepEqual(project, before);
});
