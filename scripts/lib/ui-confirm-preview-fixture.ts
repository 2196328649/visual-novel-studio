import { createUiPagePreviewFixture } from './ui-page-preview-fixture';
import type { UiComponent } from '../../src/core/model';
export function createUiConfirmPreviewFixture() {
 const setup = createUiPagePreviewFixture(), { project, addGraph, add, link, chain, increment } = setup;
 project.name = '确认框与菜单预演验收';
 project.variables.push({ id: 'message', name: '提示内容', type: 'string', initial: '是否保留 [name] 与 {b} 标记？', persistent: false }, { id: 'menu_ticks', name: '菜单计时', type: 'number', initial: 0, persistent: false });
 const graph = addGraph('确认后分支'), prompt = add(graph, 'confirmMessage'), read = add(graph, 'getVariable', { variableId: 'message' });
 const yes = add(graph, 'setVariable', { variableId: 'result', value: '已确认' }), no = add(graph, 'setVariable', { variableId: 'result', value: '已取消' });
 chain(graph, graph.nodes[0], prompt); link(graph, read, 'value', prompt, 'message'); link(graph, prompt, 'yes', yes, 'exec_in'); link(graph, prompt, 'no', no, 'exec_in'); increment(graph, yes, 'after'); increment(graph, no, 'after');
 const nestedGraph = addGraph('二次确认'), nestedPrompt = add(nestedGraph, 'confirmMessage', { message: '内层确认' });
 chain(nestedGraph, nestedGraph.nodes[0], nestedPrompt);
 link(nestedGraph, nestedPrompt, 'yes', add(nestedGraph, 'setVariable', { variableId: 'nested', value: '内层确认完成' }), 'exec_in');
 link(nestedGraph, nestedPrompt, 'no', add(nestedGraph, 'setVariable', { variableId: 'nested', value: '内层已取消' }), 'exec_in');
 const menuGraph = addGraph('菜单关闭继续'), menu = add(menuGraph, 'uiAction', { screen: 'preferences' }); chain(menuGraph, menuGraph.nodes[0], menu); increment(menuGraph, menu, 'after');
 const button = (id: string, text: string, page: UiComponent['page'], action: UiComponent['action'], y: number, blueprintId?: string): UiComponent => ({ id, kind: 'button', page, text, action, blueprintId, x: .15, y, width: .35, height: .12, style: { fontSize: 32 } });
 project.ui.components = [button('ask', '询问确认', 'main', 'blueprint', .2, graph.id), button('open_menu', '蓝图打开设置', 'main', 'blueprint', .4, menuGraph.id), button('original_page', '打开自定义页', 'main', 'blueprint', .6, setup.opener.id),
  button('menu_return', '返回调用处', 'preferences', 'return', .75), button('voices', '角色音量', 'preferences', 'voiceSettings', .35), button('menu_ask', '菜单内确认', 'preferences', 'blueprint', .5, graph.id),
  button('save', '存档', 'preferences', 'save', .65), button('voices_return', '返回设置', 'voiceSettings', 'return', .7), button('save_return', '退出存档', 'save', 'return', .7),
  { id: 'volume', kind: 'preference', page: 'preferences', text: '音乐音量', preference: 'musicVolume', x: .1, y: .12, width: .8, height: .15 },
  button('yes', '保留', 'messageBox', 'confirmYes', .6), { ...button('no', '放弃', 'messageBox', 'confirmNo', .6), x: .55 },
  { id: 'prompt_text', kind: 'text', page: 'messageBox', text: '', binding: 'confirmation', x: .15, y: .2, width: .7, height: .3, style: { fontSize: 40, textColor: '#ffffff' } },
 ];
 project.ui.pages = { ...project.ui.pages, messageBox: { layout: 'custom', background: '#253544', backgroundOpacity: .85 }, preferences: { layout: 'custom', background: '#143529' }, voiceSettings: { layout: 'custom' }, save: { layout: 'custom' } };
 project.ui.customPages[0].components.push(button('page_menu', '页面内打开设置', 'custom', 'blueprint', .6, menuGraph.id));
 increment(setup.clocks, add(setup.clocks, 'eventTimer', { pageId: 'ui:preferences', interval: .5, repeat: true }), 'menu_ticks');
 return { ...setup, graph, prompt, nestedGraph, menuGraph, menu };
}
