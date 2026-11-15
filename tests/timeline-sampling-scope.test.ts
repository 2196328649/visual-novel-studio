import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type Project, type StageAction, type VisualObject } from '../src/core/model';
import { blueprintFromPerformance, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, connectBlueprintPins } from '../src/core/blueprint';
import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import { createVisualObject } from '../src/core/visual-object';
import { timelineSamplingGraphIds } from '../src/core/timeline-sampling-scope';
import { interleaveProjectTimelines } from '../src/core/timeline-interleave';
import { arrangePerformanceTimeline, performanceTimeline, timelineNodeActions } from '../src/core/performance-timeline';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { instantiateVisualComposition } from '../src/core/visual-composition';
import { addVisualParameter } from '../src/core/visual-parameters';
import { BlueprintTraceRecorder } from '../src/core/blueprint-trace';

function timeline(project: Project, actions: StageAction[], name: string) {
  const graph = blueprintFromPerformance(project, actions, name), clips = graph.nodes.filter(node => node.type !== 'event');
  clips.forEach(node => { if (node.type === 'callFunction') node.properties.wait = false; });
  const tail = blueprintNodeDefaults('delay'); tail.properties.seconds = 2; graph.nodes.push(tail);
  const previous = clips.at(-1) ?? graph.nodes[0];
  assert.equal(connectBlueprintPins(graph, previous.id, previous.type === 'event' ? 'exec' : 'exec_out', tail.id, 'exec_in'), undefined);
  graph.timelineComponent = true;
  graph.timeline = { tailNodeId: tail.id, tracks: clips.map((_, index) => ({ id: 'track_' + index, name: '轨道 ' + index })), clips: clips.map((node, index) => ({ nodeId: node.id, trackId: 'track_' + index })) };
  addProjectGraphs(project, graph); return graph;
}

function library(project: Project) {
  const leaf = timeline(project, [{ ...createVisualObject('text'), text: '库中的字幕', duration: 2 }], '字幕资源');
  const unused = Array.from({ length: 24 }, (_, index) => timeline(project, Array.from({ length: 4 }, () => ({ kind: 'blueprint', blueprintId: leaf.id })), '未使用资源 ' + index));
  return { leaf, unused };
}

function sample(project: Project, graph: BlueprintGraph, scoped: boolean) {
  const context = previewActionContext(project); context.samplingTimelineNode = true;
  if (scoped) context.samplingGraphIds = timelineSamplingGraphIds(project, graph);
  context.actionOrigins = new Map(); context.trace = new BlueprintTraceRecorder({ limit: 5000 });
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context, [{ nodeId: 'passage', lineId: 'line', actionIndex: 0 }]);
  return { actions, incomplete: context.incomplete, origins: [...context.actionOrigins.values()], trace: context.trace.snapshot() };
}

test('text-only sampling retains the resource catalog without preparing unrelated reusable call trees', () => {
  const project = createProject(), { unused } = library(project);
  const active = timeline(project, Array.from({ length: 24 }, (_, index) => ({ ...createVisualObject('text'), text: '当前文字 ' + index, duration: 2 })), '当前文字时间轴');
  const before = structuredClone(project), scope = timelineSamplingGraphIds(project, active)!;
  assert.deepEqual([...scope], [active.id]);
  const prepared = interleaveProjectTimelines(project, undefined, scope);
  assert.equal(projectGraphs(prepared).length, projectGraphs(project).length, 'sampling plain text must not instantiate the 96 unused calls');
  for (const graph of unused) assert.equal(projectGraphs(prepared).find(item => item.id === graph.id), graph, 'the untouched catalog remains available');
  assert.deepEqual(sample(project, active, true), sample(project, active, false));
  const model = performanceTimeline(project, active); assert.equal(model.reason, undefined); assert.equal(model.clips.length, 24); assert.equal(model.until, 2);
  assert.deepEqual(project, before);
});

test('scoped sampling keeps nested immediate and interleaved timing, layer offsets and authored trace origins', () => {
  const project = createProject(), { leaf, unused } = library(project);
  const delayed = timeline(project, [{ ...createVisualObject('text'), text: '延迟文字', duration: 1 }], '延迟资源');
  const delayedModel = performanceTimeline(project, delayed); arrangePerformanceTimeline(project, delayed, delayedModel.clips.map(clip => ({ ...clip, at: .4 })), delayedModel.tracks);
  const active = timeline(project, [{ kind: 'blueprint', blueprintId: leaf.id }, { kind: 'blueprint', blueprintId: delayed.id }, { kind: 'blueprint', blueprintId: leaf.id }], '交错调用');
  const scope = timelineSamplingGraphIds(project, active)!;
  assert.deepEqual(new Set(scope), new Set([active.id, leaf.id, delayed.id])); assert.ok(unused.every(graph => !scope.has(graph.id)));
  const full = sample(project, active, false), limited = sample(project, active, true);
  assert.equal(limited.incomplete, false); assert.deepEqual(limited, full);
  const whole = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: active.id }], previewActionContext(project));
  const ids = (actions: StageAction[]) => actions.filter(action => action.kind === 'visual').map(action => action.instanceId).sort();
  assert.deepEqual(ids(active.nodes.filter(node => node.type === 'callFunction').flatMap(node => timelineNodeActions(project, active, node))), ids(whole));
});

