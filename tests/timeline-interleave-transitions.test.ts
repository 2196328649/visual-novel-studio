import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type ActorTransitions, type BlueprintGraph, type Project, type StageAction } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults } from '../src/core/blueprint';
import { graphShowsActors, parseActorTransitions } from '../src/core/actor-transitions';
import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { interleaveProjectTimelines } from '../src/core/timeline-interleave';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { compileProject } from '../src/runtime/compiler';
import { pythonLiteral } from '../src/runtime/literals';

const nodeRules: ActorTransitions = { enter: { mode: 'none', duration: 0 }, expression: { mode: 'dissolve', duration: .2 }, exit: { mode: 'none', duration: 0 } };
const outsideRules: ActorTransitions = { enter: { mode: 'fade', duration: 2 }, expression: { mode: 'fade', duration: .9 }, exit: { mode: 'dissolve', duration: 1 } };
const parentRules: ActorTransitions = { enter: { mode: 'fade', duration: 1.2 }, exit: { mode: 'move', duration: .6 } };
const innerRules: ActorTransitions = { enter: { mode: 'dissolve', duration: .8 } };
const show = (characterId: string): Extract<StageAction, { kind: 'show' }> => ({ kind: 'show', characterId, expressionId: characterId + '_normal', x: .5, y: 1, scale: 1, layer: 10, lifetime: 'line', transition: 'dissolve', duration: .5, wait: false, actorTransitions: nodeRules });

function arrange(project: Project, graph: BlueprintGraph, times: number[]) {
  const model = performanceTimeline(project, graph); assert.equal(model.reason, undefined);
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: times[index], trackId: 'row_' + index })), times.map((_, index) => ({ id: 'row_' + index, name: '轨道 ' + index })));
}

function fixture(savedShow = false) {
  const project = createProject('嵌套角色过渡');
  project.assets = [{ id: 'portrait', name: '角色立绘', kind: 'image', path: 'portrait.png' }];
  project.characters = ['hero', 'other'].map(id => ({ id, name: id, color: '#ffffff', expressions: [{ id: id + '_normal', name: '通常', assetId: 'portrait' }], actorTransitions: { enter: { mode: 'move' as const, duration: .4 } } }));
  const leaf = blueprintFromPerformance(project, [show('hero')], '显示角色的子时间轴'); leaf.timelineComponent = true;
  let actor = leaf.nodes[1];
  if (savedShow) {
    const saved = blueprintNodeDefaults('savedAction'); saved.id = actor.id; saved.properties.action = JSON.stringify(show('hero'));
    leaf.nodes[1] = actor = saved;
  }
  addProjectGraphs(project, leaf); arrange(project, leaf, [.1]);
  const middle = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: leaf.id, actorTransitions: innerRules }], '内部调用'); middle.timelineComponent = true;
  addProjectGraphs(project, middle); arrange(project, middle, [.2]);
  const parent = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: middle.id, actorTransitions: parentRules }, show('other')], '主时间轴'); parent.timelineComponent = true;
  addProjectGraphs(project, parent); arrange(project, parent, [0, 2]);
  const outside = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: parent.id, actorTransitions: outsideRules }], '保留真实调用的外层蓝图');
  addProjectGraphs(project, outside);
  return { project, leaf, middle, parent, outside, actor };
}

function preview(project: Project, id: string) {
  const context = previewActionContext(project); context.actionOrigins = new Map();
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: id }], context, [{ nodeId: 'source_passage', lineId: 'source_line', actionIndex: 0 }]);
  assert.equal(context.incomplete, false);
  return { context, actors: actions.filter((action): action is Extract<StageAction, { kind: 'show' }> => action.kind === 'show') };
}

