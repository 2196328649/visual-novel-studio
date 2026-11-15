import { blueprintTaskCatalog } from './blueprint-task-catalog';
import type { AuthoringIndexCache } from './authoring-index';
import { uiControlOptionCatalog, uiControlOptionPins, isUiControlOptionNode, uiControlOptionOperations, uiControlOptionDefault } from './ui-control-options';
import { uiPageInterfaceCatalog, uiPageNodePins, isUiPageInterfaceNode, uiPageNodePageId } from './ui-page-interface';
import { blueprintTaskPins, blueprintTaskScope, blueprintTaskPageId, blueprintTaskVersion, isBlueprintTaskNode, isBlueprintModuleReference } from './blueprint-tasks';
import { blueprintChoiceCatalog, blueprintChoiceDefaultCases, blueprintChoiceDefinition, blueprintChoicePins, isBlueprintChoiceType, type BlueprintChoiceKeyType } from './blueprint-choice';
import { blueprintNumericCatalog, blueprintNumericInputs, blueprintNumericOutputType } from './blueprint-numeric';
import { blueprintExecutionConnectionCycles } from './blueprint-execution-ports';
import { blueprintFlowControlCatalog, blueprintFlowControlInitial, blueprintFlowControlPageId, blueprintFlowControlScope, isBlueprintFlowControl } from './blueprint-flow-control';
import { blueprintStatePageId, blueprintStateScope, blueprintStateScopes, blueprintStateVariable } from './blueprint-state';
import { blueprintUiPropertyDefinition, blueprintUiPropertyPins } from './blueprint-ui-property-batch';
import { blueprintAssetNodeKind, blueprintAssetNodePresentation } from './blueprint-asset-node';
import { uiPage } from './ui-pages';
import { normalizeProjectResources, projectGraphs } from './project-resources';
import { projectReadSnapshot } from './project-mutation';
import { sameProjectValue } from './project-history';
import { syncAudioClipPins } from './audio-clip';
import { uiControlEventType } from './ui-control-events';
import { blueprintLogicCatalog } from './blueprint-logic';
import { syncVisualPins } from './visual-object';
import { materializeVisualCompositions } from './visual-composition';
import { actionSchema, declaredUiComponents, effectiveCharacter, makeId, type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Project, type StageAction, type VariableValue } from './model';
import { uiProperties, type UiProperty } from './ui';
import { uiPropertyPinType } from './ui-properties';
import { playerPreferences, preferenceInfo, type PlayerPreference } from './preferences';

export type BlueprintNodeType = BlueprintNode['type'];
export type BlueprintDataType = BlueprintPin['dataType'];
export const blueprintTypeNames: Record<BlueprintDataType, string> = {
  exec: '执行', boolean: '开关', number: '数值', string: '文字', asset: '素材', scene: '场景', character: '角色', ui: '界面', component: '界面组件', any: '任意值',
};
export const blueprintKindNames: Record<BlueprintGraph['kind'], string> = {
  function: '可复用流程', macro: '用户节点', effect: '演出效果', scene: '场景事件', character: '角色事件', ui: '界面事件', minigame: '小游戏逻辑',
};
export const blueprintCategories = ['常用演出', '界面与动画', '流程控制', '状态与计算', '复用与参数', '高级'] as const;
export const blueprintCatalog: Record<BlueprintNodeType, { name: string; category: typeof blueprintCategories[number]; hint: string; keywords?: readonly string[] }> = {
  ...blueprintLogicCatalog,
  ...blueprintNumericCatalog,
  ...blueprintChoiceCatalog,
  ...blueprintFlowControlCatalog,
  ...blueprintTaskCatalog,
  ...uiPageInterfaceCatalog,
  ...uiControlOptionCatalog,
  event: { name: '事件开始', category: '流程控制', hint: '蓝图被调用时，从这里沿执行线开始。' },
  eventTextCommitted: { name: '文字提交时', category: '界面与动画', hint: '自由文字输入按 Enter 或离开输入框时执行。提供提交文字与提交方式；隐藏、禁用、离页和内部刷新不提交。' },
  eventValueChanged: { name: '控件值改变时', category: '界面与动画', hint: '用户拖动滑块、切换选项或编辑文字且值确实改变时执行。新值与旧值可直接接线，初始化和蓝图直接修改参数不触发此事件。' },
  eventSpine: { name: '骨骼动画事件', category: '界面与动画', hint: '真实运行库报告非循环动画完成或播放失败时执行；输出素材、动画、皮肤、位置、时长和错误。循环边界、换动画、隐藏或清空不伪造完成。' },
  eventVideo: { name: '视频播放事件', category: '界面与动画', hint: '真实播放器报告结束或失败时执行，输出素材、位置、时长、是否已知时长与错误快照。停止、隐藏、循环边界和清空不伪造结束；旧来源、指令或页面反馈无效。' },
  eventImage: { name: '图片加载事件', category: '界面与动画', hint: '实际显示图片读取和解码成功或失败时执行（Image OnLoad / OnError）。输出素材、错误及源图尺寸快照；相同来源不因重绘重复派发，清空不派发，离页或替换后的旧回调无效。' },
  eventButton: { name: '按钮交互事件', category: '界面与动画', hint: '按钮悬停、移出、按下或松开时执行。移出后松开仍触发松开，但不点击；禁用、隐藏或离页会取消交互。' },
  eventClick: { name: '点击控件时', category: '界面与动画', hint: '指定按钮被点击时执行；按钮所在界面关闭后不再接收事件。' },
  eventKey: { name: '按键时', category: '界面与动画', hint: '指定页面显示期间，按下按键执行后续节点；内置模板与新增页面使用同一事件机制。' },
  eventTimer: { name: '定时触发', category: '界面与动画', hint: '指定界面显示期间，按间隔触发，可循环；关闭页面后自动停止。' },
  showUiPage: { name: '打开页面', category: '界面与动画', hint: '打开页面并返回关闭结果。新增页面可等待或叠加；系统模板沿用其菜单宿主和内容要求，页面事件与状态接口相同。' },
  closeUiPage: { name: '关闭页面', category: '界面与动画', hint: '关闭指定页面，停止页面的定时与按键事件，并将结果交给打开界面的节点。' },
  random: { name: '随机数', category: '状态与计算', hint: '生成两端之间的随机数。把结果写入状态即可在后续节点复用同一个随机值。' },
  formatText: { name: '格式化文字', category: '状态与计算', hint: '把文字中的 {value} 替换为输入值，例如 命中 {value}/5。' },
  sequence: { name: '依次执行', category: '流程控制', hint: '先完成第一条流程，再执行第二条流程。' },
  branch: { name: '条件分支', category: '流程控制', hint: '根据条件是否满足，选择一条执行路线。' },
  compare: { name: '比较', category: '状态与计算', hint: '比较两个值，将是否满足条件传给条件分支。' },
  select: { name: '选择值', category: '状态与计算', hint: '根据条件，从两个值中选一个作为结果。' },
  setVariable: { name: '设置状态', category: '状态与计算', hint: '明确选择本次调用、页面实例、作品状态或玩家设置，写入有类型的变量。改变页面值不会改变设计默认值。' },
  getVariable: { name: '读取状态', category: '状态与计算', hint: '读取所选作用域的当前值。调用局部值不跨调用共享，页面变量只属于指定的有效页面实例。' },
  getInput: { name: '读取输入', category: '复用与参数', hint: '读取调用者传入的参数，可用于制作自己的节点。' },
  literal: { name: '固定值', category: '状态与计算', hint: '提供一个固定的数值、文字、开关或素材。' },
  math: { name: '数学运算', category: '状态与计算', hint: '对两个数进行加、减、乘、除等计算。' },
  delay: { name: '等待', category: '常用演出', hint: '等待指定秒数后继续。' },
  forLoop: { name: '计数循环', category: '流程控制', hint: '从起始数到结束数，每个数执行一次循环体，包含两端。' },
  callFunction: { name: '调用流程', category: '复用与参数', hint: '执行另一张蓝图，并读取它的输出结果。' },
  callMacro: { name: '调用用户节点', category: '复用与参数', hint: '把用户节点库中的流程当作一个节点使用。' },
  sceneAction: { name: '中文演出指令', category: '高级', hint: '执行一条已有的中文演出指令，例如 @等待：1。' },
  switchScene: { name: '切换场景', category: '常用演出', hint: '跳转到目标场景的剧情入口，并应用转场。当前蓝图在这里结束。' },
  showBackground: { name: '切换背景', category: '常用演出', hint: '更换舞台背景，继续当前剧情。' },
  showCharacter: { name: '显示角色', category: '常用演出', hint: '角色留空跟随当前台词；也可指定角色、表情、站位与大小。' },
  startDialogue: { name: '开始台词演出', category: '常用演出', hint: '从此处开始本句文字和配音，后续演出继续；同一句只触发一次。' },
  showChapter: { name: '章节演出', category: '常用演出', hint: '播放章节标题、题图、蒙板转场与音效，完成后继续。' },
  camera: { name: '移动镜头', category: '常用演出', hint: '设置镜头位置、缩放、旋转与移动时长。' },
  shake: { name: '画面震动', category: '常用演出', hint: '让画面沿横向或纵向震动。' },
  savedAction: { name: '保存的演出', category: '常用演出', hint: '保留封装前的完整演出，可继续编辑默认设置。' },
  hideCharacter: { name: '隐藏角色', category: '常用演出', hint: '让指定角色离开舞台。' },
  playMusic: { name: '播放音乐', category: '常用演出', hint: '播放背景音乐，可循环或淡入。' },
  playSound: { name: '播放音效', category: '常用演出', hint: '播放一次音效，不影响背景音乐。' },
  stopMusic: { name: '停止音乐', category: '常用演出', hint: '选择停止背景音乐、音效或环境音，可设置淡出时间。' },
  uiAction: { name: '打开界面', category: '常用演出', hint: '打开存档、设置等游戏菜单，关闭菜单后继续。' },
  setUiProperty: { name: '设置组件属性', category: '界面与动画', hint: '同时修改同一个组件的多项属性；每项可直接填值或独立接线，全部有效后一次应用。' },
  getUiDefault: { name: '读取设计默认值', category: '界面与动画', hint: '读取当前方案继承后的设计值，不包含绑定、动画或临时覆盖。' },
  focusUiComponent: { name: '请求输入焦点', category: '界面与动画', hint: '在下一次宿主刷新时聚焦或释放文字输入框；返回请求是否接受，不代表已经聚焦。程序移动不触发文字提交。' },
  setUiControlRange: { name: '设置控件范围', category: '界面与动画', hint: '一起检查并设置数值控件的下限、上限和步长。默认设置只覆盖本控件；双向同步项写回参数，任一单向跟随项使整组不写入。不触发用户改值事件。' },
  resetUiControlRange: { name: '重置控件范围', category: '界面与动画', hint: '一起清除下限、上限和步长的实例覆盖，恢复设计范围或绑定源范围；值覆盖保持不变。' },
  resetUiProperty: { name: '重置组件属性', category: '界面与动画', hint: '只清除这一项的临时覆盖与动画，重新使用设计值或绑定；其他属性不受影响。' },
  getUiProperty: { name: '读取组件属性', category: '界面与动画', hint: '读取组件属性，连接条件分支或其他节点。' },
  playUiAnimation: { name: '播放界面动画', category: '界面与动画', hint: '播放控件关键帧动画，支持正放、倒放、往返、循环和中途换向。双击编辑动画。' },
  stopUiAnimationPlayback: { name: '停止界面动画', category: '界面与动画', hint: '停止这段命名动画仍在播放的轨道，保留当前值或到达播放方向的终点。' },
  animateUiProperty: { name: '控件属性动画', category: '界面与动画', hint: '从控件当前值平滑变化到目标；可同时动画多个属性。等待结束为是时结束后继续，停止或替换也会继续。' },
  stopUiAnimation: { name: '停止控件动画', category: '界面与动画', hint: '停止所选属性或控件全部动画，可保留当前值或直接到达目标值。' },
  resetUiComponent: { name: '重置组件', category: '界面与动画', hint: '恢复界面编辑器中的属性；骨骼动画也恢复初始播放状态。' },
  playUiVideo: { name: '播放视频', category: '界面与动画', hint: '播放当前页面的视频控件。默认继续暂停的位置；重新开始会从头重播，停止或结束后播放也从头开始。' },
  pauseUiVideo: { name: '暂停或继续视频', category: '界面与动画', hint: '改变作者播放模式；隐藏或宿主挂起的暂停独立保留，不伪造播放结束。' },
  stopUiVideo: { name: '停止视频', category: '界面与动画', hint: '停止并回到开头，显示封面；不派发播放结束事件。' },
  playSpine: { name: '播放骨骼动画', category: '界面与动画', hint: '选择骨骼组件及动画，可循环播放、继续或重新开始。' },
  pauseSpine: { name: '暂停骨骼动画', category: '界面与动画', hint: '暂停时保留当前姿态；暂停选择“否”即可继续。' },
  setSpineSpeed: { name: '设置动画速度', category: '界面与动画', hint: '修改骨骼动画速度，1 为原速、0.5 为半速、2 为倍速。' },
  setPlayerPreference: { name: '设置玩家选项', category: '界面与动画', hint: '修改音量、显示或文字速度；与设置页共用玩家偏好，读档时保留。' },
  getPlayerPreference: { name: '读取玩家选项', category: '界面与动画', hint: '读取玩家当前设置，可连接到条件、计算或用户节点。' },
  setMinigameValue: { name: '设置小游戏值', category: '界面与动画', hint: '把一个可保存的数值、文字或开关写入当前小游戏状态。' },
  getMinigameValue: { name: '读取小游戏值', category: '界面与动画', hint: '读取当前小游戏状态，可连接到条件、计分或界面属性。' },
  finishMinigame: { name: '结束小游戏', category: '流程控制', hint: '从蓝图结束当前小游戏，并把成功、失败或取消结果交给剧情。' },
  confirmMessage: { name: '显示确认框', category: '界面与动画', hint: '显示消息框页，等待玩家确定或取消，再执行对应路线。' },
  effect: { name: '演出效果', category: '常用演出', hint: '执行已经保存的角色动画、镜头或组合演出。' },
  setOutput: { name: '写入输出', category: '复用与参数', hint: '把结果交给调用者，通过输出数据线继续使用。' },
  return: { name: '结束并返回', category: '流程控制', hint: '结束本蓝图，并回到调用它的地方。' },
  comment: { name: '说明便签', category: '高级', hint: '为这张蓝图写说明，不参与执行。' },
};

