import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createCustomUiPage } from '../../src/core/game-flow';

/** Authored menus, not test-only screen functions. Shared by preview and Ren'Py. */
export function createNativePageLifecycleFixture() {
  const project = createProject('内置页面生命周期验收');
  project.id = 'native_page_lifecycle';
  for (const id of ['preference_shows', 'gallery_shows', 'waiting', 'after_wait', 'external_after', 'saved_shows']) {
    project.variables.push({ id, name: id, type: 'number', initial: 0, persistent: false });
  }
  project.variables.push({ id: 'auto_wait', name: '显示时等待', type: 'boolean', initial: false, persistent: false });
  const graph = (name: string, pageId?: string) => {
    const result = createBlueprintGraph(pageId ? 'ui' : 'function', name);
    if (pageId) result.uiPageId = pageId;
    project.blueprints.push(result); return result;
  };
  const node = (g: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => {
    const result = blueprintNodeDefaults(type); Object.assign(result.properties, properties); g.nodes.push(result); return result;
  };
  const wire = (g: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = 'exec_out', input = 'exec_in') => {
    synchronizeBlueprintSignatures(project);
    assert.equal(connectBlueprintPins(g, from.id, from.type.startsWith('event') && output === 'exec_out' ? 'exec' : output, to.id, input), undefined);
  };
  const chain = (g: BlueprintGraph, ...nodes: BlueprintNode[]) => nodes.slice(1).forEach((n, i) => wire(g, nodes[i], n));
  const mark = (g: BlueprintGraph, id: string, value: number | boolean) => node(g, 'setVariable', { variableId: id, value });
  const increment = (g: BlueprintGraph, id: string) => {
    const read = node(g, 'getVariable', { variableId: id }), add = node(g, 'math', { b: 1 }), write = mark(g, id, 0);
    wire(g, read, add, 'value', 'a'); wire(g, add, write, 'result', 'value'); return write;
  };
  for (const [pageId, variable] of [['ui:preferences', 'preference_shows'], ['ui:gallery', 'gallery_shows']]) {
    const g = graph(pageId.slice(3) + ' 显示', pageId), read = node(g, 'getVariable', { variableId: variable }), add = node(g, 'math', { b: 1 }), write = mark(g, variable, 0);
    wire(g, read, add, 'value', 'a'); wire(g, add, write, 'result', 'value'); chain(g, g.nodes[0], write);
    if (pageId === 'ui:preferences') {
      const flag = node(g, 'getVariable', { variableId: 'auto_wait' }), branch = node(g, 'branch'), reset = mark(g, 'auto_wait', false);
      wire(g, flag, branch, 'value', 'condition'); wire(g, write, branch); wire(g, branch, reset, 'true');
      chain(g, reset, increment(g, 'waiting'), node(g, 'delay', { seconds: 2 }), mark(g, 'after_wait', 1));
    }
  }
  const animate = graph('设置页非等待动画');
  chain(animate, animate.nodes[0], node(animate, 'animateUiProperty', { componentId: 'native_target', property: 'opacity', value: .1, duration: 8, wait: false }));
  const delayed = graph('设置页等待任务');
  chain(delayed, delayed.nodes[0], increment(delayed, 'waiting'), node(delayed, 'delay', { seconds: 2 }), mark(delayed, 'after_wait', 1));
  const child = createCustomUiPage(project, '设置页的子界面'); child.modal = false;
  const openChild = graph('从设置打开子页');
  chain(openChild, openChild.nodes[0], node(openChild, 'showUiPage', { pageId: child.id, wait: false }));
  const external = graph('外部等待设置菜单');
  chain(external, external.nodes[0], node(external, 'uiAction', { screen: 'preferences' }), increment(external, 'external_after'));
  const button = (id: string, page: UiComponent['page'], text: string, y: number, action: UiComponent['action'], blueprintId?: string): UiComponent =>
    ({ id, page, kind: 'button', text, x: .6, y, width: .33, height: .075, layer: 30, action, blueprintId });
  project.ui.components.push(
    button('native_open_preferences', 'say', '打开设置菜单', .05, 'preferences'),
    { id: 'native_target', page: 'preferences', kind: 'text', text: '页面实例测试', x: .6, y: .11, width: .33, height: .07, style: { opacity: 1 }, layer: 30 },
    button('native_animate', 'preferences', '开始页面动画', .23, 'blueprint', animate.id),
    button('native_delay', 'preferences', '开始等待任务', .34, 'blueprint', delayed.id),
    button('native_child', 'preferences', '打开子页面', .45, 'blueprint', openChild.id),
    button('native_gallery', 'preferences', '切换到画廊', .56, 'gallery'),
    button('native_return', 'preferences', '关闭设置菜单', .67, 'return'),
    button('native_back', 'gallery', '重新打开设置', .4, 'preferences'),
    button('native_external', 'main', '等待设置菜单返回', .78, 'blueprint', external.id),
  );
  const prepareShow = graph('打开时启用显示等待');
  chain(prepareShow, prepareShow.nodes[0], mark(prepareShow, 'auto_wait', true));
  const showWaitButton = button('native_show_wait', 'say', '打开时等待', .15, 'preferences');
  showWaitButton.events = { beforeClick: prepareShow.id }; project.ui.components.push(showWaitButton);
  const passage = project.nodes.find(n => n.kind === 'passage')!;
  assert.equal(passage.kind, 'passage'); passage.lines[0].text = '内置页面生命周期测试剧情。';
  passage.lines.push({ ...structuredClone(passage.lines[0]), id: 'native_rollback_line', text: '第二句用于验证内置页面回滚。' });
  synchronizeBlueprintSignatures(project);
  return { project, child, animate, delayed, external, graph, node, wire, chain };
}
