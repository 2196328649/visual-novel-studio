import { projectGraphs } from './project-resources';
import { uiAnimationPlayModes } from './ui-animation-clips';
import { parseActorTransitions } from './actor-transitions';
import { uiControlValueType, uiTextInput } from './ui-control-events';
import { isUiButtonEvent } from './ui-button-events';
import { isUiAnimationProperty, uiAnimationEasings } from './ui-animation';
import { timelineInterleaveDiagnostics } from './timeline-interleave';
import { standardUiEventPages } from './ui-logic';
import { nodeMoveOffsets, nodeAfterOffsets } from './move-offsets';
import { characterDisplayPreset } from './character-presets';
import { declaredUiComponents, effectiveCharacter, type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Diagnostic, type Project } from './model';
import { uiProperties, uiPropertyApplies, type UiProperty } from './ui';
import { blueprintInputValue, blueprintKeyNames, blueprintScreens, blueprintTypeNames, blueprintTypesCompatible, sceneEntry } from './blueprint';
import { blueprintNameError } from './blueprint-names';
import { textCommandAction } from './text-script';
import { playerPreferences, validPlayerPreference, type PlayerPreference } from './preferences';
import { savedBlueprintAction } from './blueprint-authoring';

export function validateBlueprints(project: Project): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const add = (message: string, nodeId?: string) => diagnostics.push({ severity: 'error', message, nodeId } as Diagnostic);
  const graphs = projectGraphs(project) ?? [];
  const components = declaredUiComponents(project);
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
    if (type === 'ui') return typeof value === 'string' && (Object.hasOwn(blueprintScreens, value) || project.ui.customPages.some(page => page.id === value));
    if (type === 'component') return components.some(item => item.id === value);
    return false;
  };
  const actualType = (graph: BlueprintGraph, node: BlueprintNode, pin: BlueprintPin): BlueprintPin['dataType'] => {
    if (pin.dataType === 'exec') return 'exec';
    if (node.type === 'literal' && pin.dataType === 'any' && node.properties.value !== undefined) return typeof node.properties.value as 'string' | 'number' | 'boolean';
    if (node.type === 'getVariable') return project.variables.find(item => item.id === node.properties.variableId)?.type ?? pin.dataType;
    if (node.type === 'getInput') return graph.exposedInputs.find(item => item.id === node.properties.inputId)?.dataType ?? pin.dataType;
    return pin.dataType;
  };
  for (const graph of graphs) {
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
      if (node.properties.actorTransitions) { try { parseActorTransitions(node.properties.actorTransitions); } catch { problem(node, '角色过渡设置无效，请检查过渡方式与 0～60 秒时长。'); } }
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
      if (node.type === 'event' && !node.pins.some(pin => pin.direction === 'output' && pin.dataType === 'exec')) problem(node, '缺少开始执行连接点。');
      if (['eventKey', 'eventTimer', 'showUiPage', 'closeUiPage'].includes(node.type) && !linked(node, 'pageId') && !project.ui.customPages.some(page => page.id === blueprintInputValue(node, 'pageId')) && !(['eventKey', 'eventTimer'].includes(node.type) && standardUiEventPages.some(page => page.id === blueprintInputValue(node, 'pageId')))) problem(node, '请选择一个自定义界面，先在界面编辑器中创建页面。');
      if (node.type === 'eventKey' && !Object.hasOwn(blueprintKeyNames, String(node.properties.key))) problem(node, '请选择有效的按键。');
      if (node.type === 'eventTimer' && (typeof node.properties.interval !== 'number' || !Number.isFinite(node.properties.interval) || node.properties.interval <= 0)) problem(node, '定时间隔需要大于 0 秒。');
      if (['eventTimer','eventKey'].includes(node.type) && node.properties.uiInstanceId && node.properties.uiInstanceId !== 'base' && !project.ui.instances?.some(instance => instance.id === node.properties.uiInstanceId)) problem(node, '界面事件引用的方案不存在，请重新选择作用范围。');
      if (['eventClick','eventButton'].includes(node.type) && !components.some(component => component.id === node.properties.componentId && component.kind === 'button')) problem(node, '请选择一个按钮作为点击事件来源。');
      if(node.type==='eventTextCommitted'&&!uiTextInput(project,components.find(c=>c.id===node.properties.componentId)))problem(node,'请选择绑定自由文字参数的输入控件。');
      if(node.type==='eventValueChanged'&&!uiControlValueType(project,components.find(c=>c.id===node.properties.componentId)))problem(node,'请选择已绑定参数的滑块、选项或输入控件。');
      if(node.type==='eventButton'&&!isUiButtonEvent(String(node.properties.trigger)))problem(node,'请选择有效的按钮交互事件。');
      if(['eventButton','eventValueChanged','eventTextCommitted'].includes(node.type)&&node.properties.uiInstanceId&&node.properties.uiInstanceId!=='base'&&!project.ui.instances?.some(i=>i.id===node.properties.uiInstanceId))problem(node,'界面事件引用的方案已不存在。');
      if (node.type === 'shake') { number('duration', '震动时长', 0); number('amplitude', '震动幅度'); }
      if (node.type === 'return' && !node.pins.some(pin => pin.direction === 'input' && pin.dataType === 'exec')) problem(node, '缺少执行输入连接点。');
      if (node.type === 'callFunction' || node.type === 'callMacro') {
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
      if (node.type === 'getVariable' || node.type === 'setVariable') {
        const variable = project.variables.find(item => item.id === node.properties.variableId);
        if (!variable) problem(node, '请选择作品状态。');
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
        if (instance && !linked(node, 'instanceId') && !/^[a-z][a-z0-9_]{0,63}$/.test(String(instance))) problem(node, '实例 ID 请使用小写字母开头的字母、数字或下划线，最多 64 位。');
        if (lifetime && !linked(node, 'lifetime') && !['line', 'persistent'].includes(String(lifetime))) problem(node, '显示范围请选择仅本句或持续显示。');
      }
      if (node.type === 'showCharacter') {
        const character = effectiveCharacter(project, String(node.properties.characterId ?? ''));
        const preset = blueprintInputValue(node, 'presetId');
        if (character && preset && !linked(node, 'characterId') && !linked(node, 'presetId') && !characterDisplayPreset(project, character.id, String(preset))) problem(node, '请选择这个角色的站位预设。');
        if (!linked(node, 'characterId') && !linked(node, 'expressionId') && character && blueprintInputValue(node, 'expressionId') && !character.expressions.some(item => item.id === blueprintInputValue(node, 'expressionId') || item.name === blueprintInputValue(node, 'expressionId'))) problem(node, '请选择这个角色的表情。');
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
        else if (node.type === 'setPlayerPreference' && !linked(node, 'value') && !validPlayerPreference(String(node.properties.preference), blueprintInputValue(node, 'value'))) problem(node, `“${preference.name}”的设置值无效。`);
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
        number('loops', '循环次数', 0, 1000000, true);
        number('speed', '播放速度', .01, 100);
      }
      if (['playUiAnimation','stopUiAnimationPlayback'].includes(node.type) && !project.ui.animations?.some(a=>a.id===node.properties.animationId)) problem(node, '请选择有效的界面动画。');
      if (['setUiProperty', 'getUiProperty', 'animateUiProperty', 'stopUiAnimation', 'resetUiComponent', 'playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type)) {
        resource('componentId', '界面组件', 'component');
        const component = components.find(item => item.id === blueprintInputValue(node, 'componentId'));
        if (['playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type) && !linked(node, 'componentId') && component && component.kind !== 'spine') problem(node, '请选择骨骼动画组件。');
        if (node.type === 'setUiProperty' || node.type === 'getUiProperty' || node.type === 'animateUiProperty') {
          const property = uiProperties[node.properties.property as UiProperty];
          if (!property) problem(node, '请选择有效的组件属性。');
          else if (!linked(node, 'componentId') && component && !uiPropertyApplies(component, node.properties.property as UiProperty)) problem(node, '所选属性不适用于此组件；文字用于固定文字与按钮，启用和选中用于按钮。');
          else if (['setUiProperty','animateUiProperty'].includes(node.type) && !linked(node, 'value')) {
            if (!valueValid(property.type, blueprintInputValue(node, 'value'))) problem(node, `“${property.name}”需要${blueprintTypeNames[property.type]}。`);
            if (property.type === 'number') number('value', property.name, ['opacity', 'value'].includes(String(node.properties.property)) ? 0 : undefined, ['opacity', 'value'].includes(String(node.properties.property)) ? 1 : undefined);
          }
        }
        if (node.type === 'animateUiProperty') {
          if (!isUiAnimationProperty(String(node.properties.property))) problem(node, '控件动画仅支持位置、大小、不透明度和进度数值属性。');
          if (!Object.hasOwn(uiAnimationEasings, String(node.properties.easing ?? 'ease'))) problem(node, '请选择有效的控件动画缓动。');
          number('duration', '持续秒数', 0, 3600);
        }
        if (node.type === 'stopUiAnimation' && node.properties.property !== 'all' && !isUiAnimationProperty(String(node.properties.property))) problem(node, '请选择要停止的动画属性或全部属性。');
        if (node.type === 'playSpine' && !linked(node, 'animation')) {
          const animation = blueprintInputValue(node, 'animation');
          if (typeof animation !== 'string' || !animation) problem(node, '请选择要播放的动画。');
          else if (!linked(node, 'componentId') && component?.kind === 'spine' && !project.assets.find(item => item.id === component.assetId)?.spine?.animations.some(item => item.name === animation)) problem(node, '此骨骼组件没有所选动画。');
        }
        if (node.type === 'setSpineSpeed') number('speed', '播放速度', 0);
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
      const key = from.dataType === 'exec' ? `from:${source.id}:${from.id}` : `to:${target.id}:${to.id}`;
      if (singlePorts.has(key)) problem(target, from.dataType === 'exec' ? '同一个执行输出只能连接一条路线，请使用依次执行节点。' : '同一个数据输入只能连接一个值。');
      singlePorts.add(key);
      if ((source.type === 'callFunction' || source.type === 'callMacro') && from.id.startsWith('out_')) {
        const output = graphs.find(item => item.id === source.properties.graphId)?.exposedOutputs.find(pin => `out_${pin.id}` === from.id);
        if (!output) problem(source, '这个输出结果已经删除，请更新调用节点。');
        else if (!blueprintTypesCompatible(output.dataType, to.dataType)) problem(target, `输出“${output.name}”类型不匹配。`);
      }
    }
    for (const exec of [true, false]) {
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
  return [...diagnostics,...timelineInterleaveDiagnostics(project)];
}
