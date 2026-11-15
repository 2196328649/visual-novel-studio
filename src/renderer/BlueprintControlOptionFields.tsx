import { useState } from 'react';
import { uiControlOptionOperations, uiControlOptionTypes, uiControlOptionsKnown, uiControlOptionsVersion, uiControlOptionPins, uiControlOptionUsesValue, uiControlOptionDefault } from '../core/ui-control-options';
import type { BlueprintFieldProps } from './BlueprintNodeFields';

/** Card and inspector share operation/type editing and disconnection confirmation. */
export function BlueprintControlOptionFields({ graph, node, edit }: BlueprintFieldProps) {
  const [pending, setPending] = useState<{ nodeId: string; operation: string; count: number }>();
  const [recover, setRecover] = useState<string>();
  const connectionCount = (operation: string) => {
    const pins = uiControlOptionPins({ ...node, properties: { ...node.properties, operation } });
    if (!pins) return 0;
    return graph.links.filter(link => link.fromNodeId === node.id && !pins.some(pin => pin.direction === 'output' && pin.id === link.fromPinId) || link.toNodeId === node.id && !pins.some(pin => pin.direction === 'input' && pin.id === link.toPinId)).length;
  };
  const apply = (operation: string) => edit(target => { target.properties.operation = operation; });
  if (!uiControlOptionsKnown(node)) return <section className="blueprint-control-options-fields"><p role="alert">选项节点版本不受支持，原参数和引脚保留；不会自动转换。</p><button type="button" onClick={() => setRecover(node.id)}>恢复当前选项配置</button>{recover === node.id && <div role="alertdialog" aria-label="恢复选项节点确认"><p>恢复会重建连接点，失效连线将断开，可一次撤销；原定义同时保留在工程恢复数据中。</p><button type="button" onClick={() => { edit(target => { const recovery = JSON.stringify({ properties: target.properties, pins: target.pins }); target.properties = { optionsVersion: uiControlOptionsVersion, optionsRecovery: recovery, componentId: target.properties.componentId ?? '', operation: 'insert', valueType: 'string', index: 0, toIndex: 0, label: '选项', value: uiControlOptionDefault('string') }; target.pins = uiControlOptionPins(target)!; }); setRecover(undefined); }}>确认恢复选项节点</button><button type="button" onClick={() => setRecover(undefined)}>保留原定义</button></div>}</section>;
  const operation = String(node.properties.operation ?? 'insert'), type = String(node.properties.valueType ?? 'string');
  return <section className="blueprint-control-options-fields" aria-label="控件选项配置">
    {node.type === 'editUiControlOptions' && <label className="blueprint-inline-field"><span>选项操作</span><select aria-label={node.name + ' · 选项操作'} value={operation} onChange={event => { const operation = event.target.value, count = connectionCount(operation); if (count) setPending({ nodeId: node.id, operation, count }); else apply(operation); }}>{!Object.hasOwn(uiControlOptionOperations, operation) && <option value={operation}>失效操作 · {operation}</option>}{Object.entries(uiControlOptionOperations).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    {uiControlOptionUsesValue(node) && <label className="blueprint-inline-field"><span>选项值类型</span><select aria-label={node.name + ' · 选项值类型'} value={type} onChange={event => edit(target => { target.properties.valueType = event.target.value; })}>{!Object.hasOwn(uiControlOptionTypes, type) && <option value={type}>失效类型 · {type}</option>}{Object.entries(uiControlOptionTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    {pending?.nodeId === node.id && <div role="alertdialog" aria-label="修改选项连接点确认"><p>改为“{uiControlOptionOperations[pending.operation as keyof typeof uiControlOptionOperations]}”将断开 {pending.count} 条已移除输入的连线，可一次撤销；不兼容的类型连线和原常量不会自动转换。</p><button type="button" className="small-button" onClick={() => { const count = connectionCount(pending.operation); if (count !== pending.count) { setPending({ ...pending, count }); return; } apply(pending.operation); setPending(undefined); }}>确认修改选项操作</button><button type="button" className="small-button" onClick={() => setPending(undefined)}>保留原连接</button></div>}
    <small>索引从 0 开始；插入可用当前数量表示末尾，移动的目标是移动后的位置。标签与值可不同，重复值按第一个匹配项读取当前索引。</small>
    <small>列表仅属于本页面实例；修改、清空和恢复不会自动选择、改写来源或触发用户事件。移除当前值后，原值保留、当前索引为 -1；空列表不会变成输入框。</small>
    {uiControlOptionUsesValue(node) && <small>值类型必须符合控件绑定；修改类型不转换原值和旧连线。文字可为空，数值必须有限；玩家设置仍受引擎边界限制。</small>}
  </section>;
}
