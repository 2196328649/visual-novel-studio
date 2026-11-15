import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueprintStateFixture } from '../scripts/lib/blueprint-state-fixture';
import { createProject, projectSchema, type BlueprintGraph, type BlueprintNode, type VariableValue } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintStateScope, blueprintStateVariable, blueprintVariableUsages, changeBlueprintVariable, createBlueprintVariable, removeBlueprintVariable, validBlueprintStateValue } from '../src/core/blueprint-state';
import { previewActionContext, expandPreviewActions } from '../src/core/preview-actions';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { uiPages, uiPageOpenProblem } from '../src/core/ui-pages';
import { uiPageComponents } from '../src/core/ui-logic';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { inspectBlueprintEncapsulation } from '../src/core/blueprint-encapsulation';
import { blueprintResourceEditedProject } from '../src/core/blueprint-resource-edit';
import { applyUiDraft } from '../src/core/ui-draft';
import { compileProject } from '../src/runtime/compiler';
import { removeCustomUiPage, uiPageUsages } from '../src/core/game-flow';
import { interleaveTimeline, timelineInterleaveDiagnostics } from '../src/core/timeline-interleave';
import { addProjectGraphs } from '../src/core/project-resources';
import type { Project } from '../src/core/model';

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const advance = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
function fixture() {
  const f = createBlueprintStateFixture(), before = JSON.stringify(f.project);
  const sample = (events: UiPreviewEvent[], pageId = f.root.id) => {
    const result = previewUiLogic(f.project, uiPageComponents(f.project, pageId), pageId, {}, events, { timed: true });
    assert.equal(JSON.stringify(f.project), before); return result;
  };
  return { ...f, sample };
}

test('state schemas are optional for legacy projects and preserve typed author definitions', () => {
  const legacy = projectSchema.parse(createProject());
  assert.equal(legacy.ui.pageVariables, undefined);
  assert.ok(legacy.blueprints.every(graph => graph.localVariables === undefined));
  const f = fixture(), restored = projectSchema.parse(JSON.parse(JSON.stringify(f.project)));
  assert.deepEqual(restored.ui.pageVariables, f.project.ui.pageVariables);
  assert.deepEqual(restored.blueprints.find(graph => graph.id === f.cache.id)!.localVariables, f.cache.localVariables);
  assert.deepEqual(validateBlueprints(restored).filter(issue => issue.severity === 'error'), []);
});

test('state names are local to their owner; definitions do not become project parameters', () => {
  const project = createProject(), a = createBlueprintGraph('function', 'A'), b = createBlueprintGraph('function', 'B'); project.blueprints.push(a, b);
  const before = structuredClone(project.variables);
  const x = createBlueprintVariable(project, { scope: 'call', graphId: a.id }, '计数', 'number', 0);
  const y = createBlueprintVariable(project, { scope: 'call', graphId: b.id }, '计数', 'number', 5);
  const page = createBlueprintVariable(project, { scope: 'page', pageId: 'ui:main' }, '计数', 'number', 3);
  assert.notEqual(x.id, y.id); assert.notEqual(x.id, page.id); assert.deepEqual(project.variables, before);
  assert.throws(() => createBlueprintVariable(project, { scope: 'call', graphId: a.id }, '计数', 'number', 4), /未使用/);
  assert.throws(() => createBlueprintVariable(project, { scope: 'page', pageId: 'missing' }, '值', 'number', 0), /页面已不存在/);
});

test('false, zero and empty text are real initial values, not missing defaults', () => {
  for (const [type, initial] of [['boolean', false], ['number', 0], ['string', '']] as const) {
    const project = createProject(), graph = createBlueprintGraph('function', '检查值'); project.blueprints.push(graph);
    const variable = createBlueprintVariable(project, { scope: 'call', graphId: graph.id }, '值', type, initial);
    project.variables.push({ id: 'output', name: '输出', type, initial: type === 'string' ? 'old' : type === 'boolean' ? true : 9, persistent: false });
    const read = blueprintNodeDefaults('getVariable'); read.properties = { scope: 'call', variableId: variable.id };
    const write = blueprintNodeDefaults('setVariable'); write.properties = { variableId: 'output', value: project.variables.at(-1)!.initial };
    graph.nodes.push(read, write); synchronizeBlueprintSignatures(project);
    assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', write.id, 'exec_in'), undefined);
    assert.equal(connectBlueprintPins(graph, read.id, 'value', write.id, 'value'), undefined);
    const context = previewActionContext(project); expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
    assert.equal(context.variables.output, initial); assert.equal(context.incomplete, false);
  }
  assert.equal(validBlueprintStateValue('number', false), false);
  assert.equal(validBlueprintStateValue('boolean', 1), false);
  assert.equal(validBlueprintStateValue('number', Infinity), false);
});

