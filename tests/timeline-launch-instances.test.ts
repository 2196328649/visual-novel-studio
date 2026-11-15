import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type BlueprintGraph, type Project, type StageAction, type VisualObject } from '../src/core/model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, performanceNode, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { addProjectGraphs, projectGraphs, withProjectGraphs } from '../src/core/project-resources';
import { arrangePerformanceTimeline, performanceTimeline, timelineNodeActions } from '../src/core/performance-timeline';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { performanceTiming } from '../src/core/performance-timing';
import { createVisualObject, visualInputFields } from '../src/core/visual-object';
import { addVisualParameter } from '../src/core/visual-parameters';
import { instantiateVisualComposition } from '../src/core/visual-composition';
import { createAudioClip } from '../src/core/audio-clip';
import { createMediaVisual } from '../src/core/media-command';
import { initialPreviewStage, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { canLaunchTimeline } from '../src/core/timeline-launch';
import { interleaveProjectTimelines, timelineInterleaveDiagnostics } from '../src/core/timeline-interleave';
import { isolateTimelineLaunchInstances, timelineLaunchInstanceDiagnostics } from '../src/core/timeline-launch-instances';
import { compileProject } from '../src/runtime/compiler';

function arrange(project: Project, graph: BlueprintGraph, times: number[]) {
  const model = performanceTimeline(project, graph); assert.equal(model.reason, undefined);
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: times[index] ?? 0, trackId: 'track_' + index })), model.clips.map((_, index) => ({ id: 'track_' + index, name: '轨道 ' + index })));
}

const media = (actions: StageAction[]) => actions.filter((action): action is Extract<StageAction, { kind: 'visual' | 'audioClip' }> => action.kind === 'visual' || action.kind === 'audioClip');
const identities = (actions: StageAction[]) => media(actions).map(action => action.kind + ':' + action.instanceId).sort();
const visualTree = (object: VisualObject): VisualObject[] => [object, ...(object.children ?? []).flatMap(visualTree)];

function fixture() {
  const project = createProject(); project.assets.push({ id: 'sound', name: '声音', kind: 'audio', path: 'sound.wav' });
  const text = { ...createVisualObject('text'), name: '标题文字', text: '默认标题', duration: 2 };
  const inner = { ...createVisualObject('group'), name: '文字内容', duration: 2, children: [text] };
  const tint = addVisualParameter(inner, text.instanceId, ['color'], 'string', '#ffaa00', '文字颜色');
  const group = { ...createVisualObject('group'), name: '字幕卡片', duration: 2, children: [inner] };
  const color = addVisualParameter(group, inner.instanceId, ['parameterValues', tint], 'string', '#88ccff', '卡片文字颜色');
  const audio = { ...createAudioClip('sound', '配乐', 9, 'music'), duration: 2, offset: 1, volume: .4, fadeIn: .2, fadeOut: .3 };
  const child = blueprintFromPerformance(project, [group, audio], '立即播放子时间轴'); child.timelineComponent = true; addProjectGraphs(project, child); arrange(project, child, [0, 0]);
  const visual = child.nodes.find(node => rawSavedBlueprintAction(node)?.kind === 'visual')!;
  const textField = visualInputFields(group).find(field => field.path.join('/') === 'children/0/children/0/text')!;
  const sizeField = visualInputFields(group).find(field => field.path.join('/') === 'children/0/children/0/fontSize')!;
  visual.properties['object_' + sizeField.key] = 37;
  exposePerformanceInputs(child, [{ ...performanceInputs(child).find(input => input.nodeId === visual.id && input.pinId === 'object_' + textField.key)!, name: '标题' }]);
  const parent = blueprintFromPerformance(project, ['甲标题', '乙标题'].map(title => ({ kind: 'blueprint', blueprintId: child.id, inputs: { [child.exposedInputs[0].id]: title } })), '重复立即播放');
  parent.timelineComponent = true; addProjectGraphs(project, parent); arrange(project, parent, [0, .3]);
  return { project, parent, child, visual, group, text, color, audio };
}

