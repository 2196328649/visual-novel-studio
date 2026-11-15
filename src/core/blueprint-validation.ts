import { uiSpineEvents, uiSpineSkinProblem, uiSpineSpeedProblem } from './ui-spine';
import { uiVideoEvents } from './ui-video';
import { uiLayoutProblem, uiLayoutPropertyFields, isUiLayoutObservation } from './ui-layout';
import { uiImageEvents } from './ui-image';
import { isUiControlOptionNode, uiControlOptionsKnown, uiControlOptionPins, uiControlOptionTypes, uiControlOptionTypeProblem, uiControlOptionValueProblem, uiControlOptionUsesValue, uiControlOptionEditInputs, maxUiControlOptionLabel } from './ui-control-options';
import { visitBlueprintOperationClosure } from './blueprint-operation-closure';
import { uiPageInterface, uiPageInterfaceKnown, uiPageNodeContractId, uiPageNodePageId, uiPageNodePins, isUiPageInterfaceNode, uiPageLifecyclePhases, uiPageContractProblem, uiPageClosedOperationProblem } from './ui-page-interface';
import { blueprintExecutionOutputs } from './blueprint-execution-ports';
import { blueprintTaskVersion, blueprintTaskPins, blueprintTaskProblems, blueprintTaskScope, blueprintTaskPageId, isBlueprintTaskNode, isBlueprintTaskLaunch, isBlueprintModuleCall } from './blueprint-tasks';
import { blueprintChoiceDefinition, blueprintChoicePins, isBlueprintChoiceType, selectBlueprintChoice } from './blueprint-choice';
import { blueprintNumericInputs, blueprintNumericOutputType, blueprintRoundModes, evaluateBlueprintNumeric, isBlueprintNumericType } from './blueprint-numeric';
import { blueprintExecutionCycleNode } from './blueprint-execution-ports';
import { blueprintFlowControlInputs, blueprintFlowControlPageId, blueprintFlowControlScope, isBlueprintFlowControl } from './blueprint-flow-control';
import { blueprintStaticInput, unknownBlueprintValue, type StaticValueContext } from './blueprint-static-values';
import { blueprintStatePageId, blueprintStateScope, blueprintStateScopes, blueprintStateVariable, validBlueprintStateValue } from './blueprint-state';
import { uiPage, uiPageOpenProblem } from './ui-pages';
import { blueprintPageOpening, uiPageOpeningProblem } from './ui-page-opening';
import { uiPropertyValueProblem } from './ui-properties';
import { uiBlueprintPathDiagnostics } from './blueprint-execution-analysis';
import { uiPageComponents } from './ui-logic';
import { projectGraphs } from './project-resources';
import { isBlueprintLogicType } from './blueprint-logic';
import { uiAnimationPlayModes } from './ui-animation-clips';
import { parseActorTransitions } from './actor-transitions';
import { actorInstanceProblem } from './actor-instance-identity';
import { uiControlValueType, uiTextInput } from './ui-control-events';
import { isUiButtonEvent } from './ui-button-events';
import { isUiAnimationProperty, uiAnimationEasings } from './ui-animation';
import { timelineInterleaveDiagnostics } from './timeline-interleave';
import { standardUiEventPages } from './ui-logic';
import { nodeMoveOffsets, nodeAfterOffsets } from './move-offsets';
import { blueprintActorInputs } from './blueprint-actor-inputs';
import { declaredUiComponents, effectiveCharacter, variableAssetKind, type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Diagnostic, type ParameterAssetKind, type Project } from './model';
import { blueprintNodeAssetFilter } from './blueprint-assets';
import { parameterKindNames, parameterTypeName } from './parameter-sets';
import { uiProperties, uiPropertyApplies, type UiProperty } from './ui';
import { isUiControlValueProperty, uiControlDefinition, uiControlAssignedValue, uiControlValueProblem, uiControlRangeProblem, isUiControlRangeProperty } from './ui-control-properties';
import { blueprintInputValue, blueprintKeyNames, blueprintScreens, blueprintTypeNames, blueprintTypesCompatible, sceneEntry } from './blueprint';
import { blueprintNameError } from './blueprint-names';
import { textCommandAction } from './text-script';
import { playerPreferences, preferenceInfo, validPlayerPreference, type PlayerPreference } from './preferences';
import { savedBlueprintAction } from './blueprint-authoring';
import { createBlueprintUiPropertyControlAnalysis, blueprintUiPropertyWriteWarning } from './blueprint-ui-property-control';
import { blueprintUiPropertyDefinition, blueprintUiPropertyPins } from './blueprint-ui-property-batch';
import { uiPropertyControlKey } from './ui-property-control';

