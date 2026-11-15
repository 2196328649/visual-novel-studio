import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type ActorTransitions, type StageAction } from '../src/core/model';
import { actorTransitionDefaults, resolveActorTransitions } from '../src/core/actor-transitions';
import { actorKey, type ShowActor } from '../src/core/actor-instance';
import { defaultShowCharacter } from '../src/core/character-presets';
import { finishPreviewLine, initialPreviewStage, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { applyTextScript, projectToText, textCommandAction } from '../src/core/text-script';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { compileProject, type CompileResult } from '../src/runtime/compiler';

const rules: Required<ActorTransitions> = { enter: { mode: 'dissolve', duration: .4 }, exit: { mode: 'dissolve', duration: .7 }, expression: { mode: 'dissolve', duration: .2 } };
const show = (id = 'actor', expressionId = 'normal'): Extract<StageAction, { kind: 'show' }> => ({ kind: 'show', characterId: id, expressionId, x: .5, y: 1, scale: 1, layer: 10, lifetime: 'line', transition: 'dissolve', actorTransitions: rules });
test('phase defaults dissolve on departure and allow character and call overrides', () => {
  const p = createProject(); p.characters = [{ id: 'actor', name: 'Actor', color: '#ffffff', expressions: [] }];
  assert.equal(resolveActorTransitions(p, 'actor', { transition: 'fade', lifetime: 'persistent' }), undefined);
  assert.deepEqual(resolveActorTransitions(p, 'actor', { transition: 'fade', lifetime: 'line' }), { enter: { mode: 'fade', duration: 1 }, expression: { mode: 'fade', duration: 1 }, exit: { mode: 'dissolve', duration: .5 } });
  assert.deepEqual(resolveActorTransitions(p, 'actor', { actorTransitions: { exit: { mode: 'none', duration: 0 } } })!.exit, { mode: 'none', duration: 0 });
  p.characters[0].actorTransitions = { enter: rules.enter };
  assert.deepEqual(resolveActorTransitions(p, 'actor', { transition: 'fade' }, { exit: rules.exit }), { ...actorTransitionDefaults('fade'), enter: rules.enter, exit: rules.exit });
  assert.throws(() => projectSchema.parse({ ...p, characters: [{ ...p.characters[0], actorTransitions: { exit: { mode: 'bad', duration: -1 } } }] }));
});
test('bare show uses default departure when switching speakers and moving to narration', () => {
  const p = createProject(); p.assets = [{ id: 'portrait', name: 'Portrait', kind: 'image', path: 'portrait.png' }];
  p.characters = ['a', 'b'].map(id => ({ id, name: id, color: '#ffffff', expressions: [{ id: 'normal', name: 'Normal', assetId: 'portrait' }] }));
  const action = textCommandAction(p, '@显示角色')!, context = previewActionContext(p);
  context.speakerId = 'a';
  const empty = initialPreviewStage(), entry = linePlaybackPlan(empty, expandPreviewActions(p, [action], context));
  const before = sampleLinePlayback(empty, entry, 500).state; finishPreviewLine(before);
  context.speakerId = 'b';
  const switchPlan = linePlaybackPlan(before, expandPreviewActions(p, [action], context));
  assert.equal(switchPlan.dialogueAt, 500);
  const middle = sampleLinePlayback(before, switchPlan, 250).state;
  assert.equal(middle.actorGhosts![0].opacity, .5); assert.equal(middle.actors.get('b')!.opacity, .5);
  const after = sampleLinePlayback(before, switchPlan, 500).state; finishPreviewLine(after);
  context.speakerId = undefined;
  const departure = linePlaybackPlan(after, expandPreviewActions(p, [action], context));
  assert.equal(departure.dialogueAt, 500);
  assert.equal(sampleLinePlayback(after, departure, 250).state.actorGhosts![0].opacity, .5);
  assert.equal(sampleLinePlayback(after, departure, 500).state.actors.size, 0);
});
test('entry, expression changes, no-op, switching and departure use independent timing', () => {
  const empty = initialPreviewStage();
  const entry = linePlaybackPlan(empty, [show()]); assert.equal(entry.dialogueAt, 400);
  const middle = sampleLinePlayback(empty, entry, 200); assert.equal(middle.transition, undefined); assert.equal(middle.state.actors.get('actor')!.opacity, .5);
  const before = sampleLinePlayback(empty, entry, 400).state; finishPreviewLine(before);
  assert.equal(linePlaybackPlan(before, [show()]).dialogueAt, 0);
  const expression = linePlaybackPlan(before, [show('actor', 'happy')]); assert.equal(expression.dialogueAt, 200);
  const expressionFrame = sampleLinePlayback(before, expression, 100).state;
  assert.equal(expressionFrame.actors.get('actor')!.opacity, .5); assert.equal(expressionFrame.actorGhosts![0].opacity, .5);
  const switchPlan = linePlaybackPlan(before, [show('other')]); assert.equal(switchPlan.dialogueAt, 700);
  const switched = sampleLinePlayback(before, switchPlan, 200).state;
  assert.equal(switched.actors.get('other')!.opacity, .5); assert.ok(Math.abs(switched.actorGhosts![0].opacity - 5 / 7) < .0001);
  const none = linePlaybackPlan(before, []); assert.equal(none.dialogueAt, 700); assert.equal(sampleLinePlayback(before, none, 700).state.actors.size, 0);
});
test('nonblocking transitions carry across lines and persistent actors survive narration', () => {
  const empty = initialPreviewStage(), action = { ...show(), wait: false, lifetime: 'persistent' as const };
  const entry = linePlaybackPlan(empty, [action]); assert.equal(entry.dialogueAt, 0);
  const before = sampleLinePlayback(empty, entry, 100).state; finishPreviewLine(before);
  const next = linePlaybackPlan(before, []); assert.equal(next.dialogueAt, 0);
  assert.ok(Math.abs(next.until - 300) < .0001);
  const continued = sampleLinePlayback(before, next, 100).state; assert.equal(continued.actors.get('actor')!.opacity, .5);
});
test('character inheritance merges phases and local offsets survive phase blending', () => {
  const p = createProject();
  p.characters = [{ id: 'base', name: 'Base', color: '#ffffff', expressions: [], actorTransitions: rules }, { id: 'child', name: 'Child', color: '#ffffff', expressions: [], baseCharacterId: 'base', actorTransitions: { exit: { mode: 'move', duration: 1 } } }];
  assert.deepEqual(resolveActorTransitions(p, 'child', {}), { ...rules, exit: { mode: 'move', duration: 1 } });
  const empty = initialPreviewStage(), action = { ...show(), afterOffsets: { x: [{ at: 0, value: 0, easing: 'linear' as const }, { at: 1, value: .2, easing: 'linear' as const }] } };
  const plan = linePlaybackPlan(empty, [action]);
  assert.equal(plan.dialogueAt, 400); assert.equal(plan.until, 1400);
  const before = sampleLinePlayback(empty, plan, 900).state;
  assert.ok(Math.abs(before.actors.get('actor')!.x - .6) < .0001);
  const next = sampleLinePlayback(before, linePlaybackPlan(before, []), 250).state;
  assert.ok(Math.abs(next.actors.get('actor')!.x - .65) < .0001);
});
test('background reset removes pending departures without an extra exit wait', () => {
  const empty = initialPreviewStage(), entry = linePlaybackPlan(empty, [show()]);
  const before = sampleLinePlayback(empty, entry, entry.dialogueAt).state; finishPreviewLine(before);
  const plan = linePlaybackPlan(before, [{ kind: 'background', assetId: 'bg', transition: 'none' }]);
  assert.equal(plan.dialogueAt, 0);
  const after = sampleLinePlayback(before, plan, 0).state;
  assert.equal(after.actors.size, 0); assert.equal(after.actorGhosts?.length, 0); assert.equal(after.pendingActorExits?.size, 0);
});
test('phase settings survive project and text save/reopen without dropping overrides', () => {
  const project = createProject(); project.characters = [{ id: 'actor', name: 'Actor', color: '#ffffff', expressions: [{ id: 'normal', name: 'Normal', assetId: 'portrait' }] }];
  project.assets = [{ id: 'portrait', name: 'Portrait', kind: 'image', path: 'portrait.png' }];
  const node = project.nodes.find(n => n.kind === 'passage')!; node.lines = [{ id: 'line', text: 'Saved', actions: [show()] }];
  const saved = projectSchema.parse(project), restored = applyTextScript(saved, projectToText(saved));
  assert.deepEqual(restored.issues, []);
  const found = restored.project.nodes.find(n => n.kind === 'passage' && n.lines.some(l => l.id === 'line'))!;
  assert.ok(found.kind === 'passage'); assert.deepEqual(found.lines.find(l => l.id === 'line')!.actions[0], saved.nodes.find(n => n.kind === 'passage')!.lines[0].actions[0]);
  const graph = blueprintFromPerformance(saved, [show()], '角色演出'); saved.blueprints.push(graph);
  const outer = blueprintFromPerformance(saved, [{ kind: 'blueprint', blueprintId: graph.id, actorTransitions: { exit: { mode: 'move', duration: .8 } } }], '嵌套演出'); saved.blueprints.push(outer);
  const packed = projectSchema.parse(saved);
  const expanded = expandPreviewActions(packed, [{ kind: 'blueprint', blueprintId: outer.id, actorTransitions: { enter: { mode: 'fade', duration: 1 } } }], previewActionContext(packed));
  assert.equal(expanded[0].kind, 'show');
  if (expanded[0].kind === 'show') assert.deepEqual(expanded[0].actorTransitions, { enter: { mode: 'fade', duration: 1 }, exit: { mode: 'move', duration: .8 }, expression: rules.expression });
  assert.equal(compileProject(packed).diagnostics.filter(d => d.severity === 'error').length, 0);
});

function actorBatchFixture() {
  const project = createProject('连续台词角色');
  project.assets = ['normal', 'happy'].map(id => ({ id, name: id, kind: 'image' as const, path: id + '.png', width: 180, height: 300 }));
  project.characters = ['a', 'b', 'c'].map((id, index) => ({
    id, name: id.toUpperCase(), color: '#ffffff', defaultExpressionId: id + '_normal', defaultDisplayPresetId: 'stage',
    expressions: ['normal', 'happy'].map(pose => ({ id: id + '_' + pose, name: pose, assetId: pose })),
    displayPresets: [{ id: 'stage', name: '站位', x: index ? .75 : .25, y: 1, scale: 1, useDefaultFraming: false }],
  }));
  const node = project.nodes.find(item => item.kind === 'passage')!;
  const a: ShowActor = { ...show('a', 'a_normal'), x: .25 };
  const b: ShowActor = { ...show('b', 'b_normal'), x: .75 };
  const c: ShowActor = { ...show('c', 'c_normal'), x: .75 };
  return { project, node, a, b, c };
}

function completedActorLine(actions: StageAction[]) {
  const empty = initialPreviewStage(), entry = linePlaybackPlan(empty, actions);
  const state = sampleLinePlayback(empty, entry, entry.dialogueAt).state;
  finishPreviewLine(state);
  return state;
}

function sourceStatements(result: CompileResult, nodeId: string, lineId?: string) {
  return result.files['game/story.rpy'].split('\n').flatMap((text, index) => {
    const origin = result.sourceMap['game/story.rpy:' + (index + 1)];
    return origin?.nodeId === nodeId && origin.lineId === lineId ? [{ text, index }] : [];
  });
}

test('two line actors retain their poses when the next line repeats them in either order', () => {
  const { a, b } = actorBatchFixture(), before = completedActorLine([a, b]);
  for (const actions of [[a, b], [b, a]]) {
    const plan = linePlaybackPlan(before, actions);
    assert.equal(plan.dialogueAt, 0, 'repeating both actors must not replay an entrance or departure');
    const frame = sampleLinePlayback(before, plan, 0).state;
    assert.deepEqual(new Set(frame.actors.keys()), new Set([actorKey(a), actorKey(b)]));
    for (const actor of [a, b]) {
      assert.equal(frame.actors.get(actorKey(actor))?.expressionId, actor.expressionId);
      assert.equal(frame.actors.get(actorKey(actor))?.x, actor.x);
      assert.equal(frame.actors.get(actorKey(actor))?.opacity, 1);
    }
    assert.equal(frame.actorBlends?.size ?? 0, 0);
    assert.deepEqual(frame.actorGhosts, []);
    assert.equal(frame.pendingActorExits?.size, 0);
  }
});

test('changing one or both line actors blends expressions without fading their companion away', () => {
  const { a, b } = actorBatchFixture(), before = completedActorLine([a, b]);
  const happyA = { ...a, expressionId: 'a_happy' }, happyB = { ...b, expressionId: 'b_happy' };
  for (const actions of [[happyA, b], [happyB, a], [happyA, happyB]]) {
    const plan = linePlaybackPlan(before, actions);
    assert.equal(plan.dialogueAt, 200, 'expression changes share their wait and do not use enter/exit timing');
    for (const time of [0, 100, 200]) {
      const frame = sampleLinePlayback(before, plan, time).state;
      assert.deepEqual(new Set(frame.actors.keys()), new Set([actorKey(a), actorKey(b)]));
      for (const action of actions) {
        const current = frame.actors.get(actorKey(action))!;
        const outgoing = frame.actorGhosts!.filter(actor => actor.characterId === action.characterId);
        assert.equal(current.expressionId, action.expressionId);
        assert.equal(current.x, action.x);
        assert.equal(current.opacity + outgoing.reduce((total, actor) => total + actor.opacity, 0), 1, 'sampled expression weights remain complementary');
        if (action.expressionId.endsWith('_normal')) assert.equal(current.opacity, 1, 'the unchanged companion stays opaque');
        else if (time === 100) {
          assert.equal(current.opacity, .5);
          assert.equal(outgoing.length, 1);
          assert.equal(outgoing[0].expressionId, action.characterId + '_normal');
          assert.equal(outgoing[0].opacity, .5);
          assert.equal(current.blendGroup, actorKey(action), 'expression layers share one blend group instead of independently fading over the background');
          assert.equal(outgoing[0].blendGroup, current.blendGroup);
        }
      }
    }
  }
});

test('two named instances of one character keep independent expression continuity', () => {
  const { a } = actorBatchFixture();
  const left = { ...a, instanceId: 'left' }, right = { ...a, instanceId: 'right', x: .75 };
  const before = completedActorLine([left, right]);
  const next = { ...left, expressionId: 'a_happy' };
  const plan = linePlaybackPlan(before, [right, next]);
  assert.equal(plan.dialogueAt, 200);
  const middle = sampleLinePlayback(before, plan, 100).state;
  assert.equal(middle.actors.size, 2);
  assert.equal(middle.actors.get(actorKey(right))?.opacity, 1);
  assert.equal(middle.actors.get(actorKey(right))?.expressionId, 'a_normal');
  assert.equal(middle.actors.get(actorKey(left))?.opacity, .5);
  assert.equal(middle.actors.get(actorKey(left))?.expressionId, 'a_happy');
  assert.equal(middle.actors.get(actorKey(left))?.blendGroup, actorKey(left));
  assert.deepEqual(middle.actorGhosts?.map(actor => [actor.x, actor.expressionId, actor.opacity]), [[.25, 'a_normal', .5]]);
  assert.equal(middle.actorGhosts?.[0].blendGroup, actorKey(left));
  const end = sampleLinePlayback(before, plan, 200).state;
  assert.equal(end.actors.get(actorKey(left))?.opacity, 1);
  assert.equal(end.actors.get(actorKey(right))?.opacity, 1);
  assert.deepEqual(end.actorGhosts, []);
});

test('numbered actor copies continue independently of the default copy and another character with that number', () => {
  const { a, b } = actorBatchFixture();
  const secondA = { ...a, instanceId: '2', x: .5 }, secondB = { ...b, instanceId: '2' };
  const before = completedActorLine([a, secondA, secondB]);
  const plan = linePlaybackPlan(before, [secondB, { ...secondA, expressionId: 'a_happy' }, a]);
  assert.equal(plan.dialogueAt, 200);
  const middle = sampleLinePlayback(before, plan, 100).state;
  assert.equal(middle.actors.size, 3, 'instance numbers belong to each character and do not replace another character');
  assert.equal(middle.actors.get(actorKey(a))?.expressionId, 'a_normal');
  assert.equal(middle.actors.get(actorKey(a))?.opacity, 1);
  assert.equal(middle.actors.get(actorKey(secondB))?.expressionId, 'b_normal');
  assert.equal(middle.actors.get(actorKey(secondB))?.opacity, 1);
  assert.equal(middle.actors.get(actorKey(secondA))?.expressionId, 'a_happy');
  assert.equal(middle.actors.get(actorKey(secondA))?.opacity, .5);
  assert.equal(middle.actors.get(actorKey(secondA))?.blendGroup, actorKey(secondA));
  assert.deepEqual(middle.actorGhosts?.map(actor => [actor.characterId, actor.x, actor.opacity]), [['a', .5, .5]]);
  assert.equal(middle.actorGhosts?.[0].blendGroup, actorKey(secondA));
  const end = sampleLinePlayback(before, plan, 200).state;
  assert.equal(end.actors.size, 3);
  assert.equal(end.actors.get(actorKey(secondA))?.opacity, 1);
  assert.deepEqual(end.actorGhosts, []);
});

test('replacing only the second line actor retires that actor while the first remains visible', () => {
  const { a, b, c } = actorBatchFixture(), before = completedActorLine([a, b]);
  const plan = linePlaybackPlan(before, [a, c]);
  assert.equal(plan.dialogueAt, 700, 'the new entrance and absent actor departure overlap');
  const middle = sampleLinePlayback(before, plan, 200).state;
  assert.equal(middle.actors.get(actorKey(a))?.opacity, 1);
  assert.equal(middle.actors.get(actorKey(c))?.opacity, .5);
  assert.equal(middle.actors.has(actorKey(b)), false);
  assert.deepEqual(middle.actorGhosts?.map(actor => actor.characterId), ['b']);
  const after = sampleLinePlayback(before, plan, 700).state;
  assert.deepEqual(new Set(after.actors.keys()), new Set([actorKey(a), actorKey(c)]));
  assert.deepEqual(after.actorGhosts, []);
  finishPreviewLine(after);
  const onlyA = linePlaybackPlan(after, [a]);
  assert.deepEqual([...sampleLinePlayback(after, onlyA, onlyA.dialogueAt).state.actors.keys()], [actorKey(a)]);
});

test('an action-free line retires all line actors together while preserving persistent actors', () => {
  const { a, b, c } = actorBatchFixture();
  const persistent = { ...c, lifetime: 'persistent' as const };
  const before = completedActorLine([a, b, persistent]), plan = linePlaybackPlan(before, []);
  assert.equal(plan.dialogueAt, 700);
  const middle = sampleLinePlayback(before, plan, 350).state;
  assert.deepEqual([...middle.actors.keys()], [actorKey(persistent)]);
  assert.equal(middle.actors.get(actorKey(persistent))?.opacity, 1);
  assert.deepEqual(middle.actorGhosts?.map(actor => [actor.characterId, actor.opacity]), [['a', .5], ['b', .5]]);
  const after = sampleLinePlayback(before, plan, 700).state;
  assert.deepEqual([...after.actors.keys()], [actorKey(persistent)]);
  assert.deepEqual(after.actorGhosts, []);
  assert.equal(after.pendingActorExits?.size, 0);
});

test('an explicit pause ends actor continuity even when its duration is zero', () => {
  const { a, b } = actorBatchFixture(), before = completedActorLine([a, b]);
  for (const seconds of [0, .15]) {
    const plan = linePlaybackPlan(before, [a, { kind: 'pause', seconds }, b]);
    assert.equal(plan.steps.find(step => step.action.kind === 'pause')?.at, 700);
    assert.equal(plan.dialogueAt, 1100 + seconds * 1000);
    const departure = sampleLinePlayback(before, plan, 350).state;
    assert.equal(departure.actors.get(actorKey(a))?.opacity, 1);
    assert.equal(departure.actors.has(actorKey(b)), false, 'a later show must not look ahead across the pause');
    assert.deepEqual(departure.actorGhosts?.map(actor => [actor.characterId, actor.opacity]), [['b', .5]]);
    const entering = sampleLinePlayback(before, plan, 900 + seconds * 1000).state;
    assert.equal(entering.actors.get(actorKey(a))?.opacity, 1);
    assert.equal(entering.actors.get(actorKey(b))?.opacity, .5, 'the show after the pause is a new entrance');
  }
});

test('a sound before the next show commits pending departures before starting that show', () => {
  const { a } = actorBatchFixture(), before = completedActorLine([a]);
  const plan = linePlaybackPlan(before, [{ kind: 'sound', assetId: 'chime' }, a]);
  assert.equal(plan.steps.find(step => step.action.kind === 'sound')?.at, 700);
  assert.equal(plan.dialogueAt, 1100);
  const departure = sampleLinePlayback(before, plan, 350).state;
  assert.equal(departure.actors.size, 0);
  assert.deepEqual(departure.actorGhosts?.map(actor => [actor.characterId, actor.opacity]), [['a', .5]]);
  assert.equal(sampleLinePlayback(before, plan, 900).state.actors.get(actorKey(a))?.opacity, .5);
});

test('compiled adjacent shows form one actor batch before the next dialogue boundary', () => {
  const { project, node, a, b } = actorBatchFixture();
  node.lines = [{ id: 'pair', text: '一起显示。', actions: [a, b] }, { id: 'repeat', text: '继续显示。', actions: [b, { ...a, expressionId: 'a_happy' }] }];
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  for (const line of node.lines) {
    const rows = sourceStatements(compiled, node.id, line.id);
    const shows = rows.filter(row => row.text.includes('$ vn_bp_show('));
    assert.equal(shows.length, 2);
    const boundary = rows.find(row => /^    \$ vn_actor_(?:flush|retire_pending)\(/.test(row.text));
    assert.ok(boundary && shows.every(row => row.index < boundary.index), 'both modern shows must run before any unconditional actor retirement');
    const say = rows.find(row => row.text.includes('id vn_say_'));
    assert.ok(say && boundary.index < say.index);
    assert.ok(rows.some(row => row.index > say.index && row.text.trim() === '$ vn_finish_line_actors()'));
  }
});

test('compiled explicit pauses and action-free lines commit pending actors before interaction', () => {
  const { project, node, a, b } = actorBatchFixture();
  node.lines = [
    ...[0, .15].map((seconds, index) => ({ id: 'pause_' + index, text: '暂停后再显示。', actions: [a, { kind: 'pause' as const, seconds }, b] })),
    { id: 'empty', text: '两人离开。', actions: [] },
  ];
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  for (const [index, seconds] of [0, .15].entries()) {
    const rows = sourceStatements(compiled, node.id, 'pause_' + index);
    const shows = rows.filter(row => row.text.includes('$ vn_bp_show('));
    const pause = rows.find(row => row.text.trim() === 'pause ' + seconds);
    assert.equal(shows.length, 2);
    assert.ok(pause && shows[0].index < pause.index && pause.index < shows[1].index);
    assert.ok(rows.some(row => row.index > shows[0].index && row.index < pause.index && row.text.trim() === '$ vn_actor_flush()'));
  }
  const empty = sourceStatements(compiled, node.id, 'empty');
  const flush = empty.find(row => row.text.trim() === '$ vn_actor_flush()'), say = empty.find(row => row.text.includes('id vn_say_'));
  assert.ok(flush && say && flush.index < say.index, 'an empty action list still retires actors before dialogue');
});

test('blank targets and default expressions stay dynamic when paired with another actor', () => {
  const { project, node } = actorBatchFixture();
  project.characters[0].defaultExpressionId = 'a_happy';
  const followSpeaker = defaultShowCharacter({ instanceId: 'left' });
  const explicitActor = defaultShowCharacter({ characterId: 'b', instanceId: 'right' });
  node.lines = [{ id: 'dynamic', speakerId: 'a', text: '按当前角色默认显示。', actions: [followSpeaker, explicitActor] }];
  for (const speakerId of ['a', 'c']) {
    const context = previewActionContext(project); context.speakerId = speakerId;
    const expanded = expandPreviewActions(project, node.lines[0].actions, context);
    assert.equal(context.incomplete, false);
    assert.deepEqual(expanded.filter(action => action.kind === 'show').map(action => [action.characterId, action.expressionId, action.instanceId]), [[speakerId, speakerId === 'a' ? 'a_happy' : 'c_normal', 'left'], ['b', 'b_normal', 'right']]);
  }
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const rows = sourceStatements(compiled, node.id, 'dynamic'), shows = rows.filter(row => row.text.includes('if vn_bp_show_speaker('));
  assert.equal(shows.length, 2);
  assert.match(shows[0].text, /vn_bp_show_speaker\("".*preset_id="default".*character_id=""\)/);
  assert.match(shows[1].text, /vn_bp_show_speaker\("".*preset_id="default".*character_id="b"\)/);
  const boundary = rows.find(row => row.text.trim() === '$ vn_actor_flush()');
  assert.ok(boundary && shows.every(row => row.index < boundary.index));
  assert.equal(followSpeaker.characterId, '');
  assert.equal(explicitActor.expressionId, '');
});

test('a nested blueprint keeps actor inputs dynamic and does not split consecutive shows', () => {
  const { project, node, a, b } = actorBatchFixture();
  const graph = blueprintFromPerformance(project, [{ ...a, instanceId: 'left' }, { ...b, instanceId: 'right' }], '双人显示');
  const showNodes = graph.nodes.filter(item => item.type === 'showCharacter');
  const inputs = performanceInputs(graph).filter(input => input.nodeId === showNodes[0].id && ['characterId', 'expressionId'].includes(input.pinId));
  assert.equal(inputs.length, 2);
  exposePerformanceInputs(graph, inputs); project.blueprints.push(graph);
  const characterInput = graph.exposedInputs[inputs.findIndex(input => input.pinId === 'characterId')];
  const expressionInput = graph.exposedInputs[inputs.findIndex(input => input.pinId === 'expressionId')];
  const call: StageAction = { kind: 'blueprint', blueprintId: graph.id, inputs: { [characterInput.id]: 'c', [expressionInput.id]: 'c_happy' } };
  const outer = blueprintFromPerformance(project, [call], '嵌套双人显示'); project.blueprints.push(outer);
  node.lines = [{ id: 'nested', speakerId: 'a', text: '角色由本次输入决定。', actions: [{ kind: 'blueprint', blueprintId: outer.id }] }];
  const context = previewActionContext(project); context.speakerId = 'a';
  const expanded = expandPreviewActions(project, node.lines[0].actions, context);
  assert.equal(context.incomplete, false);
  assert.deepEqual(expanded.filter(action => action.kind === 'show').map(action => [action.characterId, action.expressionId, action.instanceId]), [['c', 'c_happy', 'left'], ['b', 'b_normal', 'right']]);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const first = sourceStatements(compiled, showNodes[0].id).find(row => row.text.includes('if vn_bp_show_speaker('));
  const second = sourceStatements(compiled, showNodes[1].id).find(row => row.text.includes('if vn_bp_show_speaker('));
  assert.ok(first && second && first.index < second.index);
  assert.ok(first.text.includes('vn_bp_show_speaker(vn_bp_in_' + graph.id + '_' + expressionInput.id + ','));
  assert.ok(first.text.includes('character_id=vn_bp_in_' + graph.id + '_' + characterInput.id + ')'));
  const betweenShows = compiled.files['game/story.rpy'].split('\n').slice(first.index, second.index);
  const nodeIndent = first.text.match(/^ */)![0];
  assert.ok(!betweenShows.some(text => text.startsWith(nodeIndent + '$ vn_actor_flush(') || text.startsWith(nodeIndent + '$ vn_actor_retire_pending(')), 'a nested call must leave the actor batch open until an actual boundary');
  const caller = sourceStatements(compiled, node.id, 'nested');
  const invocation = caller.find(row => row.text.includes('call vn_blueprint_' + outer.id));
  const flush = caller.find(row => row.text.trim() === '$ vn_actor_flush()');
  assert.ok(invocation && flush && invocation.index < flush.index);
});

test('a blueprint delay commits the first actor batch before a later show', () => {
  const { project, node, a, b } = actorBatchFixture();
  const graph = blueprintFromPerformance(project, [a, { kind: 'pause', seconds: 0 }, b], '分开显示');
  project.blueprints.push(graph);
  node.lines = [{ id: 'separate', text: '显式等待分开两次显示。', actions: [{ kind: 'blueprint', blueprintId: graph.id }] }];
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const showNodes = graph.nodes.filter(item => item.type === 'showCharacter'), delay = graph.nodes.find(item => item.type === 'delay')!;
  const first = sourceStatements(compiled, showNodes[0].id).find(row => row.text.includes('if vn_bp_show_speaker('));
  const second = sourceStatements(compiled, showNodes[1].id).find(row => row.text.includes('if vn_bp_show_speaker('));
  const delayRows = sourceStatements(compiled, delay.id);
  const flush = delayRows.find(row => row.text.trim() === '$ vn_actor_flush()'), pause = delayRows.find(row => row.text.trim() === 'pause 0');
  assert.ok(first && flush && pause && second);
  assert.ok(first.index < flush.index && flush.index < pause.index && pause.index < second.index);
});

test('only a positive blocking legacy appearance separates adjacent actor renewals', () => {
  const { a, b, c } = actorBatchFixture(), before = completedActorLine([a, b]);
  const legacy: ShowActor = { ...c, lifetime: 'persistent', actorTransitions: undefined };
  for (const settings of [
    { transition: 'none' as const, duration: .35 },
    { transition: 'dissolve' as const, duration: 0 },
    { transition: 'move' as const, duration: 0 },
    { transition: 'dissolve' as const, duration: .35, wait: false },
  ]) {
    const plan = linePlaybackPlan(before, [a, { ...legacy, ...settings }, b]);
    assert.equal(plan.dialogueAt, 0);
    assert.ok(!plan.steps.some(step => step.action.kind === 'hide'), 'an immediate or nonblocking legacy show must not retire the following companion');
    const frame = sampleLinePlayback(before, plan, 0).state;
    assert.equal(frame.actors.get(actorKey(a))?.opacity, 1);
    assert.equal(frame.actors.get(actorKey(b))?.opacity, 1);
  }
  const plan = linePlaybackPlan(before, [a, { ...legacy, duration: .35 }, b]);
  const departure = plan.steps.find(step => step.action.kind === 'hide' && actorKey(step.action) === actorKey(b));
  const reentry = plan.steps.find(step => step.action.kind === 'show' && actorKey(step.action) === actorKey(b));
  assert.ok(departure && reentry);
  assert.equal(departure.at, 0, 'a blocking legacy transition starts the absent actor exit alongside its own animation');
  assert.equal(reentry.at, 350);
  assert.equal(reentry.before.actors.has(actorKey(b)), false);
  assert.equal(reentry.duration, 400, 'a show after that interaction is an entrance, not expression continuity');
  assert.equal(plan.dialogueAt, 750, 'the legacy transition must not first wait for the full departure');
});

test('a timeline join waits only until its deadline after actor departures, while an explicit pause keeps its own duration', () => {
  const { project, node, b, c } = actorBatchFixture(), before = completedActorLine([b]);
  const trackShow: ShowActor = { ...c, duration: .4, wait: false };
  const timeline = blueprintFromPerformance(project, [trackShow], '并行角色轨道');
  project.blueprints.push(timeline);
  const model = performanceTimeline(project, timeline);
  arrangePerformanceTimeline(project, timeline, model.clips, model.tracks);
  const outer = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: timeline.id }], '调用角色轨道');
  project.blueprints.push(outer);
  node.lines = [{ id: 'joined', text: '旧角色退出后继续。', actions: [{ kind: 'blueprint', blueprintId: outer.id }] }];
  const context = previewActionContext(project);
  const expanded = expandPreviewActions(project, node.lines[0].actions, context);
  assert.equal(context.incomplete, false);
  const plan = linePlaybackPlan(before, expanded), tail = plan.steps.filter(step => step.action.kind === 'pause').at(-1);
  assert.equal(plan.dialogueAt, 700, 'the 400ms track completes during the 700ms departure');
  assert.ok(tail);
  assert.equal(tail.at, 700);
  assert.equal(tail.duration, 0);
  const settled = sampleLinePlayback(before, plan, 700).state;
  assert.equal(settled.actors.has(actorKey(b)), false);
  assert.equal(settled.actors.get(actorKey(c))?.opacity, 1);
  assert.equal(linePlaybackPlan(before, [trackShow, { kind: 'pause', seconds: .4 }]).dialogueAt, 1100);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const rows = sourceStatements(compiled, timeline.timeline!.tailNodeId!);
  const flush = rows.find(row => row.text.trim() === '$ vn_actor_flush()');
  const deadline = rows.find(row => row.text.trim().startsWith('while ') && row.text.includes('vn_bp_timeline_end_' + timeline.id));
  assert.ok(flush && deadline && flush.index < deadline.index, 'the game must recheck the track deadline after completing the actor batch');
});