test('immediate child calls have distinct visual/audio trees, retain nested inputs and match clip sampling', () => {
  const { project, parent, child, visual, group, audio } = fixture(), before = structuredClone(project);
  assert.equal(canLaunchTimeline(project, child), true);
  const calls = parent.nodes.filter(node => node.type === 'callFunction');
  const sampled = calls.flatMap(call => media(timelineNodeActions(project, parent, call)));
  const context = previewActionContext(project); context.actionOrigins = new Map();
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: parent.id }], context, [{ nodeId: 'passage', lineId: 'line', actionIndex: 0 }]);
  assert.equal(context.incomplete, false); assert.equal(performanceTiming(actions).at, 2.3);
  assert.deepEqual(identities(actions), identities(sampled)); assert.equal(new Set(identities(actions)).size, 4);
  const cards = actions.filter((action): action is VisualObject => action.kind === 'visual');
  assert.deepEqual(cards.map(card => card.children![0].children![0].text), ['甲标题', '乙标题']);
  const rawIds = new Set(visualTree(group).map(object => object.instanceId)), allIds = new Set<string>();
  for (const card of cards) {
    const tree = visualTree(card), ownIds = new Set(tree.map(object => object.instanceId));
    assert.equal(tree[2].fontSize, 37); assert.equal(tree[2].color, '#88ccff');
    for (const object of tree) {
      assert.equal(rawIds.has(object.instanceId), false); assert.equal(allIds.has(object.instanceId), false); allIds.add(object.instanceId);
      assert.ok(object.parameters?.every(parameter => parameter.targets.every(target => ownIds.has(target.instanceId))) ?? true);
    }
    assert.equal(context.actionOrigins.get(card)?.blueprintId, child.id); assert.equal(context.actionOrigins.get(card)?.blueprintNodeId, visual.id);
  }
  const sounds = media(actions).filter(action => action.kind === 'audioClip');
  for (const sound of sounds) {
    assert.notEqual(sound.instanceId, audio.instanceId); assert.equal(sound.duration, 2); assert.equal(sound.sourceDuration, 9);
    assert.equal(sound.offset, 1); assert.equal(sound.volume, .4); assert.equal(sound.fadeIn, .2); assert.equal(sound.fadeOut, .3);
  }
  assert.deepEqual(project, before);
  const prepared = interleaveProjectTimelines(project), preparedParent = projectGraphs(prepared).find(graph => graph.id === parent.id)!;
  const privateGraphs = preparedParent.nodes.filter(node => node.type === 'callFunction').map(call => projectGraphs(prepared).find(graph => graph.id === call.properties.graphId)!);
  assert.notEqual(privateGraphs[0].id, privateGraphs[1].id);
  const allNodes = projectGraphs(prepared).flatMap(graph => graph.nodes.map(node => node.id)); assert.equal(new Set(allNodes).size, allNodes.length);
  for (const graph of privateGraphs) {
    assert.deepEqual(graph.exposedInputs, child.exposedInputs);
    assert.ok(graph.nodes.some(node => node.id === graph.timeline!.tailNodeId));
    assert.ok(graph.timeline!.clips.every(clip => graph.nodes.some(node => node.id === clip.nodeId)));
    assert.ok(graph.links.every(link => graph.nodes.find(node => node.id === link.fromNodeId)?.pins.some(pin => pin.id === link.fromPinId) && graph.nodes.find(node => node.id === link.toNodeId)?.pins.some(pin => pin.id === link.toPinId)));
  }
  assert.deepEqual(isolateTimelineLaunchInstances(prepared), prepared);
  const loaded = projectSchema.parse(JSON.parse(JSON.stringify(prepared)));
  assert.deepEqual(isolateTimelineLaunchInstances(loaded), loaded, 'serialized playback copies must not be scoped a second time');
});

test('nested immediate launches use the original call path independent of resource order', () => {
  const { project, parent, child } = fixture(); arrange(project, parent, [0, 0]);
  const outer = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: parent.id }, { kind: 'blueprint', blueprintId: parent.id }], '两层重复调用'); addProjectGraphs(project, outer); arrange(project, outer, [0, .5]);
  const context = previewActionContext(project), actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: outer.id }], context);
  assert.equal(context.incomplete, false); assert.equal(media(actions).length, 8); assert.equal(new Set(identities(actions)).size, 8);
  const samples = outer.nodes.filter(node => node.type === 'callFunction').flatMap(call => timelineNodeActions(project, outer, call));
  assert.deepEqual(identities(actions), identities(samples));
  const reordered = withProjectGraphs(project, [...projectGraphs(project)].reverse());
  const reorderedActions = expandPreviewActions(reordered, [{ kind: 'blueprint', blueprintId: outer.id }], previewActionContext(reordered));
  assert.deepEqual(identities(reorderedActions), identities(actions));
  const prepared = interleaveProjectTimelines(project);
  const outerCopy = projectGraphs(prepared).find(graph => graph.id === outer.id)!;
  for (const call of outerCopy.nodes.filter(node => node.type === 'callFunction')) {
    const intermediate = projectGraphs(prepared).find(graph => graph.id === call.properties.graphId)!;
    assert.equal(intermediate.nodes.filter(node => node.type === 'callFunction').length, 2);
    assert.ok(intermediate.nodes.filter(node => node.type === 'callFunction').every(node => node.properties.graphId !== child.id && node.properties.__timelineGraph === parent.id));
  }
});