test('concurrent invocations of one module retain distinct author locals across waits', () => {
  const f = fixture();
  const during = f.sample([click('invoke_snapshot_a'), advance(.15), click('invoke_snapshot_b')]);
  assert.equal(during.variables.snapshot_b, 22); assert.equal(during.variables.snapshot_a, 0); assert.equal(during.stageWaiting, 1);
  const done = f.sample([click('invoke_snapshot_a'), advance(.15), click('invoke_snapshot_b'), advance(1)]);
  assert.equal(done.variables.snapshot_a, 11); assert.equal(done.variables.snapshot_b, 22); assert.equal(done.incomplete, false);
});

test('nested cached results are kept in caller locals, including a zero argument on a new invocation', () => {
  const f = fixture();
  const done = f.sample([click('invoke_cache_a'), advance(.1), click('invoke_cache_b'), advance(1)]);
  assert.equal(done.variables.cache_a, 11); assert.equal(done.variables.cache_b, 22);
  const call = f.callers.cache_b.nodes.find(node => node.type === 'callFunction')!; call.properties.arg_amount = 0;
  const context = previewActionContext(f.project); expandPreviewActions(f.project, [{ kind: 'blueprint', blueprintId: f.callers.cache_b.id }], context);
  assert.equal(context.variables.cache_b, 0); assert.equal(context.incomplete, false);
});

test('events share a page instance counter but never share their call-local counter', () => {
  const f = fixture(), result = f.sample([click('state_root_increment'), click('state_root_increment')]);
  assert.equal(result.variables.state_event_local, 1);
  assert.equal(result.variables.state_last_page, 2); assert.equal(result.variables.state_shared_read, 2);
  assert.equal(result.layers.find(layer => layer.pageId === f.root.id)!.variables[f.counterId], 2);
  assert.equal(result.incomplete, false);
});

test('built-in page templates use the same variable and dynamic-page-module interface', () => {
  const f = fixture(), result = f.sample([click('state_native_increment'), click('state_native_increment')], 'ui:preferences');
  assert.equal(result.variables.state_event_local, 1); assert.equal(result.variables.state_last_page, 102);
  assert.equal(result.variables.state_shared_read, 102); assert.equal(result.incomplete, false);
  assert.equal(result.layers.find(layer => layer.pageId === 'ui:preferences')!.variables[f.counterId], 102);
});

test('page close and reopen reset only that instance; parent state survives', () => {
  const f = fixture(), events = [click('state_root_increment'), click('state_open_child'), click('state_child_increment'), click(f.childA.components[1].id), click('state_open_child')];
  const result = f.sample(events);
  assert.equal(result.layers.find(layer => layer.pageId === f.root.id)!.variables[f.counterId], 1);
  assert.equal(result.layers.find(layer => layer.pageId === f.childA.id)!.variables[f.counterId], 10);
  assert.equal(result.variables.state_last_page, 11); assert.equal(result.incomplete, false);
});

test('unified page calls can open native menus, hide the parent, and return an explicit result', () => {
  const f = fixture();
  const menu = f.sample([click('state_root_increment'), click('state_open_native'), click('state_root_increment'), click('state_native_increment')]);
  assert.equal(menu.pageId, 'ui:preferences'); assert.equal(menu.layers.find(layer => layer.pageId === f.root.id)!.hidden, true);
  assert.equal(menu.layers.find(layer => layer.pageId === f.root.id)!.variables[f.counterId], 1);
  assert.equal(menu.variables.state_last_page, 101);
  const returned = f.sample([click('state_root_increment'), click('state_open_native'), click('state_native_increment'), click('state_native_close')]);
  assert.equal(returned.pageId, f.root.id); assert.equal(returned.variables.state_native_result, 'native-ok'); assert.equal(returned.variables.state_native_done, 1);
  assert.equal(returned.layers.find(layer => layer.pageId === f.root.id)!.variables[f.counterId], 1); assert.equal(returned.incomplete, false);
});

test('native-menu children have an independent counter and reopening the menu resets its state', () => {
  const f = fixture();
  const result = f.sample([click('state_open_native'), click('state_native_increment'), click('state_native_child'), click('state_child_increment'), click(f.childA.components[1].id), click('state_native_close'), click('state_open_native')]);
  assert.equal(result.pageId, 'ui:preferences'); assert.equal(result.layers.find(layer => layer.pageId === 'ui:preferences')!.variables[f.counterId], 100);
  assert.equal(result.variables.state_native_result, 'native-ok'); assert.equal(result.incomplete, false);
});

