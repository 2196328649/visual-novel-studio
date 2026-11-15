import { createShowCharacterFixture } from '../scripts/lib/show-character-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionSchema, createProject, projectSchema, type StageAction } from '../src/core/model';
import { actorKey, actorTag, actorInstanceNumber, parseActorInstance, type ShowActor } from '../src/core/actor-instance';
import { finishPreviewLine, linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { moveStageActor, setStageAction } from '../src/core/stage-edit';
import { actionText, applyTextScript, projectToText, textCommandAction } from '../src/core/text-script';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { compileProject } from '../src/runtime/compiler';
import { textAssistance } from '../src/core/text-completion';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';

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

test('actor numbers are scoped to a character, with 1 identical to the existing default and legacy names unchanged', () => {
  const { show } = fixture();
  assert.equal(actorKey(show), actorKey({ ...show, instanceId: '1' }));
  assert.equal(actorTag(show), actorTag({ ...show, instanceId: '1' }));
  assert.equal(actorKey({ ...show, instanceId: 'left' }), 'instance:left');
  assert.equal(actorTag({ ...show, instanceId: 'left' }), 'vn_instance_left');
  const identities = [show, { ...show, instanceId: '2' }, { ...show, instanceId: '3' }, { ...show, characterId: 'friend', instanceId: '2' }, { ...show, characterId: 'slot_hero_2' }, { ...show, instanceId: 'numbered_actor_2_hero' }];
  assert.equal(new Set(identities.map(actorKey)).size, identities.length);
  assert.equal(new Set(identities.map(actorTag)).size, identities.length);
  assert.equal(actorTag({ ...show, instanceId: '2' }), 'vn_numbered_actor_2_hero');
  assert.equal(parseActorInstance('1'), undefined);
  assert.equal(actorInstanceNumber(undefined), 1);
  assert.equal(actorInstanceNumber('left'), undefined);
});

test('hiding the first copy keeps 2 and 3 stable; dragging and animation affect only the selected numbered actor', () => {
  const { project, node, show, selection } = fixture();
  const secondKey = actorKey({ ...show, instanceId: '2' }), thirdKey = actorKey({ ...show, instanceId: '3' });
  const friendKey = actorKey({ characterId: 'friend', instanceId: '2' });
  node.lines = [
    { id: 'first', text: '三个主角与第二个朋友。', actions: [
      { ...show, lifetime: 'persistent' }, { ...show, instanceId: '2', lifetime: 'persistent', x: .5 },
      { ...show, instanceId: '3', lifetime: 'persistent', x: .75 },
      { ...show, characterId: 'friend', expressionId: 'friend_normal', instanceId: '2', lifetime: 'persistent', x: .9 },
    ] },
    { id: 'second', text: '第一个隐藏，编号保留。', actions: [{ kind: 'hide', characterId: 'hero', instanceId: '1', transition: 'none' }] },
    { id: 'third', text: '只移动第二个。', actions: [] },
  ];
  const afterHide = linePreviewSnapshot(project, selection('second')).after;
  assert.deepEqual([...afterHide.actors.keys()], [secondKey, thirdKey, friendKey]);
  moveStageActor(project, selection('third'), secondKey, { x: .6, expressionId: 'smile' });
  const adjusted = linePreviewSnapshot(project, selection('third')).after;
  assert.equal(adjusted.actors.get(secondKey)?.x, .6);
  assert.equal(adjusted.actors.get(thirdKey)?.x, .75);
  assert.equal(adjusted.actors.get(friendKey)?.x, .9);
  const animation: StageAction = { kind: 'animate', characterId: 'hero', instanceId: '2', keyframes: [{ x: .8, y: 1, scale: .8, rotation: 0, opacity: 1, duration: 1, easing: 'linear' }], repeat: false, wait: false };
  const midway = sampleLinePlayback(adjusted, linePlaybackPlan(adjusted, [animation]), 500).state;
  assert.ok(Math.abs(midway.actors.get(secondKey)!.x - .7) < 1e-9);
  assert.equal(midway.actors.get(thirdKey)?.x, .75);
  assert.equal(midway.actors.get(friendKey)?.x, .9);
  setStageAction(project, selection('third'), { ...show, instanceId: '3', expressionId: 'smile', lifetime: 'persistent' });
  const final = linePreviewSnapshot(project, selection('third')).after;
  assert.equal(final.actors.size, 3);
  assert.equal(final.actors.get(secondKey)?.x, .6);
  assert.equal(final.actors.get(thirdKey)?.expressionId, 'smile');
});

test('numbered show/hide commands round-trip without exposing IDs and reject invalid spellings', () => {
  const { project, show } = fixture();
  for (const instanceId of ['2', '3', String(Number.MAX_SAFE_INTEGER)]) {
    const source = { ...show, instanceId, transition: 'dissolve' as const, lifetime: 'persistent' as const };
    const text = actionText(project, source);
    assert.match(text, new RegExp('第几个=' + instanceId));
    assert.doesNotMatch(text, /实例ID/);
    assert.deepEqual(textCommandAction(project, text, true), source);
    const hide = { kind: 'hide' as const, characterId: 'hero', instanceId, transition: 'dissolve' as const };
    assert.deepEqual(textCommandAction(project, actionText(project, hide), true), hide);
  }
  const first = textCommandAction(project, '@显示角色：主角，第几个=1', true);
  assert.equal(first?.kind, 'show');
  assert.equal(first && 'instanceId' in first ? first.instanceId : undefined, undefined);
  const old = textCommandAction(project, '@显示角色：主角，实例ID=left', true);
  assert.equal(old?.kind === 'show' && old.instanceId, 'left');
  assert.match(actionText(project, old!), /实例ID=left/);
  for (const invalid of ['0', '-1', '1.5', '01', '1e2', '+2', '9007199254740992', 'bad-id']) {
    assert.throws(() => textCommandAction(project, '@显示角色：主角，第几个=' + invalid, true), /第几个|实例 ID/);
    assert.throws(() => textCommandAction(project, '@隐藏角色：主角，第几个=' + invalid, true), /第几个|实例 ID/);
    assert.equal(actionSchema.safeParse({ ...show, instanceId: invalid }).success, false);
  }
  for (const invalid of [false, true, 2, null]) assert.throws(() => parseActorInstance(invalid), /第几个|实例 ID/);
  const completion = '@显示角色：主角，第几个=';
  const items = textAssistance(project, completion, completion.length, true)?.items ?? [];
  assert.ok(items.some(item => item.insertText === '2' && /第\s*2\s*个/.test(item.label)));
  assert.ok(items.some(item => item.insertText === 'left' && item.label.includes('旧实例')));
});

test('numbered blueprint calls keep string pin compatibility and resolve against each current speaker', () => {
  const { project, node, show, selection } = fixture();
  const graph = createShowCharacterFixture(); project.blueprints.push(graph);
  const call: StageAction = { kind: 'blueprint', blueprintId: graph.id, inputs: { instance: '2', lifetime: 'persistent' } };
  node.lines = [
    { id: 'first', speakerId: 'hero', text: '主角的第二个。', actions: [call] },
    { id: 'second', speakerId: 'friend', text: '朋友也显示第二个。', actions: [call] },
  ];
  const actors = linePreviewSnapshot(project, selection('second')).after.actors;
  assert.deepEqual([...actors.keys()], [actorKey({ ...show, instanceId: '2' }), actorKey({ characterId: 'friend', instanceId: '2' })]);
  const pin = graph.exposedInputs.find(pin => pin.id === 'instance')!;
  assert.equal(pin.dataType, 'string');
  assert.equal(pin.name, '第几个');
  const command = '@' + graph.name + '：第几个=2';
  assert.deepEqual(textCommandAction(project, command, true), { kind: 'blueprint', blueprintId: graph.id, inputs: { instance: '2' } });
  assert.deepEqual(textCommandAction(project, actionText(project, call), true), call);
  for (const invalid of ['0', '1.5', '01', '1e2', '是']) assert.throws(() => textCommandAction(project, '@' + graph.name + '：第几个=' + invalid, true), /第几个|实例 ID/);
  const context = previewActionContext(project); context.speakerId = 'hero';
  assert.equal(expandPreviewActions(project, [{ ...call, inputs: { instance: 2 } }], context).length, 0);
  assert.equal(context.incomplete, true, 'wrong typed runtime input must not silently select another actor');
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const textRestored = applyTextScript(restored, projectToText(restored));
  assert.deepEqual(textRestored.issues.filter(issue => issue.severity === 'error'), []);
  const restoredNode = textRestored.project.nodes.find(item => item.id === node.id);
  assert.ok(restoredNode?.kind === 'passage');
  const restoredActors = linePreviewSnapshot(textRestored.project, { nodeId: node.id, lineId: restoredNode.lines[1].id }).after.actors;
  assert.deepEqual([...restoredActors.keys()], [...actors.keys()]);
  assert.deepEqual(compileProject(project).diagnostics.filter(issue => issue.severity === 'error'), []);
});

test('nested exposed actor numbers parse as numbers in text while unrelated text pins retain their string contract', () => {
  const { project } = fixture();
  const child = createShowCharacterFixture(); project.blueprints.push(child);
  const parent = createBlueprintGraph('effect', '二层显示');
  const call = blueprintNodeDefaults('callFunction'); call.properties.graphId = child.id; call.pins = callablePins(child);
  const read = blueprintNodeDefaults('getInput'); read.properties.inputId = 'copy'; read.pins[0].dataType = 'string';
  parent.exposedInputs.push({ id: 'copy', name: '第几个', direction: 'input', dataType: 'string', defaultValue: '', required: false }, { id: 'note', name: '备注', direction: 'input', dataType: 'string', defaultValue: '', required: false });
  parent.nodes.push(call, read);
  connectBlueprintPins(parent, parent.nodes[0].id, 'exec', call.id, 'exec_in');
  connectBlueprintPins(parent, read.id, 'value', call.id, 'arg_instance');
  project.blueprints.push(parent);
  const source = textCommandAction(project, '@二层显示：第几个=3，备注="123"', true);
  assert.deepEqual(source, { kind: 'blueprint', blueprintId: parent.id, inputs: { copy: '3', note: '123' } });
  assert.deepEqual(textCommandAction(project, actionText(project, source!), true), source);
  assert.throws(() => textCommandAction(project, '@二层显示：第几个=3，备注=123', true), /文字/);
  const context = previewActionContext(project); context.speakerId = 'hero';
  const expanded = expandPreviewActions(project, [source!], context);
  assert.equal(expanded[0]?.kind === 'show' && expanded[0].instanceId, '3');
  child.nodes.find(node => node.type === 'showCharacter')!.pins.find(pin => pin.id === 'instanceId')!.name = '实例 ID';
  synchronizeBlueprintSignatures(project);
  assert.equal(child.nodes.find(node => node.type === 'showCharacter')!.pins.find(pin => pin.id === 'instanceId')!.name, '第几个');
  assert.equal(parent.links.filter(link => link.toPinId === 'arg_instance').length, 1);
});

test('a shared actor-number input preserves its string for text consumers regardless of link or reader order', () => {
  for (const actorFirst of [false, true]) for (const separateReader of [false, true]) {
    const { project } = fixture();
    project.variables.push({ id: 'shared_text', name: '共用文字', type: 'string', initial: 'initial', persistent: false });
    const child = createShowCharacterFixture();
    const actor = child.nodes.find(node => node.type === 'showCharacter')!;
    const read = child.nodes.find(node => node.type === 'getInput' && node.properties.inputId === 'instance')!;
    const textRead = separateReader ? structuredClone(read) : read;
    if (separateReader) { textRead.id = 'shared_text_reader'; child.nodes.unshift(textRead); }
    const format = blueprintNodeDefaults('formatText'); format.properties.format = '值[{value}]';
    const write = blueprintNodeDefaults('setVariable'); write.properties = { variableId: 'shared_text', scope: 'project' };
    child.nodes.push(format, write);
    assert.equal(connectBlueprintPins(child, textRead.id, 'value', format.id, 'value'), undefined);
    assert.equal(connectBlueprintPins(child, format.id, 'text', write.id, 'value'), undefined);
    assert.equal(connectBlueprintPins(child, actor.id, 'exec_out', write.id, 'exec_in'), undefined);
    child.links.sort((a, b) => (Number(a.toNodeId === actor.id) - Number(b.toNodeId === actor.id)) * (actorFirst ? -1 : 1));
    project.blueprints.push(child);
    const parent = createBlueprintGraph('effect', '共用编号');
    const call = blueprintNodeDefaults('callFunction'); call.properties.graphId = child.id; call.pins = callablePins(child);
    const parentRead = blueprintNodeDefaults('getInput'); parentRead.properties.inputId = 'copy'; parentRead.pins[0].dataType = 'string';
    parent.exposedInputs = [{ id: 'copy', name: '第几个', direction: 'input', dataType: 'string', defaultValue: '1', required: false }];
    parent.nodes.push(call, parentRead); project.blueprints.push(parent);
    assert.equal(connectBlueprintPins(parent, parent.nodes[0].id, 'exec', call.id, 'exec_in'), undefined);
    assert.equal(connectBlueprintPins(parent, parentRead.id, 'value', call.id, 'arg_instance'), undefined);
    for (const graph of [child, parent]) {
      const inputId = graph === child ? 'instance' : 'copy';
      for (const value of ['', '1', '2']) {
        const source = textCommandAction(project, '@' + graph.name + '：第几个=' + (value === '' ? '""' : value), true);
        assert.deepEqual(source, { kind: 'blueprint', blueprintId: graph.id, inputs: { [inputId]: value } });
        assert.deepEqual(textCommandAction(project, actionText(project, source!), true), source);
        const context = previewActionContext(project); context.speakerId = 'hero';
        const expanded = expandPreviewActions(project, [source!], context);
        assert.equal(context.incomplete, false);
        assert.equal(context.variables.shared_text, `值[${value}]`);
        assert.equal(expanded[0]?.kind === 'show' && expanded[0].instanceId, value === '2' ? '2' : undefined);
      }
      const command = '@' + graph.name + '：第几个=';
      assert.ok(textAssistance(project, command, command.length, true)?.items.some(item => item.insertText === '2' && /第\s*2\s*个/.test(item.label)));
      assert.throws(() => textCommandAction(project, command + '01', true), /第几个|实例 ID/);
    }
  }
});

test('an ordinary string input named 第几个 keeps ordinary text completion and parsing', () => {
  const { project } = fixture();
  const graph = createBlueprintGraph('effect', '普通文字');
  graph.exposedInputs = [{ id: 'note', name: '第几个', direction: 'input', dataType: 'string', defaultValue: '', required: false }];
  project.blueprints.push(graph);
  const command = '@普通文字：第几个=';
  assert.ok(!textAssistance(project, command, command.length, true)?.items.some(item => item.insertText === '2'));
  assert.throws(() => textCommandAction(project, command + '2', true), /文字/);
  assert.deepEqual(textCommandAction(project, command + '"2"', true), { kind: 'blueprint', blueprintId: graph.id, inputs: { note: '2' } });
});
