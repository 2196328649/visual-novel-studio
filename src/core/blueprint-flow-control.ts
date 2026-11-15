import type { BlueprintGraph, BlueprintNode } from './model';

/** Node-owned state has a call or a live-page owner, never a graph-global singleton. */
export const blueprintFlowControlCatalog = {
  doOnce: { name: '执行一次（Do Once）', category: '流程控制', hint: '首次尝试通过，之后走“已执行”；重置后可再次通过。页面实例作用域可防重复点击，本次调用作用域只在一次调用内共享。' },
  gate: { name: '门控（Gate）', category: '流程控制', hint: '尝试进入时，门打开才通过。打开、关闭、切换和重置入口只改变门状态，从“设置完成”继续，不会误执行通过出口。' },
} as const;
export type BlueprintFlowControlType = keyof typeof blueprintFlowControlCatalog;
export type BlueprintFlowControlScope = 'call' | 'page';
export type BlueprintFlowControlOutput = 'exec_out' | 'blocked' | 'updated';
export function isBlueprintFlowControl(type: string): type is BlueprintFlowControlType { return Object.hasOwn(blueprintFlowControlCatalog, type); }
export function blueprintFlowControlScope(node: Pick<BlueprintNode, 'properties'>): BlueprintFlowControlScope { return node.properties.scope === 'page' ? 'page' : 'call'; }
export function blueprintFlowControlPageId(graph: Pick<BlueprintGraph, 'uiPageId'>, node: Pick<BlueprintNode, 'properties'>): string { return String(node.properties.pageId ?? graph.uiPageId ?? ''); }
export function blueprintFlowControlInitial(node: Pick<BlueprintNode, 'type' | 'properties'>): boolean { return typeof node.properties.initiallyClosed === 'boolean' ? node.properties.initiallyClosed : node.type === 'gate'; }
export function blueprintFlowControlInputs(type: BlueprintFlowControlType): readonly string[] { return type === 'doOnce' ? ['exec_in', 'reset'] : ['exec_in', 'open', 'close', 'toggle', 'reset']; }

/** Pure transition shared by preview and path analysis. Undefined means an invalid entry. */
export function transitionBlueprintFlowControl(type: BlueprintFlowControlType, entry: string, state: boolean | undefined, initiallyClosed: boolean): { closed: boolean; output: BlueprintFlowControlOutput } | undefined {
  const closed = state ?? initiallyClosed;
  if (!blueprintFlowControlInputs(type).includes(entry)) return;
  if (entry === 'exec_in') return { closed: type === 'doOnce' ? true : closed, output: closed ? 'blocked' : 'exec_out' };
  if (entry === 'reset') return { closed: type === 'doOnce' ? false : initiallyClosed, output: 'updated' };
  return { closed: entry === 'open' ? false : entry === 'close' ? true : !closed, output: 'updated' };
}
