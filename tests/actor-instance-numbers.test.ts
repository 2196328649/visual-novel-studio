import test from 'node:test';
import assert from 'node:assert/strict';
import { actionSchema, blueprintGraphSchema, createProject, projectSchema, type BlueprintGraph, type BlueprintNode, type Project, type StageAction } from '../src/core/model';
import { actorInstanceIds, actorInstanceLabel, actorInstanceNumber, actorInstanceReferences, actorKey, actorReference, actorTag, maxActorInstanceNumber, nextActorInstanceId, parseActorInstance, type ShowActor } from '../src/core/actor-instance';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { BlueprintViewCache } from '../src/renderer/blueprint-view';

function fixture() {
  const project = createProject();
  project.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'portrait.png' }];
  project.characters = ['hero', 'friend'].map(id => ({ id, name: id, color: '#ffffff', expressions: [{ id: 'normal_' + id, name: '普通', assetId: 'portrait' }] }));
  project.blueprints = []; project.timelinePresets = []; project.effects = [];
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines = [{ id: 'line', text: '编号', actions: [] }];
  const show = (characterId = 'hero', instanceId?: string): ShowActor => ({ kind: 'show', characterId, instanceId, expressionId: 'normal_' + characterId, x: .5, y: 1, scale: 1, layer: 10, transition: 'none', duration: 0, wait: false });
  return { project, passage, show };
}

function exposedActor(project: Project, characterId = 'hero') {
  const hide: StageAction = { kind: 'hide', characterId, instanceId: '2', transition: 'none', duration: 0, wait: false };
  const graph = blueprintFromPerformance(project, [hide]);
  const target = graph.nodes.find(node => node.type === 'hideCharacter')!;
  const instance = performanceInputs(graph).find(input => input.nodeId === target.id && input.pinId === 'instanceId')!;
  exposePerformanceInputs(graph, [{ ...instance, name: '第几个' }]);
  project.blueprints.push(graph);
  return { graph, target, inputId: graph.exposedInputs[0].id };
}

function callGraph(owner: BlueprintGraph, target: BlueprintGraph, inputs: Record<string, string>) {
  const call = blueprintNodeDefaults('callFunction');
  call.properties = { graphId: target.id, ...Object.fromEntries(Object.entries(inputs).map(([id, value]) => ['arg_' + id, value])) };
  call.pins = callablePins(target); owner.nodes.push(call);
  return call;
}

test('number tokens keep the default and old global instance identities distinct', () => {
  for (const value of [undefined, '', '1']) {
    assert.equal(actorInstanceNumber(value), 1);
    assert.equal(parseActorInstance(value), undefined);
    assert.equal(actorInstanceLabel(value), '第 1 个');
    assert.equal(actorKey({ characterId: 'hero', instanceId: value }), 'hero');
    assert.equal(actorTag({ characterId: 'hero', instanceId: value }), 'vn_actor_hero');
    assert.deepEqual(actorReference({ characterId: 'hero', instanceId: value }), { characterId: 'hero' });
  }
  assert.equal(actorInstanceNumber(String(maxActorInstanceNumber)), maxActorInstanceNumber);
  assert.equal(actorInstanceLabel('2'), '第 2 个');
  assert.equal(actorInstanceNumber('actor_2'), undefined);
  assert.equal(actorInstanceLabel('actor_2'), '旧实例：actor_2');
  assert.equal(actorKey({ characterId: 'hero', instanceId: '2' }), 'actor-number:hero:2');
  assert.equal(actorTag({ characterId: 'hero', instanceId: '2' }), 'vn_numbered_actor_2_hero');
  assert.notEqual(actorKey({ characterId: 'hero', instanceId: '2' }), actorKey({ characterId: 'friend', instanceId: '2' }));
  assert.equal(actorKey({ characterId: 'hero', instanceId: 'actor_2' }), actorKey({ characterId: 'friend', instanceId: 'actor_2' }));
  assert.equal(actorTag({ characterId: 'hero', instanceId: 'actor_2' }), 'vn_instance_actor_2');
  assert.notEqual(actorTag({ characterId: 'hero', instanceId: '2' }), actorTag({ characterId: 'slot_2_hero' }));
});