test('page state outside a live page is unavailable instead of silently writing global variables', () => {
  const f = fixture(), context = previewActionContext(f.project);
  expandPreviewActions(f.project, [{ kind: 'blueprint', blueprintId: f.readPage.id }], context);
  assert.equal(context.incomplete, true); assert.equal(context.variables[f.counterId], undefined);
});

test('type changes preserve explicit writes and stable wires for diagnosis; deletion preserves readers', () => {
  const f = fixture(), graph = f.cache, owner = { scope: 'call' as const, graphId: graph.id }, before = structuredClone(graph.links);
  const write = graph.nodes.find(node => node.type === 'setVariable' && node.properties.scope === 'call')!;
  assert.equal(blueprintVariableUsages(f.project, owner, 'captured').length, 2);
  changeBlueprintVariable(f.project, owner, { ...graph.localVariables![0], type: 'string', initial: '' }); synchronizeBlueprintSignatures(f.project);
  assert.deepEqual(graph.links, before); assert.equal(write.properties.value, 0); assert.ok(validateBlueprints(f.project).some(issue => issue.message.includes('类型') || issue.message.includes('文字')));
  removeBlueprintVariable(f.project, owner, 'captured'); synchronizeBlueprintSignatures(f.project);
  assert.deepEqual(graph.links, before); assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === write.id && issue.message.includes('已删除')));
});

test('page definition edits use one normal transaction and UI draft merging preserves unrelated changes', () => {
  const f = fixture(), before = f.project;
  const next = blueprintResourceEditedProject(before, draft => { createBlueprintVariable(draft, { scope: 'page', pageId: 'ui:preferences' }, '开关', 'boolean', false); });
  assert.equal(before.ui.pageVariables!['ui:preferences'].length, 1); assert.equal(next.ui.pageVariables!['ui:preferences'].length, 2);
  assert.equal(next.nodes, before.nodes); assert.equal(next.variables, before.variables);
  const concurrent = { ...before, name: '独立作品名' }, merged = applyUiDraft(concurrent, { base: before, value: next });
  assert.equal(merged.name, '独立作品名'); assert.equal(merged.ui.pageVariables!['ui:preferences'].length, 2);
});

test('legacy project-variable nodes retain persistent/player lifetime without a migration rewrite', () => {
  const project = createProject(); project.variables.push({ id: 'setting', name: '玩家选项', type: 'boolean', initial: false, persistent: true });
  const graph = createBlueprintGraph('function', '玩家设置'); project.blueprints.push(graph);
  const writer = blueprintNodeDefaults('setVariable'); writer.properties = { variableId: 'setting', value: true }; graph.nodes.push(writer);
  synchronizeBlueprintSignatures(project); connectBlueprintPins(graph, graph.nodes[0].id, 'exec', writer.id, 'exec_in');
  assert.equal(blueprintStateScope(project, writer), 'player'); assert.equal(writer.properties.scope, undefined);
  assert.equal(blueprintStateVariable(project, graph, writer)?.id, 'setting');
  const context = previewActionContext(project); expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
  assert.equal(context.variables.setting, true); assert.equal(project.variables.find(variable => variable.id === 'setting')!.initial, false);
});

test('encapsulation does not move a call-local writer into a different invocation', () => {
  const f = fixture(), writer = f.cache.nodes.find(node => node.type === 'setVariable' && node.properties.scope === 'call')!;
  const plan = inspectBlueprintEncapsulation(f.project, f.cache.id, [writer.id]);
  assert.equal(plan.ok, false); if (!plan.ok) assert.equal(plan.nodeId, writer.id);
});

test('one page catalog includes native and authored pages, while invalid host modes remain diagnosed', () => {
  const f = fixture(), pages = uiPages(f.project);
  assert.ok(pages.some(page => page.id === 'ui:main')); assert.ok(pages.some(page => page.id === f.root.id));
  assert.equal(uiPageOpenProblem(f.project, 'ui:preferences', true), undefined);
  assert.match(uiPageOpenProblem(f.project, 'ui:preferences', false)!, /菜单宿主/);
  assert.match(uiPageOpenProblem(f.project, 'ui:say', true)!, /台词/);
  f.project.ui.disabledPages = ['preferences']; assert.match(uiPageOpenProblem(f.project, 'ui:preferences', true)!, /停用/);
});

