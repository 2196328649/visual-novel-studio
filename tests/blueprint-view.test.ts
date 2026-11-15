import { mutateProject } from '../src/core/project-mutation';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type BlueprintNode, type Project } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { BlueprintViewCache, reuseBlueprintEdges } from '../src/renderer/blueprint-view';
import type { StudioEdge } from '../src/renderer/SelectableEdge';
import { bezierIntersectsRect, parseBezierPath, rectanglesIntersect, type Bezier } from '../src/renderer/blueprint-selection';
import { setBlueprintUiPropertyRows } from '../src/core/blueprint-ui-property-batch';

function fixture() {
  const project = createProject(), graph = createBlueprintGraph('function', '选择与刷新');
  graph.nodes.push(blueprintNodeDefaults('random'), blueprintNodeDefaults('math'));
  project.blueprints.push(graph);
  const cache = new BlueprintViewCache(), collapsed = new Set<string>();
  const edits: string[] = [], edit = (id: string, change: (node: BlueprintNode) => void) => { edits.push(id); change(graph.nodes.find(node => node.id === id)!); };
  const toggle = (id: string) => collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
  const view = (current: Project, issues: { nodeId?: string }[] = []) => cache.update(current, current.blueprints[0], issues, edit, collapsed, toggle);
  return { project, graph, cache, collapsed, edits, edit, toggle, view };
}

test('blueprint UI survives history clones and movement without rebuilding unchanged controls', () => {
  const { project, view, graph, edits } = fixture();
  const first = view(project), moved = structuredClone(project);
  moved.blueprints[0].nodes[1].x += 123; moved.blueprints[0].nodes[1].y -= 78;
  const second = view(moved);
  assert.ok(second.every((item, index) => item.data === first[index].data));
  assert.equal(second[1].node.x, moved.blueprints[0].nodes[1].x);
  second[1].data.edit(node => { node.properties.min = -3; });
  assert.deepEqual(edits, [graph.nodes[1].id]); assert.equal(graph.nodes[1].properties.min, -3);
});

test('parameter edits, diagnostics and collapse invalidate only the affected node', () => {
  const { project, view, collapsed } = fixture();
  const first = view(project), changed = structuredClone(project);
  changed.blueprints[0].nodes[1].properties.min = -2.75;
  const second = view(changed);
  assert.equal(second[0].data, first[0].data); assert.equal(second[2].data, first[2].data);
  assert.notEqual(second[1].data, first[1].data); assert.equal(second[1].data.node.properties.min, -2.75);
  const third = view(changed, [{ nodeId: changed.blueprints[0].nodes[2].id }]);
  assert.equal(third[1].data, second[1].data); assert.equal(third[2].data.invalid, true);
  third[1].data.toggleParameters();
  const fourth = view(changed, [{ nodeId: changed.blueprints[0].nodes[2].id }]);
  assert.equal(fourth[2].data, third[2].data); assert.equal(fourth[1].data.parametersCollapsed, true);
  assert.ok(collapsed.has(fourth[1].node.id));
});

test('connecting and disconnecting an input refreshes the target editor and its graph snapshot', () => {
  const { project, view } = fixture();
  const first = view(project), connected = structuredClone(project), graph = connected.blueprints[0];
  assert.equal(connectBlueprintPins(graph, graph.nodes[1].id, 'value', graph.nodes[2].id, 'a'), undefined);
  const second = view(connected);
  assert.equal(second[0].data, first[0].data); assert.equal(second[1].data, first[1].data);
  assert.notEqual(second[2].data, first[2].data); assert.ok(second[2].data.connectedInputs.has('a'));
  assert.equal(second[2].data.graph.links.length, 1);
  const disconnected = structuredClone(connected); disconnected.blueprints[0].links = [];
  assert.equal(view(disconnected)[2].data.connectedInputs.size, 0);
});