test('only character action instance fields accept strict positive integer strings', () => {
  const { project, passage, show } = fixture();
  const actions: StageAction[] = [show(), { kind: 'hide', characterId: 'hero', transition: 'none' }, { kind: 'animate', characterId: 'hero', wait: false, repeat: false, keyframes: [{ x: .5, y: 1, scale: 1, rotation: 0, opacity: 1, duration: 1, easing: 'linear' }] }];
  for (const action of actions) {
    assert.equal((actionSchema.parse({ ...action, instanceId: '1' }) as ShowActor).instanceId, undefined);
    for (const instanceId of ['2', String(maxActorInstanceNumber), 'actor_2']) assert.equal((actionSchema.parse({ ...action, instanceId }) as ShowActor).instanceId, instanceId);
    for (const instanceId of ['0', '-1', '01', '1.0', '2e0', ' 2', '2 ', '2\n', 'left\n', '9007199254740992', 'bad-id', 2, false, null]) {
      assert.throws(() => parseActorInstance(instanceId), /第几个.*实例 ID/);
      assert.equal(actionSchema.safeParse({ ...action, instanceId }).success, false);
    }
  }
  assert.equal(actionSchema.safeParse({ kind: 'hideVisual', instanceId: '2' }).success, false);
  passage.lines[0].actions = actions.map(action => ({ ...action, instanceId: '2' }));
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(reopened.nodes.find(node => node.kind === 'passage')!.lines[0].actions.map(action => (action as ShowActor).instanceId), ['2', '2', '2']);
  assert.equal(projectSchema.safeParse({ ...project, characters: [{ ...project.characters[0], id: '2' }] }).success, false);
});

test('actor reference allocation includes hides, motion, effect commands and inherited character features', () => {
  const { project, passage, show } = fixture();
  project.scenes[0].entryActions = [{ kind: 'hide', characterId: 'hero', instanceId: '5', transition: 'none' }];
  passage.lines[0].actions = [show(), { kind: 'animate', characterId: 'hero', instanceId: '7', wait: false, repeat: false, keyframes: [{ x: 1, y: 1, scale: 1, rotation: 0, opacity: 1, duration: 1, easing: 'linear' }] }];
  project.characters[0].features = [{ id: 'feature', name: '动作', actions: [{ kind: 'hide', characterId: 'hero', instanceId: '8', transition: 'none' }] }];
  project.characters[1].baseCharacterId = 'hero';
  project.effects = [{ id: 'effect', name: '组合', actions: [{ kind: 'hide', characterId: 'hero', instanceId: 'left', transition: 'none' }], commands: ['@隐藏角色：hero，实例ID=9'] }];
  const graph = createBlueprintGraph('effect', '中文指令'), command = blueprintNodeDefaults('sceneAction');
  command.properties.command = '@隐藏角色：hero，实例ID=10'; graph.nodes.push(command); project.blueprints.push(graph);
  assert.deepEqual(actorInstanceIds(project, 'hero'), ['1', '5', '7', '8', '9', '10', 'left']);
  assert.deepEqual(actorInstanceIds(project, 'friend'), ['8']);
  assert.equal(nextActorInstanceId(project, 'hero'), '11');
  assert.equal(nextActorInstanceId(project, 'friend'), '9');
  assert.equal(nextActorInstanceId(project, 'third'), undefined);
  const before = JSON.stringify(project); actorInstanceReferences(project); assert.equal(JSON.stringify(project), before);
  passage.lines[0].actions.push(show('hero', '14'));
  assert.equal(nextActorInstanceId(project, 'hero'), '15');
  assert.equal(nextActorInstanceId(project, 'hero', [show('hero', '20'), show('friend', '100')]), '21');
});