export const blueprintScreens: Record<string, string> = {
  pause_menu: '暂停菜单', save: '保存游戏', load: '读取存档', preferences: '游戏设置', voice_settings: '角色音量', history: '对话历史',
  gallery: '画廊', music_room: '音乐室', voice_collection: '语音收藏', chapter_select: '章节选择', flowchart: '剧情流程图', staff_roll: '制作人员',
};
export { uiShortcutKeys as blueprintKeyNames } from './ui-shortcuts';

export function blueprintPin(id: string, name: string, direction: BlueprintPin['direction'], dataType: BlueprintDataType = 'exec', defaultValue?: VariableValue): BlueprintPin {
  return { id, name, direction, dataType, required: false, ...(defaultValue === undefined ? {} : { defaultValue }) };
}

export function blueprintTypesCompatible(from: BlueprintDataType, to: BlueprintDataType): boolean {
  return from === 'exec' || to === 'exec' ? from === to : from === 'any' || to === 'any' || from === to;
}
export function blueprintPinsCompatible(from: BlueprintPin, to: BlueprintPin): boolean {
  return from.direction === 'output' && to.direction === 'input' && blueprintTypesCompatible(from.dataType, to.dataType);
}
export function adaptBlueprintNodeToPin(node: BlueprintNode, origin?: BlueprintPin): BlueprintNode {
  if (!origin || origin.dataType === 'exec' || origin.dataType === 'any') return node;
  // A selected asset is already typed and authored; adapting an empty generic
  // literal must not clear its resource or reinterpret it as another data type.
  if (blueprintAssetNodeKind(node)) return node;
  if (isUiControlOptionNode(node.type) && ['number', 'string', 'boolean'].includes(origin.dataType) && (node.type === 'editUiControlOptions' ? origin.direction === 'output' : origin.direction === 'input')) {
    node.properties.valueType = origin.dataType;
    if (node.type === 'editUiControlOptions') node.properties.value = uiControlOptionDefault(origin.dataType);
    node.pins = uiControlOptionPins(node) ?? node.pins;
  }
  if (isBlueprintChoiceType(node.type)) {
    if (origin.direction === 'output' && ['number', 'string', 'boolean'].includes(origin.dataType)) { node.properties.keyType = origin.dataType; node.properties.cases = JSON.stringify(blueprintChoiceDefaultCases(origin.dataType as BlueprintChoiceKeyType)); }
    else if (node.type === 'selectByKey' && origin.direction === 'input') node.properties.valueType = origin.dataType;
    node.pins = blueprintChoicePins(node) ?? node.pins;
  }
  if (node.type === 'literal') { node.pins[0].dataType = origin.dataType; node.properties.value = defaultBlueprintValue(origin.dataType); }
  if (node.type === 'compare' && origin.direction === 'output' && ['number', 'string', 'boolean'].includes(origin.dataType)) for (const pin of node.pins) if (pin.direction === 'input') { pin.dataType = origin.dataType; pin.defaultValue = defaultBlueprintValue(origin.dataType); }
  return node;
}

