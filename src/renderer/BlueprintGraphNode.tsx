import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Calculator, ChevronDown, ChevronRight, GitBranch, Package, Settings2, Workflow, Zap } from 'lucide-react';
import { blueprintCatalog, blueprintOutputLabel, blueprintTypeNames, type BlueprintDataType } from '../core/blueprint';
import { blueprintGetterNode, blueprintNodePresentation } from '../core/blueprint-presentation';
import { isBlueprintNumericType } from '../core/blueprint-numeric';
import type { BlueprintPin } from '../core/model';
import { BlueprintInlineValue, BlueprintNodeFields } from './BlueprintNodeFields';
import { blueprintUiPropertyDefinition } from '../core/blueprint-ui-property-batch';
import { BlueprintUiPropertyFields } from './BlueprintUiPropertyFields';
import { blueprintAssetNodeKind, blueprintAssetNodePresentation } from '../core/blueprint-asset-node';
import type { BlueprintNodeView } from './blueprint-view';

export type BlueprintFlowNode = Node<BlueprintNodeView, 'blueprint'>;
export const blueprintPinColors: Record<BlueprintDataType, string> = {
  exec: 'var(--blueprint-exec, #eef3fc)', boolean: 'var(--blueprint-boolean, #ea8392)',
  number: 'var(--blueprint-number, #85d4be)', string: 'var(--blueprint-string, #d3a4ed)',
  asset: 'var(--blueprint-asset, #e8be7b)', scene: 'var(--blueprint-scene, #83bcea)',
  character: 'var(--blueprint-character, #e89ec1)', ui: 'var(--blueprint-ui, #91c9e9)',
  component: 'var(--blueprint-component, #9cdec8)', any: 'var(--blueprint-any, #bac7db)',
};
// These short controls define the operation itself. Rich settings and help live
// in the inspector; input editors still use the same semantic adapter as it does.
const inlineSettings = new Set(['math', 'compare', 'round', 'literal']);
const valueAlreadyVisible = new Set(['delay', 'showCharacter', 'playMusic', 'confirmMessage', 'uiAction', 'random', 'formatText', 'select', 'not', 'and', 'or', 'xor', 'branch', 'forLoop', 'shake', 'showChapter']);

