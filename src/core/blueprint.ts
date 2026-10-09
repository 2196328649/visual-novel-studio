import { normalizeProjectResources, projectGraphs } from './project-resources';
import { syncAudioClipPins } from './audio-clip';
import { uiControlEventType } from './ui-control-events';
import { syncVisualPins } from './visual-object';
import { materializeVisualCompositions } from './visual-composition';
import { actionSchema, declaredUiComponents, effectiveCharacter, makeId, type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Project, type StageAction, type VariableValue } from './model';
import { uiProperties, type UiProperty } from './ui';
import { playerPreferences, type PlayerPreference } from './preferences';

export type BlueprintNodeType = BlueprintNode['type'];
export type BlueprintDataType = BlueprintPin['dataType'];
export const blueprintTypeNames: Record<BlueprintDataType, string> = {
  exec: '执行', boolean: '开关', number: '数值', string: '文字', asset: '素材', scene: '场景', character: '角色', ui: '界面', component: '界面组件', any: '任意值',
};
export const blueprintKindNames: Record<BlueprintGraph['kind'], string> = {
  function: '可复用流程', macro: '用户节点', effect: '演出效果', scene: '场景事件', character: '角色事件', ui: '界面事件', minigame: '小游戏逻辑',
};
export const blueprintCategories = ['常用演出', '界面与动画', '流程控制', '状态与计算', '复用与参数', '高级'] as const;
export const blueprintCatalog: Record<BlueprintNodeType, { name: string; category: typeof blueprintCategories[number]; hint: string }> = {
  event: { name: '事件开始', category: '流程控制', hint: '蓝图被调用时，从这里沿执行线开始。' },
  eventTextCommitted: { name: '文字提交时', category: '界面与动画', hint: '自由文字输入按 Enter 或离开输入框时执行。提供提交文字与提交方式；隐藏、禁用、离页和内部刷新不提交。' },
  eventValueChanged: { name: '控件值改变时', category: '界面与动画', hint: '用户拖动滑块、切换选项或编辑文字且值确实改变时执行。新值与旧值可直接接线，初始化和蓝图直接修改参数不触发此事件。' },
  eventButton: { name: '按钮交互事件', category: '界面与动画', hint: '按钮悬停、移出、按下或松开时执行。移出后松开仍触发松开，但不点击；禁用、隐藏或离页会取消交互。' },
  eventClick: { name: '点击控件时', category: '界面与动画', hint: '指定按钮被点击时执行；按钮所在界面关闭后不再接收事件。' },
  eventKey: { name: '按键时', category: '界面与动画', hint: '指定自定义界面显示期间，按下按键执行后续节点。' },
  eventTimer: { name: '定时触发', category: '界面与动画', hint: '指定界面显示期间，按间隔触发，可循环；关闭页面后自动停止。' },
  showUiPage: { name: '打开自定义界面', category: '界面与动画', hint: '显示自己设计的界面。等待关闭为“是”时暂停剧情，并返回关闭结果；为“否”时作为叠加界面显示。' },
  closeUiPage: { name: '关闭自定义界面', category: '界面与动画', hint: '关闭指定页面，停止页面的定时与按键事件，并将结果交给打开界面的节点。' },
  random: { name: '随机数', category: '状态与计算', hint: '生成两端之间的随机数。把结果写入状态即可在后续节点复用同一个随机值。' },
  formatText: { name: '格式化文字', category: '状态与计算', hint: '把文字中的 {value} 替换为输入值，例如 命中 {value}/5。' },
  sequence: { name: '依次执行', category: '流程控制', hint: '先完成第一条流程，再执行第二条流程。' },
  branch: { name: '条件分支', category: '流程控制', hint: '根据条件是否满足，选择一条执行路线。' },
  compare: { name: '比较', category: '状态与计算', hint: '比较两个值，将是否满足条件传给条件分支。' },
  select: { name: '选择值', category: '状态与计算', hint: '根据条件，从两个值中选一个作为结果。' },
  setVariable: { name: '设置状态', category: '状态与计算', hint: '修改好感度、已获得道具等作品状态。' },
  getVariable: { name: '读取状态', category: '状态与计算', hint: '把作品状态的当前值传给其他节点。' },
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
  startDialogue: { name: '播放台词演出', category: '常用演出', hint: '从此处开始本句文字和配音，后续演出继续；同一句只触发一次。' },
  showChapter: { name: '章节演出', category: '常用演出', hint: '播放章节标题、题图、蒙板转场与音效，完成后继续。' },
  camera: { name: '移动镜头', category: '常用演出', hint: '设置镜头位置、缩放、旋转与移动时长。' },
  shake: { name: '画面震动', category: '常用演出', hint: '让画面沿横向或纵向震动。' },
  savedAction: { name: '保存的演出', category: '常用演出', hint: '保留封装前的完整演出，可继续编辑默认设置。' },
  hideCharacter: { name: '隐藏角色', category: '常用演出', hint: '让指定角色离开舞台。' },
  playMusic: { name: '播放音乐', category: '常用演出', hint: '播放背景音乐，可循环或淡入。' },
  playSound: { name: '播放音效', category: '常用演出', hint: '播放一次音效，不影响背景音乐。' },
  stopMusic: { name: '停止音乐', category: '常用演出', hint: '选择停止背景音乐、音效或环境音，可设置淡出时间。' },
  uiAction: { name: '打开界面', category: '常用演出', hint: '打开存档、设置等游戏菜单，关闭菜单后继续。' },
  setUiProperty: { name: '设置组件属性', category: '界面与动画', hint: '修改组件显示、文字、位置或选中状态，立即更新游戏界面。' },
  getUiProperty: { name: '读取组件属性', category: '界面与动画', hint: '读取组件属性，连接条件分支或其他节点。' },
  playUiAnimation: { name: '播放界面动画', category: '界面与动画', hint: '播放控件关键帧动画，支持正放、倒放、往返、循环和中途换向。双击编辑动画。' },
  stopUiAnimationPlayback: { name: '停止界面动画', category: '界面与动画', hint: '停止这段命名动画仍在播放的轨道，保留当前值或到达播放方向的终点。' },
  animateUiProperty: { name: '控件属性动画', category: '界面与动画', hint: '从控件当前值平滑变化到目标；可同时动画多个属性。等待结束为是时结束后继续，停止或替换也会继续。' },
  stopUiAnimation: { name: '停止控件动画', category: '界面与动画', hint: '停止所选属性或控件全部动画，可保留当前值或直接到达目标值。' },
  resetUiComponent: { name: '重置组件', category: '界面与动画', hint: '恢复界面编辑器中的属性；骨骼动画也恢复初始播放状态。' },
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
export const blueprintKeyNames: Record<string, string> = { K_SPACE: '空格', K_RETURN: '回车', K_ESCAPE: 'Esc', K_UP: '↑', K_DOWN: '↓', K_LEFT: '←', K_RIGHT: '→', K_a: 'A', K_d: 'D', K_w: 'W', K_s: 'S', K_e: 'E' };

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
    case 'event': node.pins = [blueprintPin('exec', '开始', 'output')]; break;
    case 'eventTextCommitted': node.properties={componentId:''}; node.pins=[blueprintPin('exec','执行','output'),output('value','提交文字','string'),output('method','提交方式','string')]; break;
    case 'eventValueChanged': node.properties = { componentId: '' }; node.pins = [blueprintPin('exec', '执行', 'output'), output('value', '新值', 'number'), output('previous', '旧值', 'number')]; break;
    case 'eventButton': node.properties = { componentId: '', trigger: 'hover' }; node.pins = [blueprintPin('exec', '执行', 'output')]; break;
    case 'eventClick': node.properties = { componentId: '' }; node.pins = [blueprintPin('exec', '点击时', 'output')]; break;
    case 'eventKey': node.properties = { pageId: '', key: 'K_SPACE' }; node.pins = [blueprintPin('exec', '按下时', 'output')]; break;
    case 'eventTimer': node.properties = { pageId: '', interval: 1, repeat: true }; node.pins = [blueprintPin('exec', '触发时', 'output')]; break;
    case 'showUiPage': node.pins = executable(input('pageId', '自定义界面', 'ui'), input('wait', '等待关闭', 'boolean', true), output('result', '关闭结果', 'string')); break;
    case 'closeUiPage': node.pins = executable(input('pageId', '自定义界面', 'ui'), input('result', '关闭结果', 'string', '完成')); break;
    case 'random': node.pins = [input('min', '起点', 'number', 0), input('max', '终点', 'number', 1), output('value', '随机值', 'number')]; break;
    case 'formatText': node.pins = [input('format', '格式', 'string', '{value}'), input('value', '输入值', 'any', 0), output('text', '文字', 'string')]; break;
    case 'sequence': node.pins = [execIn, blueprintPin('then_0', '第一步', 'output'), blueprintPin('then_1', '第二步', 'output')]; break;
    case 'branch': node.pins = [execIn, input('condition', '条件', 'boolean', true), blueprintPin('true', '满足', 'output'), blueprintPin('false', '不满足', 'output')]; break;
    case 'compare': node.properties = { operator: 'eq' }; node.pins = [input('a', '第一个值', 'number', 0), input('b', '第二个值', 'number', 0), output('result', '是否满足', 'boolean')]; break;
    case 'select': node.pins = [input('condition', '条件', 'boolean', false), input('true_value', '满足时的值', 'any', ''), input('false_value', '不满足时的值', 'any', ''), output('result', '选中的值', 'any')]; break;
    case 'setVariable': node.pins = executable(input('value', '新值', 'any')); break;
    case 'getVariable': case 'getInput': node.pins = [output('value', '值', 'any')]; break;
    case 'literal': node.properties = { value: '' }; node.pins = [output('value', '值', 'string')]; break;
    case 'math': node.properties = { operation: 'add' }; node.pins = [input('a', '第一个数', 'number', 0), input('b', '第二个数', 'number', 0), output('result', '结果', 'number')]; break;
    case 'delay': node.properties = { seconds: 1 }; node.pins = executable(input('seconds', '秒数', 'number', 1)); break;
    case 'forLoop': node.properties = { firstIndex: 0, lastIndex: 3 }; node.pins = [execIn, input('first_index', '起始数', 'number', 0), input('last_index', '结束数', 'number', 3), blueprintPin('loop_body', '每次执行', 'output'), output('index', '当前计数', 'number'), blueprintPin('completed', '全部完成', 'output')]; break;
    case 'callFunction': case 'callMacro': node.pins = callablePins(); break;
    case 'switchScene': node.properties = { mode: 'dissolve', duration: 0.5, color: '#000000' }; node.pins = [execIn, input('sceneId', '目标场景', 'scene'), input('duration', '转场秒数', 'number', 0.5)]; break;
    case 'showBackground': node.properties = { transition: 'dissolve' }; node.pins = executable(input('assetId', '背景素材', 'asset'), input('duration', '时长', 'number', .5), input('wait', '等待完成', 'boolean', true)); break;
    case 'showCharacter': node.properties = { x: 0.5, y: 1, scale: 1, layer: 10, transition: 'dissolve' }; node.pins = executable(input('characterId', '角色', 'character', ''), input('expressionId', '表情', 'string', ''), input('instanceId', '实例 ID', 'string', ''), input('lifetime', '显示范围', 'string', 'line'), input('presetId', '站位预设', 'string', 'default'), input('useDefaultFraming', '使用角色默认构图', 'boolean', false), input('x', '横向位置', 'number', 0.5), input('y', '纵向位置', 'number', 1), input('scale', '大小', 'number', 1), input('layer', '层级', 'number', 10), input('duration', '时长', 'number', .5), input('wait', '等待完成', 'boolean', true)); break;
    case 'startDialogue': node.pins = executable(); break;
    case 'showChapter': node.pins = executable(input('title', '标题', 'string', '第一章'), input('subtitle', '副标题', 'string', ''), input('duration', '时长', 'number', 4.2), input('backgroundId', '章节背景', 'asset', ''), input('titleImageId', '章节题图', 'asset', ''), input('soundId', '章节音效', 'asset', ''), input('effect', '动效', 'string', ''), input('wait', '等待完成', 'boolean', true)); break;
    case 'camera': node.properties = { easing: 'ease', wait: true }; node.pins = executable(input('x', '横向位置', 'number', 0), input('y', '纵向位置', 'number', 0), input('zoom', '缩放', 'number', 1.1), input('rotation', '旋转', 'number', 0), input('duration', '时长', 'number', 0.5), input('wait', '等待完成', 'boolean', true)); break;
    case 'shake': node.pins = executable(input('direction', '方向', 'string', 'vertical'), input('duration', '时长', 'number', 0.6), input('amplitude', '幅度（像素）', 'number', 20), input('wait', '等待完成', 'boolean', true)); break;
    case 'savedAction': node.properties = { action: JSON.stringify({ kind: 'pause', seconds: 1 }) }; node.pins = executable(); break;
    case 'hideCharacter': node.properties = { transition: 'dissolve' }; node.pins = executable(input('characterId', '角色', 'character'), input('instanceId', '实例 ID', 'string', ''), input('duration', '时长', 'number', .5), input('wait', '等待完成', 'boolean', true)); break;
    case 'playMusic': node.properties = { loop: true, fade: 0.3 }; node.pins = executable(input('assetId', '音乐素材', 'asset'), input('loop', '循环播放', 'boolean', true), input('fade', '淡入秒数', 'number', 0.3)); break;
    case 'playSound': node.properties = { channel: 'sound', loop: false }; node.pins = executable(input('assetId', '音效素材', 'asset'), input('loop', '循环播放', 'boolean', false)); break;
    case 'stopMusic': node.properties = { fade: 0.3, channel: 'music' }; node.pins = executable(input('fade', '淡出秒数', 'number', 0.3)); break;
    case 'uiAction': node.properties = { screen: 'pause_menu' }; node.pins = executable(input('screen', '游戏界面', 'ui')); break;
    case 'setUiProperty': node.properties = { property: 'visible', value: true }; node.pins = executable(input('componentId', '界面组件', 'component'), input('value', '属性值', 'boolean', true)); break;
    case 'getUiProperty': node.properties = { property: 'visible' }; node.pins = [input('componentId', '界面组件', 'component'), output('value', '属性值', 'boolean')]; break;
    case 'playUiAnimation': node.properties = { animationId: '', playMode: 'forward', loops: 1, speed: 1, fromCurrent: false, wait: true }; node.pins = executable(input('loops', '循环次数（0为无限）', 'number', 1), input('speed', '播放速度', 'number', 1), input('fromCurrent', '沿用当前进度', 'boolean', false), input('wait', '等待结束', 'boolean', true)); node.pins.at(-1)!.name = '继续'; break;
    case 'stopUiAnimationPlayback': node.properties = { animationId: '', finish: false }; node.pins = executable(input('finish', '到达方向终点', 'boolean', false)); break;
    case 'animateUiProperty': node.properties = { property: 'opacity', easing: 'ease', value: 0, duration: .3, wait: true }; node.pins = executable(input('componentId', '界面组件', 'component'), input('value', '目标值', 'number', 0), input('duration', '持续秒数', 'number', .3), input('wait', '等待结束', 'boolean', true)); node.pins.at(-1)!.name = '继续'; break;
    case 'stopUiAnimation': node.properties = { property: 'all', finish: false }; node.pins = executable(input('componentId', '界面组件', 'component'), input('finish', '到达目标值', 'boolean', false)); break;
    case 'resetUiComponent': node.pins = executable(input('componentId', '界面组件', 'component')); break;
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

/** Synchronize every caller in the same history edit as the interface change.
 * Old positional arguments are migrated along with their values and links. */
export function synchronizeBlueprintNodeValuePins(project:Project,graph:BlueprintGraph,node:BlueprintNode):void {
  if(node.type==='stopUiAnimationPlayback'){const finish=node.pins.find(p=>p.id==='finish');if(finish)finish.name='到达方向终点';}
  if(node.type==='playUiAnimation'){const defaults=blueprintNodeDefaults('playUiAnimation');for(const pin of defaults.pins)if(!node.pins.some(p=>p.id===pin.id))node.pins.splice(Math.max(0,node.pins.length-1),0,pin);}
  if(node.type==='eventValueChanged'){const type=uiControlEventType(project,node.properties.componentId)??'number';for(const pin of node.pins)if(['value','previous'].includes(pin.id)){pin.dataType=type;pin.defaultValue=defaultBlueprintValue(type);}return;}
  const variable = project.variables.find(item => item.id === node.properties.variableId);
  const input = graph.exposedInputs.find(pin => pin.id === node.properties.inputId);
  const output = graph.exposedOutputs.find(pin => pin.id === node.properties.outputId);
  const preference = ['setPlayerPreference', 'getPlayerPreference'].includes(node.type) ? playerPreferences[node.properties.preference as PlayerPreference] : undefined;
  const type = node.type === 'getVariable' || node.type === 'setVariable' ? variable?.type : node.type === 'getInput' ? input?.dataType : node.type === 'setOutput' ? output?.dataType : ['setUiProperty', 'getUiProperty'].includes(node.type) ? uiProperties[node.properties.property as UiProperty]?.type : preference?.type;
  if (type) for (const pin of node.pins) if (pin.id === 'value') {
    pin.dataType = type;
    if (['setUiProperty', 'getUiProperty'].includes(node.type) && pin.defaultValue !== undefined && typeof pin.defaultValue !== type) pin.defaultValue = uiProperties[node.properties.property as UiProperty]?.initial;
    if (preference && pin.defaultValue !== undefined && typeof pin.defaultValue !== type) pin.defaultValue = preference.initial;
}
if (preference) {
  if (node.properties.preference === 'characterVolume' && !node.pins.some(pin => pin.id === 'characterId')) node.pins.push(blueprintPin('characterId', '角色（留空为其他）', 'input', 'character'));
  else if (node.properties.preference !== 'characterVolume') node.pins = node.pins.filter(pin => pin.id !== 'characterId');
}
}

export function synchronizeBlueprintSignatures(project: Project): void {
  normalizeProjectResources(project);
  const graphs = projectGraphs(project) ?? [];
  // Resolve deleted visual fields before synchronizing any callers, regardless of graph order.
  for (const graph of graphs) {
    for (const node of graph.nodes) if (node.type === 'savedAction') {
      try { let action = actionSchema.parse(JSON.parse(String(node.properties.action))); if (action.kind === 'visual') { action = materializeVisualCompositions(project, action); node.properties.action = JSON.stringify(action); syncVisualPins(node, action); } if (action.kind === 'audioClip') syncAudioClipPins(node, action); } catch { /* Keep malformed actions for diagnostics. */ }
    }
    const candidates = new Set<string>();
    graph.links = graph.links.filter(link => {
      const target = graph.nodes.find(node => node.id === link.toNodeId);
      if (target?.type !== 'savedAction' || !link.toPinId.startsWith('object_') || target.pins.some(pin => pin.id === link.toPinId)) return true;
      const source = graph.nodes.find(node => node.id === link.fromNodeId);
      if (source?.type === 'getInput') candidates.add(String(source.properties.inputId));
      return false;
    });
    for (const id of candidates) {
      const readers = new Set(graph.nodes.filter(node => node.type === 'getInput' && node.properties.inputId === id).map(node => node.id));
      if (graph.links.some(link => readers.has(link.fromNodeId))) continue;
      graph.exposedInputs = graph.exposedInputs.filter(pin => pin.id !== id);
      graph.nodes = graph.nodes.filter(node => !readers.has(node.id));
      graph.links = graph.links.filter(link => !readers.has(link.toNodeId));
    }
  }
  const syncAction = (action: StageAction) => {
    if (action.kind !== 'blueprint' || !action.inputs) return;
    const target = graphs.find(graph => graph.id === action.blueprintId);
    if (!target) return;
    const ids = new Set(target.exposedInputs.map(pin => pin.id));
    action.inputs = Object.fromEntries(Object.entries(action.inputs).filter(([id]) => ids.has(id)));
    if (!Object.keys(action.inputs).length) delete action.inputs;
  };
  for (const node of project.nodes) if (node.kind === 'passage') for (const line of node.lines) line.actions.forEach(syncAction);
  for (const scene of project.scenes) scene.entryActions?.forEach(syncAction);
  for (const effect of project.effects) effect.actions?.forEach(syncAction);
  for (const character of project.characters) for (const feature of character.features ?? []) feature.actions?.forEach(syncAction);
  for (const graph of graphs) {
    if (graph.timeline) {
      const nodeIds = new Set(graph.nodes.map(node => node.id));
      graph.timeline.clips = graph.timeline.clips.filter(clip => nodeIds.has(clip.nodeId));
      if (graph.timeline.tailNodeId && !nodeIds.has(graph.timeline.tailNodeId)) delete graph.timeline.tailNodeId;
    }
    for (const node of graph.nodes) {
      if (['shake', 'showBackground', 'showCharacter', 'hideCharacter', 'showChapter'].includes(node.type)) for (const pin of blueprintNodeDefaults(node.type).pins) if (!node.pins.some(existing => existing.id === pin.id)) node.pins.push(['presetId', 'lifetime'].includes(pin.id) ? { ...pin, defaultValue: '' } : pin.id === 'useDefaultFraming' ? { ...pin, defaultValue: false } : pin.id === 'duration' && node.properties.transition === 'fade' ? { ...pin, defaultValue: 1 } : pin);
      if (node.type === 'savedAction') {
        try { const action = actionSchema.parse(JSON.parse(String(node.properties.action))); syncAction(action); if (action.kind === 'visual') syncVisualPins(node, action); if (action.kind === 'audioClip') syncAudioClipPins(node, action); node.properties.action = JSON.stringify(action); } catch { /* Invalid saved actions remain visible in diagnostics. */ }
      }
      if (node.type === 'callFunction' || node.type === 'callMacro') {
        const target = graphs.find(item => item.id === node.properties.graphId);
        if (!target) continue;
        target.exposedInputs.forEach((pin, index) => {
          const oldId = `arg_${index}`;
          const newId = `arg_${pin.id}`;
          if (node.properties[newId] === undefined && node.properties[oldId] !== undefined) node.properties[newId] = node.properties[oldId];
          delete node.properties[oldId];
          for (const link of graph.links) if (link.toNodeId === node.id && link.toPinId === oldId) link.toPinId = newId;
        });
        node.pins = callablePins(target);
        for (const key of Object.keys(node.properties)) if (key.startsWith('arg_') && !target.exposedInputs.some(pin => key === `arg_${pin.id}`)) delete node.properties[key];
      } else {
        synchronizeBlueprintNodeValuePins(project,graph,node);
      }
    }
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    graph.links = graph.links.filter(link => nodes.get(link.fromNodeId)?.pins.some(pin => pin.id === link.fromPinId) && nodes.get(link.toNodeId)?.pins.some(pin => pin.id === link.toPinId));
  }
}

export function connectBlueprintPins(graph: BlueprintGraph, fromNodeId: string, fromPinId: string, toNodeId: string, toPinId: string): string | undefined {
  const from = graph.nodes.find(node => node.id === fromNodeId)?.pins.find(pin => pin.id === fromPinId);
  const to = graph.nodes.find(node => node.id === toNodeId)?.pins.find(pin => pin.id === toPinId);
  if (!from || !to) return '连接点已不存在，请重新选择。';
  if (fromNodeId === toNodeId) return '不能连接到节点自身。重复执行请使用计数循环。';
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
  if (reaches(toNodeId)) return '这条连线会形成循环。重复执行请使用计数循环节点。';
  graph.links = graph.links.filter(link => from.dataType === 'exec'
    ? !(link.fromNodeId === fromNodeId && link.fromPinId === fromPinId)
    : !(link.toNodeId === toNodeId && link.toPinId === toPinId));
  graph.links.push({ id: makeId('bplink'), fromNodeId, fromPinId, toNodeId, toPinId });
  return undefined;
}

export function sceneEntry(project: Project, sceneId: string) {
  return project.nodes.find(node => node.sceneId === sceneId && node.kind === 'start') ?? project.nodes.find(node => node.sceneId === sceneId);
}

function blueprintValueLabel(project: Project, value: VariableValue | undefined, type?: BlueprintDataType): string {
  if (type === 'component') {
    const component = declaredUiComponents(project).find(c => c.id === value);
    return component?.name || component?.text || (component ? '界面组件' : '未指定控件');
  }
  if (type === 'asset') return project.assets.find(a => a.id === value)?.name ?? '未指定素材';
  if (type === 'character') return project.characters.find(c => c.id === value)?.name ?? '未指定角色';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value ? `「${value}」` : '空文字';
  return value === undefined ? '未设置' : String(value);
}

/** Describe the source, never evaluate it or substitute the input's inactive default. */
export function blueprintOutputLabel(project: Project, graph: BlueprintGraph, node: BlueprintNode, pinId: string): string {
  if (!node.pins.some(p=>p.id===pinId&&p.direction==='output')) return node.name + ' · 缺失输出';
  if (node.type === 'getVariable') return '变量 · ' + (project.variables.find(v => v.id === node.properties.variableId)?.name ?? '缺失变量');
  if (node.type === 'getInput') return '输入 · ' + (graph.exposedInputs.find(p => p.id === node.properties.inputId)?.name ?? '缺失输入');
  if (node.type === 'literal') return '常量 · ' + blueprintValueLabel(project, node.properties.value, node.pins.find(p => p.id === pinId)?.dataType);
  if (node.type === 'getUiProperty') {
    const linked = graph.links.some(l => l.toNodeId === node.id && l.toPinId === 'componentId');
    const target = linked ? '接线控件' : blueprintValueLabel(project, blueprintInputValue(node, 'componentId'), 'component');
    return target + ' · ' + (uiProperties[node.properties.property as UiProperty]?.name ?? '未知属性');
  }
  return node.name + ' · ' + (node.pins.find(p => p.id === pinId)?.name ?? '缺失输出');
}

export function blueprintInputSource(project: Project, graph: BlueprintGraph, nodeId: string, pinId: string) {
  const link = graph.links.find(l => l.toNodeId === nodeId && l.toPinId === pinId);
  if (!link) return;
  const source = graph.nodes.find(n => n.id === link.fromNodeId);
  return { nodeId: source?.id, label: source ? blueprintOutputLabel(project, graph, source, link.fromPinId) : '缺失节点' };
}

function blueprintInputLabel(project: Project, graph: BlueprintGraph, node: BlueprintNode, pinId: string, fallback?: VariableValue): string {
  const source = blueprintInputSource(project, graph, node.id, pinId);
  if (source) return source.label;
  return blueprintValueLabel(project, blueprintInputValue(node, pinId) ?? fallback, node.pins.find(p => p.id === pinId)?.dataType);
}

export function blueprintNodeSummary(project: Project, graph: BlueprintGraph, node: BlueprintNode): string {
  if (node.type === 'comment') return String(node.properties.text || '双击或选中后编写说明');
  if (node.type === 'callFunction' || node.type === 'callMacro') {
    const target = projectGraphs(project)?.find(item => item.id === node.properties.graphId);
    return target?.timelineComponent || target?.timeline ? '时间轴组件 · 双击编辑 · 未传入素材使用默认值' : target?.name ?? '请选择调用流程';
  }
  if (node.type === 'getVariable' || node.type === 'setVariable') return project.variables.find(item => item.id === node.properties.variableId)?.name ?? '请选择状态';
  if (node.type === 'getInput') return graph.exposedInputs.find(item => item.id === node.properties.inputId)?.name ?? '请选择输入参数';
  if (node.type === 'setOutput') return graph.exposedOutputs.find(item => item.id === node.properties.outputId)?.name ?? '请选择输出结果';
  if (node.type === 'switchScene') return project.scenes.find(item => item.id === node.properties.sceneId)?.name ?? '请选择目标场景';
  if (['showBackground', 'playMusic', 'playSound'].includes(node.type)) return project.assets.find(item => item.id === node.properties.assetId)?.name ?? '请选择素材';
  if (node.type === 'showCharacter' || node.type === 'hideCharacter') {
    const character = effectiveCharacter(project, String(node.properties.characterId ?? ''));
    return character ? `${character.name}${node.type === 'showCharacter' ? ` · ${character.expressions.find(item => item.id === node.properties.expressionId)?.name ?? '选择表情'}` : ''}` : '请选择角色';
  }
  if (node.type === 'uiAction') return blueprintScreens[String(node.properties.screen)] ?? '请选择界面';
  if (node.type === 'getPlayerPreference' || node.type === 'setPlayerPreference') {
    if (node.properties.preference === 'characterVolume') return (blueprintInputSource(project,graph,node.id,'characterId')?.label ?? (node.properties.characterId ? effectiveCharacter(project,String(node.properties.characterId))?.name ?? '缺失角色' : '默认')) + ' · 角色音量';
    return playerPreferences[node.properties.preference as PlayerPreference]?.name ?? '请选择玩家设置';
  }
  if (node.type === 'confirmMessage') return String(node.properties.message ?? '确认继续吗？');
  if (['playUiAnimation','stopUiAnimationPlayback'].includes(node.type)) {
    const name = project.ui.animations?.find(a=>a.id===node.properties.animationId)?.name ?? '请选择界面动画';
    if (node.type === 'stopUiAnimationPlayback') return name + ' · 停止播放';
    const mode = ({forward:'正放',reverse:'倒放',pingpong:'往返'} as Record<string,string>)[String(node.properties.playMode ?? 'forward')] ?? '未知方向';
    const loops = blueprintInputSource(project,graph,node.id,'loops')?.label ?? ((blueprintInputValue(node,'loops')??1) === 0 ? '无限循环' : String(blueprintInputValue(node,'loops')??1)+'次');
    return `${name} · ${mode} · ${loops}`;
  }
  if (['setUiProperty', 'getUiProperty', 'animateUiProperty', 'stopUiAnimation', 'resetUiComponent', 'playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type)) {
    const target = blueprintInputLabel(project, graph, node, 'componentId');
    const property = uiProperties[node.properties.property as UiProperty]?.name ?? (node.properties.property === 'all' ? '全部属性' : '未知属性');
    if (node.type === 'setUiProperty') return `${target} · ${property} = ${blueprintInputLabel(project,graph,node,'value')}`;
    if (node.type === 'getUiProperty') return `${target} · ${property}`;
    if (node.type === 'animateUiProperty') return `${target} · ${property} → ${blueprintInputLabel(project,graph,node,'value')}`;
    if (node.type === 'stopUiAnimation') return `${target} · 停止${property}`;
    if (node.type === 'resetUiComponent') return `${target} · 恢复设计值`;
    return target + (node.type === 'playSpine' ? ' · ' + blueprintInputLabel(project,graph,node,'animation') : '');
  }
  if (node.type === 'effect') return project.effects.find(item => item.id === node.properties.effectId)?.name ?? '请选择演出效果';
  if (node.type === 'literal') return typeof node.properties.value === 'boolean' ? (node.properties.value ? '是' : '否') : String(node.properties.value ?? '');
  if (node.type === 'delay') return `${blueprintInputValue(node, 'seconds') ?? 1} 秒`;
  if(node.type==='event'&&graph.uiPageId)return '每次显示当前页面时，从这里开始执行。';
  return blueprintCatalog[node.type].hint;
}
