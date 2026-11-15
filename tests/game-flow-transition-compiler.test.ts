import assert from 'node:assert/strict';
import test from 'node:test';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';
import { createCustomUiPage } from '../src/core/game-flow';
import { addGameFlowStep, connectGameFlowNodes, flowNodeIds, flowStepNodeId } from '../src/core/game-flow-graph';
import { gameFlowTransition, setGameFlowTransition } from '../src/core/game-flow-transitions';
import { createProject } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';
import { createGameFlowRuntime } from '../src/runtime/game-flow-runtime';

const dissolve = { mode: 'dissolve', duration: .8 } as const;

function labelBody(code: string, label: string): string {
  const start = code.indexOf('label ' + label);
  assert.notEqual(start, -1);
  const end = code.indexOf('\nlabel ', start + 1);
  return code.slice(start, end === -1 ? undefined : end);
}

test('空新游戏入口仅在有效连线有设置时执行，菜单画面在清理前捕获', () => {
  const project = createProject('入口过渡编译');
  const unchanged = structuredClone(project);
  const original = compileProject(project).files['game/story.rpy'];
  assert.doesNotMatch(labelBody(original, 'start:'), /call vn_game_flow_before_new_game/);
  setGameFlowTransition(project, flowNodeIds.newGame, dissolve);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const body = labelBody(compiled.files['game/story.rpy'], 'start:');
  assert.match(body, /label start:\n    \$ vn_flow_start_game\(\)\n    \$ vn_bp_async_clear/);
  assert.match(body, /call vn_game_flow_before_new_game/);
  assert.match(labelBody(compiled.files['game/01-vn-game-flow.rpy'], 'vn_game_flow_before_new_game'), /vn_game_flow_transition_queue\(.*"flow:newGame"\)/);
  connectGameFlowNodes(project, flowNodeIds.newGame, undefined);
  const disconnected = compileProject(project);
  assert.ok(disconnected.diagnostics.some(issue => issue.severity === 'error' && issue.code === 'gameFlow.connections' && issue.gameFlow?.phase === 'beforeNewGame'));
  assert.deepEqual(disconnected.files, {}, '未连到故事入口的流程不能编译为游戏');
  assert.deepEqual(gameFlowTransition(project, flowNodeIds.newGame), dissolve, '断线保留作者的过渡设置');
  assert.doesNotMatch(labelBody(createGameFlowRuntime(project), 'vn_game_flow_before_new_game'), /vn_game_flow_transition_queue\(/, '保留的断线设置不能产生可执行过渡');
  connectGameFlowNodes(project, flowNodeIds.newGame, flowNodeIds.story);
  setGameFlowTransition(project, flowNodeIds.newGame, undefined);
  const cleared = compileProject(project);
  assert.deepEqual(cleared.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.doesNotMatch(labelBody(cleared.files['game/story.rpy'], 'start:'), /call vn_game_flow_before_new_game/);
  assert.equal(unchanged.gameFlow, undefined);
});

test('步骤完成后才排来源过渡，取消返回标题不能走完成出口', () => {
  const project = createProject();
  const page = createCustomUiPage(project, '说明');
  const step = addGameFlowStep(project, 'beforeTitle', { id: 'explanation', kind: 'page', pageId: page.id, cancel: 'title' });
  setGameFlowTransition(project, flowStepNodeId(step.id), dissolve);
  const body = labelBody(createGameFlowRuntime(project), 'vn_game_flow_before_title');
  const call = body.indexOf('call vn_bp_page_');
  const cancel = body.indexOf('return "title"');
  const queue = body.indexOf('vn_game_flow_transition_queue(');
  assert.ok(call > 0 && cancel > call && queue > cancel);
  assert.match(body.slice(cancel, queue), /\$ vn_flow_end_step\(\)/);
  assert.doesNotMatch(body.slice(0, call), /vn_game_flow_transition_queue/);
});

test('透明嵌套函数和中间none保留最终显式设置所需的页面源', () => {
  const project = createProject();
  const page = createCustomUiPage(project, '原页面');
  const source = addGameFlowStep(project, 'beforeTitle', { id: 'source', kind: 'page', pageId: page.id });
  const inner = createBlueprintGraph('function', '赋值'); inner.id = 'inner';
  const outer = createBlueprintGraph('function', '调用'); outer.id = 'outer';
  const call = blueprintNodeDefaults('callFunction'); call.properties.graphId = inner.id; outer.nodes.push(call);
  project.blueprints.push(inner, outer);
  const none = addGameFlowStep(project, 'beforeTitle', { id: 'logical_none', kind: 'blueprint', graphId: outer.id });
  const last = addGameFlowStep(project, 'beforeTitle', { id: 'logical_last', kind: 'blueprint', graphId: inner.id });
  setGameFlowTransition(project, flowStepNodeId(none.id), { mode: 'none' });
  setGameFlowTransition(project, flowStepNodeId(last.id), dissolve);
  const runtime = createGameFlowRuntime(project);
  const body = labelBody(runtime, 'vn_game_flow_before_title');
  const begin = body.split('\n').find(line => line.includes(`vn_flow_begin_step("${source.id}"`))!;
  assert.match(begin, /"mode": "dissolve", "duration": 0.8/);
  assert.equal((body.match(/\$ vn_game_flow_transition_queue/g) ?? []).length, 2);
  const queue = runtime.split('    def vn_game_flow_transition_queue(')[1].split('\n    def ')[0];
  assert.doesNotMatch(queue, /vn_game_flow_transition_snapshot\s*=/, '中间直接切换不能丢失下一逻辑出口需要的真实源');
});

test('原生菜单保留SDK宿主参数且只显示一次，目标会话在过渡之后派发', () => {
  const project = createProject();
  setGameFlowTransition(project, flowNodeIds.launch, dissolve);
  const compiled = compileProject(project);
  const runtime = compiled.files['game/01-vn-game-flow.rpy'];
  const menu = labelBody(runtime, 'main_menu:');
  for (const key of ['_main_menu_screen', '_main_menu_screen_args', '_main_menu_screen_kwargs']) assert.ok(menu.includes(`renpy.session.pop("${key}"`));
  assert.equal((menu.match(/renpy.show_screen\(/g) ?? []).length, 1);
  assert.ok(menu.indexOf('renpy.show_screen(') < menu.indexOf('renpy.checkpoint('));
  assert.ok(menu.indexOf('renpy.checkpoint(') < menu.indexOf('vn_game_flow_transition_flush()'));
  assert.ok(menu.indexOf('vn_game_flow_transition_flush()') < menu.indexOf('ui.interact()'));
  assert.match(compiled.files['game/screens.rpy'], /if vn_ui_native_page_needs_show\("ui:main"\):\n        timer 0.001 action Function\(vn_ui_native_page_shown/);
  assert.match(runtime, /config\.underlay\.append\(VnGameFlowInputGuard\(\)\)/);
});

test('标题音乐在真实菜单呈现时接管，SDK进入开场之前不再预播', () => {
  const project = createProject();
  project.assets.push({ id: 'title_music', kind: 'audio', name: '标题音乐', path: 'assets\\title.ogg' });
  project.ui.menuMusicId = 'title_music'; project.ui.menuMusicFade = .6;
  const page = createCustomUiPage(project, '静音开场');
  addGameFlowStep(project, 'beforeTitle', { id: 'opening', kind: 'page', pageId: page.id });
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const options = compiled.files['game/options.rpy'];
  assert.match(options, /^define config\.main_menu_music = None$/m);
  assert.match(options, /^define vn_main_menu_music = "assets\/title\.ogg"$/m);
  assert.match(options, /^define vn_main_menu_music_fadein = 0\.6$/m);
  const runtime = compiled.files['game/01-vn-game-flow.rpy'];
  const before = labelBody(runtime, 'before_main_menu:');
  assert.ok(before.indexOf('if vn_flow_should_play():') < before.indexOf('renpy.music.stop('));
  assert.ok(before.indexOf('renpy.music.stop(') < before.indexOf('call vn_game_flow_before_title'));
  assert.doesNotMatch(labelBody(runtime, 'vn_game_flow_before_title'), /renpy\.music\.stop\(/, '开场的各步骤保留作者自己的连续音乐');
  const menu = labelBody(runtime, 'main_menu:');
  assert.ok(menu.indexOf('renpy.show_screen(') < menu.indexOf('renpy.music.play('));
  assert.ok(menu.indexOf('renpy.music.play(') < menu.indexOf('vn_game_flow_transition_flush()'));
  assert.match(menu, /if vn_main_menu_music:\n        \$ renpy\.music\.play\(vn_main_menu_music, channel="music", if_changed=True, fadein=vn_main_menu_music_fadein\)/);
  assert.match(menu, /else:\n        \$ renpy\.music\.stop\(channel="music", fadeout=0\)/, '无标题音乐时不继承开场背景音乐');
});

test('只有入口过渡或没有开场时不打断已有标题曲，未配置音乐保留明确空值', () => {
  const project = createProject();
  assert.doesNotMatch(labelBody(createGameFlowRuntime(project), 'before_main_menu:'), /renpy\.music\.stop\(/);
  setGameFlowTransition(project, flowNodeIds.launch, dissolve);
  assert.doesNotMatch(labelBody(createGameFlowRuntime(project), 'before_main_menu:'), /renpy\.music\.stop\(/);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.match(compiled.files['game/options.rpy'], /^define vn_main_menu_music = None$/m);
});