test('only named actors leave the default slot available and dynamic implicit defaults do not reserve all characters', () => {
  const { project, passage, show } = fixture();
  passage.lines[0].actions = [show('hero', 'actor_7')];
  const generic = createBlueprintGraph('effect', '发言角色'); generic.nodes.push(blueprintNodeDefaults('showCharacter')); project.blueprints.push(generic);
  assert.equal(nextActorInstanceId(project, 'hero'), undefined);
  assert.equal(nextActorInstanceId(project, 'hero', [show()]), '2');
  generic.nodes[1].properties.instanceId = '4';
  assert.equal(nextActorInstanceId(project, 'hero'), '5');
  assert.equal(nextActorInstanceId(project, 'friend'), '5');
  passage.lines[0].actions.push(show('hero', String(maxActorInstanceNumber)));
  assert.throws(() => nextActorInstanceId(project, 'hero'), /最大编号/);
});

test('exposed defaults, nested calls, fanout and literal data links reserve their stable numbers', () => {
  const { project, passage } = fixture(), { graph: child, target, inputId } = exposedActor(project);
  const friend = blueprintNodeDefaults('hideCharacter'); friend.properties = { characterId: 'friend', transition: 'none' }; child.nodes.push(friend);
  const input = child.nodes.find(node => node.type === 'getInput')!;
  assert.equal(connectBlueprintPins(child, input.id, 'value', friend.id, 'instanceId'), undefined);
  const parent = createBlueprintGraph('function', '调用方'); project.blueprints.push(parent);
  const call = callGraph(parent, child, { [inputId]: '4' });
  exposePerformanceInputs(parent, [{ nodeId: call.id, pinId: 'arg_' + inputId, name: '编号', dataType: 'string', defaultValue: '4' }]);
  const parentId = parent.exposedInputs[0].id;
  passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: parent.id, inputs: { [parentId]: '12' } }];
  const other = callGraph(parent, child, { [inputId]: '3' }), literal = blueprintNodeDefaults('literal');
  literal.properties.value = '11'; parent.nodes.push(literal);
  assert.equal(connectBlueprintPins(parent, literal.id, 'value', other.id, 'arg_' + inputId), undefined);
  const saved = blueprintNodeDefaults('savedAction');
  saved.properties.action = JSON.stringify({ kind: 'blueprint', blueprintId: child.id, inputs: { [inputId]: '13' } }); parent.nodes.push(saved);
  project.scenes[0].blueprintId = parent.id; project.scenes[0].parameters = { [parentId]: '14' };
  project.gameFlow = { schemaVersion: 1, beforeTitle: { repeat: 'launch', revision: '1', steps: [{ id: 'opening', kind: 'blueprint', graphId: parent.id, inputs: { [parentId]: '15' }, allowSkip: false }] }, beforeNewGame: [] };
  assert.deepEqual(actorInstanceIds(project, 'hero'), ['2', '4', '11', '12', '13', '14', '15']);
  assert.deepEqual(actorInstanceIds(project, 'friend'), ['2', '4', '11', '12', '13', '14', '15']);
  assert.equal(nextActorInstanceId(project, 'hero'), '16');
  assert.equal(target.properties.instanceId, '2');
  child.exposedInputs[0].defaultValue = '17';
  assert.equal(nextActorInstanceId(project, 'hero'), '18');
});

test('cyclic blueprints reserve fixed recursive call inputs without interpreting execution', () => {
  const { project } = fixture(), { graph, inputId } = exposedActor(project);
  callGraph(graph, graph, { [inputId]: '8' });
  assert.deepEqual(actorInstanceIds(project, 'hero'), ['2', '8']);
  assert.equal(nextActorInstanceId(project, 'hero'), '9');
});

test('blueprint actor validators accept number strings but report invalid literal tokens', () => {
  const { project, show } = fixture(), graph = blueprintFromPerformance(project, [show('hero', '2'), { kind: 'hide', characterId: 'hero', instanceId: '2', transition: 'none' }]);
  project.blueprints.push(graph);
  assert.deepEqual(validateBlueprints(project).filter(issue => /第几个|实例 ID/.test(issue.message)), []);
  graph.nodes[1].properties.instanceId = '0';
  assert.ok(validateBlueprints(project).some(issue => issue.nodeId === graph.nodes[1].id && /第几个/.test(issue.message)));
  graph.nodes[1].properties.instanceId = 2;
  assert.ok(validateBlueprints(project).some(issue => issue.nodeId === graph.nodes[1].id && /第几个/.test(issue.message)));
});