test('a batch skin picker refreshes asset choices even with no asset pin on the node', () => {
  const { project, graph, edit, toggle, collapsed } = fixture();
  const node = blueprintNodeDefaults('setUiProperty');
  setBlueprintUiPropertyRows(node, [{ id: 'value', property: 'spineSkin', writeMode: 'override' }, { id: 'value_speed', property: 'spineSpeed', writeMode: 'override' }]);
  node.properties.value = ''; node.properties.value_speed = 1; graph.nodes.push(node);
  synchronizeBlueprintSignatures(project);
  assert.ok(node.pins.every(pin => pin.dataType !== 'asset'));
  const cache = new BlueprintViewCache({ assumeImmutable: true });
  const first = cache.update(project, graph, [], edit, collapsed, toggle);
  const changed = mutateProject(project, draft => { draft.assets.push({ id: 'new_picker_resource', kind: 'image', category: 'other', name: '新增素材', path: 'assets/new.png' }); });
  const second = cache.update(changed, changed.blueprints[0], [], edit, collapsed, toggle);
  assert.notEqual(second.find(item => item.node.id === node.id)!.data, first.find(item => item.node.id === node.id)!.data);
  assert.equal(second.find(item => item.node.id === node.id)!.data.project, changed);
  assert.equal(second[1].data, first[1].data, '独立计算节点不用随素材库重建');
});

test('resource, state, page and module selectors refresh without rebuilding unrelated calculation cards', () => {
  const { project, view, graph } = fixture();
  const asset = blueprintNodeDefaults('literal'); asset.pins[0].dataType = 'asset'; asset.properties.value = 'scene';
  const state = blueprintNodeDefaults('setVariable'); state.properties.variableId = 'score';
  const page = blueprintNodeDefaults('showUiPage'); page.properties.pageId = 'page';
  const callee = createBlueprintGraph('macro', '被调用的节点'), call = blueprintNodeDefaults('callMacro'); call.properties.graphId = callee.id;
  graph.nodes.push(asset, state, page, call);
  const mutations: { id: string; apply(draft: Project): void }[] = [
    { id: asset.id, apply: draft => { draft.assets.push({ id: 'scene', name: '庭院', kind: 'image', path: 'assets/scene.png', category: 'scene' }); } },
    { id: state.id, apply: draft => { draft.variables.push({ id: 'score', name: '得分', type: 'number', initial: 0, persistent: false }); } },
    { id: page.id, apply: draft => { draft.ui.customPages.push({ id: 'page', name: '说明', components: [], modal: true }); } },
    { id: call.id, apply: draft => { draft.blueprints.push(callee); } },
    { id: call.id, apply: draft => { draft.blueprints[1].nodes.push(blueprintNodeDefaults('showCharacter')); } },
  ];
  let current = project, before = view(current);
  for (const { id, apply } of mutations) {
    current = structuredClone(current); apply(current);
    const after = view(current), target = after.find(item => item.node.id === id)!;
    assert.notEqual(target.data, before.find(item => item.node.id === id)!.data); assert.equal(target.data.project, current);
    assert.equal(after[0].data, before[0].data); assert.equal(after[1].data, before[1].data); assert.equal(after[2].data, before[2].data);
    before = after;
  }
  current = structuredClone(current); current.blueprints[0].exposedInputs.push(blueprintPin('seconds', '等待时间', 'input', 'number', 1));
  assert.notEqual(view(current).find(item => item.node.id === call.id)!.data, before.find(item => item.node.id === call.id)!.data);
});

test('inferred asset categories refresh asset selectors, not unrelated numeric nodes', () => {
  const { project, view, graph } = fixture();
  project.assets.push({ id: 'track', name: 'track', kind: 'audio', path: 'assets/track.ogg' });
  const asset = blueprintNodeDefaults('literal'); asset.pins[0].dataType = 'asset'; asset.properties.value = 'track'; graph.nodes.push(asset);
  const before = view(project), current = structuredClone(project), music = blueprintNodeDefaults('playMusic');
  music.properties.assetId = 'track'; current.blueprints[0].nodes.push(music);
  const after = view(current);
  assert.notEqual(after.find(item => item.node.id === asset.id)!.data, before.find(item => item.node.id === asset.id)!.data);
  assert.equal(after[1].data, before[1].data);
});