test('composition resources remain readable although they are not execution dependencies', () => {
  const project = createProject(); library(project);
  const text = { ...createVisualObject('text'), text: '来源', duration: 2 }, group = { ...createVisualObject('group'), duration: 2, children: [text] };
  const title = addVisualParameter(group, text.instanceId, ['text'], 'string', '默认标题', '标题');
  const resource = blueprintFromPerformance(project, [group], '独立组合资源'); resource.visualComposition = true; addProjectGraphs(project, resource);
  const wrapper = instantiateVisualComposition(project, resource.id, 'instance_wrapper'); wrapper.parameterValues = { [title]: '实例标题' };
  const active = timeline(project, [wrapper], '组合播放');
  const scope = timelineSamplingGraphIds(project, active)!; assert.equal(scope.has(resource.id), false);
  const prepared = interleaveProjectTimelines(project, undefined, scope); assert.equal(projectGraphs(prepared).find(graph => graph.id === resource.id), resource);
  const before = structuredClone(project), limited = sample(project, active, true); assert.deepEqual(limited, sample(project, active, false));
  const resolved = limited.actions.find((action): action is VisualObject => action.kind === 'visual')!;
  assert.equal(resolved.children![0].children![0].text, '实例标题'); assert.deepEqual(project, before);
});

test('fixed module and task references stay in scope while indirect routes use full preparation', () => {
  const project = createProject(), leaf = timeline(project, [{ ...createVisualObject('text'), duration: 2 }], '被引用子图');
  for (const kind of ['callFunction', 'callMacro', 'startTask', 'debounce', 'waitTask'] as const) {
    const graph = blueprintFromPerformance(project, [], '引用 ' + kind), node = blueprintNodeDefaults(kind); node.properties.graphId = leaf.id; graph.nodes.push(node);
    assert.deepEqual(new Set(timelineSamplingGraphIds(project, graph)), new Set([graph.id, leaf.id]));
  }
  const saved = blueprintFromPerformance(project, [], '保存的调用'), action = blueprintNodeDefaults('savedAction'); action.properties.action = JSON.stringify({ kind: 'blueprint', blueprintId: leaf.id }); saved.nodes.push(action);
  assert.deepEqual(new Set(timelineSamplingGraphIds(project, saved)), new Set([saved.id, leaf.id]));
  for (const kind of ['effect', 'sceneAction', 'showCharacter', 'showUiPage', 'branch'] as const) {
    const graph = blueprintFromPerformance(project, [], '间接路线'); graph.nodes.push(blueprintNodeDefaults(kind));
    assert.equal(timelineSamplingGraphIds(project, graph), undefined);
  }
  for (const action of [{ kind: 'effect' as const, effectId: 'effect' }, { kind: 'characterFeature' as const, characterId: 'actor', featureId: 'feature' }]) {
    const graph = blueprintFromPerformance(project, [], '封装间接路线'), node = blueprintNodeDefaults('savedAction'); node.properties.action = JSON.stringify(action); graph.nodes.push(node);
    assert.equal(timelineSamplingGraphIds(project, graph), undefined);
  }
});

test('sampling rebuilds dependency scope after in-place target changes and leaves capture inputs untouched', () => {
  const project = createProject(), first = timeline(project, [{ ...createVisualObject('text'), text: '第一次', duration: 1 }], '第一资源'), second = timeline(project, [{ ...createVisualObject('text'), text: '第二次', duration: 3 }], '第二资源');
  const active = timeline(project, [{ kind: 'blueprint', blueprintId: first.id }], '可变调用'), call = active.nodes.find(node => node.type === 'callFunction')!;
  assert.equal(timelineNodeActions(project, active, call).find(action => action.kind === 'visual')!.text, '第一次');
  call.properties.graphId = second.id;
  assert.equal(timelineSamplingGraphIds(project, active)!.has(first.id), false); assert.equal(timelineSamplingGraphIds(project, active)!.has(second.id), true);
  assert.equal(timelineNodeActions(project, active, call).find(action => action.kind === 'visual')!.text, '第二次');
  const source = second.nodes.find(node => node.type === 'savedAction')!, changed = rawSavedBlueprintAction(source) as VisualObject; changed.text = '原位修改'; source.properties.action = JSON.stringify(changed);
  const textPin = source.pins.find(pin => pin.id === 'object_text')!; textPin.defaultValue = changed.text;
  assert.equal(timelineNodeActions(project, active, call).find(action => action.kind === 'visual')!.text, '原位修改');
  const context = previewActionContext(project); context.captureBlueprintCall = { graphId: active.id, nodeId: call.id }; context.samplingGraphIds = new Set();
  assert.deepEqual(expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: active.id }], context), []);
  assert.deepEqual(context.captureBlueprintCall.inputs, {}); assert.equal(context.incomplete, false); assert.equal(call.properties.graphId, second.id);
});