export function defaultBlueprintValue(type: BlueprintDataType): VariableValue {
  return type === 'number' ? 0 : type === 'boolean' ? false : '';
}

export function blueprintNodeDefaults(type: BlueprintNodeType, index = 0): BlueprintNode {
  const node: BlueprintNode = { id: makeId('bpnode'), type, name: blueprintCatalog[type].name, x: 80 + (index % 3) * 420, y: 80 + Math.floor(index / 3) * 620, properties: {}, pins: [], collapsed: false };
  const input = (id: string, name: string, dataType: BlueprintDataType, value?: VariableValue) => blueprintPin(id, name, 'input', dataType, value);
  const output = (id: string, name: string, dataType: BlueprintDataType) => blueprintPin(id, name, 'output', dataType);
  const execIn = blueprintPin('exec_in', '执行', 'input');
  const execOut = blueprintPin('exec_out', '完成', 'output');
  const executable = (...pins: BlueprintPin[]) => [execIn, ...pins, execOut];
  switch (type) {
    case 'eventPage': node.properties = { pageId: '', phase: 'closeRequested' }; node.pins = [blueprintPin('exec', '执行', 'output'), output('result', '关闭文字（兼容）', 'string'), output('reason', '原因', 'string')]; break;
    case 'getPageInput': case 'getPageOutput': node.properties = { pageId: '', parameterId: '' }; node.pins = [input('pageId', '页面', 'ui'), output('value', '值', 'string')]; break;
    case 'setPageOutput': node.properties = { pageId: '', parameterId: '' }; node.pins = executable(input('pageId', '页面', 'ui'), input('value', '值', 'string')); break;
    case 'preventPageClose': node.properties = { pageId: '' }; node.pins = executable(input('pageId', '页面', 'ui')); break;
    case 'event': node.pins = [blueprintPin('exec', '开始', 'output')]; break;
    case 'eventSpine': node.properties = { componentId: '', trigger: 'completed' }; node.pins = [blueprintPin('exec', '执行', 'output'), output('assetId', '本次骨骼素材', 'asset'), output('animation', '本次动画', 'string'), output('skin', '本次皮肤', 'string'), output('position', '当前位置（秒）', 'number'), output('duration', '动画时长（秒）', 'number'), output('error', '错误信息', 'string')]; break;
    case 'eventVideo': node.properties = { componentId: '', trigger: 'ended' }; node.pins = [blueprintPin('exec', '执行', 'output'), output('assetId', '本次视频', 'asset'), output('position', '当前位置（秒）', 'number'), output('duration', '总时长（秒）', 'number'), output('durationKnown', '时长已知', 'boolean'), output('error', '错误信息', 'string')]; break;
    case 'eventImage': node.properties = { componentId: '', trigger: 'loaded' }; node.pins = [blueprintPin('exec', '执行', 'output'), output('assetId', '本次图片', 'asset'), output('error', '错误信息', 'string'), output('width', '源图宽度', 'number'), output('height', '源图高度', 'number')]; break;
    case 'eventTextCommitted': node.properties={componentId:''}; node.pins=[blueprintPin('exec','执行','output'),output('value','提交文字','string'),output('method','提交方式','string')]; break;
    case 'eventValueChanged': node.properties = { componentId: '' }; node.pins = [blueprintPin('exec', '执行', 'output'), output('value', '新值', 'number'), output('previous', '旧值', 'number')]; break;
    case 'eventButton': node.properties = { componentId: '', trigger: 'hover' }; node.pins = [blueprintPin('exec', '执行', 'output')]; break;
    case 'eventClick': node.properties = { componentId: '' }; node.pins = [blueprintPin('exec', '点击时', 'output')]; break;
    case 'eventKey': node.properties = { pageId: '', key: 'K_SPACE' }; node.pins = [blueprintPin('exec', '按下时', 'output')]; break;
    case 'eventTimer': node.properties = { pageId: '', interval: 1, repeat: true }; node.pins = [blueprintPin('exec', '触发时', 'output')]; break;
    case 'showUiPage': node.pins = executable(input('pageId', '页面', 'ui'), input('wait', '等待关闭', 'boolean', true), input('modalMode', '底层输入', 'string', 'page'), output('result', '关闭结果', 'string'), output('reason', '关闭原因', 'string')); break;
    case 'closeUiPage': node.pins = executable(input('pageId', '页面', 'ui'), input('result', '关闭结果', 'string', '完成'), input('reason', '关闭原因', 'string', 'completed')); break;
    case 'random': node.pins = [input('min', '起点', 'number', 0), input('max', '终点', 'number', 1), output('value', '随机值', 'number')]; break;
    case 'formatText': node.pins = [input('format', '格式', 'string', '{value}'), input('value', '输入值', 'any', 0), output('text', '文字', 'string')]; break;
    case 'sequence': node.pins = [execIn, blueprintPin('then_0', '第一步', 'output'), blueprintPin('then_1', '第二步', 'output')]; break;
    case 'branch': node.pins = [execIn, input('condition', '条件', 'boolean', true), blueprintPin('true', '满足', 'output'), blueprintPin('false', '不满足', 'output')]; break;
    case 'throttle': case 'debounce': case 'startTask': case 'cancelTask': case 'waitTask': case 'taskStatus':
      node.properties = { taskVersion: blueprintTaskVersion, ...(['throttle', 'debounce', 'startTask'].includes(type) ? { scope: 'call', seconds: type === 'startTask' ? 0 : .3, ...(type === 'startTask' ? { conflict: 'parallel' } : {}) } : {}) };
      node.pins = blueprintTaskPins(node); break;
    case 'doOnce': case 'gate':
      node.properties = { scope: 'call', initiallyClosed: type === 'gate' };
      node.pins = [{ ...execIn, name: type === 'gate' ? '尝试进入' : '尝试执行' }, ...(type === 'gate' ? [input('open', '打开', 'exec'), input('close', '关闭', 'exec'), input('toggle', '切换', 'exec')] : []), input('reset', '重置', 'exec'), blueprintPin('exec_out', type === 'gate' ? '通过' : '首次通过', 'output'), blueprintPin('blocked', type === 'gate' ? '门已关闭' : '已执行', 'output'), blueprintPin('updated', type === 'gate' ? '设置完成' : '重置完成', 'output')];
      break;
    case 'compare': node.properties = { operator: 'eq' }; node.pins = [input('a', '第一个值', 'number', 0), input('b', '第二个值', 'number', 0), output('result', '是否满足', 'boolean')]; break;
    case 'switchValue': case 'selectByKey':
      node.properties = { choiceVersion: 1, keyType: 'string', valueType: 'number', cases: JSON.stringify(blueprintChoiceDefaultCases()) };
      node.pins = blueprintChoicePins(node)!; break;
    case 'select': node.pins = [input('condition', '条件', 'boolean', false), input('true_value', '满足时的值', 'any', ''), input('false_value', '不满足时的值', 'any', ''), output('result', '选中的值', 'any')]; break;
    case 'not': case 'and': case 'or': case 'xor': node.pins = [input('a', type === 'not' ? '条件' : '条件 A', 'boolean', false), ...(type === 'not' ? [] : [input('b', '条件 B', 'boolean', false)]), output('result', '结果', 'boolean')]; break;
    case 'setVariable': node.pins = executable(input('value', '新值', 'any')); break;
    case 'getVariable': case 'getInput': node.pins = [output('value', '值', 'any')]; break;
    case 'literal': node.properties = { value: '' }; node.pins = [output('value', '值', 'string')]; break;
    case 'clamp': case 'abs': case 'round': case 'inRange': case 'nearlyEqual': case 'mapRange': case 'lerp':
      node.properties = type === 'round' ? { mode: 'nearest' } : {};
      node.pins = [...blueprintNumericInputs[type].map(pin => input(pin.id, pin.name, pin.dataType, pin.defaultValue)), output('result', '结果', blueprintNumericOutputType(type))];
      break;
    case 'math': node.properties = { operation: 'add' }; node.pins = [input('a', '第一个数', 'number', 0), input('b', '第二个数', 'number', 0), output('result', '结果', 'number')]; break;
    case 'delay': node.properties = { seconds: 1 }; node.pins = executable(input('seconds', '秒数', 'number', 1)); break;
    case 'forLoop': node.properties = { firstIndex: 0, lastIndex: 3 }; node.pins = [execIn, input('first_index', '起始数', 'number', 0), input('last_index', '结束数', 'number', 3), blueprintPin('loop_body', '每次执行', 'output'), output('index', '当前计数', 'number'), blueprintPin('completed', '全部完成', 'output')]; break;
    case 'callFunction': case 'callMacro': node.pins = callablePins(); break;
    case 'switchScene': node.properties = { mode: 'dissolve', duration: 0.5, color: '#000000' }; node.pins = [execIn, input('sceneId', '目标场景', 'scene'), input('duration', '转场秒数', 'number', 0.5)]; break;
    case 'showBackground': node.properties = { transition: 'dissolve' }; node.pins = executable(input('assetId', '背景素材', 'asset'), input('duration', '时长', 'number', .5), input('wait', '等待完成', 'boolean', true)); break;
    case 'showCharacter': node.properties = { x: 0.5, y: 1, scale: 1, layer: 10, transition: 'dissolve' }; node.pins = executable(input('characterId', '角色', 'character', ''), input('expressionId', '表情', 'string', ''), input('instanceId', '第几个', 'string', ''), input('lifetime', '显示范围', 'string', 'line'), input('presetId', '站位预设', 'string', 'default'), input('useDefaultFraming', '使用角色默认构图', 'boolean', false), input('x', '横向位置', 'number', 0.5), input('y', '纵向位置', 'number', 1), input('scale', '大小', 'number', 1), input('layer', '层级', 'number', 10), input('duration', '时长', 'number', .5), input('wait', '等待完成', 'boolean', true)); break;
    case 'startDialogue': node.pins = executable(); break;
    case 'showChapter': node.pins = executable(input('title', '标题', 'string', '第一章'), input('subtitle', '副标题', 'string', ''), input('duration', '时长', 'number', 4.2), input('backgroundId', '章节背景', 'asset', ''), input('titleImageId', '章节题图', 'asset', ''), input('soundId', '章节音效', 'asset', ''), input('effect', '动效', 'string', ''), input('wait', '等待完成', 'boolean', true)); break;
    case 'camera': node.properties = { easing: 'ease', wait: true }; node.pins = executable(input('x', '横向位置', 'number', 0), input('y', '纵向位置', 'number', 0), input('zoom', '缩放', 'number', 1.1), input('rotation', '旋转', 'number', 0), input('duration', '时长', 'number', 0.5), input('wait', '等待完成', 'boolean', true)); break;
    case 'shake': node.pins = executable(input('direction', '方向', 'string', 'vertical'), input('duration', '时长', 'number', 0.6), input('amplitude', '幅度（像素）', 'number', 20), input('wait', '等待完成', 'boolean', true)); break;
    case 'savedAction': node.properties = { action: JSON.stringify({ kind: 'pause', seconds: 1 }) }; node.pins = executable(); break;
    case 'hideCharacter': node.properties = { transition: 'dissolve' }; node.pins = executable(input('characterId', '角色', 'character'), input('instanceId', '第几个', 'string', ''), input('duration', '时长', 'number', .5), input('wait', '等待完成', 'boolean', true)); break;
    case 'playMusic': node.properties = { loop: true, fade: 0.3 }; node.pins = executable(input('assetId', '音乐素材', 'asset'), input('loop', '循环播放', 'boolean', true), input('fade', '淡入秒数', 'number', 0.3)); break;
    case 'playSound': node.properties = { channel: 'sound', loop: false }; node.pins = executable(input('assetId', '音效素材', 'asset'), input('loop', '循环播放', 'boolean', false)); break;
    case 'stopMusic': node.properties = { fade: 0.3, channel: 'music' }; node.pins = executable(input('fade', '淡出秒数', 'number', 0.3)); break;
    case 'uiAction': node.properties = { screen: 'pause_menu' }; node.pins = executable(input('screen', '游戏界面', 'ui')); break;
    case 'setUiProperty': node.properties = { property: 'visible', value: true, writeMode: 'override' }; node.pins = executable(input('componentId', '界面组件', 'component'), input('value', '属性值', 'boolean', true)); break;
    case 'getUiControlOption': node.properties = { optionsVersion: 1, valueType: 'string', index: 0 }; node.pins = uiControlOptionPins(node)!; break;
    case 'editUiControlOptions': node.properties = { optionsVersion: 1, operation: 'insert', valueType: 'string', index: 0, toIndex: 0, label: '选项', value: '' }; node.pins = uiControlOptionPins(node)!; break;
    case 'focusUiComponent': node.properties = { focused: true }; node.pins = executable(input('componentId', '文字输入控件', 'component'), input('focused', '获取焦点', 'boolean', true), output('accepted', '请求已接受', 'boolean')); break;
    case 'setUiControlRange': node.properties = { minimum: 0, maximum: 1, step: .01 }; node.pins = executable(input('componentId', '数值控件', 'component'), input('minimum', '范围下限', 'number', 0), input('maximum', '范围上限', 'number', 1), input('step', '调整步长', 'number', .01)); break;
    case 'resetUiControlRange': node.pins = executable(input('componentId', '数值控件', 'component')); break;
    case 'resetUiProperty': node.properties = { property: 'visible' }; node.pins = executable(input('componentId', '界面组件', 'component')); break;
    case 'getUiDefault':
    case 'getUiProperty': node.properties = { property: 'visible' }; node.pins = [input('componentId', '界面组件', 'component'), output('value', '属性值', 'boolean')]; break;
    case 'playUiAnimation': node.properties = { animationId: '', playMode: 'forward', loops: 1, speed: 1, fromCurrent: false, wait: true }; node.pins = executable(input('loops', '循环次数（0为无限）', 'number', 1), input('speed', '播放速度', 'number', 1), input('fromCurrent', '沿用当前进度', 'boolean', false), input('wait', '等待结束', 'boolean', true)); node.pins.at(-1)!.name = '继续'; break;
    case 'stopUiAnimationPlayback': node.properties = { animationId: '', finish: false }; node.pins = executable(input('finish', '到达方向终点', 'boolean', false)); break;
    case 'animateUiProperty': node.properties = { property: 'opacity', easing: 'ease', value: 0, duration: .3, wait: true }; node.pins = executable(input('componentId', '界面组件', 'component'), input('value', '目标值', 'number', 0), input('duration', '持续秒数', 'number', .3), input('wait', '等待结束', 'boolean', true)); node.pins.at(-1)!.name = '继续'; break;
    case 'stopUiAnimation': node.properties = { property: 'all', finish: false }; node.pins = executable(input('componentId', '界面组件', 'component'), input('finish', '到达目标值', 'boolean', false)); break;
    case 'resetUiComponent': node.pins = executable(input('componentId', '界面组件', 'component')); break;
    case 'playUiVideo': node.properties = { restart: false }; node.pins = executable(input('componentId', '视频组件', 'component'), input('restart', '重新开始', 'boolean', false)); break;
    case 'pauseUiVideo': node.properties = { paused: true }; node.pins = executable(input('componentId', '视频组件', 'component'), input('paused', '暂停', 'boolean', true)); break;
    case 'stopUiVideo': node.pins = executable(input('componentId', '视频组件', 'component')); break;
    case 'playSpine': node.properties = { loop: true, restart: true }; node.pins = executable(input('componentId', '骨骼组件', 'component'), input('animation', '动画', 'string'), input('loop', '循环播放', 'boolean', true), input('restart', '重新开始', 'boolean', true)); break;
    case 'pauseSpine': node.properties = { paused: true }; node.pins = executable(input('componentId', '骨骼组件', 'component'), input('paused', '暂停', 'boolean', true)); break;
    case 'setSpineSpeed': node.properties = { speed: 1 }; node.pins = executable(input('componentId', '骨骼组件', 'component'), input('speed', '播放速度', 'number', 1)); break;
    case 'setPlayerPreference': node.properties = { preference: 'musicVolume', value: 1 }; node.pins = executable(input('value', '设置值', 'number', 1)); break;
    case 'getPlayerPreference': node.properties = { preference: 'musicVolume' }; node.pins = [output('value', '设置值', 'number')]; break;
    case 'setMinigameValue': node.properties = { key: 'score', value: 0 }; node.pins = executable(input('value', '状态值', 'any')); break;
    case 'getMinigameValue': node.properties = { key: 'score', defaultValue: 0 }; node.pins = [output('value', '状态值', 'any')]; break;
    case 'finishMinigame': node.properties = { result: 'success' }; node.pins = [execIn]; break;
    case 'confirmMessage': node.properties = { message: '确认继续吗？' }; node.pins = [execIn, input('message', '提示文字', 'string', '确认继续吗？'), blueprintPin('yes', '确定', 'output'), blueprintPin('no', '取消', 'output')]; break;
    case 'setOutput': node.pins = executable(input('value', '输出值', 'any')); break;
    case 'return': node.pins = [execIn]; break;
    case 'comment': node.properties = { text: '' }; break;
    default: node.pins = executable();
  }
  return node;
}