test('immutable parameter edits reuse all unrelated cards and make no defensive project copies', () => {
  const { project, graph, edit, toggle, collapsed } = fixture(), cache = new BlueprintViewCache({ assumeImmutable: true });
  const first = cache.update(project, graph, [], edit, collapsed, toggle);
  const changed = mutateProject(project, draft => { draft.blueprints[0].nodes[1].properties.min = -2; });
  const second = cache.update(changed, changed.blueprints[0], [], edit, collapsed, toggle);
  assert.equal(second[0].data, first[0].data); assert.equal(second[2].data, first[2].data); assert.notEqual(second[1].data, first[1].data);
  assert.equal(cache.stats.rebuilt, 1); assert.equal(cache.stats.summaries, 1); assert.equal(cache.stats.defensiveCopies, 0);
  const moved = mutateProject(changed, draft => { draft.blueprints[0].nodes[1].x += 20; });
  const third = cache.update(moved, moved.blueprints[0], [], edit, collapsed, toggle);
  assert.ok(third.every((item, index) => item.data === second[index].data)); assert.equal(cache.stats.rebuilt, 0);
});

test('mutable authoring callers remain safe when values or resources change in place', () => {
  const { project, view, graph } = fixture(), first = view(project);
  graph.nodes[1].properties.min = -8;
  const second = view(project); assert.notEqual(second[1].data, first[1].data); assert.equal(second[1].data.node.properties.min, -8);
  const literal = blueprintNodeDefaults('literal'); literal.pins[0].dataType = 'asset'; literal.properties.value = 'asset'; graph.nodes.push(literal);
  project.assets.push({ id: 'asset', name: '旧资源名', kind: 'image', path: 'assets/old.png', category: 'scene' });
  const beforeRename = view(project); project.assets[0].name = '新资源名';
  const renamed = view(project); assert.notEqual(renamed.at(-1)!.data, beforeRename.at(-1)!.data);
});

test('module dependencies follow callees transitively and ignore an unrelated module body', () => {
  const { project, graph, edit, toggle, collapsed } = fixture();
  const child = createBlueprintGraph('macro', '子模块'), leaf = createBlueprintGraph('macro', '叶模块'), unrelated = createBlueprintGraph('macro', '无关模块');
  const call = blueprintNodeDefaults('callMacro'); call.properties.graphId = child.id; graph.nodes.push(call);
  const nested = blueprintNodeDefaults('callMacro'); nested.properties.graphId = leaf.id; child.nodes.push(nested);
  const value = blueprintNodeDefaults('literal'); value.properties.value = 'value'; leaf.nodes.push(value);
  unrelated.nodes.push(blueprintNodeDefaults('math')); project.blueprints.push(child, leaf, unrelated); synchronizeBlueprintSignatures(project);
  const cache = new BlueprintViewCache({ assumeImmutable: true }), read = (current: Project) => cache.update(current, current.blueprints[0], [], edit, collapsed, toggle);
  const first = read(project), changed = mutateProject(project, draft => { draft.blueprints[3].nodes[1].properties.a = 45; }), second = read(changed);
  assert.equal(second.at(-1)!.data, first.at(-1)!.data);
  const nestedChange = mutateProject(changed, draft => { draft.blueprints[2].nodes[1].properties.value = 'new'; });
  assert.notEqual(read(nestedChange).at(-1)!.data, second.at(-1)!.data);
  const move = mutateProject(nestedChange, draft => { draft.blueprints[2].nodes[1].x += 50; }), beforeMove = read(nestedChange);
  assert.equal(read(move).at(-1)!.data, beforeMove.at(-1)!.data);
});