test('mixed delayed interleaving and immediate sampling use identical per-call instances', () => {
  const { project, parent, child } = fixture();
  const delayed = blueprintFromPerformance(project, [{ ...createVisualObject('text'), name: '稍后文字', text: '稍后', duration: 1 }], '延迟子时间轴'); addProjectGraphs(project, delayed); arrange(project, delayed, [.6]);
  const call = performanceNode(project, { kind: 'blueprint', blueprintId: delayed.id }); parent.nodes.push(call);
  const tail = parent.nodes.find(node => node.id === parent.timeline!.tailNodeId)!;
  const incoming = parent.links.find(link => link.toNodeId === tail.id)!; incoming.toNodeId = call.id; incoming.toPinId = 'exec_in';
  assert.equal(connectBlueprintPins(parent, call.id, 'exec_out', tail.id, 'exec_in'), undefined);
  arrange(project, parent, [0, .3, .1]);
  assert.equal(canLaunchTimeline(project, child), true); assert.equal(canLaunchTimeline(project, delayed), false);
  const samples = parent.nodes.filter(node => node.type === 'callFunction').flatMap(node => timelineNodeActions(project, parent, node));
  const context = previewActionContext(project), actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: parent.id }], context);
  assert.equal(context.incomplete, false); assert.deepEqual(identities(samples), identities(actions)); assert.equal(new Set(identities(actions)).size, 5);
  assert.equal(performanceTiming(actions).at, 2.3);
  const prepared = interleaveProjectTimelines(project), flat = projectGraphs(prepared).find(graph => graph.id === parent.id)!;
  assert.ok(flat.nodes.some(node => node.properties.__timelineGraph === delayed.id));
});

test('launch instance calls retain local state, output defaults and callers outside timeline mode', () => {
  const project = createProject(), text = { ...createVisualObject('text'), text: '子调用', duration: 2 };
  const child = blueprintFromPerformance(project, [text], '有局部变量和输出的子调用'); addProjectGraphs(project, child); arrange(project, child, [0]);
  child.localVariables = [{ id: 'size', name: '子字号', type: 'number', initial: 29 }];
  child.exposedOutputs = [{ id: 'title', name: '结果标题', direction: 'output', dataType: 'string', required: false, defaultValue: '默认输出仍可读取' }];
  const reader = blueprintNodeDefaults('getVariable'); reader.properties = { scope: 'call', variableId: 'size' }; reader.pins[0].dataType = 'number'; child.nodes.push(reader);
  const childVisual = child.nodes.find(node => node.type === 'savedAction')!;
  assert.equal(connectBlueprintPins(child, reader.id, 'value', childVisual.id, 'object_fontSize'), undefined);
  const parent = createBlueprintGraph('function', '普通蓝图调用'); parent.localVariables = [{ id: 'size', name: '父字号', type: 'number', initial: 91 }];
  const call = blueprintNodeDefaults('callFunction'); call.properties = { graphId: child.id, wait: false }; call.pins = callablePins(child);
  const result = performanceNode(project, { ...createVisualObject('text'), text: '不会显示这个默认值', duration: 1 }); parent.nodes.push(call, result); addProjectGraphs(project, parent);
  assert.equal(connectBlueprintPins(parent, parent.nodes[0].id, 'exec', call.id, 'exec_in'), undefined);
  assert.equal(connectBlueprintPins(parent, call.id, 'exec_out', result.id, 'exec_in'), undefined);
  assert.equal(connectBlueprintPins(parent, call.id, 'out_title', result.id, 'object_text'), undefined);
  assert.equal(canLaunchTimeline(project, child), true); assert.equal(parent.timeline, undefined);
  const context = previewActionContext(project), actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: parent.id }], context);
  assert.equal(context.incomplete, false);
  const cards = actions.filter((action): action is VisualObject => action.kind === 'visual'); assert.equal(cards[0].fontSize, 29); assert.equal(cards[1].text, '默认输出仍可读取');
  const prepared = interleaveProjectTimelines(project), owner = projectGraphs(prepared).find(graph => graph.id === parent.id)!;
  const targetId = String(owner.nodes.find(node => node.id === call.id)!.properties.graphId), target = projectGraphs(prepared).find(graph => graph.id === targetId)!;
  assert.notEqual(targetId, child.id); assert.deepEqual(target.localVariables, child.localVariables); assert.deepEqual(target.exposedOutputs, child.exposedOutputs);
  const compiled = compileProject(project); assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.ok(compiled.files['game/story.rpy'].includes('call vn_blueprint_' + targetId));
  assert.ok(compiled.files['game/story.rpy'].includes('vn_bp_launch_' + targetId + '=True'));
  assert.ok(compiled.files['game/story.rpy'].includes('vn_bp_state_get(' + JSON.stringify(targetId)));
  const authoredNodes = new Set([...project.nodes.map(node => node.id), ...projectGraphs(project).flatMap(graph => graph.nodes.map(node => node.id))]);
  assert.ok(Object.values(compiled.sourceMap).every(origin => authoredNodes.has(origin.nodeId)), 'runtime-private nodes must still locate authored code');
  assert.ok(Object.values(compiled.sourceMap).some(origin => origin.nodeId === childVisual.id));
  assert.equal(projectGraphs(project).find(graph => graph.id === parent.id)!.nodes.find(node => node.id === call.id)!.properties.graphId, child.id);
});

