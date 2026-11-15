import { createProject, newNode, type BlueprintGraph, type BlueprintNode, type CustomUiPage, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createCustomUiPage } from '../../src/core/game-flow';
import { setBlueprintPageOpening, uiPageOpeningPresets, type UiPageOpening } from '../../src/core/ui-page-opening';
import { ensureUiClickEvent } from '../../src/core/ui-logic';

/** Shared author data for button flow, preview, and real player acceptance. */
export function uiFlowOverlayFixture() {
  const project = createProject('页面流程与覆盖层验收'); project.id = 'ui_flow_overlay_acceptance';
  for (const id of ['under_clicks', 'hud_clicks', 'hud_shows', 'notice_shows', 'shown_returns', 'wait_returns', 'parent_returns', 'passive_keys', 'page_closed']) project.variables.push({ id, name: id, type: 'number', initial: 0, persistent: false });
  const node = (graph: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => {
    const result = blueprintNodeDefaults(type, graph.nodes.length); Object.assign(result.properties, properties); graph.nodes.push(result); return result;
  };
  const wire = (graph: BlueprintGraph, source: BlueprintNode, target: BlueprintNode, output = source.type.startsWith('event') ? 'exec' : 'exec_out', input = 'exec_in') => {
    synchronizeBlueprintSignatures(project);
    const error = connectBlueprintPins(graph, source.id, output, target.id, input); if (error) throw new Error(error);
  };
  const increment = (graph: BlueprintGraph, id: string) => {
    const read = node(graph, 'getVariable', { variableId: id }), math = node(graph, 'math', { b: 1 }), set = node(graph, 'setVariable', { variableId: id });
    wire(graph, read, math, 'value', 'a'); wire(graph, math, set, 'result', 'value'); return set;
  };
  const page = (name: string, opening?: UiPageOpening) => {
    const p = createCustomUiPage(project, name); p.opening = opening; p.components[0].y = .025; p.components[1].y = .85;
    return p;
  };
  const parent = page('调用者界面'); parent.background = '#123f67';
  const dialog = page('确认弹窗', { ...uiPageOpeningPresets.dialog.value });
  dialog.components[0].style = { background: '#633535', textColor: '#ffffff', align: 'center' };
  const hud = page('常驻信息层', { ...uiPageOpeningPresets.hud.value });
  hud.components[0].x = .62; hud.components[0].width = .36; hud.components[0].style = { background: '#4a5830', textColor: '#ffffff', align: 'center' };
  hud.components[1].x = .75; hud.components[1].y = .19; hud.components[1].width = .21; hud.components[1].text = '关闭信息层';
  const scene = page('本章节覆盖层', { ...uiPageOpeningPresets.hud.value, lifetime: 'scene' }); scene.components[0].y = .64;
  scene.components[1].x = .75; scene.components[1].y = .55; scene.components[1].width = .21;
  const notice = page('短时提示', { ...uiPageOpeningPresets.notice.value, autoClose: 1.2 });
  notice.components[0].text = '不接收输入的提示'; notice.components[0].y = .4;
  notice.components[1].x = .05; notice.components[1].y = .26; notice.components[1].width = .26;
  const owned = page('跟随打开者', { ...uiPageOpeningPresets.notice.value, autoClose: 0 });
  const graphs = { parent: project.blueprints.find(g => g.uiPageId === parent.id)!, dialog: project.blueprints.find(g => g.uiPageId === dialog.id)!, hud: project.blueprints.find(g => g.uiPageId === hud.id)!, notice: project.blueprints.find(g => g.uiPageId === notice.id)! };
  const addButton = (p: CustomUiPage, id: string, text: string, x: number, y: number) => {
    const component: UiComponent = { id, name: text, text, kind: 'button', page: 'custom', x, y, width: .26, height: .09 };
    p.components.push(component); return component;
  };
  const buttonEvent = (p: CustomUiPage, component: UiComponent) => {
    const graph = project.blueprints.find(g => g.uiPageId === p.id)!; return { graph, event: ensureUiClickEvent(project, graph, component.id, p.id) };
  };
  const counterButton = (p: CustomUiPage, id: string, text: string, x: number, y: number, variable: string) => {
    const component = addButton(p, id, text, x, y), { graph, event } = buttonEvent(p, component); wire(graph, event, increment(graph, variable)); return component;
  };
  const under = counterButton(parent, 'overlay_under_button', '底层计数', .05, .26, 'under_clicks');
  counterButton(hud, 'overlay_hud_button', '信息层计数', .7, .31, 'hud_clicks');
  const openButton = (id: string, text: string, p: CustomUiPage, x: number, y: number) => {
    const component = addButton(parent, id, text, x, y), { graph, event } = buttonEvent(parent, component), open = node(graph, 'showUiPage', { pageId: p.id });
    wire(graph, event, open); wire(graph, open, increment(graph, p.opening?.wait === false ? 'shown_returns' : 'wait_returns')); return { component, open };
  };
  const openHud = openButton('overlay_open_hud', '打开常驻层', hud, .05, .39);
  const openNotice = openButton('overlay_open_notice', '显示临时提示', notice, .05, .52);
  const openDialog = openButton('overlay_open_dialog', '打开确认弹窗', dialog, .35, .26);
  const openScene = openButton('overlay_open_scene', '显示章节层', scene, .35, .39);
  const openOwned = openButton('overlay_open_owned', '显示跟随层', owned, .35, .52);
  wire(graphs.hud, graphs.hud.nodes[0], increment(graphs.hud, 'hud_shows'));
  wire(graphs.notice, graphs.notice.nodes[0], increment(graphs.notice, 'notice_shows'));
  wire(graphs.notice, node(graphs.notice, 'eventKey', { pageId: notice.id, key: 'K_ESCAPE' }), increment(graphs.notice, 'passive_keys'));
  wire(graphs.notice, node(graphs.notice, 'eventPage', { pageId: notice.id, phase: 'closed' }), increment(graphs.notice, 'page_closed'));
  const wrapper = createBlueprintGraph('function', '进入覆盖层验收'); project.blueprints.push(wrapper);
  const show = node(wrapper, 'showUiPage', { pageId: parent.id }); wire(wrapper, wrapper.nodes[0], show); wire(wrapper, show, increment(wrapper, 'parent_returns'));
  const intro = project.nodes.find(n => n.kind === 'passage')!; if (intro.kind !== 'passage') throw new Error('Fixture needs passage'); intro.lines[0].text = '覆盖层验收开始。';
  const entry = newNode('passage', project.scenes[0].id); if (entry.kind !== 'passage') throw new Error('Fixture needs passage');
  entry.id = 'overlay_entry'; entry.name = '覆盖层调用位置'; entry.lines[0].text = '调用者已关闭。'; entry.lines[0].actions = [{ kind: 'blueprint', blueprintId: wrapper.id }]; entry.next = intro.id; project.nodes.push(entry);
  const nextScene = { id: 'overlay_second_scene', chapterId: project.chapters[0].id, name: '覆盖层第二章节' }; project.scenes.push(nextScene);
  const next = newNode('passage', nextScene.id); if (next.kind !== 'passage') throw new Error('Fixture needs passage'); next.id = 'overlay_second'; next.name = '第二章节内容'; next.lines[0].text = '已经进入第二章节。'; next.next = intro.id; project.nodes.push(next);
  const rollback = newNode('passage', project.scenes[0].id); if (rollback.kind !== 'passage') throw new Error('Fixture needs passage'); rollback.id = 'overlay_rollback'; rollback.next = intro.id;
  const rollbackCall = createBlueprintGraph('function', '可回滚常驻层'); project.blueprints.push(rollbackCall);
  wire(rollbackCall, rollbackCall.nodes[0], node(rollbackCall, 'showUiPage', { pageId: hud.id }));
  rollback.lines = [{ id: 'overlay_before_line', text: '回滚之前。', actions: [] }, { id: 'overlay_after_line', text: '回滚之后。', actions: [{ kind: 'blueprint', blueprintId: rollbackCall.id }] }]; project.nodes.push(rollback);
  project.ui.components.push({ id: 'overlay_title_button', kind: 'button', page: 'main', name: '自定义入口', text: '自定义入口', x: .58, y: .68, width: .3, height: .1, action: 'preferences' });
  synchronizeBlueprintSignatures(project);
  return { project, parent, dialog, hud, scene, notice, owned, graphs, openHud, openNotice, openDialog, openScene, openOwned, under, entry, intro, next, rollback, node, wire, increment, setOpening: setBlueprintPageOpening };
}
