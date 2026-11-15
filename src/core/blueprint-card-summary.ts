import type { AuthoringIndexCache } from './authoring-index';
import { actorTransitionModes, parseActorTransitions } from './actor-transitions';
import { blueprintActorExpression } from './blueprint-actor-inputs';
import { blueprintCatalog, blueprintInputSource, blueprintInputValue, blueprintKeyNames, blueprintScreens, blueprintTypeNames } from './blueprint';
import { blueprintChoiceDefinition, blueprintChoiceKeyTypes, blueprintChoiceValueTypes, isBlueprintChoiceType } from './blueprint-choice';
import { blueprintFlowControlInitial, blueprintFlowControlPageId, blueprintFlowControlScope, isBlueprintFlowControl } from './blueprint-flow-control';
import { blueprintRoundModes, isBlueprintNumericType } from './blueprint-numeric';
import { blueprintComparisonOperations, blueprintMathOperations } from './blueprint-presentation';
import { blueprintStatePageId, blueprintStateScope, blueprintStateScopes, blueprintStateVariable } from './blueprint-state';
import { blueprintTaskPageId, blueprintTaskScope, blueprintTaskVersion, isBlueprintTaskNode } from './blueprint-tasks';
import { createBlueprintUiPropertyControlAnalysis, type BlueprintUiPropertyControlAnalysis } from './blueprint-ui-property-control';
import { blueprintUiPropertyDefinition } from './blueprint-ui-property-batch';
import { blueprintAssetNodePresentation } from './blueprint-asset-node';
import { characterDisplayPreset } from './character-presets';
import { actionSchema, declaredUiComponents, effectiveCharacter, type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Project, type StageAction, type VariableValue } from './model';
import { playerPreferences, preferenceInfo, type PlayerPreference } from './preferences';
import { isTimelineResource, projectGraphs } from './project-resources';
import { uiAnimationEasings } from './ui-animation';
import { uiAnimationPlayModes } from './ui-animation-clips';
import { uiButtonEvents } from './ui-button-events';
import { isUiControlOptionNode, uiControlOptionOperations, uiControlOptionTypes, uiControlOptionsKnown } from './ui-control-options';
import { uiImageEvents } from './ui-image';
import { isUiPageInterfaceNode, uiPageInterface, uiPageInterfaceKnown, uiPageLifecyclePhases, uiPageNodeContractId, uiPageNodePageId } from './ui-page-interface';
import { builtinUiPageId } from './ui-page-catalog';
import { uiPage } from './ui-pages';
import { uiProperties, type UiProperty } from './ui-properties';
import { uiSpineEvents } from './ui-spine';
import { uiVideoEvents } from './ui-video';

const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ');
const propertyNames = Object.fromEntries(Object.entries(uiProperties).map(([key, info]) => [key, info.name]));
const buttonEventNames = Object.fromEntries(Object.entries(uiButtonEvents).map(([key, info]) => [key, info.name]));
const pagePhaseNames = Object.fromEntries(Object.entries(uiPageLifecyclePhases).map(([key, info]) => [key, info.name]));
const text = (value: string) => {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 72 ? compact.slice(0, 71) + '…' : compact;
};
function option(choices: Record<string, string>, value: unknown, fallback: string, problem: string) {
  const key = String(value ?? fallback);
  return Object.hasOwn(choices, key) ? choices[key] : problem;
}

/** Pure card prose, independent of whether the renderer shows inline fields.
 * Linked inputs describe their source, never a saved fallback or a predicted live
 * result. A missing summary means there is no additional configuration to show;
 * it is not a successful validation result. The original node summary is retained
 * for its other callers. */
