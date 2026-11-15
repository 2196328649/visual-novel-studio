export type ParameterKind = 'character' | 'expression' | 'preset' | 'feature' | 'target' | 'node' | 'effect' | 'blueprint' | 'variable' | 'sceneAsset' | 'image' | 'video' | 'visualId' | 'asset' | 'bgm' | 'sound' | 'voice' | 'number' | 'text' | 'keyword';
export interface CommandParameter { name: string; kind: ParameterKind; detail: string; values?: string[]; aliases?: string[]; id?: string }
export interface CommandSignature { name: string; aliases?: string[]; detail: string; parameters: CommandParameter[]; legacy?: boolean }
export const parameter = (name: string, kind: ParameterKind, detail: string, values?: string[], aliases?: string[]): CommandParameter => ({ name, kind, detail, values, aliases });
const character = parameter('角色', 'character', '输入角色名称或拼音首字母，例如 sly → 苏怜烟。');
const expression = parameter('表情', 'expression', '选择前一个角色的立绘表情；留空使用默认表情。');
const instance = parameter('第几个', 'text', '控制这个角色的第几个副本，从 1 开始，省略为第 1 个。相同编号更新表情或位置；隐藏后其他编号保持不变。', ['1', '2', '3'], ['第几个角色', '角色编号', '实例ID', '实例', '实例 ID', 'id', 'instanceId']);
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
    parameter(phase + '秒数', 'number', '不小于 0 的秒数；单独填写秒数时使用渐变。省略整组则继承角色设置。', ['0.5', '1', '2']),
  ]),
];
const mediaPlacement = [parameter('对象ID', 'visualId', '同一 ID 替换原对象，不同 ID 可同时显示。使用英文字母开头的小写字母、数字或下划线。', undefined, ['id', '实例ID']), parameter('横向位置', 'number', '以对象中心为锚点，0 为左侧，0.5 为中央。'), parameter('纵向位置', 'number', '以对象中心为锚点，0 为顶部，0.5 为中央。'), parameter('宽度', 'number', '占画面宽度的比例，默认 1。'), parameter('高度', 'number', '占画面高度的比例，默认 1。'), parameter('时长', 'number', '秒数；0 持续显示，直到隐藏对象或切换背景。'), parameter('图层', 'number', '整数；越大越靠前，默认 20。'), parameter('等待完成', 'keyword', '默认否；开启时需要指定大于 0 的时长。', ['是', '否'])];
const mediaTransitions = ['入场', '离场', '替换'].flatMap(phase => [parameter(phase + '过渡', 'keyword', '只过渡当前对象，不影响对白框。', ['立即', '渐变', '先淡出再淡入', '移动']), parameter(phase + '秒数', 'number', '不小于 0 的秒数；定时对象包含在总时长内。')]).concat([parameter('等待过渡', 'keyword', '入场或替换结束后继续；持续显示也可使用。', ['是', '否'])]);
/** The adjustable parts of a text entrance or exit. */
const animationParameters = (phase: string) => [
  parameter(phase + '横移', 'number', '开始或结束时相对正常位置的横向像素。'), parameter(phase + '纵移', 'number', '开始或结束时相对正常位置的纵向像素，负数向上。'),
  parameter(phase + '缩放', 'number', '开始或结束时的大小百分比，100 为原大小。', ['0', '50', '250']), parameter(phase + '翻转', 'keyword', '是否水平翻转。', ['是', '否']),
  parameter(phase + '旋转', 'number', '开始或结束时的旋转角度。', ['-90', '90', '180']), parameter(phase + '透明度', 'number', '开始或结束时的不透明度百分比，默认 0。', ['0', '50', '100']),
  parameter(phase + '曲线', 'keyword', '运动的快慢变化。', ['匀速', '先快后慢', '先慢后快', '缓入缓出', '回弹', '弹跳', '弹簧']),
  parameter(phase + '顺序', 'keyword', '每个字开始的先后。', ['从左到右', '从右到左', '从中间向两边', '从两边向中间', '随机']),
];
export const commandSignatures: CommandSignature[] = [
  { name: '显示角色', aliases: ['show'], detail: '显示角色的立绘与表情；角色留空跟随当前台词。', parameters: show },
  { name: '显示图片', aliases: ['image'], detail: '在舞台叠加图片，默认仅本句显示；变换集中控制位置、旋转和独立的 X/Y 缩放。', parameters: [parameter('图片', 'image', '选择项目图片，或浏览项目外素材。'), mediaPlacement[0], parameter('变换', 'text', '位置、旋转、缩放 X/Y 放在一个结构中；X 调整宽，Y 调整高。', ['{"位置":[0.5,0.5],"缩放":[1,1],"旋转":0}']), parameter('显示范围', 'keyword', '默认仅本句；推进台词后隐藏。持续显示保留到隐藏对象或切换背景。', ['仅本句', '持续显示', '定时显示']), parameter('时长', 'number', '定时显示的秒数；填写后默认采用定时显示。'), mediaPlacement[6], mediaPlacement[7], parameter('适应方式', 'keyword', '默认完整容纳，保持比例。', ['容纳', '填满', '拉伸']), ...mediaTransitions] },
  { name: '显示视频', aliases: ['播放视频', 'video'], detail: '在舞台播放视频，可调整位置、大小、音量和循环。', parameters: [parameter('视频', 'video', '选择视频素材。'), ...mediaPlacement, parameter('适应方式', 'keyword', '默认完整容纳，保持比例。', ['容纳', '填满', '拉伸']), parameter('循环', 'keyword', '默认否。', ['是', '否']), parameter('音量', 'number', '0 静音，1 原音量。'), ...mediaTransitions] },
  { name: '显示文字', aliases: ['添加文字演出'], detail: '在画面上显示独立文字，可选字体和文字动画；不同对象 ID 可同时显示多段，不改变台词。', parameters: [parameter('文字', 'text', '包含逗号时用引号包住。'), ...mediaPlacement, parameter('字号', 'number', '默认 60。'), parameter('颜色', 'text', '例如 #ffffff。'), ...mediaTransitions] },
  { name: '隐藏对象', aliases: ['隐藏图片', '隐藏视频', '隐藏文字'], detail: '隐藏指定图片、视频或文字对象，视频声音同时停止。', parameters: [parameter('对象ID', 'visualId', '填写显示指令的对象ID；默认图片 image、视频 video、文字 text。', undefined, ['id', '实例ID']), parameter('离场过渡', 'keyword', '省略时沿用显示对象的离场设置。', ['立即', '渐变', '先淡出再淡入', '移动']), parameter('离场秒数', 'number', '不小于 0 的秒数。'), parameter('等待完成', 'keyword', '默认是；等待离场动画结束。', ['是', '否'])] },
  { name: '演出设置', legacy: true, detail: '旧工程播放设置；独立演出请直接填写 @独立演出 的参数。', parameters: [parameter('允许点击跳过', 'keyword', '章节进入演出默认否。', ['是', '否']), parameter('结束后', 'keyword', '播放完成后执行。', ['继续剧情', '返回标题'])] },
  { name: '演出转场', legacy: true, detail: '旧工程转场设置；独立演出请直接填写 @独立演出 的参数。', parameters: [parameter('方式', 'keyword', '经过纯色画面或直接溶解。', ['无', '溶解', '纯色']), parameter('淡出', 'number', '淡出秒数。'), parameter('停留', 'number', '纯色停留秒数。'), parameter('淡入', 'number', '淡入秒数。'), parameter('颜色', 'text', '过渡颜色。', ['#000000', '#ffffff'])] },
  { name: '连线过渡', detail: '设置剧情模块指定出口的画面过渡；删去这条指令后沿用原有行为，断开连线时保留设置。', parameters: [
    parameter('模块', 'node', '需要设置过渡的来源剧情模块。', undefined, ['节点', '来源']),
    parameter('出口', 'text', '选择该模块的出口；选择和互动区域使用各自的稳定引用。', undefined, ['端口']),
    parameter('方式', 'keyword', '直接切换、叠化或经过纯色画面。', ['直接切换', '叠化', '纯色']),
    parameter('时长', 'number', '叠化总秒数，不小于 0，默认 0.8。', ['0.4', '0.8', '1.2']),
    parameter('淡出', 'number', '纯色过渡的淡出秒数，不小于 0，默认 0.4。', ['0.4']),
    parameter('停留', 'number', '纯色画面停留秒数，不小于 0，默认 0。', ['0', '0.5']),
    parameter('淡入', 'number', '纯色过渡的淡入秒数，不小于 0，默认 0.4。', ['0.4']),
    parameter('颜色', 'text', '纯色过渡的六位颜色，默认 #000000。', ['#000000', '#ffffff']),
  ] },
  { name: '返回标题界面', aliases: ['返回标题'], detail: '演出结束后回到标题页。', parameters: [] },
  { name: '解锁素材', detail: '将图片或声音加入已解锁图鉴，可放在任意演出中。', parameters: [parameter('素材', 'asset', '选择要解锁的图片或声音。')] },
  { name: '独立演出', detail: '将上方指令组成独立演出，播放后继续后续指令。名称、点击跳过及转场在本行设置；返回标题请在后面写 @返回标题界面。', parameters: [
    parameter('模块名称', 'text', '例如：第一章进入动画。可省略；包含逗号时用引号包住。', undefined, ['名称']),
    parameter('允许点击跳过', 'keyword', '省略时继承演出默认值；章节进入演出默认否。', ['是', '否']),
    parameter('结束转场', 'keyword', '从演出过渡到下一画面；单独填写转场秒数时使用纯色。', ['无', '溶解', '纯色'], ['转场', '方式']),
    parameter('淡出', 'number', '转场淡出秒数，不小于 0，默认 0.5。', ['0', '0.5', '1']),
    parameter('停留', 'number', '纯色画面停留秒数，不小于 0，默认 0。', ['0', '0.5', '1']),
    parameter('淡入', 'number', '下一画面淡入秒数，不小于 0，默认 0.5。', ['0', '0.5', '1']),
    parameter('颜色', 'text', '转场使用的六位颜色，默认 #000000。', ['#000000', '#ffffff']),
  ] },
  { name: '隐藏界面', detail: '隐藏对白和快捷按钮，直到明确显示界面。', parameters: [] },
  { name: '显示界面', detail: '恢复对白和快捷按钮。', parameters: [] },
  { name: '开始台词演出', aliases: ['播放台词演出'], detail: '从此处开始本句文字和配音，后续舞台演出继续执行；同一句只触发一次。', parameters: [] },
  { name: '隐藏角色', aliases: ['隐藏', 'hide'], detail: '让这个角色的指定副本离开画面，不影响其他副本。', parameters: [character, parameter('转场', 'keyword', '默认溶解。', ['无', '溶解', '淡入淡出']), parameter('时长', 'number', '转场秒数。'), parameter('等待完成', 'keyword', '默认是。', ['是', '否']), instance] },
  { name: '背景', aliases: ['切换背景', 'background'], detail: '切换背景图片。', parameters: [parameter('背景素材', 'sceneAsset', '输入名称或拼音首字母搜索场景图片。', undefined, ['背景', '图片', '素材']), parameter('转场', 'keyword', '默认溶解。', ['无', '溶解', '淡入淡出']), parameter('时长', 'number', '转场秒数，留空使用默认时长。'), parameter('等待完成', 'keyword', '是否等待转场结束。', ['是', '否'])] },
  { name: '背景音乐', aliases: ['音乐', '播放音乐', 'music'], detail: '播放背景音乐，可按名称搜索。', parameters: [parameter('背景音乐', 'bgm', '选择背景音乐素材。', undefined, ['音乐', '素材']), parameter('循环', 'keyword', '默认是。', ['是', '否']), parameter('淡入', 'number', '淡入秒数，默认 0.5。', undefined, ['淡入秒数', '时长'])] },
  { name: '音效', aliases: ['播放音效', 'sound'], detail: '播放一次音效。', parameters: [parameter('音效素材', 'sound', '从音效分类中选择。')] },
  { name: '文字演出', aliases: ['文字样式'], detail: '设置下一句台词的字体、颜色、速度、位置和文字特效；只写需要改的参数，其余跟随角色和对话框。', parameters: [
    parameter('预设', 'text', '使用内置或工程中的文字演出预设，例如 低语、回忆；后面的参数在预设基础上调整。'),
    parameter('字体', 'text', '字体素材名称；省略时使用对话框字体。'),
    parameter('大小', 'number', '相对对话框字号的百分比，100 为原大小。', ['80', '100', '130', '180']),
    parameter('颜色', 'text', '六位颜色，例如 #ff5a4f。'),
    parameter('粗体', 'keyword', '是否加粗。', ['是', '否']),
    parameter('斜体', 'keyword', '是否倾斜。', ['是', '否']),
    parameter('对齐', 'keyword', '文字在显示范围内的对齐方式。', ['左对齐', '居中', '右对齐']),
    parameter('描边宽度', 'number', '像素，0 为无描边。'), parameter('描边颜色', 'text', '六位颜色。'), parameter('描边不透明度', 'number', '0～1。'),
    parameter('阴影横向', 'number', '像素偏移。'), parameter('阴影纵向', 'number', '像素偏移。'), parameter('阴影柔化', 'number', '像素，0 为硬阴影。'), parameter('阴影颜色', 'text', '六位颜色。'), parameter('阴影不透明度', 'number', '0～1。'),
    parameter('速度', 'keyword', '按时长：整句在指定秒数内显示完；按速度：每秒显示的字数；瞬间显示：不逐字出现。', ['跟随玩家设置', '按时长', '按速度', '瞬间显示']),
    parameter('时长', 'number', '整句显示完所用的秒数，大于 0；只填时长时速度自动为按时长。', ['1', '2', '3']),
    parameter('每秒字数', 'number', '大于 0；只填每秒字数时速度自动为按速度。', ['10', '20', '40']),
    parameter('位置', 'keyword', '画面：隐藏对话框，把文字放在画面上。', ['对话框', '画面']),
    parameter('横向位置', 'number', '文字中心的横向位置，0 为左边、0.5 为中央、1 为右边。', ['0.5']),
    parameter('纵向位置', 'number', '文字中心的纵向位置，0 为顶部、0.5 为中央、1 为底部。', ['0.3', '0.5', '0.7']),
    parameter('宽度', 'number', '文字区域宽度占画面的比例，大于 0。', ['0.6', '0.8']),
    parameter('入场', 'keyword', '每个字出现的方式。', ['普通', '逐字淡入', '逐字放大', '逐字砸入', '逐字翻转', '逐字落下', '逐字升起']),
    parameter('入场时间', 'number', '每个字完成入场所用的秒数。', ['0.2', '0.3', '0.5']),
    ...animationParameters('入场'),
    parameter('持续效果', 'keyword', '文字显示期间一直播放的效果。', ['无', '抖动', '波浪', '呼吸'], ['循环效果']),
    parameter('幅度', 'number', '抖动和波浪为像素，呼吸为明暗变化的百分比。'),
    parameter('频率', 'number', '波浪和呼吸每秒的次数，大于 0。'),
    parameter('退场', 'keyword', '玩家点击后文字离开的方式。', ['无退场', '逐字淡出', '逐字缩小', '逐字放大消失', '逐字翻转', '逐字落下', '逐字飘起']),
    parameter('退场总时长', 'number', '整句退场用的秒数，默认 0.4。', ['0.3', '0.5', '1']),
    parameter('退场时间', 'number', '每个字完成退场所用的秒数，默认 0.25。', ['0.2', '0.3']),
    ...animationParameters('退场'),
    parameter('打字音', 'text', '逐字显示时播放的音频素材名称。'),
    parameter('打字音间隔', 'number', '每隔几个字响一次，默认 2；标点和空格不发声。', ['1', '2', '3']),
    parameter('打字音音量', 'number', '0～1，默认 1；0 表示这句不发声。', ['0', '0.5', '1']),
  ] },
  { name: '配音', aliases: ['voice'], detail: '为下一句台词添加配音。', parameters: [parameter('配音素材', 'voice', '从配音分类中选择，可按角色名称或文件名搜索。')] },
  { name: '局部文字语法', detail: '仅下一句及紧接的续行使用带引号的局部文字标记，保留字面括号、空白、换行与字体名称中的分隔符。声明必须紧接台词；旧剧本无须添加。', parameters: [parameter('格式', 'keyword', '带引号时写 〖"文字"｜效果〗；〖"原文"〗只保留原文，不加效果。双引号和反斜杠使用 JSON 转义。', ['带引号'])] },
  { name: '停止音乐', aliases: ['stopMusic'], detail: '淡出并停止背景音乐。', parameters: [parameter('淡出秒数', 'number', '淡出秒数，默认 0.5 秒。', ['0', '0.5', '1', '2'])] },
  { name: '等待', aliases: ['暂停', 'pause'], detail: '等待指定秒数后继续。', parameters: [parameter('秒数', 'number', '等待秒数，没有时长上限。', ['0.5', '1', '2', '3'])] },
  { name: '震动', aliases: ['shake'], detail: '震动画面。', parameters: [parameter('方向', 'keyword', '选择横向或纵向。', ['横向', '纵向']), parameter('时长', 'number', '震动秒数，默认 0.6。', ['0.6', '1', '2']), parameter('幅度', 'number', '按游戏分辨率计算的像素偏移，默认 20。', ['10', '20', '40']), parameter('等待完成', 'keyword', '否：立即开始下一条指令，可以与镜头同时播放。', ['是', '否'])] },
  { name: '镜头', aliases: ['camera'], detail: '移动和缩放镜头。', parameters: [parameter('横向偏移', 'number', '0 为原位；可填写任意位置偏移。', ['-0.2', '0', '0.2']), parameter('纵向偏移', 'number', '0 为原位；可填写任意位置偏移。', ['-0.2', '0', '0.2']), parameter('缩放', 'number', '1 为原始画面，可自由输入缩放倍数。', ['1', '1.15', '1.5', '2']), parameter('时长', 'number', '镜头运动秒数。', ['0.5', '1', '2']), parameter('旋转', 'number', '角度，可输入负数或大于 360 的值。', ['0', '15', '-15']), parameter('缓动', 'keyword', '运动的速度曲线。', ['匀速', '缓入缓出', '缓入', '缓出']), parameter('等待完成', 'keyword', '否：启动镜头后立即执行下一条，例如震动。是：镜头到位后继续。', ['是', '否'])] },
  { name: '角色功能', legacy: true, aliases: ['角色-功能'], detail: '兼容旧工程中已有的角色功能调用；新的可复用演出请使用蓝图。', parameters: [character, parameter('功能', 'feature', '选择前一个角色的已有功能。')] },
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

// Append new fields after the original display-text arguments so positional
// commands in existing projects keep their meaning. Motion uses its own duration.
export const floatingTextStyleParameters = commandSignatures.find(spec => spec.name === '文字演出')!.parameters
  .filter(item => ['字体', '斜体', '对齐', '速度', '时长', '每秒字数', '持续效果', '幅度', '频率'].includes(item.name) || /^(描边|阴影|入场|退场)/.test(item.name))
  .map(item => item.name === '时长' ? { ...item, name: '逐字时长', detail: '文字全部显示所需的秒数；显示时长仍由“时长”控制。' }
    : item.name === '退场' ? { ...item, detail: '文字在显示时长结束前离开的方式；时长为 0 时不播放逐字退场。' }
    : item.name === '字体' ? { ...item, detail: '字体素材名称；省略时使用默认字体。' } : item);
commandSignatures.find(spec => spec.name === '显示文字')!.parameters.push(...floatingTextStyleParameters);

export function commandSignature(name: string) { return commandSignatures.find(spec => [spec.name, ...(spec.aliases ?? [])].some(value => value.toLowerCase() === name.toLowerCase())); }

