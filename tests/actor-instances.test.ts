import { createShowCharacterFixture } from '../scripts/lib/show-character-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type StageAction } from '../src/core/model';
import { actorKey, type ShowActor } from '../src/core/actor-instance';
import { finishPreviewLine, linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { moveStageActor, setStageAction } from '../src/core/stage-edit';
import { actionText, applyTextScript, projectToText, textCommandAction } from '../src/core/text-script';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { compileProject } from '../src/runtime/compiler';
import { textAssistance } from '../src/core/text-completion';

test('nonblocking actor motion continues across dialogue with only explicit waits advancing its clock', () => {
  const { project, node, show, selection } = fixture();
  const motion: StageAction = { kind: 'animate', characterId: 'hero', instanceId: 'left', wait: false, repeat: false, keyframes: [{ x: .85, y: 1, scale: .8, rotation: 0, opacity: 1, duration: 4, easing: 'linear' }], curves: { rotation: [{ at: 0, value: 0, easing: 'linear' }, { at: 4, value: 40, easing: 'linear' }] } };
  node.lines = [
    { id: 'first', text: '开始', actions: [{ ...show, instanceId: 'left', lifetime: 'persistent' }, motion, { kind: 'pause', seconds: 1 }] },
    { id: 'second', text: '继续', actions: [] },
    { id: 'third', text: '结束', actions: [{ kind: 'pause', seconds: 3 }] },
  ];
  const second = linePreviewSnapshot(project, selection('second'));
  assert.ok(Math.abs(second.before.actors.get('instance:left')!.x - .4) < 1e-9);
  assert.equal(second.before.motions.get('instance:left')!.elapsed, 1);
  const plan = linePlaybackPlan(second.before, second.actions);
  assert.equal(plan.until, 3000);
  const later = sampleLinePlayback(second.before, plan, 2000);
  assert.ok(Math.abs(later.state.actors.get('instance:left')!.x - .7) < 1e-9);
  assert.equal(later.state.actors.get('instance:left')!.rotation, 30);
  assert.equal(second.before.motions.get('instance:left')!.elapsed, 1);
  const third = linePreviewSnapshot(project, selection('third'));
  assert.equal(third.after.motions.size, 0);
  assert.equal(third.after.actors.get('instance:left')!.x, .85);
  const hide: StageAction = { kind: 'hide', characterId: 'hero', instanceId: 'left', transition: 'none' };
  assert.equal(linePlaybackPlan(second.before, [hide]).until, 0);
  assert.equal(sampleLinePlayback(second.before, linePlaybackPlan(second.before, [hide]), 5000).state.actors.size, 0);
  const replacement = { ...motion, keyframes: [{ ...motion.keyframes[0], x: 0, duration: 2 }], curves: undefined };
  const replaced = sampleLinePlayback(second.before, linePlaybackPlan(second.before, [replacement]), 500);
  assert.ok(Math.abs(replaced.state.actors.get('instance:left')!.x - .3) < 1e-9);
});

function fixture() {
  const project = createProject();
  project.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'portrait.png', width: 500, height: 1000 }, { id: 'background', name: '背景', kind: 'image', path: 'background.png' }];
  project.characters = ['hero', 'friend'].map(id => ({ id, name: id === 'hero' ? '主角' : '朋友', color: '#ffffff', expressions: [{ id: id === 'hero' ? 'normal' : 'friend_normal', name: '普通', assetId: 'portrait' }, { id: id === 'hero' ? 'smile' : 'friend_smile', name: '微笑', assetId: 'portrait' }] }));
  const node = project.nodes.find(node => node.kind === 'passage')!;
  const show: ShowActor = { kind: 'show', characterId: 'hero', expressionId: 'normal', x: .25, y: 1, scale: .8, layer: 10, transition: 'none' };
  node.lines = [
    { id: 'first', text: '两个持续实例和一个本句实例。', actions: [{ ...show, instanceId: 'left', lifetime: 'persistent' }, { ...show, instanceId: 'right', x: .75, lifetime: 'persistent' }, { ...show, instanceId: 'guest', lifetime: 'line' }] },
    { id: 'second', text: '下一句与换背景保留两个实例。', actions: [{ kind: 'background', assetId: 'background', transition: 'none' }] },
    { id: 'third', text: '只隐藏左侧实例。', actions: [{ kind: 'hide', characterId: 'hero', instanceId: 'left', transition: 'none' }] },
  ];
  const selection = (lineId: string) => ({ nodeId: node.id, lineId });
  return { project, node, show, selection };
}

test('one-line actors expire, while two instances of one character survive dialogue and background changes independently', () => {
  const { project, selection } = fixture();
  assert.equal(linePreviewSnapshot(project, selection('first')).after.actors.size, 3);
  const second = linePreviewSnapshot(project, selection('second')).after;
  assert.deepEqual([...second.actors.keys()], ['instance:left', 'instance:right']);
  assert.equal(second.backgroundId, 'background');
  assert.deepEqual([...linePreviewSnapshot(project, selection('third')).after.actors.keys()], ['instance:right']);
});

test('same instance ID replaces its previous pose and stage dragging does not affect sibling instances or their presets', () => {
  const { project, node, show, selection } = fixture();
  node.lines[0].actions[0] = { ...show, presetId: 'left', instanceId: 'left', lifetime: 'persistent' };
  moveStageActor(project, selection('second'), 'instance:right', { x: .6, expressionId: 'smile' });
  const actors = linePreviewSnapshot(project, selection('second')).after.actors;
  assert.equal(actors.size, 2);
  assert.equal(actors.get('instance:left')?.presetId, 'left');
  assert.equal(actors.get('instance:right')?.x, .6);
  assert.equal(actors.get('instance:right')?.expressionId, 'smile');
  assert.equal(actors.get('instance:right')?.lifetime, 'persistent');
  setStageAction(project, selection('second'), { ...show, instanceId: 'right', x: .9, lifetime: 'persistent' });
  assert.equal(linePreviewSnapshot(project, selection('second')).after.actors.size, 2);
});

