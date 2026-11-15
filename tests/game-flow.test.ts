import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, effectiveUiComponents, type Project, type BlueprintGraph, type BlueprintNode, type VariableValue, type UiComponent } from '../src/core/model';
import { addGameFlowStep, connectPageToButton, connectPageToStory, createCustomUiPage, createPageCall, gameFlowSteps, uiPageUsages, gameFlowDiagnostics } from '../src/core/game-flow';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent, uiClickHandlers } from '../src/core/ui-logic';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';
import { mutateProject } from '../src/core/project-mutation';
import { applyUiDraft } from '../src/core/ui-draft';
import { projectToText, applyTextScript } from '../src/core/text-script';

function append(p: Project, graph: BlueprintGraph, previous: BlueprintNode, type: BlueprintNode['type'], properties: Record<string, VariableValue>) {
  const node = blueprintNodeDefaults(type); node.properties = properties; graph.nodes.push(node); synchronizeBlueprintSignatures(p);
  assert.equal(connectBlueprintPins(graph, previous.id, previous.type.startsWith('event') ? 'exec' : 'exec_out', node.id, 'exec_in'), undefined); return node;
}
function fixture() {
  const p = createProject(); p.ui.disabledPages = ['gallery'];
  p.variables.push({ id: 'order', name: '执行顺序', type: 'string', initial: '', persistent: false });
  const button: UiComponent = { id: 'launcher', page: 'main', kind: 'button', text: '进入', x: .1, y: .1, width: .3, height: .1 };
  p.ui.components.push(button);
  const page = createCustomUiPage(p, '说明页面');
  return { p, page, button };
}

test('new pages own only their internal events, while external calls expose result and reason', () => {
  const { p, page } = fixture(), events = p.blueprints.find(g => g.uiPageId === page.id)!;
  assert.equal(events.nodes.some(n => n.type === 'showUiPage'), false);
  assert.equal(events.nodes.filter(n => n.type === 'eventClick').length, 1);
  const call = createPageCall(p, page.id, true, false);
  assert.equal(call.uiPageId, undefined);
  assert.deepEqual(call.exposedOutputs.map(pin => pin.id), ['result', 'reason']);
  const serialized = projectSchema.parse(JSON.parse(JSON.stringify(p)));
  assert.equal(serialized.blueprints.find(g => g.id === events.id)?.uiPageId, page.id);
  assert.deepEqual(compileProject(serialized).diagnostics.filter(d => d.severity === 'error'), []);
});

test('adding a page before a button preserves one execution of every existing click binding', () => {
  const { p, page, button } = fixture();
  const old = createBlueprintGraph('function', '原主操作'); p.blueprints.push(old);
  append(p, old, old.nodes[0], 'setVariable', { variableId: 'order', value: 'primary' });
  Object.assign(button, { action: 'blueprint', blueprintId: old.id });
  const originalEvent = createBlueprintGraph('function', '原回调'); p.blueprints.push(originalEvent);
  append(p, originalEvent, originalEvent.nodes[0], 'setVariable', { variableId: 'order', value: 'callback' });
  Object.assign(button, { events: { onClick: originalEvent.id } });
  const connected = connectPageToButton(p, page.id, 'ui:main', button.id, 'append', true, false);
  assert.deepEqual(uiClickHandlers(p, 'ui:main', button.id).map(h => h.graphId), [connected.id, originalEvent.id, old.id]);
  let view = previewUiLogic(p, p.ui.components, 'ui:main', {}, [{ kind: 'click', componentId: button.id }], { timed: true });
  assert.equal(view.variables.order, ''); assert.equal(view.waitingPages.length, 1); assert.equal(view.layers.at(-1)?.modal, false);
  view = previewUiLogic(p, p.ui.components, 'ui:main', {}, [{ kind: 'click', componentId: button.id }, { kind: 'click', componentId: page.components[1].id }], { timed: true });
  assert.equal(view.variables.order, 'primary'); assert.deepEqual(view.waitingPages, []); assert.equal(view.incomplete, false);
  assert.throws(() => connectPageToButton(p, page.id, 'ui:main', button.id, 'append'), /已经接入/);
  const screens = compileProject(p).files['game/screens.rpy'];
  assert.ok(screens.indexOf(`Function(vn_run_blueprint, "${connected.id}"`) < screens.indexOf(`Function(vn_run_blueprint, "${originalEvent.id}"`));
});