test('a new editing callback and a different graph replace cached node context', () => {
  const { project, cache, edit, toggle, collapsed } = fixture();
  const first = cache.update(project, project.blueprints[0], [], edit, collapsed, toggle);
  const second = cache.update(project, project.blueprints[0], [], () => {}, collapsed, toggle);
  assert.notEqual(second[0].data, first[0].data);
  const other = createBlueprintGraph('function', '第二张图'); project.blueprints.push(other);
  assert.equal(cache.update(project, other, [], edit, collapsed, toggle)[0].data.graph.id, other.id);
});

test('unchanged wires retain their identity while selection and endpoint changes refresh affected edges', () => {
  const previous: StudioEdge[] = ['one', 'two'].map(id => ({ id, source: 'source', target: id, type: 'studio', selected: false, data: { label: id }, style: { strokeWidth: 2 } }));
  const copy = (): StudioEdge[] => previous.map(edge => ({ ...edge, data: { ...edge.data! }, style: { ...edge.style } }));
  assert.equal(reuseBlueprintEdges(previous, copy()), previous);
  const selected = copy(); selected[0].selected = true;
  const after = reuseBlueprintEdges(previous, selected);
  assert.notEqual(after[0], previous[0]); assert.equal(after[1], previous[1]);
  const reconnected = copy(); reconnected[1].target = 'new-target';
  assert.notEqual(reuseBlueprintEdges(previous, reconnected)[1], previous[1]);
  const renamed = copy(); renamed[0].data!.label = '改名';
  assert.notEqual(reuseBlueprintEdges(previous, renamed)[0], previous[0]);
});

test('marquee geometry includes partial overlaps and boundary contact', () => {
  assert.equal(rectanglesIntersect({ x: 0, y: 0, width: 20, height: 10 }, { x: 19, y: 9, width: 30, height: 30 }), true);
  assert.equal(rectanglesIntersect({ x: 0, y: 0, width: 20, height: 10 }, { x: 20, y: 10, width: 30, height: 30 }), true);
  assert.equal(rectanglesIntersect({ x: 0, y: 0, width: 20, height: 10 }, { x: 21, y: 11, width: 30, height: 30 }), false);
});

test('wire marquee catches a curve even when both endpoints are outside', () => {
  const curve = parseBezierPath('M-100,20 C-30,20 30,20 100,20')!;
  assert.equal(bezierIntersectsRect(curve, { x: -2, y: 16, width: 4, height: 8 }), true);
  assert.equal(bezierIntersectsRect([...curve].reverse() as unknown as Bezier, { x: -2, y: 16, width: 4, height: 8 }), true);
  assert.equal(bezierIntersectsRect(curve, { x: -2, y: 25, width: 4, height: 8 }), false);
});

test('curved wire selection excludes empty space inside its bounding box', () => {
  const curve = parseBezierPath('M0,0 C0,100 100,100 100,0')!;
  assert.equal(bezierIntersectsRect(curve, { x: 48, y: 0, width: 4, height: 10 }), false);
  assert.equal(bezierIntersectsRect(curve, { x: 49, y: 74, width: 2, height: 2 }), true);
  assert.equal(bezierIntersectsRect(curve, { x: 49, y: 90, width: 2, height: 2 }), false);
  for (const zoom of [0.18, 0.5, 1, 1.6]) {
    const scaled = curve.map(point => ({ x: point.x * zoom + 150, y: point.y * zoom - 50 })) as unknown as Bezier;
    assert.equal(bezierIntersectsRect(scaled, { x: 49 * zoom + 150, y: 74 * zoom - 50, width: 2 * zoom, height: 2 * zoom }, 0.5 * zoom), true);
  }
});

