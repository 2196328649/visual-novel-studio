import { authoringItem, noUiComponents } from '../core/authoring-index';
import { immutableAuthoringIndex } from './authoring-index';
import { uiSpineEvents, uiSpineNamedChoices } from '../core/ui-spine';
import { uiVideoEvents } from '../core/ui-video';
import { uiImageEvents } from '../core/ui-image';
import { isUiControlOptionNode } from '../core/ui-control-options';
import { BlueprintControlOptionFields } from './BlueprintControlOptionFields';
import { BlueprintPageFields, BlueprintPageTarget } from './BlueprintPageFields';
import { isUiPageInterfaceNode } from '../core/ui-page-interface';
import { BlueprintTaskFields } from './BlueprintTaskFields';
import { isBlueprintTaskNode } from '../core/blueprint-tasks';
import { BlueprintChoiceFields } from './BlueprintChoiceFields';
import { isBlueprintChoiceType } from '../core/blueprint-choice';
import { blueprintRoundModes } from '../core/blueprint-numeric';
import { Crosshair } from 'lucide-react';
import { IconButton } from './components';
import { blueprintComparisonOperations, blueprintMathOperations, blueprintNumericPresentation } from '../core/blueprint-presentation';
import { BlueprintFlowControlFields } from './BlueprintFlowControlFields';
import { isBlueprintFlowControl } from '../core/blueprint-flow-control';
import { BlueprintStateFields } from './BlueprintStateFields';
import { blueprintStateScope, blueprintStateVariables } from '../core/blueprint-state';
import { uiPages, uiPage } from '../core/ui-pages';
import { projectGraphs } from '../core/project-resources';
import { uiAnimationPlayModes } from '../core/ui-animation-clips';
import { uiControlValueType, uiTextInput } from '../core/ui-control-events';
import { uiButtonEvents } from '../core/ui-button-events';
import { standardUiEventPages } from '../core/ui-logic';
import { uiPageNames } from './UiNames';
import { isTimelineComponent } from '../core/timeline-component';
import type { ReactNode } from 'react';
import { type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Project, type VariableValue } from '../core/model';
import { blueprintInputValue, blueprintKeyNames, blueprintTypeNames, defaultBlueprintValue, type BlueprintDataType } from '../core/blueprint';
import { uiProperties, uiPropertyApplies, type UiProperty } from '../core/ui';
import { uiPropertySources } from '../core/ui-properties';
import { playerPreferences } from '../core/preferences';
import { BlueprintValueInput } from './BlueprintValueInput';
import { ActorTransitionFields, BlueprintActorTransitionFields } from './ActorTransitionFields';
import { parseActorTransitions, graphShowsActors } from '../core/actor-transitions';
import { BlueprintParameterValue } from './BlueprintCallFields';
import { uiAnimationEasings, uiAnimationPropertyNames } from '../core/ui-animation';
import { NumberInput } from './NumberInput';
import { SpineSpeedValueInput } from './SpineSpeedInput';
import { CharacterPresetSelect } from './CharacterPresets';
import { ActorInstanceField, ActorLifetimeSelect } from './ActorInstanceFields';
import type { ShowActor } from '../core/actor-instance';
import { blueprintNodeAssetFilter } from '../core/blueprint-assets';
import { blueprintAssetNodeKind, blueprintAssetNodePresentation } from '../core/blueprint-asset-node';
import { AssetReferenceInput } from './AssetReferenceInput';
import { uiControlDefinition } from '../core/ui-control-properties';
import { blueprintUiPropertyControlTargets, type BlueprintUiPropertyControl } from '../core/blueprint-ui-property-control';
import { blueprintActorExpressionChoices, createBlueprintActorInputAnalysis } from '../core/blueprint-actor-inputs';
import { blueprintUiPropertyRowForPin } from '../core/blueprint-ui-property-batch';
import { blueprintUiPropertyAnalysis, BlueprintUiPropertyFields, BlueprintUiPropertyValue } from './BlueprintUiPropertyFields';

