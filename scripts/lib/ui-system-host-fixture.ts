import assert from 'node:assert/strict';
import { createProject, type BlueprintNode, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { authorReleasedRuntimeFixture, type ReleasedScheme } from './released-runtime-fixture';

/** Current page-state/interface coverage complements, rather than masquerades
 * as, historical save evidence. Every native host uses the same author nodes. */
export function createUiSystemHostFixture(scheme: ReleasedScheme, contextLayout: 'native' | 'custom') {
  const source = createProject('系统宿主、实例与持久化矩阵'); source.id = 'system_hosts_' + scheme + '_' + contextLayout;
  const f = authorReleasedRuntimeFixture(source, scheme), { project } = f;
  for (const theme of [project.ui, ...(project.ui.instances ?? [])]) {
    theme.pages = { ...theme.pages, messageBox: { ...theme.pages?.messageBox, layout: contextLayout }, chapterTitle: { ...theme.pages?.chapterTitle, layout: contextLayout } };
  }
  const keyboard: UiComponent = { id: 'system_native_keyboard', name: '固定虚拟键盘', page: 'keyboard', kind: 'keyboard', text: '', x: .03, y: .2, width: .55, height: .5, style: { fontSize: 18 } };
  project.ui.components.push(keyboard); project.ui.instances?.find(row => row.id === 'release_original')?.components.push(structuredClone(keyboard));
  project.ui.pageVariables = {}; project.ui.pageInterfaces = {};
  const pages = [...f.native.map(row => ({ ...row, pageId: 'ui:' + row.key })), ...f.custom.map(row => ({ ...row, pageId: row.key }))];
  for (const page of pages) {
    const key = page.key, pageId = page.pageId;
    project.variables.push({ id: 'system_created_' + key, name: '创建 ' + key, type: 'number', initial: 0, persistent: false }, { id: 'system_closed_' + key, name: '关闭 ' + key, type: 'number', initial: 0, persistent: false });
    project.ui.pageVariables[pageId] = [{ id: 'hits', name: '页面操作次数', type: 'number', initial: 0 }];
    project.ui.pageInterfaces[pageId] = { version: 1,
      inputs: [{ id: 'number', name: '数值输入', direction: 'input', dataType: 'number', required: false, defaultValue: 0 }, { id: 'flag', name: '开关输入', direction: 'input', dataType: 'boolean', required: false, defaultValue: false }],
      outputs: [{ id: 'result', name: '数值结果', direction: 'output', dataType: 'number', required: false, defaultValue: 0 }] };
    const graph = createBlueprintGraph('ui', '系统宿主事件 · ' + key); graph.id = 'system_graph_' + key; graph.uiPageId = pageId;
    if (pageId.startsWith('ui:')) graph.uiInstanceId = scheme === 'base' ? 'base' : 'release_original';
    project.blueprints.push(graph);
    const node = (type: BlueprintNode['type'], properties: BlueprintNode['properties']) => { const row = blueprintNodeDefaults(type, graph.nodes.length); row.id = graph.id + '_' + graph.nodes.length; Object.assign(row.properties, properties); graph.nodes.push(row); return row; };
    const wire = (from: BlueprintNode, to: BlueprintNode, fromPin = from.type.startsWith('event') ? 'exec' : 'exec_out', toPin = 'exec_in') => { synchronizeBlueprintSignatures(project); assert.equal(connectBlueprintPins(graph, from.id, fromPin, to.id, toPin), undefined); };
    const increment = (variableId: string, scope: 'page' | 'project') => {
      const properties = { variableId, scope, ...(scope === 'page' ? { pageId } : {}) };
      const read = node('getVariable', properties), add = node('math', { operation: 'add', b: 1 }), set = node('setVariable', properties);
      wire(read, add, 'value', 'a'); wire(add, set, 'result', 'value'); return set;
    };
    const created = node('eventPage', { pageId, phase: 'created' });
    const count = increment('system_created_' + key, 'project'), state = node('setVariable', { scope: 'page', pageId, variableId: 'hits', value: 7 });
    wire(created, count); wire(count, state);
    wire(node('eventPage', { pageId, phase: 'closed' }), increment('system_closed_' + key, 'project'));
    const clicked = node('eventClick', { componentId: page.touchId }), hit = increment('hits', 'page'); wire(clicked, hit);
    wire(hit, node('setPageOutput', { pageId, parameterId: 'result', value: 99 }));
  }
  synchronizeBlueprintSignatures(project);
  return { ...f, pages, contextLayout };
}