test('replace mode suppresses both explicit click events and old callback without deleting reusable graphs', () => {
  const { p, page, button } = fixture();
  const old = createUiEventGraph(p, 'ui:main', '标题');
  append(p, old, ensureUiClickEvent(p, old, button.id, 'ui:main'), 'setVariable', { variableId: 'order', value: 'should not run' });
  const connected = connectPageToButton(p, page.id, 'ui:main', button.id, 'replace');
  assert.deepEqual(uiClickHandlers(p, 'ui:main', button.id).map(h => h.graphId), [connected.id]);
  const view = previewUiLogic(p, p.ui.components, 'ui:main', {}, [{ kind: 'click', componentId: button.id }, { kind: 'cancelPage', pageId: page.id }], { timed: true });
  assert.equal(view.variables.order, ''); assert.equal(view.incomplete, false);
  assert.ok(p.blueprints.some(g => g.id === old.id));
});

test('button connection edits the selected derived scheme and usage navigation retains its ownership', () => {
  const { p, page, button } = fixture();
  p.ui.instances = [{ id: 'child', name: '派生', baseUiId: 'base', components: [] }, { id: 'other', name: '其他', components: [] }];
  p.ui.activeInstanceId = 'other';
  const graph = connectPageToButton(p, page.id, 'ui:main', button.id, 'append', true, undefined, 'child');
  assert.equal(p.ui.activeInstanceId, 'other'); assert.equal(button.events, undefined);
  const target = effectiveUiComponents({ ...p.ui, activeInstanceId: 'child' }).find(c => c.id === button.id)!;
  assert.equal(target.events?.beforeClick, graph.id);
  assert.equal(uiPageUsages(p, page.id).find(use => use.componentId === button.id)?.instanceId, 'child');
  assert.throws(() => connectPageToButton(p, page.id, 'ui:main', button.id, 'append', true, undefined, 'child'), /已经接入/);
});

test('story and flow connections survive text synchronization, draft merge and page renaming with stable IDs', () => {
  const { p, page } = fixture(), passage = p.nodes.find(n => n.kind === 'passage')!;
  const edited = mutateProject(p, draft => {
    connectPageToStory(draft, page.id, passage.id, passage.lines[0].id);
    addGameFlowStep(draft, 'beforeTitle', { kind: 'page', pageId: page.id, completion: 'auto', duration: .2 });
    draft.ui.customPages[0].name = '新名称';
  });
  const concurrent = mutateProject(p, draft => { draft.version = '2.0.0'; });
  const merged = applyUiDraft(concurrent, { base: p, value: edited });
  assert.equal(merged.version, '2.0.0'); assert.equal(gameFlowSteps(merged, 'beforeTitle')[0].kind, 'page');
  const parsed = applyTextScript(merged, projectToText(merged));
  assert.deepEqual(parsed.issues, []); assert.equal(parsed.project.gameFlow?.beforeTitle.steps[0].id, merged.gameFlow?.beforeTitle.steps[0].id);
  assert.equal(uiPageUsages(parsed.project, page.id).filter(u => u.phase || u.storyNodeId).length, 2);
  assert.equal(p.gameFlow, undefined); assert.equal(p.ui.customPages[0].name, '说明页面');
  const compiled = compileProject(parsed.project, { preview: { flowStart: 'launch' } });
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.match(compiled.files['game/01-vn-game-flow.rpy'], /label before_main_menu:/);
  assert.match(compiled.files['game/01-vn-game-flow.rpy'], /vn_flow_preview = True/);
});