test('compiler emits state frames and a native adapter without adding a minigame definition', () => {
  const f = fixture(), before = JSON.stringify(f.project), result = compileProject(f.project);
  assert.deepEqual(result.diagnostics.filter(issue => issue.severity === 'error'), []);
  const story = result.files['game/story.rpy'];
  assert.ok(story.includes('vn_bp_state_set(')); assert.ok(story.includes('vn_ui_state_set(')); assert.match(story, /vn_bp_managed_menu_preferences/);
  assert.ok(story.includes('locals={}')); assert.ok(story.includes('vn_ui_state_prune()'));
  assert.ok(result.files['game/screens.rpy'].includes('for _vn_page_id in vn_ui_visible_page_order()'));
  assert.equal(f.project.minigames.length, 0); assert.equal(JSON.stringify(f.project), before);
});


test('deleting a page removes only its state definition and retains external references for repair', () => {
  const f = fixture(), before = structuredClone(f.project), usages = uiPageUsages(f.project, f.root.id);
  assert.ok(usages.some(usage => usage.graphId === f.readPage.id && usage.label.startsWith('页面状态')));
  removeCustomUiPage(f.project, f.root.id);
  assert.equal(f.project.ui.pageVariables?.[f.root.id], undefined);
  assert.deepEqual(f.project.ui.pageVariables?.['ui:preferences'], before.ui.pageVariables?.['ui:preferences']);
  assert.deepEqual(f.project.blueprints, before.blueprints);
  assert.ok(validateBlueprints(f.project).some(issue => issue.severity === 'error' && issue.nodeId === f.readPage.nodes.find(node => node.type === 'getVariable')!.id));
  assert.equal(projectSchema.safeParse(f.project).success, true);
  f.project.ui = before.ui;
  assert.deepEqual(validateBlueprints(f.project).filter(issue => issue.severity === 'error'), []);
});

function stateTimeline(project: Project, name: string) {
  const graph = createBlueprintGraph('effect', name), delay = blueprintNodeDefaults('delay'), stop = blueprintNodeDefaults('stopMusic'), tail = blueprintNodeDefaults('delay');
  delay.properties.seconds = .25; stop.properties.fade = .5; tail.properties.seconds = 0;
  graph.nodes.push(delay, stop, tail);
  graph.timeline = { tracks: [{ id: 'track', name: '演出' }], clips: [{ nodeId: stop.id, trackId: 'track' }], tailNodeId: tail.id };
  addProjectGraphs(project, graph);
  let previous = graph.nodes[0];
  for (const next of [delay, stop, tail]) { assert.equal(connectBlueprintPins(graph, previous.id, previous.type === 'event' ? 'exec' : 'exec_out', next.id, 'exec_in'), undefined); previous = next; }
  return { graph, stop };
}
function stateTimelineCaller(project: Project, target: BlueprintGraph) {
  const { graph, stop } = stateTimeline(project, '调用时间轴'), call = blueprintNodeDefaults('callFunction');
  call.properties = { graphId: target.id, wait: false }; graph.nodes.push(call); synchronizeBlueprintSignatures(project);
  const input = graph.links.find(link => link.toNodeId === stop.id)!; input.toNodeId = call.id;
  assert.equal(connectBlueprintPins(graph, call.id, 'exec_out', stop.id, 'exec_in'), undefined);
  return graph;
}

test('delayed timeline inlining rejects a child call-local reader instead of rehoming it', () => {
  const project = createProject(), { graph, stop } = stateTimeline(project, '局部时间轴');
  const variable = createBlueprintVariable(project, { scope: 'call', graphId: graph.id }, '淡出', 'number', .8);
  const read = blueprintNodeDefaults('getVariable'); read.properties = { scope: 'call', variableId: variable.id }; graph.nodes.push(read);
  synchronizeBlueprintSignatures(project); assert.equal(connectBlueprintPins(graph, read.id, 'value', stop.id, 'fade'), undefined);
  const caller = stateTimelineCaller(project, graph), before = structuredClone(project);
  const issues = timelineInterleaveDiagnostics(project);
  assert.ok(issues.some(issue => issue.nodeId === read.id && issue.message.includes('不能跨调用帧内联')));
  assert.equal(interleaveTimeline(project, caller), undefined); assert.deepEqual(project, before);
  caller.nodes.find(node => node.type === 'callFunction')!.properties.wait = true;
  assert.deepEqual(timelineInterleaveDiagnostics(project), []);
  assert.ok(compileProject(project).files['game/story.rpy'].includes('vn_bp_state_get(' + JSON.stringify(graph.id)));
});

