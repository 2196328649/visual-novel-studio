import type { BlueprintFieldProps } from './BlueprintNodeFields';
import { blueprintFlowControlInitial, blueprintFlowControlScope } from '../core/blueprint-flow-control';

/** Used by both the node card and inspector, just like author-state fields. */
export function BlueprintFlowControlFields({ graph, node, edit }: BlueprintFieldProps) {
  const scope = blueprintFlowControlScope(node);
  return <>
    <label className="blueprint-inline-field"><span>记忆范围</span><select aria-label={node.name + ' · 状态作用域'} value={scope} onChange={event => edit(target => {
      target.properties.scope = event.target.value;
      if (event.target.value === 'page') target.properties.pageId = graph.uiPageId ?? '';
      else delete target.properties.pageId;
    })}><option value="call">本次调用</option><option value="page">页面实例</option></select></label>
    <label className="blueprint-inline-field"><span>{node.type === 'doOnce' ? '初始已执行' : '初始关闭'}</span><select aria-label={node.name + ' · 初始关闭'} value={String(blueprintFlowControlInitial(node))} onChange={event => edit(target => { target.properties.initiallyClosed = event.target.value === 'true'; })}><option value="false">否</option><option value="true">是</option></select></label>
    <small>{scope === 'page' ? '同一页面实例的事件和调用共享。离页清除，重开从初始值开始；存读档和回滚恢复当时状态。' : '每次调用独立；循环内共享，下一次调用重新开始。防重复点击请选择“页面实例”。'}</small>
  </>;
}