export function callablePins(graph?: BlueprintGraph): BlueprintPin[] {
  return [blueprintPin('exec_in', '执行', 'input'), ...(graph?.exposedInputs ?? []).map(pin => ({ ...pin, id: `arg_${pin.id}`, direction: 'input' as const })),
    blueprintPin('exec_out', '完成', 'output'), ...(graph?.exposedOutputs ?? []).map(pin => ({ ...pin, id: `out_${pin.id}`, direction: 'output' as const, required: false }))];
}

export function createBlueprintGraph(kind: BlueprintGraph['kind'], name: string): BlueprintGraph {
  return { id: makeId('blueprint'), name, kind, nodes: [blueprintNodeDefaults('event')], links: [], exposedInputs: [], exposedOutputs: [] };
}

export function blueprintInputValue(node: BlueprintNode, pinId: string): VariableValue | undefined {
  const key = pinId === 'first_index' ? 'firstIndex' : pinId === 'last_index' ? 'lastIndex' : pinId;
  return node.properties[key] ?? node.pins.find(pin => pin.id === pinId)?.defaultValue;
}

function changedUiPropertyInputTypes(node: BlueprintNode, previous?: BlueprintNode, pins = node.pins): Set<string> {
  if (node.type !== 'setUiProperty' || previous?.type !== 'setUiProperty') return new Set();
  const previousRows = blueprintUiPropertyDefinition(previous).rows;
  const edited = new Set((blueprintUiPropertyDefinition(node).rows ?? []).filter(row => previousRows?.some(before => before.id === row.id && before.property !== row.property
    && uiPropertyPinType(before.property) !== uiPropertyPinType(row.property))).map(row => row.id));
  return new Set(pins.filter(pin => edited.has(pin.id) && previous.pins.some(before => before.id === pin.id && before.dataType !== pin.dataType)).map(pin => pin.id));
}

