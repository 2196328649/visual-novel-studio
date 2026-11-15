import type { BlueprintGraph, BlueprintNode, Project } from '../core/model';
import { blueprintStatePageId, blueprintStateScope, blueprintStateScopes, blueprintStateVariable, blueprintStateVariables, type BlueprintStateScope } from '../core/blueprint-state';
import { uiPages, uiPage } from '../core/ui-pages';

/** The node card and inspector use the exact same scope/variable selectors. */
export function BlueprintStateFields({ project, graph, node, edit }: {
  project: Project; graph: BlueprintGraph; node: BlueprintNode; edit: (edit: (node: BlueprintNode) => void) => void;
}) {
  const scope = blueprintStateScope(project, node), pageId = blueprintStatePageId(graph, node);
  const variables = blueprintStateVariables(project, graph, scope, pageId), selected = blueprintStateVariable(project, graph, node);
  return <>
    <label className="blueprint-inline-field"><span>状态作用域</span><select aria-label={node.name + ' · 状态作用域'} value={scope} onChange={event => edit(target => {
      const scope = event.target.value as BlueprintStateScope;
      target.properties.scope = scope;
      if (scope === 'page') target.properties.pageId = graph.uiPageId ?? uiPages(project).find(page => !page.disabled)?.id ?? '';
      else delete target.properties.pageId;
      const variable = blueprintStateVariables(project, graph, scope, String(target.properties.pageId ?? ''))[0];
      target.properties.variableId = variable?.id ?? '';
      if (target.type === 'setVariable') target.properties.value = variable?.initial ?? 0;
    })}>{Object.entries(blueprintStateScopes).map(([id, info]) => <option key={id} value={id}>{info.name}</option>)}</select></label>
    <label className="blueprint-inline-field"><span>{blueprintStateScopes[scope].name}变量</span><select aria-label={node.name + ' · 状态变量'} value={String(node.properties.variableId ?? '')} onChange={event => edit(target => {
      const variable = variables.find(variable => variable.id === event.target.value);
      target.properties.variableId = event.target.value;
      if (target.type === 'setVariable') target.properties.value = variable?.initial ?? 0;
    })}><option value="">选择变量</option>{!selected && !!node.properties.variableId && <option value={String(node.properties.variableId)}>缺失变量 · {String(node.properties.variableId)}</option>}{variables.map(variable => <option key={variable.id} value={variable.id}>{variable.name}</option>)}</select></label>
    {scope === 'page' && <small>变量定义：{uiPage(project, pageId)?.name ?? '请先选择页面'}。页面输入若接线，实际目标仍须声明同一变量。</small>}
    {!variables.length && <small>在“状态”面板中新建{blueprintStateScopes[scope].name}变量。</small>}
  </>;
}