test('an authored actor animation replaces that actor blend and offsets without extending the cancelled effect', () => {
  const { a, b } = actorBatchFixture(), empty = initialPreviewStage();
  const first: ShowActor = { ...a, lifetime: 'persistent', wait: false, afterOffsets: { x: [{ at: 0, value: 0, easing: 'linear' }, { at: 1, value: .2, easing: 'linear' }] } };
  const companion: ShowActor = { ...b, lifetime: 'persistent', wait: false };
  const animation: StageAction = { kind: 'animate', characterId: a.characterId, wait: true, repeat: false, keyframes: [{ duration: .1, x: .6, y: 1, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }] };
  const actions: StageAction[] = [first, { kind: 'pause', seconds: .2 }, animation];
  const plan = linePlaybackPlan(empty, actions);
  assert.equal(plan.until, 300, 'replaced post-entry offsets must not retain the old 1400ms deadline');
  assert.equal(plan.dialogueAt, 300);
  const after = sampleLinePlayback(empty, plan, 300).state;
  assert.equal(after.actorBlends?.has(actorKey(a)), false);
  assert.equal(after.actors.get(actorKey(a))?.x, .6);
  const together = linePlaybackPlan(empty, [first, companion, ...actions.slice(1)]);
  const middle = sampleLinePlayback(empty, together, 300).state;
  assert.equal(middle.actorBlends?.has(actorKey(a)), false);
  assert.equal(middle.actorBlends?.has(actorKey(b)), true, 'a different actor keeps its own unfinished entrance');
  assert.ok(Math.abs(middle.actors.get(actorKey(b))!.opacity - .75) < 1e-9);
  assert.equal(together.until, 400);
  const departing = { ...b, instanceId: 'right', wait: false };
  const seed = linePlaybackPlan(empty, [departing]);
  const before = sampleLinePlayback(empty, seed, 400).state;
  finishPreviewLine(before);
  const absentAnimation: StageAction = { ...animation, characterId: b.characterId, instanceId: 'right', wait: false };
  const departure = linePlaybackPlan(before, [first, absentAnimation]);
  const outgoing = sampleLinePlayback(before, departure, 350).state;
  assert.equal(outgoing.actors.has(actorKey(departing)), false);
  const blend = outgoing.actorBlends?.get(actorKey(departing));
  assert.ok(blend?.previous);
  assert.equal(actorKey(blend.previous), actorKey(departing));
  assert.equal(blend.current, undefined);
  const ghost = outgoing.actorGhosts?.find(actor => actor.instanceId === 'transition_' + actorKey(departing).replaceAll(':', '_'));
  assert.equal(ghost?.opacity, .5, 'animating a missing named actor is a no-op and must not erase its departure');
  assert.equal(sampleLinePlayback(before, departure, 700).state.actors.has(actorKey(departing)), false);
});