test('named animations and their sampled motion update only the selected instance', () => {
  const { project, node, selection } = fixture();
  const motion: StageAction = { kind: 'animate', characterId: 'hero', instanceId: 'right', wait: false, repeat: false, keyframes: [{ x: .55, y: 1, scale: .8, rotation: 10, opacity: .5, duration: 1, easing: 'linear' }] };
  node.lines[1].actions.push(motion);
  const snapshot = linePreviewSnapshot(project, selection('second'));
  const sample = sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, snapshot.actions), 500).state;
  assert.equal(sample.actors.get('instance:left')!.x, .25);
  assert.equal(sample.actors.get('instance:right')!.x, .65);
  assert.equal(sample.actors.get('instance:right')!.opacity, .75);
});

test('lifetime and instance references survive text, blueprint conversion and save/reopen; invalid IDs are reported', () => {
  const { project, node, show } = fixture();
  for (const source of [...node.lines[0].actions, ...node.lines[2].actions]) {
    const action = source.kind === 'show' ? { ...source, transition: 'dissolve' as const, actorTransitions: { enter: { mode: 'none' as const, duration: 0 } } } : source;
    assert.deepEqual(textCommandAction(project, actionText(project, action), true), action);
  }
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const parsed = applyTextScript(restored, projectToText(restored));
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  assert.equal(parsed.project.nodes.flatMap(n => n.kind === 'passage' ? n.lines.flatMap(l => l.actions) : []).filter(a => a.kind === 'show' && a.instanceId).length, 3);
  const graph = blueprintFromPerformance(project, node.lines[0].actions); project.blueprints.push(graph);
  node.lines[0].actions = [{ kind: 'blueprint', blueprintId: graph.id }];
  assert.equal(linePreviewSnapshot(project, { nodeId: node.id, lineId: 'second' }).after.actors.size, 2);
  assert.throws(() => textCommandAction(project, '@显示角色：主角，普通，显示范围=永久错误，实例ID=left', true), /显示范围/);
  assert.throws(() => textCommandAction(project, '@显示角色：主角，普通，实例ID=bad-id', true), /实例 ID/);
  const input = '@隐藏角色：主角，实例ID=ri';
  assert.ok(textAssistance(project, input, input.length)?.items.some(item => item.insertText === 'right'));
  const compiled = compileProject(project); assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.ok(compiled.files['game/story.rpy'].includes('vn_finish_line_actors()'));
  assert.notEqual(actorKey({ characterId: 'right' }), actorKey({ characterId: show.characterId, instanceId: 'right' }));
});

test('automatic speaker hiding respects persistent actors and legacy nodes keep their original scene lifetime', () => {
  const { project, node, show, selection } = fixture();
  const graph = createShowCharacterFixture(); project.blueprints.push(graph);
  node.lines[1].speakerId = 'friend';
  node.lines[1].actions.push({ kind: 'blueprint', blueprintId: graph.id, inputs: { hide_others: true } });
  const state = linePreviewSnapshot(project, selection('second')).after;
  assert.equal(state.actors.size, 3);
  finishPreviewLine(state);
  assert.deepEqual([...state.pendingActorExits!], ['friend']);
  const departure = linePlaybackPlan(state, []);
  assert.equal(departure.dialogueAt, 500);
  assert.deepEqual([...sampleLinePlayback(state, departure, 500).state.actors.keys()], ['instance:left', 'instance:right']);
  const old = blueprintFromPerformance(project, [show]); old.nodes[1].pins = old.nodes[1].pins.filter(pin => !['instanceId', 'lifetime'].includes(pin.id)); delete old.nodes[1].properties.lifetime;
  project.blueprints.push(old); synchronizeBlueprintSignatures(project);
  assert.equal(old.nodes[1].pins.find(pin => pin.id === 'lifetime')?.defaultValue, '');
  node.lines[0].actions = [{ ...show }]; node.lines[1].actions = [{ kind: 'background', assetId: 'background', transition: 'none' }];
  assert.equal(linePreviewSnapshot(project, selection('second')).after.actors.size, 0);
});

test('a one-line actor in a silent cue survives until the following actual dialogue completes', () => {
  const { project, node, show, selection } = fixture();
  node.lines = [{ id: 'cue', text: '', silent: true, actions: [{ ...show, lifetime: 'line' }] }, { id: 'say', text: '本句显示', actions: [] }, { id: 'after', text: '已经隐藏', actions: [] }];
  assert.equal(linePreviewSnapshot(project, selection('say')).after.actors.size, 1);
  assert.equal(linePreviewSnapshot(project, selection('after')).after.actors.size, 0);
});

test('updating an instance and automatic dialogue do not silently cancel a persistent lifetime', () => {
  const { project, node, show, selection } = fixture();
  const graph = createShowCharacterFixture(); project.blueprints.push(graph);
  node.lines[0].actions = [{ ...show, lifetime: 'persistent' }];
  node.lines[1].speakerId = 'hero';
  node.lines[1].actions = [{ ...show, expressionId: 'smile' }, { kind: 'blueprint', blueprintId: graph.id }];
  node.lines[2].actions = [{ kind: 'background', assetId: 'background', transition: 'none' }];
  assert.equal(linePreviewSnapshot(project, selection('third')).after.actors.get('hero')?.lifetime, 'persistent');
});