const GraphNodeContents = memo(function GraphNodeContents({ data }: { data: BlueprintNodeView }) {
  const { node, layout } = data;
  const propertySetter = node.type === 'setUiProperty', propertyRows = propertySetter ? blueprintUiPropertyDefinition(node).rows : undefined;
  const presentation = blueprintNodePresentation(node);
  const KindIcon = presentation.family === 'event' ? Zap : presentation.family === 'value' ? Calculator : presentation.family === 'module' ? Workflow : GitBranch;
  const handle = (item: BlueprintPin) => <Handle type={item.direction === 'input' ? 'target' : 'source'} position={item.direction === 'input' ? Position.Left : Position.Right} id={item.id}
    aria-label={`${node.name} · ${item.name} · ${item.direction === 'input' ? '输入' : '输出'}`} className={item.dataType === 'exec' ? 'exec-pin' : ''} style={{ background: blueprintPinColors[item.dataType] }} />;
  const pin = (item: BlueprintPin) => <div key={item.id} className={`blueprint-pin-slot ${item.direction}`} data-pin-id={item.id} data-pin-direction={item.direction} data-pin-type={item.dataType}
    title={`${item.name} · ${blueprintTypeNames[item.dataType]}${data.inputSources.has(item.id) ? '\n来自：' + data.inputSources.get(item.id) : ''}`}>
    {handle(item)}
    <span className="blueprint-pin-label">{item.name}</span>
    {!data.parametersCollapsed && data.inputSources.has(item.id) && <button type="button" className="blueprint-pin-source nodrag nopan" title={'来自：' + data.inputSources.get(item.id)} aria-label={`定位${item.name}来源：${data.inputSources.get(item.id)}`}
      disabled={!data.actions || !data.inputSourceNodes.has(item.id)} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); const id = data.inputSourceNodes.get(item.id); if (id) data.actions?.locateNode(id); }}>来自：{data.inputSources.get(item.id)}</button>}
    {!data.parametersCollapsed && item.direction === 'input' && item.dataType !== 'exec' && !data.connectedInputs.has(item.id) && (!propertySetter || !!propertyRows || item.id === 'componentId') && <div className="blueprint-pin-value nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()}>
      <BlueprintInlineValue surface="card" project={data.project} graph={data.graph} node={node} pin={item} edit={data.edit} onLocateComponent={data.actions?.locateComponent} />
    </div>}
  </div>;
  const outputs = layout.dataRows.flatMap(row => row.output ? [row.output] : []);
  const assetReference = blueprintAssetNodePresentation(data.project, node);
  if (assetReference && node.pins.length === 1 && outputs[0]) {
    const output = outputs[0];
    return <>
      <div className="graph-node-title" title={assetReference.title + '。将素材输出连接到需要它的属性。'}>
        <Package size={14} /><strong title={node.name + '\n' + assetReference.title}>{node.name}</strong>
        {(data.invalid || assetReference.missing) && <span className="blueprint-node-warning" title={assetReference.missing ? assetReference.name : '请在“节点参数”完成设置'}>待完善</span>}
        <button type="button" className="blueprint-node-settings nodrag nopan" title="打开节点参数" aria-label="编辑节点参数" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); data.actions?.inspectNode?.(node.id); }}><Settings2 size={13} /></button>
        <button type="button" className="node-collapse nodrag nopan" title={data.parametersCollapsed ? '展开节点参数' : '收起节点参数'} aria-label={data.parametersCollapsed ? '展开节点参数' : '收起节点参数'} aria-expanded={!data.parametersCollapsed} onClick={event => { event.stopPropagation(); data.toggleParameters(); }}>{data.parametersCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
      </div>
      <div className="blueprint-pin-slot output blueprint-asset-reference-row" data-pin-id={output.id} data-pin-direction="output" data-pin-type="asset" title={assetReference.title}>
        {handle(output)}
        {data.parametersCollapsed ? <span className="blueprint-pin-label blueprint-asset-reference-name">{assetReference.name}</span> : <div className="blueprint-pin-value nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()}>
          <BlueprintNodeFields project={data.project} graph={data.graph} node={node} edit={data.edit} />
        </div>}
      </div>
    </>;
  }
  if (blueprintGetterNode(node) && outputs[0]) {
    const label = node.type === 'getMinigameValue' ? `小游戏值 · ${data.cardSummary ?? '未填写状态名称'}`
      : node.type === 'getPlayerPreference' ? `玩家选项 · ${data.cardSummary ?? '未选择玩家选项'}`
      : blueprintOutputLabel(data.project, data.graph, node, outputs[0].id), split = label.indexOf(' · ');
    return <div className="graph-node-title blueprint-getter-row" title={label + ' · ' + blueprintTypeNames[outputs[0].dataType] + '。选中后在“节点参数”选择读取对象。'}>
      {split > 0 && <small>{label.slice(0, split)}</small>}<strong>{split > 0 ? label.slice(split + 3) : label}</strong>{data.invalid && <span title="请在“节点参数”完成设置">待完善</span>}{pin(outputs[0])}
    </div>;
  }
  const inputs = layout.dataRows.flatMap(row => row.input ? [row.input] : []);
  const customPins = new Set(propertyRows?.map(row => row.id));
  const genericInputs = propertySetter ? inputs.filter(item => !customPins.has(item.id)) : inputs;
  const showSummary = !propertySetter && (data.parametersCollapsed || !inlineSettings.has(node.type) && !isBlueprintNumericType(node.type) && !valueAlreadyVisible.has(node.type) || !!node.properties.actorTransitions);
  const canCollapse = inputs.length > 0 || inlineSettings.has(node.type);
  return <>
    <div className="graph-node-title" title={`${blueprintCatalog[node.type].name} · ${blueprintCatalog[node.type].hint}`}>
      <KindIcon size={14} /><strong title={node.name}>{node.name}</strong>
      {node.name !== blueprintCatalog[node.type].name && <small className="blueprint-node-type">{blueprintCatalog[node.type].name}</small>}
      {data.invalid && <span className="blueprint-node-warning" title="请在“节点参数”完成设置">待完善</span>}
      <button type="button" className="blueprint-node-settings nodrag nopan" title="打开节点参数" aria-label="编辑节点参数" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); data.actions?.inspectNode?.(node.id); }}><Settings2 size={13} /></button>
      {canCollapse && <button type="button" className="node-collapse nodrag nopan" title={data.parametersCollapsed ? '展开节点参数' : '收起节点参数'} aria-label={data.parametersCollapsed ? '展开节点参数' : '收起节点参数'} aria-expanded={!data.parametersCollapsed} onClick={event => { event.stopPropagation(); data.toggleParameters(); }}>{data.parametersCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>}
    </div>
    {node.type === 'comment' ? <div className="graph-node-detail" title={String(node.properties.text ?? '')}>{String(node.properties.text || '选中后编写说明')}</div> : showSummary && data.cardSummary && <div className="graph-node-detail" title={data.cardSummary}>{data.cardSummary}</div>}
    {layout.executionRows.length > 0 && <div className="blueprint-execution-pins">{layout.executionRows.map((row, index) => <div className="blueprint-pin-row blueprint-execution-row" key={index}>{row.input ? pin(row.input) : <div />}{row.output ? pin(row.output) : <div />}</div>)}</div>}
    {!data.parametersCollapsed && inlineSettings.has(node.type) && <div className="blueprint-node-fields nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()}><BlueprintNodeFields project={data.project} graph={data.graph} node={node} edit={data.edit} /></div>}
    {(inputs.length > 0 || outputs.length > 0 || propertySetter) && <div className="blueprint-data-pins">
      {(inputs.length > 0 || propertySetter) && <div className="blueprint-pin-column input">{genericInputs.map(pin)}{propertySetter && <BlueprintUiPropertyFields project={data.project} graph={data.graph} node={node} edit={data.edit} surface="card" collapsed={data.parametersCollapsed} renderHandle={handle} inputSources={data.inputSources} inputSourceNodes={data.inputSourceNodes} onLocateNode={data.actions?.locateNode} />}</div>}
      {outputs.length > 0 && <div className="blueprint-pin-column output">{outputs.map(pin)}</div>}
    </div>}
    {(layout.hiddenInputs.length > 0 || data.advancedExpanded && layout.advancedInputs.length > 0) && <button type="button" className="blueprint-node-more nodrag nopan" aria-label={data.advancedExpanded ? '收起更多参数' : '展开更多参数'} aria-expanded={data.advancedExpanded}
      title={data.advancedExpanded ? '收起未改动的附加参数，已接线和已修改的仍然显示' : layout.hiddenInputs.map(item => item.name).join('、')} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); data.toggleAdvanced(); }}>
      {data.advancedExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{data.advancedExpanded ? '收起更多参数' : `更多参数 ${layout.hiddenInputs.length}`}
    </button>}
  </>;
});

export const BlueprintGraphNode = memo(function BlueprintGraphNode({ data, selected }: NodeProps<BlueprintFlowNode>) {
  const presentation = blueprintNodePresentation(data.node), width = data.layout.estimatedSize.width, assetKind = blueprintAssetNodeKind(data.node);
  return <div className={`graph-node blueprint-graph-node blueprint-family-${presentation.family} ${presentation.compact ? 'blueprint-compact-node' : ''} ${width === 224 ? 'blueprint-small-node' : width === 280 ? 'blueprint-wide-node' : ''} ${blueprintGetterNode(data.node) ? 'blueprint-getter-node' : ''} ${assetKind ? 'blueprint-asset-reference-node' : ''} node-kind-${data.node.type} ${selected ? 'selected' : ''} ${data.invalid ? 'invalid' : ''} ${data.node.type === 'comment' ? 'comment' : ''} ${data.parametersCollapsed ? 'parameters-collapsed' : ''}`} data-asset-kind={assetKind}><GraphNodeContents data={data} /></div>;
}, (previous, next) => previous.data === next.data && previous.selected === next.selected);