test('inlined page-state readers preserve their declared page even when the caller owns another page', () => {
  const project = createProject(), { graph, stop } = stateTimeline(project, '页面时间轴'); graph.uiPageId = 'ui:preferences';
  const variable = createBlueprintVariable(project, { scope: 'page', pageId: graph.uiPageId }, '淡出', 'number', .8);
  const read = blueprintNodeDefaults('getVariable'); read.properties = { scope: 'page', variableId: variable.id }; graph.nodes.push(read);
  synchronizeBlueprintSignatures(project); assert.equal(connectBlueprintPins(graph, read.id, 'value', stop.id, 'fade'), undefined);
  const caller = stateTimelineCaller(project, graph); caller.uiPageId = 'ui:main'; delete read.properties.pageId;
  const before = structuredClone(project), result = interleaveTimeline(project, caller)!;
  assert.ok(result); assert.equal(result.nodes.find(node => node.type === 'getVariable')!.properties.pageId, 'ui:preferences'); assert.deepEqual(project, before);
});


test('wired page state targets diagnose missing and incompatible definitions without rewriting references', () => {
  const f = fixture(), graph = f.readPage;
  const read = graph.nodes.find(node => node.type === 'getVariable')!;
  graph.links = graph.links.filter(link => !(link.toNodeId === read.id && link.toPinId === 'pageId'));
  const page = blueprintNodeDefaults('literal'); page.properties.value = 'ui:preferences'; page.pins[0].dataType = 'ui'; page.pins[0].defaultValue = 'ui:preferences'; graph.nodes.push(page);
  synchronizeBlueprintSignatures(f.project);
  assert.equal(connectBlueprintPins(graph, page.id, 'value', read.id, 'pageId'), undefined);
  assert.deepEqual(validateBlueprints(f.project).filter(issue => issue.nodeId === read.id), []);
  const wires = structuredClone(graph.links), reference = structuredClone(read.properties);
  f.project.ui.pageVariables!['ui:preferences'] = [];
  assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === read.id && /目标页面.*未声明/.test(issue.message)));
  f.project.ui.pageVariables!['ui:preferences'] = [{ id: f.counterId, name: '异类型状态', type: 'boolean', initial: false }];
  assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === read.id && /目标页面.*类型/.test(issue.message)));
  assert.deepEqual(graph.links, wires); assert.deepEqual(read.properties, reference);
});

test('dynamic page state keeps caller-dependent targets unknown but enforces its declared type at runtime', () => {
  const f = fixture(), graph = f.readPage, read = graph.nodes.find(node => node.type === 'getVariable')!;
  const compiled = compileProject(f.project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  // The page parameter default is not a proof of which target an invocation uses.
  f.project.ui.pageVariables!['ui:preferences'] = [{ id: f.counterId, name: '异类型状态', type: 'boolean', initial: false }];
  assert.deepEqual(validateBlueprints(f.project).filter(issue => issue.nodeId === read.id), []);
  assert.ok(/vn_ui_state_get\([^\n]*"page_counter", "number"\)/.test(compiled.files['game/story.rpy']));
  assert.ok(/vn_ui_state_set\([^\n]*"page_counter", [^\n]*, "number"\)/.test(compiled.files['game/story.rpy']));
});


test('preview refuses a boolean from a dynamic number-state target instead of converting it', () => {
  const f = fixture(), context = previewActionContext(f.project), before = structuredClone(context.variables);
  let writes = 0;
  context.pageState = { get: () => false, set: () => { writes++; return true; } };
  expandPreviewActions(f.project, [{ kind: 'blueprint', blueprintId: f.readPage.id, inputs: { page: 'ui:preferences' } }], context);
  assert.equal(context.incomplete, true); assert.equal(writes, 0); assert.deepEqual(context.variables, before);
});

test('missing wired page arguments cannot read or write the declaration page or a project variable', () => {
  for (const mode of ['read', 'write'] as const) {
    const f = fixture(), graph = f.readPage; delete graph.exposedInputs[0].defaultValue;
    if (mode === 'write') {
      const source = graph.nodes.find(node => node.type === 'getInput')!, reader = graph.nodes.find(node => node.type === 'getVariable')!;
      const writer = blueprintNodeDefaults('setVariable'); writer.properties = { ...reader.properties, value: 7 }; graph.nodes.push(writer); synchronizeBlueprintSignatures(f.project);
      assert.equal(connectBlueprintPins(graph, source.id, 'value', writer.id, 'pageId'), undefined);
      assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', writer.id, 'exec_in'), undefined);
    }
    const context = previewActionContext(f.project), before = structuredClone(context.variables); let reads = 0, writes = 0;
    context.pageState = { get: () => { reads++; return 0; }, set: () => { writes++; return true; } };
    expandPreviewActions(f.project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
    assert.equal(context.incomplete, true); assert.equal(reads, 0); assert.equal(writes, 0); assert.deepEqual(context.variables, before);
  }
});