test('ordinary calls keep named media replace/hide behavior across nesting and duration input changes', () => {
  for (const nested of [false, true]) for (const duration of [0, 4]) {
    const project = createProject(); project.assets.push({ id: 'sound', name: '声音', kind: 'audio', path: 'sound.wav' });
    const named = createMediaVisual('text', '首次显示', { instanceId: 'overlay', duration });
    const timed = { ...createVisualObject('text'), text: '独立的定时字幕', duration: 2 };
    const child = blueprintFromPerformance(project, [named, timed, createAudioClip('sound', '片段音频', 2)], '显式命名文字'); addProjectGraphs(project, child); arrange(project, child, [0, 0, 0]);
    const namedNode = child.nodes.find(node => rawSavedBlueprintAction(node)?.kind === 'visual' && (rawSavedBlueprintAction(node) as VisualObject).instanceId === 'overlay')!;
    exposePerformanceInputs(child, [{ ...performanceInputs(child).find(field => field.nodeId === namedNode.id && field.pinId === 'object_duration')!, name: '显示时长' }]);
    const childCall: StageAction = { kind: 'blueprint', blueprintId: child.id, inputs: { [child.exposedInputs[0].id]: 0 } };
    const entries: StageAction[] = [0, 1].map(index => {
      if (!nested) return childCall;
      const wrapper = blueprintFromPerformance(project, [childCall], '普通调用转发 ' + index); wrapper.nodes[1].properties.wait = false; addProjectGraphs(project, wrapper);
      return { kind: 'blueprint', blueprintId: wrapper.id };
    });
    const replacement = createMediaVisual('text', '替换后的文字', { instanceId: 'overlay' });
    const parent = blueprintFromPerformance(project, [...entries, { kind: 'pause', seconds: .2 }, replacement, { kind: 'pause', seconds: .2 }, { kind: 'hideVisual', instanceId: 'overlay', wait: false }], '普通蓝图隐藏对象');
    parent.nodes.filter(node => node.type === 'callFunction').forEach(node => { node.properties.wait = false; }); addProjectGraphs(project, parent);
    const before = structuredClone(project), context = previewActionContext(project), actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: parent.id }], context);
    assert.equal(context.incomplete, false);
    const cards = actions.filter((action): action is VisualObject => action.kind === 'visual'), overlays = cards.filter(card => card.text === '首次显示'), timedCards = cards.filter(card => card.text === timed.text);
    assert.equal(overlays.length, 2); assert.ok(overlays.every(card => card.instanceId === 'overlay' && card.persistent && card.duration === 0));
    assert.equal(timedCards.length, 2); assert.notEqual(timedCards[0].instanceId, timedCards[1].instanceId);
    const audio = media(actions).filter(action => action.kind === 'audioClip'); assert.equal(audio.length, 2); assert.notEqual(audio[0].instanceId, audio[1].instanceId);
    const sampled = parent.nodes.filter(node => node.type === 'callFunction').flatMap(call => media(timelineNodeActions(project, parent, call)));
    assert.deepEqual(identities(sampled), identities(actions.filter(action => action !== cards.at(-1))), 'ordinary call sampling must not create a timeline clip boundary');
    const initial = initialPreviewStage(), playback = linePlaybackPlan(initial, actions);
    assert.equal(sampleLinePlayback(initial, playback, 0).state.visuals.get('overlay')!.object.text, '首次显示');
    assert.equal(sampleLinePlayback(initial, playback, 250).state.visuals.get('overlay')!.object.text, '替换后的文字');
    assert.equal(sampleLinePlayback(initial, playback, 400).state.visuals.has('overlay'), false);
    assert.deepEqual(project, before);
    const prepared = interleaveProjectTimelines(project); assert.deepEqual(isolateTimelineLaunchInstances(prepared), prepared);
  }
});