/** Synchronize every caller in the same history edit as the interface change.
 * Old positional arguments are migrated along with their values and links. */
export function synchronizeBlueprintNodeValuePins(project:Project,graph:BlueprintGraph,node:BlueprintNode,previousUiPropertyNode?:BlueprintNode):void {
  if (isUiPageInterfaceNode(node.type)) {
    if (!node.properties.pageId && graph.uiPageId && !graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'pageId')) node.properties.pageId = uiPageNodePageId(graph, node);
    const pins = uiPageNodePins(project, graph, node);
    if (pins && !sameProjectValue(pins, node.pins)) node.pins = pins;
    // Keep stored arguments for repair, even when an interface pin was deleted.
    return;
  }
  if (isUiControlOptionNode(node.type)) { const pins = uiControlOptionPins(node); if (pins && !sameProjectValue(pins, node.pins)) node.pins = pins; return; }
  if (node.type === 'setUiProperty') {
    const pins = blueprintUiPropertyPins(node);
    if (!pins) return;
    const changedTypes = changedUiPropertyInputTypes(node, previousUiPropertyNode, pins);
    if (!sameProjectValue(pins, node.pins)) node.pins = pins;
    if (changedTypes.size) {
      const links = graph.links.filter(link => {
        if (link.toNodeId !== node.id || !changedTypes.has(link.toPinId)) return true;
        const from = graph.nodes.find(source => source.id === link.fromNodeId)?.pins.find(pin => pin.id === link.fromPinId);
        const to = pins.find(pin => pin.id === link.toPinId);
        return !from || !to || blueprintPinsCompatible(from, to);
      });
      if (links.length !== graph.links.length) graph.links = links;
    }
    return;
  }
  if (isBlueprintChoiceType(node.type)) { const pins = blueprintChoicePins(node); if (pins && !sameProjectValue(pins, node.pins)) node.pins = pins; return; }
  if (isBlueprintFlowControl(node.type)) {
    if (blueprintFlowControlScope(node) === 'page') {
      const pageId = blueprintFlowControlPageId(graph, node);
      if (pageId && node.properties.pageId === undefined) node.properties.pageId = pageId;
      if (!node.pins.some(pin => pin.id === 'pageId')) node.pins.push(blueprintPin('pageId', '状态所属页面', 'input', 'ui', pageId));
    } else if (node.pins.some(pin => pin.id === 'pageId')) node.pins = node.pins.filter(pin => pin.id !== 'pageId');
  }
  if(node.type==='stopUiAnimationPlayback'){const finish=node.pins.find(p=>p.id==='finish');if(finish)finish.name='到达方向终点';}
  if(node.type==='playUiAnimation'){const defaults=blueprintNodeDefaults('playUiAnimation');for(const pin of defaults.pins)if(!node.pins.some(p=>p.id===pin.id))node.pins.splice(Math.max(0,node.pins.length-1),0,pin);}
  if(node.type==='eventValueChanged'){const type=uiControlEventType(project,node.properties.componentId)??'number';for(const pin of node.pins)if(['value','previous'].includes(pin.id)){pin.dataType=type;pin.defaultValue=defaultBlueprintValue(type);}return;}
  const variable = blueprintStateVariable(project, graph, node);
  if (node.type === 'getVariable' || node.type === 'setVariable') {
    if (blueprintStateScope(project, node) === 'page') {
      const pageId = blueprintStatePageId(graph, node);
      if (pageId && !node.properties.pageId) node.properties.pageId = pageId;
      if (!node.pins.some(pin => pin.id === 'pageId')) node.pins.push(blueprintPin('pageId', '页面', 'input', 'ui', pageId));
    } else if (node.pins.some(pin => pin.id === 'pageId')) node.pins = node.pins.filter(pin => pin.id !== 'pageId');
  }
  const input = graph.exposedInputs.find(pin => pin.id === node.properties.inputId);
  const output = graph.exposedOutputs.find(pin => pin.id === node.properties.outputId);
  const preference = ['setPlayerPreference', 'getPlayerPreference'].includes(node.type) ? playerPreferences[node.properties.preference as PlayerPreference] : undefined;
  const type = node.type === 'getVariable' || node.type === 'setVariable' ? variable?.type : node.type === 'getInput' ? input?.dataType : node.type === 'setOutput' ? output?.dataType : ['getUiProperty', 'getUiDefault'].includes(node.type) ? uiPropertyPinType(String(node.properties.property)) : preference?.type;
  if (type) for (const pin of node.pins) if (pin.id === 'value') {
    pin.dataType = type;
    if (['getUiProperty', 'getUiDefault'].includes(node.type) && pin.defaultValue !== undefined && typeof pin.defaultValue !== type) pin.defaultValue = uiProperties[node.properties.property as UiProperty]?.initial;
    if (preference && pin.defaultValue !== undefined && typeof pin.defaultValue !== type) pin.defaultValue = preference.initial;
}
if (preference) {
  if (node.properties.preference === 'characterVolume' && !node.pins.some(pin => pin.id === 'characterId')) node.pins.push(blueprintPin('characterId', '角色（留空为其他）', 'input', 'character'));
  else if (node.properties.preference !== 'characterVolume' && node.pins.some(pin => pin.id === 'characterId')) node.pins = node.pins.filter(pin => pin.id !== 'characterId');
}
}

/** With a pre-edit snapshot, synchronize only semantic edits and affected callers.
 * Omit it for imports/migrations. Never pass a mutable alias as the snapshot. */