export function blueprintCardSummary(project: Project, graph: BlueprintGraph, node: BlueprintNode, indexes?: AuthoringIndexCache): string | undefined {
  if (!Object.hasOwn(blueprintCatalog, node.type)) return '节点类型不受支持，原配置已保留';
  const valueLabel = (value: VariableValue | undefined, type?: BlueprintPin['dataType']): string => {
    const id = typeof value === 'string' ? value : '';
    if (['asset', 'scene', 'character', 'ui', 'component'].includes(type ?? '')) {
      const kind = blueprintTypeNames[type!];
      if (value !== undefined && typeof value !== 'string') return kind + '引用类型无效';
      if (!id) return '未选择' + kind;
      if (type === 'asset') return (indexes ? indexes.assets(project).byId.get(id) : project.assets.find(item => item.id === id))?.name || '素材引用已失效';
      if (type === 'scene') return project.scenes.find(item => item.id === id)?.name || '场景引用已失效';
      if (type === 'character') return effectiveCharacter(project, id)?.name || '角色引用已失效';
      if (type === 'component') {
        const component = indexes ? indexes.ui(project).declaredById.get(id) : declaredUiComponents(project).find(item => item.id === id);
        return component ? text(component.name || component.text || '界面组件') : '控件引用已失效';
      }
      const pageId = builtinUiPageId(id) ?? id;
      const page = indexes && !pageId.startsWith('ui:') ? indexes.ui(project).customPageById.get(pageId) : uiPage(project, pageId);
      const disabled = pageId.startsWith('ui:') && !!project.ui.disabledPages?.includes(pageId.slice(3) as NonNullable<Project['ui']['disabledPages']>[number]);
      return page ? page.name + (disabled ? '（已停用）' : '') : blueprintScreens[id] ?? '页面引用已失效';
    }
    if (value === undefined) return '未设置';
    if (type === 'number' && typeof value !== 'number') return '数值类型无效';
    if (type === 'boolean' && typeof value !== 'boolean') return '开关类型无效';
    if (type === 'string' && typeof value !== 'string') return '文字类型无效';
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '数值无效';
    return value ? '「' + text(value) + '」' : '空文字';
  };
  const pageLabel = (id: string) => valueLabel(id, 'ui');
  const stateLabel = (owner: BlueprintNode) => {
    if (owner.properties.scope !== undefined && !Object.hasOwn(blueprintStateScopes, String(owner.properties.scope))) return '状态作用域无效';
    const scope = blueprintStateScope(project, owner), variable = blueprintStateVariable(project, graph, owner);
    return join(blueprintStateScopes[scope].name, scope === 'page' ? '变量定义：' + pageLabel(blueprintStatePageId(graph, owner)) : undefined,
      variable?.name || (owner.properties.variableId ? '状态引用已失效' : '未选择状态'));
  };
  const preferenceLabel = (owner: BlueprintNode) => {
    const key = String(owner.properties.preference ?? 'musicVolume');
    return Object.hasOwn(playerPreferences, key) ? preferenceInfo(project, key as PlayerPreference).name : '玩家选项无效';
  };
  const sources = new Map<string, string | undefined>();
  const sourceLabel = (owner: BlueprintNode, pinId: string): string | undefined => {
    const cacheKey = owner.id + ':' + pinId;
    if (sources.has(cacheKey)) return sources.get(cacheKey);
    const label = (() => {
      const incoming = graph.links.find(link => link.toNodeId === owner.id && link.toPinId === pinId);
      if (!incoming) return;
      const source = graph.nodes.find(item => item.id === incoming.fromNodeId);
      if (!source) return '来源节点已失效';
      const pin = source.pins.find(item => item.id === incoming.fromPinId && item.direction === 'output');
      if (!pin) return '来源连接点已失效';
      if (!Object.hasOwn(blueprintCatalog, source.type)) return '来源节点类型不受支持';
      if (isBlueprintTaskNode(source.type) && source.properties.taskVersion !== blueprintTaskVersion) return '来源任务版本不受支持';
      if (isUiControlOptionNode(source.type) && !uiControlOptionsKnown(source)) return '来源选项节点版本不受支持';
      if (isBlueprintChoiceType(source.type) && blueprintChoiceDefinition(source).problems.length) return '来源多路节点配置无效';
      if (isUiPageInterfaceNode(source.type) && !uiPageInterfaceKnown(uiPageInterface(project, uiPageNodeContractId(graph, source)))) return '来源页面接口版本不受支持';
      if (source.type === 'literal') return blueprintAssetNodePresentation(project, source)?.title ?? '常量 · ' + valueLabel(source.properties.value ?? pin.defaultValue, pin.dataType);
      if (source.type === 'getVariable') return stateLabel(source);
      if (source.type === 'getInput') return '输入 · ' + (graph.exposedInputs.find(item => item.id === source.properties.inputId)?.name || '输入参数引用已失效');
      if (source.type === 'getPlayerPreference') return '玩家选项 · ' + preferenceLabel(source);
      if (source.type === 'getMinigameValue') return '小游戏值 · ' + (text(String(source.properties.key ?? '')) || '未填写状态名称');
      if (source.type === 'getUiProperty' || source.type === 'getUiDefault') {
        const componentLinked = graph.links.some(link => link.toNodeId === source.id && link.toPinId === 'componentId');
        return join(componentLinked ? '接线控件' : valueLabel(blueprintInputValue(source, 'componentId'), 'component'),
          option(propertyNames, source.properties.property, 'visible', '组件属性无效'),
          source.type === 'getUiDefault' ? '设计默认值' : undefined);
      }
      return blueprintInputSource(project, graph, owner.id, pinId, indexes)?.label;
    })();
    sources.set(cacheKey, label); return label;
  };
  const input = (pinId: string, fallback?: VariableValue, type?: BlueprintPin['dataType']) => {
    const source = sourceLabel(node, pinId);
    return source ? '来自：' + source : valueLabel(blueprintInputValue(node, pinId) ?? fallback, type ?? node.pins.find(pin => pin.id === pinId)?.dataType);
  };
  const inputFields = () => node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec').map(pin => pin.name + ' ' + input(pin.id)).join(' · ');
  const pageInput = (fallback: string) => {
    if (sourceLabel(node, 'pageId')) return input('pageId', undefined, 'ui');
    const value = blueprintInputValue(node, 'pageId');
    return valueLabel(value === undefined || value === '' ? fallback : value, 'ui');
  };
  const scheme = (id: unknown) => !id ? undefined : id === 'base' ? '默认方案' : project.ui.instances?.find(item => item.id === id)?.name || '界面方案引用已失效';
  const actorOverride = () => {
    if (node.properties.actorTransitions === undefined || node.properties.actorTransitions === '') return;
    try { return Object.keys(parseActorTransitions(node.properties.actorTransitions) ?? {}).length ? '已自定义角色过渡' : undefined; }
    catch { return '角色过渡配置无效，原配置已保留'; }
  };
  let policy: BlueprintUiPropertyControlAnalysis | undefined;
  const controls = () => policy ??= createBlueprintUiPropertyControlAnalysis(project);
  const writePolicy = (property?: string) => {
    const target = property === undefined ? undefined : controls().property(graph, node, property);
    const affected = property === undefined ? controls().writes(graph, node) : target ? [target] : [];
    const broken = affected.find(item => item.problem);
    if (broken) return '属性来源无效，请在控件属性修复';
    const following = affected.find(item => item.control.mode === 'follow');
    if (following) return node.type === 'playSpine' ? '循环跟随参数，循环输入不生效'
      : node.type === 'playUiAnimation' || node.type === 'animateUiProperty' ? '单向跟随参数，动画不会启动'
      : node.type === 'setUiControlRange' ? '单向跟随参数，整组范围不写入' : '单向跟随参数，本次不写入';
    const syncing = affected.filter(item => item.control.mode === 'sync');
    return syncing.length ? '双向同步 · ' + [...new Set(syncing.map(item => item.parameterName))].slice(0, 2).join('、') : undefined;
  };
  if (isBlueprintChoiceType(node.type)) {
    const definition = blueprintChoiceDefinition(node);
    if (definition.problems.length) return definition.problems[0];
    return join(blueprintChoiceKeyTypes[definition.keyType!], (definition.cases?.length ?? 0) + (node.type === 'switchValue' ? ' 个分支' : ' 个候选值'),
      node.type === 'selectByKey' ? '结果：' + blueprintChoiceValueTypes[definition.valueType!] : undefined);
  }
  if (isBlueprintFlowControl(node.type)) return join(
    node.properties.scope !== undefined && !['call', 'page'].includes(String(node.properties.scope)) ? '作用域无效' : blueprintFlowControlScope(node) === 'page' ? '页面实例 · ' + pageInput(blueprintFlowControlPageId(graph, node)) : '本次调用',
    node.properties.initiallyClosed !== undefined && typeof node.properties.initiallyClosed !== 'boolean' ? '初始状态无效' : blueprintFlowControlInitial(node) ? '初始关闭' : '初始可通过');
  if (isBlueprintTaskNode(node.type)) {
    if (node.properties.taskVersion !== blueprintTaskVersion) return '任务定义版本不受支持，原配置已保留';
    const scoped = ['startTask', 'debounce', 'throttle'].includes(node.type);
    const scope = scoped ? node.properties.scope !== undefined && !['call', 'page'].includes(String(node.properties.scope)) ? '任务作用域无效'
      : blueprintTaskScope(node) === 'page' ? '页面实例 · ' + pageInput(blueprintTaskPageId(graph, node)) : '本次调用' : undefined;
    const target = projectGraphs(project).find(item => item.id === node.properties.graphId);
    const module = ['startTask', 'debounce'].includes(node.type) || node.type === 'waitTask' && !!node.properties.graphId
      ? target?.name || (node.properties.graphId ? '任务模块引用已失效' : '未选择任务模块') : undefined;
    return join(module, scope, node.type === 'startTask' ? option({ parallel: '并行任务', replace: '替换旧任务', ignore: '已有任务时忽略' }, node.properties.conflict, 'parallel', '任务冲突方式无效') : undefined,
      scoped ? (node.type === 'throttle' ? '冷却 ' : node.type === 'debounce' ? '安静 ' : '延后 ') + input('seconds', node.type === 'startTask' ? 0 : .3) : undefined);
  }
  if (isUiPageInterfaceNode(node.type)) {
    const contractId = uiPageNodeContractId(graph, node), definition = uiPageInterface(project, contractId);
    if (!uiPageInterfaceKnown(definition)) return '页面接口版本不受支持，原配置已保留';
    const page = pageInput(uiPageNodePageId(graph, node));
    const contract = sourceLabel(node, 'pageId') ? '接口：' + pageLabel(contractId) : undefined;
    if (node.type === 'eventPage') return join(page, option(pagePhaseNames, node.properties.phase, 'closeRequested', '页面生命周期时机无效'), scheme(node.properties.uiInstanceId));
    if (['getPageInput', 'getPageOutput', 'setPageOutput'].includes(node.type)) {
      const parameter = (node.type === 'getPageInput' ? definition?.inputs : definition?.outputs)?.find(item => item.id === node.properties.parameterId);
      return join(page, contract, parameter?.name || (node.properties.parameterId ? '页面参数引用已失效' : '未选择页面参数'));
    }
    return join(page, contract);
  }
  if (node.type === 'getVariable' || node.type === 'setVariable') return join(stateLabel(node),
    blueprintStateScope(project, node) === 'page' && sourceLabel(node, 'pageId') ? '实际页面 ' + input('pageId', undefined, 'ui') : undefined);
  if (node.type === 'getInput' || node.type === 'setOutput') return (node.type === 'getInput' ? graph.exposedInputs : graph.exposedOutputs).find(pin => pin.id === node.properties[node.type === 'getInput' ? 'inputId' : 'outputId'])?.name || (node.type === 'getInput' ? '输入参数引用已失效' : '输出参数引用已失效');
  if (node.type === 'callFunction' || node.type === 'callMacro') {
    const target = projectGraphs(project).find(item => item.id === node.properties.graphId);
    return join(target ? (isTimelineResource(target) ? '时间轴 · ' : '') + target.name : node.properties.graphId ? '调用流程引用已失效' : '未选择调用流程', actorOverride());
  }
  if (node.type === 'math') return join(option(blueprintMathOperations, node.properties.operation, 'add', '运算方式无效'), input('a') + '，' + input('b'));
  if (node.type === 'compare') {
    const type = node.pins.find(pin => pin.id === 'a')?.dataType ?? 'number';
    if (!['number', 'string', 'boolean'].includes(type)) return '比较值类型无效';
    return join(blueprintTypeNames[type], option(blueprintComparisonOperations(type), node.properties.operator, 'eq', '比较方式无效'), input('a') + '，' + input('b'));
  }
  if (node.type === 'round') return join(option(blueprintRoundModes, node.properties.mode, 'nearest', '取整方式无效'), input('value'));
  if (node.type === 'literal') {
    const asset = blueprintAssetNodePresentation(project, node);
    if (asset) return asset.title;
    const pin = node.pins.find(pin => pin.direction === 'output');
    return pin && pin.dataType !== 'exec' && Object.hasOwn(blueprintTypeNames, pin.dataType) ? join(blueprintTypeNames[pin.dataType], valueLabel(node.properties.value ?? pin.defaultValue, pin.dataType)) : '固定值连接点无效';
  }
  if (node.type === 'delay') return input('seconds', 1) + (sourceLabel(node, 'seconds') ? '' : ' 秒');
  if (node.type === 'showCharacter' || node.type === 'hideCharacter') {
    const dynamic = !!sourceLabel(node, 'characterId'), value = blueprintInputValue(node, 'characterId');
    const automatic = value === undefined || value === '';
    const character = !dynamic && typeof value === 'string' && value ? effectiveCharacter(project, value) : undefined;
    const target = dynamic ? input('characterId', undefined, 'character') : automatic && node.type === 'showCharacter' ? '当前台词角色' : valueLabel(value, 'character');
    let expression: string | undefined, preset: string | undefined;
    if (node.type === 'showCharacter') {
      const expressionValue = blueprintInputValue(node, 'expressionId');
      expression = sourceLabel(node, 'expressionId') ? '表情 ' + input('expressionId') : expressionValue === undefined || expressionValue === '' ? '默认表情'
        : typeof expressionValue !== 'string' ? '表情类型无效' : character ? blueprintActorExpression(character, expressionValue)?.name || '表情引用已失效' : dynamic || automatic ? '表情按运行时角色匹配' : '表情无法确认';
      const presetValue = blueprintInputValue(node, 'presetId');
      preset = sourceLabel(node, 'presetId') ? '站位 ' + input('presetId') : presetValue === undefined || presetValue === '' ? '手动位置'
        : typeof presetValue !== 'string' ? '站位类型无效'
        : ['default', '默认', '角色默认'].includes(String(presetValue)) ? '角色默认站位'
        : character ? characterDisplayPreset(project, character.id, presetValue)?.name || '站位引用已失效' : dynamic || automatic ? '站位按运行时角色匹配' : '站位无法确认';
    }
    return join(target, expression, preset, actorOverride());
  }
  if (node.type === 'switchScene' || node.type === 'showBackground') return join(input(node.type === 'switchScene' ? 'sceneId' : 'assetId', undefined, node.type === 'switchScene' ? 'scene' : 'asset'),
    option(actorTransitionModes, node.properties[node.type === 'switchScene' ? 'mode' : 'transition'], 'none', '过渡方式无效'));
  if (node.type === 'event') return graph.uiPageId ? join(pageLabel(graph.uiPageId), '页面显示时') : undefined;
  if (['eventClick', 'eventButton', 'eventValueChanged', 'eventTextCommitted', 'eventImage', 'eventVideo', 'eventSpine'].includes(node.type)) {
    const target = input('componentId', undefined, 'component');
    if (node.type === 'eventButton') return join(target, option(buttonEventNames, node.properties.trigger, 'hover', '按钮触发时机无效'));
    const events = node.type === 'eventImage' ? uiImageEvents : node.type === 'eventVideo' ? uiVideoEvents : node.type === 'eventSpine' ? uiSpineEvents : undefined;
    return join(target, events ? option(events, node.properties.trigger, node.type === 'eventImage' ? 'loaded' : node.type === 'eventVideo' ? 'ended' : 'completed', '媒体触发时机无效') : undefined);
  }
  if (node.type === 'eventKey' || node.type === 'eventTimer') {
    const interval = node.properties.interval ?? 1;
    return join(pageInput(graph.uiPageId ?? ''), node.type === 'eventKey' ? option(blueprintKeyNames, node.properties.key, 'K_SPACE', '按键配置无效')
      : typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0 ? '定时间隔无效'
      : node.properties.repeat !== undefined && typeof node.properties.repeat !== 'boolean' ? '定时循环配置无效' : `每 ${interval} 秒${node.properties.repeat === false ? '触发一次' : '循环'}`, scheme(node.properties.uiInstanceId));
  }
  if (node.type === 'playUiAnimation' || node.type === 'stopUiAnimationPlayback') {
    const animation = project.ui.animations?.find(item => item.id === node.properties.animationId);
    const name = animation?.name || (node.properties.animationId ? '界面动画引用已失效' : '未选择界面动画');
    const context = animation && (!uiPage(project, animation.pageId) || animation.uiInstanceId && animation.uiInstanceId !== 'base' && !project.ui.instances?.some(item => item.id === animation.uiInstanceId)) ? '动画所属页面或方案已失效' : undefined;
    const loops = blueprintInputValue(node, 'loops') ?? 1;
    return node.type === 'stopUiAnimationPlayback' ? join(name, context) : join(name, context,
      option(uiAnimationPlayModes, node.properties.playMode, 'forward', '播放方向无效'),
      sourceLabel(node, 'loops') ? input('loops') : typeof loops !== 'number' || !Number.isInteger(loops) || loops < 0 ? '循环次数无效' : loops === 0 ? '无限循环' : loops + '次', writePolicy());
  }
  if (isUiControlOptionNode(node.type)) {
    if (!uiControlOptionsKnown(node)) return '选项节点版本不受支持，原配置已保留';
    return join(input('componentId', undefined, 'component'), node.type === 'editUiControlOptions' ? option(uiControlOptionOperations, node.properties.operation, 'insert', '选项操作无效') : undefined,
      option(uiControlOptionTypes, node.properties.valueType, 'string', '选项值类型无效'));
  }
  if (node.type === 'setUiProperty') {
    const definition = blueprintUiPropertyDefinition(node);
    if (definition.problems.length) return join(input('componentId', undefined, 'component'), definition.problems[0]);
    return join(input('componentId', undefined, 'component'), definition.rows!.map(row => join(
      uiProperties[row.property as UiProperty].name, '= ' + input(row.id),
      writePolicy(row.property) ?? option({ override: '临时覆盖', source: '修改绑定源' }, row.writeMode, 'override', '赋值方式无效'))).join('；'));
  }
  if (['getUiProperty', 'getUiDefault', 'resetUiProperty', 'animateUiProperty', 'stopUiAnimation'].includes(node.type)) {
    const property = String(node.properties.property ?? (node.type === 'stopUiAnimation' ? 'all' : 'visible'));
    const propertyName = property === 'all' && node.type === 'stopUiAnimation' ? '全部属性' : Object.hasOwn(uiProperties, property) ? uiProperties[property as UiProperty].name : '组件属性无效';
    const target = controls().property(graph, node);
    const readPolicy = node.type === 'getUiDefault' ? '保存的设计默认值' : target?.problem ? '属性来源无效，请在控件属性修复'
      : target ? join(node.type === 'resetUiProperty' ? '恢复来源' : target.control.mode === 'follow' ? '单向跟随' : '双向同步', target.parameterName) : undefined;
    return join(input('componentId', undefined, 'component'), propertyName,
      node.type === 'animateUiProperty' ? '→ ' + input('value') : undefined,
      node.type === 'animateUiProperty' ? writePolicy() : readPolicy,
      node.type === 'animateUiProperty' ? option(uiAnimationEasings, node.properties.easing, 'ease', '缓动方式无效') : undefined);
  }
  if (['focusUiComponent', 'setUiControlRange', 'resetUiControlRange', 'resetUiComponent', 'playUiVideo', 'pauseUiVideo', 'stopUiVideo', 'playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type)) return join(input('componentId', undefined, 'component'),
    node.type === 'playSpine' ? '动画 ' + input('animation') : undefined,
    node.type === 'focusUiComponent' ? '请求焦点 ' + input('focused') : node.type === 'setUiControlRange' ? input('minimum') + '～' + input('maximum') + ' · 步长 ' + input('step')
      : node.type === 'playUiVideo' ? '重新开始 ' + input('restart') : node.type === 'pauseUiVideo' || node.type === 'pauseSpine' ? '暂停 ' + input('paused') : node.type === 'setSpineSpeed' ? '速度 ' + input('speed') : undefined,
    ['setUiControlRange', 'playSpine', 'setSpineSpeed'].includes(node.type) ? writePolicy() : undefined);
  if (node.type === 'getPlayerPreference' || node.type === 'setPlayerPreference') return join(preferenceLabel(node),
    node.properties.preference === 'characterVolume' ? (sourceLabel(node, 'characterId') || blueprintInputValue(node, 'characterId') ? input('characterId', undefined, 'character') : '默认配音') : undefined);
  if (node.type === 'getMinigameValue' || node.type === 'setMinigameValue') return text(String(node.properties.key ?? '')) || '未填写状态名称';
  if (node.type === 'finishMinigame') return option({ success: '成功', failure: '失败', cancel: '取消' }, node.properties.result, 'success', '小游戏结果无效');
  if (node.type === 'effect') return project.effects.find(item => item.id === node.properties.effectId)?.name || (node.properties.effectId ? '演出效果引用已失效' : '未选择演出效果');
  if (node.type === 'playMusic' || node.type === 'playSound') return join(input('assetId', undefined, 'asset'), node.type === 'playSound' ? option({ sound: '音效通道', ambient: '环境音通道' }, node.properties.channel, 'sound', '播放通道无效') : undefined);
  if (node.type === 'stopMusic') return option({ music: '背景音乐通道', sound: '音效通道', ambient: '环境音通道' }, node.properties.channel, 'music', '停止通道无效');
  if (node.type === 'uiAction') return input('screen', 'pause_menu', 'ui');
  if (node.type === 'sceneAction') return text(String(node.properties.command ?? '')) || '未填写演出指令';
  if (node.type === 'comment') return text(String(node.properties.text ?? '')) || undefined;
  if (node.type === 'confirmMessage') return input('message', '确认继续吗？');
  if (node.type === 'showChapter') return input('title', '第一章');
  if (node.type === 'camera') return join(option(uiAnimationEasings, node.properties.easing, 'ease', '缓动方式无效'), inputFields());
  if (node.type === 'savedAction') {
    try {
      const parsed = actionSchema.safeParse(JSON.parse(String(node.properties.action ?? '')));
      if (!parsed.success) return '保存的演出配置无效，原配置已保留';
      const action = parsed.data;
      const kinds: Record<StageAction['kind'], string> = { visual: '画面演出', hideVisual: '隐藏画面对象', background: '背景演出', show: '显示角色', hide: '隐藏角色', music: '音乐演出', sound: '音效演出', unlock: '解锁素材', audioClip: '音频片段', stopMusic: '停止音乐', pause: '等待', hideInterface: '隐藏界面', showInterface: '显示界面', startDialogue: '开始台词', animate: '角色动画', camera: '镜头演出', shake: '画面震动', effect: '演出效果', blueprint: '调用演出', chapter: '章节演出', characterFeature: '角色功能' };
      return join(kinds[action.kind], action.kind === 'pause' ? action.seconds + ' 秒' : undefined,
        node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec' && /asset|duration/.test(pin.id)).slice(0, 2).map(pin => pin.name + ' ' + input(pin.id)).join(' · ') || undefined);
    } catch { return '保存的演出配置无效，原配置已保留'; }
  }
  if (isBlueprintNumericType(node.type) || ['random', 'formatText', 'select', 'not', 'and', 'or', 'xor', 'branch', 'forLoop', 'shake'].includes(node.type)) return inputFields() || undefined;
  // These route-only nodes have no extra stored behavior beyond their ports.
  // A new/unsupported type reaches an explicit problem above, never this list.
  if (['sequence', 'startDialogue', 'return'].includes(node.type)) return undefined;
  return '节点摘要尚未支持此配置，请查看节点参数';
}