test('a true timeline clip boundary isolates named timed media even when launched by an ordinary blueprint', () => {
  const project = createProject(), named = createMediaVisual('text', '定时的命名字幕', { instanceId: 'overlay', duration: 2 });
  const child = blueprintFromPerformance(project, [named], '命名字幕资源'); addProjectGraphs(project, child); arrange(project, child, [0]);
  const parent = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: child.id }, { kind: 'blueprint', blueprintId: child.id }], '两个真实时间轴片段'); addProjectGraphs(project, parent); arrange(project, parent, [0, 0]);
  const outer = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: parent.id }], '普通启动蓝图'); outer.nodes[1].properties.wait = false; addProjectGraphs(project, outer);
  const context = previewActionContext(project), actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: outer.id }], context);
  assert.equal(context.incomplete, false); const cards = media(actions); assert.equal(cards.length, 2); assert.notEqual(cards[0].instanceId, cards[1].instanceId);
  assert.ok(cards.every(card => card.instanceId !== 'overlay'));
  assert.deepEqual(identities(actions), identities(timelineNodeActions(project, outer, outer.nodes[1])));
  const rootActions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: parent.id }], previewActionContext(project));
  assert.deepEqual(identities(rootActions), identities(parent.nodes.filter(node => node.type === 'callFunction').flatMap(call => timelineNodeActions(project, parent, call))));
});

test('materialized reusable compositions keep parameter targets inside each scoped wrapper', () => {
  const project = createProject(), text = { ...createVisualObject('text'), text: '来源标题', duration: 2 };
  const card = { ...createVisualObject('group'), name: '组合资源', duration: 2, children: [text] };
  const title = addVisualParameter(card, text.instanceId, ['text'], 'string', text.text, '标题');
  const resource = blueprintFromPerformance(project, [card], '组合资源'); resource.visualComposition = true; resource.timelineComponent = true; addProjectGraphs(project, resource);
  const wrapper = instantiateVisualComposition(project, resource.id, 'wrapper'); wrapper.parameterValues = { [title]: '实例标题' };
  const child = blueprintFromPerformance(project, [wrapper], '组合片段'); addProjectGraphs(project, child); arrange(project, child, [0]);
  const parent = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: child.id }, { kind: 'blueprint', blueprintId: child.id }], '组合重复播放'); addProjectGraphs(project, parent); arrange(project, parent, [0, .2]);
  const before = structuredClone(project), context = previewActionContext(project), actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: parent.id }], context);
  assert.equal(context.incomplete, false);
  const wrappers = actions.filter((action): action is VisualObject => action.kind === 'visual'); assert.equal(wrappers.length, 2);
  const ids = wrappers.flatMap(item => visualTree(item).map(object => object.instanceId)); assert.equal(new Set(ids).size, ids.length);
  for (const item of wrappers) {
    assert.equal(item.compositionId, resource.id); assert.equal(item.children![0].children![0].text, '实例标题');
    const own = new Set(visualTree(item).map(object => object.instanceId));
    assert.ok(visualTree(item).every(object => object.parameters?.every(parameter => parameter.targets.every(target => own.has(target.instanceId))) ?? true));
  }
  assert.deepEqual(identities(actions), identities(parent.nodes.filter(node => node.type === 'callFunction').flatMap(call => timelineNodeActions(project, parent, call))));
  assert.deepEqual(project, before);
});

