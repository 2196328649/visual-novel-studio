export type ParameterKind = 'character' | 'expression' | 'preset' | 'feature' | 'target' | 'node' | 'effect' | 'blueprint' | 'variable' | 'sceneAsset' | 'image' | 'video' | 'visualId' | 'asset' | 'bgm' | 'sound' | 'voice' | 'number' | 'text' | 'keyword';
export interface CommandParameter { name: string; kind: ParameterKind; detail: string; values?: string[]; aliases?: string[]; id?: string }
export interface CommandSignature { name: string; aliases?: string[]; detail: string; parameters: CommandParameter[]; legacy?: boolean }
export const parameter = (name: string, kind: ParameterKind, detail: string, values?: string[], aliases?: string[]): CommandParameter => ({ name, kind, detail, values, aliases });
const character = parameter('角色', 'character', '输入角色名称或拼音首字母，例如 sly → 苏怜烟。');
const expression = parameter('表情', 'expression', '选择前一个角色的立绘表情；留空使用默认表情。');
const instance = parameter('实例ID', 'text', '同一个 ID 更新同一显示实例；不同 ID 可同时显示同一角色。留空控制角色的默认实例。', undefined, ['实例', '实例 ID', 'id', 'instanceId']);
const show = [
  { ...character, detail: '留空跟随当前台词的发言角色；填写则显示指定角色。旁白和没有立绘的角色跳过。' }, expression,
  parameter('横向位置', 'number', '0 是左侧，0.5 是中央，1 是右侧；可填负数或大于 1 的位置。', ['0', '0.25', '0.5', '0.75', '1']),
  parameter('缩放', 'number', '立绘缩放倍数；1 为原始大小，0.4 为 40%，也可输入更大或负数。', ['0.4', '0.5', '0.75', '1', '1.5']),
  parameter('纵向位置', 'number', '可选，默认 1。以立绘底部为锚点：0 是画面顶部，1 是底部；大于 1 可把下半身移出画面，也可填负数。', ['0', '0.5', '1', '1.2', '1.5']),
  parameter('图层', 'number', '可选，默认 10；整数，数值越大越靠前。', ['0', '10', '20', '50', '100']),
  parameter('等待完成', 'keyword', '可选，默认是；否表示继续播放后续演出。', ['是', '否']),
  parameter('站位预设', 'preset', '关联角色的左、中、右或自定义预设。修改预设后所有引用一起更新；手动保留本次坐标。', undefined, ['预设', '站位']),
  parameter('显示范围', 'keyword', '仅本句在台词推进后隐藏；持续显示保留到明确隐藏，换背景也会保留。', ['仅本句', '持续显示'], ['范围', '持续方式', 'lifetime']),
  instance,
  ...['入场', '离场', '表情切换'].flatMap(phase => [
    parameter(phase + '过渡', 'keyword', '省略时继承角色设置；只过渡当前角色。指定方式但省略秒数时使用 0.5 秒。', ['立即', '渐变', '先淡出再淡入', '移动']),
    parameter(phase + '秒数', 'number', '0 至 60 秒；单独填写秒数时使用渐变。省略整组则继承角色设置。', ['0.5', '1', '2']),
  ]),
];
const mediaPlacement = [parameter('对象ID', 'visualId', '同一 ID 替换原对象，不同 ID 可同时显示。使用英文字母开头的小写字母、数字或下划线。', undefined, ['id', '实例ID']), parameter('横向位置', 'number', '以对象中心为锚点，0 为左侧，0.5 为中央。'), parameter('纵向位置', 'number', '以对象中心为锚点，0 为顶部，0.5 为中央。'), parameter('宽度', 'number', '占画面宽度的比例，默认 1。'), parameter('高度', 'number', '占画面高度的比例，默认 1。'), parameter('时长', 'number', '秒数；0 持续显示，直到隐藏对象或切换背景。'), parameter('图层', 'number', '整数；越大越靠前，默认 20。'), parameter('等待完成', 'keyword', '默认否；开启时需要指定大于 0 的时长。', ['是', '否'])];
const mediaTransitions = ['入场', '离场', '替换'].flatMap(phase => [parameter(phase + '过渡', 'keyword', '只过渡当前对象，不影响对白框。', ['立即', '渐变', '先淡出再淡入', '移动']), parameter(phase + '秒数', 'number', '0 至 60 秒；定时对象包含在总时长内。')]).concat([parameter('等待过渡', 'keyword', '入场或替换结束后继续；持续显示也可使用。', ['是', '否'])]);
export const commandSignatures: CommandSignature[] = [
  { name: '显示角色', aliases: ['show'], detail: '显示角色的立绘与表情；角色留空跟随当前台词。', parameters: show },
  { name: '显示图片', aliases: ['image'], detail: '在舞台叠加图片，默认仅本句显示；变换集中控制位置、旋转和独立的 X/Y 缩放。', parameters: [parameter('图片', 'image', '选择项目图片，或浏览项目外素材。'), mediaPlacement[0], parameter('变换', 'text', '位置、旋转、缩放 X/Y 放在一个结构中；X 调整宽，Y 调整高。', ['{"位置":[0.5,0.5],"缩放":[1,1],"旋转":0}']), parameter('显示范围', 'keyword', '默认仅本句；推进台词后隐藏。持续显示保留到隐藏对象或切换背景。', ['仅本句', '持续显示', '定时显示']), parameter('时长', 'number', '定时显示的秒数；填写后默认采用定时显示。'), mediaPlacement[6], mediaPlacement[7], parameter('适应方式', 'keyword', '默认完整容纳，保持比例。', ['容纳', '填满', '拉伸']), ...mediaTransitions] },
  { name: '显示视频', aliases: ['播放视频', 'video'], detail: '在舞台播放视频，可调整位置、大小、音量和循环。', parameters: [parameter('视频', 'video', '选择视频素材。'), ...mediaPlacement, parameter('适应方式', 'keyword', '默认完整容纳，保持比例。', ['容纳', '填满', '拉伸']), parameter('循环', 'keyword', '默认否。', ['是', '否']), parameter('音量', 'number', '0 静音，1 原音量。'), ...mediaTransitions] },
  { name: '显示文字', detail: '在舞台显示独立文字，不改变当前对白。', parameters: [parameter('文字', 'text', '包含逗号时用引号包住。'), ...mediaPlacement, parameter('字号', 'number', '默认 60。'), parameter('颜色', 'text', '例如 #ffffff。'), ...mediaTransitions] },
  { name: '隐藏对象', aliases: ['隐藏图片', '隐藏视频', '隐藏文字'], detail: '隐藏指定图片、视频或文字对象，视频声音同时停止。', parameters: [parameter('对象ID', 'visualId', '填写显示指令的对象ID；默认图片 image、视频 video、文字 text。', undefined, ['id', '实例ID']), parameter('离场过渡', 'keyword', '省略时沿用显示对象的离场设置。', ['立即', '渐变', '先淡出再淡入', '移动']), parameter('离场秒数', 'number', '0 至 60 秒。'), parameter('等待完成', 'keyword', '默认是；等待离场动画结束。', ['是', '否'])] },
  { name: '演出设置', legacy: true, detail: '旧工程播放设置；独立演出请直接填写 @独立演出 的参数。', parameters: [parameter('允许点击跳过', 'keyword', '章节进入演出默认否。', ['是', '否']), parameter('结束后', 'keyword', '播放完成后执行。', ['继续剧情', '返回标题'])] },
  { name: '演出转场', legacy: true, detail: '旧工程转场设置；独立演出请直接填写 @独立演出 的参数。', parameters: [parameter('方式', 'keyword', '经过纯色画面或直接溶解。', ['无', '溶解', '纯色']), parameter('淡出', 'number', '淡出秒数。'), parameter('停留', 'number', '纯色停留秒数。'), parameter('淡入', 'number', '淡入秒数。'), parameter('颜色', 'text', '过渡颜色。', ['#000000', '#ffffff'])] },
  { name: '返回标题界面', aliases: ['返回标题'], detail: '演出结束后回到标题页。', parameters: [] },
  { name: '解锁素材', detail: '将图片或声音加入已解锁图鉴，可放在任意演出中。', parameters: [parameter('素材', 'asset', '选择要解锁的图片或声音。')] },
  { name: '独立演出', detail: '将上方指令组成独立演出，播放后继续后续指令。名称、点击跳过及转场在本行设置；返回标题请在后面写 @返回标题界面。', parameters: [
    parameter('模块名称', 'text', '例如：第一章进入动画。可省略；包含逗号时用引号包住。', undefined, ['名称']),
    parameter('允许点击跳过', 'keyword', '省略时继承演出默认值；章节进入演出默认否。', ['是', '否']),
    parameter('结束转场', 'keyword', '从演出过渡到下一画面；单独填写转场秒数时使用纯色。', ['无', '溶解', '纯色'], ['转场', '方式']),
    parameter('淡出', 'number', '转场淡出秒数，0 至 60，默认 0.5。', ['0', '0.5', '1']),
    parameter('停留', 'number', '纯色画面停留秒数，0 至 60，默认 0。', ['0', '0.5', '1']),
    parameter('淡入', 'number', '下一画面淡入秒数，0 至 60，默认 0.5。', ['0', '0.5', '1']),
    parameter('颜色', 'text', '转场使用的六位颜色，默认 #000000。', ['#000000', '#ffffff']),
  ] },
  { name: '隐藏界面', detail: '隐藏对白和快捷按钮，直到明确显示界面。', parameters: [] },
  { name: '显示界面', detail: '恢复对白和快捷按钮。', parameters: [] },
  { name: '播放台词演出', detail: '从此处开始本句文字和配音，后续舞台演出继续执行；同一句只触发一次。', parameters: [] },
  { name: '隐藏角色', aliases: ['隐藏', 'hide'], detail: '让指定实例离开画面，不影响其他实例。', parameters: [character, parameter('转场', 'keyword', '默认溶解。', ['无', '溶解', '淡入淡出']), parameter('时长', 'number', '转场秒数。'), parameter('等待完成', 'keyword', '默认是。', ['是', '否']), instance] },
  { name: '背景', aliases: ['切换背景', 'background'], detail: '切换背景图片。', parameters: [parameter('背景素材', 'sceneAsset', '输入名称或拼音首字母搜索场景图片。', undefined, ['背景', '图片', '素材']), parameter('转场', 'keyword', '默认溶解。', ['无', '溶解', '淡入淡出']), parameter('时长', 'number', '转场秒数，留空使用默认时长。'), parameter('等待完成', 'keyword', '是否等待转场结束。', ['是', '否'])] },
  { name: '背景音乐', aliases: ['音乐', '播放音乐', 'music'], detail: '播放背景音乐，可按名称搜索。', parameters: [parameter('背景音乐', 'bgm', '选择背景音乐素材。', undefined, ['音乐', '素材']), parameter('循环', 'keyword', '默认是。', ['是', '否']), parameter('淡入', 'number', '淡入秒数，默认 0.5。', undefined, ['淡入秒数', '时长'])] },
  { name: '音效', aliases: ['播放音效', 'sound'], detail: '播放一次音效。', parameters: [parameter('音效素材', 'sound', '从音效分类中选择。')] },
  { name: '配音', aliases: ['voice'], detail: '为下一句台词添加配音。', parameters: [parameter('配音素材', 'voice', '从配音分类中选择，可按角色名称或文件名搜索。')] },
  { name: '停止音乐', aliases: ['stopMusic'], detail: '淡出并停止背景音乐。', parameters: [parameter('淡出秒数', 'number', '淡出秒数，默认 0.5 秒。', ['0', '0.5', '1', '2'])] },
  { name: '等待', aliases: ['暂停', 'pause'], detail: '等待指定秒数后继续。', parameters: [parameter('秒数', 'number', '等待秒数，没有时长上限。', ['0.5', '1', '2', '3'])] },
  { name: '震动', aliases: ['shake'], detail: '震动画面。', parameters: [parameter('方向', 'keyword', '选择横向或纵向。', ['横向', '纵向']), parameter('时长', 'number', '震动秒数，默认 0.6。', ['0.6', '1', '2']), parameter('幅度', 'number', '按游戏分辨率计算的像素偏移，默认 20。', ['10', '20', '40']), parameter('等待完成', 'keyword', '否：立即开始下一条指令，可以与镜头同时播放。', ['是', '否'])] },
  { name: '镜头', aliases: ['camera'], detail: '移动和缩放镜头。', parameters: [parameter('横向偏移', 'number', '0 为原位；可填写任意位置偏移。', ['-0.2', '0', '0.2']), parameter('纵向偏移', 'number', '0 为原位；可填写任意位置偏移。', ['-0.2', '0', '0.2']), parameter('缩放', 'number', '1 为原始画面，可自由输入缩放倍数。', ['1', '1.15', '1.5', '2']), parameter('时长', 'number', '镜头运动秒数。', ['0.5', '1', '2']), parameter('旋转', 'number', '角度，可输入负数或大于 360 的值。', ['0', '15', '-15']), parameter('缓动', 'keyword', '运动的速度曲线。', ['匀速', '缓入缓出', '缓入', '缓出']), parameter('等待完成', 'keyword', '否：启动镜头后立即执行下一条，例如震动。是：镜头到位后继续。', ['是', '否'])] },
  { name: '角色功能', aliases: ['角色-功能'], detail: '调用角色的可复用功能。', parameters: [character, parameter('功能', 'feature', '选择前一个角色的功能。')] },
  { name: '效果', aliases: ['effect'], detail: '调用已保存的演出效果。', parameters: [parameter('效果名称', 'effect', '选择工程效果或内置效果。')] },
  { name: '蓝图', aliases: ['通用蓝图', 'blueprint'], detail: '执行通用蓝图。', parameters: [parameter('蓝图名称', 'blueprint', '输入蓝图名称或拼音首字母。')] },
  { name: '跳转', aliases: ['jump'], detail: '跳到指定目录项；参数用逗号分隔，也可只写需要的参数名=值。', parameters: [parameter('目标', 'target', '输入章节、小章节或段落的名称。', undefined, ['目标目录项', '段落']), parameter('切换方式', 'keyword', '默认无，可省略。', ['无', '溶解', '淡入淡出'], ['转场', '方式']), parameter('时长', 'number', '转场秒数。', ['0', '0.5', '1'], ['duration']), parameter('颜色', 'text', '淡入淡出使用的六位颜色，默认 #000000。', ['#000000', '#ffffff'], ['color'])] },
  { name: '调用', aliases: ['call'], detail: '进入一段可复用剧情，遇到 @返回 后继续调用处的下一步。', parameters: [parameter('目标目录项', 'target', '选择章节、小章节或段落。调用后的 @跳转 指定返回后继续的位置。')] },
  { name: '返回', aliases: ['return'], detail: '结束本次调用，回到调用处继续。', parameters: [] },
  { name: '入口', detail: '设置整部作品从哪个目录项开始；冒号后是名称。也可在「作品设置 → 故事入口」选择。', parameters: [parameter('故事入口', 'target', '玩家开始新游戏时进入这里。例如 @入口：序章；「序章」是目录项名称，不是另一条指令。')] },
  { name: '开始', detail: '创建连接下一段的流程起点，用于蓝图或小章节入口；整部作品从哪里开始由「故事入口」设置。普通顺序剧情可省略。', parameters: [] },
  { name: '实例', legacy: true, detail: '保留蓝图中已有节点及其设置、连接。', parameters: [parameter('节点', 'node', '选择要保留的节点；重复使用可选择「节点实例」。')] },
  { name: '复用节点', aliases: ['节点实例'], detail: '复制已有剧情、互动或小游戏及其设置。', parameters: [parameter('节点', 'node', '选择要复用的节点。')] },
  { name: '互动实例', legacy: true, detail: '复用点击互动节点。', parameters: [parameter('互动节点', 'node', '选择已有的点击互动。')] },
  { name: '小游戏实例', legacy: true, detail: '复用小游戏节点。', parameters: [parameter('小游戏', 'node', '选择已有小游戏。')] },
  { name: '设置', aliases: ['set'], detail: '修改参数，可写：如果 章节进度 < 2，章节进度 = 2。', parameters: [parameter('状态', 'variable', '状态名后填写 = 或 += 和数值。')] },
  { name: '如果', detail: '条件成立时修改参数，例如 章节进度 < 2，章节进度 = 2。', parameters: [parameter('条件与赋值', 'text', '条件，参数 = 新值。')] },
  { name: '条件', detail: '按参数条件选择去向，后接 @满足 和 @不满足。', parameters: [parameter('条件', 'text', '例如：谨慎 >= 1。')] },
  { name: '满足', detail: '条件成立时进入此目录项。', parameters: [parameter('目标', 'target', '选择章节、小章节或段落。')] },
  { name: '不满足', detail: '条件不成立时进入此目录项。', parameters: [parameter('目标', 'target', '选择章节、小章节或段落。')] },
  { name: '选择', detail: '显示一个问题，后面用 @选项 填写可选回答。', parameters: [parameter('提示文字', 'text', '例如 该如何回答？')] },
  { name: '选项', detail: '填写选项文字和去向。', parameters: [parameter('选项文字 -> 目标段落', 'text', '例如 留下来 -> 夜宴。')] },
];

export function commandSignature(name: string) { return commandSignatures.find(spec => [spec.name, ...(spec.aliases ?? [])].some(value => value.toLowerCase() === name.toLowerCase())); }