export function validateBlueprints(project: Project): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const add = (message: string, nodeId?: string) => diagnostics.push({ severity: 'error', message, nodeId } as Diagnostic);
  const graphs = projectGraphs(project) ?? [];
  const components = declaredUiComponents(project);
  const propertyControls = createBlueprintUiPropertyControlAnalysis(project);
  const valueValid = (type: BlueprintPin['dataType'], value: unknown): boolean => {
    if (value === undefined) return true;
    if (value === '' && ['asset', 'character', 'scene', 'ui', 'component'].includes(type)) return true;
    if (type === 'any') return true;
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'string') return typeof value === 'string';
    if (type === 'asset') return project.assets.some(item => item.id === value);
    if (type === 'scene') return project.scenes.some(item => item.id === value);
    if (type === 'character') return project.characters.some(item => item.id === value);
    if (type === 'ui') return typeof value === 'string' && (Object.hasOwn(blueprintScreens, value) || !!uiPage(project, value));
    if (type === 'component') return components.some(item => item.id === value);
    return false;
  };
  const actualType = (graph: BlueprintGraph, node: BlueprintNode, pin: BlueprintPin): BlueprintPin['dataType'] => {
    if (pin.dataType === 'exec') return 'exec';
    if (node.type === 'literal' && pin.dataType === 'any' && node.properties.value !== undefined) return typeof node.properties.value as 'string' | 'number' | 'boolean';
    if (node.type === 'getVariable') return blueprintStateVariable(project, graph, node)?.type ?? pin.dataType;
    if (node.type === 'getInput') return graph.exposedInputs.find(item => item.id === node.properties.inputId)?.dataType ?? pin.dataType;
    return pin.dataType;
  };
  for (const [pageId, definition] of Object.entries(project.ui.pageInterfaces ?? {})) {
    const page = uiPage(project, pageId);
    if (!page) add('页面接口所属页面已不存在：' + pageId + '。');
    if (!uiPageInterfaceKnown(definition)) { add('页面「' + (page?.name ?? pageId) + '」的接口版本不受支持；旧定义已保留，请明确恢复。'); continue; }
    for (const direction of ['inputs', 'outputs'] as const) {
      const ids = new Set<string>(), names = new Set<string>();
      for (const parameter of definition[direction]) {
        if (ids.has(parameter.id) || names.has(parameter.name)) add('页面「' + (page?.name ?? pageId) + '」的接口标识或名称重复：' + parameter.name + '。');
        if (parameter.direction !== (direction === 'inputs' ? 'input' : 'output')) add('页面参数的方向与接口归属不符：' + parameter.name + '。');
        if (!valueValid(parameter.dataType, parameter.defaultValue)) add('页面参数「' + parameter.name + '」的默认值需要有效的' + blueprintTypeNames[parameter.dataType] + '。');
        if (page?.template && direction === 'inputs' && parameter.required && parameter.defaultValue === undefined) add('模板页面输入「' + parameter.name + '」需要默认值，系统操作打开时不能提供作者实参。');
        ids.add(parameter.id); names.add(parameter.name);
      }
    }
  }
  for (const [pageId, variables] of Object.entries(project.ui.pageVariables ?? {})) {
    const page = uiPage(project, pageId);
    if (!page) add('页面状态定义的所属页面已不存在：' + pageId + '。');
    const ids = new Set<string>(), names = new Set<string>();
    for (const variable of variables) {
      if (ids.has(variable.id) || names.has(variable.name)) add('页面“' + (page?.name ?? pageId) + '”的状态标识或名称重复：' + variable.name + '。');
      if (!validBlueprintStateValue(variable.type, variable.initial)) add('页面“' + (page?.name ?? pageId) + '”的状态初始值类型不匹配：' + variable.name + '。');
      ids.add(variable.id); names.add(variable.name);
    }
  }
  for (const page of project.ui.customPages) {
    const problem = uiPageOpeningProblem(project, page.id, page.opening ?? {});
    if (problem) add('页面“' + page.name + '”：' + problem);
  }
  // Close-complete notifications cannot extend an already released page's life.
  for (const owner of graphs) for (const event of owner.nodes.filter(node => node.type === 'eventPage' && node.properties.phase === 'closed')) {
    const reported = new Set<string>();
    const closure = visitBlueprintOperationClosure(project, owner, event, (_, node) => {
      const reason = uiPageClosedOperationProblem(node);
      if (reason && !reported.has(node.id)) { reported.add(node.id); add('关闭通知「' + event.name + '」：' + reason, node.id); }
    });
    for (const issue of closure) if (issue.kind === 'recursion' || issue.kind === 'limit') add('关闭通知的同步模块检查遇到' + (issue.kind === 'recursion' ? '递归调用' : '上下文上限') + '；请拆分并结束通知路线。', issue.nodeId ?? event.id);
  }
  for (const graph of graphs) {
    const localIds = new Set<string>(), localNames = new Set<string>();
    for (const variable of graph.localVariables ?? []) {
      if (localIds.has(variable.id) || localNames.has(variable.name)) add('蓝图“' + graph.name + '”的局部状态标识或名称重复：' + variable.name + '。', graph.nodes[0]?.id);
      if (!validBlueprintStateValue(variable.type, variable.initial)) add('蓝图“' + graph.name + '”的局部初始值类型不匹配：' + variable.name + '。', graph.nodes[0]?.id);
      localIds.add(variable.id); localNames.add(variable.name);
    }
    if (graph.uiPageId && !standardUiEventPages.some(p=>p.id===graph.uiPageId) && !project.ui.customPages.some(p=>p.id===graph.uiPageId)) add(`蓝图“${graph.name}”所属的界面已不存在。`, graph.nodes[0]?.id);
    if (graph.uiInstanceId && graph.uiInstanceId!=='base' && !project.ui.instances?.some(i=>i.id===graph.uiInstanceId)) add(`蓝图“${graph.name}”所属的界面方案已不存在。`, graph.nodes[0]?.id);
    const nameError = blueprintNameError(project, graph.id, graph.name, graph.callName);
    if (nameError) add(`蓝图“${graph.name}”：${nameError}`, graph.nodes[0]?.id);
    const graphNodes = new Map(graph.nodes.map(node => [node.id, node]));
    if (graph.timeline) {
      const trackIds = new Set(graph.timeline.tracks.map(track => track.id));
      const clips = new Set<string>();
      if (trackIds.size !== graph.timeline.tracks.length) add(`蓝图“${graph.name}”的演出轨道标识重复。`, graph.nodes[0]?.id);
      for (const clip of graph.timeline.clips) {
        if (!graphNodes.has(clip.nodeId) || !trackIds.has(clip.trackId)) add(`蓝图“${graph.name}”的演出片段指向已删除的节点或轨道。`, graph.nodes[0]?.id);
        if (clips.has(clip.nodeId)) add(`蓝图“${graph.name}”的同一演出节点重复出现在轨道中。`, clip.nodeId);
        clips.add(clip.nodeId);
      }
      if (graph.timeline.tailNodeId && graphNodes.get(graph.timeline.tailNodeId)?.type !== 'delay') add(`蓝图“${graph.name}”的轨道结束等待节点已失效。`, graph.nodes[0]?.id);
    }
    const staticValues: StaticValueContext = { project, graph, inputs: new Map(), results: new Map(), onRead: () => undefined, uiValue: () => unknownBlueprintValue };
    const linked = (node: BlueprintNode, pinId: string) => graph.links.some(link => link.toNodeId === node.id && link.toPinId === pinId);
    const problem = (node: BlueprintNode, message: string) => add(`“${graph.name} / ${node.name}”：${message}`, node.id);
    const interfaceIds = new Set<string>();
    for (const [direction, pins] of [['input', graph.exposedInputs], ['output', graph.exposedOutputs]] as const) {
      for (const pin of pins) {
        if (interfaceIds.has(pin.id)) add(`蓝图“${graph.name}”的输入或输出标识重复：${pin.name}。`, graph.nodes[0]?.id);
        interfaceIds.add(pin.id);
        if (pin.direction !== direction) add(`蓝图“${graph.name}”的${direction === 'input' ? '输入' : '输出'}方向无效。`, graph.nodes[0]?.id);
        if (pin.dataType === 'exec') add(`蓝图“${graph.name}”的接口“${pin.name}”应选择一种数据类型，执行接口会自动添加。`, graph.nodes[0]?.id);
        else if (!valueValid(pin.dataType, pin.defaultValue)) add(`蓝图“${graph.name}”的“${pin.name}”默认值需要有效的${blueprintTypeNames[pin.dataType]}。`, graph.nodes[0]?.id);
      }
    }
    if (graph.nodes.filter(node => node.type === 'event').length > 1) add(`蓝图“${graph.name}”只能有一个事件开始节点。`, graph.nodes.find(node => node.type === 'event')?.id);
    for (const node of graph.nodes) {
      const controlWarning = blueprintUiPropertyWriteWarning(propertyControls, graph, node);
      if (controlWarning) diagnostics.push({ severity: 'warning', code: 'ui-property-follow-write', nodeId: node.id, message: `“${graph.name} / ${node.name}”：${controlWarning}` });
      if (graph.uiPageId) {
        if (node.properties.componentId && !linked(node, 'componentId')) {
          const scoped = graph.uiInstanceId ? { ...project, ui: { ...project.ui, activeInstanceId: graph.uiInstanceId === 'base' ? undefined : graph.uiInstanceId } } : project;
          if (!uiPageComponents(scoped, graph.uiPageId).some(c => c.id === node.properties.componentId)) problem(node, '组件不属于此页面或界面方案，请传入明确的组件参数或重新选择。');
        }
      }
      if (isBlueprintChoiceType(node.type)) {
        const definition = blueprintChoiceDefinition(node);
        for (const message of definition.problems) problem(node, message);
        const pins = blueprintChoicePins(node);
        if (pins && (pins.length !== node.pins.length || pins.some(expected => !node.pins.some(pin => pin.id === expected.id && pin.direction === expected.direction && pin.dataType === expected.dataType)))) problem(node, '多路节点的连接点与分支定义不一致，请恢复连接点定义。');
        const key = blueprintStaticInput(staticValues, node, 'key');
        if (key !== unknownBlueprintValue && !definition.problems.length) { const selected = selectBlueprintChoice(node, key); if (!selected.ok) problem(node, selected.message); }
      }
      if (isBlueprintNumericType(node.type)) {
        const inputs = blueprintNumericInputs[node.type];
        for (const expected of [...inputs.map(pin => ({ ...pin, direction: 'input' })), { id: 'result', dataType: blueprintNumericOutputType(node.type), direction: 'output' }]) {
          const pin = node.pins.find(pin => pin.id === expected.id);
          if (!pin || pin.dataType !== expected.dataType || pin.direction !== expected.direction) problem(node, '数值运算的输入或结果连接点类型无效，请恢复该节点定义。');
        }
        if (node.pins.some(pin => pin.dataType === 'exec')) problem(node, '数值运算是数据节点，不使用执行连线。');
        if (node.type === 'round' && !Object.hasOwn(blueprintRoundModes, String(node.properties.mode ?? 'nearest'))) problem(node, '请选择有效的取整方式。');
        const values = new Map(inputs.map(pin => [pin.id, blueprintStaticInput(staticValues, node, pin.id)]));
        if (![...values.values()].includes(unknownBlueprintValue)) {
          const result = evaluateBlueprintNumeric(node.type, id => values.get(id), node.properties.mode ?? 'nearest');
          if (!result.ok) problem(node, result.message);
        }
      }
      if (isBlueprintLogicType(node.type)) {
        const inputs = node.type === 'not' ? ['a'] : ['a', 'b'];
        for (const id of [...inputs, 'result']) {
          const pin = node.pins.find(pin => pin.id === id);
          if (!pin || pin.dataType !== 'boolean' || pin.direction !== (id === 'result' ? 'output' : 'input')) problem(node, '逻辑节点需要开关类型的条件输入和结果输出。');
        }
        if (node.pins.some(pin => pin.dataType === 'exec')) problem(node, '逻辑运算是数据节点，不使用执行连线。');
      }
      if (node.properties.actorTransitions) { try { parseActorTransitions(node.properties.actorTransitions); } catch { problem(node, '角色过渡设置无效，请检查过渡方式，时长不能为负数。'); } }
      const pinIds = new Set<string>();
      for (const pin of node.pins) {
        if (pinIds.has(pin.id)) problem(node, `连接点名称重复：${pin.name}。`);
        pinIds.add(pin.id);
        if (pin.dataType !== 'exec' && !valueValid(pin.dataType, pin.defaultValue)) problem(node, `“${pin.name}”默认值需要有效的${blueprintTypeNames[pin.dataType]}。`);
      }
      const resource = (key: string, label: string, type: BlueprintPin['dataType'], kind?: 'image' | 'audio') => {
        if (linked(node, key)) return;
        const value = blueprintInputValue(node, key);
        if (value === undefined || value === '') { problem(node, `请选择${label}。`); return; }
        if (!valueValid(type, value)) problem(node, `${label}已不存在，请重新选择。`);
        else if (kind && project.assets.find(item => item.id === value)?.kind !== kind) problem(node, `${label}需要${kind === 'image' ? '图片' : '音频'}素材。`);
      };
      const number = (key: string, label: string, min?: number, max?: number, integer = false) => {
        if (linked(node, key)) return;
        const value = blueprintInputValue(node, key);
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < (min ?? -Infinity) || value > (max ?? Infinity) || (integer && !Number.isInteger(value)))) problem(node, min === undefined && max === undefined ? `${label}需要有效的数值。` : `${label}需要 ${min}～${max} 之间的${integer ? '整数' : '数值'}。`);
      };
      if (isUiPageInterfaceNode(node.type)) {
        const contractId = uiPageNodeContractId(graph, node), definition = uiPageInterface(project, contractId);
        if (!uiPage(project, contractId)) problem(node, '请选择有效的页面接口声明。');
        if (!uiPageInterfaceKnown(definition)) problem(node, '页面接口版本不受支持，旧连接点保留；请明确恢复。');
        const expected = uiPageNodePins(project, graph, node);
        if (expected?.some(pin => !node.pins.some(actual => actual.id === pin.id && actual.direction === pin.direction && actual.dataType === pin.dataType))) problem(node, '页面连接点与接口定义不同步，请重新选择页面或参数。');
        if (node.type === 'eventPage') {
          if (!Object.hasOwn(uiPageLifecyclePhases, String(node.properties.phase))) problem(node, '请选择有效的页面生命周期时机。');
          if (graph.uiPageId && uiPageNodePageId(graph, node) !== graph.uiPageId) problem(node, '页面生命周期事件必须属于当前事件图的页面。');
        }
        if (['getPageInput', 'getPageOutput', 'setPageOutput'].includes(node.type)) {
          const parameter = (node.type === 'getPageInput' ? definition?.inputs : definition?.outputs)?.find(parameter => parameter.id === node.properties.parameterId);
          if (!parameter) problem(node, '页面输入或结果参数已不存在，请重新选择；旧连线已保留。');
        }
        if (!linked(node, 'pageId') && node.type !== 'eventPage') {
          const reason = uiPageContractProblem(project, uiPageNodePageId(graph, node), contractId);
          if (reason) problem(node, reason);
        }
        for (const pin of node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec')) {
          if (linked(node, pin.id)) continue;
          const value = blueprintInputValue(node, pin.id);
          if (pin.required && value === undefined) problem(node, '缺少页面必填输入「' + pin.name + '」。');
          if (value !== undefined && !valueValid(pin.dataType, value)) problem(node, '页面参数「' + pin.name + '」类型或引用不匹配。');
        }
      }
      if (node.type === 'event' && !node.pins.some(pin => pin.direction === 'output' && pin.dataType === 'exec')) problem(node, '缺少开始执行连接点。');
      if (['eventKey', 'eventTimer', 'showUiPage', 'closeUiPage'].includes(node.type) && !linked(node, 'pageId') && !uiPage(project, String(blueprintInputValue(node, 'pageId') ?? ''))) problem(node, '请选择有效的页面；内置模板和新增页面使用同一页面目录。');
      if (node.type === 'showUiPage' && !linked(node, 'pageId')) {
        const reason = uiPageOpenProblem(project, String(blueprintInputValue(node, 'pageId') ?? ''), linked(node, 'wait') ? undefined : blueprintInputValue(node, 'wait') !== false, linked(node, 'modalMode') ? undefined : String(blueprintInputValue(node, 'modalMode') ?? 'page'));
        if (reason) problem(node, reason);
      }
      if (node.type === 'eventKey' && !Object.hasOwn(blueprintKeyNames, String(node.properties.key))) problem(node, '请选择有效的按键。');
      if (node.type === 'showUiPage' && !linked(node, 'modalMode') && !['page', 'modal', 'modeless', 'passthrough'].includes(String(blueprintInputValue(node, 'modalMode') ?? 'page'))) problem(node, '请选择有效的底层输入设置。');
      if (node.type === 'showUiPage' && !['pageId', 'wait', 'modalMode'].some(pin => linked(node, pin))) {
        const pageId = String(blueprintInputValue(node, 'pageId') ?? '');
        if (uiPage(project, pageId)) { const openingProblem = uiPageOpeningProblem(project, pageId, blueprintPageOpening(project, pageId, node)); if (openingProblem) problem(node, openingProblem); }
      }
      if (node.type === 'closeUiPage' && !linked(node, 'pageId')) {
        const page = uiPage(project, String(blueprintInputValue(node, 'pageId') ?? ''));
        if (page?.template && !page.menuScreen) problem(node, '此模板的生命周期由系统操作管理，不能直接关闭。');
      }
      if (node.type === 'showUiPage' && node.properties.pageId === 'ui:save' && !linked(node, 'saveMode') && !['save', 'load'].includes(String(blueprintInputValue(node, 'saveMode') ?? 'load'))) problem(node, '请选择保存或读取作为页面用途。');
      if (node.type === 'closeUiPage' && !linked(node, 'reason') && !['completed', 'cancelled'].includes(String(blueprintInputValue(node, 'reason') ?? 'completed'))) problem(node, '请选择完成或取消作为关闭原因。');
      if (node.type === 'eventTimer' && (typeof node.properties.interval !== 'number' || !Number.isFinite(node.properties.interval) || node.properties.interval <= 0)) problem(node, '定时间隔需要大于 0 秒。');
      if (['eventTimer','eventKey','eventPage'].includes(node.type) && node.properties.uiInstanceId && node.properties.uiInstanceId !== 'base' && !project.ui.instances?.some(instance => instance.id === node.properties.uiInstanceId)) problem(node, '界面事件引用的方案不存在，请重新选择作用范围。');
      if (['eventClick','eventButton'].includes(node.type) && !components.some(component => component.id === node.properties.componentId && component.kind === 'button')) problem(node, '请选择一个按钮作为点击事件来源。');
      if(node.type==='eventTextCommitted'&&!uiTextInput(project,components.find(c=>c.id===node.properties.componentId)))problem(node,'请选择绑定自由文字参数的输入控件。');
      if(node.type==='eventValueChanged'&&!uiControlValueType(project,components.find(c=>c.id===node.properties.componentId)))problem(node,'请选择已绑定参数的滑块、选项或输入控件。');
      if (node.type === 'eventImage' && (!components.some(c => c.id === node.properties.componentId && c.kind === 'image') || !Object.hasOwn(uiImageEvents, String(node.properties.trigger)))) problem(node, '请选择当前页面的图片和有效的加载成功/失败事件。');
      if (node.type === 'eventSpine' && (!components.some(c => c.id === node.properties.componentId && c.kind === 'spine') || !Object.hasOwn(uiSpineEvents, String(node.properties.trigger)))) problem(node, '请选择当前页面的骨骼和有效的动画完成或失败事件。');
      if (node.type === 'eventVideo' && (!components.some(c => c.id === node.properties.componentId && c.kind === 'video') || !Object.hasOwn(uiVideoEvents, String(node.properties.trigger)))) problem(node, '请选择当前页面的视频和有效的播放结束/失败事件。');
      if(node.type==='eventButton'&&!isUiButtonEvent(String(node.properties.trigger)))problem(node,'请选择有效的按钮交互事件。');
      if(['eventButton','eventValueChanged','eventTextCommitted','eventImage', 'eventVideo', 'eventSpine'].includes(node.type)&&node.properties.uiInstanceId&&node.properties.uiInstanceId!=='base'&&!project.ui.instances?.some(i=>i.id===node.properties.uiInstanceId))problem(node,'界面事件引用的方案已不存在。');
      if (node.type === 'shake') { number('duration', '震动时长', 0); number('amplitude', '震动幅度'); }
      if (node.type === 'return' && !node.pins.some(pin => pin.direction === 'input' && pin.dataType === 'exec')) problem(node, '缺少执行输入连接点。');
      if (isBlueprintModuleCall(node.type)) {
        const called = graphs.find(item => item.id === node.properties.graphId);
        if (!called) problem(node, '请选择要调用的蓝图。');
        else called.exposedInputs.forEach((pin, index) => {
          const stable = `arg_${pin.id}`;
          const legacy = `arg_${index}`;
          const signature = node.pins.find(item => item.id === stable) ?? node.pins.find(item => item.id === legacy);
          if (!signature) problem(node, `缺少调用参数“${pin.name}”连接点。`);
          else if (!blueprintTypesCompatible(signature.dataType, pin.dataType)) problem(node, `参数“${pin.name}”类型不匹配。`);
          if (!linked(node, stable) && !linked(node, legacy)) {
            const value = node.properties[stable] ?? node.properties[legacy] ?? pin.defaultValue;
            if (pin.required && (value === undefined || (['asset', 'scene', 'character', 'ui', 'component'].includes(pin.dataType) && value === ''))) problem(node, `请填写必填参数“${pin.name}”或连接数据线。`);
            else if (!valueValid(pin.dataType, value)) problem(node, `参数“${pin.name}”需要有效的${blueprintTypeNames[pin.dataType]}。`);
          }
        });
      }
      if (isBlueprintTaskNode(node.type)) {
        if (node.properties.taskVersion !== blueprintTaskVersion) problem(node, '任务节点版本无法识别；原引脚及参数已保留，请显式恢复或重新创建，不自动转换。');
        if (['throttle', 'startTask', 'debounce'].includes(node.type)) {
          if (!['call', 'page'].includes(String(node.properties.scope))) problem(node, '任务生命周期只支持本次调用或页面实例。');
          number('seconds', node.type === 'throttle' ? '冷却秒数' : '延后秒数', 0);
          if (blueprintTaskScope(node) === 'page') {
            const page = linked(node, 'pageId') ? blueprintStaticInput(staticValues, node, 'pageId') : blueprintTaskPageId(graph, node);
            if (page !== unknownBlueprintValue && (typeof page !== 'string' || !uiPage(project, page))) problem(node, '请选择有效的所属页面或连接页面参数；页面任务不会自动归属编辑器当前页面。');
          }
        }
        if (node.type === 'startTask' && !['parallel', 'replace', 'ignore'].includes(String(node.properties.conflict))) problem(node, '请选择有效的重复启动策略。');
        if (isBlueprintTaskLaunch(node.type)) for (const issue of blueprintTaskProblems(project, String(node.properties.graphId ?? ''))) problem(node, '任务模块 / ' + issue.message);
        if (node.type === 'waitTask' && node.properties.graphId && !graphs.some(item => item.id === node.properties.graphId)) problem(node, '等待任务的结果模块已不存在；保留原输出供修复。');
        if (['waitTask', 'cancelTask', 'taskStatus'].includes(node.type) && !linked(node, 'handle') && typeof blueprintInputValue(node, 'handle') !== 'string') problem(node, '任务标识必须是启动任务产生的文字标识。');
        if (node.type === 'waitTask' && node.properties.graphId) {
          const link = graph.links.find(link => link.toNodeId === node.id && link.toPinId === 'handle'), source = graph.nodes.find(item => item.id === link?.fromNodeId);
          if (source && isBlueprintTaskLaunch(source.type) && source.properties.graphId !== node.properties.graphId) problem(node, '等待任务的输出类型与所连接任务模块不一致。');
        }
        if (node.properties.taskVersion === blueprintTaskVersion) for (const pin of blueprintTaskPins(node, graphs.find(item => item.id === node.properties.graphId))) {
          if (!node.pins.some(item => item.id === pin.id && item.direction === pin.direction && item.dataType === pin.dataType)) problem(node, '任务节点缺少有效连接点：' + pin.name + '。');
        }
      }
      if (isBlueprintFlowControl(node.type)) {
        if (node.properties.scope !== undefined && !['call', 'page'].includes(String(node.properties.scope))) problem(node, '状态型节点只支持本次调用或页面实例，作品/玩家状态请显式读写作者变量。');
        if (node.properties.initiallyClosed !== undefined && typeof node.properties.initiallyClosed !== 'boolean') problem(node, '初始关闭状态必须为开关。');
        const entries = blueprintFlowControlInputs(node.type);
        for (const id of entries) if (!node.pins.some(pin => pin.id === id && pin.direction === 'input' && pin.dataType === 'exec')) problem(node, '状态型节点缺少有效的执行入口：' + id + '。');
        for (const pin of node.pins.filter(pin => pin.direction === 'input' && pin.dataType === 'exec')) if (!entries.includes(pin.id)) problem(node, '状态型节点不支持此执行入口：' + pin.id + '。');
        for (const id of ['exec_out', 'blocked', 'updated']) if (!node.pins.some(pin => pin.id === id && pin.direction === 'output' && pin.dataType === 'exec')) problem(node, '状态型节点缺少有效的执行出口：' + id + '。');
        if (blueprintFlowControlScope(node) === 'page') {
          const pageId = linked(node, 'pageId') ? blueprintStaticInput(staticValues, node, 'pageId') : blueprintFlowControlPageId(graph, node);
          if (pageId !== unknownBlueprintValue && (typeof pageId !== 'string' || !uiPage(project, pageId))) problem(node, '页面实例门控需要明确的有效页面，或连入运行时页面参数；不会自动使用编辑器当前页面。');
        }
      }
      if (node.type === 'getVariable' || node.type === 'setVariable') {
        const scope = blueprintStateScope(project, node), variable = blueprintStateVariable(project, graph, node);
        if (node.properties.scope !== undefined && !Object.hasOwn(blueprintStateScopes, String(node.properties.scope))) problem(node, '状态作用域无效。');
        if (scope === 'page' && !uiPage(project, blueprintStatePageId(graph, node))) problem(node, '页面实例状态需要明确的所属页面，不能自动绑定到编辑器当前页面。');
        if (scope === 'page' && variable && linked(node, 'pageId')) {
          const targetId = blueprintStaticInput(staticValues, node, 'pageId');
          if (targetId !== unknownBlueprintValue) {
            const target = typeof targetId === 'string' ? uiPage(project, targetId) : undefined;
            const targetVariable = target && project.ui.pageVariables?.[target.id]?.find(item => item.id === variable.id);
            if (!target) problem(node, '页面输入的目标页面已不存在，请修复接线或重新选择。');
            else if (!targetVariable) problem(node, '目标页面“' + target.name + '”未声明此状态变量，请选择兼容的页面或变量。');
            else if (targetVariable.type !== variable.type) problem(node, '目标页面“' + target.name + '”的状态类型与当前蓝图声明不匹配。');
          }
        }
        if (!variable) problem(node, '请选择有效的' + blueprintStateScopes[scope].name + '变量；已删除的引用会保留，便于修复。');
        else if (node.type === 'setVariable' && !linked(node, 'value') && !valueValid(variable.type, blueprintInputValue(node, 'value'))) problem(node, `“${variable.name}”的新值需要${blueprintTypeNames[variable.type]}。`);
      }
      if (node.type === 'getInput' && !graph.exposedInputs.some(pin => pin.id === node.properties.inputId)) problem(node, '请选择本蓝图的输入参数；可在“输入与输出”中添加。');
      if (node.type === 'setOutput') {
        const output = graph.exposedOutputs.find(pin => pin.id === node.properties.outputId);
        if (!output) problem(node, '请选择本蓝图的输出结果；可在“输入与输出”中添加。');
        else if (!linked(node, 'value') && !valueValid(output.dataType, blueprintInputValue(node, 'value'))) problem(node, `输出“${output.name}”需要${blueprintTypeNames[output.dataType]}。`);
      }
      if (node.type === 'literal') {
        const pin = node.pins.find(pin => pin.direction === 'output');
        if (pin && !valueValid(pin.dataType, node.properties.value)) problem(node, `固定值需要有效的${blueprintTypeNames[pin.dataType]}。`);
      }
      if (['showCharacter'].includes(node.type) && node.properties.afterOffsets) { try { nodeAfterOffsets(node); } catch { problem(node, '入场后关键帧无效，请检查时间与数值。'); } }
      if (['showCharacter'].includes(node.type) && node.properties.moveOffsets) { try { nodeMoveOffsets(node); } catch { problem(node, '移动偏移关键帧无效，请检查进度与数值。'); } }
      if (node.type === 'showBackground') resource('assetId', '背景', 'asset', 'image');
      if (node.type === 'playMusic' || node.type === 'playSound') resource('assetId', node.type === 'playMusic' ? '音乐' : '音效', 'asset', 'audio');
      if (node.type === 'showCharacter' && blueprintInputValue(node, 'characterId') || node.type === 'hideCharacter') resource('characterId', '角色', 'character');
      if (['showCharacter', 'hideCharacter'].includes(node.type)) {
        const instance = blueprintInputValue(node, 'instanceId'), lifetime = blueprintInputValue(node, 'lifetime');
        const instanceProblem = actorInstanceProblem(instance);
        if (!linked(node, 'instanceId') && instanceProblem) problem(node, instanceProblem);
        if (lifetime && !linked(node, 'lifetime') && !['line', 'persistent'].includes(String(lifetime))) problem(node, '显示范围请选择仅本句或持续显示。');
      }
      if (node.type === 'showCharacter') {
        for (const issue of blueprintActorInputs(project, graph, node).problems) {
          diagnostics.push({ severity: issue.severity, code: issue.code, nodeId: node.id, message: `“${graph.name} / ${node.name}”：${issue.message}` });
        }
        number('x', '横向位置'); number('y', '纵向位置'); number('scale', '角色大小'); number('layer', '层级', undefined, undefined, true);
      }
      if (node.type === 'showChapter') {
        number('duration', '章节时长', 0);
        for (const [key, name, kind] of [['backgroundId', '章节背景', 'image'], ['titleImageId', '章节题图', 'image'], ['soundId', '章节音效', 'audio']] as const) if (blueprintInputValue(node, key)) resource(key, name, 'asset', kind);
        if (!linked(node, 'effect') && !['', 'none', 'fade', 'ink'].includes(String(blueprintInputValue(node, 'effect') ?? ''))) problem(node, '请选择有效的章节动效。');
      }
      if (node.type === 'camera') { number('x', '镜头横向位置'); number('y', '镜头纵向位置'); number('zoom', '镜头缩放'); number('rotation', '镜头旋转'); number('duration', '镜头时长', 0); }
      if (node.type === 'savedAction' && !savedBlueprintAction(node)) problem(node, '保存的演出数据无效，请重新封装。');
      if (node.type === 'switchScene') {
        resource('sceneId', '目标场景', 'scene');
        if (!linked(node, 'sceneId') && project.scenes.some(item => item.id === node.properties.sceneId) && !sceneEntry(project, String(node.properties.sceneId))) problem(node, '目标场景还没有剧情，请先添加一个段落。');
        number('duration', '转场秒数', 0);
        if (node.properties.mode !== undefined && !['none', 'dissolve', 'fade'].includes(String(node.properties.mode))) problem(node, '请选择有效的转场方式。');
        if (node.properties.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(node.properties.color))) problem(node, '转场颜色无效，请重新选择颜色。');
      }
      if (['showBackground', 'showCharacter', 'hideCharacter'].includes(node.type) && node.properties.transition !== undefined && !['none', 'dissolve', 'fade', 'move'].includes(String(node.properties.transition))) problem(node, '请选择有效的出现或离开方式。');
      if (node.type === 'playMusic' || node.type === 'stopMusic') number('fade', '淡入淡出秒数', 0);
      if (['playMusic', 'playSound'].includes(node.type) && !linked(node, 'loop') && node.properties.loop !== undefined && typeof node.properties.loop !== 'boolean') problem(node, '循环播放需要选择是或否。');
      if (node.type === 'uiAction') resource('screen', '游戏界面', 'ui');
      if (node.type === 'playSound' && node.properties.channel !== undefined && !['sound', 'ambient'].includes(String(node.properties.channel))) problem(node, '请选择音效或环境音通道。');
      if (node.type === 'stopMusic' && node.properties.channel !== undefined && !['music', 'sound', 'ambient'].includes(String(node.properties.channel))) problem(node, '请选择背景音乐、音效或环境音通道。');
      if (node.type === 'getPlayerPreference' || node.type === 'setPlayerPreference') {
        const preference = playerPreferences[node.properties.preference as PlayerPreference];
        if (!preference) problem(node, '请选择有效的玩家设置。');
        else if (node.type === 'setPlayerPreference' && !linked(node, 'value') && !validPlayerPreference(String(node.properties.preference), blueprintInputValue(node, 'value'))) problem(node, `“${preferenceInfo(project, node.properties.preference as PlayerPreference).name}”的设置值无效。`);
        if (node.properties.preference === 'characterVolume' && blueprintInputValue(node, 'characterId') !== undefined && blueprintInputValue(node, 'characterId') !== '') resource('characterId', '角色', 'character');
      }
      if (node.type === 'setMinigameValue' || node.type === 'getMinigameValue') {
        if (typeof node.properties.key !== 'string' || !node.properties.key.trim()) problem(node, '请填写小游戏状态名称。');
        if (node.type === 'getMinigameValue') {
          const output = node.pins.find(pin => pin.id === 'value');
          if (output && !valueValid(output.dataType, node.properties.defaultValue)) problem(node, `默认值需要有效的${blueprintTypeNames[output.dataType]}。`);
        }
      }
      if (node.type === 'finishMinigame' && !['success', 'failure', 'cancel'].includes(String(node.properties.result))) problem(node, '请选择成功、失败或取消结果。');
      if (node.type === 'playUiAnimation') {
        if (!Object.hasOwn(uiAnimationPlayModes, String(node.properties.playMode ?? 'forward'))) problem(node, '请选择正放、倒放或往返。');
        number('loops', '循环次数', 0, undefined, true);
        number('speed', '播放速度', .01);
      }
      if (['playUiAnimation','stopUiAnimationPlayback'].includes(node.type) && !project.ui.animations?.some(a=>a.id===node.properties.animationId)) problem(node, '请选择有效的界面动画。');
      if (['editUiControlOptions', 'getUiControlOption', 'focusUiComponent', 'setUiControlRange', 'resetUiControlRange', 'setUiProperty', 'getUiProperty', 'getUiDefault', 'resetUiProperty', 'animateUiProperty', 'stopUiAnimation', 'resetUiComponent', 'playUiVideo', 'pauseUiVideo', 'stopUiVideo', 'playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type)) {
        resource('componentId', '界面组件', 'component');
        const component = propertyControls.component(graph, node) ?? components.find(item => item.id === blueprintInputValue(node, 'componentId'));
        const control = !linked(node, 'componentId') && component ? uiControlDefinition(project, component) : undefined;
        if (isUiControlOptionNode(node.type)) {
          const expected = uiControlOptionPins(node), typed = uiControlOptionUsesValue(node), valueType = String(node.properties.valueType ?? 'string');
          if (!uiControlOptionsKnown(node)) problem(node, '此选项节点版本尚不受支持；原参数和引脚已保留，请明确恢复。');
          else if (!expected) problem(node, '选项操作或值类型无效；请选择有效配置。');
          else if (expected.length !== node.pins.length || expected.some(pin => !node.pins.some(current => current.id === pin.id && current.direction === pin.direction && current.dataType === pin.dataType))) problem(node, '选项节点的引脚与操作/类型不一致，请重新同步。');
          if (!linked(node, 'componentId')) {
            if (!control?.choice) problem(node, '选项操作只适用于选择控件，不能把自由输入框或滑条变成列表。');
            else if (typed) { const issue = uiControlOptionTypeProblem(control, valueType); if (issue) problem(node, issue); }
          }
          const operands = node.type === 'getUiControlOption' ? ['index'] : uiControlOptionEditInputs(node);
          for (const key of ['index', 'toIndex']) if (operands.includes(key) && !linked(node, key) && !Number.isSafeInteger(blueprintInputValue(node, key))) problem(node, (key === 'index' ? '选项索引' : '目标索引') + '必须是有限安全整数；是否越界由运行时有效列表判断。');
          if (operands.includes('label') && !linked(node, 'label')) { const label = blueprintInputValue(node, 'label'); if (typeof label !== 'string' || !label.length || Array.from(label).length > maxUiControlOptionLabel) problem(node, '选项标签需要 1～' + maxUiControlOptionLabel + ' 个 Unicode 字符。'); }
          if (operands.includes('value') && !linked(node, 'value')) {
            const value = blueprintInputValue(node, 'value');
            if (Object.hasOwn(uiControlOptionTypes, valueType) && !valueValid(valueType as BlueprintPin['dataType'], value)) problem(node, '选项值必须符合所选类型，数值必须有限；不会自动转换原值。');
            else if (control) { const issue = uiControlOptionValueProblem(control, value); if (issue) problem(node, issue); }
          }
        }
        if (node.type === 'focusUiComponent' && !linked(node, 'componentId') && !control?.textInput) problem(node, '焦点操作只适用于自由文字输入控件。');
        if (['setUiControlRange', 'resetUiControlRange'].includes(node.type) && !linked(node, 'componentId') && (!control || control.type !== 'number')) problem(node, '请选择已绑定的数值控件。');
        if (node.type === 'setUiControlRange') {
          number('minimum', '范围下限'); number('maximum', '范围上限'); number('step', '调整步长');
          if (!linked(node, 'step') && Number(blueprintInputValue(node, 'step')) <= 0) problem(node, '控件步长必须大于 0。');
          if (['minimum', 'maximum', 'step'].every(pin => !linked(node, pin))) {
            const issue = uiControlRangeProblem(control, { min: blueprintInputValue(node, 'minimum') as number, max: blueprintInputValue(node, 'maximum') as number, step: blueprintInputValue(node, 'step') as number });
            if (issue) problem(node, issue);
          }
        }
        if (['playUiVideo', 'pauseUiVideo', 'stopUiVideo'].includes(node.type) && !linked(node, 'componentId') && component && component.kind !== 'video') problem(node, '请选择视频组件。');
        if (['playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type) && !linked(node, 'componentId') && component && component.kind !== 'spine') problem(node, '请选择骨骼动画组件。');
        if (node.type === 'getUiProperty' || node.type === 'getUiDefault' || node.type === 'resetUiProperty' || node.type === 'animateUiProperty') {
          const property = uiProperties[node.properties.property as UiProperty];
          if (!property) problem(node, '请选择有效的组件属性。');
          else if (['setUiProperty', 'resetUiProperty', 'animateUiProperty'].includes(node.type) && !property.writable) problem(node, '此属性是只读的运行观察值，只能读取，不能赋值、动画或重置。');
          else if (!linked(node, 'componentId') && component && uiLayoutProblem(component) && (Object.hasOwn(uiLayoutPropertyFields, String(node.properties.property)) || isUiLayoutObservation(String(node.properties.property)))) problem(node, uiLayoutProblem(component)!);
          else if (!linked(node, 'componentId') && component && !uiPropertyApplies(component, node.properties.property as UiProperty, project)) problem(node, '所选属性不适用于此组件；文字用于固定文字与按钮，启用和选中用于按钮。');
          else if (['setUiProperty','animateUiProperty'].includes(node.type) && !linked(node, 'value')) {
            if (!valueValid(property.type, blueprintInputValue(node, 'value'))) problem(node, `“${property.name}”需要${blueprintTypeNames[property.type]}。`);
            const valueProblem = uiPropertyValueProblem(project, String(node.properties.property), blueprintInputValue(node, 'value'));
            if (valueProblem) problem(node, valueProblem);
            else if (!linked(node, 'componentId') && component && isUiControlValueProperty(String(node.properties.property))) {
              const control = uiControlDefinition(project, component);
              if (node.properties.property === 'optionIndex') {
                const index = blueprintInputValue(node, 'value');
                if (!Number.isSafeInteger(index) || Number(index) < 0) problem(node, '选项索引必须是非负安全整数；是否存在由运行时有效列表判断。');
              } else if (control) try {
                const assigned = uiControlAssignedValue(control, String(node.properties.property), blueprintInputValue(node, 'value')!);
                const controlProblem = uiControlValueProblem({ ...control, choice: false, range: control.preference ? control.sourceRange : undefined }, assigned, Infinity); // The effective range and length may change earlier in the graph.
                if (controlProblem) problem(node, controlProblem);
              } catch (error) { problem(node, error instanceof Error ? error.message : String(error)); }
            }
          }
        }
        if (node.type === 'setUiProperty') {
          const definition = blueprintUiPropertyDefinition(node), expected = blueprintUiPropertyPins(node);
          const batchComponent = propertyControls.component(graph, node), batchControl = batchComponent ? uiControlDefinition(project, batchComponent) : undefined;
          for (const message of definition.problems) problem(node, message);
          if (expected && (expected.length !== node.pins.length || expected.some(pin => !node.pins.some(current => current.id === pin.id && current.direction === pin.direction && current.dataType === pin.dataType)))) problem(node, '组件属性节点的连接点与属性列表不同步，请重新同步。');
          const canonical = new Set<string>(), parameterWrites = new Map<string, { value: unknown; property: string }>(), range = new Map<string, number>();
          for (const row of definition.rows ?? []) {
            if (!Object.hasOwn(uiProperties, row.property)) continue;
            const name = uiProperties[row.property as UiProperty].name, info = uiProperties[row.property as UiProperty];
            const rowProblem = (message: string) => problem(node, '属性“' + name + '”：' + message);
            if (!info.writable) rowProblem('此属性是只读的运行观察值，只能读取，不能赋值、动画或重置。');
            if (batchComponent) {
              if (uiLayoutProblem(batchComponent) && (Object.hasOwn(uiLayoutPropertyFields, row.property) || isUiLayoutObservation(row.property))) rowProblem(uiLayoutProblem(batchComponent)!);
              if (!uiPropertyApplies(batchComponent, row.property as UiProperty, project)) rowProblem('所选属性不适用于此组件。');
              else {
                const key = uiPropertyControlKey(project, batchComponent, row.property as UiProperty);
                if (canonical.has(key)) rowProblem('同一当前值的属性或别名重复，不能在一组中写入多次。');
                canonical.add(key);
              }
            }
            // Constant linked expressions are as definite as stored values; UI
            // reads and live parameters deliberately remain unknown here.
            const value = blueprintStaticInput(staticValues, node, row.id);
            if (value !== unknownBlueprintValue) {
              const issue = uiPropertyValueProblem(project, row.property, value);
              if (issue) rowProblem(issue);
              else if (row.property === 'optionIndex' && (!Number.isSafeInteger(value) || Number(value) < 0)) rowProblem('选项索引必须是非负安全整数；是否存在由运行时有效列表判断。');
              else if (batchControl && isUiControlValueProperty(row.property) && row.property !== 'optionIndex' && row.property !== 'normalizedValue') {
                const issue = batchControl.preference && !validPlayerPreference(batchControl.preference, value) ? '控件值超出玩家设置的引擎边界。'
                  : uiControlValueProblem({ ...batchControl, choice: false, range: undefined }, value!, Infinity);
                if (issue) rowProblem(issue);
              }
              if (isUiControlRangeProperty(row.property) && typeof value === 'number' && Number.isFinite(value)) {
                range.set(row.property, value);
                const limit = batchControl?.preference ? playerPreferences[batchControl.preference].limit : undefined;
                if (row.property !== 'step' && limit && (value < limit.min || limit.max !== undefined && value > limit.max)) rowProblem('控件范围不能超过玩家设置的引擎边界。');
              }
            }
            const target = propertyControls.property(graph, node, row.property);
            if (row.writeMode === 'source' && !isUiControlValueProperty(row.property) && !propertyControls.mayUsePropertySource(graph, node, row.property)) rowProblem('此属性没有可写的控件值绑定源；请选择临时覆盖，或在控件属性中配置双向同步。');
            // Follow remains a warning for old graphs. Only valid sync sources
            // and direct values establish a definite same-parameter conflict.
            const parameterId = target?.control.mode === 'sync' && !target.problem ? target.control.parameterId
              : !target && row.writeMode === 'source' && isUiControlValueProperty(row.property) && !propertyControls.mayUsePropertySource(graph, node, row.property) ? batchControl?.parameterId : undefined;
            if (parameterId && value !== unknownBlueprintValue && value !== undefined && row.property !== 'normalizedValue' && row.property !== 'optionIndex') {
              const previous = parameterWrites.get(parameterId), parameterName = project.variables.find(parameter => parameter.id === parameterId)?.name ?? parameterId;
              if (previous && previous.value !== value) rowProblem('与属性“' + previous.property + '”写入同一参数“' + parameterName + '”，不能在同一次操作中写入不同的值。');
              else parameterWrites.set(parameterId, { value, property: name });
            }
          }
          // Do not substitute the design-time counterpart: an earlier node may
          // have moved it. Only bounds supplied by this group prove a conflict.
          const minimum = range.get('minimum'), maximum = range.get('maximum'), step = range.get('step');
          if (minimum !== undefined && maximum !== undefined) {
            if (minimum > maximum) problem(node, '控件范围下限不能大于上限；这组属性不会写入任何一项。');
            else if (!Number.isFinite(maximum - minimum)) problem(node, '控件范围跨度过大；这组属性不会写入任何一项。');
            else if (step !== undefined && maximum > minimum && step / (maximum - minimum) === 0) problem(node, '控件步长相对范围过小，无法表示用户调整。');
          }
        }
        if (node.type === 'animateUiProperty') {
          if (!isUiAnimationProperty(String(node.properties.property))) problem(node, '控件动画仅支持位置、大小、不透明度和进度数值属性。');
          if (!Object.hasOwn(uiAnimationEasings, String(node.properties.easing ?? 'ease'))) problem(node, '请选择有效的控件动画缓动。');
          number('duration', '持续秒数', 0);
        }
        if (node.type === 'stopUiAnimation' && node.properties.property !== 'all' && !isUiAnimationProperty(String(node.properties.property))) problem(node, '请选择要停止的动画属性或全部属性。');
        if (node.type === 'playSpine' && !linked(node, 'animation')) {
          const animation = blueprintInputValue(node, 'animation');
          if (typeof animation !== 'string' || !animation) problem(node, '请选择要播放的动画。');
          else if (!project.assets.some(asset => asset.kind === 'spine' && asset.spine?.animations.some(item => item.name === animation))) problem(node, '工程中的骨骼素材没有所选动画。运行时仍按当前素材校验，支持先换素材再播放。');
        }
        if (node.type === 'setSpineSpeed' && !linked(node, 'speed')) {
          const issue = uiSpineSpeedProblem(blueprintInputValue(node, 'speed'));
          if (issue) problem(node, issue);
        }
      }
      if (node.type === 'effect' && !project.effects.some(item => item.id === node.properties.effectId)) problem(node, '请选择已有的演出效果。');
      if (node.type === 'sceneAction' && !textCommandAction(project, String(node.properties.command ?? ''))) problem(node, '请输入有效的中文演出指令，例如 @等待：1。');
      if (node.type === 'delay') number('seconds', '等待秒数', 0);
      if (node.type === 'forLoop') {
        number('first_index', '起始数', undefined, undefined, true); number('last_index', '结束数', undefined, undefined, true);
        if (!linked(node, 'first_index') && !linked(node, 'last_index') && Number(blueprintInputValue(node, 'last_index')) - Number(blueprintInputValue(node, 'first_index')) >= 100000) problem(node, '单次计数循环最多执行 100000 次；持续玩法请使用定时事件。');
      }
      for (const pin of node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec')) {
        if (linked(node, pin.id) || pin.id.startsWith('arg_')) continue;
        const value = blueprintInputValue(node, pin.id);
        if (pin.id === 'characterId' && value === '' && ['getPlayerPreference', 'setPlayerPreference'].includes(node.type) && node.properties.preference === 'characterVolume') continue;
        if (value !== undefined && !valueValid(pin.dataType, value)) problem(node, `“${pin.name}”需要有效的${blueprintTypeNames[pin.dataType]}。`);
      }
    }
    const linkIds = new Set<string>();
    const singlePorts = new Set<string>();
    for (const link of graph.links) {
      if (linkIds.has(link.id)) add(`蓝图“${graph.name}”存在重复连线。`, link.toNodeId);
      linkIds.add(link.id);
      const source = graphNodes.get(link.fromNodeId);
      const target = graphNodes.get(link.toNodeId);
      const from = source?.pins.find(pin => pin.id === link.fromPinId);
      const to = target?.pins.find(pin => pin.id === link.toPinId);
      if (!source || !target || !from || !to) { add(`蓝图“${graph.name}”存在指向已删除节点或连接点的连线。`, source?.id ?? target?.id); continue; }
      if (from.direction !== 'output' || to.direction !== 'input') problem(target, '连线方向无效，请从右侧输出连接到左侧输入。');
      else if (!blueprintTypesCompatible(actualType(graph, source, from), to.dataType)) problem(target, `类型不匹配：${blueprintTypeNames[actualType(graph, source, from)]}不能传给${blueprintTypeNames[to.dataType]}。`);
      else if (to.dataType === 'asset') {
        const expected = blueprintNodeAssetFilter(target, to.id, project)?.kind;
        if (expected && expected !== 'all') {
          // Declared parameter kinds remain useful when their live value is unknown.
          const parameter = source.type === 'getVariable' ? blueprintStateVariable(project, graph, source) : undefined;
          const kind = parameter?.type === 'asset' ? variableAssetKind(parameter) : undefined;
          if (kind && kind !== expected) problem(target, `素材类型不匹配：${parameterTypeName(parameter!)}参数“${parameter!.name}”不能传给需要${parameterKindNames[expected as ParameterAssetKind] ?? expected}的“${to.name}”。`);
          // Resolve the actual resource, including generic literals and constant
          // expressions. A marker or a runtime input's default is not its value.
          const value = blueprintStaticInput(staticValues, target, to.id);
          const asset = value === unknownBlueprintValue ? undefined : project.assets.find(asset => asset.id === value);
          if (asset && asset.kind !== expected) problem(target, `素材类型不匹配：素材“${asset.name}”不能传给需要${parameterKindNames[expected as ParameterAssetKind] ?? expected}的“${to.name}”。`);
        }
      }
      const key = from.dataType === 'exec' ? `from:${source.id}:${from.id}` : `to:${target.id}:${to.id}`;
      if (singlePorts.has(key)) problem(target, from.dataType === 'exec' ? '同一个执行输出只能连接一条路线，请使用依次执行节点。' : '同一个数据输入只能连接一个值。');
      singlePorts.add(key);
      if ((source.type === 'callFunction' || source.type === 'callMacro' || source.type === 'waitTask') && from.id.startsWith('out_')) {
        const output = graphs.find(item => item.id === source.properties.graphId)?.exposedOutputs.find(pin => `out_${pin.id}` === from.id);
        if (!output) problem(source, '这个输出结果已经删除，请更新调用节点。');
        else if (!blueprintTypesCompatible(output.dataType, to.dataType)) problem(target, `输出“${output.name}”类型不匹配。`);
      }
    }
    const executionCycle = blueprintExecutionCycleNode(graph);
    if (executionCycle) problem(executionCycle, '执行线形成了循环，请使用计数循环节点。');
    {
      const exec = false;
      const visited = new Set<string>();
      const active = new Set<string>();
      const visit = (id: string): boolean => {
        if (active.has(id)) return true;
        if (visited.has(id)) return false;
        active.add(id);
        for (const link of graph.links.filter(link => link.fromNodeId === id && (graphNodes.get(id)?.pins.find(pin => pin.id === link.fromPinId)?.dataType === 'exec') === exec)) {
          if (visit(link.toNodeId)) return true;
        }
        active.delete(id); visited.add(id); return false;
      };
      for (const node of graph.nodes) if (visit(node.id)) { problem(node, exec ? '执行线形成了循环，请使用计数循环节点。' : '数据线互相依赖，无法计算，请断开其中一条。'); break; }
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visitGraph = (graph: BlueprintGraph): boolean => {
    if (active.has(graph.id)) return true;
    if (visited.has(graph.id)) return false;
    active.add(graph.id);
    for (const node of graph.nodes) {
      const targetId = node.type === 'callFunction' || node.type === 'callMacro' ? node.properties.graphId
        : node.type === 'showCharacter' ? effectiveCharacter(project, String(node.properties.characterId ?? ''))?.blueprintId : undefined;
      const target = graphs.find(item => item.id === targetId);
      if (target && visitGraph(target)) { add(`蓝图“${graph.name}”存在循环调用，请拆开互相调用的流程。`, node.id); return true; }
    }
    active.delete(graph.id); visited.add(graph.id); return false;
  };
  for (const graph of graphs) if (visitGraph(graph)) break;
  return [...diagnostics, ...uiBlueprintPathDiagnostics(project), ...timelineInterleaveDiagnostics(project)];
}