export function synchronizeBlueprintSignatures(project: Project, before?: Project): void {
  const normalized = normalizeProjectResources(project);
  const snapshot = projectReadSnapshot(project);
  const previous = before && projectReadSnapshot(before);
  // Story rows contain callers, but never define a blueprint's pins. A prose or
  // text-style edit must not resynchronize every saved action in every graph.
  const graphKeys = new Set(['blueprints', 'timelinePresets', 'nodes', 'scriptText']);
  // Other project resources can alter derived visual/control/state interfaces.
  // Unknown resource changes deliberately take the conservative full path.
  const full = normalized || !previous || previous.id !== snapshot.id
    || [...new Set([...Object.keys(previous), ...Object.keys(snapshot)])].some(key => !graphKeys.has(key)
      && !sameProjectValue(previous[key as keyof Project], snapshot[key as keyof Project]));
  const graphs = projectGraphs(project);
  const oldGraphs = new Map(projectGraphs(previous).map(graph => [graph.id, graph]));
  const graphById = new Map(graphs.map(graph => [graph.id, graph]));
  const work = new Map<string, 'all' | Set<string>>();
  const touch = (graphId: string, nodeId?: string) => {
    if (!work.has(graphId)) work.set(graphId, new Set());
    const selected = work.get(graphId)!;
    if (nodeId && selected !== 'all') selected.add(nodeId);
  };
  const selected = (graph: BlueprintGraph, node: BlueprintNode) => work.get(graph.id) === 'all'
    || (work.get(graph.id) as Set<string> | undefined)?.has(node.id);
  const semanticNode = ({ x: _x, y: _y, ...node }: BlueprintNode) => node;
  const graphContext = ({ nodes: _nodes, links: _links, timeline: _timeline, ...graph }: BlueprintGraph) => graph;
  for (const graph of projectGraphs(snapshot)) {
    const old = oldGraphs.get(graph.id);
    if (full || !old || !sameProjectValue(graphContext(old), graphContext(graph))) { work.set(graph.id, 'all'); continue; }
    if (old === graph) continue;
    if (old.nodes !== graph.nodes) {
      const oldNodes = new Map(old.nodes.map(node => [node.id, node]));
      if (old.nodes.length !== graph.nodes.length || graph.nodes.some(node => !oldNodes.has(node.id))) touch(graph.id);
      for (const node of graph.nodes) {
        const prior = oldNodes.get(node.id);
        if (!prior || prior !== node && !sameProjectValue(semanticNode(prior), semanticNode(node))) touch(graph.id, node.id);
      }
    }
    if (!sameProjectValue(old.timeline, graph.timeline)) touch(graph.id);
    if (old.links !== graph.links) {
      const oldLinks = new Map(old.links.map(link => [link.id, link]));
      for (const link of graph.links) {
        const prior = oldLinks.get(link.id);
        if (!sameProjectValue(prior, link)) { touch(graph.id, link.toNodeId); if (prior) touch(graph.id, prior.toNodeId); }
        oldLinks.delete(link.id);
      }
      for (const link of oldLinks.values()) touch(graph.id, link.toNodeId);
    }
  }
  const replacePinsAndProperties = (node: BlueprintNode, edit: (candidate: BlueprintNode) => void) => {
    const candidate = { ...node, pins: node.pins.map(pin => ({ ...pin })), properties: { ...node.properties } };
    edit(candidate);
    if (!sameProjectValue(node.pins, candidate.pins)) node.pins = candidate.pins;
    if (!sameProjectValue(node.properties, candidate.properties)) node.properties = candidate.properties;
  };
  // Resolve deleted visual fields before synchronizing callers, regardless of graph order.
  for (const graph of graphs) {
    if (!work.has(graph.id)) continue;
    for (const node of graph.nodes) if (selected(graph, node) && node.type === 'savedAction') replacePinsAndProperties(node, candidate => {
      try {
        let action = actionSchema.parse(JSON.parse(String(candidate.properties.action)));
        if (action.kind === 'visual') { action = materializeVisualCompositions(project, action); candidate.properties.action = JSON.stringify(action); syncVisualPins(candidate, action); }
        if (action.kind === 'audioClip') syncAudioClipPins(candidate, action);
      } catch { /* Keep malformed actions for diagnostics. */ }
    });
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const candidates = new Set<string>();
    const links = graph.links.filter(link => {
      const target = nodes.get(link.toNodeId);
      if (target?.type !== 'savedAction' || !link.toPinId.startsWith('object_') || target.pins.some(pin => pin.id === link.toPinId)) return true;
      const source = nodes.get(link.fromNodeId);
      if (source?.type === 'getInput') candidates.add(String(source.properties.inputId));
      return false;
    });
    if (links.length !== graph.links.length) graph.links = links;
    for (const id of candidates) {
      const readers = new Set(graph.nodes.filter(node => node.type === 'getInput' && node.properties.inputId === id).map(node => node.id));
      if (graph.links.some(link => readers.has(link.fromNodeId))) continue;
      if (graph.exposedInputs.some(pin => pin.id === id)) graph.exposedInputs = graph.exposedInputs.filter(pin => pin.id !== id);
      graph.nodes = graph.nodes.filter(node => !readers.has(node.id));
      const remaining = graph.links.filter(link => !readers.has(link.toNodeId));
      if (remaining.length !== graph.links.length) graph.links = remaining;
      work.set(graph.id, 'all');
    }
  }
  const interfaces = new Set<string>();
  for (const graph of graphs) {
    const old = oldGraphs.get(graph.id);
    if (full || !old || !sameProjectValue(old.exposedInputs, graph.exposedInputs) || !sameProjectValue(old.exposedOutputs, graph.exposedOutputs)) interfaces.add(graph.id);
  }
  for (const id of oldGraphs.keys()) if (!graphById.has(id)) interfaces.add(id);
  const syncAction = (action: StageAction, edited = false) => {
    if (action.kind !== 'blueprint' || !action.inputs || !edited && !full && !interfaces.has(action.blueprintId)) return;
    const target = graphById.get(action.blueprintId);
    if (!target) return;
    const ids = new Set(target.exposedInputs.map(pin => pin.id));
    for (const id of Object.keys(action.inputs)) if (!ids.has(id)) delete action.inputs[id];
    if (!Object.keys(action.inputs).length) delete action.inputs;
  };
  if (full || interfaces.size) {
    for (const node of project.nodes) if (node.kind === 'passage') for (const line of node.lines) line.actions.forEach(action => syncAction(action));
    for (const scene of project.scenes) scene.entryActions?.forEach(action => syncAction(action));
    for (const effect of project.effects) effect.actions?.forEach(action => syncAction(action));
    for (const character of project.characters) for (const feature of character.features ?? []) feature.actions?.forEach(action => syncAction(action));
    for (const graph of graphs) for (const node of graph.nodes) {
      if (isBlueprintModuleReference(node.type) && interfaces.has(String(node.properties.graphId))) touch(graph.id, node.id);
      if (node.type === 'savedAction' && !selected(graph, node)) {
        try { const action = JSON.parse(String(node.properties.action)); if (action.kind === 'blueprint' && interfaces.has(action.blueprintId)) touch(graph.id, node.id); }
        catch { /* Malformed actions retain their diagnostics. */ }
      }
    }
  }
  // New or edited story calls still need stale arguments removed when their
  // callee's interface did not change. Inspect plain snapshots before touching
  // a draft, so typing in an unrelated row does not proxy the whole story.
  if (!full && previous && previous.nodes !== snapshot.nodes) {
    const oldNodes = new Map(previous.nodes.map(node => [node.id, node]));
    for (const node of snapshot.nodes) {
      const old = oldNodes.get(node.id);
      if (node === old || node.kind !== 'passage') continue;
      const oldLines = new Map(old?.kind === 'passage' ? old.lines.map(line => [line.id, line]) : []);
      for (const line of node.lines) {
        if (sameProjectValue(oldLines.get(line.id)?.actions, line.actions) || !line.actions.some(action => action.kind === 'blueprint' && action.inputs)) continue;
        const target = project.nodes.find(item => item.id === node.id);
        if (target?.kind === 'passage') target.lines.find(item => item.id === line.id)?.actions.forEach(action => syncAction(action, true));
      }
    }
  }
  for (const graph of graphs) {
    if (!work.has(graph.id)) continue;
    if (graph.timeline) {
      const nodeIds = new Set(graph.nodes.map(node => node.id));
      const clips = graph.timeline.clips.filter(clip => nodeIds.has(clip.nodeId));
      if (clips.length !== graph.timeline.clips.length) graph.timeline.clips = clips;
      if (graph.timeline.tailNodeId && !nodeIds.has(graph.timeline.tailNodeId)) delete graph.timeline.tailNodeId;
    }
    for (const node of graph.nodes) {
      if (!selected(graph, node)) continue;
      if (['shake', 'showBackground', 'showCharacter', 'hideCharacter', 'showChapter'].includes(node.type)) for (const pin of blueprintNodeDefaults(node.type).pins) if (!node.pins.some(existing => existing.id === pin.id)) node.pins.push(['presetId', 'lifetime'].includes(pin.id) ? { ...pin, defaultValue: '' } : pin.id === 'useDefaultFraming' ? { ...pin, defaultValue: false } : pin.id === 'duration' && node.properties.transition === 'fade' ? { ...pin, defaultValue: 1 } : pin);
      if (node.type === 'showCharacter' || node.type === 'hideCharacter') {
        const pin = node.pins.find(pin => pin.id === 'instanceId');
        // Keep the stable pin and string type so existing links and calls work.
        if (pin && ['实例 ID', '实例ID'].includes(pin.name)) pin.name = '第几个';
      }
      if (node.type === 'savedAction') replacePinsAndProperties(node, candidate => {
        try {
          const action = actionSchema.parse(JSON.parse(String(candidate.properties.action)));
          // New/edited saved calls also prune stale inputs when the callee is unchanged.
          if (action.kind === 'blueprint' && action.inputs) {
            const target = graphById.get(action.blueprintId);
            if (target) { const ids = new Set(target.exposedInputs.map(pin => pin.id)); for (const id of Object.keys(action.inputs)) if (!ids.has(id)) delete action.inputs[id]; if (!Object.keys(action.inputs).length) delete action.inputs; }
          }
          if (action.kind === 'visual') syncVisualPins(candidate, action);
          if (action.kind === 'audioClip') syncAudioClipPins(candidate, action);
          candidate.properties.action = JSON.stringify(action);
        } catch { /* Invalid saved actions remain visible in diagnostics. */ }
      });
      if (isBlueprintTaskNode(node.type)) {
        // Unknown versions retain their pins and arguments for explicit repair.
        if (node.properties.taskVersion !== blueprintTaskVersion) continue;
        const target = graphById.get(String(node.properties.graphId));
        if (isBlueprintModuleReference(node.type) && node.properties.graphId && !target) continue;
        const pins = blueprintTaskPins(node, target);
        if (blueprintTaskScope(node) === 'page') for (const pin of pins) if (pin.id === 'pageId') pin.defaultValue = blueprintTaskPageId(graph, node);
        if (!sameProjectValue(node.pins, pins)) node.pins = pins;
        if (target) { const ids = new Set(target.exposedInputs.map(pin => 'arg_' + pin.id)); for (const key of Object.keys(node.properties)) if (key.startsWith('arg_') && !ids.has(key)) delete node.properties[key]; }
      } else if (node.type === 'callFunction' || node.type === 'callMacro') {
        const target = graphById.get(String(node.properties.graphId));
        if (!target) continue;
        const stableIds = new Set(target.exposedInputs.map(pin => 'arg_' + pin.id));
        target.exposedInputs.forEach((pin, index) => {
          const oldId = 'arg_' + index, newId = 'arg_' + pin.id;
          // A real numeric stable ID is not a positional legacy alias.
          if (oldId === newId || stableIds.has(oldId)) return;
          if (node.properties[newId] === undefined && node.properties[oldId] !== undefined) node.properties[newId] = node.properties[oldId];
          if (Object.hasOwn(node.properties, oldId)) delete node.properties[oldId];
          for (const link of graph.links) if (link.toNodeId === node.id && link.toPinId === oldId) link.toPinId = newId;
        });
        const pins = callablePins(target);
        if (!sameProjectValue(node.pins, pins)) node.pins = pins;
        for (const key of Object.keys(node.properties)) if (key.startsWith('arg_') && !stableIds.has(key)) delete node.properties[key];
      } else synchronizeBlueprintNodeValuePins(project, graph, node);
    }
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const changedPropertyInputs = new Map<string, Set<string>>();
    for (const node of graph.nodes) if (node.type === 'setUiProperty' && selected(graph, node)) {
      const changed = changedUiPropertyInputTypes(node, oldGraphs.get(graph.id)?.nodes.find(before => before.id === node.id));
      if (changed.size) changedPropertyInputs.set(node.id, changed);
    }
    // Finish every source/target signature before removing type-invalid links;
    // one history edit may change both ends, regardless of node storage order.
    const links = graph.links.filter(link => {
      const from = nodes.get(link.fromNodeId)?.pins.find(pin => pin.id === link.fromPinId), to = nodes.get(link.toNodeId)?.pins.find(pin => pin.id === link.toPinId);
      return !!from && !!to && (!changedPropertyInputs.get(link.toNodeId)?.has(link.toPinId) || blueprintPinsCompatible(from, to));
    });
    if (links.length !== graph.links.length) graph.links = links;
  }
}

