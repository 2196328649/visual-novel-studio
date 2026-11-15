import { useState } from 'react';
import type { BlueprintFieldProps } from './BlueprintNodeFields';
import type { BlueprintNode } from '../core/model';
import { uiPages, uiPage } from '../core/ui-pages';
import { uiPageInterface, uiPageInterfaceKnown, uiPageLifecyclePhases, uiPageNodeContractId, uiPageNodePageId, uiPageNodePins, type UiPageLifecyclePhase } from '../core/ui-page-interface';
import { blueprintPageOpeningOverrides, setBlueprintPageOpening } from '../core/ui-page-opening';
import { UiPageOpeningFields } from './UiPageOpeningFields';

function PageChoice({ project, graph, node, edit, contract = false }: BlueprintFieldProps & { contract?: boolean }) {
  const [pending, setPending] = useState<{ nodeId: string; value: string; count: number }>();
  const field = contract ? 'interfacePageId' : 'pageId', value = contract ? uiPageNodeContractId(graph, node) : uiPageNodePageId(graph, node);
  const candidate = (target: BlueprintNode, value: string) => {
    const next = { ...target, properties: { ...target.properties, [field]: value } };
    if (!contract) delete next.properties.interfacePageId;
    return next;
  };
  const apply = (value: string) => edit(target => { target.properties = candidate(target, value).properties; });
  const request = (value: string) => {
    const pins = uiPageNodePins(project, graph, candidate(node, value));
    const count = pins ? graph.links.filter(link => link.fromNodeId === node.id && !pins.some(pin => pin.direction === 'output' && pin.id === link.fromPinId) || link.toNodeId === node.id && !pins.some(pin => pin.direction === 'input' && pin.id === link.toPinId)).length : 0;
    if (count) setPending({ nodeId: node.id, value, count }); else apply(value);
  };
  return <><select aria-label={node.name + (contract ? ' · 动态页面接口' : ' · 页面')} value={value} onChange={event => request(event.target.value)}><option value="">请选择页面</option>{value && !uiPage(project, value) && <option value={value}>缺失页面 · {value}</option>}{uiPages(project).map(page => <option key={page.id} value={page.id}>{page.name}{page.disabled ? '（已停用）' : page.template ? ' · 模板' : ''}</option>)}</select>
    {pending?.nodeId === node.id && <div role="alertdialog" aria-label="修改页面接口确认"><p>更换{contract ? '接口声明' : '页面'}将断开 {pending.count} 条失效连接点连线；类型不兼容的线和旧实参保留供修复。本次修改可一次撤销。</p><button type="button" onClick={() => { apply(pending.value); setPending(undefined); }}>确认更换页面</button><button type="button" onClick={() => setPending(undefined)}>保留原页面</button></div>}</>;
}
export const BlueprintPageTarget = PageChoice;
export function BlueprintPageFields({ project, graph, node, edit, surface = 'card' }: BlueprintFieldProps & { surface?: 'card' | 'inspector' }) {
  const contractId = uiPageNodeContractId(graph, node), definition = uiPageInterface(project, contractId);
  const dynamic = graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'pageId');
  const parameters = node.type === 'getPageInput' ? definition?.inputs ?? [] : definition?.outputs ?? [];
  const selected = String(node.properties.parameterId ?? '');
  if (surface === 'card') return <small>{node.type === 'eventPage' ? uiPageLifecyclePhases[node.properties.phase as UiPageLifecyclePhase]?.name ?? '生命周期事件无效' : !uiPageInterfaceKnown(definition) ? '接口版本未知，请在页面接口面板恢复。' : '页面参数与实例生命周期共用；详细配置在“节点参数”。'}</small>;
  return <section className="blueprint-page-fields">
    {(dynamic || node.type === 'eventPage') && <label className="blueprint-inline-field"><span>{dynamic ? '接口声明页' : '所属页面'}</span><PageChoice project={project} graph={graph} node={node} edit={edit} contract={dynamic} /></label>}
    {dynamic && <p className="blueprint-note">连线只决定实际页面；连接点类型来自此接口声明。运行时核对稳定参数标识和类型，不兼容就明确停止。</p>}
    {!uiPageInterfaceKnown(definition) && <p role="alert">接口版本无法识别，原连接点保留。请在页面“输入与结果”中明确恢复；不会静默重建接口。</p>}
    {node.type === 'eventPage' && <><label className="blueprint-inline-field"><span>时机</span><select aria-label={node.name + ' · 时机'} value={String(node.properties.phase)} onChange={event => edit(target => { target.properties.phase = event.target.value; })}>{!Object.hasOwn(uiPageLifecyclePhases, String(node.properties.phase)) && <option value={String(node.properties.phase)}>无效时机</option>}{Object.entries(uiPageLifecyclePhases).map(([phase, info]) => <option key={phase} value={phase}>{info.name}</option>)}</select></label><p className="blueprint-note">{uiPageLifecyclePhases[node.properties.phase as UiPageLifecyclePhase]?.hint}</p>{!graph.uiPageId && contractId.startsWith('ui:') && <label className="blueprint-inline-field"><span>作用方案</span><select aria-label={node.name + ' · 作用方案'} value={String(node.properties.uiInstanceId ?? '')} onChange={event => edit(target => { target.properties.uiInstanceId = event.target.value; })}><option value="">所有方案</option><option value="base">默认界面</option>{project.ui.instances?.map(instance => <option key={instance.id} value={instance.id}>{instance.name}</option>)}</select></label>}</>}
    {['getPageInput', 'getPageOutput', 'setPageOutput'].includes(node.type) && <label className="blueprint-inline-field"><span>{node.type === 'getPageInput' ? '输入参数' : '返回参数'}</span><select aria-label={node.name + ' · 参数'} value={selected} onChange={event => edit(target => { target.properties.parameterId = event.target.value; })}><option value="">请选择参数</option>{selected && !parameters.some(parameter => parameter.id === selected) && <option value={selected}>缺失参数 · {selected}</option>}{parameters.map(parameter => <option key={parameter.id} value={parameter.id}>{parameter.name}</option>)}</select></label>}
    {node.type === 'showUiPage' && <><UiPageOpeningFields project={project} pageId={contractId} value={blueprintPageOpeningOverrides(node)} dynamic={graph.links.some(link => link.toNodeId === node.id && ['wait', 'modalMode'].includes(link.toPinId))} onChange={opening => edit(target => setBlueprintPageOpening(target, opening))} /><p className="blueprint-note">输入在打开时取快照。重复打开定位已有实例，不覆盖原输入、不再派发创建／显示、不新增等待。仅正常完成提供类型化结果；取消、已打开、叠加显示使用输出默认值。</p></>}
    {node.type === 'closeUiPage' && <p className="blueprint-note">返回参数留空时保留“设置页面结果”写入的值；可用输入或连线覆盖。取消不会发布部分结果。阻止关闭后页面和原等待继续存在。</p>}
    {node.type === 'preventPageClose' && <p className="blueprint-note">只阻止当前关闭请求；无请求时不生效。离页、父页关闭、加载与返回标题属于强制清理，不能被此节点阻止。</p>}
  </section>;
}