test('degenerate and looping curves remain selectable without bounding-box false positives', () => {
  assert.equal(bezierIntersectsRect(parseBezierPath('M1,1 C1,1 1,1 1,1')!, { x: 0, y: 0, width: 2, height: 2 }), true);
  assert.equal(bezierIntersectsRect(parseBezierPath('M0,0 C100,0 100,0 0,0')!, { x: 73, y: -1, width: 2, height: 2 }), true);
  assert.equal(parseBezierPath('M0,0 L100,100'), undefined);
  assert.equal(parseBezierPath('M0,NaN C1,1 2,2 3,3'), undefined);
});

test('advanced pin expansion replaces only its node view and dispatches the owning toggle callback', () => {
  const { project, graph, edit, toggle, collapsed } = fixture();
  const character = blueprintNodeDefaults('showCharacter'); graph.nodes.push(character);
  const beforeNode = structuredClone(character), expanded = new Set<string>(), toggled: string[] = [];
  const toggleAdvanced = (id: string) => { toggled.push(id); expanded.has(id) ? expanded.delete(id) : expanded.add(id); };
  const cache = new BlueprintViewCache({ assumeImmutable: true });
  const read = () => cache.update(project, graph, [], edit, collapsed, toggle, undefined, { expanded, toggle: toggleAdvanced });
  const first = read(), original = first.find(item => item.node.id === character.id)!.data;
  assert.equal(original.advancedExpanded, false); assert.ok(original.layout.hiddenInputs.length > 0);
  original.toggleAdvanced(); assert.deepEqual(toggled, [character.id]); assert.deepEqual([...expanded], [character.id]);
  const second = read(), opened = second.find(item => item.node.id === character.id)!.data;
  assert.notEqual(opened, original); assert.notEqual(opened.layout, original.layout); assert.equal(opened.advancedExpanded, true);
  assert.deepEqual(opened.layout.hiddenInputs, []); assert.deepEqual(opened.layout.visiblePinIds, character.pins.map(pin => pin.id));
  assert.notEqual(opened.layout.signature, original.layout.signature); assert.equal(opened.parametersCollapsed, original.parametersCollapsed);
  assert.equal(opened.cardSummary, original.cardSummary);
  assert.ok(second.filter(item => item.node.id !== character.id).every(item => item.data === first.find(before => before.node.id === item.node.id)!.data));
  assert.equal(cache.stats.rebuilt, 1); assert.equal(cache.stats.summaries, 0); assert.equal(cache.stats.defensiveCopies, 0);
  opened.toggleAdvanced(); assert.deepEqual(toggled, [character.id, character.id]); assert.equal(expanded.size, 0);
  const closed = read().find(item => item.node.id === character.id)!.data;
  assert.equal(closed.advancedExpanded, false); assert.deepEqual(closed.layout.hiddenInputs, original.layout.hiddenInputs);
  assert.equal(closed.layout.signature, original.layout.signature); assert.deepEqual(character, beforeNode);
  const replacementCalls: string[] = [];
  const replacement = cache.update(project, graph, [], edit, collapsed, toggle, undefined, { expanded, toggle: id => { replacementCalls.push(id); } }).find(item => item.node.id === character.id)!.data;
  assert.notEqual(replacement, closed); replacement.toggleAdvanced();
  assert.deepEqual(replacementCalls, [character.id]); assert.deepEqual(toggled, [character.id, character.id]);
});

