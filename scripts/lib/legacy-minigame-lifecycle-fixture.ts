import assert from 'node:assert/strict';
import { createProject, newNode, type BlueprintGraph, type BlueprintNode, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createCustomUiPage } from '../../src/core/game-flow';

/** The legacy story minigame host, with ordinary authored page events and children. */
export function createLegacyMinigameLifecycleFixture() {
  const project = createProject('旧小游戏页面生命周期验收');
  project.id = 'legacy_minigame_lifecycle';
  for (const id of ['mini_shows', 'mini_ticks', 'waiting', 'after_wait', 'after_child', 'child_shows', 'saved_shows', 'saved_token', 'saved_ticks', 'script_runs']) {
    project.variables.push({ id, name: id, type: 'number', initial: 0, persistent: false });
  }
  project.variables.push({ id: 'input_value', name: '本页输入', type: 'string', initial: '初始', persistent: false });
  const graph = (name: string, pageId?: string) => {
    const g = createBlueprintGraph(pageId ? 'ui' : 'function', name);
    if (pageId) g.uiPageId = pageId;
    project.blueprints.push(g); return g;
  };
  const node = (g: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => {
    const n = blueprintNodeDefaults(type); Object.assign(n.properties, properties); g.nodes.push(n); return n;
  };
  const wire = (g: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = 'exec_out', input = 'exec_in') => {
    synchronizeBlueprintSignatures(project);
    assert.equal(connectBlueprintPins(g, from.id, from.type.startsWith('event') && output === 'exec_out' ? 'exec' : output, to.id, input), undefined);
  };
  const chain = (g: BlueprintGraph, ...nodes: BlueprintNode[]) => nodes.slice(1).forEach((n, i) => wire(g, nodes[i], n));
  const mark = (g: BlueprintGraph, id: string, value: number) => node(g, 'setVariable', { variableId: id, value });
  const increment = (g: BlueprintGraph, id: string) => {
    const read = node(g, 'getVariable', { variableId: id }), add = node(g, 'math', { b: 1 }), write = mark(g, id, 0);
    wire(g, read, add, 'value', 'a'); wire(g, add, write, 'result', 'value'); return write;
  };
  const button = (id: string, text: string, x: number, y: number, action: UiComponent['action'], blueprintId?: string): UiComponent =>
    ({ id, page: 'custom', kind: 'button', text, x, y, width: .32, height: .08, layer: 30, action, blueprintId });
  const mini = createCustomUiPage(project, '旧小游戏');
  const show = project.blueprints.find(g => g.uiPageId === mini.id)!;
  show.nodes = show.nodes.filter(n => n.type === 'event'); show.links = [];
  chain(show, show.nodes[0], increment(show, 'mini_shows'));
  const timer = node(show, 'eventTimer', { pageId: mini.id, interval: .1, repeat: true });
  chain(show, timer, increment(show, 'mini_ticks'));
  const initialize = graph('旧小游戏初始化'); initialize.kind = 'minigame';
  chain(initialize, initialize.nodes[0], node(initialize, 'setMinigameValue', { key: 'score', value: 7 }));
  const child = createCustomUiPage(project, '小游戏的非模态子页'); child.modal = false; child.background = '#18282c';
  child.components[0].x = .02; child.components[0].y = .12; child.components[0].width = .33;
  child.components[0].style = { fontSize: 20, align: 'center' };
  child.components[1].x = .02; child.components[1].y = .76; child.components[1].width = .32;
  const childShow = project.blueprints.find(g => g.uiPageId === child.id)!;
  chain(childShow, childShow.nodes[0], increment(childShow, 'child_shows'));
  const grandchild = createCustomUiPage(project, '小游戏的模态孙页');
  const nested = graph('等待孙页关闭');
  chain(nested, nested.nodes[0], node(nested, 'showUiPage', { pageId: grandchild.id, wait: true }), mark(nested, 'after_child', 1));
  child.components.push(button('mini_grandchild', '打开模态孙页', .02, .62, 'blueprint', nested.id));
  const independent = createCustomUiPage(project, '不属于小游戏的页面'); independent.modal = false; independent.background = '#18282c';
  independent.components[0].x = .02; independent.components[0].y = .86; independent.components[0].width = .35;
  independent.components[0].style = { fontSize: 16, align: 'center' };
  independent.components.push({ id: 'hidden_input', page: 'custom', kind: 'preference', parameterId: 'input_value', text: '独立页输入', x: .02, y: .88, width: .32, height: .1, layer: 30 });
  independent.components[1].x = .7; independent.components[1].y = .88; independent.components[1].height = .06;
  const animate = graph('小游戏非等待动画');
  chain(animate, animate.nodes[0], node(animate, 'animateUiProperty', { componentId: 'mini_target', property: 'opacity', value: .1, duration: 8, wait: false }));
  const delayed = graph('小游戏等待任务');
  chain(delayed, delayed.nodes[0], increment(delayed, 'waiting'), node(delayed, 'delay', { seconds: 2 }), mark(delayed, 'after_wait', 1));
  const openChild = graph('小游戏打开子页');
  chain(openChild, openChild.nodes[0], node(openChild, 'showUiPage', { pageId: child.id, wait: false }));
  const score = graph('修改本局小游戏值');
  chain(score, score.nodes[0], node(score, 'setMinigameValue', { key: 'score', value: 41 }));
  mini.components = [
    { id: 'mini_input', page: 'custom', kind: 'preference', parameterId: 'input_value', text: '小游戏输入', x: .02, y: .31, width: .32, height: .14, layer: 30 },
    { id: 'mini_target', page: 'custom', kind: 'text', text: '旧小游戏生命周期', x: .55, y: .08, width: .4, height: .1, layer: 30, style: { opacity: 1 } },
    button('mini_animate', '开始动画', .6, .23, 'blueprint', animate.id),
    button('mini_wait', '开始等待', .6, .34, 'blueprint', delayed.id),
    button('mini_child', '打开子页面', .6, .45, 'blueprint', openChild.id),
    button('mini_score', '修改本局分数', .6, .56, 'blueprint', score.id),
    button('mini_success', '完成小游戏', .6, .67, 'minigameSuccess'),
    button('mini_failure', '失败小游戏', .6, .78, 'minigameFailure'),
  ];
  project.minigames.push({ id: 'legacy_mini', name: '旧小游戏实例', mode: 'blueprint', blueprintId: initialize.id, uiPageId: mini.id });
  const intro = project.nodes.find(n => n.kind === 'passage')!; assert.equal(intro.kind, 'passage');
  intro.lines[0].text = '小游戏开始前。';
  const gameNode = newNode('minigame', project.scenes[0].id); assert.equal(gameNode.kind, 'minigame');
  const result = newNode('passage', project.scenes[0].id); assert.equal(result.kind, 'passage');
  result.lines[0].text = '小游戏已返回剧情。';
  Object.assign(gameNode, { id: 'legacy_lifecycle_node', template: 'custom', minigameId: 'legacy_mini', success: result.id, failure: result.id, cancel: result.id });
  intro.next = gameNode.id; result.next = gameNode.id;
  const password = newNode('minigame', project.scenes[0].id); assert.equal(password.kind, 'minigame');
  Object.assign(password, { id: 'legacy_password_node', template: 'password', password: 'pass', attempts: 2, success: result.id, failure: result.id, cancel: result.id });
  const timed = newNode('minigame', project.scenes[0].id); assert.equal(timed.kind, 'minigame');
  Object.assign(timed, { id: 'legacy_timed_node', template: 'timedClicks', targetClicks: 2, timeLimit: 5, success: result.id, failure: result.id, cancel: result.id });
  const scriptNode = newNode('minigame', project.scenes[0].id); assert.equal(scriptNode.kind, 'minigame');
  Object.assign(scriptNode, { id: 'legacy_script_node', template: 'custom', minigameId: 'legacy_script', success: result.id, failure: result.id, cancel: result.id });
  project.assets.push({ id: 'legacy_script_asset', name: '旧小游戏外接脚本', kind: 'script', path: 'scripts/legacy_lifecycle.rpy' });
  project.minigames.push({ id: 'legacy_script', name: '外接脚本小游戏', mode: 'script', script: { assetId: 'legacy_script_asset', entry: 'legacy_lifecycle_script', args: {} }, uiPageId: mini.id });
  const initialChild = graph('小游戏初始化时打开子页'); initialChild.kind = 'minigame';
  chain(initialChild, initialChild.nodes[0], node(initialChild, 'showUiPage', { pageId: child.id, wait: false }));
  const initialNode = newNode('minigame', project.scenes[0].id); assert.equal(initialNode.kind, 'minigame');
  Object.assign(initialNode, { id: 'legacy_initial_child_node', template: 'custom', minigameId: 'legacy_initial_child', success: result.id, failure: result.id, cancel: result.id });
  project.minigames.push({ id: 'legacy_initial_child', name: '初始化拥有子页', mode: 'blueprint', blueprintId: initialChild.id, uiPageId: mini.id });
  project.nodes.push(gameNode, result, password, timed, scriptNode, initialNode);
  synchronizeBlueprintSignatures(project);
  const scriptSource = [
    'label legacy_lifecycle_script:',
    '    $ vn_parameter_set("script_runs", vn_parameter_get("script_runs") + 1)',
    '    $ vn_minigame_set("score", 17)',
    '    call vn_minigame_interact',
    '    return _return',
    '',
  ].join('\n');
  return { project, mini, child, grandchild, independent, gameNode, result, password, timed, scriptNode, initialNode, scriptSource, show, timer, graph, node, chain, wire };
}