export function connectBlueprintPins(graph: BlueprintGraph, fromNodeId: string, fromPinId: string, toNodeId: string, toPinId: string): string | undefined {
  const from = graph.nodes.find(node => node.id === fromNodeId)?.pins.find(pin => pin.id === fromPinId);
  const to = graph.nodes.find(node => node.id === toNodeId)?.pins.find(pin => pin.id === toPinId);
  if (!from || !to) return '连接点已不存在，请重新选择。';
  if (fromNodeId === toNodeId && from.dataType !== 'exec') return '不能连接到节点自身。重复执行请使用计数循环。';
  if (!blueprintPinsCompatible(from, to)) return `无法连接：${blueprintTypeNames[from.dataType]}不能传给${blueprintTypeNames[to.dataType]}。`;
  const sameKindLinks = graph.links.filter(link => {
    const source = graph.nodes.find(node => node.id === link.fromNodeId)?.pins.find(pin => pin.id === link.fromPinId);
    return (source?.dataType === 'exec') === (from.dataType === 'exec');
  });
  const reaches = (id: string, seen = new Set<string>()): boolean => {
    if (id === fromNodeId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return sameKindLinks.some(link => link.fromNodeId === id && reaches(link.toNodeId, seen));
  };
  if (from.dataType === 'exec' ? blueprintExecutionConnectionCycles(graph, fromNodeId, fromPinId, toNodeId, toPinId) : reaches(toNodeId)) return '这条连线会形成循环。重复执行请使用计数循环节点。';
  graph.links = graph.links.filter(link => from.dataType === 'exec'
    ? !(link.fromNodeId === fromNodeId && link.fromPinId === fromPinId)
    : !(link.toNodeId === toNodeId && link.toPinId === toPinId));
  graph.links.push({ id: makeId('bplink'), fromNodeId, fromPinId, toNodeId, toPinId });
  return undefined;
}

export function sceneEntry(project: Project, sceneId: string) {
  return project.nodes.find(node => node.sceneId === sceneId && node.kind === 'start') ?? project.nodes.find(node => node.sceneId === sceneId);
}

function blueprintValueLabel(project: Project, value: VariableValue | undefined, type?: BlueprintDataType, indexes?: AuthoringIndexCache): string {
  if (type === 'component') {
    const component = indexes ? indexes.ui(project).declaredById.get(typeof value === 'string' ? value : '') : declaredUiComponents(project).find(c => c.id === value);
    return component?.name || component?.text || (component ? '界面组件' : '未指定控件');
  }
  if (type === 'asset') return (indexes ? indexes.assets(project).byId.get(typeof value === 'string' ? value : '') : project.assets.find(a => a.id === value))?.name ?? '未指定素材';
  if (type === 'character') return project.characters.find(c => c.id === value)?.name ?? '未指定角色';
  if (type === 'ui') return uiPage(project, String(value ?? ''))?.name ?? blueprintScreens[String(value)] ?? '未指定页面';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value ? `「${value}」` : '空文字';
  return value === undefined ? '未设置' : String(value);
}

/** Describe the source, never evaluate it or substitute the input's inactive default. */
export function blueprintOutputLabel(project: Project, graph: BlueprintGraph, node: BlueprintNode, pinId: string, indexes?: AuthoringIndexCache): string {
  if (!node.pins.some(p=>p.id===pinId&&p.direction==='output')) return node.name + ' · 缺失输出';
  if (node.type === 'getVariable') return blueprintStateScopes[blueprintStateScope(project, node)].name + ' · ' + (blueprintStateVariable(project, graph, node)?.name ?? '缺失变量');
  if (node.type === 'getInput') return '输入 · ' + (graph.exposedInputs.find(p => p.id === node.properties.inputId)?.name ?? '缺失输入');
  if (node.type === 'getPlayerPreference') return '玩家选项 · ' + (playerPreferences[node.properties.preference as PlayerPreference] ? preferenceInfo(project, node.properties.preference as PlayerPreference).name : '未选择');
  if (node.type === 'literal') return blueprintAssetNodePresentation(project, node)?.title ?? '常量 · ' + blueprintValueLabel(project, node.properties.value, node.pins.find(p => p.id === pinId)?.dataType, indexes);
  if (node.type === 'getUiProperty') {
    const linked = graph.links.some(l => l.toNodeId === node.id && l.toPinId === 'componentId');
    const target = linked ? '接线控件' : blueprintValueLabel(project, blueprintInputValue(node, 'componentId'), 'component', indexes);
    return target + ' · ' + (uiProperties[node.properties.property as UiProperty]?.name ?? '未知属性');
  }
  return node.name + ' · ' + (node.pins.find(p => p.id === pinId)?.name ?? '缺失输出');
}

export function blueprintInputSource(project: Project, graph: BlueprintGraph, nodeId: string, pinId: string, indexes?: AuthoringIndexCache) {
  const link = graph.links.find(l => l.toNodeId === nodeId && l.toPinId === pinId);
  if (!link) return;
  const source = graph.nodes.find(n => n.id === link.fromNodeId);
  return { nodeId: source?.id, label: source ? blueprintOutputLabel(project, graph, source, link.fromPinId, indexes) : '缺失节点' };
}

function blueprintInputLabel(project: Project, graph: BlueprintGraph, node: BlueprintNode, pinId: string, fallback?: VariableValue, indexes?: AuthoringIndexCache): string {
  const source = blueprintInputSource(project, graph, node.id, pinId, indexes);
  if (source) return source.label;
  return blueprintValueLabel(project, blueprintInputValue(node, pinId) ?? fallback, node.pins.find(p => p.id === pinId)?.dataType, indexes);
}

export function blueprintNodeSummary(project: Project, graph: BlueprintGraph, node: BlueprintNode, indexes?: AuthoringIndexCache): string {
  if (isBlueprintChoiceType(node.type)) { const definition = blueprintChoiceDefinition(node); return definition.problems[0] ?? ((definition.cases?.length ?? 0) + (node.type === 'switchValue' ? ' 个分支 · 未匹配走其他情况' : ' 个候选值 · 只读取命中项')); }
  if (isBlueprintFlowControl(node.type)) return (blueprintFlowControlScope(node) === 'page' ? '页面实例 · ' + (uiPage(project, blueprintFlowControlPageId(graph, node))?.name ?? '未选择页面') : '本次调用') + (blueprintFlowControlInitial(node) ? ' · 初始关闭' : ' · 初始可通过');
  if (isBlueprintTaskNode(node.type)) return node.properties.taskVersion !== blueprintTaskVersion ? '任务定义版本无法识别；保留原数据等待修复' : ['startTask', 'debounce'].includes(node.type) ? (projectGraphs(project).find(item => item.id === node.properties.graphId)?.name ?? '请选择任务模块') + (blueprintTaskScope(node) === 'page' ? ' · 页面实例' : ' · 本次调用') : blueprintTaskCatalog[node.type].hint;
  if (node.type === 'comment') return String(node.properties.text || '双击或选中后编写说明');
  if (node.type === 'callFunction' || node.type === 'callMacro') {
    const target = projectGraphs(project)?.find(item => item.id === node.properties.graphId);
    return target?.timelineComponent || target?.timeline ? '时间轴组件 · 双击编辑 · 未传入素材使用默认值' : target?.name ?? '请选择调用流程';
  }
  if (node.type === 'getVariable' || node.type === 'setVariable') return blueprintStateScopes[blueprintStateScope(project, node)].name + ' · ' + (blueprintStateVariable(project, graph, node)?.name ?? '请选择状态');
  if (node.type === 'getInput') return graph.exposedInputs.find(item => item.id === node.properties.inputId)?.name ?? '请选择输入参数';
  if (node.type === 'setOutput') return graph.exposedOutputs.find(item => item.id === node.properties.outputId)?.name ?? '请选择输出结果';
  if (node.type === 'switchScene') return project.scenes.find(item => item.id === node.properties.sceneId)?.name ?? '请选择目标场景';
  if (['showBackground', 'playMusic', 'playSound'].includes(node.type)) return (indexes ? indexes.assets(project).byId.get(typeof node.properties.assetId === 'string' ? node.properties.assetId : '') : project.assets.find(item => item.id === node.properties.assetId))?.name ?? '请选择素材';
  if (node.type === 'showCharacter' || node.type === 'hideCharacter') {
    const character = effectiveCharacter(project, String(node.properties.characterId ?? ''));
    return character ? `${character.name}${node.type === 'showCharacter' ? ` · ${character.expressions.find(item => item.id === node.properties.expressionId)?.name ?? '选择表情'}` : ''}` : '请选择角色';
  }
  if (node.type === 'uiAction') return blueprintScreens[String(node.properties.screen)] ?? '请选择界面';
  if (node.type === 'getPlayerPreference' || node.type === 'setPlayerPreference') {
    if (node.properties.preference === 'characterVolume') return (blueprintInputSource(project, graph, node.id, 'characterId', indexes)?.label ?? (node.properties.characterId ? effectiveCharacter(project,String(node.properties.characterId))?.name ?? '缺失角色' : '默认')) + ' · 角色音量';
    return playerPreferences[node.properties.preference as PlayerPreference] ? preferenceInfo(project, node.properties.preference as PlayerPreference).name : '请选择玩家设置';
  }
  if (node.type === 'confirmMessage') return String(node.properties.message ?? '确认继续吗？');
  if (['playUiAnimation','stopUiAnimationPlayback'].includes(node.type)) {
    const name = project.ui.animations?.find(a=>a.id===node.properties.animationId)?.name ?? '请选择界面动画';
    if (node.type === 'stopUiAnimationPlayback') return name + ' · 停止播放';
    const mode = ({forward:'正放',reverse:'倒放',pingpong:'往返'} as Record<string,string>)[String(node.properties.playMode ?? 'forward')] ?? '未知方向';
    const loops = blueprintInputSource(project, graph, node.id, 'loops', indexes)?.label ?? ((blueprintInputValue(node,'loops')??1) === 0 ? '无限循环' : String(blueprintInputValue(node,'loops')??1)+'次');
    return `${name} · ${mode} · ${loops}`;
  }
  if (isUiControlOptionNode(node.type)) {
    const target = blueprintInputLabel(project, graph, node, 'componentId', undefined, indexes);
    if (node.type === 'getUiControlOption') return target + ' · 索引 ' + blueprintInputLabel(project, graph, node, 'index', undefined, indexes);
    return target + ' · ' + (uiControlOptionOperations[node.properties.operation as keyof typeof uiControlOptionOperations] ?? '无效选项操作');
  }
  if (['focusUiComponent', 'setUiControlRange', 'resetUiControlRange', 'setUiProperty', 'getUiProperty', 'getUiDefault', 'resetUiProperty', 'animateUiProperty', 'stopUiAnimation', 'resetUiComponent', 'playUiVideo', 'pauseUiVideo', 'stopUiVideo', 'playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type)) {
    const target = blueprintInputLabel(project, graph, node, 'componentId', undefined, indexes);
    const property = uiProperties[node.properties.property as UiProperty]?.name ?? (node.properties.property === 'all' ? '全部属性' : '未知属性');
    if (node.type === 'focusUiComponent') return `${target} · 获取焦点 = ${blueprintInputLabel(project, graph, node, 'focused', undefined, indexes)}（请求）`;
    if (node.type === 'setUiControlRange') return `${target} · ${blueprintInputLabel(project, graph, node, 'minimum', undefined, indexes)}～${blueprintInputLabel(project, graph, node, 'maximum', undefined, indexes)} · 步长 ${blueprintInputLabel(project, graph, node, 'step', undefined, indexes)}`;
    if (node.type === 'resetUiControlRange') return `${target} · 恢复整个设计范围`;
    if (node.type === 'setUiProperty') {
      const definition = blueprintUiPropertyDefinition(node);
      if (definition.problems.length) return `${target} · ${definition.problems[0]}`;
      return `${target} · ${definition.rows!.map(row => `${row.writeMode === 'source' ? '修改绑定源 · ' : ''}${uiProperties[row.property as UiProperty].name} = ${blueprintInputLabel(project, graph, node, row.id, undefined, indexes)}`).join('；')}`;
    }
    if (node.type === 'getUiProperty') return `${target} · ${property}`;
    if (node.type === 'animateUiProperty') return `${target} · ${property} → ${blueprintInputLabel(project, graph, node, 'value', undefined, indexes)}`;
    if (node.type === 'stopUiAnimation') return `${target} · 停止${property}`;
    if (node.type === 'playUiVideo') return `${target} · 重新开始 = ${blueprintInputLabel(project, graph, node, 'restart', undefined, indexes)}`;
    if (node.type === 'pauseUiVideo') return `${target} · 暂停 = ${blueprintInputLabel(project, graph, node, 'paused', undefined, indexes)}`;
    if (node.type === 'stopUiVideo') return `${target} · 回到开头并显示封面`;
    if (node.type === 'resetUiComponent') return `${target} · 恢复设计值`;
    return target + (node.type === 'playSpine' ? ' · ' + blueprintInputLabel(project, graph, node, 'animation', undefined, indexes) : '');
  }
  if (node.type === 'effect') return project.effects.find(item => item.id === node.properties.effectId)?.name ?? '请选择演出效果';
  if (node.type === 'literal') return blueprintAssetNodePresentation(project, node)?.title ?? (typeof node.properties.value === 'boolean' ? (node.properties.value ? '是' : '否') : String(node.properties.value ?? ''));
  if (node.type === 'delay') return `${blueprintInputValue(node, 'seconds') ?? 1} 秒`;
  if(node.type==='event'&&graph.uiPageId)return '每次显示当前页面时，从这里开始执行。';
  return blueprintCatalog[node.type].hint;
}