test('interleaved actor overrides preserve real-call precedence and do not leak into an unwrapped sibling', () => {
  const { project, parent, outside, leaf, actor } = fixture(), before = structuredClone(project);
  assert.equal(graphShowsActors(project, parent.id), true, 'the existing call inspector exposes this configuration');
  const actual = preview(project, outside.id);
  assert.deepEqual(actual.actors.map(action => action.actorTransitions), [{ ...nodeRules, ...outsideRules, ...parentRules, ...innerRules }, { ...nodeRules, ...outsideRules }]);
  const ordinary = structuredClone(project);
  for (const graph of projectGraphs(ordinary)) {
    delete graph.timeline;
    for (const node of graph.nodes) if (node.type === 'callFunction') node.properties.wait = true;
  }
  assert.deepEqual(actual.actors.map(action => action.actorTransitions), preview(ordinary, outside.id).actors.map(action => action.actorTransitions), 'flattening has the same rule precedence as real nested calls');
  assert.equal(actual.context.actionOrigins!.get(actual.actors[0])?.blueprintId, leaf.id);
  assert.equal(actual.context.actionOrigins!.get(actual.actors[0])?.blueprintNodeId, actor.id);
  const prepared = interleaveProjectTimelines(project), flat = projectGraphs(prepared).find(graph => graph.id === parent.id)!;
  const copy = flat.nodes.find(node => node.properties.__timelineGraph === leaf.id && node.properties.__timelineNode === actor.id)!;
  assert.deepEqual(parseActorTransitions(copy.properties.__timelineActorTransitions), { ...parentRules, ...innerRules });
  assert.deepEqual(parseActorTransitions(copy.properties.actorTransitions), nodeRules, 'node settings are not rewritten into call settings');
  assert.deepEqual(project, before);
  const loaded = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(preview(loaded, outside.id).actors.map(action => action.actorTransitions), actual.actors.map(action => action.actorTransitions));
});

test('saved actor actions retain the same inner override priority and authored location', () => {
  const { project, parent, outside, leaf, actor } = fixture(true), before = structuredClone(project);
  const { actors, context } = preview(project, outside.id);
  assert.deepEqual(actors[0].actorTransitions, { ...nodeRules, ...outsideRules, ...parentRules, ...innerRules });
  assert.deepEqual(actors[1].actorTransitions, { ...nodeRules, ...outsideRules });
  assert.equal(context.actionOrigins!.get(actors[0])?.blueprintId, leaf.id);
  assert.equal(context.actionOrigins!.get(actors[0])?.blueprintNodeId, actor.id);
  const prepared = interleaveProjectTimelines(project), flat = projectGraphs(prepared).find(graph => graph.id === parent.id)!;
  const copy = flat.nodes.find(node => node.properties.__timelineGraph === leaf.id && node.properties.__timelineNode === actor.id)!;
  assert.equal(copy.type, 'savedAction');
  assert.deepEqual(parseActorTransitions(copy.properties.__timelineActorTransitions), { ...parentRules, ...innerRules });
  assert.deepEqual(project, before);
});

test('compiled flattened actor overrides are scoped across character callbacks and cancelled returns', () => {
  for (const savedShow of [false, true]) {
    const { project, parent, outside, actor } = fixture(savedShow);
    const callback = blueprintFromPerformance(project, [{ kind: 'stopMusic', fade: 0 }], '角色出现时');
    addProjectGraphs(project, callback); project.characters[0].blueprintId = callback.id;
    const compiled = compileProject(project);
    assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
    const script = compiled.files['game/story.rpy'];
    const parentCode = script.split('label vn_blueprint_' + parent.id)[1].split('\nlabel ')[0];
    const append = '$ vn_actor_transition_overrides = vn_actor_transition_overrides + [' + pythonLiteral(JSON.stringify({ ...parentRules, ...innerRules })) + ']';
    const pushAt = parentCode.indexOf(append), popAt = parentCode.indexOf('$ vn_actor_transition_overrides = vn_actor_transition_overrides[:-1]');
    const dynamicAt = parentCode.indexOf('$ renpy.dynamic("vn_actor_transition_overrides")');
    assert.ok(dynamicAt >= 0 && dynamicAt < pushAt && popAt > pushAt, 'copy-on-write stack changes restore the original dynamic value on any label return');
    const callbackAt = savedShow ? parentCode.indexOf('call vn_blueprint_' + callback.id, pushAt) : parentCode.indexOf('call expression vn_bp_character_label(', pushAt);
    assert.ok(callbackAt > pushAt && callbackAt < popAt, 'the character callback runs inside the inherited inner call rules');
    if (!savedShow) assert.match(parentCode.slice(callbackAt, popAt), /if not vn_bp_task_alive\(vn_bp_task\):[\s\S]*?return vn_stage_clock\(\)/, 'cancellation is covered by the graph dynamic scope');
    assert.ok(parentCode.indexOf('character_id="other"', popAt) > popAt, 'the unwrapped sibling executes after restoring the prior override list');
    const outsideCode = script.split('label vn_blueprint_' + outside.id)[1].split('\nlabel ')[0];
    assert.ok(outsideCode.includes('vn_actor_transition_overrides.append(' + pythonLiteral(JSON.stringify(outsideRules)) + ')'));
    assert.equal(outsideCode.includes('$ renpy.dynamic("vn_actor_transition_overrides")'), false, 'ordinary calls retain their existing code path');
    assert.ok(Object.values(compiled.sourceMap).some(origin => origin.nodeId === actor.id));
  }
});