test('a design getter property change refreshes downstream card prose even when the source pin label is unchanged', () => {
  const { project, graph, edit, toggle, collapsed } = fixture();
  project.ui.customPages.push({ id: 'page', name: '页面', modal: true, components: [{ id: 'button', name: '继续按钮', kind: 'button', page: 'custom', text: '继续', x: .1, y: .1, width: .2, height: .1 }] });
  const source = blueprintNodeDefaults('getUiDefault'); Object.assign(source.properties, { componentId: 'button', property: 'visible' });
  const target = blueprintNodeDefaults('branch'); target.properties.condition = false; graph.nodes.push(source, target);
  assert.equal(connectBlueprintPins(graph, source.id, 'value', target.id, 'condition'), undefined);
  const cache = new BlueprintViewCache({ assumeImmutable: true });
  const read = (current: Project) => cache.update(current, current.blueprints[0], [], edit, collapsed, toggle);
  const first = read(project), oldTarget = first.find(item => item.node.id === target.id)!.data;
  assert.match(oldTarget.cardSummary!, /来自：继续按钮 · 显示 · 设计默认值/);
  const changed = mutateProject(project, draft => { draft.blueprints[0].nodes.find(node => node.id === source.id)!.properties.property = 'enabled'; });
  const second = read(changed), newTarget = second.find(item => item.node.id === target.id)!.data;
  assert.equal(newTarget.inputSources.get('condition'), oldTarget.inputSources.get('condition'), 'the legacy pin source label does not include the design property');
  assert.notEqual(newTarget, oldTarget); assert.notEqual(newTarget.cardSummary, oldTarget.cardSummary);
  assert.match(newTarget.cardSummary!, /来自：继续按钮 · 启用 · 设计默认值/); assert.ok(!newTarget.cardSummary!.includes(' · 显示 · '));
  assert.equal(newTarget.node.properties.condition, false); assert.deepEqual(changed.blueprints[0].links, graph.links);
  assert.equal(source.properties.property, 'visible'); assert.equal(oldTarget.project, project); assert.equal(newTarget.project, changed);
  assert.equal(second[0].data, first[0].data); assert.equal(second[1].data, first[1].data); assert.equal(second[2].data, first[2].data);
  assert.equal(cache.stats.rebuilt, 2); assert.equal(cache.stats.defensiveCopies, 0);
  const moved = mutateProject(changed, draft => {
    draft.blueprints[0].nodes.find(node => node.id === source.id)!.x += 75;
    draft.blueprints[0].nodes.find(node => node.id === target.id)!.y += 50;
  });
  const third = read(moved);
  assert.ok(third.every((item, index) => item.data === second[index].data && item.data.layout === second[index].data.layout));
  assert.equal(third.find(item => item.node.id === source.id)!.node.x, source.x + 75);
  assert.equal(third.find(item => item.node.id === target.id)!.node.y, target.y + 50);
  assert.equal(cache.stats.rebuilt, 0); assert.equal(cache.stats.summaries, 0); assert.equal(cache.stats.defensiveCopies, 0);
});

test('a minigame getter key change refreshes linked card labels without displaying its saved default', () => {
  const { project, graph, edit, toggle, collapsed } = fixture();
  const source = blueprintNodeDefaults('getMinigameValue'); source.properties.defaultValue = 654321; graph.nodes.push(source);
  const target = graph.nodes[2]; target.properties.a = 987654;
  assert.equal(connectBlueprintPins(graph, source.id, 'value', target.id, 'a'), undefined);
  const cache = new BlueprintViewCache({ assumeImmutable: true });
  const read = (current: Project) => cache.update(current, current.blueprints[0], [], edit, collapsed, toggle);
  const first = read(project), oldTarget = first.find(item => item.node.id === target.id)!.data;
  assert.match(oldTarget.cardSummary!, /来自：小游戏值 · score/);
  const changed = mutateProject(project, draft => { draft.blueprints[0].nodes.find(node => node.id === source.id)!.properties.key = 'combo'; });
  const second = read(changed), newTarget = second.find(item => item.node.id === target.id)!.data;
  assert.equal(newTarget.inputSources.get('a'), oldTarget.inputSources.get('a'));
  assert.notEqual(newTarget, oldTarget); assert.match(newTarget.cardSummary!, /来自：小游戏值 · combo/);
  assert.ok(!newTarget.cardSummary!.includes('score')); assert.ok(!newTarget.cardSummary!.includes('654321')); assert.ok(!newTarget.cardSummary!.includes('987654'));
  assert.equal(newTarget.node.properties.a, 987654); assert.equal(source.properties.key, 'score');
  assert.equal(second[0].data, first[0].data); assert.equal(second[1].data, first[1].data);
  assert.equal(cache.stats.rebuilt, 2); assert.equal(cache.stats.defensiveCopies, 0);
});