test('flow errors retain the exact phase and step for problem navigation', () => {
  const { p } = fixture();
  const step = addGameFlowStep(p, 'beforeNewGame', { kind: 'page', pageId: 'missing' });
  assert.equal(gameFlowDiagnostics(p)[0].gameFlow?.stepId, step.id);
  assert.equal(gameFlowDiagnostics(p)[0].gameFlow?.phase, 'beforeNewGame');
  const bad = createBlueprintGraph('function', '需要台词'); bad.nodes.push(blueprintNodeDefaults('startDialogue')); p.blueprints.push(bad);
  const call = addGameFlowStep(p, 'beforeTitle', { kind: 'blueprint', graphId: bad.id });
  assert.equal(gameFlowDiagnostics(p).some(d => d.message.includes('当前台词')), false, 'disconnected inventory is not an execution requirement');
  assert.equal(connectBlueprintPins(bad, bad.nodes[0].id, 'exec', bad.nodes[1].id, 'exec_in'), undefined);
  const issue = gameFlowDiagnostics(p).find(d => d.message.includes('当前台词'));
  assert.ok(issue); assert.equal(issue.nodeId, bad.nodes[1].id);
  assert.deepEqual(issue.gameFlow, { phase: 'beforeTitle', stepId: call.id });
});

test('new games reset nonpersistent values before setup without resetting player settings, including legacy projects', () => {
  const p = createProject();
  p.variables = [
    { id: 'score', name: '本局数值', type: 'number', initial: 7, persistent: false },
    { id: 'flag', name: '本局开关', type: 'boolean', initial: true, persistent: false },
    { id: 'name', name: '本局名字', type: 'string', initial: '旅人', persistent: false },
    { id: 'setting', name: '玩家设置', type: 'string', initial: '默认', persistent: true },
  ];
  for (const withFlow of [false, true]) {
    if (withFlow) {
      const graph = createBlueprintGraph('function', '新游戏设置'); p.blueprints.push(graph);
      addGameFlowStep(p, 'beforeNewGame', { kind: 'blueprint', graphId: graph.id });
    }
    const compiled = compileProject(p);
    assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
    const start = compiled.files['game/story.rpy'].split('label start:\n')[1].split('\n\n')[0];
    assert.match(start, /\$ vn_var_score = 7\n    \$ vn_var_flag = True\n    \$ vn_var_name = "旅人"/);
    assert.doesNotMatch(start, /persistent\.vn_var_setting/);
    if (withFlow) assert.ok(start.indexOf('$ vn_var_name') < start.indexOf('call vn_game_flow_before_new_game'));
    else assert.doesNotMatch(start, /call vn_game_flow_before_new_game/);
  }
});

test('preview variable overrides are applied after new-game reset and before setup graphs', () => {
  const p = createProject();
  p.variables = [
    { id: 'score', name: '分数', type: 'number', initial: 7, persistent: false },
    { id: 'setting', name: '玩家设置', type: 'string', initial: '默认', persistent: true },
  ];
  const graph = createBlueprintGraph('function', '开局'); p.blueprints.push(graph);
  addGameFlowStep(p, 'beforeNewGame', { kind: 'blueprint', graphId: graph.id });
  const compiled = compileProject(p, { preview: { variables: { score: 42, setting: '测试值' } } });
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  const start = compiled.files['game/story.rpy'].split('label start:\n')[1].split('\n\n')[0];
  assert.match(start, /\$ vn_var_score = 7\n    \$ vn_var_score = 42\n    \$ persistent.vn_var_setting = "测试值"\n    call vn_game_flow_before_new_game/);
  assert.match(compiled.files['game/options.rpy'], /_preview"/);
});

test('flow cancellation terminates system prompts without calling menu-only close or result actions', () => {
  const compiled = compileProject(createProject());
  const source = compiled.files['game/01-vn-game-flow.rpy'];
  assert.ok(source.includes('if record["page"] in vn_bp_page_menus:'));
  assert.ok(source.includes('native["closed"] = True\n                    vn_ui_interface_end(record, vn_ui_interface_completion(record["page"], "取消", "cancelled", record=record))'));
  assert.ok(source.indexOf('vn_flow_active_step["cancelled"] = True') < source.indexOf('if record["page"] in vn_bp_page_menus:'));
});