test('numbered actor tracks are character scoped and remain serializable for full length character ids', () => {
  const { project, show } = fixture();
  const longId = 'a'.repeat(64), otherLongId = 'a'.repeat(63) + 'b';
  project.characters.push(...[longId, otherLongId].map(id => ({ id, name: id.slice(-2), color: '#ffffff', expressions: [{ id: 'long_normal_' + id.slice(-1), name: '普通', assetId: 'portrait' }] })));
  const actions: StageAction[] = [show('hero', '2'), show('friend', '2'), { ...show(longId, String(maxActorInstanceNumber)), expressionId: 'long_normal_a' }, { ...show(otherLongId, String(maxActorInstanceNumber)), expressionId: 'long_normal_b' }, show('hero', '1'), show('hero', 'left')];
  const graph = blueprintFromPerformance(project, actions); project.blueprints.push(graph);
  const model = performanceTimeline(project, graph);
  assert.equal(model.reason, undefined);
  assert.equal(new Set(model.clips.map(clip => clip.trackId)).size, actions.length);
  assert.ok(model.tracks.some(track => track.id === 'track_actor_hero'));
  assert.ok(model.tracks.some(track => track.id === 'track_actor_instance_left'));
  assert.ok(model.tracks.every(track => track.id.length <= 64));
  assert.ok(model.tracks.some(track => track.name === '角色 · hero · 第 2 个'));
  const before = model.clips.map(clip => clip.trackId);
  graph.nodes[1].properties.layer = 99;
  assert.deepEqual(performanceTimeline(project, graph).clips.map(clip => clip.trackId), before);
  arrangePerformanceTimeline(project, graph, model.clips, model.tracks);
  assert.equal(blueprintGraphSchema.safeParse(graph).success, true);
});

test('numbered tracks use resolved character data links instead of an empty speaker property', () => {
  const { project, show } = fixture(), graph = blueprintFromPerformance(project, [show('hero', '2'), show('friend', '2')]); project.blueprints.push(graph);
  for (const [index, characterId] of ['hero', 'friend'].entries()) {
    const node = graph.nodes[index + 1], value = blueprintNodeDefaults('literal');
    value.properties.value = characterId; value.pins[0].dataType = 'character'; graph.nodes.push(value);
    node.properties.characterId = '';
    assert.equal(connectBlueprintPins(graph, value.id, 'value', node.id, 'characterId'), undefined);
  }
  const model = performanceTimeline(project, graph);
  assert.equal(model.reason, undefined);
  assert.equal(new Set(model.clips.map(clip => clip.trackId)).size, 2);
  assert.deepEqual(model.tracks.map(track => track.name), ['角色 · hero · 第 2 个', '角色 · friend · 第 2 个']);
});

test('number picker view dependencies update after other graph saved hide references change', () => {
  const { project, show } = fixture(), visible = blueprintFromPerformance(project, [show('hero', '2')]); project.blueprints.push(visible);
  const hidden = createBlueprintGraph('effect', '其他图'), action = blueprintNodeDefaults('savedAction');
  action.properties.action = JSON.stringify({ kind: 'hide', characterId: 'hero', instanceId: '3', transition: 'none' }); hidden.nodes.push(action); project.blueprints.push(hidden);
  const cache = new BlueprintViewCache({ assumeImmutable: true }), collapsed = new Set<string>();
  const edit = (_id: string, _change: (node: BlueprintNode) => void) => {}, toggle = (_id: string) => {};
  const read = (current: Project) => cache.update(current, current.blueprints[0], [], edit, collapsed, toggle);
  const first = read(project), unchanged = read(project);
  assert.equal(unchanged[1].data, first[1].data);
  const changed = structuredClone(project); changed.blueprints[1].nodes[1].properties.action = JSON.stringify({ kind: 'hide', characterId: 'hero', instanceId: '4', transition: 'none' });
  const second = read(changed); assert.notEqual(second[1].data, first[1].data);
  assert.equal(second[1].data.project, changed);
  const moved = structuredClone(changed); moved.blueprints[1].nodes[1].x += 10;
  assert.equal(read(moved)[1].data, second[1].data);
});