test('renaming a literal reference resource refreshes its downstream prose through source dependencies', () => {
  const { project, graph, edit, toggle, collapsed } = fixture();
  project.assets.push({ id: 'portrait', name: '原立绘', kind: 'image', path: 'assets/portrait.png', category: 'portrait' });
  const source = blueprintNodeDefaults('literal'); source.properties.value = 'portrait'; source.pins[0].dataType = 'asset';
  const target = blueprintNodeDefaults('select'); target.properties.true_value = 'inactive_reference'; graph.nodes.push(source, target);
  assert.equal(connectBlueprintPins(graph, source.id, 'value', target.id, 'true_value'), undefined);
  const cache = new BlueprintViewCache({ assumeImmutable: true });
  const read = (current: Project) => cache.update(current, current.blueprints[0], [], edit, collapsed, toggle);
  const first = read(project), oldTarget = first.find(item => item.node.id === target.id)!.data;
  assert.match(oldTarget.cardSummary!, /来自：常量 · 原立绘/);
  const changed = mutateProject(project, draft => { draft.assets.find(asset => asset.id === 'portrait')!.name = '新立绘'; });
  const second = read(changed), newTarget = second.find(item => item.node.id === target.id)!.data;
  assert.equal(changed.blueprints[0].nodes.find(node => node.id === target.id), target, 'the target node itself has not changed');
  assert.notEqual(newTarget, oldTarget); assert.match(newTarget.cardSummary!, /来自：常量 · 新立绘/);
  assert.ok(!newTarget.cardSummary!.includes('原立绘')); assert.ok(!newTarget.cardSummary!.includes('inactive_reference'));
  assert.match(newTarget.inputSources.get('true_value')!, /新立绘/);
  assert.notEqual(second.find(item => item.node.id === source.id)!.data, first.find(item => item.node.id === source.id)!.data);
  assert.equal(project.assets[0].name, '原立绘'); assert.equal(source.properties.value, 'portrait'); assert.deepEqual(changed.blueprints[0].links, graph.links);
  assert.equal(second[0].data, first[0].data); assert.equal(second[1].data, first[1].data); assert.equal(second[2].data, first[2].data);
  assert.equal(cache.stats.rebuilt, 2); assert.equal(cache.stats.defensiveCopies, 0);
});

test('a page-owned start event refreshes its page name without needing a page data pin', () => {
  const { project, graph, edit, toggle, collapsed } = fixture();
  graph.uiPageId = 'page'; project.ui.customPages.push({ id: 'page', name: '原页面', components: [], modal: true });
  const event = graph.nodes[0]; assert.ok(event.pins.every(pin => pin.dataType === 'exec')); assert.ok(!event.pins.some(pin => pin.id === 'pageId'));
  const cache = new BlueprintViewCache({ assumeImmutable: true });
  const read = (current: Project) => cache.update(current, current.blueprints[0], [], edit, collapsed, toggle);
  const first = read(project); assert.equal(first[0].data.cardSummary, '原页面 · 页面显示时');
  const changed = mutateProject(project, draft => { draft.ui.customPages.find(page => page.id === 'page')!.name = '新页面'; });
  const second = read(changed);
  assert.equal(second[0].node, event); assert.notEqual(second[0].data, first[0].data); assert.equal(second[0].data.cardSummary, '新页面 · 页面显示时');
  assert.deepEqual(second[0].data.layout.visiblePinIds, first[0].data.layout.visiblePinIds);
  assert.equal(second[1].data, first[1].data); assert.equal(second[2].data, first[2].data);
  assert.equal(cache.stats.rebuilt, 1); assert.equal(cache.stats.defensiveCopies, 0);
  assert.equal(first[0].data.cardSummary, '原页面 · 页面显示时'); assert.equal(project.ui.customPages[0].name, '原页面');
});
