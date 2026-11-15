import { createProject, type BlueprintGraph, type BlueprintNode, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { standardUiEventPages } from '../../src/core/ui-logic';
import { uiPageNames } from '../../src/core/ui-names';

export interface BlueprintContextMatrixCase {
  pageId: string; instanceId?: string; graph: BlueprintGraph; event: BlueprintNode; issue: BlueprintNode; call: BlueprintNode; button: UiComponent;
}
/** Every built-in page, base/parent/derived ownership, plus a scheme-independent
 * authored page. Missing-control nodes are intentional navigation diagnostics. */
export function createBlueprintContextMatrixFixture() {
  const project = createProject('蓝图跨入口全页面矩阵'); project.id = 'blueprint_context_matrix';
  const controls = (page: UiComponent['page']): UiComponent[] => [
    { id: 'context_' + page.toLowerCase() + '_button', name: page + ' 触发按钮', kind: 'button', page, text: '触发事件', x: .1, y: .1, width: .3, height: .1 },
    { id: 'context_' + page.toLowerCase() + '_text', name: page + ' 目标文字', kind: 'text', page, text: '说明文字', x: .1, y: .3, width: .7, height: .1 },
  ];
  project.ui.components = standardUiEventPages.flatMap(page => controls(page.id.slice(3) as UiComponent['page']));
  project.ui.instances = [{ id: 'context_owner', name: '原方案', components: structuredClone(project.ui.components) }, { id: 'context_derived', name: '派生方案', baseUiId: 'context_owner', components: [] }, { id: 'context_other', name: '无关当前方案', components: structuredClone(project.ui.components) }];
  project.ui.customPages = [{ id: 'context_custom', name: '新增页面', modal: true, components: controls('custom') }];
  const caller = createBlueprintGraph('function', '跨入口调用集合'); caller.id = 'context_caller'; caller.nodes[0].id = 'context_call_entry'; project.blueprints.push(caller);
  const cases: BlueprintContextMatrixCase[] = [];
  const add = (pageId: string, instanceId?: string) => {
    const page = pageId.startsWith('ui:') ? pageId.slice(3) as UiComponent['page'] : 'custom';
    const key = page.toLowerCase() + '_' + (instanceId ?? 'base'), name = uiPageNames[page] + ' · ' + (instanceId ?? 'base');
    const graph = createBlueprintGraph('ui', name + ' · 入口图'); graph.id = 'context_graph_' + key; graph.uiPageId = pageId;
    if (pageId.startsWith('ui:')) graph.uiInstanceId = instanceId ?? 'base';
    graph.nodes[0].id = 'context_show_' + key; graph.nodes[0].x = 0; graph.nodes[0].y = -260;
    const button = (page === 'custom' ? project.ui.customPages[0].components : project.ui.components).find(component => component.page === page && component.kind === 'button')!;
    const event = blueprintNodeDefaults('eventClick'); event.id = 'context_click_' + key; event.name = name + ' · 点击'; event.properties = { componentId: button.id, uiInstanceId: graph.uiInstanceId ?? '' }; event.x = 0; event.y = 40;
    const issue = blueprintNodeDefaults('setUiProperty'); issue.id = 'context_issue_' + key; issue.name = name + ' · 缺失控件'; issue.properties = { componentId: 'removed_' + key, property: 'text', value: '仍需修复的旧引用' }; issue.x = 460; issue.y = 40;
    graph.nodes.push(event, issue); graph.links.push({ id: 'context_wire_' + key, fromNodeId: event.id, fromPinId: 'exec', toNodeId: issue.id, toPinId: 'exec_in' });
    const call = blueprintNodeDefaults('callFunction'); call.id = 'context_call_' + key; call.name = name + ' · 调用入口'; call.properties = { graphId: graph.id }; call.x = (cases.length % 6) * 420; call.y = Math.floor(cases.length / 6) * 360;
    caller.nodes.push(call); project.blueprints.push(graph); cases.push({ pageId, instanceId, graph, event, issue, call, button });
  };
  for (const page of standardUiEventPages) for (const scope of [undefined, 'context_owner', 'context_derived']) add(page.id, scope);
  add('context_custom'); project.ui.activeInstanceId = 'context_other'; synchronizeBlueprintSignatures(project);
  return { project, cases, caller };
}