export interface BlueprintFieldProps { project: Project; graph: BlueprintGraph; node: BlueprintNode; edit: (edit: (node: BlueprintNode) => void) => void }
const transitionOptions = { none: '无', dissolve: '溶解', fade: '淡入淡出', move: '移动' };
function InlineField({ label, children }: { label: string; children: ReactNode }) { return <label className="blueprint-inline-field"><span>{label}</span>{children}</label>; }
const actorInputAnalyses = new WeakMap<Project, ReturnType<typeof createBlueprintActorInputAnalysis>>();
export function blueprintActorInputSnapshot(project: Project, graph: BlueprintGraph, node: BlueprintNode) {
  let analysis = actorInputAnalyses.get(project);
  if (!analysis) { analysis = createBlueprintActorInputAnalysis(project); actorInputAnalyses.set(project, analysis); }
  return analysis(graph, node);
}
export function BlueprintActorInputMessages({ project, graph, node }: Pick<BlueprintFieldProps, 'project' | 'graph' | 'node'>) {
  const actor = blueprintActorInputSnapshot(project, graph, node);
  return <>{actor.problems.map(problem => <small key={problem.code} role="status">{problem.message}</small>)}</>;
}
export function BlueprintInlineValue({ project, graph, node, pin, edit, label: labelOverride, inputOptions, onLocateComponent, surface = 'inspector' }: BlueprintFieldProps & { pin: BlueprintPin; label?: string; surface?: 'card' | 'inspector'; onLocateComponent?: (id: string) => void; inputOptions?: { type?: BlueprintDataType; fallback?: VariableValue; assetKind?: 'image' | 'audio'; componentKind?: 'spine' | 'video'; min?: number; max?: number; step?: number | 'any' } }) {
  const uiIndex = () => immutableAuthoringIndex.ui(project);
  const key = pin.id === 'first_index' ? 'firstIndex' : pin.id === 'last_index' ? 'lastIndex' : pin.id;
  const value = blueprintInputValue(node, pin.id) ?? inputOptions?.fallback, label = labelOverride ?? `${node.name} · ${pin.name}`;
  const change = (value: VariableValue | undefined) => edit(target => { if (value === undefined) delete target.properties[key]; else target.properties[key] = value; if (key === 'componentId' && target.type === 'setUiControlRange') { const component = authoringItem(uiIndex().byId, value), range = component && uiControlDefinition(project,component)?.range; if (range) Object.assign(target.properties, {minimum:range.min,maximum:range.max,step:range.step}); } if (key === 'characterId') target.properties.expressionId = ''; if (key === 'pageId' && ['getVariable', 'setVariable'].includes(target.type) && blueprintStateScope(project, target) === 'page') { const variable = blueprintStateVariables(project, graph, 'page', String(value ?? ''))[0]; target.properties.variableId = variable?.id ?? ''; if (target.type === 'setVariable') target.properties.value = variable?.initial ?? 0; } });
  if (node.type === 'setUiProperty' && blueprintUiPropertyRowForPin(node, pin.id)) return <BlueprintUiPropertyValue project={project} graph={graph} node={node} pin={pin} edit={edit} label={label} surface={surface} />;
  if (node.type === 'setSpineSpeed' && pin.id === 'speed') {
    return <SpineSpeedValueInput value={value ?? 1} onChange={change} label={label} />;
  }
  if (node.type === 'playSpine' && pin.id === 'animation') {
    const choices = uiSpineNamedChoices(project.assets, 'animation'), selected = String(value ?? '');
    return <div className="blueprint-value-input"><select aria-label={label} value={selected} onChange={event => change(event.target.value)}>
      <option value="">请选择动画</option>
      {selected && (!Object.hasOwn(choices, selected) || typeof value !== 'string') && <option value={selected}>原值不可用 · {selected}</option>}
      {Object.entries(choices).map(([name, text]) => <option key={name} value={name}>{text}</option>)}
    </select>{surface === 'inspector' && <small className="blueprint-value-unit">换素材后按当前素材校验名称；不会重写设计素材。</small>}</div>;
  }
  const called = ['callFunction', 'callMacro', 'startTask', 'debounce'].includes(node.type) ? projectGraphs(project).find(graph => graph.id === node.properties.graphId) : undefined;
  const argument = called?.exposedInputs.find(input => `arg_${input.id}` === pin.id);
  if (called && argument && isTimelineComponent(called) && pin.dataType === 'asset') return <div className="timeline-default-asset"><BlueprintParameterValue compact={surface === 'card'} project={project} graph={called} pin={argument} label={label} value={value ?? argument.defaultValue ?? ''} onChange={change} /><button type="button" className="text-button" title="未传入时沿用时间轴内的默认素材" aria-label={label + ' · 使用默认素材'} disabled={!Object.hasOwn(node.properties, key)} onClick={() => change(undefined)}>默认</button></div>;
  if (called && argument) return <BlueprintParameterValue compact={surface === 'card'} project={project} graph={called} pin={argument} label={label} value={value ?? defaultBlueprintValue(pin.dataType)} onChange={change} />;
  const options = pin.id === 'direction' && node.type === 'shake' ? { horizontal: '横向', vertical: '纵向' }
    : pin.id === 'modalMode' && node.type === 'showUiPage' ? { page: '沿用页面设置', modal: '拦截底层输入', modeless: '仅本层控件', passthrough: '完全穿透，仅显示' }
    : pin.id === 'saveMode' && node.type === 'showUiPage' ? { save: '保存游戏', load: '读取存档' }
    : pin.id === 'reason' && node.type === 'closeUiPage' ? { completed: '完成', cancelled: '取消' }
    : pin.id === 'effect' && node.type === 'showChapter' ? { '': '作品默认', ink: '笔触消散', fade: '淡入淡出', none: '无' } : undefined;
  if (options) return <select aria-label={label} value={String(value ?? '')} onChange={event => change(event.target.value)}>{!Object.hasOwn(options, String(value ?? '')) && <option value={String(value ?? '')}>{value ? '失效选项 · ' + value : '请选择'}</option>}{Object.entries(options).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>;
  if (pin.id === 'pageId' && isUiPageInterfaceNode(node.type)) return <BlueprintPageTarget project={project} graph={graph} node={node} edit={edit} />;
  if (pin.id === 'pageId') return <select aria-label={label} value={String(value ?? '')} onChange={event => change(event.target.value)}><option value="">选择页面</option>{!!value && !uiPage(project, String(value)) && <option value={String(value)}>缺失页面 · {String(value)}</option>}{uiPages(project).map(page => <option key={page.id} value={page.id} disabled={node.type === 'showUiPage' && (page.disabled || !!page.openProblem)} title={page.openProblem}>{page.name}{page.disabled ? '（已停用）' : node.type === 'showUiPage' && page.openProblem ? '（系统上下文）' : ''}</option>)}</select>;
  const actor = ['showCharacter', 'hideCharacter'].includes(node.type) && ['instanceId', 'presetId', 'expressionId'].includes(pin.id) ? blueprintActorInputSnapshot(project, graph, node) : undefined;
  const character = actor?.character;
  const actorField = (control: ReactNode) => <>{control}{actor && surface === 'inspector' && <>
    {actor.characterLinked || actor.runtimeCharacter || !character ? <small>{actor.characterDescription}{pin.id === 'expressionId' && actor.runtimeCharacter ? ' 留空使用实际角色的默认表情，也可输入适用于实际角色的表情名称。' : pin.id === 'presetId' && actor.runtimeCharacter ? ' 留空使用手动位置；default 表示实际角色默认站位，left／center／right 为通用站位。' : ''}</small> : null}
  </>}</>;
  if (pin.id === 'characterId' && node.type === 'showCharacter') return <select aria-label={label} value={String(value ?? '')} onChange={event => change(event.target.value)}><option value="">当前台词角色（自动）</option>{!!value && !project.characters.some(character => character.id === value) && <option value={String(value)}>缺失角色 · {String(value)}</option>}{project.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
  if (pin.id === 'lifetime') return <ActorLifetimeSelect value={(value || undefined) as ShowActor['lifetime']} label={label} onChange={value => change(value ?? '')} />;
  if (pin.id === 'instanceId') return actorField(<ActorInstanceField project={project} characterId={character?.id} value={String(value ?? '')} label={label} onChange={value => change(value ?? '')} />);
  if (pin.id === 'presetId' && character) return actorField(<CharacterPresetSelect project={project} characterId={character.id} value={String(value ?? '')} label={label} onChange={change} />);
  if (pin.id === 'expressionId' && character) {
    const choices = blueprintActorExpressionChoices(character, value);
    return actorField(<select aria-label={label} value={String(value ?? '')} onChange={event => change(event.target.value)}><option value="">默认表情</option>{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>);
  }
  const filter = pin.dataType === 'asset' ? blueprintNodeAssetFilter(node, pin.id, project) : undefined;
  const numeric = blueprintNumericPresentation(node, pin.id);
  const candidates = pin.dataType !== 'component' ? noUiComponents : graph.uiPageId ? (uiIndex().byPage.get(graph.uiPageId) ?? noUiComponents) : uiIndex().all;
  const componentIds = pin.dataType !== 'component' ? undefined : isUiControlOptionNode(node.type) ? candidates.filter(component => uiControlDefinition(project, component)?.choice).map(component => component.id) : graph.uiPageId ? candidates.map(component => component.id) : undefined;
  const control = <BlueprintValueInput compact={surface === 'card'} componentIds={componentIds} project={project} label={label} type={pin.dataType} value={value} onChange={change} assetKind={filter?.kind} assetCategory={filter?.category} componentKind={['playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type) ? 'spine' : ['playUiVideo', 'pauseUiVideo', 'stopUiVideo'].includes(node.type) ? 'video' : undefined} {...numeric} {...inputOptions} />;
  if (actor) return actorField(control);
  if (pin.dataType !== 'component' || !onLocateComponent) return control;
  return <div className="blueprint-reference-value">{control}<IconButton title={label + ' · 在设计中定位'} disabled={!value || !authoringItem(uiIndex().byId, value)} onClick={() => onLocateComponent(String(value))}><Crosshair size={13} /></IconButton></div>;
}

/** Property-only settings sit beside the data pins, so ordinary edits need no inspector. */
export function BlueprintNodeFields({ project, graph, node, edit, surface = 'card' }: BlueprintFieldProps & { surface?: 'card' | 'inspector' }) {
  const uiIndex = () => immutableAuthoringIndex.ui(project);
  if (node.type === 'setUiProperty') return <BlueprintUiPropertyFields project={project} graph={graph} node={node} edit={edit} surface={surface} />;
  const assetReference = blueprintAssetNodePresentation(project, node);
  if (assetReference) {
    const value = blueprintInputValue(node, 'value');
    const control = <AssetReferenceInput project={project} kind={assetReference.kind} category="all" compact={surface === 'card'} label={assetReference.kindName} value={typeof value === 'string' ? value : undefined} onChange={value => edit(target => {
      if (blueprintAssetNodeKind(target) === assetReference.kind) target.properties.value = value ?? '';
    })} />;
    return surface === 'card' ? control : <><InlineField label="素材">{control}</InlineField>{assetReference.missing && <small role="status">{assetReference.name}；原引用已保留，请重新选择。</small>}</>;
  }
  const propertyControls = blueprintUiPropertyAnalysis(project);
  const set = (key: string, value: VariableValue) => edit(target => {
    target.properties[key] = value;
    if (key === 'variableId' && target.type === 'setVariable') target.properties.value = project.variables.find(variable => variable.id === value)?.initial ?? 0;
    if (key === 'preference' && target.type === 'setPlayerPreference') target.properties.value = playerPreferences[value as keyof typeof playerPreferences]?.initial ?? 1;
  });
  const inspectorLabels: Record<string, string> = node.type === 'literal' ? { type: '固定值类型', value: '固定值' } : node.type === 'compare' ? { type: '比较的数据类型', operator: '比较方式' } : node.type === 'math' ? { operation: '计算方式' } : {};
  const fieldLabel = (key: string, label: string) => surface === 'inspector' ? inspectorLabels[key] ?? label : label;
  const accessibleLabel = (key: string, label: string) => surface === 'inspector' && inspectorLabels[key] ? inspectorLabels[key] : node.name + ' · ' + label;
  const select = (key: string, label: string, choices: Record<string, string>, fallback = '') => {
    const current = String(node.properties[key] ?? fallback);
    return <InlineField key={key} label={fieldLabel(key, label)}><select aria-label={accessibleLabel(key, label)} value={current} onChange={event => set(key, event.target.value)}><option value="">请选择</option>{current && !Object.hasOwn(choices, current) && <option value={current}>失效选项 · {current}</option>}{Object.entries(choices).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></InlineField>;
  };
  const list = (items: { id: string; name: string }[]) => Object.fromEntries(items.map(item => [item.id, item.name]));
  const fields: ReactNode[] = [], advancedFields: ReactNode[] = [];
  if (node.type === 'showCharacter') fields.push(<BlueprintActorInputMessages key="actor-inputs" project={project} graph={graph} node={node} />);
  const controlledPropertyHint = (target: BlueprintUiPropertyControl) => {
    const source = `参数“${target.parameterName}”`, mode = target.control.mode === 'follow' ? '单向跟随' : '双向同步';
    if (target.problem) return <small key="property-control" role="status">{target.problem} 原关联已保留；请在控件属性中修复来源。</small>;
    const behavior = node.type === 'getUiDefault' ? '读取保存的设计默认值，不读取当前参数值。'
      : node.type === 'getUiProperty' ? '读取参数驱动的当前有效值。'
      : node.type === 'resetUiProperty' ? '清除临时覆盖与动画后继续使用参数；不修改参数，也不解除关联。'
      : target.control.mode === 'follow' ? (node.type === 'animateUiProperty' ? '这项属性动画不会启动。' : '这次赋值不会改写这一项。') + '其他属性和控件事件仍可运行。'
      : (node.type === 'animateUiProperty' ? '动画变化会写回参数。' : '赋值会写回参数。') + '共享此参数的属性随之更新；程序写入不触发用户改值事件。';
    return <small key="property-control" role={target.control.mode === 'follow' && ['setUiProperty', 'animateUiProperty', 'setSpineSpeed'].includes(node.type) ? 'status' : undefined}>{mode}{source}。{behavior}</small>;
  };
  if (isUiPageInterfaceNode(node.type)) fields.push(<BlueprintPageFields key="pageInterface" project={project} graph={graph} node={node} edit={edit} surface={surface} />);
  if (isBlueprintTaskNode(node.type)) fields.push(<BlueprintTaskFields key="tasks" project={project} graph={graph} node={node} edit={edit} surface={surface} />);
  if (isBlueprintChoiceType(node.type)) fields.push(<BlueprintChoiceFields key="choices" project={project} graph={graph} node={node} edit={edit} surface={surface} />);
  if (['callFunction', 'callMacro'].includes(node.type) && graphShowsActors(project, String(node.properties.graphId))) advancedFields.push(<ActorTransitionFields key="actorTransitions" label="本次角色过渡" sources={{ label: '蓝图内角色与节点设置', unresolved: true }} value={parseActorTransitions(node.properties.actorTransitions)} onChange={value => set('actorTransitions', value ? JSON.stringify(value) : '')} />);
  if (['showCharacter'].includes(node.type)) advancedFields.push(<BlueprintActorTransitionFields key="actorTransitions" project={project} graph={graph} node={node} onChange={value => set('actorTransitions', value ? JSON.stringify(value) : '')} />);
  else if (['showBackground', 'hideCharacter', 'switchScene'].includes(node.type)) fields.push(select(node.type === 'switchScene' ? 'mode' : 'transition', '过渡', node.type === 'hideCharacter' ? transitionOptions : { none: '无', dissolve: '溶解', fade: '淡入淡出' }, 'none'));
  if (node.type === 'camera') fields.push(select('easing', '缓动', { linear: '匀速', ease: '缓入缓出', easein: '缓入', easeout: '缓出' }, 'ease'));
  if (node.type === 'round') fields.push(select('mode', '取整方式', blueprintRoundModes, 'nearest'));
  if (node.type === 'math') fields.push(select('operation', '运算', blueprintMathOperations, 'add'));
  if (node.type === 'compare' || node.type === 'literal' || node.type === 'getMinigameValue') {
    const pin = node.pins.find(pin => pin.dataType !== 'exec'), actual = pin?.dataType ?? 'string';
    fields.push(<InlineField key="type" label={fieldLabel('type', '类型')}><select aria-label={accessibleLabel('type', '类型')} value={actual} onChange={event => edit(target => { const type = event.target.value as BlueprintDataType; for (const pin of target.pins) if (target.type !== 'compare' || ['a', 'b'].includes(pin.id)) { pin.dataType = type; pin.defaultValue = defaultBlueprintValue(type); delete target.properties[pin.id]; } if (target.type === 'compare') target.properties.operator = 'eq'; if (target.type === 'literal') target.properties.value = defaultBlueprintValue(type); if (target.type === 'getMinigameValue') target.properties.defaultValue = defaultBlueprintValue(type); })}>{(node.type === 'literal' ? ['number', 'string', 'boolean', 'asset', 'scene', 'character', 'ui', 'component'] : ['number', 'string', 'boolean']).map(type => <option key={type} value={type}>{blueprintTypeNames[type as BlueprintDataType]}</option>)}</select></InlineField>);
    if (node.type !== 'compare') fields.push(<InlineField key="value" label={fieldLabel('value', node.type === 'literal' ? '值' : '默认值')}><BlueprintValueInput compact={surface === 'card'} project={project} type={actual} label={accessibleLabel('value', '值')} value={node.properties[node.type === 'literal' ? 'value' : 'defaultValue']} onChange={value => set(node.type === 'literal' ? 'value' : 'defaultValue', value ?? '')} /></InlineField>);
  }
  if (node.type === 'compare') fields.push(select('operator', '比较', blueprintComparisonOperations(node.pins.find(pin => pin.id === 'a')?.dataType ?? 'number'), 'eq'));
  if (isBlueprintFlowControl(node.type)) fields.push(<BlueprintFlowControlFields key="flowControl" project={project} graph={graph} node={node} edit={edit} />);
  if (['getVariable', 'setVariable'].includes(node.type)) fields.push(<BlueprintStateFields key="state" project={project} graph={graph} node={node} edit={edit} />);
  if (node.type === 'getInput') fields.push(select('inputId', '输入参数', list(graph.exposedInputs)));
  if (node.type === 'setOutput') fields.push(select('outputId', '输出参数', list(graph.exposedOutputs)));
  if (['callFunction', 'callMacro'].includes(node.type)) { const called = projectGraphs(project).find(item => item.id === node.properties.graphId); fields.push(select('graphId', isTimelineComponent(called) ? '时间轴预设' : '调用蓝图', list(projectGraphs(project).filter(item => item.id !== graph.id && (isTimelineComponent(called) === isTimelineComponent(item)))))); }
  if (node.type === 'effect') fields.push(select('effectId', '演出效果', list(project.effects)));
  if (isUiControlOptionNode(node.type)) fields.push(<BlueprintControlOptionFields key="control-options" project={project} graph={graph} node={node} edit={edit} />);
  if (node.type === 'focusUiComponent') fields.push(<small key="focus-contract">“请求已接受”只表示已排队；后一个被接受的请求替换前一个。实际焦点在宿主刷新后通过只读“输入焦点”查询。隐藏、禁用、只读、模态遮挡或离页取消旧请求，程序聚焦/释放不触发文字提交。</small>);
  if (['setUiControlRange', 'resetUiControlRange'].includes(node.type)) {
    fields.push(<small key="range-contract">范围限制本控件的有效显示值，不改控件当前值的来源，也不触发用户改值事件。上下限可相等，步长必须大于 0；玩家设置不能超出引擎边界。{node.type === 'resetUiControlRange' ? '重置只清除范围覆盖；已关联的范围参数与控制方式保持不变。' : '下限、上限和步长会先一起检查，再一次写入。'}</small>);
    if (node.type === 'setUiControlRange') {
      const controlled = propertyControls.writes(graph, node), invalid = controlled.find(item => item.problem), following = controlled.filter(item => item.control.mode === 'follow'), syncing = controlled.filter(item => item.control.mode === 'sync');
      if (invalid) fields.push(<small key="range-invalid" role="status">{invalid.problem} 请先修复范围属性的来源；本次整组范围不会写入。</small>);
      else if (following.length) fields.push(<small key="range-follow" role="status">{blueprintUiPropertyControlTargets(following)}为单向跟随参数，本次范围设置不会写入任何一项。</small>);
      else if (syncing.length) fields.push(<small key="range-sync">{blueprintUiPropertyControlTargets(syncing)}为双向同步，范围修改会写回相应参数。</small>);
      else if (propertyControls.contextDependent(graph, node)) fields.push(<small key="range-dynamic">按运行时控件的各项控制方式写入；任一项为单向跟随或数值无效时，整组范围都不修改。</small>);
    }
  }
  if (['getUiProperty', 'getUiDefault', 'resetUiProperty'].includes(node.type)) {
    const component = propertyControls.component(graph, node);
    const dynamic = graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'componentId');
    fields.push(select('property', '组件属性', Object.fromEntries(Object.entries(uiProperties).filter(([key, info]) => (node.type !== 'resetUiProperty' || info.writable) && (dynamic || !component || uiPropertyApplies(component, key as UiProperty, project))).map(([key, value]) => [key, value.name])), 'visible'));
    const info = uiProperties[node.properties.property as UiProperty];
    const target = propertyControls.property(graph, node);
    if (info?.unit && ['getUiProperty', 'getUiDefault'].includes(node.type)) fields.push(<small key="unit">单位：{info.unit}</small>);
    if (info?.description) fields.push(<small key="property-description">{info.description}</small>);
    if (target) fields.push(controlledPropertyHint(target));
    else if (propertyControls.contextDependent(graph, node) && node.type === 'resetUiProperty') fields.push(<small key="property-control">重置清除临时覆盖与动画，保留运行时控件的参数关联。</small>);
    if (!target && component && info && surface === 'inspector') fields.push(<small key="property-sources">{uiPropertySources(component, node.properties.property as UiProperty).join(' → ')}</small>);
  }
  if(['playUiAnimation','stopUiAnimationPlayback'].includes(node.type))fields.push(select('animationId','界面动画',list((project.ui.animations??[]).map(a=>({...a,name:a.name+' / '+(a.pageId.startsWith('ui:')?uiPageNames[a.pageId.slice(3) as keyof typeof uiPageNames]:uiIndex().customPageById.get(a.pageId)?.name??'缺失页面')+(a.uiInstanceId&&a.uiInstanceId!=='base'?' / '+(project.ui.instances?.find(i=>i.id===a.uiInstanceId)?.name??'缺失方案'): '')})))));
  if(node.type==='playUiAnimation') {
    fields.push(select('playMode','播放方向',uiAnimationPlayModes,'forward'));
    const controlled = propertyControls.writes(graph, node), invalid = controlled.find(item => item.problem), following = controlled.filter(item => item.control.mode === 'follow'), syncing = controlled.filter(item => item.control.mode === 'sync');
    if (invalid) fields.push(<small key="animation-invalid" role="status">{invalid.problem} 请先修复对应轨道属性的来源；这段动画不会启动。</small>);
    else if (following.length) fields.push(<small key="animation-follow" role="status">{blueprintUiPropertyControlTargets(following)}为单向跟随参数，这段动画不会启动。请调整对应轨道，或将属性改为双向同步/默认设置。</small>);
    else if (syncing.length) fields.push(<small key="animation-sync">{blueprintUiPropertyControlTargets(syncing)}为双向同步，动画变化会写回相应参数，关联属性随之更新。</small>);
  }
  if(node.type==='animateUiProperty'||node.type==='stopUiAnimation'){
    const component=propertyControls.component(graph, node);
    const choices=Object.fromEntries(Object.entries(uiAnimationPropertyNames).filter(([key])=>!component||uiPropertyApplies(component,key as UiProperty,project)));
    fields.push(select('property','动画属性',node.type==='stopUiAnimation'?{all:'全部属性',...choices}:choices,node.type==='stopUiAnimation'?'all':'opacity'));
    if(node.type==='animateUiProperty') {
      fields.push(select('easing','缓动',uiAnimationEasings,'ease'));
      const target = propertyControls.property(graph, node);
      if (target) fields.push(controlledPropertyHint(target));
      else if (propertyControls.contextDependent(graph, node)) fields.push(<small key="animation-control">运行时按目标属性的控制方式处理：单向跟随不启动动画，双向同步将动画变化写回参数。</small>);
    }
  }
  if (node.type === 'setSpineSpeed') { const target = propertyControls.property(graph, node, 'spineSpeed'); if (target) fields.push(controlledPropertyHint(target)); }
  if (node.type === 'playSpine') {
    const target = propertyControls.property(graph, node, 'spineLoop');
    if (target?.problem) fields.push(controlledPropertyHint(target));
    else if (target) fields.push(<small key="spine-loop-control">循环方式{target.control.mode === 'follow' ? `单向跟随参数“${target.parameterName}”，播放仍会执行，循环输入沿用参数值。` : `与参数“${target.parameterName}”双向同步，本次循环输入会写回参数。`}</small>);
  }
  if (['getPlayerPreference', 'setPlayerPreference'].includes(node.type)) fields.push(select('preference', '玩家选项', Object.fromEntries(Object.entries(playerPreferences).map(([key, value]) => [key, value.name])), 'musicVolume'));
  if (['playSound', 'stopMusic'].includes(node.type)) fields.push(select('channel', '通道', { ...(node.type === 'stopMusic' ? { music: '背景音乐' } : {}), sound: '音效', ambient: '环境音' }, node.type === 'stopMusic' ? 'music' : 'sound'));
  if (['eventClick','eventButton'].includes(node.type)) fields.push(select('componentId', '按钮', list((graph.uiPageId?(uiIndex().byPage.get(graph.uiPageId) ?? noUiComponents):uiIndex().all).filter(component => component.kind === 'button').map(component => ({ id: component.id, name: component.name || component.text || component.id })))));
  if(node.type==='eventTextCommitted')fields.push(select('componentId','输入控件',list((graph.uiPageId?(uiIndex().byPage.get(graph.uiPageId) ?? noUiComponents):uiIndex().all).filter(c=>uiTextInput(project,c)).map(c=>({id:c.id,name:c.name||c.text||c.id})))));
  if(node.type==='eventValueChanged')fields.push(select('componentId','控件',list((graph.uiPageId?(uiIndex().byPage.get(graph.uiPageId) ?? noUiComponents):uiIndex().all).filter(c=>uiControlValueType(project,c)).map(c=>({id:c.id,name:c.name||c.text||c.id})))));
  if (node.type === 'eventImage') fields.push(select('componentId', '图片', list((graph.uiPageId ? (uiIndex().byPage.get(graph.uiPageId) ?? noUiComponents) : uiIndex().all).filter(c => c.kind === 'image').map(c => ({ id: c.id, name: c.name || c.text || c.id })))), select('trigger', '触发时机', uiImageEvents, 'loaded'));
  if (node.type === 'eventSpine') fields.push(select('componentId', '骨骼', list((graph.uiPageId ? (uiIndex().byPage.get(graph.uiPageId) ?? noUiComponents) : uiIndex().all).filter(c => c.kind === 'spine').map(c => ({ id: c.id, name: c.name || c.text || c.id })))), select('trigger', '触发时机', uiSpineEvents, 'completed'));
  if (node.type === 'eventVideo') fields.push(select('componentId', '视频', list((graph.uiPageId ? (uiIndex().byPage.get(graph.uiPageId) ?? noUiComponents) : uiIndex().all).filter(c => c.kind === 'video').map(c => ({ id: c.id, name: c.name || c.text || c.id })))), select('trigger', '触发时机', uiVideoEvents, 'ended'));
  if(node.type==='eventButton')fields.push(select('trigger','触发时机',Object.fromEntries(Object.entries(uiButtonEvents).map(([id,e])=>[id,e.name+' · '+e.unreal])),'hover'));
  if (!graph.uiPageId&&(node.type === 'eventKey' || node.type === 'eventTimer')) fields.push(select('pageId', '界面', list([...project.ui.customPages, ...standardUiEventPages.filter(page => !project.ui.disabledPages?.includes(page.name)).map(page => ({...page,name:uiPageNames[page.name as keyof typeof uiPageNames]}))])));
  if (!graph.uiPageId&&['eventKey','eventTimer'].includes(node.type) && String(node.properties.pageId ?? '').startsWith('ui:')) fields.push(select('uiInstanceId', '作用方案', {'':'所有方案',base:'默认界面',...Object.fromEntries((project.ui.instances??[]).map(instance=>[instance.id,instance.name]))}));
  if (node.type === 'eventKey') fields.push(select('key', '按键', blueprintKeyNames, 'K_SPACE'));
  if (node.type === 'eventTimer') {
    fields.push(<InlineField key="interval" label="间隔秒数"><NumberInput aria-label={`${node.name} · 间隔秒数`} value={Number(node.properties.interval ?? 1)} onChange={event => set('interval', event.target.valueAsNumber)} /></InlineField>);
    fields.push(<InlineField key="repeat" label="循环"><input type="checkbox" aria-label={`${node.name} · 循环`} checked={node.properties.repeat !== false} onChange={event => set('repeat', event.target.checked)} /></InlineField>);
  }
  if (node.type === 'finishMinigame') fields.push(select('result', '结果', { success: '成功', failure: '失败', cancel: '取消' }, 'success'));
  if (['setMinigameValue', 'getMinigameValue', 'sceneAction', 'comment'].includes(node.type)) {
    const key = node.type === 'comment' ? 'text' : node.type === 'sceneAction' ? 'command' : 'key';
    fields.push(<InlineField key={key} label={key === 'key' ? '状态名称' : '内容'}><input aria-label={`${node.name} · 内容`} value={String(node.properties[key] ?? '')} onChange={event => set(key, event.target.value)} /></InlineField>);
  }
  return <>{fields}{advancedFields.length > 0 && (surface === 'inspector' ? advancedFields : <details className="blueprint-node-advanced"><summary>高级角色过渡{node.properties.actorTransitions && <small>已自定义</small>}</summary>{advancedFields}</details>)}</>;
}