test('recursive launches stay rejected and oversized shared call trees fail before allocating private graphs', () => {
  const project = createProject();
  const immediate = (name: string, target?: BlueprintGraph) => {
    const graph = createBlueprintGraph('effect', name), tail = blueprintNodeDefaults('delay'); tail.properties.seconds = 0;
    const actions = target ? [0, 1].map(() => { const call = blueprintNodeDefaults('callFunction'); call.properties = { graphId: target.id, wait: false }; call.pins = callablePins(target); return call; }) : [blueprintNodeDefaults('stopMusic')];
    graph.nodes.push(...actions, tail); let previous = graph.nodes[0];
    for (const node of [...actions, tail]) { assert.equal(connectBlueprintPins(graph, previous.id, previous.type === 'event' ? 'exec' : 'exec_out', node.id, 'exec_in'), undefined); previous = node; }
    graph.timeline = { tailNodeId: tail.id, tracks: actions.map((_, index) => ({ id: 'track_' + index, name: '轨道 ' + index })), clips: actions.map((node, index) => ({ nodeId: node.id, trackId: 'track_' + index })) };
    addProjectGraphs(project, graph); return graph;
  };
  let root = immediate('共享的叶节点');
  for (let depth = 0; depth < 15; depth++) root = immediate('二叉复用 ' + depth, root);
  const before = structuredClone(project); assert.equal(canLaunchTimeline(project, root), true);
  const issues = timelineLaunchInstanceDiagnostics(project); assert.ok(issues.some(issue => issue.message.includes('超过65536'))); assert.deepEqual(project, before);
  const recursive = createProject(), loop = blueprintFromPerformance(recursive, [], '递归资源'); addProjectGraphs(recursive, loop);
  const call = blueprintNodeDefaults('callFunction'), tail = blueprintNodeDefaults('delay'); call.properties = { graphId: loop.id, wait: false }; call.pins = callablePins(loop); loop.nodes.push(call, tail);
  assert.equal(connectBlueprintPins(loop, loop.nodes[0].id, 'exec', call.id, 'exec_in'), undefined); assert.equal(connectBlueprintPins(loop, call.id, 'exec_out', tail.id, 'exec_in'), undefined);
  loop.timeline = { tailNodeId: tail.id, tracks: [], clips: [] };
  assert.equal(canLaunchTimeline(recursive, loop), false); assert.deepEqual(isolateTimelineLaunchInstances(recursive), recursive);
});

test('capacity diagnostics use the prepared graph when a zero-delay child becomes launchable after interleaving', () => {
  const project = createProject();
  const child = blueprintFromPerformance(project, [{ kind: 'pause', seconds: 0 }, ...Array.from({ length: 240 }, () => ({ kind: 'stopMusic' as const, fade: 0 }))], '旧零秒间隔子图');
  const finish = (graph: BlueprintGraph) => {
    const last = graph.nodes.at(-1)!, tail = blueprintNodeDefaults('delay'); tail.properties.seconds = 0; graph.nodes.push(tail);
    assert.equal(connectBlueprintPins(graph, last.id, last.type === 'event' ? 'exec' : 'exec_out', tail.id, 'exec_in'), undefined);
    graph.timeline = { tailNodeId: tail.id, tracks: [{ id: 'track', name: '演出' }], clips: graph.nodes.filter(node => node.type === 'callFunction' || node.type === 'stopMusic').map(node => ({ nodeId: node.id, trackId: 'track' })) };
    addProjectGraphs(project, graph);
  };
  finish(child);
  const wrapper = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: child.id }], '去掉零秒间隔后立即播放'); wrapper.nodes[1].properties.wait = false; finish(wrapper);
  const caller = blueprintFromPerformance(project, Array.from({ length: 280 }, () => ({ kind: 'blueprint' as const, blueprintId: wrapper.id })), '普通蓝图大量复用');
  caller.nodes.filter(node => node.type === 'callFunction').forEach(node => { node.properties.wait = false; }); addProjectGraphs(project, caller);
  assert.equal(canLaunchTimeline(project, wrapper), false); assert.deepEqual(timelineLaunchInstanceDiagnostics(project), []);
  const before = structuredClone(project), diagnostics = timelineInterleaveDiagnostics(project);
  assert.ok(diagnostics.some(issue => issue.message.includes('超过65536')));
  const unsupported: string[] = [], prepared = interleaveProjectTimelines(project, graph => unsupported.push(graph.id));
  assert.deepEqual(unsupported, [caller.id]); assert.equal(canLaunchTimeline(prepared, projectGraphs(prepared).find(graph => graph.id === wrapper.id)!), true);
  assert.deepEqual(projectGraphs(prepared).find(graph => graph.id === caller.id), caller, 'a failed root publishes no partial call retargets');
  assert.equal(projectGraphs(prepared).length, projectGraphs(project).length); assert.deepEqual(project, before);
  const compiled = compileProject(project); assert.deepEqual(compiled.files, {}); assert.ok(compiled.diagnostics.some(issue => issue.message.includes('超过65536')));
});
